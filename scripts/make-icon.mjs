// Parametric, reproducible app icon: a teal clipboard / team sheet holding six ORIGINAL monster
// silhouettes (the team of 6). No text. Rebuilt from shapes so it stays crisp at every density.
// Renders two variants for review:
//   A ("inside") — all six monsters inside the sheet.
//   B ("spill")  — the top row pops out above the clipboard for personality.
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'icon-variants');
mkdirSync(outDir, { recursive: true });

// Palette (teal family, no purple).
const BG_A = '#38d6c6';
const BG_B = '#1aa093';
const BOARD = '#149184';
const BOARD_D = '#0e7d72';
const CLIP = '#0f8478';
const SHEET = '#ffffff';
const CELL = '#e9f2f0';
const MON = '#102a30'; // dark teal-navy silhouette

const S = 1024;

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---- Monster silhouettes -------------------------------------------------
// Each is drawn as several overlapping shapes in the SAME fill, so they merge into one silhouette.
function body(g, cx, cy, bw, bh) {
  g.beginPath();
  g.ellipse(cx, cy, bw / 2, bh / 2, 0, 0, Math.PI * 2);
  g.fill();
  // feet
  g.beginPath();
  g.ellipse(cx - bw * 0.26, cy + bh * 0.42, bw * 0.16, bh * 0.13, 0, 0, Math.PI * 2);
  g.ellipse(cx + bw * 0.26, cy + bh * 0.42, bw * 0.16, bh * 0.13, 0, 0, Math.PI * 2);
  g.fill();
}
function tri(g, x1, y1, x2, y2, x3, y3) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.lineTo(x3, y3);
  g.closePath();
  g.fill();
}

function monster(g, idx, cx, cy, s) {
  g.fillStyle = MON;
  const bw = 200 * s;
  const bh = 170 * s;
  const top = cy - bh / 2;
  switch (idx) {
    case 0: {
      // spiky mane across the top
      body(g, cx, cy, bw, bh);
      const n = 7;
      for (let i = 0; i < n; i++) {
        const x = cx - bw * 0.42 + (bw * 0.84 * i) / (n - 1);
        const h = (i % 2 ? 70 : 52) * s;
        tri(g, x - 22 * s, top + 20 * s, x + 22 * s, top + 20 * s, x, top - h);
      }
      break;
    }
    case 1: {
      // two round ears (mouse-ish, original)
      g.beginPath();
      g.ellipse(cx - bw * 0.34, top + 6 * s, 46 * s, 46 * s, 0, 0, Math.PI * 2);
      g.ellipse(cx + bw * 0.34, top + 6 * s, 46 * s, 46 * s, 0, 0, Math.PI * 2);
      g.fill();
      body(g, cx, cy, bw, bh);
      break;
    }
    case 2: {
      // sprout: stem + leaf on top
      body(g, cx, cy, bw, bh);
      g.save();
      g.fillRect(cx - 9 * s, top - 46 * s, 18 * s, 60 * s);
      g.translate(cx + 30 * s, top - 40 * s);
      g.rotate(0.6);
      g.beginPath();
      g.ellipse(0, 0, 46 * s, 26 * s, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      break;
    }
    case 3: {
      // fin fan (mohawk), taller in the middle
      body(g, cx, cy, bw, bh);
      const n = 5;
      for (let i = 0; i < n; i++) {
        const x = cx - bw * 0.34 + (bw * 0.68 * i) / (n - 1);
        const h = (90 - Math.abs(i - 2) * 18) * s;
        tri(g, x - 20 * s, top + 22 * s, x + 20 * s, top + 22 * s, x, top - h);
      }
      break;
    }
    case 4: {
      // curl antenna
      body(g, cx, cy, bw, bh);
      g.strokeStyle = MON;
      g.lineWidth = 26 * s;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx, top + 10 * s);
      g.quadraticCurveTo(cx + 4 * s, top - 70 * s, cx + 54 * s, top - 66 * s);
      g.quadraticCurveTo(cx + 92 * s, top - 62 * s, cx + 78 * s, top - 24 * s);
      g.stroke();
      break;
    }
    case 5: {
      // two curved horns
      body(g, cx, cy, bw, bh);
      tri(g, cx - bw * 0.36, top + 20 * s, cx - bw * 0.14, top + 20 * s, cx - bw * 0.42, top - 72 * s);
      tri(g, cx + bw * 0.36, top + 20 * s, cx + bw * 0.14, top + 20 * s, cx + bw * 0.42, top - 72 * s);
      break;
    }
  }
}

