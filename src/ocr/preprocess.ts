import { binarize, RegionData, removeSmallComponents, stripHorizontalLines } from './pixels';

/** Minimal 2D canvas surface shared by the browser (HTMLCanvasElement) and Node (@napi-rs). */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(id: '2d'): any;
}

export type CanvasFactory = (w: number, h: number) => CanvasLike;

/**
 * Turn a raw region into an OCR-friendly canvas: saturation-aware binarization
 * (drops colored icons/bars/arrows), upscaled with a white margin so Tesseract has
 * quiet space around the glyphs.
 */
export function buildOcrCanvas(
  region: RegionData,
  make: CanvasFactory,
  scale = 4,
  stripLines = false,
  despeck = false,
  threshold?: number
): CanvasLike {
  const b = binarize(region, threshold != null ? { threshold } : {});
  let bin = stripLines ? stripHorizontalLines(b) : b;
  // Drop stray specks (icon/border remnants) — area threshold scaled to the region.
  if (despeck) bin = removeSmallComponents(bin, Math.max(20, Math.round(region.height * 1.5)));

  const pad = Math.max(6, Math.round(region.height * scale * 0.4));
  const s = Math.max(1, Math.round(scale));
  const bw = region.width * s + pad * 2;
  const bh = region.height * s + pad * 2;
  const big = make(bw, bh);
  const bctx = big.getContext('2d');

  // Upscale with a pure-JS integer nearest-neighbour (block replication) instead of
  // ctx.drawImage + imageSmoothingEnabled. Canvas image smoothing is platform-dependent —
  // desktop Chrome, mobile Chrome and @napi-rs each resample with a different kernel, so a
  // smoothed upscale feeds Tesseract subtly different edge pixels per device and flips
  // borderline reads (observed: "Toxic Debris" on desktop/Node vs "Toxic Chain" on mobile).
  // Block replication of the already-binarized region is byte-identical on every platform, so
  // Tesseract (same WASM) gets identical input everywhere and what the Node scorer validates is
  // exactly what every phone sees.
  const out = bctx.createImageData(bw, bh);
  out.data.fill(255); // white background incl. the quiet-space margin
  const src = bin.data;
  const rw = region.width;
  for (let sy = 0; sy < region.height; sy++) {
    for (let sx = 0; sx < rw; sx++) {
      const v = src[(sy * rw + sx) * 4]; // binary: r=g=b, 0 or 255
      if (v === 255) continue; // background already white
      const dx0 = pad + sx * s;
      const dy0 = pad + sy * s;
      for (let dy = 0; dy < s; dy++) {
        let dOff = ((dy0 + dy) * bw + dx0) * 4;
        for (let dx = 0; dx < s; dx++) {
          out.data[dOff] = v;
          out.data[dOff + 1] = v;
          out.data[dOff + 2] = v;
          out.data[dOff + 3] = 255;
          dOff += 4;
        }
      }
    }
  }
  bctx.putImageData(out, 0, 0);
  return big;
}
