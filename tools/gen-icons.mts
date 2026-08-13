import { createCanvas, Path2D } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync('C:/Projects/fontawesome/node_modules/@fortawesome/fontawesome-pro/svgs/solid/trophy.svg', 'utf8');
const d = svg.match(/d="([^"]*)"/)![1];
function icon(size: number) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  // purple gradient background, rounded
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#7c5cff'); g.addColorStop(1, '#33d0c0');
  ctx.fillStyle = g;
  const r = size * 0.18;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.arcTo(size, 0, size, size, r); ctx.arcTo(size, size, 0, size, r);
  ctx.arcTo(0, size, 0, 0, r); ctx.arcTo(0, 0, size, 0, r); ctx.closePath(); ctx.fill();
  // white trophy centered at 56% size
  const scale = (size * 0.56) / 512;
  const off = (size - 512 * scale) / 2;
  ctx.translate(off, off); ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fill(new Path2D(d));
  return c.toBuffer('image/png');
}
for (const s of [192, 512]) writeFileSync(join(root, `public/icons/icon-${s}.png`), icon(s));
console.log('icons written');
