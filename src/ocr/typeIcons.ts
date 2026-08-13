import { RegionData, luminance, saturation } from './pixels';
import { GLYPH_N, GLYPH_TEMPLATES, COVERED_TYPES } from '../data/type-templates';

// ---------------------------------------------------------------------------
// Deterministic template-matching type-icon reader.
//
// In a Champions card header the strip after the name reads, left-to-right:
//   [gender badge] [type badge 1] [type badge 2?]
// TYPE badges are rounded SQUARES — a solid colour background with a WHITE type
// SYMBOL (flame=Fire, wing=Flying, drop=Water, …). GENDER badges are CIRCLES
// (♂ blue, ♀ red) with a white gender symbol. Background colour is ambiguous
// (Fire-red ~ ♀-red; Dragon-blue ~ ♂-blue ~ Flying-blue; Ghost-purple ~ panel),
// so the WHITE GLYPH SHAPE is the discriminator: each badge's normalized glyph
// mask is matched against committed per-type + gender templates.
//
// Everything here is integer/threshold arithmetic on the pixel buffer plus the
// fixed committed templates — no Math.random / time / locale — so the same crop
// yields the same read on every device.
//
// CONSERVATISM IS MANDATORY. The species filter requires an EXACT type-set match
// (see speciesInference.sameTypeSet), so a wrong OR incomplete confident read
// removes the true species. The reader therefore returns confident:false unless
// EVERY detected badge is confidently identified (a covered type or a gender),
// all badge ink is accounted for (no dropped/fragmented badge), and exactly 1-2
// type badges remain. When any of that fails, inference falls back to
// ability+stats — safe. Only 10 of 18 types are covered by the committed
// templates (see type-templates.ts); an uncovered type never reads confident.
// ---------------------------------------------------------------------------

// Segmentation tuning (all relative to the strip height, so resolution-independent).
const SEP_BRIGHT_LUM = 165; // luminance above which a pixel is "bright" (header separator)
const SEP_ROW_FRAC = 0.6; // a top/bottom row this bright across the width is separator → trim
const PANEL_FAR = 45; // colour distance from the lavender panel that marks a badge pixel
const WHITE_LUM = 180; // white glyph pixel: bright …
const WHITE_SAT = 0.3; //   … and low saturation (survives even panel-coloured badges)

// Matching tuning. On the source screenshots each badge self-matches its own
// template at IoU≈1.0; cross-type confusions peak ~0.6 and same-type cross-card
// matches (validated on the two Dragon / two Ghost samples) sit 0.71-0.83.
//
// Hardening (2026-08): the two thresholds below were calibrated only on the 10 covered glyphs, but
// they also gate every UNCOVERED type's glyph indirectly — a badge that best-matches a covered
// template still needs to clear MIN_IOU/MARGIN, and an uncovered glyph that happens to sit close to
// a covered template's shape could otherwise pass. Measured (via a temporary debug hook, since
// removed) the actual score/margin of every badge — type AND gender, since both are gated by the
// same matchBadge confidence check — on every currently-CORRECT confident read across
// sample/zard-moves.png and sample/dweather-moves.png (10 type badges + 7 gender badges spanning
// Fire/Flying/Dragon/Ground/Dark/Ghost/Grass/Fairy/Water/Water+Flying/Fairy(single) + M/F). The
// observed minimum was IoU 0.6792 (dweather Mimi's ♀ gender badge) and margin 0.1723 (same badge).
// Raised both thresholds to just below that floor — with a small buffer so ordinary anti-aliasing
// jitter doesn't start dropping a currently-correct read — shrinking the false-match window without
// regressing any of those reads (re-verified: all still confident and correct at the new values).
const MIN_IOU = 0.65; // a badge must match some template at least this well
const MARGIN = 0.15; // … and beat the best DIFFERENT-name template by this much

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
}

