// Shared hand-read ground truth + scoring helpers for the OCR scorers (native and rescaled).
import { createCanvas, type Image } from '@napi-rs/canvas';
import { toPixels, Rect } from '../src/ocr/layout.js';
import { RegionData } from '../src/ocr/pixels.js';
import { buildOcrCanvas } from '../src/ocr/preprocess.js';
import { ocrText } from '../src/ocr/recognize.js';
import type { Screen } from '../src/ocr/extract.js';
import type { ChampionsMon } from '../src/domain/types.js';

export interface Truth {
  ev: [number, number, number, number, number, number];
  nature: string;
  ability: string;
  item: string;
  moves: [string, string, string, string];
}
export type Team = Record<string, Truth>;

export const TIAGO: Team = {
  Kingambit: { ev: [31, 16, 0, 0, 18, 1], nature: 'Adamant', ability: 'Defiant', item: 'Chople Berry', moves: ['Sucker Punch', 'Kowtow Cleave', 'Iron Head', 'Low Kick'] },
  Glimmora: { ev: [1, 0, 1, 32, 0, 32], nature: 'Timid', ability: 'Toxic Debris', item: 'Focus Sash', moves: ['Sludge Bomb', 'Power Gem', 'Earth Power', 'Spiky Shield'] },
  Whimsicott: { ev: [20, 0, 6, 8, 0, 32], nature: 'Timid', ability: 'Prankster', item: 'Occa Berry', moves: ['Moonblast', 'Tailwind', 'Charm', 'Light Screen'] },
  Delphox: { ev: [13, 0, 12, 18, 0, 23], nature: 'Timid', ability: 'Blaze', item: 'Delphoxite', moves: ['Heat Wave', 'Psychic', 'Substitute', 'Protect'] },
  Garchomp: { ev: [2, 32, 0, 0, 0, 32], nature: 'Jolly', ability: 'Rough Skin', item: 'Life Orb', moves: ['Dragon Claw', 'Earthquake', 'Rock Slide', 'Protect'] },
  Staraptor: { ev: [29, 1, 0, 0, 4, 32], nature: 'Jolly', ability: 'Intimidate', item: 'Staraptite', moves: ['Close Combat', 'Brave Bird', 'Roost', 'Protect'] },
};
export const OBLER: Team = {
  Vileplume: { ev: [2, 0, 0, 32, 0, 32], nature: 'Timid', ability: 'Chlorophyll', item: 'Focus Sash', moves: ['Sludge Bomb', 'Energy Ball', 'Sleep Powder', 'After You'] },
  Kangaskhan: { ev: [32, 0, 20, 0, 10, 4], nature: 'Adamant', ability: 'Scrappy', item: 'Kangaskhanite', moves: ['Double-Edge', 'Fake Out', 'Low Kick', 'Sucker Punch'] },
  Farigiraf: { ev: [32, 0, 1, 20, 13, 0], nature: 'Quiet', ability: 'Armor Tail', item: 'Colbur Berry', moves: ['Psychic', 'Hyper Voice', 'Protect', 'Trick Room'] },
  Torkoal: { ev: [32, 0, 0, 32, 2, 0], nature: 'Quiet', ability: 'Drought', item: 'Charcoal', moves: ['Eruption', 'Weather Ball', 'Earth Power', 'Protect'] },
  'Kommo-o': { ev: [5, 0, 1, 30, 1, 29], nature: 'Modest', ability: 'Overcoat', item: 'Haban Berry', moves: ['Clanging Scales', 'Aura Sphere', 'Protect', 'Clangorous Soul'] },
  Basculegion: { ev: [0, 32, 1, 0, 1, 32], nature: 'Jolly', ability: 'Adaptability', item: 'Choice Scarf', moves: ['Aqua Jet', 'Wave Crash', 'Flip Turn', 'Last Respects'] },
};
export const MATTEO: Team = {
  Pyroar: { ev: [2, 0, 0, 32, 0, 32], nature: 'Timid', ability: 'Unnerve', item: 'Pyroarite', moves: ['Heat Wave', 'Solar Beam', 'Overheat', 'Protect'] },
  Ninetales: { ev: [0, 0, 1, 32, 1, 32], nature: 'Modest', ability: 'Drought', item: 'Choice Scarf', moves: ['Overheat', 'Fake Tears', 'Solar Beam', 'Heat Wave'] },
  Whimsicott: { ev: [2, 0, 0, 32, 0, 32], nature: 'Timid', ability: 'Prankster', item: 'Focus Sash', moves: ['Moonblast', 'Protect', 'Sunny Day', 'Tailwind'] },
  Farigiraf: { ev: [25, 0, 10, 0, 24, 7], nature: 'Bold', ability: 'Armor Tail', item: 'Sitrus Berry', moves: ['Twin Beam', 'Thunderbolt', 'Trick Room', 'Helping Hand'] },
  Basculegion: { ev: [24, 18, 2, 0, 8, 14], nature: 'Adamant', ability: 'Adaptability', item: 'Life Orb', moves: ['Wave Crash', 'Last Respects', 'Aqua Jet', 'Protect'] },
  Floette: { ev: [0, 0, 2, 32, 0, 32], nature: 'Modest', ability: 'Flower Veil', item: 'Floettite', moves: ['Light of Ruin', 'Dazzling Gleam', 'Moonblast', 'Protect'] },
};
export const MIMI: Team = {
  Gardevoir: { ev: [2, 0, 0, 32, 0, 32], nature: 'Modest', ability: 'Trace', item: 'Lum Berry', moves: ['Psychic Noise', 'Moonblast', 'Mystical Fire', 'Vacuum Wave'] },
  Heracross: { ev: [2, 32, 0, 0, 0, 32], nature: 'Adamant', ability: 'Moxie', item: 'Sitrus Berry', moves: ['Close Combat', 'Pin Missile', 'Bullet Seed', 'Trailblaze'] },
  Drampa: { ev: [32, 0, 0, 32, 0, 2], nature: 'Modest', ability: 'Berserk', item: 'Leftovers', moves: ['Draco Meteor', 'Hyper Voice', 'Flamethrower', 'Thunderbolt'] },
  Azumarill: { ev: [32, 32, 0, 0, 0, 2], nature: 'Adamant', ability: 'Huge Power', item: 'White Herb', moves: ['Play Rough', 'Aqua Jet', 'Superpower', 'Belly Drum'] },
  Corviknight: { ev: [32, 0, 32, 0, 0, 2], nature: 'Impish', ability: 'Mirror Armor', item: 'Focus Sash', moves: ['Iron Head', 'Body Press', 'Iron Defense', 'Roost'] },
  Abomasnow: { ev: [32, 0, 0, 32, 0, 2], nature: 'Modest', ability: 'Snow Warning', item: 'Quick Claw', moves: ['Blizzard', 'Giga Drain', 'Leech Seed', 'Aurora Veil'] },
};
export const NANDO: Team = {
  Tyranitar: { ev: [2, 32, 0, 0, 0, 32], nature: 'Jolly', ability: 'Sand Stream', item: 'Lum Berry', moves: ['Stone Edge', 'Knock Off', 'Fire Punch', 'Dragon Dance'] },
  Arcanine: { ev: [32, 32, 0, 0, 0, 2], nature: 'Adamant', ability: 'Intimidate', item: 'Sitrus Berry', moves: ['Flare Blitz', 'Play Rough', 'Extreme Speed', 'Bulldoze'] },
  Whimsicott: { ev: [2, 0, 0, 32, 0, 32], nature: 'Timid', ability: 'Prankster', item: 'Leftovers', moves: ['Moonblast', 'Giga Drain', 'Leech Seed', 'Memento'] },
  Drampa: { ev: [32, 0, 0, 32, 0, 2], nature: 'Modest', ability: 'Berserk', item: 'White Herb', moves: ['Draco Meteor', 'Hyper Voice', 'Flamethrower', 'Thunderbolt'] },
  Aggron: { ev: [32, 32, 0, 0, 0, 2], nature: 'Adamant', ability: 'Sturdy', item: 'Focus Sash', moves: ['Stone Edge', 'Iron Head', 'Metal Burst', 'Stealth Rock'] },
  Sylveon: { ev: [32, 0, 0, 32, 0, 2], nature: 'Modest', ability: 'Pixilate', item: 'Quick Claw', moves: ['Hyper Voice', 'Shadow Ball', 'Yawn', 'Quick Attack'] },
};

