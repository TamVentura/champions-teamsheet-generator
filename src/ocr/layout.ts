// Fixed-layout region model. All rectangles are expressed as fractions of the
// full (normalized) image, so any resolution with the same aspect works.
// Calibrated against the 2340x1080 sample screenshots.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const REF = { w: 2340, h: 1080 };

/** Compose a child rect (fractions within `card`) into a full-image fraction rect. */
export function within(card: Rect, child: Rect): Rect {
  return {
    x: card.x + child.x * card.w,
    y: card.y + child.y * card.h,
    w: child.w * card.w,
    h: child.h * card.h,
  };
}

/** Convert a fraction rect into integer pixel coordinates for an image of size w x h. */
export function toPixels(r: Rect, w: number, h: number): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(r.x * w),
    y: Math.round(r.y * h),
    w: Math.round(r.w * w),
    h: Math.round(r.h * h),
  };
}

// The six card panels (2 columns x 3 rows). Column 0 = left, column 1 = right.
// slot index = row * 2 + col  (0..5) matching the on-screen numbering 1..6.
export const CARDS: Rect[] = buildCards();

function buildCards(): Rect[] {
  const colX = [0.169, 0.508]; // left edge of each column
  const rowY = [0.206, 0.412, 0.618]; // top edge of each row
  const cardW = 0.322;
  const cardH = 0.2;
  const cards: Rect[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      cards.push({ x: colX[col], y: rowY[row], w: cardW, h: cardH });
    }
  }
  return cards;
}

// ---- Field rects relative to a single card (fractions 0..1 within the card) ----

// "Moves & More" screen: left half has name / ability / item; right half has 4 moves.
export const movesFields = {
  name: { x: 0.11, y: 0.15, w: 0.55, h: 0.22 } as Rect,
  genderIcon: { x: 0.5, y: 0.17, w: 0.16, h: 0.18 } as Rect,
  ability: { x: 0.1, y: 0.4, w: 0.5, h: 0.2 } as Rect,
  item: { x: 0.12, y: 0.62, w: 0.48, h: 0.22 } as Rect,
  // Whole moves column (4 lines) OCR'd as one block — robust to per-card vertical drift.
  // Type icons are colored and dropped by the saturation-aware binarizer.
  movesBlock: { x: 0.6, y: 0.17, w: 0.37, h: 0.81 } as Rect,
  moves: [
    { x: 0.6, y: 0.19, w: 0.36, h: 0.18 },
    { x: 0.6, y: 0.4, w: 0.36, h: 0.18 },
    { x: 0.6, y: 0.61, w: 0.36, h: 0.18 },
    { x: 0.6, y: 0.82, w: 0.36, h: 0.17 },
  ] as Rect[],
};

// "Stats" screen: name at top; then two columns of 3 stats each.
// Left stat column: HP, Attack, Defense. Right stat column: Sp.Atk, Sp.Def, Speed.
// Each stat row shows: label + arrow, big value, small ev number + orange bar.
export const statsFields = {
  name: { x: 0.11, y: 0.15, w: 0.55, h: 0.22 } as Rect,
  // Big stat values (final stat), right-aligned. Order: hp, atk, def (left); spa, spd, spe (right).
  // Colored arrows inside these regions are dropped by the saturation-aware binarizer.
  statValue: [
    { x: 0.24, y: 0.4, w: 0.17, h: 0.18 },
    { x: 0.24, y: 0.62, w: 0.17, h: 0.18 },
    { x: 0.24, y: 0.83, w: 0.17, h: 0.17 },
    { x: 0.7, y: 0.4, w: 0.18, h: 0.18 },
    { x: 0.7, y: 0.62, w: 0.18, h: 0.18 },
    { x: 0.7, y: 0.83, w: 0.18, h: 0.17 },
  ] as Rect[],
  // Wide row regions covering "value + bar + ev number" (the bar drops out in binarization).
  // OCR'd as one number string; the EV is the suffix after the known final-stat value — robust
  // to the small horizontal shifts that break edge-hugging crops. Order: hp,atk,def / spa,spd,spe.
  statRow: [
    { x: 0.18, y: 0.4, w: 0.34, h: 0.16 },
    { x: 0.18, y: 0.62, w: 0.34, h: 0.16 },
    { x: 0.18, y: 0.83, w: 0.34, h: 0.16 },
    { x: 0.68, y: 0.4, w: 0.32, h: 0.16 },
    { x: 0.68, y: 0.62, w: 0.32, h: 0.16 },
    { x: 0.68, y: 0.83, w: 0.32, h: 0.16 },
  ] as Rect[],
  // Small EV numbers, to the RIGHT of the orange bar (bar dropped by the binarizer).
  evValue: [
    { x: 0.41, y: 0.41, w: 0.1, h: 0.15 },
    { x: 0.41, y: 0.63, w: 0.1, h: 0.15 },
    { x: 0.41, y: 0.84, w: 0.1, h: 0.15 },
    { x: 0.88, y: 0.41, w: 0.09, h: 0.15 },
    { x: 0.88, y: 0.63, w: 0.09, h: 0.15 },
    { x: 0.88, y: 0.84, w: 0.09, h: 0.15 },
  ] as Rect[],
  // Orange EV bar (grey track between value and number); orange fill fraction ~= EV/32.
  evBar: [
    { x: 0.345, y: 0.45, w: 0.065, h: 0.07 },
    { x: 0.345, y: 0.67, w: 0.065, h: 0.07 },
    { x: 0.345, y: 0.88, w: 0.065, h: 0.07 },
    { x: 0.885, y: 0.45, w: 0.06, h: 0.07 },
    { x: 0.885, y: 0.67, w: 0.06, h: 0.07 },
    { x: 0.885, y: 0.88, w: 0.06, h: 0.07 },
  ] as Rect[],
  // Nature arrow area, next to the stat label (left of the big value).
  // Maps to atk, def, spa, spd, spe (HP never carries a nature arrow).
  natureArrow: {
    atk: { x: 0.2, y: 0.62, w: 0.07, h: 0.18 },
    def: { x: 0.2, y: 0.83, w: 0.07, h: 0.17 },
    spa: { x: 0.65, y: 0.4, w: 0.07, h: 0.18 },
    spd: { x: 0.65, y: 0.62, w: 0.07, h: 0.18 },
    spe: { x: 0.65, y: 0.83, w: 0.07, h: 0.17 },
  } as Record<string, Rect>,
};