/** Vertical band of the strip with the header separator/gradient bands trimmed off top & bottom. */
function badgeBand(reg: RegionData): { y0: number; y1: number } {
  const { data, width, height } = reg;
  const bright = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) {
    let c = 0;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (luminance(data[o], data[o + 1], data[o + 2]) >= SEP_BRIGHT_LUM) c++;
    }
    bright[y] = c / width;
  }
  let y0 = 0;
  let y1 = height - 1;
  while (y0 < height && bright[y0] >= SEP_ROW_FRAC) y0++;
  while (y1 > y0 && bright[y1] >= SEP_ROW_FRAC) y1--;
  return { y0, y1 };
}

/** Median RGB of the strip's empty left columns within the badge band = the lavender panel colour. */
function panelColor(reg: RegionData, y0: number, y1: number): [number, number, number] {
  const { data, width } = reg;
  const xc = Math.max(2, Math.round(width * 0.12));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < xc; x++) {
      const o = (y * width + x) * 4;
      rs.push(data[o]);
      gs.push(data[o + 1]);
      bs.push(data[o + 2]);
    }
  }
  const med = (a: number[]): number => {
    a.sort((p, q) => p - q);
    return a.length ? a[a.length >> 1] : 0;
  };
  return [med(rs), med(gs), med(bs)];
}

/** Foreground mask: pixels that are either far from the panel colour (badge background) OR a
 *  bright low-saturation white (the glyph — survives even when a badge blends with the panel). */
function badgeMask(reg: RegionData, band: { y0: number; y1: number }, panel: [number, number, number]): Uint8Array {
  const { data, width, height } = reg;
  const mask = new Uint8Array(width * height);
  for (let y = band.y0; y <= band.y1; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const dr = r - panel[0];
      const dg = g - panel[1];
      const db = b - panel[2];
      const far = Math.sqrt(dr * dr + dg * dg + db * db) > PANEL_FAR;
      const white = luminance(r, g, b) >= WHITE_LUM && saturation(r, g, b) <= WHITE_SAT;
      if (far || white) mask[i] = 1;
    }
  }
  return mask;
}

/** Morphological close (dilate then erode by `r`) — merges the fragments of a low-contrast badge
 *  (Dragon/Ghost) without bridging the wider gaps between separate badges. */
function close(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const dil = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) dil[ny * width + nx] = 1;
        }
      }
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!dil[y * width + x]) continue;
      let all = true;
      for (let dy = -r; dy <= r && all; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= height || nx < 0 || nx >= width || !dil[ny * width + nx]) {
            all = false;
            break;
          }
        }
      }
      if (all) out[y * width + x] = 1;
    }
  }
  return out;
}

/** 4-connected components of a binary mask, as bounding boxes. */
function components(mask: Uint8Array, width: number, height: number): Box[] {
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const out: Box[] = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || !mask[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    let area = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p / width) | 0;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && !seen[p - 1] && mask[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < width - 1 && !seen[p + 1] && mask[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && !seen[p - width] && mask[p - width]) { seen[p - width] = 1; stack.push(p - width); }
      if (y < height - 1 && !seen[p + width] && mask[p + width]) { seen[p + width] = 1; stack.push(p + width); }
    }
    out.push({ x0, y0, x1, y1, area });
  }
  return out;
}

/** Keep only square-ish, tall-enough components (badges); drops the thin wide separator and specks. */
function badgeBoxes(comps: Box[], stripHeight: number): Box[] {
  return comps
    .filter((c) => {
      const w = c.x1 - c.x0 + 1;
      const h = c.y1 - c.y0 + 1;
      const aspect = w / h;
      return (
        h >= stripHeight * 0.45 &&
        w >= stripHeight * 0.35 &&
        aspect >= 0.55 &&
        aspect <= 1.9 &&
        c.area >= stripHeight * stripHeight * 0.15
      );
    })
    .sort((a, b) => a.x0 - b.x0);
}

