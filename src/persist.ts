import { Division, PlayerProfile, StoredProfile } from './domain/types';

const KEY = 'champions.profiles.v2';
const LEGACY_KEY = 'champions.profile';

/** A blank profile's identity fields (no team name — that is per-team, never saved). */
export function emptyProfile(): PlayerProfile {
  return {
    playerName: '',
    trainerNameInGame: '',
    switchProfileName: '',
    playerId: '',
    dateOfBirth: '',
    division: 'Master',
  };
}

export interface ProfileStore {
  profiles: StoredProfile[];
  activeId: string | null;
}

/** New random id for a profile. */
export function newProfileId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}

function migrateLegacy(): ProfileStore | null {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return null;
  try {
    const old = JSON.parse(raw) as Partial<PlayerProfile> & { battleTeamNumberOrName?: string };
    // Drop the old team-name field; it is no longer part of a profile.
    const profile: StoredProfile = { ...emptyProfile(), id: newProfileId() };
    for (const k of Object.keys(emptyProfile()) as (keyof PlayerProfile)[]) {
      if (old[k] != null) (profile as any)[k] = old[k];
    }
    const store: ProfileStore = { profiles: [profile], activeId: profile.id };
    saveStore(store);
    return store;
  } catch {
    return null;
  }
}

export function loadStore(): ProfileStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProfileStore;
      const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
      const activeId = profiles.some((p) => p.id === parsed.activeId)
        ? parsed.activeId
        : profiles[0]?.id ?? null;
      return { profiles, activeId };
    }
  } catch {
    /* fall through to migration / empty */
  }
  return migrateLegacy() ?? { profiles: [], activeId: null };
}

export function saveStore(store: ProfileStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

/** The active profile, or null if the store is empty. */
export function activeProfile(store: ProfileStore): StoredProfile | null {
  return store.profiles.find((p) => p.id === store.activeId) ?? null;
}

// ---------------- Export / import ----------------

export interface ProfilesExport {
  app: string;
  version: number;
  exportedAt: string;
  profiles: StoredProfile[];
}

const EXPORT_APP = 'champions-teamsheet-generator';
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Identity fields (id excluded) used to skip re-importing a profile that already exists. */
function profileIdentity(p: StoredProfile): string {
  const { playerName, trainerNameInGame, switchProfileName, playerId, dateOfBirth, division } = p;
  return JSON.stringify({ playerName, trainerNameInGame, switchProfileName, playerId, dateOfBirth, division });
}

/** Coerce an untrusted object from an imported file into a valid StoredProfile (or null). */
function sanitizeProfile(raw: any): StoredProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const base = emptyProfile();
  const division: Division = (['Junior', 'Senior', 'Master'] as Division[]).includes(raw.division)
    ? raw.division
    : base.division;
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    playerName: str(raw.playerName),
    trainerNameInGame: str(raw.trainerNameInGame),
    switchProfileName: str(raw.switchProfileName),
    playerId: str(raw.playerId),
    dateOfBirth: str(raw.dateOfBirth),
    division,
  };
}

/** Serialise the profile store to a shareable JSON document. */
export function exportProfilesJson(store: ProfileStore): string {
  const payload: ProfilesExport = {
    app: EXPORT_APP,
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: store.profiles,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Merge imported profiles into a store: exact-identity duplicates are skipped, and any id that
 * collides with an existing profile is reassigned so nothing is overwritten. Returns a new store;
 * throws on invalid JSON.
 */
export function importProfilesJson(text: string, store: ProfileStore): ProfileStore {
  const parsed = JSON.parse(text) as { profiles?: unknown };
  const incoming = Array.isArray(parsed.profiles) ? parsed.profiles : [];
  const ids = new Set(store.profiles.map((p) => p.id));
  const identities = new Set(store.profiles.map(profileIdentity));
  const profiles = [...store.profiles];
  let firstNewId: string | null = null;

  for (const raw of incoming) {
    const p = sanitizeProfile(raw);
    if (!p) continue;
    if (identities.has(profileIdentity(p))) continue;
    let id = p.id;
    if (!id || ids.has(id)) id = newProfileId();
    const stored: StoredProfile = { ...p, id };
    ids.add(id);
    identities.add(profileIdentity(stored));
    profiles.push(stored);
    if (!firstNewId) firstNewId = id;
  }

  return { profiles, activeId: firstNewId ?? store.activeId };
}
