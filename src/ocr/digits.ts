import { binarize, detectColumnClusters, RegionData } from './pixels';
import { DIGIT_TEMPLATES, TW, TH } from './digit-templates';

const TEMPLATES: Array<{ d: string; bits: number[] }> = Object.entries(DIGIT_TEMPLATES).map(
  ([d, s]) => ({ d, bits: s.split('').map(Number) })
);

/**
 * Normalize the ink within columns [x0,x1] of a binarized region to a TWxTH 0/1 grid by
 * AREA-averaging: each output cell is set when the majority of the source pixels it covers are
 * ink. Area sampling (rather than nearest-neighbour point sampling) makes the normalized glyph
 * scale-invariant — a thin "1" stroke can't fall between sample points and vanish — so template
 * matching works at any resolution, not just the one the templates were captured at.
 */
function normalizeGlyph(reg: RegionData, x0: number, x1: number): number[] {
  let minY = 1e9, maxY = -1, minX = 1e9, maxX = -1;
  for (let y = 0; y < reg.height; y++)
    for (let x = x0; x <= x1; x++)
      if (reg.data[(y * reg.width + x) * 4] < 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  const out = new Array(TW * TH).fill(0);
  if (maxX < 0) return out;
  const gw = maxX - minX + 1;
  const gh = maxY - minY + 1;
  for (let ty = 0; ty < TH; ty++)
    for (let tx = 0; tx < TW; tx++) {
      const sx0 = minX + Math.floor((tx / TW) * gw);
      const sx1 = Math.max(sx0 + 1, minX + Math.floor(((tx + 1) / TW) * gw));
      const sy0 = minY + Math.floor((ty / TH) * gh);
      const sy1 = Math.max(sy0 + 1, minY + Math.floor(((ty + 1) / TH) * gh));
      let ink = 0;
      let total = 0;
      for (let sy = sy0; sy < sy1 && sy <= maxY; sy++)
        for (let sx = sx0; sx < sx1 && sx <= maxX; sx++) {
          total++;
          if (reg.data[(sy * reg.width + sx) * 4] < 128) ink++;
        }
      out[ty * TW + tx] = total > 0 && ink * 2 >= total ? 1 : 0;
    }
  return out;
}

/** Ink bounding-box aspect (width/height) of the glyph in columns [x0,x1], or 1 if empty. */
function glyphAspect(reg: RegionData, x0: number, x1: number): number {
  let minY = 1e9, maxY = -1, minX = 1e9, maxX = -1;
  for (let y = 0; y < reg.height; y++)
    for (let x = x0; x <= x1; x++)
      if (reg.data[(y * reg.width + x) * 4] < 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0 || maxY < 0) return 1;
  return (maxX - minX + 1) / (maxY - minY + 1);
}

/** Best-matching digit for a normalized glyph, by fraction of agreeing cells. */
export function matchGlyph(glyph: number[]): { digit: string; score: number } {
  let best = { digit: '', score: -1 };
  for (const t of TEMPLATES) {
    let agree = 0;
    for (let i = 0; i < glyph.length; i++) if (glyph[i] === t.bits[i]) agree++;
    const score = agree / glyph.length;
    if (score > best.score) best = { digit: t.d, score };
  }
  return best;
}

export interface ReadNumberResult {
  text: string;
  confident: boolean;
}

/**
 * Read a 1-2 digit number from a region using fixed-font template matching. Segments the ink
 * into per-digit columns and matches each against the digit templates — reliable on the
 * isolated "1" that Tesseract drops, and independent of any stat database.
 *
 * `maxDigits` caps how many segmented glyphs are read; it defaults to 2 because the original
 * (and still most common) caller reads EVs, which are 0-32. Callers reading larger numbers
 * (e.g. final stats, which can be 3 digits) pass a higher value explicitly.
 */
export function readNumber(
  reg: RegionData,
  maxDigits: number = 2,
  opts: { threshold?: number; maxSat?: number; minScore?: number } = {}
): ReadNumberResult {
  const bin = binarize(reg, { threshold: opts.threshold ?? 170, maxSat: opts.maxSat });
  // Split into individual digits: small merge gap so adjacent digits stay separate; a thin "1"
  // is kept via a low min width.
  const glyphs = detectColumnClusters(bin, { mergeGap: 1, minWidthFrac: 0.06, minInkFrac: 0.12 });
  if (!glyphs.length) return { text: '', confident: false };
  const minScore = opts.minScore ?? 0.72;
  let text = '';
  let confident = true;
  for (const g of glyphs.slice(0, maxDigits)) {
    // A glyph far narrower than it is tall can only be a "1" — no round digit (6/9/…) is that
    // thin. Deciding by width first avoids the aspect-normalized "1" (stretched to fill the grid)
    // being confused with a round digit at non-native resolutions.
    if (glyphAspect(bin, g.x0, g.x1) < 0.38) {
      text += '1';
      continue;
    }
    const m = matchGlyph(normalizeGlyph(bin, g.x0, g.x1));
    text += m.digit;
    if (m.score < minScore) confident = false;
  }
  return { text, confident };
}
