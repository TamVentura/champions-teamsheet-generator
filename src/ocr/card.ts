// Content-adaptive parsing of the six Pokémon cards. NO fixed field-position fractions: every
// field is located from the ink itself, so the same code works at any resolution/aspect ratio.
// The only geometric input is the six card boxes (from the colour-based panel detector).
//
// A card is a two-column layout: on the Stats screen the left column carries HP/Attack/Defense
// and the right Sp.Atk/Sp.Def/Speed; on the Moves screen the left column carries the species
// name, ability and item, and the right the four moves. The two columns are separated by a
// vertical low-ink corridor, and the rows are found from the horizontal text bands.
//
// Robustness comes from aggregating the six cards: they share one layout, so the column divide
// and the row positions are estimated per card and then reduced with a median. A single card
// whose ink happens to be ambiguous can't move the shared grid.

import { EvSpread, STAT_KEYS, StatKey } from '../domain/types';
import { natureFromArrows } from '../domain/champions';
import { Rect } from './layout';
import {
  arrowScores,
  binarize,
  detectColumnClusters,
  detectTextBands,
  RegionData,
  saturation,
  stripHorizontalLines,
} from './pixels';
import { readNumber } from './digits';

// ----------------------------------------------------------------------------
// Low-level pixel helpers
// ----------------------------------------------------------------------------

/** Crop a sub-rectangle (pixel coords) out of a RegionData. */
function slice(reg: RegionData, x0: number, y0: number, x1: number, y1: number): RegionData {
  x0 = Math.max(0, Math.min(reg.width - 1, x0));
  x1 = Math.max(0, Math.min(reg.width - 1, x1));
  y0 = Math.max(0, Math.min(reg.height - 1, y0));
  y1 = Math.max(0, Math.min(reg.height - 1, y1));
  const w = Math.max(1, x1 - x0 + 1);
  const h = Math.max(1, y1 - y0 + 1);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * reg.width + (x0 + x)) * 4;
      const d = (y * w + x) * 4;
      out[d] = reg.data[s];
      out[d + 1] = reg.data[s + 1];
      out[d + 2] = reg.data[s + 2];
      out[d + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Whiten near-full-height vertical ink runs. The card's bright rounded border (and any vertical
 * separator) survives binarization as a column of ink that spans almost the whole card height,
 * whereas a glyph only spans a single row — so a tall column is a border, not text. Removing it
 * stops the border being mistaken for the right-most (EV) cluster of a cell.
 */
function stripVerticalLines(bin: RegionData, minFrac = 0.6): RegionData {
  const { data, width, height } = bin;
  const out = new Uint8ClampedArray(data);
  const th = Math.floor(height * minFrac);
  for (let x = 0; x < width; x++) {
    let c = 0;
    for (let y = 0; y < height; y++) if (data[(y * width + x) * 4] < 128) c++;
    if (c >= th) for (let y = 0; y < height; y++) { const o = (y * width + x) * 4; out[o] = out[o + 1] = out[o + 2] = 255; }
  }
  return { data: out, width, height };
}

/** Binarize + strip separator lines and borders, at a given luminance threshold. */
function prepAt(reg: RegionData, threshold: number): RegionData {
  return stripVerticalLines(stripHorizontalLines(binarize(reg, { threshold })));
}

/**
 * Stats prep uses a high threshold: the stat/EV digits are bright near-white, while the faint
 * slot watermark and separators are dimmer, so a high threshold drops the watermark while keeping
 * the digits. The Moves screen mixes bright names/moves with lighter grey ability/item text and
 * uses the lower MOVES_THRESHOLD so the light text survives.
 */
function prep(reg: RegionData): RegionData {
  return prepAt(reg, 200);
}

const MOVES_THRESHOLD = 150;

/**
 * Right edge (in `reg` x) of a leading colour icon within a field band, else x0. Type and item
 * icons are strongly-saturated colour squares (the purple panel is only mildly saturated), so the
 * icon is the left-most run of high-saturation columns and the text starts just past it. Fields
 * with no icon (the ability) return x0 unchanged.
 */
