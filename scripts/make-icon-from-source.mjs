// Build the icon FAITHFULLY from the approved source, without cropping anything, and emit the
// full adaptive-icon set so Android never clips it:
//   assets/icon-variants/master.png  – complete logo, squared, full-bleed (also = icon-only)
//   assets/icon-only.png             – legacy square + PWA source
//   assets/icon-foreground.png       – adaptive foreground (logo padded into the safe zone)
//   assets/icon-background.png       – adaptive background (solid teal)
//   public/icons/icon-512.png / -192.png – PWA icons
// Plus a masked preview (circle + rounded-square) to prove nothing is clipped.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'icon-variants');
const assets = join(root, 'assets');
mkdirSync(outDir, { recursive: true });

const SRC = process.argv[2] ||
  'C:\\Users\\tamve\\.claude\\image-cache\\c5143a75-63e1-411e-9481-153d4449038e\\6.png';

const img = await loadImage(SRC);
const W = img.width, H = img.height;
const sc = createCanvas(W, H);
const sg = sc.getContext('2d');
sg.drawImage(img, 0, 0);
const d = sg.getImageData(0, 0, W, H).data;
const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

// Largest non-dark region = the whole icon (teal + sheet + monsters all connected).
function largestNonDark() {
  const seen = new Uint8Array(W * H);
  let best = null;
  const stack = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const idx = y * W + x;
    if (seen[idx] || lum(idx * 4) < 30) continue;
    let minx = x, miny = y, maxx = x, maxy = y, area = 0;
    stack.length = 0; stack.push(idx); seen[idx] = 1;
    while (stack.length) {
      const p = stack.pop(), px = p % W, py = (p / W) | 0;
      area++;
      if (px < minx) minx = px; if (px > maxx) maxx = px;
      if (py < miny) miny = py; if (py > maxy) maxy = py;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= W * H || seen[q]) continue;
        if (Math.abs((q % W) - px) > 1) continue;
        if (lum(q * 4) >= 30) { seen[q] = 1; stack.push(q); }
      }
    }
    if (!best || area > best.area) best = { minx, miny, maxx, maxy, area };
  }
  return best;
}
const b = largestNonDark();
const bw = b.maxx - b.minx + 1, bh = b.maxy - b.miny + 1;
console.log('icon bbox', b.minx, b.miny, bw, bh);
const teal = (() => { const i = ((((b.miny + b.maxy) / 2) | 0) * W + (b.minx + 6)) * 4; return [d[i], d[i + 1], d[i + 2]]; })();
const tealCss = `rgb(${teal[0]},${teal[1]},${teal[2]})`;
console.log('teal', tealCss);

// Crop the FULL bbox (nothing cut), then flood-fill the dark rounded-corner gaps -> teal.
const crop = createCanvas(bw, bh);
const cg = crop.getContext('2d');
cg.drawImage(sc, b.minx, b.miny, bw, bh, 0, 0, bw, bh);
const cim = cg.getImageData(0, 0, bw, bh), cd = cim.data;
const cl = (i) => 0.299 * cd[i] + 0.587 * cd[i + 1] + 0.114 * cd[i + 2];
const seen = new Uint8Array(bw * bh), st = [];
for (const [sx, sy] of [[0, 0], [bw - 1, 0], [0, bh - 1], [bw - 1, bh - 1]]) {
  const s0 = sy * bw + sx;
  if (!seen[s0] && cl(s0 * 4) < 24) { seen[s0] = 1; st.push(s0); }
}
while (st.length) {
  const p = st.pop(), i = p * 4;
  cd[i] = teal[0]; cd[i + 1] = teal[1]; cd[i + 2] = teal[2]; cd[i + 3] = 255;
  const px = p % bw;
  for (const q of [p - 1, p + 1, p - bw, p + bw]) {
    if (q < 0 || q >= bw * bh || seen[q]) continue;
    if (Math.abs((q % bw) - px) > 1) continue;
    if (cl(q * 4) < 24) { seen[q] = 1; st.push(q); }
  }
}
cg.putImageData(cim, 0, 0);

// Square it by padding the narrower side with teal (centred) — nothing is cropped.
const sideSq = Math.max(bw, bh);
const sq = createCanvas(sideSq, sideSq);
const qg = sq.getContext('2d');
qg.fillStyle = tealCss; qg.fillRect(0, 0, sideSq, sideSq);
qg.drawImage(crop, (sideSq - bw) / 2, (sideSq - bh) / 2);

const T = 1024;
function scaled(src, size) {
  const c = createCanvas(size, size); const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, size, size); return c;
}
const master = scaled(sq, T);
const roundRect = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };

// icon-only (full logo) for legacy + PWA
writeFileSync(join(outDir, 'master.png'), master.toBuffer('image/png'));
writeFileSync(join(assets, 'icon-only.png'), master.toBuffer('image/png'));

// Adaptive foreground: logo padded well inside the safe zone. Samsung/OneUI masks crop more
// aggressively than the Pixel launcher, so keep the content ~62% to guarantee nothing is clipped.
const F = 0.62;
const fg = createCanvas(T, T);
{ const g = fg.getContext('2d'); const s = T * F; g.drawImage(master, (T - s) / 2, (T - s) / 2, s, s); }
writeFileSync(join(assets, 'icon-foreground.png'), fg.toBuffer('image/png'));

// Adaptive background: solid teal.
const bgc = createCanvas(T, T);
{ const g = bgc.getContext('2d'); g.fillStyle = tealCss; g.fillRect(0, 0, T, T); }
writeFileSync(join(assets, 'icon-background.png'), bgc.toBuffer('image/png'));

// PWA icons from the full logo.
writeFileSync(join(root, 'public', 'icons', 'icon-512.png'), scaled(sq, 512).toBuffer('image/png'));
writeFileSync(join(root, 'public', 'icons', 'icon-192.png'), scaled(sq, 192).toBuffer('image/png'));

// Remove the old single icon.png so @capacitor/assets uses the trio unambiguously.
try { rmSync(join(assets, 'icon.png')); } catch {}

// ---- Verification preview: full + circle mask + rounded-square mask -----
{
  const adaptive = createCanvas(T, T);
  { const g = adaptive.getContext('2d'); g.drawImage(bgc, 0, 0); g.drawImage(fg, 0, 0); }
  const cw = 1360, ch = 470, box = 360, y = 40;
  const cmp = createCanvas(cw, ch);
  const g = cmp.getContext('2d');
  g.fillStyle = '#0e0a1e'; g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#ece8ff'; g.textAlign = 'center'; g.font = '600 26px system-ui, Arial, sans-serif';
  // 1: full master
  g.drawImage(master, 40, y, box, box); g.fillText('master (full)', 40 + box / 2, y + box + 34);
  // 2: circle mask of adaptive
  g.save(); g.beginPath(); g.arc(500 + box / 2, y + box / 2, box / 2, 0, Math.PI * 2); g.clip();
  g.drawImage(adaptive, 500, y, box, box); g.restore();
  g.fillText('máscara círculo', 500 + box / 2, y + box + 34);
  // 3: rounded-square mask of adaptive
  g.save(); roundRect(g, 960, y, box, box, box * 0.22); g.clip();
  g.drawImage(adaptive, 960, y, box, box); g.restore();
  g.fillText('máscara rounded', 960 + box / 2, y + box + 34);
  writeFileSync(join(outDir, 'icon-masked-preview.png'), cmp.toBuffer('image/png'));
}
console.log('[icon] wrote master + adaptive trio + PWA icons + masked preview');
