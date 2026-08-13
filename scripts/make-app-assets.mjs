// Build the source images @capacitor/assets consumes, derived from the existing PWA icon so the
// Android launcher icon and splash match the web app. Brand colors come from the manifest:
// background #0e0a1e, theme #5b3fa6.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'assets');
mkdirSync(assets, { recursive: true });

const BG = { r: 0x0e, g: 0x0a, b: 0x1e, alpha: 1 };
// Faithful icon master (rebuilt from the approved source by scripts/make-icon-from-source.mjs).
const src = join(root, 'assets', 'icon-variants', 'master.png');

// 1024x1024 icon (upscaled from 512; the icon is flat art so this stays crisp enough).
await sharp(src).resize(1024, 1024, { kernel: 'lanczos3' }).png().toFile(join(assets, 'icon.png'));

// 2732x2732 splash: icon centered at ~38% on the brand background. Same image for light/dark
// (the background is already dark and on-brand).
const S = 2732;
const logo = 1040;
const logoBuf = await sharp(src).resize(logo, logo, { kernel: 'lanczos3' }).png().toBuffer();
const splash = await sharp({ create: { width: S, height: S, channels: 4, background: BG } })
  .composite([{ input: logoBuf, gravity: 'centre' }])
  .png()
  .toBuffer();
await sharp(splash).toFile(join(assets, 'splash.png'));
await sharp(splash).toFile(join(assets, 'splash-dark.png'));

console.log('[make-app-assets] wrote assets/icon.png, splash.png, splash-dark.png');