function iconTextStart(reg: RegionData, x0: number, x1: number, y0: number, y1: number): number {
  const searchTo = x0 + Math.round((x1 - x0) * 0.4);
  const rowThresh = Math.max(3, Math.round((y1 - y0 + 1) * 0.3));
  let iconRight = -1;
  for (let x = x0; x <= searchTo; x++) {
    let sat = 0;
    for (let y = y0; y <= y1; y++) {
      const o = (y * reg.width + x) * 4;
      if (saturation(reg.data[o], reg.data[o + 1], reg.data[o + 2]) > 0.5) sat++;
    }
    if (sat >= rowThresh) iconRight = x;
    else if (iconRight >= 0 && x > iconRight + 4) break; // the icon run has ended
  }
  return iconRight < 0 ? x0 : Math.min(x1, iconRight + Math.max(2, Math.round((y1 - y0) * 0.15)));
}

/** Per-column ink counts (black pixels) of an already-binarized region. */
function colInk(bin: RegionData): number[] {
  const { data, width, height } = bin;
  const p = new Array(width).fill(0);
  for (let x = 0; x < width; x++) {
    let c = 0;
    for (let y = 0; y < height; y++) if (data[(y * width + x) * 4] < 128) c++;
    p[x] = c;
  }
  return p;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Locate the vertical corridor between the two on-screen columns, as a fraction of card width.
 * The corridor is the widest run of near-empty columns in the right-of-centre window where the
 * divide sits (the card box is not column-symmetric — the left column is wider). Searching that
 * window avoids the wider intra-column label↔value gaps that sit further left.
 */
export function columnGap(bin: RegionData, lo = 0.45, hi = 0.68): number {
  const p = colInk(bin);
  const { width } = bin;
  const x0 = Math.floor(lo * width);
  const x1 = Math.min(width - 1, Math.ceil(hi * width));
  let mn = Infinity;
  for (let x = x0; x <= x1; x++) mn = Math.min(mn, p[x]);
  const th = mn + Math.max(1, Math.floor(bin.height * 0.03));
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  for (let x = x0; x <= x1 + 1; x++) {
    const low = x <= x1 && p[x] <= th;
    if (low) {
      if (curStart < 0) curStart = x;
    } else if (curStart >= 0) {
      if (x - curStart > bestLen) {
        bestLen = x - curStart;
        bestStart = curStart;
      }
      curStart = -1;
    }
  }
  if (bestStart < 0) return 0.575;
  return (bestStart + bestLen / 2) / width;
}

/** Horizontal text bands of the left column [0, gap]. */
function leftBands(bin: RegionData, gapFrac: number): Array<{ y0: number; y1: number }> {
  const gpx = Math.round(gapFrac * bin.width);
  const left = slice(bin, 0, 0, gpx, bin.height - 1);
  return detectTextBands(left, {
    minInkFrac: 0.03,
    mergeGap: Math.max(2, Math.floor(left.height * 0.015)),
    minHeightFrac: 0.05,
  });
}

/** Horizontal text bands of the right column [gap, W]. */
function rightBands(bin: RegionData, gapFrac: number): Array<{ y0: number; y1: number }> {
  const gpx = Math.round(gapFrac * bin.width);
  const right = slice(bin, gpx, 0, bin.width - 1, bin.height - 1);
  return detectTextBands(right, {
    minInkFrac: 0.03,
    mergeGap: Math.max(2, Math.floor(right.height * 0.015)),
    minHeightFrac: 0.05,
  });
}

/** Vertical extent (number of rows containing any ink) within columns [x0,x1] of a binarized region. */
function vExtent(bin: RegionData, x0: number, x1: number): number {
  let count = 0;
  for (let y = 0; y < bin.height; y++) {
    let ink = false;
    for (let x = x0; x <= x1; x++) if (bin.data[(y * bin.width + x) * 4] < 128) { ink = true; break; }
    if (ink) count++;
  }
  return count;
}

/** Bounding x-range (inclusive) of columns with meaningful ink, else null. */
function inkExtentX(bin: RegionData): { x0: number; x1: number } | null {
  const p = colInk(bin);
  const t = Math.max(1, Math.floor(bin.height * 0.04));
  let x0 = -1;
  let x1 = -1;
  for (let x = 0; x < bin.width; x++) {
    if (p[x] > t) {
      if (x0 < 0) x0 = x;
      x1 = x;
    }
  }
  return x0 < 0 ? null : { x0, x1 };
}

const toFrac = (reg: RegionData, x0: number, y0: number, x1: number, y1: number): Rect => ({
  x: x0 / reg.width,
  y: y0 / reg.height,
  w: (x1 - x0 + 1) / reg.width,
  h: (y1 - y0 + 1) / reg.height,
});

interface Band {
  y0: number;
  y1: number;
}
const medianBand = (bs: Band[]): Band => ({ y0: median(bs.map((b) => b.y0)), y1: median(bs.map((b) => b.y1)) });

// ----------------------------------------------------------------------------
// Stats screen
// ----------------------------------------------------------------------------

export interface StatsGrid {
  gap: number; // fraction of card width — shared (the column divide is identical across cards)
  evLeft: [number, number]; // left-edge x of the EV number per column, card fractions — shared
}

/** Header + 3 stat-row bands (pixel y) of one Stats card: the last three left-column text bands
 *  are the rows, the one above them the header (name). Falls back to an equal body split. */
function statsRowsOf(bin: RegionData, gap: number): { header: Band; rows: Band[] } {
  const lb = leftBands(bin, gap);
  if (lb.length >= 4) return { header: lb[lb.length - 4], rows: lb.slice(-3) };
  const top = Math.round(bin.height * 0.4);
  const h = (bin.height - 1 - top) / 3;
  return {
    header: { y0: Math.round(bin.height * 0.2), y1: Math.round(bin.height * 0.36) },
    rows: [0, 1, 2].map((j) => ({ y0: Math.round(top + j * h), y1: Math.round(top + (j + 1) * h) - 1 })),
  };
}

/**
 * Estimate the shared Stats-card x-anchors from all six cards: the column divide and the EV
 * number's left edge per column. These x-positions are identical across cards, so a median over
 * the six is rock-solid. Row (y) positions drift slightly per card and are detected per card in
 * analyzeStatsCard instead.
 */
export function detectStatsGrid(cards: RegionData[]): StatsGrid {
  const bins = cards.map(prep);
  const roughGap = median(bins.map((b) => columnGap(b)));
  const bodyGaps: number[] = [];
  for (const bin of bins) {
    const { rows } = statsRowsOf(bin, roughGap);
    // Accurate divide from the body only: the header's colour icons (kept by binarize when
    // bright) otherwise fill the true inter-column corridor and push the estimate rightwards.
    bodyGaps.push(columnGap(slice(bin, 0, rows[0].y0, bin.width - 1, rows[rows.length - 1].y1)));
  }
  const gap = bodyGaps.length ? median(bodyGaps) : roughGap;

  // EV left-edge anchors (card fractions), from each card's own rows.
  const acc: [number[], number[]] = [[], []];
  for (const bin of bins) {
    const W = bin.width;
    const gpx = Math.round(gap * W);
    const { rows } = statsRowsOf(bin, gap);
    [{ x0: 0, x1: gpx }, { x0: gpx, x1: W - 1 }].forEach((col, ci) => {
      for (const rf of rows) {
        const cell = slice(bin, col.x0, rf.y0, col.x1, rf.y1);
        const cl = detectColumnClusters(cell, { minWidthFrac: 0.008, minInkFrac: 0.06, mergeGap: Math.max(3, Math.floor((rf.y1 - rf.y0 + 1) * 0.4)) })
          .filter((c) => vExtent(cell, c.x0, c.x1) >= cell.height * 0.45);
        if (cl.length >= 2) acc[ci].push((col.x0 + cl[cl.length - 1].x0) / W);
      }
    });
  }
  return { gap, evLeft: [acc[0].length ? median(acc[0]) : 0.43, acc[1].length ? median(acc[1]) : 0.9] };
}

export interface StatsResult {
  name: Rect; // card-relative, for OCR by the caller
  evs: EvSpread;
  evConfident: boolean[]; // STAT_KEYS order
  finalStats: Record<StatKey, number | null>; // the six big on-screen stat numbers
  evDigits: Record<StatKey, number | null>; // the six small EV numbers (null when unread)
  nature: string;
  debug?: Record<string, Rect | Rect[]>;
}

// Left column rows map to hp,atk,def; right column rows map to spa,spd,spe.
const LEFT_KEYS: StatKey[] = ['hp', 'atk', 'def'];
const RIGHT_KEYS: StatKey[] = ['spa', 'spd', 'spe'];

export function analyzeStatsCard(reg: RegionData, grid: StatsGrid): StatsResult {
  const bin = prep(reg);
  const W = reg.width;
  const H = reg.height;
  const gpx = Math.round(grid.gap * W);
  // Rows drift slightly between cards, so detect this card's own header + 3 rows.
  const { header, rows } = statsRowsOf(bin, grid.gap);
  const debug: Record<string, Rect | Rect[]> = {};

  // Name: header band, left of the gap; bound the actual white-text ink.
  const headerLeft = slice(bin, 0, header.y0, gpx, header.y1);
  const ext = inkExtentX(headerLeft);
  const nx0 = ext ? ext.x0 : Math.round(W * 0.1);
  const nx1 = ext ? ext.x1 : gpx;
  const nameRect = toFrac(reg, Math.max(0, nx0 - 4), header.y0, Math.min(gpx, nx1 + 4), header.y1);
  debug.name = nameRect;

  const evs: EvSpread = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const finalStats: Record<StatKey, number | null> = { hp: null, atk: null, def: null, spa: null, spd: null, spe: null };
  const evDigits: Record<StatKey, number | null> = { hp: null, atk: null, def: null, spa: null, spd: null, spe: null };
  const confByKey: Record<string, boolean> = {};
  const evDebug: Rect[] = [];
  const arrowScoresList: Array<{ key: StatKey; red: number; blue: number }> = [];

  const cols: Array<{ x0: number; x1: number; keys: StatKey[]; evLeft: number }> = [
    { x0: 0, x1: gpx, keys: LEFT_KEYS, evLeft: grid.evLeft[0] * W },
    { x0: gpx, x1: W - 1, keys: RIGHT_KEYS, evLeft: grid.evLeft[1] * W },
  ];

  for (const col of cols) {
    for (let r = 0; r < 3; r++) {
      const key = col.keys[r];
      const row = rows[r];
      const rowH = row.y1 - row.y0 + 1;
      const cellBin = slice(bin, col.x0, row.y0, col.x1, row.y1);
      const clusters = detectColumnClusters(cellBin, {
        minWidthFrac: 0.008,
        minInkFrac: 0.06,
        mergeGap: Math.max(3, Math.floor(rowH * 0.4)),
      })
        // Keep only clusters whose ink spans a good part of the row height: real digits/letters
        // are full-height, whereas a faint slot-watermark remnant only clips a row partially.
        .filter((c) => vExtent(cellBin, c.x0, c.x1) >= cellBin.height * 0.45);

      // Pick the EV as the cluster whose right edge is nearest the shared per-column anchor. This
      // is robust to a stray watermark cluster (further right) or the label (further left) that a
      // plain "rightmost" rule would misfire on.
      let evRect: Rect | null = null;
      // Right bound of the nature-arrow search: left of the value number. The arrow sits between
      // the label and the value; the value/bar/EV must be excluded because the orange bar reads
      // as "red" and would masquerade as a boost arrow on any high-EV stat.
      let arrowRight = col.x0 + Math.round((col.x1 - col.x0) * 0.4);
      if (clusters.length) {
        let ev = clusters[0];
        let best = Infinity;
        for (const c of clusters) {
          const d = Math.abs(col.x0 + c.x0 - col.evLeft);
          if (d < best) {
            best = d;
            ev = c;
          }
        }
        // Value = the nearest cluster to the left of the EV.
        let valCluster: { x0: number; x1: number } | null = null;
        for (const c of clusters) if (c.x1 < ev.x0 && (!valCluster || c.x1 > valCluster.x1)) valCluster = c;
        if (valCluster) arrowRight = col.x0 + valCluster.x0;
        const evX0 = col.x0 + ev.x0;
        const evX1 = col.x0 + ev.x1;
        // Read the raw pixels around the EV at the template threshold. `bin` already proved the
        // watermark is gone here (anchor selection avoids it), so a plain crop reads cleanly.
        const pad = Math.max(3, Math.round(rowH * 0.3));
        const evReg = slice(reg, evX0 - 4, Math.max(0, row.y0 - pad), evX1 + 4, Math.min(H - 1, row.y1 + pad));
        const read = readNumber(evReg);
        let value: number | null = read.text ? Number(read.text) : null;
        const confident = !!read.text && read.confident && value != null && value >= 0 && value <= 32;
        if (value == null || value < 0 || value > 32) value = 0;
        evs[key] = value;
        confByKey[key] = confident;
        evDigits[key] = confident ? value : null;
        if (valCluster) {
          const vX0 = col.x0 + valCluster.x0;
          const vX1 = col.x0 + valCluster.x1;
          const vReg = slice(reg, vX0 - 4, Math.max(0, row.y0 - pad), vX1 + 4, Math.min(H - 1, row.y1 + pad));
          const vRead = readNumber(vReg, 3);
          const vNum = vRead.text ? Number(vRead.text) : NaN;
          finalStats[key] = Number.isFinite(vNum) && vNum > 0 ? vNum : null;
        }
        evRect = toFrac(reg, evX0 - 4, Math.max(0, row.y0 - pad), evX1 + 4, Math.min(H - 1, row.y1 + pad));
      } else {
        evs[key] = 0;
        confByKey[key] = false;
      }
      evDebug.push(evRect ?? toFrac(reg, col.x1 - 10, row.y0, col.x1, row.y1));

      if (key !== 'hp') {
        const s = arrowScores(slice(reg, col.x0, row.y0, Math.max(col.x0 + 1, arrowRight), row.y1));
        arrowScoresList.push({ key, red: s.red, blue: s.blue });
      }
    }
  }

  // Nature via global argmax over the five non-HP cells (boost = most red, hinder = most blue).
  const cellArea = W * 0.4 * ((rows[0].y1 - rows[0].y0 + 1) || H * 0.1);
  const minArrow = Math.max(10, Math.floor(cellArea * 0.0008));
  const topRed = [...arrowScoresList].sort((a, b) => b.red - a.red)[0];
  const topBlue = [...arrowScoresList].sort((a, b) => b.blue - a.blue)[0];
  const up = topRed && topRed.red >= minArrow ? topRed.key : null;
  const down = topBlue && topBlue.blue >= minArrow ? topBlue.key : null;
  const nature = natureFromArrows(up, down);

  debug.ev = evDebug;
  return {
    name: nameRect,
    evs,
    evConfident: STAT_KEYS.map((k) => confByKey[k] ?? false),
    finalStats,
    evDigits,
    nature,
    debug,
  };
}

// ----------------------------------------------------------------------------
// Moves screen
// ----------------------------------------------------------------------------

export interface MovesGrid {
  gap: number;
  header: Band;
  ability: Band;
  item: Band | null;
  moves: Band[]; // 4
}

export function detectMovesGrid(cards: RegionData[]): MovesGrid {
  const bins = cards.map((c) => prepAt(c, MOVES_THRESHOLD));
  const gap = median(bins.map((b) => columnGap(b)));
  const headers: Band[] = [];
  const abilities: Band[] = [];
  const items: Band[] = [];
  const moveTops: number[] = [];
  const moveBots: number[] = [];
  for (const bin of bins) {
    const lb = leftBands(bin, gap);
    const rb = rightBands(bin, gap);
    if (lb.length < 3 || !rb.length) continue;
    const item = lb[lb.length - 1];
    const ability = lb[lb.length - 2];
    const header = lb[lb.length - 3];
    headers.push({ y0: header.y0 / bin.height, y1: header.y1 / bin.height });
    abilities.push({ y0: ability.y0 / bin.height, y1: ability.y1 / bin.height });
    items.push({ y0: item.y0 / bin.height, y1: item.y1 / bin.height });
    // The four moves span from the header top to the bottom-most right-column ink.
    moveTops.push(header.y0 / bin.height);
    moveBots.push(rb[rb.length - 1].y1 / bin.height);
  }
  if (!headers.length) {
    return {
      gap,
      header: { y0: 0.15, y1: 0.34 },
      ability: { y0: 0.4, y1: 0.55 },
      item: { y0: 0.6, y1: 0.78 },
      moves: [0, 1, 2, 3].map((j) => ({ y0: 0.17 + j * 0.205, y1: 0.3 + j * 0.205 })),
    };
  }
  const top = median(moveTops);
  const bot = median(moveBots);
  const h = (bot - top) / 4;
  const moves: Band[] = [0, 1, 2, 3].map((j) => ({ y0: top + j * h, y1: top + (j + 1) * h }));
  return {
    gap,
    header: medianBand(headers),
    ability: medianBand(abilities),
    item: medianBand(items),
    moves,
  };
}

export interface MovesResult {
  name: Rect;
  ability: Rect;
  item: Rect | null;
  moves: Rect[];
  debug?: Record<string, Rect | Rect[]>;
}

export function analyzeMovesCard(reg: RegionData, grid: MovesGrid): MovesResult {
  const bin = prepAt(reg, MOVES_THRESHOLD);
  const W = reg.width;
  const H = reg.height;
  const gpx = Math.round(grid.gap * W);
  const px = (b: Band) => ({ y0: Math.round(b.y0 * H), y1: Math.round(b.y1 * H) });
  const debug: Record<string, Rect | Rect[]> = {};

  // Bound a field to its text ink within [x0,x1]×band, first skipping any leading icon so its
  // inner symbol isn't prepended to the text, then trimming the card border. `minSkip` forces a
  // geometric skip past the leading icon even when it's low-saturation (grey Rock/Steel, black
  // Dark, purple Ghost move-type icons the colour test misses); the move icon is a fixed-size
  // square ~1.2× the line height. Fields without a leading icon (the ability) pass minSkip 0.
  const bound = (x0: number, x1: number, b: { y0: number; y1: number }, minSkip = 0): Rect => {
    const start = Math.min(x1, Math.max(iconTextStart(reg, x0, x1, b.y0, b.y1), x0 + minSkip));
    const ext = inkExtentX(slice(bin, start, b.y0, x1, b.y1));
    const tx0 = ext ? start + ext.x0 : start;
    const tx1 = ext ? start + ext.x1 : x1;
    return toFrac(reg, Math.max(0, tx0 - 3), b.y0, Math.min(W - 1, tx1 + 4), b.y1);
  };

  const iconSkip = (b: { y0: number; y1: number }) => Math.round((b.y1 - b.y0 + 1) * 1.2);
  // The header band is measured from the name's bright-pixel extent, which clips glyph descenders
  // (the tail of a "j"/"g"/"y") at the bottom and the odd tall accent at the top. OCR reads a
  // clipped glyph with low confidence, flagging an otherwise-correct species. Pad the band by a
  // fraction of its own height — proportional, so it scales with resolution — with more room below
  // (descenders) than above. Clamped to the card so it never reaches the row beneath.
  const padBand = (b: { y0: number; y1: number }, up: number, down: number) => {
    const h = b.y1 - b.y0;
    return { y0: Math.max(0, Math.round(b.y0 - h * up)), y1: Math.min(H - 1, Math.round(b.y1 + h * down)) };
  };
  const nameRect = bound(0, gpx, padBand(px(grid.header), 0.15, 0.35));
  const abilityRect = bound(0, gpx, px(grid.ability));
  const itemRect = grid.item ? bound(0, gpx, px(grid.item), iconSkip(px(grid.item))) : null;
  const moves: Rect[] = grid.moves.map((m) => bound(gpx, W - 1, px(m), iconSkip(px(m))));
  debug.name = nameRect;
  debug.ability = abilityRect;
  if (itemRect) debug.item = itemRect;
  debug.moves = moves;

  return { name: nameRect, ability: abilityRect, item: itemRect, moves, debug };
}
