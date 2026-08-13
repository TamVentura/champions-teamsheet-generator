import { describe, it, expect } from 'vitest';
import { moveTypes } from '../../src/data/move-types';
import { vocab } from '../../src/data/vocab';

// The move->type table (generated from the Showdown movedex) labels each move-row icon by its
// type, so the type-icon reader can mine glyph templates for types absent from the sample mons'
// own headers. Keys must line up with vocab.moves (what OCR snaps to).
describe('moveTypes table', () => {
  it('maps sample moves to their known types', () => {
    expect(moveTypes['Heat Wave']).toBe('Fire');
    expect(moveTypes['Electro Shot']).toBe('Electric');
    expect(moveTypes['Solar Beam']).toBe('Grass');
    expect(moveTypes['Flash Cannon']).toBe('Steel');
    expect(moveTypes['Dragon Pulse']).toBe('Dragon');
  });

  it('is keyed by the same display names as vocab.moves', () => {
    // Every table key is a real vocab move, and (almost) every vocab move has a type.
    for (const key of Object.keys(moveTypes)) {
      expect(vocab.moves).toContain(key);
    }
    const missing = vocab.moves.filter((m) => !(m in moveTypes));
    expect(missing).toEqual([]);
  });

  it('only emits real Pokémon types', () => {
    const TYPES = new Set([
      'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
      'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
    ]);
    for (const t of Object.values(moveTypes)) expect(TYPES.has(t)).toBe(true);
  });
});
