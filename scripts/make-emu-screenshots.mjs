// Process native emulator captures (1080x2400) into Play-Store phone screenshots.
// Play rules: PNG/JPEG, each side 320..3840 px, max side <= 2x min side.
//
// Recipe: crop the status bar (top) and gesture pill (bottom) off the capture, then place the
// content on a uniform dark (#0e0a1e) canvas of 1200x2400 (exactly 2:1) with a small top margin
// and a generous bottom margin. The bottom margin matters for the About screen, whose trailing
// "Back" button otherwise sits right on the image edge; the dark canvas is the app's own
// background colour, so the margins are seamless.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = process.argv[2];
const outDir = join(root, 'assets', 'store', 'screenshots');

const BG = { r: 0x0e, g: 0x0a, b: 0x1e, alpha: 1 };
const SRC_W = 1080, SRC_H = 2400;
const CROP_TOP = 100;        // remove status bar
const CROP_BOTTOM = 60;      // remove gesture pill
const CONTENT_H = SRC_H - CROP_TOP - CROP_BOTTOM;   // 2240
const CANVAS_W = 1200, CANVAS_H = 2400;             // 2:1 exactly
const TOP_MARGIN = 40;                              // small breathing room above the title
const LEFT = Math.round((CANVAS_W - SRC_W) / 2);    // 60

const SHOTS = [
  ['shot-home-raw.png', '1-home.png'],
  ['shot-review-raw.png', '2-review.png'],
  ['shot-output-raw.png', '3-output.png'],
  ['shot-about-raw.png', '4-about.png'],
];

for (const [src, out] of SHOTS) {
  const content = await sharp(join(SCRATCH, src))
    .extract({ left: 0, top: CROP_TOP, width: SRC_W, height: CONTENT_H })
    .toBuffer();
  await sharp({ create: { width: CANVAS_W, height: CANVAS_H, channels: 4, background: BG } })
    .composite([{ input: content, left: LEFT, top: TOP_MARGIN }])
    .png()
    .toFile(join(outDir, out));
  const m = await sharp(join(outDir, out)).metadata();
  console.log(`[emu] ${out} -> ${m.width}x${m.height} (ratio ${(Math.max(m.width, m.height) / Math.min(m.width, m.height)).toFixed(3)}:1)`);
}
