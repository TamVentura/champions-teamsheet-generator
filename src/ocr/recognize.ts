import { createWorker, type Worker } from 'tesseract.js';

export type OcrInput = Parameters<Worker['recognize']>[0];

export interface OcrOptions {
  /** Restrict to digits (stat / EV numbers). */
  numeric?: boolean;
  /** Explicit character whitelist. */
  whitelist?: string;
  /** Tesseract page segmentation mode; 7 = single line (default), 6 = block. */
  psm?: string;
  /** Preserve newlines in the result (for multi-line block OCR). */
  keepLines?: boolean;
}

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -.';

// A small pool of workers, one per "lane". OCR is otherwise strictly serial (one worker), which is
// the slow part on phones — ~200 recognitions back to back. The caller runs the 6 Pokémon on
// distinct lanes so several read in parallel. Two calls must never share a lane concurrently
// (setParameters + recognize aren't atomic), which the caller guarantees by giving each concurrent
// card its own lane.
const workers: (Promise<Worker> | null)[] = [];

// In the browser (PWA and the Capacitor WebView), everything the OCR engine needs is vendored
// into `public/tesseract/` by scripts/vendor-ocr.mjs, so nothing is ever fetched from a CDN —
// that is what makes the packaged Android app work fully offline. Relative paths resolve against
// the page location, i.e. `http://localhost/tesseract/...` inside Capacitor. corePath points at
// the directory so tesseract.js auto-picks the SIMD core on a modern WebView (fast) and the base
// core on an older one (Android 8), so no device is excluded.
//
// In Node (the dev OCR harnesses under tools/), those local paths don't apply, so we leave the
// tesseract.js defaults untouched — the harness keeps behaving exactly as before.
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

function getWorker(lane: number): Promise<Worker> {
  if (!workers[lane]) {
    workers[lane] = isBrowser
      ? createWorker('eng', 1, {
          workerPath: './tesseract/worker.min.js',
          corePath: './tesseract/',
          langPath: './tesseract/',
          // The data file is named `eng.traineddata` (no `.gz`) because the Android build
          // auto-decompresses/renames `.gz` assets, which makes `eng.traineddata.gz` 404 in the
          // packaged WebView. gzip:false makes tesseract fetch `eng.traineddata` directly; its
          // bytes are gzip-compressed and tesseract inflates them via the gzip magic-byte check.
          gzip: false,
        })
      : createWorker('eng');
  }
  return workers[lane]!;
}

export async function ocrText(
  image: OcrInput,
  opts: OcrOptions = {},
  lane = 0
): Promise<{ text: string; confidence: number }> {
  const worker = await getWorker(lane);
  const whitelist = opts.numeric ? '0123456789' : opts.whitelist ?? ALPHA;
  await worker.setParameters({
    tessedit_char_whitelist: whitelist,
    tessedit_pageseg_mode: (opts.psm ?? '7') as never,
  });
  const { data } = await worker.recognize(image);
  const text = opts.keepLines
    ? data.text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
    : data.text.replace(/\s+/g, ' ').trim();
  return { text, confidence: data.confidence };
}

export async function terminateOcr(): Promise<void> {
  const live = workers.filter(Boolean) as Promise<Worker>[];
  workers.length = 0;
  await Promise.all(live.map(async (p) => (await p).terminate()));
}
