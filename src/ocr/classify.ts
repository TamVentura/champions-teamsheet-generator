// The top toggle shows two tabs: "Moves & More" (left) and "Stats" (right); the active one is
// filled lime green. We locate that green fill by content — no fixed position — so the classifier
// works at any resolution/aspect: the toggle is the image row with the most lime-green pixels (a
// long solid pill, unlike the small scattered grass-type move icons), and the side of centre its
// green sits on tells us which tab is active.

function isLimeGreen(r: number, g: number, b: number): boolean {
  return g > 150 && g - r > 20 && g - b > 40;
}

export type ScreenKind = 'stats' | 'moves';

interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | number[];
}

function pixelsOf(canvas: HTMLCanvasElement): Pixels {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  return { width: canvas.width, height: canvas.height, data };
}

/** Classify a screenshot canvas as the Stats or the Moves & More screen. */
export function classifyScreen(canvas: HTMLCanvasElement): ScreenKind {
  const { width, height, data } = pixelsOf(canvas);
  // The active tab is a long solid green pill; grass-type move icons are small green squares. So
  // the toggle is the row with the LONGEST contiguous green run (letter gaps merged), not merely
  // the most green pixels — that rejects a row that happens to line up several icons.
  const mergeGap = Math.max(3, Math.round(width * 0.03));
  let best = { len: 0, mid: width / 2 };
  for (let y = 0; y < height; y++) {
    let runStart = -1;
    let lastGreen = -2 * mergeGap;
    for (let x = 0; x <= width; x++) {
      const green =
        x < width && isLimeGreen(data[(y * width + x) * 4], data[(y * width + x) * 4 + 1], data[(y * width + x) * 4 + 2]);
      if (green) {
        if (runStart < 0) runStart = x;
        lastGreen = x;
      } else if (runStart >= 0 && x - lastGreen > mergeGap) {
        const len = lastGreen - runStart + 1;
        if (len > best.len) best = { len, mid: (runStart + lastGreen) / 2 };
        runStart = -1;
      }
    }
  }
  if (best.len < width * 0.05) return 'stats';
  // Green pill on the right half → "Stats" active; on the left → "Moves & More" active.
  return best.mid >= width / 2 ? 'stats' : 'moves';
}
