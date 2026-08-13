// Visual calibration + integration harness (run with tsx).
//   npx tsx tools/ocr-harness.mts cards   -> dump each card crop
//   npx tsx tools/ocr-harness.mts fields  -> dump every field crop
//   npx tsx tools/ocr-harness.mts ocr     -> run full extraction, print JSON
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CARDS,
  toPixels,
  within,
  movesFields,
  statsFields,
  type Rect,
} from '../src/ocr/layout.js';
import { ocrText, terminateOcr } from '../src/ocr/recognize.js';
import { binarize, arrowScores, orangeFraction } from '../src/ocr/pixels.js';
import { snap } from '../src/ocr/snap.js';
import { vocab } from '../src/data/vocab.js';
import { evFromFinalStat, resolveEv, natureFromArrows } from '../src/domain/champions.js';
import type { StatKey } from '../src/domain/types.js';
import { buildOcrCanvas } from '../src/ocr/preprocess.js';
import { extractTeam, type Screen } from '../src/ocr/extract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(__dirname, 'out');
mkdirSync(outDir, { recursive: true });

function cropFrac(img: Image, frac: Rect) {
  const px = toPixels(frac, img.width, img.height);
  const c = createCanvas(px.w, px.h);
  c.getContext('2d').drawImage(img, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);
  return c;
}

function save(canvas: ReturnType<typeof createCanvas>, name: string) {
  writeFileSync(join(outDir, name), canvas.toBuffer('image/png'));
}

async function dumpCards() {
  for (const [screen, file] of [
    ['stats', 'sample/stats.jpg'],
    ['moves', 'sample/moves.jpg'],
  ] as const) {
    const img = await loadImage(join(root, file));
    CARDS.forEach((card, i) => save(cropFrac(img, card), `${screen}-card${i}.png`));
    console.log(`${screen}: ${img.width}x${img.height} -> dumped 6 cards`);
  }
}

async function dumpFields() {
  const stats = await loadImage(join(root, 'sample/stats.jpg'));
  const moves = await loadImage(join(root, 'sample/moves.jpg'));
  CARDS.forEach((card, i) => {
    save(cropFrac(moves, within(card, movesFields.name)), `f-moves${i}-name.png`);
    save(cropFrac(moves, within(card, movesFields.ability)), `f-moves${i}-ability.png`);
    save(cropFrac(moves, within(card, movesFields.item)), `f-moves${i}-item.png`);
    movesFields.moves.forEach((m, j) =>
      save(cropFrac(moves, within(card, m)), `f-moves${i}-move${j}.png`)
    );
    save(cropFrac(stats, within(card, statsFields.name)), `f-stats${i}-name.png`);
    statsFields.statValue.forEach((s, j) =>
      save(cropFrac(stats, within(card, s)), `f-stats${i}-val${j}.png`)
    );
    statsFields.evValue.forEach((s, j) =>
      save(cropFrac(stats, within(card, s)), `f-stats${i}-ev${j}.png`)
    );
  });
  console.log('dumped field crops for all cards');
}

function regionData(img: Image, frac: Rect) {
  const px = toPixels(frac, img.width, img.height);
  const c = createCanvas(px.w, px.h);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);
  const id = ctx.getImageData(0, 0, px.w, px.h);
  return { data: id.data as unknown as Uint8ClampedArray, width: px.w, height: px.h };
}

function toOcrBuffer(
  region: { data: Uint8ClampedArray; width: number; height: number },
  scale = 4
) {
  const bin = binarize(region);
  const small = createCanvas(region.width, region.height);
  const sctx = small.getContext('2d');
  const id = sctx.createImageData(region.width, region.height);
  id.data.set(bin.data);
  sctx.putImageData(id, 0, 0);

  const pad = Math.round(region.height * scale * 0.4);
  const bw = region.width * scale + pad * 2;
  const bh = region.height * scale + pad * 2;
  const big = createCanvas(bw, bh);
  const bctx = big.getContext('2d');
  bctx.fillStyle = 'white';
  bctx.fillRect(0, 0, bw, bh);
  bctx.imageSmoothingEnabled = true;
  bctx.drawImage(small, pad, pad, region.width * scale, region.height * scale);
  return big.toBuffer('image/png');
}

