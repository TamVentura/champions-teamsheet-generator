import { Rect } from './layout';
import { RegionData } from './pixels';

// Detect the six Pokémon card panels regardless of resolution or aspect ratio. The panels are
// purple (blue channel exceeds red) on a warm cream/orange background (red exceeds blue), so a
// simple per-pixel test separates them; connected components then give the six card boxes.

export function isPanelPixel(r: number, _g: number, b: number): boolean {
  // Purple/lavender: blue clearly above red, and not the near-white header text.
  return b > r + 8 && b > 60;
}

// The detected box is the tight purple panel; the field layout is calibrated to a slightly
// taller box that starts above the panel (the name sits in the header). These ratios (of the
// panel height) reconstruct that layout box and match the original static box to the pixel.
const TOP_RATIO = 0.213;
const HEIGHT_RATIO = 1.124;

/** Convert a detected purple-panel box into the card box the field fractions expect. */
export function panelToCardBox(d: Rect): Rect {
  return { x: d.x, y: d.y - TOP_RATIO * d.h, w: d.w, h: HEIGHT_RATIO * d.h };
}

interface Box { x0: number; y0: number; x1: number; y1: number; area: number }

/**
 * Locate the six card panels. Returns their bounding boxes as fractions of the image, ordered
 * slot 0..5 (row-major, left column then right). Returns [] if a clean 2x3 grid isn't found.
 */
export function detectPanels(full: RegionData): Rect[] {
  const { data, width, height } = full;
  const stride = Math.max(1, Math.round(width / 640));
  const gw = Math.floor(width / stride);
  const gh = Math.floor(height / stride);
  const mask = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const o = ((gy * stride) * width + gx * stride) * 4;
      if (isPanelPixel(data[o], data[o + 1], data[o + 2])) mask[gy * gw + gx] = 1;
    }
  }

  // Connected components (4-connected) over the mask.
  const seen = new Uint8Array(gw * gh);
  const stack: number[] = [];
  const boxes: Box[] = [];
  for (let start = 0; start < gw * gh; start++) {
    if (seen[start] || !mask[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0, area = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % gw;
      const y = (p / gw) | 0;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && !seen[p - 1] && mask[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < gw - 1 && !seen[p + 1] && mask[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && !seen[p - gw] && mask[p - gw]) { seen[p - gw] = 1; stack.push(p - gw); }
      if (y < gh - 1 && !seen[p + gw] && mask[p + gw]) { seen[p + gw] = 1; stack.push(p + gw); }
    }
    boxes.push({ x0, y0, x1, y1, area });
  }

  // Keep card-column-width components below the header (excludes the wide thin Team-ID bar and
  // small icons). Adjacent cards in a column can touch, merging into one tall component, so we
  // split those back into equal card rows below.
  const colWide = boxes.filter((b) => {
    const w = (b.x1 - b.x0 + 1) / gw;
    const h = (b.y1 - b.y0 + 1) / gh;
    return b.area > gw * gh * 0.01 && w >= 0.2 && w <= 0.5 && h >= 0.08 && b.y0 > gh * 0.12;
  });
  if (!colWide.length) return [];

  // Typical single-card height = smallest component height (a lone card).
  const unitH = Math.min(...colWide.map((b) => b.y1 - b.y0 + 1));
  const six: Box[] = [];
  for (const b of colWide) {
    const h = b.y1 - b.y0 + 1;
    const n = Math.max(1, Math.round(h / unitH));
    for (let k = 0; k < n; k++) {
      const y0 = b.y0 + Math.round((k * h) / n);
      const y1 = b.y0 + Math.round(((k + 1) * h) / n) - 1;
      six.push({ x0: b.x0, y0, x1: b.x1, y1, area: 0 });
    }
  }
  if (six.length !== 6) return [];
  const midX = six.reduce((s, b) => s + (b.x0 + b.x1) / 2, 0) / 6;
  const rows = [...six].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const ordered: Box[] = [];
  for (let r = 0; r < 3; r++) {
    const pair = rows.slice(r * 2, r * 2 + 2).sort((a, b) => (a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2);
    if (pair.length !== 2) return [];
    ordered.push(...pair);
  }
  // Sanity: each row should have one panel left of centre and one right.
  for (let r = 0; r < 3; r++) {
    const left = (ordered[r * 2].x0 + ordered[r * 2].x1) / 2;
    const right = (ordered[r * 2 + 1].x0 + ordered[r * 2 + 1].x1) / 2;
    if (!(left < midX && right > midX)) return [];
  }

  return ordered.map((b) => ({
    x: (b.x0 * stride) / width,
    y: (b.y0 * stride) / height,
    w: ((b.x1 - b.x0 + 1) * stride) / width,
    h: ((b.y1 - b.y0 + 1) * stride) / height,
  }));
}
