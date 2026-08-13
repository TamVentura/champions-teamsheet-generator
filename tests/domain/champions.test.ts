import { describe, it, expect } from 'vitest';
import {
  getChampionsStats,
  natureFromArrows,
  arrowsFromNature,
  validateSpread,
  evFromFinalStat,
  resolveEv,
  statMismatch,
} from '../../src/domain/champions';
import { emptyEvs } from '../../src/domain/types';

describe('getChampionsStats', () => {
  it('HP = base + 75 + evHP (Kingambit)', () => {
    const evs = { hp: 31, atk: 16, def: 0, spa: 0, spd: 18, spe: 1 };
    const s = getChampionsStats('Kingambit', evs, 'Adamant');
    expect(s.hp).toBe(206); // 100 + 75 + 31
  });

  it('applies nature multiplier to non-HP (Kingambit Adamant Atk)', () => {
    const evs = { hp: 31, atk: 16, def: 0, spa: 0, spd: 18, spe: 1 };
    const s = getChampionsStats('Kingambit', evs, 'Adamant');
    // floor((135 + 20 + 16) * 1.1) = floor(188.1) = 188
    expect(s.atk).toBe(188);
    // floor((60 + 20 + 0) * 0.9) = floor(72) = 72
    expect(s.spa).toBe(72);
  });
});

describe('natureFromArrows', () => {
  it('maps boosted/hindered to nature', () => {
    expect(natureFromArrows('atk', 'spa')).toBe('Adamant');
    expect(natureFromArrows('spe', 'spa')).toBe('Jolly');
    expect(natureFromArrows('spe', 'atk')).toBe('Timid');
  });
  it('neutral when no arrows', () => {
    expect(natureFromArrows(null, null)).toBe('Serious');
    expect(natureFromArrows('atk', null)).toBe('Serious');
  });
  it('round-trips with arrowsFromNature', () => {
    expect(arrowsFromNature('Adamant')).toEqual({ up: 'atk', down: 'spa' });
    expect(arrowsFromNature('Serious')).toBeNull();
  });
});

describe('evFromFinalStat', () => {
  it('inverts HP exactly', () => {
    // Kingambit base HP 100 -> 100 + 75 + ev = 206 => ev 31
    expect(evFromFinalStat('hp', 206, 'Kingambit', 'Adamant')).toEqual([31]);
  });
  it('inverts a nature-boosted stat', () => {
    // Adamant Atk x1.1: floor((135+20+16)*1.1)=188
    expect(evFromFinalStat('atk', 188, 'Kingambit', 'Adamant')).toContain(16);
  });
  it('returns empty when no EV in 0..32 reproduces the value', () => {
    expect(evFromFinalStat('hp', 999, 'Kingambit', 'Adamant')).toEqual([]);
  });
});

describe('resolveEv', () => {
  it('trusts a unique final-stat inversion (exact)', () => {
    expect(resolveEv([16], 3, 0)).toEqual({ ev: 16, confident: true });
  });
  it('disambiguates a floor tie with the small number', () => {
    expect(resolveEv([0, 1], 1, 1 / 32).ev).toBe(1);
  });
  it('falls back to the number, then the bar, when the stat is unreadable', () => {
    expect(resolveEv([], 7, 0).ev).toBe(7);
    expect(resolveEv([], null, 32 / 32).ev).toBe(32);
  });
});

describe('statMismatch', () => {
  it('flags a stat whose EV cannot reproduce the observed final value', () => {
    // Staraptor SpD: observed 84 needs ev 4; ev 3 gives 83 -> mismatch flags spd
    const evs = { hp: 29, atk: 1, def: 0, spa: 0, spd: 3, spe: 32 };
    const observed = { hp: 189, atk: 141, def: 90, spa: 63, spd: 84, spe: 167 };
    expect(statMismatch('Staraptor', evs, 'Jolly', observed)).toEqual(['spd']);
  });
  it('returns nothing when every stat reproduces', () => {
    const evs = { hp: 29, atk: 1, def: 0, spa: 0, spd: 4, spe: 32 };
    const observed = { hp: 189, atk: 141, def: 90, spa: 63, spd: 84, spe: 167 };
    expect(statMismatch('Staraptor', evs, 'Jolly', observed)).toEqual([]);
  });
});

describe('validateSpread', () => {
  it('accepts a maxed legal spread (total 66)', () => {
    const v = validateSpread({ hp: 31, atk: 16, def: 0, spa: 0, spd: 18, spe: 1 });
    expect(v.total).toBe(66);
    expect(v.ok).toBe(true);
    expect(v.notMaxed).toBe(false);
  });
  it('flags over-cap stats (>32)', () => {
    const v = validateSpread({ ...emptyEvs(), hp: 40 });
    expect(v.overCap).toContain('hp');
    expect(v.ok).toBe(false);
  });
  it('flags not-maxed spreads (<66)', () => {
    const v = validateSpread({ ...emptyEvs(), hp: 10 });
    expect(v.notMaxed).toBe(true);
    expect(v.ok).toBe(false);
  });
});
