import { ChampionsMon, STAT_KEYS, STAT_LABEL, TeamModel } from './types';
import { EV_BUDGET, EvSpread, StatKey, emptyEvs } from './types';
import { pokedex } from '../data/pokedex';
import { natures } from '../data/natures';
import type { FieldFlag } from '../ocr/extract';

/** Champions Pokémon are locked to level 50. */
const LEVEL = 50;

function monToText(mon: ChampionsMon): string {
  const lines: string[] = [];

  let header = mon.species;
  if (mon.gender) header += ` (${mon.gender})`;
  if (mon.item) header += ` @ ${mon.item}`;
  lines.push(header);

  lines.push(`Ability: ${mon.ability}`);
  lines.push(`Level: ${LEVEL}`);

  const evParts = STAT_KEYS.filter((k) => (mon.evs[k] || 0) > 0).map(
    (k) => `${mon.evs[k]} ${STAT_LABEL[k]}`
  );
  if (evParts.length) lines.push(`EVs: ${evParts.join(' / ')}`);

  lines.push(`${mon.nature} Nature`);

  for (const move of mon.moves) {
    if (move) lines.push(`- ${move}`);
  }

  return lines.join('\n');
}

/** Render a team as a Pokémon Showdown / PokePaste text block. */
export function toShowdownPaste(team: TeamModel): string {
  return team.mons.map(monToText).join('\n\n') + '\n';
}

// ---------------- Parsing (inverse of toShowdownPaste) ----------------

const EV_LABEL_TO_KEY: Record<string, StatKey> = {
  hp: 'hp',
  atk: 'atk',
  def: 'def',
  spa: 'spa',
  spd: 'spd',
  spe: 'spe',
};

/** Parse the header line: `Nickname (Species) (Gender) @ Item` and its simpler shapes. */
function parseHeader(line: string, mon: ChampionsMon): void {
  let s = line.trim();
  const at = s.indexOf('@');
  if (at >= 0) {
    mon.item = s.slice(at + 1).trim() || null;
    s = s.slice(0, at).trim();
  }
  const gender = s.match(/\(([MF])\)\s*$/i);
  if (gender) {
    mon.gender = gender[1].toUpperCase() as 'M' | 'F';
    s = s.slice(0, gender.index).trim();
  }
  const species = s.match(/\(([^)]+)\)\s*$/);
  mon.species = (species ? species[1] : s).trim();
}

/** Parse `EVs: 4 HP / 252 Atk / …` into the spread, verbatim (no budget conversion). */
function parseEvs(line: string, evs: EvSpread): void {
  for (const part of line.replace(/^EVs:/i, '').split('/')) {
    const match = part.trim().match(/^(\d+)\s+([A-Za-z]+)$/);
    if (!match) continue;
    const key = EV_LABEL_TO_KEY[match[2].toLowerCase()];
    if (key) evs[key] = Number(match[1]);
  }
}

function parseBlock(block: string): ChampionsMon {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const mon: ChampionsMon = {
    species: '',
    gender: null,
    ability: '',
    item: null,
    nature: '',
    evs: emptyEvs(),
    moves: ['', '', '', ''],
  };
  if (!lines.length) return mon;
  parseHeader(lines[0], mon);
  for (const line of lines.slice(1)) {
    if (/^Ability:/i.test(line)) mon.ability = line.replace(/^Ability:/i, '').trim();
    else if (/^EVs:/i.test(line)) parseEvs(line, mon.evs);
    else if (/Nature$/i.test(line)) mon.nature = line.replace(/Nature$/i, '').trim();
    else if (/^-\s/.test(line)) {
      const idx = mon.moves.findIndex((m) => !m);
      if (idx >= 0) mon.moves[idx] = line.replace(/^-\s*/, '').trim();
    }
    // Level:, IVs:, Tera Type:, Shiny:, Happiness:, etc. are intentionally ignored.
  }
  return mon;
}

/**
 * Parse a Pokémon Showdown / PokePaste text block into Champions mons. Values are carried
 * verbatim — no 508→66 EV conversion — and anything outside the Champions budget is surfaced as a
 * review FieldFlag (species unknown, nature missing/unknown, EV total ≠ 66) rather than corrected.
 */
export function parseShowdownPaste(text: string): { mons: ChampionsMon[]; flags: FieldFlag[] } {
  const blocks = text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 6);

  const mons: ChampionsMon[] = [];
  const flags: FieldFlag[] = [];

  blocks.forEach((block, slot) => {
    const mon = parseBlock(block);
    mons.push(mon);
    if (mon.species && !pokedex[mon.species]) {
      flags.push({ slot, field: 'species', reason: 'no-match' });
    }
    if (!mon.nature || !natures[mon.nature]) {
      flags.push({ slot, field: 'nature', reason: 'no-match' });
    }
    const total = STAT_KEYS.reduce((sum, k) => sum + (mon.evs[k] || 0), 0);
    if (total !== EV_BUDGET) {
      flags.push({ slot, field: 'evs', reason: 'bad-spread' });
    }
  });

  return { mons, flags };
}
