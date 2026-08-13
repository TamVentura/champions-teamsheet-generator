import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readTypeIcons, extractBadgeGlyphs } from '../../src/ocr/typeIcons';
import { RegionData } from '../../src/ocr/pixels';
import { GLYPH_N, GLYPH_TEMPLATES } from '../../src/data/type-templates';
import { detectPanels, panelToCardBox } from '../../src/ocr/panels';
import { detectMovesGrid, analyzeMovesCard } from '../../src/ocr/card';
import { within, toPixels } from '../../src/ocr/layout';

// ---------------------------------------------------------------------------
// Deterministic matcher tests. Render a header strip from the committed glyph
// templates — a lavender panel with rounded badges (a coloured square for a type,
// the white glyph drawn from the template bits) — then run the real reader on it.
// This exercises segmentation → glyph extraction → template matching → the safety
// guards end-to-end without any screenshot, so it runs anywhere (including CI).
// ---------------------------------------------------------------------------

const PANEL: [number, number, number] = [115, 98, 177]; // lavender card panel
// Saturated, non-panel badge backgrounds, kept clearly darker than the white glyph so the reader's
// Otsu split lands unambiguously between them (the exact colour is irrelevant to glyph matching).
const TYPE_BG: [number, number, number] = [150, 30, 30];
const GENDER_BG: [number, number, number] = [30, 40, 160]; // ♂-blue-ish circle colour

function templateRows(name: string): number[] {
  const t = GLYPH_TEMPLATES.find((g) => g.name === name);
  if (!t) throw new Error(`no template ${name}`);
  return t.rows;
}

/** Render a header strip: a lavender panel with the given badges packed left-to-right, each a
 *  coloured square carrying its template's white glyph (scaled `S`×). */
function renderStrip(badges: string[], S = 3): RegionData {
  const B = GLYPH_N * S + 2; // badge side (glyph + 1px border each side)
  const margin = 6;
  const gap = 4;
  const height = B + 2 * margin;
  const left = 20;
  const width = left + badges.length * (B + gap) + 20;
  const data = new Uint8ClampedArray(width * height * 4);
  const put = (x: number, y: number, c: [number, number, number]) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const o = (y * width + x) * 4;
    data[o] = c[0];
    data[o + 1] = c[1];
    data[o + 2] = c[2];
    data[o + 3] = 255;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, PANEL);
  let bx = left;
  const by = margin;
  for (const name of badges) {
    const isGender = name === 'M' || name === 'F';
    const bg = isGender ? GENDER_BG : TYPE_BG;
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) put(bx + x, by + y, bg);
    const rows = templateRows(name);
    for (let gy = 0; gy < GLYPH_N; gy++) {
      for (let gx = 0; gx < GLYPH_N; gx++) {
        if (!(rows[gy] & (1 << gx))) continue;
        for (let sy = 0; sy < S; sy++)
          for (let sx = 0; sx < S; sx++) put(bx + 1 + gx * S + sx, by + 1 + gy * S + sy, [255, 255, 255]);
      }
    }
    bx += B + gap;
  }
  return { data, width, height };
}

describe('readTypeIcons (template matcher, rendered strips)', () => {
  it('reads a dual-type header (♂ + Fire + Flying) as exactly [Fire, Flying]', () => {
    const res = readTypeIcons(renderStrip(['M', 'Fire', 'Flying']));
    expect(res.confident).toBe(true);
    expect([...res.types].sort()).toEqual(['Fire', 'Flying']);
  });

  it('reads a single-type header (♀ + Grass) as exactly [Grass]', () => {
    const res = readTypeIcons(renderStrip(['F', 'Grass']));
    expect(res.confident).toBe(true);
    expect(res.types).toEqual(['Grass']);
  });

  it('reads two types even when the gender badge is cropped out (Water + Ghost)', () => {
    const res = readTypeIcons(renderStrip(['Water', 'Ghost']));
    expect(res.confident).toBe(true);
    expect([...res.types].sort()).toEqual(['Ghost', 'Water']);
  });

  it('never reports the gender glyph itself as a type', () => {
    const res = readTypeIcons(renderStrip(['M', 'Fire', 'Flying']));
    expect(res.types).not.toContain('M');
    expect(res.types).not.toContain('F');
  });

  it('is not confident with no type badge (gender only)', () => {
    const res = readTypeIcons(renderStrip(['M']));
    expect(res.confident).toBe(false);
    expect(res.types).toEqual([]);
  });

  it('is not confident on a featureless flat region (no matchable glyph)', () => {
    const ref = renderStrip(['Fire']);
    const flat: RegionData = { data: new Uint8ClampedArray(ref.data.length), width: ref.width, height: ref.height };
    for (let i = 0; i < flat.width * flat.height; i++) {
      flat.data[i * 4] = 128; flat.data[i * 4 + 1] = 128; flat.data[i * 4 + 2] = 128; flat.data[i * 4 + 3] = 255;
    }
    expect(readTypeIcons(flat).confident).toBe(false);
  });

  it('is deterministic: identical input yields identical output', () => {
    const a = readTypeIcons(renderStrip(['M', 'Fire', 'Flying']));
    const b = readTypeIcons(renderStrip(['M', 'Fire', 'Flying']));
    expect(a).toEqual(b);
  });

  // The move-icon-derived templates must round-trip through the reader like the header-derived ones.
  it('reads the move-derived Psychic template as [Psychic]', () => {
    const res = readTypeIcons(renderStrip(['F', 'Psychic']));
    expect(res.confident).toBe(true);
    expect(res.types).toEqual(['Psychic']);
  });

  it('reads the move-derived Ice template as [Ice]', () => {
    const res = readTypeIcons(renderStrip(['M', 'Ice']));
    expect(res.confident).toBe(true);
    expect(res.types).toEqual(['Ice']);
  });
});

