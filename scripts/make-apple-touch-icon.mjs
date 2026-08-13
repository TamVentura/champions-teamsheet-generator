// Generate public/icons/apple-touch-icon.png — the icon iOS Safari shows for a home-screen PWA.
// iOS does not mask the icon or honour transparency (a transparent icon renders on black), so it
// must be a fully OPAQUE square. We derive it from the finished Play Store icon so the iOS home
// screen matches what users already see on Android / the store. 180x180 is the modern iOS size.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets', 'store', 'play-store-icon-512.png');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const TEAL = { r: 0x12, g: 0xbd, b: 0xb7, alpha: 1 }; // adaptive-icon background

await sharp(src)
  .resize(180, 180, { kernel: 'lanczos3' })
  .flatten({ background: TEAL }) // guarantee opacity even if the source has an alpha channel
  .png()
  .toFile(join(outDir, 'apple-touch-icon.png'));

console.log('[make-apple-touch-icon] wrote public/icons/apple-touch-icon.png (180x180, opaque)');
