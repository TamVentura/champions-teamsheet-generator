import { describe, it, expect } from 'vitest';
import { toShowdownPaste, parseShowdownPaste } from '../../src/domain/showdown';
import { ChampionsMon, PlayerProfile, TeamModel } from '../../src/domain/types';

const profile: PlayerProfile = {
  playerName: 'Tiago',
  trainerNameInGame: 'Tiago',
  switchProfileName: '',
  playerId: 'a2',
  dateOfBirth: '',
  division: 'Master',
};

const kingambit: ChampionsMon = {
  species: 'Kingambit',
  gender: 'M',
  ability: 'Defiant',
  item: 'Chople Berry',
  nature: 'Adamant',
  evs: { hp: 31, atk: 16, def: 0, spa: 0, spd: 18, spe: 1 },
  moves: ['Sucker Punch', 'Kowtow Cleave', 'Iron Head', 'Low Kick'],
};

describe('toShowdownPaste', () => {
  it('renders a full mon block', () => {
    const team: TeamModel = { profile, mons: [kingambit] };
    expect(toShowdownPaste(team)).toBe(
      [
        'Kingambit (M) @ Chople Berry',
        'Ability: Defiant',
        'Level: 50',
        'EVs: 31 HP / 16 Atk / 18 SpD / 1 Spe',
        'Adamant Nature',
        '- Sucker Punch',
        '- Kowtow Cleave',
        '- Iron Head',
        '- Low Kick',
        '',
      ].join('\n')
    );
  });

  it('omits gender and item when absent', () => {
    const mon: ChampionsMon = { ...kingambit, gender: null, item: null };
    const text = toShowdownPaste({ profile, mons: [mon] });
    expect(text.startsWith('Kingambit\n')).toBe(true);
    expect(text).not.toContain('@');
  });

  it('separates multiple mons with a blank line', () => {
    const text = toShowdownPaste({ profile, mons: [kingambit, kingambit] });
    expect(text).toContain('- Low Kick\n\nKingambit (M)');
  });
});

describe('parseShowdownPaste', () => {
  it('round-trips a Champions paste back to the same mon', () => {
    const paste = toShowdownPaste({ profile, mons: [kingambit] });
    const { mons, flags } = parseShowdownPaste(paste);
    expect(mons[0]).toEqual(kingambit);
    expect(flags).toEqual([]); // kingambit is valid (EVs total 66, known species/nature)
  });

  it('parses header variants: nickname, gender, no item, bare species', () => {
    const text = [
      'Sparky (Pikachu) (M) @ Light Ball',
      '',
      'Gholdengo @ Choice Scarf',
      '',
      'Landorus-Therian (F)',
      '',
      'Ditto',
    ].join('\n');
    const { mons } = parseShowdownPaste(text);
    expect(mons.map((m) => [m.species, m.gender, m.item])).toEqual([
      ['Pikachu', 'M', 'Light Ball'],
      ['Gholdengo', null, 'Choice Scarf'],
      ['Landorus-Therian', 'F', null],
      ['Ditto', null, null],
    ]);
  });

  it('carries VGC EVs verbatim, pads moves, and flags the 66 mismatch', () => {
    const text = [
      'Incineroar @ Safety Goggles',
      'Ability: Intimidate',
      'Level: 50',
      'EVs: 252 HP / 4 Atk / 252 SpD',
      'Careful Nature',
      '- Fake Out',
    ].join('\n');
    const { mons, flags } = parseShowdownPaste(text);
    expect(mons[0].evs.hp).toBe(252);
    expect(mons[0].moves).toEqual(['Fake Out', '', '', '']);
    expect(flags).toContainEqual({ slot: 0, field: 'evs', reason: 'bad-spread' });
  });

  it('flags unknown species and empty nature; caps at 6 blocks', () => {
    const text = Array(8).fill('Notamon\n- Tackle').join('\n\n');
    const { mons, flags } = parseShowdownPaste(text);
    expect(mons).toHaveLength(6);
    expect(flags).toContainEqual({ slot: 0, field: 'species', reason: 'no-match' });
    expect(flags).toContainEqual({ slot: 0, field: 'nature', reason: 'no-match' });
  });
});
