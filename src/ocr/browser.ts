import { Rect, toPixels } from './layout';
import { RegionData } from './pixels';
import { buildOcrCanvas } from './preprocess';
import { ocrText } from './recognize';
import { Screen } from './extract';

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Draw a loaded image onto a canvas at native resolution. */
export function imageToCanvas(img: HTMLImageElement | ImageBitmap): HTMLCanvasElement {
  const w = (img as HTMLImageElement).naturalWidth || (img as ImageBitmap).width;
  const h = (img as HTMLImageElement).naturalHeight || (img as ImageBitmap).height;
  const c = makeCanvas(w, h);
  c.getContext('2d')!.drawImage(img as CanvasImageSource, 0, 0);
  return c;
}

/** Load a File/Blob into an HTMLImageElement. */
export function loadImageFile(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function regionData(canvas: HTMLCanvasElement, frac: Rect): RegionData {
  const px = toPixels(frac, canvas.width, canvas.height);
  const ctx = canvas.getContext('2d')!;
  const id = ctx.getImageData(px.x, px.y, Math.max(1, px.w), Math.max(1, px.h));
  return { data: id.data, width: id.width, height: id.height };
}

/** A Screen backed by a browser canvas. */
export function browserScreen(canvas: HTMLCanvasElement): Screen {
  return {
    pixels: (frac) => regionData(canvas, frac),
    ocr: async (frac, opts, lane = 0) => {
      const region = regionData(canvas, frac);
      const oc = buildOcrCanvas(region, makeCanvas, opts?.scale ?? 4, opts?.stripLines, opts?.despeck, opts?.threshold) as HTMLCanvasElement;
      const { text } = await ocrText(
        oc,
        { numeric: opts?.numeric, psm: opts?.psm, keepLines: opts?.keepLines },
        lane
      );
      return text;
    },
  };
}

/** Data URL of a fractional crop of the source, for side-by-side review. */
export function cropDataUrl(canvas: HTMLCanvasElement, frac: Rect): string {
  const px = toPixels(frac, canvas.width, canvas.height);
  const c = makeCanvas(Math.max(1, px.w), Math.max(1, px.h));
  c.getContext('2d')!.drawImage(canvas, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);
  return c.toDataURL();
}
