export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** Human labels used in the Showdown paste EVs line and PDF stat block. */
export const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP',
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
};

export type EvSpread = Record<StatKey, number>;

export type Division = 'Junior' | 'Senior' | 'Master';

export interface ChampionsMon {
  species: string;
  gender: 'M' | 'F' | null;
  ability: string;
  item: string | null;
  nature: string;
  evs: EvSpread;
  moves: string[];
}

export interface PlayerProfile {
  playerName: string;
  trainerNameInGame: string;
  switchProfileName: string;
  playerId: string;
  dateOfBirth: string;
  division: Division;
}

/** A saved profile: player identity plus a stable id used by the selector. */
export interface StoredProfile extends PlayerProfile {
  id: string;
}

export interface TeamModel {
  profile: PlayerProfile;
  mons: ChampionsMon[];
}

export const EV_BUDGET = 66;
export const EV_STAT_CAP = 32;

export function emptyEvs(): EvSpread {
  return { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
}
