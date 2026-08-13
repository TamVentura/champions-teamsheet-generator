import { describe, it, expect } from 'vitest';
import { pokedex } from '../../src/data/pokedex';
import { natures } from '../../src/data/natures';
import { vocab } from '../../src/data/vocab';

describe('vendored data', () => {
  it('pokedex has Kingambit base stats', () => {
    expect(pokedex['Kingambit']).toEqual({ hp: 100, atk: 135, def: 120, spa: 60, spd: 85, spe: 50 });
  });

  it('natures carry +10%/-10% multipliers', () => {
    expect(natures['Adamant'].atk).toBe(1.1);
    expect(natures['Adamant'].spa).toBe(0.9);
    expect(natures['Serious'].atk).toBe(1);
  });

  it('vocab lists contain expected sample entries', () => {
    expect(vocab.species).toContain('Kingambit');
    expect(vocab.moves).toContain('Sucker Punch');
    expect(vocab.items).toContain('Life Orb');
    expect(vocab.abilities).toContain('Defiant');
    expect(vocab.natures).toContain('Adamant');
    expect(vocab.natures.length).toBe(25);
  });
});
