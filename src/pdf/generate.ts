import { jsPDF } from 'jspdf';
import { getChampionsStats } from '../domain/champions';
import { STAT_KEYS, type ChampionsMon, type Division, type PlayerProfile } from '../domain/types';
import { registerFonts } from './fonts';

/**
 * Age-division index used by the reference tool: Juniors=0, Seniors=1, Masters=2.
 */
const DIVISION_INDEX: Record<Division, number> = {
  Junior: 0,
  Senior: 1,
  Master: 2,
};

/**
 * Build one teamsheet.
 *
 *   kind === 'open'  -> the reference's sheet === 'open'  (Open Team Sheet, "2 of 2: For Opponents")
 *   kind === 'staff' -> the reference's sheet === 'close' (Staff Team Sheet, "1 of 2: For Tournament Staff")
 *
 * This is a verbatim port of the Champions (`isChampions === true`) code path of the reference
 * tool's `generatePdf`: same jsPDF coordinates, line widths, font sizes, labels and draw order.
 */
export function buildSheet(
  kind: 'open' | 'staff',
  profile: PlayerProfile,
  teamName: string,
  mons: ChampionsMon[],
  existingDoc?: jsPDF
): jsPDF {
  const sheet: 'open' | 'close' = kind === 'open' ? 'open' : 'close';

  // Reference field aliases.
  const playerName = profile.playerName;
  const trainerName = profile.trainerNameInGame;
  const switchName = profile.switchProfileName;
  const playerId = profile.playerId;
  const birth = profile.dateOfBirth;
  const ageDivision = DIVISION_INDEX[profile.division];

  const doc = existingDoc ?? new jsPDF();

  // jsPDF's text() supports the pre-2012 (x, y, text, flags) call order, which the reference
  // relies on heavily. Bind a loosely-typed alias so the ported calls stay verbatim.
  const text = doc.text.bind(doc) as unknown as (...args: unknown[]) => jsPDF;

  registerFonts(doc);

  // ---- Shared block (drawn for BOTH sheets) ---------------------------------
  doc.setFontSize(7);
  doc.setFont('text2', 'normal');
  let msg = 'All Pokémon must be listed exactly as they appear in the Battle Team.';
  text(105, 272, msg, 'center');

  doc.setFontSize(13);
  doc.setFont('text1', 'normal');
  msg = 'Pokémon Video Game Team List';
  text(73, 12.5, msg);

  doc.setLineWidth(0.3);
  {
    const x = 45;
    const y = 34.5;
    const mygap = 7;
    for (let i = 0; i < 4; i++) {
      doc.line(x, y + mygap * i, x + 65, y + mygap * i);
    }
  }

  doc.setFontSize(12);
  doc.setFont('text1', 'normal');

  msg = 'Player Name: ';
  text(45, 33, msg, 'right');

  doc.setFontSize(9);

  msg = 'Trainer Name in Game: ';
  text(45, 40, msg, 'right');

  msg = 'Battle Team Number / Name: ';
  text(45, 47, msg, 'right');

  msg = 'Switch Profile Name: ';
  text(45, 54, msg, 'right');

  {
    const x = 155;
    const gapx = 21;
    for (let i = 0; i < 3; i++) {
      doc.rect(x + gapx * i, 30, 4, 4);
    }
  }

  msg = 'Age Division: ';
  text(140, 33, msg, 'right');
  msg = 'Juniors ';
  text(154, 33, msg, 'right');
  msg = 'Seniors ';
  text(175, 33, msg, 'right');
  msg = 'Masters ';
  text(196, 33, msg, 'right');

  doc.setFont('text2', 'normal');
  doc.setFontSize(13);
  text(playerName, 47, 33);
  text(trainerName, 47, 40);
  text(teamName, 47, 47);
  text(switchName, 47, 54);

  for (let i = 0; i < 6; i++) {
    doc.setLineWidth(0.6);
    const x = 6.5 + 99 * (i % 2);
    const y = 59.5 + 70 * Math.floor(i / 2);
    doc.rect(x, y, 95, 68);

    doc.setLineWidth(0.4);
    const startY = 12;
    const mygap = 8;
    for (let b = 0; b < 7; b++) {
      doc.line(x, y + startY + mygap * b, x + 95, y + startY + mygap * b);
    }
  }

  {
    // ageDivision is always defined here (Junior/Senior/Master).
    doc.setLineWidth(1);
    const posX = 154 + 21 * ageDivision;
    doc.line(posX, 29, posX + 6, 35);
    doc.line(posX + 6, 29, posX, 35);
  }

  const pokes = mons;

  for (let i = 0; i < pokes.length; i++) {
    const textX = 35;
    const statX = 100;
    const gapX = 100;
    const textXX = 27.5;

    const pokeY = 67;
    const teraY = pokeY + 9.5;
    const abilityY = pokeY + 18;
    const itemY = pokeY + 26;
    const gapY = 70;

    const moveY = pokeY + 34;
    const moveGapY = 8;

    const statY = pokeY + 19;
    const statGapY = 8;

    // Champions: use display names directly (English); no id/translation tables.
    const name = pokes[i].species;

    // Champions: the Tera-Type slot instead shows the Nature.
    const nature = pokes[i].nature ? pokes[i].nature : 'Serious';
    const teraType = nature;

    const ability = pokes[i].ability;
    const item = pokes[i].item ? pokes[i].item : 'NO ITEM';
    const movs = pokes[i].moves;

    const evs = pokes[i].evs;

    doc.setFontSize(13);
    doc.setFont('text1', 'normal');
    text('Pokémon', textXX + (i % 2) * gapX, pokeY + Math.floor(i / 2) * gapY, 'right');
    doc.setFontSize(12);
    doc.setFont('customFont', 'normal');
    text(name, textX + (i % 2) * gapX, pokeY + Math.floor(i / 2) * gapY);

    // "Stat Alignment" is wider than the other labels; shrink the font so it stays inside the
    // cell's left strip (right-aligned to textXX) instead of spilling past the cell edge.
    doc.setFontSize(8);
    doc.setFont('text1', 'normal');
    text('Stat Alignment', textXX + (i % 2) * gapX, teraY + Math.floor(i / 2) * gapY, 'right');
    doc.setFontSize(11);
    doc.setFont('customFont', 'normal');
    text(teraType, textX + (i % 2) * gapX, teraY + Math.floor(i / 2) * gapY);

    doc.setFontSize(13);
    doc.setFont('text1', 'normal');
    text('Ability', textXX + (i % 2) * gapX, abilityY + Math.floor(i / 2) * gapY, 'right');
    doc.setFontSize(11);
    doc.setFont('customFont', 'normal');
    text(ability, textX + (i % 2) * gapX, abilityY + Math.floor(i / 2) * gapY);

    doc.setFontSize(13);
    doc.setFont('text1', 'normal');
    text('Held Item', textXX + (i % 2) * gapX, itemY + Math.floor(i / 2) * gapY, 'right');
    doc.setFontSize(11);
    doc.setFont('customFont', 'normal');
    text(item, textX + (i % 2) * gapX, itemY + Math.floor(i / 2) * gapY);

    for (let j = 0; j < movs.length; j++) {
      doc.setFontSize(13);
      doc.setFont('text1', 'normal');
      text('Move ' + (j + 1), textXX + (i % 2) * gapX, moveY + Math.floor(i / 2) * gapY + j * moveGapY, 'right');
      doc.setFontSize(11);
      doc.setFont('customFont', 'normal');
      text(movs[j], textX + (i % 2) * gapX, moveY + Math.floor(i / 2) * gapY + j * moveGapY);
    }

    if (sheet === 'close') {
      const stats = getChampionsStats(name, evs, nature);

      let j = 0;
      for (const key of STAT_KEYS) {
        const value = stats[key];
        text(value.toString(), statX + (i % 2) * (gapX - 1), statY + Math.floor(i / 2) * gapY + j * statGapY, 'right');
        j = j + 1;
      }
    }
  }

  // ---- Open sheet specifics -------------------------------------------------
  if (sheet === 'open') {
    doc.setFontSize(13);
    doc.setFont('text1', 'normal');
    msg = '2 of 2: ';
    text(83, 18, msg);

    doc.setFont('text3', 'normal');
    msg = 'For Opponents';
    text(96, 18, msg);

    doc.setFontSize(10);
    doc.setFont('text3', 'normal');
    msg = 'Do not lose this page! Keep it throughout the tournament, sharing it with your opponent each round.';
    text(31, 24, msg);
  }

  // ---- Staff sheet specifics ------------------------------------------------
  if (sheet === 'close') {
    doc.setFontSize(13);
    doc.setFont('text1', 'normal');
    msg = '1 of 2: ';
    text(77, 18, msg);

    doc.setFont('text3', 'normal');
    msg = 'For Tournament Staff';
    text(90, 18, msg);

    doc.setFontSize(10);
    doc.setFont('text3', 'normal');
    msg = 'Complete both pages of this document. Submit this page to event staff before the tournament, at the time set by the Organizer.';
    text(12, 24, msg);

    doc.setLineWidth(0.3);
    doc.setFontSize(9);
    doc.setFont('text1', 'normal');
    msg = 'Player ID: ';
    text(140, 43, msg, 'right');
    doc.line(140, 44.5, 180, 44.5);
    doc.setFontSize(13);
    doc.setFont('text2', 'normal');
    text(playerId, 142, 43);

    doc.setFontSize(9);
    doc.setFont('text1', 'normal');
    msg = 'Date of Birth: ';
    text(140, 51, msg, 'right');
    doc.line(140, 52.5, 180, 52.5);
    doc.setFontSize(13);
    doc.setFont('text2', 'normal');
    text(birth, 142, 51);

    for (let i = 0; i < 6; i++) {
      doc.setLineWidth(0.4);
      const x = 6.5 + 99 * (i % 2);
      const y = 59.5 + 70 * Math.floor(i / 2);

      doc.line(x + 80, y + 12, x + 80, y + 68);
      doc.setFontSize(6);
      doc.setFont('text1', 'normal');
      text(x + 81, y + 22, 'HP');
      text(x + 81, y + 30, 'Atk');
      text(x + 81, y + 38, 'Def');
      text(x + 81, y + 46, 'Sp. Atk');
      text(x + 81, y + 54, 'Sp. Def');
      text(x + 81, y + 62, 'Speed');
    }

    doc.setFontSize(11);
    doc.setFont('customFont', 'normal');
  }

  return doc;
}

/** Build both sheets for the given player and team. */
export function savePdfs(
  profile: PlayerProfile,
  teamName: string,
  mons: ChampionsMon[]
): { open: jsPDF; staff: jsPDF } {
  return {
    open: buildSheet('open', profile, teamName, mons),
    staff: buildSheet('staff', profile, teamName, mons),
  };
}

/**
 * Build a single two-page PDF: page 1 = Staff sheet, page 2 = Open sheet — for printing both
 * at once (matching the official "1 of 2" / "2 of 2" ordering).
 */
export function buildBoth(profile: PlayerProfile, teamName: string, mons: ChampionsMon[]): jsPDF {
  const doc = new jsPDF();
  buildSheet('staff', profile, teamName, mons, doc);
  doc.addPage();
  buildSheet('open', profile, teamName, mons, doc);
  return doc;
}
