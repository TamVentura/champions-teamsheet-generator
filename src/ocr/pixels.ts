// Pure pixel helpers — operate on raw RGBA arrays so they unit-test without a canvas.

export interface RegionData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Orange EV-bar pixel (warm, saturated). */
export function isOrange(r: number, g: number, b: number): boolean {
  return r > 170 && g > 70 && g < 190 && b < 110 && r - b > 90 && r >= g;
}

// The nature "boost" arrow is a warm pink-red (red channel dominant); the "hinder" arrow is a
// cyan-blue (blue dominant, green >= red). The panel background is a muted purple (blue high
// but red > green), so we key off which channel dominates rather than absolute thresholds.

/** Red nature "boost" arrow pixel. */
export function isRed(r: number, g: number, b: number): boolean {
  return r > 150 && r - b > 30 && r - g > 25;
}

/** Blue/cyan nature "hinder" arrow pixel. The panel purple has red > green, so require the
 *  opposite (green clearly above red) to reject the bluish-purple gradient. */
export function isBlue(r: number, g: number, b: number): boolean {
  return b > 150 && b - r > 30 && g - r > 12;
}

/** Count red ("up") and blue ("down") arrow pixels in a region. */
export function arrowScores(region: RegionData): { red: number; blue: number } {
  const { data, width, height } = region;
  let red = 0;
  let blue = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (isRed(r, g, b)) red++;
    else if (isBlue(r, g, b)) blue++;
  }
  return { red, blue };
}

/**
 * Fraction of the width covered by the orange bar, measured as the longest
 * left-anchored run of columns that contain orange pixels.
 */
export function orangeFraction(region: RegionData): number {
  const { data, width, height } = region;
  let filledCols = 0;
  for (let x = 0; x < width; x++) {
    let hit = false;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      if (isOrange(data[i], data[i + 1], data[i + 2])) {
        hit = true;
        break;
      }
    }
    if (hit) filledCols++;
    else if (filledCols > 0 && x > filledCols + 3) break; // stop after the run ends
  }
  return width ? filledCols / width : 0;
}

/** Classify a nature-arrow region as boosted ('up'), hindered ('down') or neither. */
export function classifyArrow(region: RegionData): 'up' | 'down' | null {
  const { data, width, height } = region;
  let red = 0;
  let blue = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (isRed(r, g, b)) red++;
    else if (isBlue(r, g, b)) blue++;
  }
  const min = Math.max(6, width * height * 0.02);
  if (red < min && blue < min) return null;
  return red >= blue ? 'up' : 'down';
}

/**
 * Erase near-full-width horizontal lines from an already-binarized region (black text on
 * white). The Champions UI draws thin separator lines between rows that survive binarization
 * and confuse block OCR; a row that is mostly black is such a separator, not glyphs.
 */
export function stripHorizontalLines(region: RegionData, minBlack = 0.2): RegionData {
  const { data, width, height } = region;
  const rowBlack: number[] = [];
  for (let y = 0; y < height; y++) {
    let c = 0;
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4] < 128) c++;
    rowBlack[y] = c / width;
  }
  const out = new Uint8ClampedArray(data);
  const gap = 3;
  for (let y = 0; y < height; y++) {
    if (rowBlack[y] < minBlack) continue;
    // Whiten a row if it is a solid bar (very high coverage — glyph rows rarely fill 80% of
    // the width), or a thin isolated inky row (a separator/dashed line: mostly-white a few
    // rows above AND below). Glyph rows have inky neighbours within the window, so text stays.
    const above = rowBlack[y - gap] ?? 0;
    const below = rowBlack[y + gap] ?? 0;
    const solidBar = rowBlack[y] > 0.8;
    const isolatedLine = above < 0.15 && below < 0.15;
    if (solidBar || isolatedLine) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        out[o] = out[o + 1] = out[o + 2] = 255;
      }
    }
  }
  return { data: out, width, height };
}

/**
 * Find horizontal bands of text (rows containing ink) in an already-binarized region
 * (black text on white). Robust to vertical drift: instead of assuming fixed line positions
 * it locates the actual rows of glyphs, merging small vertical gaps within a line.
 */
