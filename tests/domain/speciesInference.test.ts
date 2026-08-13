import { describe, it, expect } from 'vitest';
import { inferSpecies, inferTeam, InferenceSignals } from '../../src/domain/speciesInference';
import { getChampionsStats } from '../../src/domain/champions';
import { STAT_KEYS, StatKey } from '../../src/domain/types';

const NATURE = 'Modest'; // spa up, atk down
const EVS = { hp: 0, atk: 0, def: 3, spa: 31, spd: 0, spe: 32 };

function finalStatsFor(species: string): Record<StatKey, number | null> {
  const s = getChampionsStats(species, EVS, NATURE);
  const out = {} as Record<StatKey, number | null>;
  for (const k of STAT_KEYS) out[k] = s[k];
  return out;
}
function evDigitsFor(): Record<StatKey, number | null> {
  const out = {} as Record<StatKey, number | null>;
  for (const k of STAT_KEYS) out[k] = EVS[k];
  return out;
}
function base(overrides: Partial<InferenceSignals> = {}): InferenceSignals {
  return {
    ability: null,
    types: null,
    finalStats: finalStatsFor('Charizard'), // == Typhlosion's
    evDigits: evDigitsFor(),
    nature: NATURE,
    assigned: new Set<string>(),
    ...overrides,
  };
}

describe('inferSpecies', () => {
  it('type separates the identical-stat pair', () => {
    const zard = inferSpecies(base({ types: { value: ['Fire', 'Flying'], confident: true } }));
    expect(zard.species).toBe('Charizard');
    expect(zard.confident).toBe(true);

    const typh = inferSpecies(base({ types: { value: ['Fire'], confident: true } }));
    expect(typh.species).toBe('Typhlosion');
    expect(typh.confident).toBe(true);
  });

  it('shared ability with no type is ambiguous, listing both', () => {
    const r = inferSpecies(base({ ability: { value: 'Blaze', confident: true } }));
    expect(r.confident).toBe(false);
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.candidates.length).toBeLessThanOrEqual(3);
    expect(r.candidates).toContain('Charizard');
    expect(r.candidates).toContain('Typhlosion');
  });

  it('unique ability wins even with one misread stat (5/6)', () => {
    // Shedinja is the only species with Wonder Guard.
    const good = finalStatsFor('Shedinja');
    good.spe = (good.spe ?? 0) + 40; // corrupt one stat
    const r = inferSpecies(base({
      ability: { value: 'Wonder Guard', confident: true },
      types: null,
      finalStats: good,
      evDigits: { hp: null, atk: null, def: null, spa: null, spd: null, spe: null },
      nature: NATURE,
    }));
    expect(r.species).toBe('Shedinja');
    expect(r.confident).toBe(true);
    expect(r.statScore).toBe(5);
  });

  it('one misread stat still yields the right species at 5/6', () => {
    const stats = finalStatsFor('Charizard');
    stats.atk = (stats.atk ?? 0) + 30; // corrupt Attack
    const r = inferSpecies(base({
      types: { value: ['Fire', 'Flying'], confident: true },
      finalStats: stats,
    }));
    expect(r.species).toBe('Charizard');
    expect(r.confident).toBe(true);
    expect(r.statScore).toBe(5);
  });

  it('Species Clause excludes an already-assigned species', () => {
    const r = inferSpecies(base({
      ability: { value: 'Blaze', confident: true },
      assigned: new Set(['Charizard']),
    }));
    expect(r.species).toBe('Typhlosion');
    expect(r.confident).toBe(true);
  });
});

describe('inferTeam (sequential Species Clause)', () => {
  it('second card of the same species falls to the next best', () => {
    const card = (types: string[] | null) => ({
      ability: { value: 'Blaze', confident: true },
      types: types ? { value: types, confident: true } : null,
      finalStats: finalStatsFor('Charizard'),
      evDigits: evDigitsFor(),
      nature: NATURE,
    });
    const [a, b] = inferTeam([card(['Fire', 'Flying']), card(null)]);
    expect(a.species).toBe('Charizard');
    expect(a.confident).toBe(true);
    expect(b.species).toBe('Typhlosion'); // Charizard now taken
    expect(b.confident).toBe(true);
  });
});