/** Adaptive (Otsu) luminance threshold of a badge box; the bright class is the white glyph. */
function otsuThreshold(reg: RegionData, box: Box): number {
  const hist = new Array<number>(256).fill(0);
  let total = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const o = (y * reg.width + x) * 4;
      hist[Math.round(luminance(reg.data[o], reg.data[o + 1], reg.data[o + 2]))]++;
      total++;
    }
  }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/** Normalize a badge box's white glyph to a GLYPH_N×GLYPH_N packed bit mask (one int per row). */
function glyphRows(reg: RegionData, box: Box): { rows: number[]; fg: number } {
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  const thr = otsuThreshold(reg, box);
  const rows = new Array<number>(GLYPH_N).fill(0);
  let fg = 0;
  for (let gy = 0; gy < GLYPH_N; gy++) {
    let row = 0;
    for (let gx = 0; gx < GLYPH_N; gx++) {
      const sx = box.x0 + Math.floor(((gx + 0.5) * w) / GLYPH_N);
      const sy = box.y0 + Math.floor(((gy + 0.5) * h) / GLYPH_N);
      const o = (sy * reg.width + sx) * 4;
      if (luminance(reg.data[o], reg.data[o + 1], reg.data[o + 2]) > thr) {
        row |= 1 << gx;
        fg++;
      }
    }
    rows[gy] = row >>> 0;
  }
  return { rows, fg };
}

/** Best IoU of two packed glyph masks over a ±1px shift (tolerates registration jitter). */
function bestIou(a: number[], b: number[]): number {
  let best = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      let inter = 0;
      let uni = 0;
      for (let y = 0; y < GLYPH_N; y++) {
        const ay = a[y];
        const by = y + dy;
        let brow = by >= 0 && by < GLYPH_N ? b[by] : 0;
        // shift b horizontally by dx (positive dx moves b right)
        brow = dx >= 0 ? (brow << dx) >>> 0 : brow >>> -dx;
        brow &= (1 << GLYPH_N) - 1;
        const u = (ay | brow) >>> 0;
        const it = (ay & brow) >>> 0;
        uni += popcount(u);
        inter += popcount(it);
      }
      const s = uni ? inter / uni : 0;
      if (s > best) best = s;
    }
  }
  return best;
}

