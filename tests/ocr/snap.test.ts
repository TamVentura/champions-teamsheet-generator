import { describe, it, expect } from 'vitest';
import { snap, levenshtein } from '../../src/ocr/snap';
import { vocab } from '../../src/data/vocab';

describe('levenshtein', () => {
  it('is case-insensitive and zero for equal', () => {
    expect(levenshtein('Kingambit', 'kingambit')).toBe(0);
    expect(levenshtein('abc', 'abd')).toBe(1);
  });
});

describe('snap', () => {
  it('corrects OCR typos to the exact vocabulary entry', () => {
    expect(snap('Kingamblt', vocab.species).value).toBe('Kingambit');
    expect(snap('Sucker Punoh', vocab.moves).value).toBe('Sucker Punch');
    expect(snap('Lite Orb', vocab.items).value).toBe('Life Orb');
    expect(snap('Whimslcott', vocab.species).value).toBe('Whimsicott');
  });

  it('reports distance 0 and confidence for exact input', () => {
    const r = snap('Iron Head', vocab.moves);
    expect(r.distance).toBe(0);
    expect(r.confident).toBe(true);
  });

  it('handles empty input', () => {
    expect(snap('   ', vocab.moves).value).toBe('');
    expect(snap('   ', vocab.moves).confident).toBe(false);
  });
});
