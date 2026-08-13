import { describe, it, expect } from 'vitest';
import { speciesTypes } from '../../src/data/species-types';
import { speciesAbilities } from '../../src/data/species-abilities';
import { pokedex } from '../../src/data/pokedex';

describe('species reference data', () => {
  it('types: dual and single', () => {
    expect(speciesTypes['Charizard']).toEqual(['Fire', 'Flying']);
    expect(speciesTypes['Typhlosion']).toEqual(['Fire']);
  });

  it('abilities: includes the primary ability', () => {
    expect(speciesAbilities['Charizard']).toContain('Blaze');
    expect(speciesAbilities['Shedinja']).toEqual(['Wonder Guard']);
  });

  it('coverage: every pokedex key has a types and an abilities entry', () => {
    for (const key of Object.keys(pokedex)) {
      expect(speciesTypes[key], `types missing for ${key}`).toBeDefined();
      expect(speciesAbilities[key], `abilities missing for ${key}`).toBeDefined();
    }
  });
});
