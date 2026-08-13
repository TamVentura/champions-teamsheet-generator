import {
  ChampionsMon,
  EvSpread,
  STAT_KEYS,
  StatKey,
} from '../domain/types';
import { validateSpread } from '../domain/champions';
import { vocab } from '../data/vocab';
import { CARDS, within, Rect } from './layout';
import { RegionData } from './pixels';
import { snap } from './snap';
import { detectPanels, panelToCardBox } from './panels';
import {
  analyzeStatsCard,
  analyzeMovesCard,
  detectStatsGrid,
  detectMovesGrid,
} from './card';
import { inferTeam, InferenceSignals, InferenceResult } from '../domain/speciesInference';
import { isBaseForme } from '../domain/formes';

// Champions displays base species names, never the alternate-forme suffixes the vocab also
// contains. Matching a base name against those forms lets OCR junk snap to e.g. "Kangaskhan-Mega",
// so names are matched against a base-only list.
import { FORME_SUFFIX } from '../domain/formes';
const speciesBase: string[] = vocab.species.filter((s) => !FORME_SUFFIX.test(s));

// Real base-forme species names, for the name-mismatch check (a confident name that is itself a
// real base species but differs from the inference is the decoy-nickname / rare-error case).
const speciesBaseSet = new Set(speciesBase.filter(isBaseForme));

/** Card boxes for a screen via colour-based panel detection. Each detected panel is used as-is
 *  (no grid regularization): every field is located from each card's own content, so per-card
 *  position/size jitter is absorbed downstream — and forcing a uniform grid would actually shift
 *  cards on screens where one panel is partly occluded (e.g. a phone notification banner). Falls
 *  back to the static phone layout only if a clean 2x3 panel set isn't found. */
function cardBoxesFor(screen: Screen): Rect[] {
  const panels = detectPanels(screen.pixels({ x: 0, y: 0, w: 1, h: 1 }));
  if (panels.length !== 6) return CARDS;
  return panels.map(panelToCardBox);
}

export interface OcrRequest {
  numeric?: boolean;
  scale?: number;
  psm?: string;
  keepLines?: boolean;
  stripLines?: boolean;
  despeck?: boolean;
  /** Binarization luminance threshold (higher = thinner strokes; needed for bright, JPG-blurred
   *  name/move text that otherwise bloats and merges). */
  threshold?: number;
}

export interface Screen {
  /** Raw RGBA pixels of a fractional region (for colour/content analysis). */
  pixels(frac: Rect): RegionData;
  /** OCR the (preprocessed) region; `numeric` restricts to digits. `lane` selects the worker so
   *  several cards can OCR in parallel (each concurrent card must use its own lane). */
  ocr(frac: Rect, opts?: OcrRequest, lane?: number): Promise<string>;
}

export type FlagReason =
  | 'no-match'
  | 'low-confidence'
  | 'bad-spread'
  | 'ambiguous-species'
  | 'name-mismatch';

export interface FieldFlag {
  slot: number;
  field: string;
  reason: FlagReason;
  candidates?: string[];
}

export interface ExtractResult {
  mons: ChampionsMon[];
  flags: FieldFlag[];
}


function detectGender(region: RegionData): 'M' | 'F' | null {
  const { data, width, height } = region;
  let male = 0;
  let female = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (b > 150 && b - r > 30 && b - g > 20) male++; // ♂ blue
    else if (r > 150 && r - g > 40 && b - g > 20) female++; // ♀ pink/magenta
  }
  const min = Math.max(20, width * height * 0.01);
  if (male < min && female < min) return null;
  return male >= female ? 'M' : 'F';
}

/** OCR a field band and match it to the vocabulary with the stroke/space-tolerant matcher. If the
 *  band OCRs empty (a stray mark above the glyphs fooled single-line OCR), retry on its lower
 *  ~65% (the actual glyph row). */
interface Match {
  value: string;
  distance: number;
  confident: boolean;
}

/**
 * OCR a field band at several binarization thresholds and keep the best vocabulary match. Text
 * brightness varies (bright names/moves vs. lighter ability/item) and JPG blur bloats strokes at
 * low thresholds, so no single threshold reads every field on every device — trying a few and
 * taking the closest snap is robust. No despeck (it deletes the thin i/l/r strokes of this narrow
 * font); upscale generously so those strokes survive. If a band OCRs empty (a stray mark above the
 * glyphs fooled single-line OCR), the lower ~65% of the band is retried.
 */
/**
 * Read one field by VOTING across binarization thresholds (and the lower-band retry). No single
 * threshold reads every field on every device — text brightness varies and JPG blur bloats
 * strokes — but across a spread of thresholds the true word is by far the most common snap result
 * while corrupted reads scatter to different wrong entries. So we tally the snapped values and
 * pick the winner: confident first, then most votes, then smallest distance. This is far steadier
 * than picking a single "best" read. (No despeck: it deletes the thin i/l/r strokes of this narrow
 * font; the generous upscale keeps them.)
 */
