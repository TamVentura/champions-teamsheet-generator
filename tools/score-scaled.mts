// Resolution-generalization test: prove the pipeline is resolution-independent, not fitted to the
// 8 native sample sizes. Each pair is rescaled (aspect preserved — a pure resolution change) to a
// range of factors and run through the full extractTeam pipeline, then scored against the same
// ground truth. Prints a per-pair × per-scale matrix of mons-correct/6 and the total X/48 per scale.
//   npx tsx tools/score-scaled.mts
import { loadImage } from '@napi-rs/canvas';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTeam } from '../src/ocr/extract.js';
import { classifyScreen } from '../src/ocr/classify.js';
import { terminateOcr } from '../src/ocr/recognize.js';
import { devices, screenOf, canvasOf, rescale, scoreTeam } from './ground-truth.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scales = [0.5, 0.6, 0.67, 0.75, 0.85, 1.0, 1.25, 1.33, 1.5, 2.0];

// Preload images once.
const imgs = await Promise.all(
  devices.map(async (d) => ({
    ...d,
    i1: await loadImage(join(root, 'sample', d.f1)),
    i2: await loadImage(join(root, 'sample', d.f2)),
  }))
);

const header = ['pair'.padEnd(12), ...scales.map((s) => `x${s}`.padStart(6))].join(' ');
console.log(header);
console.log('-'.repeat(header.length));

const totals = new Map<number, number>(scales.map((s) => [s, 0]));
const failures: string[] = [];

for (const d of imgs) {
  const cells: string[] = [];
  for (const s of scales) {
    const c1 = rescale(d.i1, s);
    const c2 = rescale(d.i2, s);
    const k1 = classifyScreen(c1 as any);
    const [statsC, movesC] = k1 === 'stats' ? [c1, c2] : [c2, c1];
    let ok = 0;
    try {
      const { mons } = await extractTeam(screenOf(statsC), screenOf(movesC));
      const res = scoreTeam(mons, d.team);
      ok = res.ok;
      if (res.ok < 6) failures.push(`x${s} ${d.tag} (${statsC.width}x${statsC.height}) ${res.ok}/6\n${res.errs.join('\n')}`);
    } catch (e) {
      failures.push(`x${s} ${d.tag}: THREW ${(e as Error).message}`);
    }
    totals.set(s, (totals.get(s) ?? 0) + ok);
    cells.push(`${ok}/6`.padStart(6));
  }
  console.log([d.tag.padEnd(12), ...cells].join(' '));
}
console.log('-'.repeat(header.length));
console.log(['TOTAL/48'.padEnd(12), ...scales.map((s) => `${totals.get(s)}`.padStart(6))].join(' '));

if (failures.length) {
  console.log('\n---- imperfect cells ----');
  console.log(failures.join('\n\n'));
}
await terminateOcr();
