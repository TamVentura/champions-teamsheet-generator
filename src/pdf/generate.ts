import type { ChampionsMon, PlayerProfile } from '../domain/types';
import { fillTeamsheet, type SheetPages } from './fill';
import templateUrl from './team-list-form.pdf?url';

export { fillTeamsheet, type SheetPages };

let templateBytes: Promise<ArrayBuffer> | null = null;

/** Fill the bundled template (fetched once and cached; it is precached for offline use). */
export async function buildTeamsheet(
  profile: PlayerProfile,
  teamName: string,
  mons: ChampionsMon[],
  pages: SheetPages = 'both'
): Promise<Uint8Array> {
  templateBytes ??= fetch(templateUrl).then((r) => {
    if (!r.ok) throw new Error(`Could not load the team list template (${r.status})`);
    return r.arrayBuffer();
  });
  try {
    return await fillTeamsheet(await templateBytes, profile, teamName, mons, pages);
  } catch (err) {
    templateBytes = null; // let a retry re-fetch
    throw err;
  }
}
