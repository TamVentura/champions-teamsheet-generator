import { describe, it, expect } from 'vitest';
import { resolveTeamSpecies } from '../../src/ocr/extract';
import { getChampionsStats } from '../../src/domain/champions';
import { STAT_KEYS, StatKey } from '../../src/domain/types';

const NATURE = 'Modest';
const EVS = { hp: 0, atk: 0, def: 3, spa: 31, spd: 0, spe: 32 };
function finals(species: string): Record<StatKey, number | null> {
  const s = getChampionsStats(species, EVS, NATURE);
  const out = {} as Record<StatKey, number | null>;
  for (const k of STAT_KEYS) out[k] = s[k];
  return out;
}
function evDigits(): Record<StatKey, number | null> {
  const out = {} as Record<StatKey, number | null>;
  for (const k of STAT_KEYS) out[k] = EVS[k];
  return out;
}
const signal = (types: string[] | null) => ({
  ability: { value: 'Blaze', confident: true },
  types: types ? { value: types, confident: true } : null,
  finalStats: finals('Charizard'),
  evDigits: evDigits(),
  nature: NATURE,
});

describe('resolveTeamSpecies', () => {
  it('applies Species Clause across slots and flags the duplicate', () => {
    const out = resolveTeamSpecies(
      [signal(['Fire', 'Flying']), signal(null)],
      [{ value: '', confident: false }, { value: '', confident: false }],
    );
    expect(out[0].result.species).toBe('Charizard');
    expect(out[1].result.species).toBe('Typhlosion');
    expect(out[1].flags).toEqual([]); // Typhlosion resolved confidently — no flag
  });

  it('emits ambiguous-species with candidates when not confident', () => {
    const out = resolveTeamSpecies(
      [signal(null)],
      [{ value: '', confident: false }],
    );
    const flag = out[0].flags.find((f) => f.reason === 'ambiguous-species');
    expect(flag).toBeDefined();
    expect(flag!.candidates).toContain('Charizard');
    expect(flag!.candidates).toContain('Typhlosion');
  });

  it('emits name-mismatch when the confident name is a different real species', () => {
    const out = resolveTeamSpecies(
      [signal(['Fire', 'Flying'])], // infers Charizard confidently
      [{ value: 'Blastoise', confident: true }], // decoy nickname snapped to a real species
    );
    expect(out[0].result.species).toBe('Charizard');
    expect(out[0].flags.some((f) => f.reason === 'name-mismatch')).toBe(true);
  });
});
