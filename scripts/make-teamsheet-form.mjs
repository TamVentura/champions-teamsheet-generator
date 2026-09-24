// Turn the official Play! Pokémon VG Team List PDF into a fillable form template.
//
//   node scripts/make-teamsheet-form.mjs
//
// Input : assets/pdf/play-pokemon-vg-team-list.pdf  (the official PDF, unmodified)
// Output: src/pdf/team-list-form.pdf                (same pages + named AcroForm fields)
//
// The app fills the fields BY NAME (src/pdf/generate.ts) and flattens them, so the official page
// art — fonts, lines, labels — is used as-is and only the data is ours. Field boxes sit on the
// template's own underlines/cells; the numbers below were measured from the official PDF's
// drawing (pdfplumber: every line is a thin filled rect). Top-origin y, like a PDF viewer shows;
// converted to PDF bottom-origin when placing widgets. If Pokémon ever republish the template,
// re-measure, re-run this script and commit the new form.
//
// Fields that carry the same value on both pages (player name, species, moves, …) are ONE field
// with a widget on each page, so a single setText fills both. Page 1 ("For Tournament Staff") also
// has Player ID / Date of Birth / Support ID and the six stat cells per Pokémon.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, TextAlignment } from 'pdf-lib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'assets/pdf/play-pokemon-vg-team-list.pdf');
const OUT = join(root, 'src/pdf/team-list-form.pdf');

const PAGE_H = 792;
const COL_DX = 292.1; // left card x 19.3 -> right card x 311.4

// Per page: underline y of the four left header rows (Player Name, Trainer Name in Game,
// Battle Team Number / Name, Switch Profile Name) and the division checkbox squares.
const HEADER = [
  {
    lines: [89.1, 110.4, 131.8, 156.3],
    boxes: [
      [471.5, 77.6, 483.8, 88.7],
      [527.2, 77.3, 539.4, 88.3],
      [576.8, 76.3, 589.0, 87.3],
    ],
  },
  {
    lines: [87.3, 108.6, 130.0, 154.5],
    boxes: [
      [471.5, 75.8, 483.8, 86.9],
      [527.2, 75.5, 539.4, 86.5],
      [576.8, 74.5, 589.0, 85.5],
    ],
  },
];

// Per page, per card row: the 9 horizontal rules of a card, top to bottom — outer top, then
// under Pokémon / Stat Alignment / Ability / Held Item / Move 1 / Move 2 / Move 3, outer bottom.
const CARD_ROWS = [
  [
    [160.7, 192.4, 215.5, 238.7, 261.9, 285.1, 308.2, 331.4, 354.1],
    [362.1, 393.8, 417.0, 440.1, 463.3, 486.4, 509.6, 532.8, 555.4],
    [563.5, 595.2, 618.3, 641.5, 664.7, 687.8, 711.0, 731.1, 753.8],
  ],
  [
    [158.4, 190.1, 213.3, 236.4, 259.6, 282.8, 305.9, 329.1, 351.8],
    [359.8, 391.5, 414.7, 437.8, 461.0, 484.2, 507.3, 530.5, 553.1],
    [561.2, 592.9, 616.1, 639.2, 662.4, 685.5, 708.7, 731.9, 754.6],
  ],
];

const CARD_FIELDS = ['species', 'nature', 'ability', 'item', 'move1', 'move2', 'move3', 'move4'];
const STAT_FIELDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']; // rows ability..move4, staff page only

const VALUE_X0 = 90; // right of the row labels ("Stat Alignment" ends at x 82.7)
const STAT_DIVIDER_X = 247.2; // staff page: vertical rule before the stat column
const CARD_INNER_X1 = 297.9;

const src = await PDFDocument.load(readFileSync(SRC));
const pdf = await PDFDocument.create();
const pages = await pdf.copyPages(src, [0, 1]);
pages.forEach((p) => pdf.addPage(p));
const font = await pdf.embedFont(StandardFonts.Helvetica);
const form = pdf.getForm();

const transparent = { borderWidth: 0, borderColor: undefined, backgroundColor: undefined, font };

/** Place a widget for `field` on `page` over the top-origin box [x0,top]-[x1,bottom]. */
function place(field, page, x0, top, x1, bottom) {
  field.addToPage(page, { ...transparent, x: x0, y: PAGE_H - bottom, width: x1 - x0, height: bottom - top });
  // Size/alignment need the /DA a widget brings, so they're applied after the first placement.
  const style = pendingStyle.get(field);
  if (style) {
    field.setFontSize(style.size);
    field.setAlignment(style.align);
    pendingStyle.delete(field);
  }
}

const pendingStyle = new Map();

const fields = new Map();
function text(name, size, align = TextAlignment.Left) {
  if (!fields.has(name)) {
    const f = form.createTextField(name);
    pendingStyle.set(f, { size, align });
    fields.set(name, f);
  }
  return fields.get(name);
}

for (let p = 0; p < 2; p++) {
  const page = pages[p];
  const staff = p === 0;
  const { lines, boxes } = HEADER[p];

  // Left header column: value sits on the underline (x 140.4-310.7).
  ['player_name', 'trainer_name', 'team_name', 'switch_name'].forEach((name, k) =>
    place(text(name, 12), page, 143, lines[k] - 16, 310, lines[k] - 0.5)
  );

  // Age division: one checkbox per square.
  ['div_junior', 'div_senior', 'div_master'].forEach((name, k) => {
    const [x0, top, x1, bottom] = boxes[k];
    let cb = fields.get(name);
    if (!cb) {
      cb = form.createCheckBox(name);
      fields.set(name, cb);
    }
    place(cb, page, x0 + 1, top + 1, x1 - 1, bottom - 1);
  });

  if (staff) {
    // Right header column (staff page only): underlines x 432.6-591.0.
    place(text('player_id', 12), page, 435, 110.4 - 16, 590, 110.4 - 0.5);
    place(text('support_id', 12), page, 435, 156.3 - 16, 590, 156.3 - 0.5);
    // Date of Birth: the template prints two slashes (x 478-484 and 534-540) -> three parts.
    place(text('dob_1', 12, TextAlignment.Center), page, 434, 131.8 - 16, 477, 131.8 - 0.5);
    place(text('dob_2', 12, TextAlignment.Center), page, 485, 131.8 - 16, 533, 131.8 - 0.5);
    place(text('dob_3', 12, TextAlignment.Center), page, 541, 131.8 - 16, 590, 131.8 - 0.5);
  }

  for (let slot = 0; slot < 6; slot++) {
    const rows = CARD_ROWS[p][Math.floor(slot / 2)];
    const dx = (slot % 2) * COL_DX;
    const n = slot + 1;
    CARD_FIELDS.forEach((key, r) => {
      // Rows from Ability down share the card with the stat column on the staff page.
      const x1 = staff && r >= 2 ? STAT_DIVIDER_X - 1 : CARD_INNER_X1 - 2;
      place(text(`p${n}_${key}`, r === 0 ? 13 : 11), page, VALUE_X0 + dx, rows[r] + 2, x1 + dx, rows[r + 1] - 0.5);
    });
    if (staff) {
      STAT_FIELDS.forEach((key, s) => {
        const r = s + 2;
        place(text(`p${n}_${key}`, 11, TextAlignment.Right), page, STAT_DIVIDER_X + 8 + dx, rows[r] + 5, CARD_INNER_X1 - 4 + dx, rows[r + 1] - 0.5);
      });
    }
  }
}

writeFileSync(OUT, await pdf.save());
console.log(`wrote ${OUT} (${fields.size} fields)`);