// A brand-new 9th team (not used to develop the algorithm) — pure generalization check.
export const KATSUO: Team = {
  Pelipper: { ev: [0, 0, 0, 32, 2, 32], nature: 'Timid', ability: 'Drizzle', item: 'Focus Sash', moves: ['Wide Guard', 'Tailwind', 'Hurricane', 'Hydro Pump'] },
  Archaludon: { ev: [0, 0, 32, 32, 0, 2], nature: 'Modest', ability: 'Stamina', item: 'Leftovers', moves: ['Electro Shot', 'Flash Cannon', 'Draco Meteor', 'Protect'] },
  Basculegion: { ev: [0, 32, 2, 0, 0, 32], nature: 'Jolly', ability: 'Adaptability', item: 'Choice Scarf', moves: ['Wave Crash', 'Flip Turn', 'Aqua Jet', 'Last Respects'] },
  Greninja: { ev: [0, 0, 0, 32, 2, 32], nature: 'Timid', ability: 'Protean', item: 'Greninjite', moves: ['Hydro Pump', 'Dark Pulse', 'Protect', 'Ice Beam'] },
  Meganium: { ev: [32, 0, 0, 32, 1, 1], nature: 'Modest', ability: 'Overgrow', item: 'Meganiumite', moves: ['Solar Beam', 'Dazzling Gleam', 'Weather Ball', 'Synthesis'] },
  Sneasler: { ev: [0, 32, 2, 0, 0, 32], nature: 'Jolly', ability: 'Unburden', item: 'White Herb', moves: ['Fake Out', 'Dire Claw', 'Close Combat', 'Protect'] },
};

