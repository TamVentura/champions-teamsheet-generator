import { pokedex } from '../data/pokedex';
import { natures } from '../data/natures';
import {
  EV_BUDGET,
  EV_STAT_CAP,
  EvSpread,
  STAT_KEYS,
  StatKey,
} from './types';

/**
 * Champions stat calculation. Pokémon are locked at level 50 with max IVs, so:
 *   HP    = base + 75 + evHP
 *   other = floor((base + 20 + ev) * natureMultiplier)
 */
export function getChampionsStats(
  species: string,
  evs: EvSpread,
  nature: string
): Record<StatKey, number> {
  const base = pokedex[species];
  if (!base) throw new Error(`Unknown species: ${species}`);
  const mult = natures[nature] ?? natures['Serious'];
  const out = {} as Record<StatKey, number>;
  for (const key of STAT_KEYS) {
    if (key === 'hp') {
      out.hp = base.hp + 75 + evs.hp;
    } else {
      out[key] = Math.floor((base[key] + 20 + evs[key]) * mult[key]);
    }
  }
  return out;
}

/**
 * Map the Stats-screen nature arrows to a nature name.
 * `up` is the boosted stat (red up arrow, x1.1), `down` the hindered stat (x0.9).
 * If either is missing, the nature is neutral -> 'Serious'.
 */
export function natureFromArrows(up: StatKey | null, down: StatKey | null): string {
  if (!up || !down || up === down || up === 'hp' || down === 'hp') return 'Serious';
  for (const [name, m] of Object.entries(natures)) {
    if (m[up] === 1.1 && m[down] === 0.9) return name;
  }
  return 'Serious';
}

/** Inverse of natureFromArrows: the (boosted, hindered) pair for a nature, or null if neutral. */
export function arrowsFromNature(nature: string): { up: StatKey; down: StatKey } | null {
  const m = natures[nature];
  if (!m) return null;
  let up: StatKey | null = null;
  let down: StatKey | null = null;
  for (const key of STAT_KEYS) {
    if (m[key] === 1.1) up = key;
    if (m[key] === 0.9) down = key;
  }
  return up && down ? { up, down } : null;
}

/**
 * Invert the Champions stat formula: given the displayed final stat value, the species
 * base stat and the nature, return the EV(s) in 0..32 that reproduce that final value.
 * HP is exact; for multiplied stats the floor can make two adjacent EVs collide, so this
 * returns every EV that matches (usually one).
 */
export function evFromFinalStat(
  key: StatKey,
  finalValue: number,
  species: string,
  nature: string
): number[] {
  const base = pokedex[species]?.[key];
  if (base === undefined) return [];
  if (key === 'hp') {
    const ev = finalValue - base - 75;
    return ev >= 0 && ev <= 32 ? [ev] : [];
  }
  const mult = (natures[nature] ?? natures['Serious'])[key];
  const matches: number[] = [];
  for (let ev = 0; ev <= 32; ev++) {
    if (Math.floor((base + 20 + ev) * mult) === finalValue) matches.push(ev);
  }
  return matches;
}

/**
 * Resolve one EV from the two signals that describe it directly: the OCR of the small number
 * after the bar (primary), and the orange bar fraction * 32 (secondary, used only when the
 * number is unreadable). The final stat is deliberately NOT used to pick the value — it is only
 * used afterwards, by the caller, to warn when a stat can't be reproduced (see statMismatch).
 */
export function resolveEv(
  fromValue: number[],
  fromDigit: number | null,
  fromBar: number
): { ev: number; confident: boolean } {
  const barEv = Math.min(32, Math.max(0, Math.round(fromBar * 32)));
  const digitValid = fromDigit != null && fromDigit >= 0 && fromDigit <= 32;

  // 1) A unique inversion of the final stat is the exact EV (the big final-stat number OCRs
  //    reliably, and this is arithmetic, not a guess). Trust it.
  if (fromValue.length === 1) return { ev: fromValue[0], confident: true };

  // 2) Floor made two EVs map to the same final stat: pick the one the small number/bar agrees
  //    with.
  if (fromValue.length > 1) {
    if (digitValid && fromValue.includes(fromDigit!)) return { ev: fromDigit!, confident: true };
    let best = fromValue[0];
    for (const c of fromValue) if (Math.abs(c - barEv) < Math.abs(best - barEv)) best = c;
    return { ev: best, confident: false };
  }

  // 3) The final stat was unreadable -> fall back to the small number, then the bar.
  if (digitValid) return { ev: fromDigit!, confident: Math.abs(fromDigit! - barEv) <= 2 };
  return { ev: barEv, confident: false };
}

/**
 * Validation-only check: which stats does the resolved EV spread FAIL to reproduce?
 * Recomputes each final stat from (base, ev, nature) and returns the stat keys whose result
 * differs from the observed on-screen value — those are the ones to flag for review.
 */
export function statMismatch(
  species: string,
  evs: EvSpread,
  nature: string,
  observed: Partial<Record<StatKey, number>>
): StatKey[] {
  let computed: Record<StatKey, number>;
  try {
    computed = getChampionsStats(species, evs, nature);
  } catch {
    return [];
  }
  return STAT_KEYS.filter((k) => {
    const obs = observed[k];
    return obs != null && obs > 0 && computed[k] !== obs;
  });
}

export interface SpreadValidation {
  total: number;
  ok: boolean;
  overCap: StatKey[];
  notMaxed: boolean;
}

export function validateSpread(evs: EvSpread): SpreadValidation {
  const total = STAT_KEYS.reduce((s, k) => s + (evs[k] || 0), 0);
  const overCap = STAT_KEYS.filter((k) => (evs[k] || 0) > EV_STAT_CAP);
  const notMaxed = total < EV_BUDGET;
  const ok = total === EV_BUDGET && overCap.length === 0;
  return { total, ok, overCap, notMaxed };
}