function nodeScreen(img: Image): Screen {
  return {
    pixels: (frac) => regionData(img, frac),
    ocr: async (frac, opts) => {
      const oc = buildOcrCanvas(regionData(img, frac), (w, h) => createCanvas(w, h) as any, opts?.scale ?? 4, opts?.stripLines, opts?.despeck, opts?.threshold);
      const { text } = await ocrText((oc as any).toBuffer('image/png'), {
        numeric: opts?.numeric,
        psm: opts?.psm,
        keepLines: opts?.keepLines,
      });
      return text;
    },
  };
}

async function runExtract() {
  const statsPath = process.argv[3] || join(root, 'sample/stats.jpg');
  const movesPath = process.argv[4] || join(root, 'sample/moves.jpg');
  const stats = nodeScreen(await loadImage(statsPath));
  const moves = nodeScreen(await loadImage(movesPath));
  const { mons, flags } = await extractTeam(stats, moves);
  mons.forEach((m, i) => {
    const sum = Object.values(m.evs).reduce((a, b) => a + b, 0);
    console.log(`\n#${i + 1} ${m.species} (${m.gender ?? '-'}) @ ${m.item ?? '-'}`);
    console.log(`   ${m.ability} | ${m.nature} | EVs ${JSON.stringify(m.evs)} = ${sum}`);
    console.log(`   moves: ${m.moves.join(', ')}`);
  });
  console.log('\nflags:', flags.map((f) => `${f.slot}:${f.field}(${f.reason})`).join(' ') || 'none');
  await terminateOcr();
}

function firstWords(s: string, n: number) {
  return s.split(' ').filter(Boolean).slice(0, n).join(' ');
}

async function runOcr() {
  const stats = await loadImage(join(root, 'sample/stats.jpg'));
  const moves = await loadImage(join(root, 'sample/moves.jpg'));
  for (let i = 0; i < CARDS.length; i++) {
    const card = CARDS[i];
    const nameRaw = (await ocrText(toOcrBuffer(regionData(moves, within(card, movesFields.name))))).text;
    const abilityRaw = (await ocrText(toOcrBuffer(regionData(moves, within(card, movesFields.ability))))).text;
    const itemRaw = (await ocrText(toOcrBuffer(regionData(moves, within(card, movesFields.item))))).text;
    const name = snap(firstWords(nameRaw, 1), vocab.species);
    const ability = snap(abilityRaw, vocab.abilities);
    const item = snap(itemRaw, vocab.items);
    const mv: string[] = [];
    for (const m of movesFields.moves) {
      const r = (await ocrText(toOcrBuffer(regionData(moves, within(card, m))))).text;
      mv.push(snap(r, vocab.moves).value);
    }
    // Nature from arrows (red up = boosted, blue down = hindered) via global argmax.
    const arrowScoresByKey = STAT_ARROW_KEYS.map((k) => ({
      k,
      ...arrowScores(regionData(stats, within(card, statsFields.natureArrow[k]))),
    }));
    const MIN_ARROW = 40;
    const topRed = [...arrowScoresByKey].sort((a, b) => b.red - a.red)[0];
    const topBlue = [...arrowScoresByKey].sort((a, b) => b.blue - a.blue)[0];
    const up = topRed.red >= MIN_ARROW ? topRed.k : null;
    const down = topBlue.blue >= MIN_ARROW ? topBlue.k : null;
    const nature = natureFromArrows(up, down);

    const STAT_ORDER: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
    const values: number[] = [];
    const evs: number[] = [];
    const digits: number[] = [];
    const bars: number[] = [];
    for (let s = 0; s < 6; s++) {
      const value = Number((await ocrText(toOcrBuffer(regionData(stats, within(card, statsFields.statValue[s])), 5), { numeric: true })).text) || 0;
      const digitN = Number((await ocrText(toOcrBuffer(regionData(stats, within(card, statsFields.evValue[s])), 6), { numeric: true })).text);
      const barFrac = orangeFraction(regionData(stats, within(card, statsFields.evBar[s])));
      const fromValue = evFromFinalStat(STAT_ORDER[s], value, name.value, nature);
      const { ev } = resolveEv(fromValue, Number.isFinite(digitN) ? digitN : null, barFrac);
      values.push(value);
      digits.push(Number.isFinite(digitN) ? digitN : -1);
      bars.push(Math.round(barFrac * 32));
      evs.push(ev);
    }
    console.log(`\n--- card ${i} ---`);
    console.log('name   :', JSON.stringify(nameRaw), '->', name.value, `(d${name.distance})`);
    console.log('ability:', JSON.stringify(abilityRaw), '->', ability.value, `(d${ability.distance})`);
    console.log('item   :', JSON.stringify(itemRaw), '->', item.value, `(d${item.distance})`);
    console.log('moves  :', JSON.stringify(mv));
    console.log('nature :', nature, `(up=${up} down=${down})`);
    console.log('values :', values);
    console.log('ev dig :', digits, ' bar:', bars);
    console.log('EV     :', evs, 'sum', evs.reduce((a, b) => a + b, 0));
  }
  await terminateOcr();
}

