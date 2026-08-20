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

  // Regional formes share the base name on-screen but have distinct stats/types/abilities — the
  // exact case inference exists to resolve. They MUST be in the candidate pool.
  it('resolves a regional forme (Hisuian Arcanine) — its stats/ability point to it, not any base forme', () => {
    // Hisuian Arcanine: Fire/Rock, Rock Head — a real Champions build (Head Smash off Rock Head).
    const r = inferSpecies(base({
      ability: { value: 'Rock Head', confident: true },
      types: { value: ['Fire', 'Rock'], confident: true },
      finalStats: finalStatsFor('Arcanine-Hisui'),
    }));
    expect(r.species).toBe('Arcanine-Hisui');
    expect(r.confident).toBe(true);
  });

  it('resolves a regional forme on stats alone (ability read, type not read)', () => {
    const r = inferSpecies(base({
      ability: { value: 'Rock Head', confident: true },
      types: null,
      finalStats: finalStatsFor('Arcanine-Hisui'),
    }));
    expect(r.species).toBe('Arcanine-Hisui');
    expect(r.confident).toBe(true);
  });

  it('distinguishes a forme from its base by stats when they share an ability', () => {
    // Both regular and Hisuian Arcanine have Intimidate; only the stats tell them apart.
    const kanto = inferSpecies(base({
      ability: { value: 'Intimidate', confident: true },
      finalStats: finalStatsFor('Arcanine'),
    }));
    expect(kanto.species).toBe('Arcanine');

    const hisui = inferSpecies(base({
      ability: { value: 'Intimidate', confident: true },
      finalStats: finalStatsFor('Arcanine-Hisui'),
    }));
    expect(hisui.species).toBe('Arcanine-Hisui');
  });

  it('battle-transient formes (Mega/Gmax/Primal) are never candidates', () => {
    // Charizard-Mega-Y's own stats must not resolve to the mega — megas are item-driven and the
    // team-preview shows pre-mega stats, so the mega forme must be out of the pool entirely.
    const r = inferSpecies(base({ finalStats: finalStatsFor('Charizard-Mega-Y') }));
    expect(r.candidates).not.toContain('Charizard-Mega-Y');
    expect(r.species).not.toBe('Charizard-Mega-Y');
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
