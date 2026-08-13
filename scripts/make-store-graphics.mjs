// Generate Play Store graphics that match the app's brand:
//   assets/store/feature-graphic.png   1024x500  (required feature graphic)
// Uses @napi-rs/canvas (already a dev dependency) for reliable text rendering.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'store');
mkdirSync(outDir, { recursive: true });

const BG0 = '#0e0a1e';
const BG1 = '#0c2b2a';
const ACCENT = '#33d0c0';
const ACCENT2 = '#33d0c0';
const TEXT = '#ece8ff';
const MUTED = '#a99fce';

const icon = await loadImage(join(root, 'public', 'icons', 'icon-512.png'));

// ---- Feature graphic: 1024 x 500 ----
{
  const W = 1024;
  const H = 500;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');

  // Background gradient + a soft accent glow behind the icon.
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, BG0);
  grad.addColorStop(1, BG1);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  const glow = g.createRadialGradient(250, H / 2, 20, 250, H / 2, 340);
  glow.addColorStop(0, 'rgba(51,208,192,0.45)');
  glow.addColorStop(1, 'rgba(51,208,192,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // Icon on the left.
  const iconSize = 300;
  g.drawImage(icon, 100, (H - iconSize) / 2, iconSize, iconSize);

  // Title + subtitle on the right.
  const x = 470;
  g.fillStyle = TEXT;
  g.font = '700 58px system-ui, "Segoe UI", Arial, sans-serif';
  g.fillText('Champions', x, 210);
  g.fillText('Teamsheet', x, 275);
  g.fillStyle = ACCENT2;
  g.fillText('Generator', x, 340);

  g.fillStyle = MUTED;
  g.font = '400 24px system-ui, "Segoe UI", Arial, sans-serif';
  g.fillText('Screenshots → Showdown paste & official sheets', x, 390);
  g.fillStyle = ACCENT;
  g.font = '600 22px system-ui, "Segoe UI", Arial, sans-serif';
  g.fillText('Runs fully offline', x, 424);

  writeFileSync(join(outDir, 'feature-graphic.png'), c.toBuffer('image/png'));
  console.log('[store] wrote assets/store/feature-graphic.png (1024x500)');
}