const STAT_ARROW_KEYS = ['atk', 'def', 'spa', 'spd', 'spe'] as const;

async function dumpStrips() {
  const stats = await loadImage(join(root, 'sample/stats.jpg'));
  // Wide strips over each stat row of card 0 to measure value/bar/number x positions.
  const rows = [
    { name: 'hp', y: 0.4 },
    { name: 'atk', y: 0.62 },
    { name: 'def', y: 0.83 },
  ];
  for (const r of rows) {
    save(cropFrac(stats, within(CARDS[0], { x: 0.18, y: r.y, w: 0.82, h: 0.18 })), `strip0-${r.name}.png`);
    save(cropFrac(stats, within(CARDS[0], { x: 0.62, y: r.y, w: 0.38, h: 0.18 })), `stripR0-${r.name}.png`);
  }
  console.log('dumped stat-row strips for card 0');
}

function detectNature(stats: Image, card: Rect): string {
  const keys: StatKey[] = ['atk', 'def', 'spa', 'spd', 'spe'];
  const scores = keys.map((k) => ({ k, ...arrowScores(regionData(stats, within(card, statsFields.natureArrow[k]))) }));
  const MIN = 40;
  const topRed = [...scores].sort((a, b) => b.red - a.red)[0];
  const topBlue = [...scores].sort((a, b) => b.blue - a.blue)[0];
  const up = topRed.red >= MIN ? topRed.k : null;
  const down = topBlue.blue >= MIN ? topBlue.k : null;
  return natureFromArrows(up, down);
}

async function dumpArrows() {
  const stats = await loadImage(join(root, 'sample/stats.jpg'));
  const expected = ['Adamant', 'Timid', 'Timid', 'Timid', 'Jolly', 'Jolly'];
  const keys = ['atk', 'def', 'spa', 'spd', 'spe'] as const;
  for (let i = 0; i < CARDS.length; i++) {
    const scoreStr = keys
      .map((k) => {
        const s = arrowScores(regionData(stats, within(CARDS[i], statsFields.natureArrow[k])));
        return `${k}(r${s.red}/b${s.blue})`;
      })
      .join(' ');
    const nat = detectNature(stats, CARDS[i]);
    const ok = nat === expected[i] ? 'OK' : `WRONG want ${expected[i]}`;
    console.log(`card${i}: ${nat} [${ok}]  ${scoreStr}`);
  }
}

const cmd = process.argv[2] || 'cards';
if (cmd === 'arrows') await dumpArrows();
else if (cmd === 'cards') await dumpCards();
else if (cmd === 'fields') await dumpFields();
else if (cmd === 'ocr') await runOcr();
else if (cmd === 'extract') await runExtract();
else if (cmd === 'strips') await dumpStrips();
else console.log('unknown cmd', cmd);
