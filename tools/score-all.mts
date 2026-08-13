// Scorer: verify the fully content-adaptive OCR against hand-read ground truth for all 8
// screenshot pairs at native resolution. Per mon: EV spread sums to 66 AND equals ground truth;
// species/ability/item/all four moves exact vocab matches; nature correct. Species-keyed
// (order-independent), so reordered teams (team2/switch) reuse one truth table.
//   npx tsx tools/score-all.mts
import { loadImage } from '@napi-rs/canvas';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTeam } from '../src/ocr/extract.js';
import { classifyScreen } from '../src/ocr/classify.js';
import { terminateOcr } from '../src/ocr/recognize.js';
import { devices, screenOf, canvasOf, scoreTeam } from './ground-truth.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let total = 0;
const lines: string[] = [];
for (const { tag, f1, f2, team } of devices) {
  const i1 = await loadImage(join(root, 'sample', f1));
  const i2 = await loadImage(join(root, 'sample', f2));
  const k1 = classifyScreen(canvasOf(i1) as any);
  const [statsImg, movesImg] = k1 === 'stats' ? [i1, i2] : [i2, i1];
  const { mons } = await extractTeam(screenOf(statsImg), screenOf(movesImg));
  const { ok, errs } = scoreTeam(mons, team);
  total += ok;
  lines.push(`\n== ${tag} (${statsImg.width}x${statsImg.height}) ${ok}/6 ==`);
  if (errs.length) lines.push(...errs);
}
const max = devices.length * 6;
console.log(lines.join('\n'));
console.log(`\n==== TOTAL ${total}/${max} mons perfect ${total === max ? '✅ 100%' : '❌'} ====`);
await terminateOcr();
process.exit(total === max ? 0 : 1);