export const devices: Array<{ tag: string; f1: string; f2: string; team: Team }> = [
  { tag: 'phone1', f1: 'stats.jpg', f2: 'moves.jpg', team: TIAGO },
  { tag: 'phone2', f1: 'team2-stats.jpg', f2: 'team2-moves.jpg', team: TIAGO },
  { tag: 'obler', f1: 'obler-stats.jpg', f2: 'obler-moves.jpg', team: OBLER },
  { tag: 'matteo', f1: 'matteo-stats.jpg', f2: 'matteo-moves.jpg', team: MATTEO },
  { tag: 'switch', f1: 'switch-stats.jpg', f2: 'switch-moves.jpg', team: TIAGO },
  { tag: 'iphone', f1: 'ip-a.png', f2: 'ip-b.png', team: MIMI },
  { tag: 'fold-open', f1: 'fold-a.jpg', f2: 'fold-b.jpg', team: NANDO },
  { tag: 'fold-closed', f1: 'foldc-a.jpg', f2: 'foldc-b.jpg', team: NANDO },
  { tag: 'katsuo', f1: 'katsuo-stats.jpg', f2: 'katsuo-moves.jpg', team: KATSUO },
];

/** A drawable source (Image or Canvas) with pixel dimensions. */
export interface Drawable {
  width: number;
  height: number;
}

export function rdOf(img: Image | Drawable) {
  return (frac: Rect): RegionData => {
    const px = toPixels(frac, img.width, img.height);
    const c = createCanvas(px.w, px.h);
    c.getContext('2d').drawImage(img as unknown as Image, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);
    return { data: c.getContext('2d').getImageData(0, 0, px.w, px.h).data as unknown as Uint8ClampedArray, width: px.w, height: px.h };
  };
}

export function screenOf(img: Image | Drawable): Screen {
  const rd = rdOf(img);
  return {
    pixels: rd,
    ocr: async (frac, opts) => {
      const oc = buildOcrCanvas(rd(frac), (w, h) => createCanvas(w, h) as any, opts?.scale ?? 4, opts?.stripLines, opts?.despeck, opts?.threshold);
      const { text } = await ocrText((oc as any).toBuffer('image/png'), { numeric: opts?.numeric, psm: opts?.psm, keepLines: opts?.keepLines });
      return text;
    },
  };
}

export function canvasOf(img: Image | Drawable) {
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img as unknown as Image, 0, 0);
  return c;
}

/** Rescale a drawable to `factor` (aspect preserved) — a pure resolution change. */
export function rescale(img: Image | Drawable, factor: number) {
  const w = Math.max(1, Math.round(img.width * factor));
  const h = Math.max(1, Math.round(img.height * factor));
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img as unknown as Image, 0, 0, w, h);
  return c;
}

/** Return the list of mismatch strings for one extracted mon vs. its ground truth (empty = perfect). */
export function scoreMon(m: ChampionsMon, t: Truth): string[] {
  const errs: string[] = [];
  const ev = [m.evs.hp, m.evs.atk, m.evs.def, m.evs.spa, m.evs.spd, m.evs.spe];
  const sum = ev.reduce((a, b) => a + b, 0);
  if (sum !== 66) errs.push(`ev-sum=${sum}`);
  if (ev.join(',') !== t.ev.join(',')) errs.push(`ev[${ev.join('/')}]≠[${t.ev.join('/')}]`);
  if (m.nature !== t.nature) errs.push(`nature=${m.nature}≠${t.nature}`);
  if (m.ability !== t.ability) errs.push(`ability=${m.ability}≠${t.ability}`);
  if ((m.item ?? '') !== t.item) errs.push(`item=${m.item}≠${t.item}`);
  for (let j = 0; j < 4; j++) if (m.moves[j] !== t.moves[j]) errs.push(`move${j + 1}=${m.moves[j]}≠${t.moves[j]}`);
  return errs;
}

/** Score a team's extracted mons against ground truth (species-keyed, order-independent). */
export function scoreTeam(mons: ChampionsMon[], team: Team): { ok: number; errs: string[] } {
  const seen = new Set<string>();
  let ok = 0;
  const errs: string[] = [];
  for (const m of mons) {
    const t = team[m.species];
    if (!t) {
      errs.push(`  ✗ ${m.species}: species-not-in-team`);
      continue;
    }
    seen.add(m.species);
    const e = scoreMon(m, t);
    if (e.length === 0) ok++;
    else errs.push(`  ✗ ${m.species}: ${e.join('; ')}`);
  }
  const missing = Object.keys(team).filter((s) => !seen.has(s));
  if (missing.length) errs.push(`  ✗ missing: ${missing.join(', ')}`);
  return { ok, errs };
}