async function readBand(moves: Screen, frac: Rect, list: string[], thresholds: number[], lane: number, debugLabel?: string): Promise<Match> {
  const votes = new Map<string, { count: number; minDist: number; confident: boolean }>();
  const dbg: string[] = [];
  const lower: Rect = { x: frac.x, y: frac.y + frac.h * 0.35, w: frac.w, h: frac.h * 0.65 };
  const tally = async (region: Rect) => {
    for (const threshold of thresholds) {
      const raw = (await moves.ocr(region, { psm: '7', stripLines: true, scale: 6, threshold }, lane)).trim();
      if (debugLabel) dbg.push(`      t${threshold}: raw=${JSON.stringify(raw)}${raw ? ` -> ${JSON.stringify(snap(raw, list).value)} d${snap(raw, list).distance}${snap(raw, list).confident ? ' ✓' : ''}` : ''}`);
      if (!raw) continue;
      const s = snap(raw, list);
      if (!s.value) continue;
      const v = votes.get(s.value) ?? { count: 0, minDist: Infinity, confident: false };
      v.count++;
      v.minDist = Math.min(v.minDist, s.distance);
      v.confident = v.confident || s.confident;
      votes.set(s.value, v);
    }
  };
  await tally(frac);
  if (votes.size === 0) await tally(lower); // full band saw only stray marks — retry lower slice
  let best: Match = { value: '', distance: Infinity, confident: false };
  let bestCount = 0;
  for (const [value, v] of votes) {
    const better =
      v.confident !== best.confident ? v.confident : v.count !== bestCount ? v.count > bestCount : v.minDist < best.distance;
    if (better) {
      best = { value, distance: v.minDist, confident: v.confident };
      bestCount = v.count;
    }
  }
  if (debugLabel) {
    const table = [...votes.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[1].minDist - b[1].minDist)
      .map(([val, v]) => `${JSON.stringify(val)}×${v.count}(d${v.minDist}${v.confident ? '✓' : ''})`)
      .join('  ');
    // eslint-disable-next-line no-console
    console.log(`  [${debugLabel}] -> ${JSON.stringify(best.value)} d${best.distance}${best.confident ? ' ✓' : ' ✗flagged'}\n    votes: ${table}\n${dbg.join('\n')}`);
  }
  return best;
}

// A spread of thresholds for the vote — spanning the lighter grey ability/item text and the
// brighter (often JPG-blurred) name/move text so at least a few land in each field's sweet spot.
const FIELD_T = [150, 165, 180, 195, 210];

/**
 * Resolve species for every slot from its inference signals, then derive the per-slot species flags.
 * Runs inference sequentially (Species Clause), so slots must be passed in slot order. `names` are
 * the OCR'd name snaps, used only for the name-mismatch warning — never to decide the species.
 */
export function resolveTeamSpecies(
  signals: Array<Omit<InferenceSignals, 'assigned'>>,
  names: Array<{ value: string; confident: boolean }>,
): Array<{ result: InferenceResult; flags: FieldFlag[] }> {
  const results = inferTeam(signals);
  return results.map((result, slot) => {
    const flags: FieldFlag[] = [];
    if (!result.confident) {
      if (result.candidates.length > 1) {
        flags.push({ slot, field: 'species', reason: 'ambiguous-species', candidates: result.candidates });
      } else {
        flags.push({ slot, field: 'species', reason: 'no-match' });
      }
    } else {
      const name = names[slot];
      if (name && name.confident && speciesBaseSet.has(name.value) && name.value !== result.species) {
        flags.push({ slot, field: 'species', reason: 'name-mismatch' });
      }
    }
    return { result, flags };
  });
}

