import { describe, it, expect } from 'vitest';
import { exportProfilesJson, importProfilesJson, ProfileStore } from '../src/persist';
import { StoredProfile } from '../src/domain/types';

const mk = (id: string, name: string): StoredProfile => ({
  id,
  playerName: name,
  trainerNameInGame: name,
  switchProfileName: name,
  playerId: '1234-5678',
  dateOfBirth: '01/01/2000',
  division: 'Master',
});

describe('profiles export/import', () => {
  it('round-trips profiles', () => {
    const store: ProfileStore = { profiles: [mk('a', 'Ash'), mk('b', 'Gary')], activeId: 'a' };
    const back = importProfilesJson(exportProfilesJson(store), { profiles: [], activeId: null });
    expect(back.profiles.map((p) => p.playerName)).toEqual(['Ash', 'Gary']);
  });

  it('re-ids colliding ids and keeps the existing profile', () => {
    const existing: ProfileStore = { profiles: [mk('a', 'Ash')], activeId: 'a' };
    const incoming = exportProfilesJson({ profiles: [mk('a', 'Gary')], activeId: 'a' });
    const merged = importProfilesJson(incoming, existing);
    expect(merged.profiles).toHaveLength(2);
    expect(merged.profiles[0].id).toBe('a');
    expect(merged.profiles[0].playerName).toBe('Ash');
    expect(merged.profiles[1].id).not.toBe('a');
    expect(merged.profiles[1].playerName).toBe('Gary');
  });

  it('skips exact-identity duplicates', () => {
    const existing: ProfileStore = { profiles: [mk('a', 'Ash')], activeId: 'a' };
    const incoming = exportProfilesJson({ profiles: [mk('zzz', 'Ash')], activeId: 'zzz' });
    const merged = importProfilesJson(incoming, existing);
    expect(merged.profiles).toHaveLength(1);
  });

  it('throws on invalid json', () => {
    expect(() => importProfilesJson('not json', { profiles: [], activeId: null })).toThrow();
  });
});
