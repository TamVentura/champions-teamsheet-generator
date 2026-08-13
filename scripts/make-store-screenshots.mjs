// Compose Play Store phone screenshots (1080x1920) from the real app captures: crop the centered
// app column out of each capture and place it on a branded slide with a caption. Run manually
// after refreshing the source captures (paths passed via SHOTS below).
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'store', 'screenshots');
mkdirSync(outDir, { recursive: true });

const BG0 = '#0e0a1e';
const BG1 = '#1c1533';
const TEXT = '#ece8ff';
const ACCENT2 = '#33d0c0';

// Source captures + crop rect (x,y,w,h) of the centered app column + caption.
const T = 'C:\\Users\\tamve\\AppData\\Local\\Temp\\claude-chrome-screenshots-yEadvx\\';
const SHOTS = [
  { src: T + 'screenshot-1786199629363-0.jpg', crop: [650, 10, 236, 600], caption: 'Save your player profile once', file: '1-home.png' },
  { src: T + 'screenshot-1786199950392-2.jpg', crop: [566, 30, 392, 725], caption: 'Reads your team from two screenshots', file: '2-review.png' },
  { src: T + 'screenshot-1786200001556-3.jpg', crop: [566, 30, 392, 740], caption: 'Exports the Showdown paste & official PDFs', file: '3-output.png' },
  { src: T + 'screenshot-1786199703363-1.jpg', crop: [566, 30, 392, 745], caption: '100% offline · made for the VGC community', file: '4-about.png' },
];

const W = 1080;
const H = 1920;

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (g.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

for (const shot of SHOTS) {
  const img = await loadImage(shot.src);
  const c = createCanvas(W, H);
  const g = c.getContext('2d');

  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, BG0);
  grad.addColorStop(1, BG1);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // Caption (up to 2 lines), centered near the top.
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = TEXT;
  g.font = '700 52px system-ui, "Segoe UI", Arial, sans-serif';
  const lines = wrap(g, shot.caption, W - 160);
  let cy = 170;
  for (const ln of lines) {
    g.fillText(ln, W / 2, cy);
    cy += 62;
  }
  // accent underline
  g.strokeStyle = ACCENT2;
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(W / 2 - 70, cy + 6);
  g.lineTo(W / 2 + 70, cy + 6);
  g.stroke();

  // App column: crop then scale to fit the area below the caption.
  const [cx, cyy, cw, ch] = shot.crop;
  const topArea = cy + 60;
  const availW = W - 150;
  const availH = H - topArea - 90;
  const scale = Math.min(availW / cw, availH / ch);
  const dw = cw * scale;
  const dh = ch * scale;
  const dx = (W - dw) / 2;
  const dy = topArea + (availH - dh) / 2;

  // Shadow + rounded clip + subtle border.
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 40;
  g.shadowOffsetY = 16;
  roundRect(g, dx, dy, dw, dh, 28);
  g.fillStyle = BG0;
  g.fill();
  g.restore();

  g.save();
  roundRect(g, dx, dy, dw, dh, 28);
  g.clip();
  g.drawImage(img, cx, cyy, cw, ch, dx, dy, dw, dh);
  g.restore();

  g.save();
  roundRect(g, dx, dy, dw, dh, 28);
  g.strokeStyle = 'rgba(124,92,255,0.35)';
  g.lineWidth = 2;
  g.stroke();
  g.restore();

  writeFileSync(join(outDir, shot.file), c.toBuffer('image/png'));
  console.log('[store] wrote assets/store/screenshots/' + shot.file);
}