// ---------------------------------------------------------------------------
// Real-image regression on sample/zard-moves.png, run through the ACTUAL extraction
// crop path. Proves: (1) all six cards are located; (2) Ancalagon reads EXACTLY
// [Fire, Flying]; (3) Teeths reads its two types; (4) no card ever reads a gender
// symbol as a type; (5) every confident read is the card's true, complete type set.
// The sample is gitignored (private) — on a checkout without it (e.g. CI) this whole
// describe block is skipIf'd out (not run, not failed) so the suite stays green; in
// this working copy, where the file exists, it actually runs and asserts.
// ---------------------------------------------------------------------------
const SAMPLE = resolve(__dirname, '../../sample/zard-moves.png');
const HAS_SAMPLE = existsSync(SAMPLE);
const ICON_ZONE_W = 0.19; // same icon-zone geometry as src/ocr/extract.ts readCard

// Ground truth for sample/zard-moves.png (slot order, row-major).
const CARDS: Array<{ name: string; gender: 'M' | 'F'; truth: string[] }> = [
  { name: 'Ancalagon', gender: 'M', truth: ['Fire', 'Flying'] },
  { name: 'Teeths', gender: 'F', truth: ['Dragon', 'Ground'] },
  { name: 'Goldblina', gender: 'F', truth: ['Dark', 'Ghost'] },
  { name: 'Whimsicott', gender: 'F', truth: ['Grass', 'Fairy'] },
  { name: 'Peixe', gender: 'M', truth: ['Water', 'Ghost'] },
  { name: 'Archaludon', gender: 'M', truth: ['Steel', 'Dragon'] },
];

// Best IoU (±1px shift) of a glyph mask against a committed template — same metric the reader uses.
function popcount(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function bestIou(a: number[], b: number[]): number {
  let best = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      let inter = 0, uni = 0;
      for (let y = 0; y < GLYPH_N; y++) {
        const ay = a[y];
        const by = y + dy;
        let brow = by >= 0 && by < GLYPH_N ? b[by] : 0;
        brow = dx >= 0 ? (brow << dx) >>> 0 : brow >>> -dx;
        brow &= (1 << GLYPH_N) - 1;
        uni += popcount((ay | brow) >>> 0);
        inter += popcount((ay & brow) >>> 0);
      }
      const s = uni ? inter / uni : 0;
      if (s > best) best = s;
    }
  return best;
}
function bestTemplateName(rows: number[]): string {
  let best = { name: '', score: -1 };
  for (const t of GLYPH_TEMPLATES) {
    const s = bestIou(rows, t.rows);
    if (s > best.score) best = { name: t.name, score: s };
  }
  return best.name;
}

