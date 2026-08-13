import { pokedex } from '../data/pokedex';
import { speciesTypes } from '../data/species-types';
import { speciesAbilities } from '../data/species-abilities';
import { STAT_KEYS, StatKey } from './types';
import { evFromFinalStat, getChampionsStats } from './champions';
import { isBaseForme } from './formes';

export interface InferenceSignals {
  ability: { value: string; confident: boolean } | null;
  types: { value: string[]; confident: boolean } | null;
  finalStats: Record<StatKey, number | null>;
  evDigits: Record<StatKey, number | null>;
  nature: string;
  assigned: Set<string>;
}

export interface InferenceResult {
  species: string;
  confident: boolean;
  candidates: string[];
  statScore: number;
}

// Candidate universe: base formes present in the stats table. Computed once.
const BASE_SPECIES: string[] = Object.keys(pokedex).filter(isBaseForme);

// Decision margins (see design §"Decision"). A winner is confident when it is clearly ahead:
// at least SCORE_GAP stat-points, or — on a score tie — RESIDUAL_GAP closer in summed residual.
const SCORE_GAP = 2;
const RESIDUAL_GAP = 3;

function sameTypeSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((t) => set.has(t));
}

interface Scored {
  species: string;
  score: number;
  residual: number;
}

/**
 * Stat-consistency score: for each stat with a read final value, invert it through the candidate's
 * base stat. A hit is an EV in 0..32 that also matches the independently-read EV digit (when that
 * digit is present). The trimmed residual (summed |computed − observed|, worst term dropped) breaks
 * score ties without letting a single wild misread dominate.
 */
function scoreCandidate(species: string, s: InferenceSignals): Scored {
  let score = 0;
  const evSpread = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } as Record<StatKey, number>;
  for (const key of STAT_KEYS) {
    const fv = s.finalStats[key];
    const digit = s.evDigits[key];
    if (fv != null) {
      const evs = evFromFinalStat(key, fv, species, s.nature);
      const digitHit = digit != null && evs.includes(digit);
      if (evs.length && (digit == null || digitHit)) {
        score++;
        // Residual uses the EV that reproduces the observed final stat, so a matched stat
        // contributes zero — the residual then measures only genuine mismatch.
        evSpread[key] = digitHit ? (digit as number) : evs[0];
        continue;
      }
    }
    // Stat not reproduced: fall back to the read EV digit (if any) for the residual estimate.
    if (digit != null && digit >= 0 && digit <= 32) evSpread[key] = digit;
  }

  const computed = getChampionsStats(species, evSpread, s.nature);
  const diffs: number[] = [];
  for (const key of STAT_KEYS) {
    const fv = s.finalStats[key];
    if (fv == null) continue;
    diffs.push(Math.abs(computed[key] - fv));
  }
  diffs.sort((a, b) => a - b);
  if (diffs.length) diffs.pop(); // drop the single worst term (trim)
  const residual = diffs.reduce((x, y) => x + y, 0);
  return { species, score, residual };
}

export function inferSpecies(s: InferenceSignals): InferenceResult {
  const abilityOn = !!(s.ability && s.ability.confident && s.ability.value);
  const typeOn = !!(s.types && s.types.confident && s.types.value.length);

  const applyFilters = (useAbility: boolean, useType: boolean): string[] =>
    BASE_SPECIES.filter((sp) => {
      if (s.assigned.has(sp)) return false; // Species Clause — always excludes confident picks
      if (useAbility) {
        const ab = speciesAbilities[sp];
        if (!ab || !ab.includes(s.ability!.value)) return false;
      }
      if (useType) {
        const ty = speciesTypes[sp];
        if (!ty || !sameTypeSet(ty, s.types!.value)) return false;
      }
      return true;
    });

  // Staged relaxation: full filters first; if none survive, drop the more error-prone type filter,
  // then the ability filter, then all filters. `relaxed` records that a filter had to be dropped.
  const stages: Array<[boolean, boolean]> = [[abilityOn, typeOn]];
  if (typeOn) stages.push([abilityOn, false]);
  if (abilityOn) stages.push([false, typeOn]);
  if (abilityOn && typeOn) stages.push([false, false]);

  let survivors: string[] = [];
  let stageIndex = 0;
  for (; stageIndex < stages.length; stageIndex++) {
    survivors = applyFilters(stages[stageIndex][0], stages[stageIndex][1]);
    if (survivors.length) break;
  }
  const relaxed = stageIndex > 0;

  if (!survivors.length) return { species: '', confident: false, candidates: [], statScore: 0 };

  const scored = survivors
    .map((sp) => scoreCandidate(sp, s))
    .sort((a, b) => b.score - a.score || a.residual - b.residual);

  const best = scored[0];
  if (scored.length === 1) {
    return { species: best.species, confident: !relaxed, candidates: [best.species], statScore: best.score };
  }

  const second = scored[1];
  const clearlyAhead =
    best.score - second.score >= SCORE_GAP ||
    (best.score >= second.score && second.residual - best.residual >= RESIDUAL_GAP);

  if (clearlyAhead && !relaxed) {
    return { species: best.species, confident: true, candidates: [best.species], statScore: best.score };
  }
  return {
    species: best.species,
    confident: false,
    candidates: scored.slice(0, 3).map((x) => x.species),
    statScore: best.score,
  };
}

/**
 * Resolve a whole team sequentially so the global Species Clause sees confident picks: read raw
 * per-card signals in parallel upstream, then feed them here in slot order. Each confident, non-empty
 * species is added to the shared `assigned` set before the next card is inferred.
 */
export function inferTeam(cards: Array<Omit<InferenceSignals, 'assigned'>>): InferenceResult[] {
  const assigned = new Set<string>();
  const results: InferenceResult[] = [];
  for (const c of cards) {
    const r = inferSpecies({ ...c, assigned });
    results.push(r);
    if (r.confident && r.species) assigned.add(r.species);
  }
  return results;
}
