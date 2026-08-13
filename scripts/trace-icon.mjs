// Rebuild the app icon FAITHFULLY from the approved source image: extract the six monster
// silhouettes straight from the source pixels (so the shapes/layout match what was approved),
// then place them on a clean, crisp clipboard. Prints detected geometry for verification.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'icon-variants');
mkdirSync(outDir, { recursive: true });

const SRC = process.argv[2] ||
  'C:\\Users\\tamve\\.claude\\image-cache\\c5143a75-63e1-411e-9481-153d4449038e\\6.png';

const img = await loadImage(SRC);
const W = img.width, H = img.height;
const sc = createCanvas(W, H);
const sg = sc.getContext('2d');
sg.drawImage(img, 0, 0);
const data = sg.getImageData(0, 0, W, H).data;
const lum = (i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
console.log('source', W + 'x' + H);

// ---- connected components (4-neighbour) over a boolean predicate --------
function components(pred, box) {
  const [x0, y0, x1, y1] = box || [0, 0, W, H];
  const seen = new Uint8Array(W * H);
  const comps = [];
  const stack = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = y * W + x;
      if (seen[idx] || !pred(idx * 4)) continue;
      let minx = x, miny = y, maxx = x, maxy = y, area = 0, sx = 0, sy = 0;
      stack.length = 0;
      stack.push(idx);
      seen[idx] = 1;
      while (stack.length) {
        const p = stack.pop();
        const px = p % W, py = (p / W) | 0;
        area++; sx += px; sy += py;
        if (px < minx) minx = px; if (px > maxx) maxx = px;
        if (py < miny) miny = py; if (py > maxy) maxy = py;
        const nb = [p - 1, p + 1, p - W, p + W];
        for (const q of nb) {
          if (q < 0 || q >= W * H || seen[q]) continue;
          const qx = q % W;
          if (Math.abs(qx - px) > 1) continue; // don't wrap rows
          if (pred(q * 4)) { seen[q] = 1; stack.push(q); }
        }
      }
      comps.push({ minx, miny, maxx, maxy, area, cx: sx / area, cy: sy / area });
    }
  }
  return comps;
}

// Sheet = largest bright blob.
const white = components((i) => lum(i) > 232).sort((a, b) => b.area - a.area);
const sheet = white[0];
console.log('sheet bbox', sheet.minx, sheet.miny, sheet.maxx, sheet.maxy);
const shX = sheet.minx, shY = sheet.miny, shW = sheet.maxx - sheet.minx, shH = sheet.maxy - sheet.miny;

// Monsters = the six largest dark blobs inside the sheet (drops the clip hole & shadows).
let mon = components((i) => lum(i) < 90, [sheet.minx, sheet.miny, sheet.maxx, sheet.maxy])
  .filter((c) => c.area > shW * shH * 0.004)
  .sort((a, b) => b.area - a.area)
  .slice(0, 6)
  .sort((a, b) => a.cy - b.cy || a.cx - b.cx);
console.log('monsters kept:', mon.length, mon.map((m) => `(${(m.cx | 0)},${(m.cy | 0)}) a=${m.area}`).join(' '));

// Sample palette from the source so the rebuild matches the approved look.
const at = (x, y) => { const i = (y * W + x) * 4; return `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`; };
const BG = at(6, (H / 2) | 0);
const BOARD = at((shX - shW * 0.06) | 0, (shY + shH / 2) | 0);
const CLIP = at((W / 2) | 0, (shY - shH * 0.08) | 0);
const monMid = mon[Math.floor(mon.length / 2)];
const MON = at(monMid.cx | 0, monMid.cy | 0);
console.log('colors', { BG, BOARD, CLIP, MON });

// Extract each monster as a recoloured, transparent-background sprite (from source pixels).
function sprite(c) {
  const w = c.maxx - c.minx + 1, h = c.maxy - c.miny + 1;
  const cc = createCanvas(w, h);
  const g = cc.getContext('2d');
  const out = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((c.miny + y) * W + (c.minx + x)) * 4;
      const oi = (y * w + x) * 4;
      // alpha from how dark the source pixel is (keeps anti-aliased edges).
      const a = Math.max(0, Math.min(255, (150 - lum(si)) * 3));
      out.data[oi] = 0x10; out.data[oi + 1] = 0x2a; out.data[oi + 2] = 0x30; out.data[oi + 3] = a;
    }
  }
  g.putImageData(out, 0, 0);
  return { canvas: cc, w, h, cx: c.cx, cy: c.cy };
}
const sprites = mon.map(sprite);

// ---- Rebuild clean icon at 1024, matching source layout -----------------
const T = 1024;
const s = T / W; // source->target scale
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
const c = createCanvas(T, T);
const g = c.getContext('2d');
g.imageSmoothingEnabled = true;

// background (flat, sampled)
g.fillStyle = BG; g.fillRect(0, 0, T, T);
// board = sheet rect expanded, matching source proportions
const bpadX = shW * 0.11, bpadB = shH * 0.10, bpadT = shH * 0.14;
const bx = (shX - bpadX) * s, by = (shY - bpadT) * s, bw = (shW + 2 * bpadX) * s, bh = (shH + bpadT + bpadB) * s;
g.save();
g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowBlur = 40; g.shadowOffsetY = 18;
g.fillStyle = BOARD; roundRect(g, bx, by, bw, bh, 60 * s); g.fill();
g.restore();
// clip tab
const clipW = shW * 0.30 * s, clipH = shH * 0.13 * s, clipX = T / 2 - clipW / 2, clipY = by - clipH * 0.55;
g.fillStyle = CLIP; roundRect(g, clipX, clipY, clipW, clipH, 30 * s); g.fill();
// white sheet
g.save();
g.shadowColor = 'rgba(0,0,0,0.18)'; g.shadowBlur = 24; g.shadowOffsetY = 8;
g.fillStyle = '#ffffff'; roundRect(g, shX * s, shY * s, shW * s, shH * s, 34 * s); g.fill();
g.restore();
// monsters (from source sprites), placed by their source centroids
for (const sp of sprites) {
  const dw = sp.w * s, dh = sp.h * s;
  g.drawImage(sp.canvas, sp.cx * s - dw / 2, sp.cy * s - dh / 2, dw, dh);
}
writeFileSync(join(outDir, 'traced.png'), c.toBuffer('image/png'));

// Comparison: source (left) vs traced (right) + 48px preview.
{
  const cw = 1180, ch = 640;
  const cmp = createCanvas(cw, ch);
  const cg = cmp.getContext('2d');
  cg.fillStyle = '#0e0a1e'; cg.fillRect(0, 0, cw, ch);
  const box = 500;
  cg.drawImage(img, 40, 60, box, box);
  cg.drawImage(c, 640, 60, box, box);
  cg.drawImage(c, 640 + box - 96, 60 + box - 96, 96, 96);
  cg.fillStyle = '#ece8ff'; cg.textAlign = 'center';
  cg.font = '600 30px system-ui, Arial, sans-serif';
  cg.fillText('fonte', 40 + box / 2, 600);
  cg.fillText('tracejado (48px inset)', 640 + box / 2, 600);
  writeFileSync(join(outDir, 'traced-compare.png'), cmp.toBuffer('image/png'));
}
console.log('[trace] wrote traced.png + traced-compare.png');
