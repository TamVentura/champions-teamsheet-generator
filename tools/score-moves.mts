import { loadImage, createCanvas, type Image } from '@napi-rs/canvas';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARDS, toPixels, Rect } from '../src/ocr/layout.js';
import { RegionData } from '../src/ocr/pixels.js';
import { buildOcrCanvas } from '../src/ocr/preprocess.js';
import { ocrText, terminateOcr } from '../src/ocr/recognize.js';
import { readMoves, type Screen } from '../src/ocr/extract.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GT: any = {
  team1: [['Sucker Punch','Kowtow Cleave','Iron Head','Low Kick'],['Sludge Bomb','Power Gem','Earth Power','Spiky Shield'],['Moonblast','Tailwind','Charm','Light Screen'],['Heat Wave','Psychic','Substitute','Protect'],['Dragon Claw','Earthquake','Rock Slide','Protect'],['Close Combat','Brave Bird','Roost','Protect']],
  team2: [['Close Combat','Brave Bird','Roost','Protect'],['Heat Wave','Psychic','Substitute','Protect'],['Moonblast','Tailwind','Charm','Light Screen'],['Dragon Claw','Earthquake','Rock Slide','Protect'],['Sludge Bomb','Power Gem','Earth Power','Spiky Shield'],['Sucker Punch','Kowtow Cleave','Iron Head','Low Kick']],
  obler: [['Sludge Bomb','Energy Ball','Sleep Powder','After You'],['Double-Edge','Fake Out','Low Kick','Sucker Punch'],['Psychic','Hyper Voice','Protect','Trick Room'],['Eruption','Weather Ball','Earth Power','Protect'],['Clanging Scales','Aura Sphere','Protect','Clangorous Soul'],['Aqua Jet','Wave Crash','Flip Turn','Last Respects']],
  matteo: [['Heat Wave','Solar Beam','Overheat','Protect'],['Overheat','Fake Tears','Solar Beam','Heat Wave'],['Moonblast','Protect','Sunny Day','Tailwind'],['Twin Beam','Thunderbolt','Trick Room','Helping Hand'],['Wave Crash','Last Respects','Aqua Jet','Protect'],['Light of Ruin','Dazzling Gleam','Moonblast','Protect']],
};
const files: any = { team1: 'moves.jpg', team2: 'team2-moves.jpg', obler: 'obler-moves.jpg', matteo: 'matteo-moves.jpg' };

function regionData(img: Image, frac: Rect): RegionData {
  const px = toPixels(frac, img.width, img.height);
  const c = createCanvas(px.w, px.h);
  const cx = c.getContext('2d');
  cx.drawImage(img, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);
  return { data: cx.getImageData(0, 0, px.w, px.h).data as any, width: px.w, height: px.h };
}
function nodeScreen(img: Image): Screen {
  return {
    pixels: (frac) => regionData(img, frac),
    ocr: async (frac, opts) => {
      const oc = buildOcrCanvas(regionData(img, frac), (w, h) => createCanvas(w, h) as any, opts?.scale ?? 4, opts?.stripLines, opts?.despeck);
      const { text } = await ocrText((oc as any).toBuffer('image/png'), { numeric: opts?.numeric, psm: opts?.psm, keepLines: opts?.keepLines });
      return text;
    },
  };
}

let ok = 0, tot = 0;
const fails: string[] = [];
for (const tk of Object.keys(files)) {
  const img = await loadImage(join(root, 'sample/' + files[tk]));
  const scr = nodeScreen(img);
  for (let slot = 0; slot < 6; slot++) {
    const { moves } = await readMoves(scr, CARDS[slot]);
    for (let j = 0; j < 4; j++) {
      tot++;
      if (moves[j] === GT[tk][slot][j]) ok++;
      else fails.push(`${tk}s${slot}.${j}:"${moves[j]}"!="${GT[tk][slot][j]}"`);
    }
  }
}
console.log(`moves ${ok}/${tot}`);
console.log(fails.join('\n'));
await terminateOcr();