export function detectTextBands(
  region: RegionData,
  opts: { minInkFrac?: number; mergeGap?: number; minHeightFrac?: number } = {}
): Array<{ y0: number; y1: number }> {
  const { data, width, height } = region;
  const minInk = Math.max(2, Math.floor(width * (opts.minInkFrac ?? 0.02)));
  const mergeGap = opts.mergeGap ?? Math.max(2, Math.floor(height * 0.03));
  const minHeight = Math.max(3, Math.floor(height * (opts.minHeightFrac ?? 0.05)));

  const ink: boolean[] = [];
  for (let y = 0; y < height; y++) {
    let c = 0;
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4] < 128) c++;
    ink[y] = c >= minInk;
  }

  const bands: Array<{ y0: number; y1: number }> = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    if (y < height && ink[y]) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      const last = bands[bands.length - 1];
      if (last && start - last.y1 <= mergeGap) last.y1 = y - 1;
      else bands.push({ y0: start, y1: y - 1 });
      start = -1;
    }
  }
  return bands.filter((b) => b.y1 - b.y0 + 1 >= minHeight);
}

/**
 * Find vertical bands of ink (columns of glyphs) in a binarized region. Used to separate the
 * two numbers on a stat row — the final-stat value (left) and the EV number (right) — after the
 * orange bar between them has been dropped by binarization. Returns x-ranges left-to-right.
 */
export function detectColumnClusters(
  region: RegionData,
  opts: { minInkFrac?: number; mergeGap?: number; minWidthFrac?: number } = {}
): Array<{ x0: number; x1: number }> {
  const { data, width, height } = region;
  const minInk = Math.max(1, Math.floor(height * (opts.minInkFrac ?? 0.08)));
  // Merge gap scaled to text HEIGHT: the space between digits of one number is small relative
  // to the glyph height, whereas value and EV are separated by the wide (removed) bar. A
  // height-based gap keeps a number's digits together (so a thin leading "1" isn't split off)
  // without merging the value into the EV.
  const mergeGap = opts.mergeGap ?? Math.max(3, Math.floor(height * 0.5));
  const minWidth = Math.max(2, Math.floor(width * (opts.minWidthFrac ?? 0.02)));

  const ink: boolean[] = [];
  for (let x = 0; x < width; x++) {
    let c = 0;
    for (let y = 0; y < height; y++) if (data[(y * width + x) * 4] < 128) c++;
    ink[x] = c >= minInk;
  }
  const out: Array<{ x0: number; x1: number }> = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    if (x < width && ink[x]) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      const last = out[out.length - 1];
      if (last && start - last.x1 <= mergeGap) last.x1 = x - 1;
      else out.push({ x0: start, x1: x - 1 });
      start = -1;
    }
  }
  return out.filter((c) => c.x1 - c.x0 + 1 >= minWidth);
}

/**
 * Remove small ink blobs (specks) from a binarized region: 4-connected black components whose
 * area is below `minArea` are painted white. Clears stray icon/border remnants near text so
 * single-line OCR doesn't mistake them for a second line.
 */
export function removeSmallComponents(region: RegionData, minArea: number): RegionData {
  const { data, width, height } = region;
  const out = new Uint8ClampedArray(data);
  const n = width * height;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] || data[start * 4] >= 128) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const comp: number[] = [];
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const x = p % width;
      const y = (p / width) | 0;
      const neigh = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
      for (const q of neigh) {
        if (q >= 0 && !seen[q] && data[q * 4] < 128) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (comp.length < minArea) {
      for (const p of comp) {
        out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = 255;
      }
    }
  }
  return { data: out, width, height };
}

/** HSV-style saturation in 0..1 from RGB. */
export function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

export interface BinarizeOptions {
  /** Minimum luminance for a pixel to count as text. */
  threshold?: number;
  /** Maximum saturation for a pixel to count as text (rejects colored icons/bars/arrows). */
  maxSat?: number;
}

/**
 * Binarize a region to black text on white background for OCR.
 * Champions draws near-white (low-saturation, bright) text on a colored panel, and all the
 * noise — type icons, orange EV bars, nature arrows — is highly saturated color. So a pixel
 * is treated as text only when it is both bright AND low-saturation; everything else becomes
 * background. This alone strips icons/bars/arrows out of every text crop.
 */
export function binarize(region: RegionData, opts: BinarizeOptions = {}): RegionData {
  const threshold = opts.threshold ?? 160;
  const maxSat = opts.maxSat ?? 0.35;
  const { data, width, height } = region;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const isText = luminance(r, g, b) >= threshold && saturation(r, g, b) <= maxSat;
    const v = isText ? 0 : 255;
    out[o] = out[o + 1] = out[o + 2] = v;
    out[o + 3] = 255;
  }
  return { data: out, width, height };
}