describe.skipIf(!HAS_SAMPLE)('readTypeIcons (real image — sample/zard-moves.png)', () => {
  let reads: Array<{ types: string[]; confident: boolean }> | null = null;
  // MOVE-row icons extracted through the reader's own segmentation, then classified against the
  // committed templates — proving move-row icons are the SAME glyph the reader matches from headers.
  // Tailwind (Flying) exercises a HEADER-derived template; Reflect (Psychic) exercises a MOVE-derived
  // one. (Individual Fire move icons like Heat Wave are too small/blurred to classify on their own —
  // only the aggregate medoid is reliable — so a clean, high-ink example of each is used here.)
  let moveFlyingName: string | null = null; // Whimsicott's Tailwind, slot 3 move 3
  let movePsychicName: string | null = null; // Goldblina's Reflect, slot 2 move 3

  beforeAll(async () => {
    let loadImage: (src: Buffer) => Promise<{ width: number; height: number }>;
    let createCanvas: (w: number, h: number) => any;
    try {
      ({ loadImage, createCanvas } = await import('@napi-rs/canvas'));
    } catch {
      console.warn('[typeIcons] @napi-rs/canvas unavailable — skipping real-image regression.');
      return;
    }
    const img = await loadImage(readFileSync(SAMPLE));
    const W = img.width;
    const H = img.height;
    const cv = createCanvas(W, H);
    const ctx = cv.getContext('2d');
    ctx.drawImage(img as unknown as CanvasImageSource, 0, 0);
    const full = ctx.getImageData(0, 0, W, H).data as Uint8ClampedArray;
    const pixels = (frac: { x: number; y: number; w: number; h: number }): RegionData => {
      const p = toPixels(frac, W, H);
      const x0 = Math.max(0, Math.min(W - 1, p.x));
      const y0 = Math.max(0, Math.min(H - 1, p.y));
      const w = Math.max(1, Math.min(W - x0, p.w));
      const h = Math.max(1, Math.min(H - y0, p.h));
      const out = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const s = ((y0 + y) * W + (x0 + x)) * 4;
          const d = (y * w + x) * 4;
          out[d] = full[s]; out[d + 1] = full[s + 1]; out[d + 2] = full[s + 2]; out[d + 3] = 255;
        }
      }
      return { data: out, width: w, height: h };
    };

    const panels = detectPanels(pixels({ x: 0, y: 0, w: 1, h: 1 }));
    if (panels.length !== 6) return;
    const cardBoxes = panels.map(panelToCardBox);
    const cardRegs = cardBoxes.map((c) => pixels(c));
    const grid = detectMovesGrid(cardRegs);
    reads = cardBoxes.map((card, slot) => {
      const mv = analyzeMovesCard(cardRegs[slot], grid);
      const strip = {
        x: Math.max(0, grid.gap - ICON_ZONE_W),
        y: mv.name.y,
        w: Math.min(grid.gap, ICON_ZONE_W),
        h: mv.name.h,
      };
      return readTypeIcons(pixels(within(card, strip)));
    });

    // Classify a move-row icon: crop the icon zone (column gap → move-text left edge) and match the
    // dominant extracted glyph against the committed templates.
    const moveIconName = (slot: number, moveIdx: number): string | null => {
      const mvc = analyzeMovesCard(cardRegs[slot], grid);
      const m = mvc.moves[moveIdx];
      const zoneW = m.x - grid.gap;
      const iconZone = { x: grid.gap, y: m.y, w: zoneW * 1.2, h: m.h };
      const glyphs = extractBadgeGlyphs(pixels(within(cardBoxes[slot], iconZone)));
      let dom: { rows: number[]; box: { x0: number; y0: number; x1: number; y1: number } } | null = null;
      for (const g of glyphs) {
        const area = (g.box.x1 - g.box.x0 + 1) * (g.box.y1 - g.box.y0 + 1);
        if (!dom || area > (dom.box.x1 - dom.box.x0 + 1) * (dom.box.y1 - dom.box.y0 + 1)) dom = g;
      }
      return dom ? bestTemplateName(dom.rows) : null;
    };
    moveFlyingName = moveIconName(3, 2);
    movePsychicName = moveIconName(2, 2);
  });

  it('a Flying MOVE-row icon matches the header-derived Flying template', () => {
    // The two icon sources (header badges, move-row badges) are the same glyph, so move-mined
    // templates are valid for reading headers.
    expect(moveFlyingName, 'Tailwind (Flying move) icon should classify as Flying').toBe('Flying');
  });

  it('a Psychic MOVE-row icon matches the move-derived Psychic template', () => {
    // Closes the loop: a move icon of a newly-covered type is read by the template mined from move
    // icons of that same type.
    expect(movePsychicName, 'Reflect (Psychic move) icon should classify as Psychic').toBe('Psychic');
  });

  it('locates all six cards from the sample', () => {
    expect(reads, 'sample/zard-moves.png + @napi-rs/canvas must be available for this regression').not.toBeNull();
    expect(reads!.length).toBe(6);
  });

  it('reads Ancalagon as EXACTLY [Fire, Flying] (confident)', () => {
    const res = reads![0];
    expect(res.confident).toBe(true);
    expect([...res.types].sort()).toEqual(['Fire', 'Flying']);
  });

  it('reads Teeths as its two types [Dragon, Ground] (confident)', () => {
    const res = reads![1];
    expect(res.confident).toBe(true);
    expect([...res.types].sort()).toEqual(['Dragon', 'Ground']);
  });

  it('never reads the gender glyph as a type (no gender token, never a 3rd type)', () => {
    // The gender circle (blue ♂ ~ Water; red/pink ♀ ~ Fire/Fighting/Psychic/Fairy) must never be
    // classified into the type set: a spurious gender-type would appear as a 3rd type or a wrong
    // one. Both are excluded by (a) no 'M'/'F' token and (b) at most two types per card.
    for (let slot = 0; slot < CARDS.length; slot++) {
      const res = reads![slot];
      expect(res.types).not.toContain('M');
      expect(res.types).not.toContain('F');
      expect(res.types.length).toBeLessThanOrEqual(2);
    }
  });

  it('every confident read is the card\'s true, complete type set (never wrong/partial)', () => {
    for (let slot = 0; slot < CARDS.length; slot++) {
      const card = CARDS[slot];
      const res = reads![slot];
      if (res.confident) {
        expect([...res.types].sort(), `${card.name}: confident read must equal the true type set`).toEqual(
          [...card.truth].sort(),
        );
      }
    }
  });
});
