import { describe, it, expect } from 'vitest';
import type { StatsResult } from '../../src/ocr/card';
import { STAT_KEYS } from '../../src/domain/types';

describe('StatsResult shape', () => {
  it('carries per-stat finalStats and evDigits (nullable)', () => {
    // A literal that must satisfy the exported type — documents the contract Task 4 relies on.
    const r: Pick<StatsResult, 'finalStats' | 'evDigits'> = {
      finalStats: { hp: 153, atk: 93, def: 101, spa: 176, spd: 105, spe: 152 },
      evDigits: { hp: 0, atk: null, def: 3, spa: 31, spd: 0, spe: 32 },
    };
    for (const k of STAT_KEYS) {
      expect(k in r.finalStats).toBe(true);
      expect(k in r.evDigits).toBe(true);
    }
  });
});