function popcount(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

interface BadgeMatch {
  name: string;
  kind: 'type' | 'gender';
  score: number;
  margin: number;
}

/** Classify one badge's glyph: argmax IoU over all templates, with the margin to the best
 *  DIFFERENT-name template. `confident` = score ≥ MIN_IOU and margin ≥ MARGIN. */
function matchBadge(rows: number[]): BadgeMatch & { confident: boolean } {
  let best = { name: '', kind: 'type' as 'type' | 'gender', score: -1 };
  for (const t of GLYPH_TEMPLATES) {
    const s = bestIou(rows, t.rows);
    if (s > best.score) best = { name: t.name, kind: t.kind, score: s };
  }
  let second = 0;
  for (const t of GLYPH_TEMPLATES) {
    if (t.name === best.name) continue;
    const s = bestIou(rows, t.rows);
    if (s > second) second = s;
  }
  const margin = best.score - second;
  return { name: best.name, kind: best.kind, score: best.score, margin, confident: best.score >= MIN_IOU && margin >= MARGIN };
}

export interface BadgeGlyph {
  /** GLYPH_N-row packed white-glyph mask (same encoding as GLYPH_TEMPLATES.rows). */
  rows: number[];
  /** Foreground pixel count of the extracted glyph. */
  fg: number;
  /** Badge bounding box in the strip (left-to-right order). */
  box: Box;
}

/**
 * Extract every badge's normalized 24×24 white-glyph mask from a strip, using the EXACT
 * segmentation + Otsu-normalization the reader runs at match time (badgeBand → panelColor →
 * badgeMask → close → components → badgeBoxes → glyphRows). Exposed so offline template-building
 * can mine the MOVE-row type icons (identical rounded-square badge design as the header icons)
 * through the identical pipeline — guaranteeing a move-derived mask is directly comparable to what
 * the reader extracts from a header badge. Not used by readTypeIcons itself (the reader is
 * unchanged); this is a read-only view onto the same primitives.
 */
export function extractBadgeGlyphs(reg: RegionData): BadgeGlyph[] {
  const { width, height } = reg;
  if (width < 8 || height < 8) return [];
  const band = badgeBand(reg);
  if (band.y1 - band.y0 + 1 < height * 0.4) return [];
  const panel = panelColor(reg, band.y0, band.y1);
  const mask = badgeMask(reg, band, panel);
  const closed = close(mask, width, height, 1);
  const boxes = badgeBoxes(components(closed, width, height), height);
  return boxes.map((box) => {
    const { rows, fg } = glyphRows(reg, box);
    return { rows, fg, box };
  });
}

/**
 * Read the 1-2 Pokémon type(s) from a card-header icon strip via deterministic template matching.
 * Returns confident:true ONLY when every detected badge is confidently a gender or a covered type,
 * all badge ink is accounted for, and exactly 1-2 type badges remain — otherwise confident:false so
 * the caller (inferSpecies) skips the exact type-set filter rather than filtering on a wrong set.
 */
export function readTypeIcons(header: RegionData): { types: string[]; confident: boolean } {
  const { width, height } = header;
  if (width < 8 || height < 8) return { types: [], confident: false };

  const band = badgeBand(header);
  if (band.y1 - band.y0 + 1 < height * 0.4) return { types: [], confident: false }; // strip is mostly separator
  const panel = panelColor(header, band.y0, band.y1);
  const mask = badgeMask(header, band, panel);
  const closed = close(mask, width, height, 1);
  const boxes = badgeBoxes(components(closed, width, height), height);

  // Structural guard: a header carries a gender plus 1-2 types, so 1-3 badges. Anything else means
  // the strip didn't segment cleanly (occlusion, a merged/extra blob) → don't trust it.
  if (boxes.length < 1 || boxes.length > 3) return { types: [], confident: false };

  // Coverage guard: every closed-mask (badge) pixel must fall inside a KEPT badge box. A dropped or
  // fragmented badge leaves small components that the shape filter discards; their pixels then sit
  // outside every box and drop the coverage. Reading the surviving badges could yield an INCOMPLETE
  // type set (which the exact-set filter rejects), so abstain when coverage is low. (Measured on the
  // closed mask, not the raw mask, so single-pixel anti-alias fringe doesn't count as "leftover".)
  let inside = 0;
  let totalFg = 0;
  for (let y = band.y0; y <= band.y1; y++) {
    for (let x = 0; x < width; x++) {
      if (!closed[y * width + x]) continue;
      totalFg++;
      const covered = boxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
      if (covered) inside++;
    }
  }
  if (totalFg === 0 || inside / totalFg < 0.85) return { types: [], confident: false };

  // Classify every badge. Confidence requires ALL badges to be confidently identified: an
  // unidentifiable badge (an uncovered type, or a mangled glyph) means the type set is unknown, so
  // reporting the badges we did read could drop a real type → abstain.
  const types: string[] = [];
  let genders = 0;
  for (const box of boxes) {
    const { rows, fg } = glyphRows(header, box);
    if (fg < 6) return { types: [], confident: false }; // essentially no glyph extracted
    const m = matchBadge(rows);
    if (!m.confident) return { types: [], confident: false };
    if (m.kind === 'gender') {
      genders++;
      continue;
    }
    if (!COVERED_TYPES.has(m.name)) return { types: [], confident: false };
    types.push(m.name);
  }

  // A header has at most one gender badge and 1-2 type badges.
  if (genders > 1 || types.length < 1 || types.length > 2) return { types: [], confident: false };
  return { types, confident: true };
}