function drawIcon(g, { spill }) {
  // Background
  const bg = g.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, BG_A);
  bg.addColorStop(1, BG_B);
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);

  // Clipboard board
  const bx = 168, by = 250, bw = 688, bh = 664, br = 60;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.28)';
  g.shadowBlur = 46;
  g.shadowOffsetY = 20;
  const bgrad = g.createLinearGradient(0, by, 0, by + bh);
  bgrad.addColorStop(0, BOARD);
  bgrad.addColorStop(1, BOARD_D);
  g.fillStyle = bgrad;
  roundRect(g, bx, by, bw, bh, br);
  g.fill();
  g.restore();

  // Clip tab, overlapping the board's top edge so it reads as attached.
  const clipW = 224, clipH = 104, clipX = S / 2 - clipW / 2, clipY = by - 54;
  g.fillStyle = CLIP;
  roundRect(g, clipX, clipY, clipW, clipH, 34);
  g.fill();
  g.fillStyle = BOARD_D;
  g.beginPath();
  g.ellipse(S / 2, clipY + 46, 21, 21, 0, 0, Math.PI * 2);
  g.fill();

  // White sheet
  const sx = 214, sy = 322, sw = 596, sh = 556, sr = 34;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.20)';
  g.shadowBlur = 26;
  g.shadowOffsetY = 8;
  g.fillStyle = SHEET;
  roundRect(g, sx, sy, sw, sh, sr);
  g.fill();
  g.restore();

  // Grid cells + monsters
  const cols = [sx + sw * 0.30, sx + sw * 0.70];
  const rowsInside = [sy + 100, sy + 278, sy + 456];
  const cellW = 246, cellH = 156;
  // cells
  g.fillStyle = CELL;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 2; c++)
      roundRect(g, cols[c] - cellW / 2, rowsInside[r] - cellH / 2, cellW, cellH, 24), g.fill();

  // Monster placement. In the spill variant the TOP row rises so heads peek above the sheet's
  // top edge, but the bodies stay in their cells (no empty cells).
  const order = [0, 1, 2, 3, 4, 5];
  const topY = spill ? rowsInside[0] - 52 : rowsInside[0];
  const rowY = [topY, rowsInside[1], rowsInside[2]];
  const topS = spill ? 0.68 : 0.62;
  const s = [topS, topS, 0.62, 0.62, 0.62, 0.62];
  for (let i = 0; i < 6; i++) {
    const c = i % 2;
    const r = Math.floor(i / 2);
    monster(g, order[i], cols[c], rowY[r], s[i]);
  }
}

function render(opts) {
  const c = createCanvas(S, S);
  drawIcon(c.getContext('2d'), opts);
  return c;
}

const A = render({ spill: false });
const B = render({ spill: true });
writeFileSync(join(outDir, 'A-inside.png'), A.toBuffer('image/png'));
writeFileSync(join(outDir, 'B-spill.png'), B.toBuffer('image/png'));

// Comparison sheet with small previews.
{
  const W = 1360, H = 820;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#0e0a1e';
  g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  g.fillStyle = '#ece8ff';
  const big = 560;
  for (const [i, [img, label]] of [[A, 'A · dentro'], [B, 'B · a sair no topo']].entries()) {
    const x = 60 + i * (big + 180);
    // rounded-mask preview of the big icon
    g.save();
    roundRect(g, x, 60, big, big, 120);
    g.clip();
    g.drawImage(img, x, 60, big, big);
    g.restore();
    // 48px preview
    g.save();
    roundRect(g, x + big / 2 - 24, 650, 96, 96, 22);
    g.clip();
    g.drawImage(img, x + big / 2 - 24, 650, 96, 96);
    g.restore();
    g.font = '600 34px system-ui, Arial, sans-serif';
    g.fillText(label, x + big / 2, 640);
    g.font = '400 24px system-ui, Arial, sans-serif';
    g.fillText('96 px', x + big / 2 + 24, 776);
  }
  writeFileSync(join(outDir, 'compare.png'), c.toBuffer('image/png'));
}

console.log('[icon] wrote A-inside.png, B-spill.png, compare.png -> assets/icon-variants/');