export async function extractTeam(
  stats: Screen,
  moves: Screen,
  onProgress?: (done: number, total: number) => void
): Promise<ExtractResult> {
  const statsCards = cardBoxesFor(stats);
  const movesCards = cardBoxesFor(moves);
  const statsRegs = statsCards.map((c) => stats.pixels(c));
  const movesRegs = movesCards.map((c) => moves.pixels(c));
  const statsGrid = detectStatsGrid(statsRegs);
  const movesGrid = detectMovesGrid(movesRegs);

  const total = statsCards.length;
  const flags: FieldFlag[] = [];
  let done = 0;

  interface CardRaw {
    nameSnap: Match;
    ability: Match;
    item: Match | null;
    moves: string[];
    moveFlags: FieldFlag[];
    gender: 'M' | 'F' | null;
    nature: string;
    evs: EvSpread;
    lowConf: StatKey[];
    spread: ReturnType<typeof validateSpread>;
    finalStats: Record<StatKey, number | null>;
    evDigits: Record<StatKey, number | null>;
  }
  const raws: CardRaw[] = new Array(total);

  // One card's full raw read. All OCR here uses `lane`, so concurrent cards (each on its own lane)
  // never share a worker and can't race on setParameters. Every card is independent, so results
  // are identical regardless of how they're scheduled — determinism is preserved. Species is NOT
  // decided here: only the raw signals (name snap, ability, stats) are collected, so the second
  // pass can apply the Species Clause across the whole team.
  async function readCard(slot: number, lane: number): Promise<void> {
    const statsCard = statsCards[slot];
    const movesCard = movesCards[slot];
    const st = analyzeStatsCard(statsRegs[slot], statsGrid);
    const mv = analyzeMovesCard(movesRegs[slot], movesGrid);

    const D = typeof process !== 'undefined' && process.env?.OCR_DEBUG ? `slot${slot}` : undefined;
    let nameSnap = await readBand(moves, within(movesCard, mv.name), speciesBase, FIELD_T, lane, D && `${D} name`);
    if (!nameSnap.confident) {
      const alt = await readBand(stats, within(statsCard, st.name), speciesBase, FIELD_T, lane, D && `${D} name(stats)`);
      if (alt.confident) nameSnap = alt;
    }

    const abilitySnap = await readBand(moves, within(movesCard, mv.ability), vocab.abilities, FIELD_T, lane, D && `${D} ABILITY`);
    const itemSnap = mv.item ? await readBand(moves, within(movesCard, mv.item), vocab.items, FIELD_T, lane) : null;

    const moveList: string[] = [];
    const moveFlags: FieldFlag[] = [];
    for (let j = 0; j < 4; j++) {
      const s = await readBand(moves, within(movesCard, mv.moves[j]), vocab.moves, FIELD_T, lane);
      moveList.push(s.value);
      if (!s.confident) moveFlags.push({ slot, field: `move${j + 1}`, reason: 'no-match' });
    }

    const gender = detectGender(moves.pixels(within(movesCard, mv.name)));
    const evs: EvSpread = st.evs;
    const lowConf: StatKey[] = STAT_KEYS.filter((_, i) => !st.evConfident[i]);
    const spread = validateSpread(evs);

    raws[slot] = {
      nameSnap,
      ability: abilitySnap,
      item: itemSnap,
      moves: moveList,
      moveFlags,
      gender,
      nature: st.nature,
      evs,
      lowConf,
      spread,
      finalStats: st.finalStats,
      evDigits: st.evDigits,
    };
    onProgress?.(++done, total);
  }

  // Read the cards in parallel batches — one lane (worker) per concurrent card. This is the main
  // speed win on phones: the 6 serial reads become ~LANES-way parallel.
  const LANES = Math.min(3, total);
  onProgress?.(0, total);
  for (let base = 0; base < total; base += LANES) {
    const batch: Promise<void>[] = [];
    for (let k = 0; k < LANES && base + k < total; k++) batch.push(readCard(base + k, k));
    await Promise.all(batch);
  }

  // Second pass: resolve species across the whole team (Species Clause) and derive species flags.
  const signals = raws.map((r) => ({
    ability: r.ability.value ? { value: r.ability.value, confident: r.ability.confident } : null,
    types: null as { value: string[]; confident: boolean } | null, // populated by Task 6
    finalStats: r.finalStats,
    evDigits: r.evDigits,
    nature: r.nature,
  }));
  const names = raws.map((r) => ({ value: r.nameSnap.value, confident: r.nameSnap.confident }));
  const resolved = resolveTeamSpecies(signals, names);

  const monBySlot: ChampionsMon[] = new Array(total);
  for (let slot = 0; slot < total; slot++) {
    const r = raws[slot];
    const { result, flags: speciesFlags } = resolved[slot];
    const cardFlags: FieldFlag[] = [...r.moveFlags, ...speciesFlags];

    if (!r.spread.ok) cardFlags.push({ slot, field: 'evs', reason: 'bad-spread' });
    for (const key of r.spread.overCap) cardFlags.push({ slot, field: `ev.${key}`, reason: 'low-confidence' });
    for (const key of r.lowConf) cardFlags.push({ slot, field: `ev.${key}`, reason: 'low-confidence' });
    if (!r.ability.confident) cardFlags.push({ slot, field: 'ability', reason: 'no-match' });
    if (r.item && !r.item.confident) cardFlags.push({ slot, field: 'item', reason: 'no-match' });

    monBySlot[slot] = {
      species: result.species || r.nameSnap.value,
      gender: r.gender,
      ability: r.ability.value,
      item: r.item ? r.item.value : null,
      nature: r.nature,
      evs: r.evs,
      moves: r.moves,
    };
    flags.push(...cardFlags);
  }

  return { mons: monBySlot, flags };
}
