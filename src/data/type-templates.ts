// Committed glyph templates for the type-icon reader (src/ocr/typeIcons.ts). Each template is a
// 24x24 foreground (white type-glyph) MASK, stored as one 24-bit integer per row (bit x set = glyph
// pixel at column x). They were derived offline from labelled Champions card headers (sample
// screenshots): each badge's white symbol was thresholded, cropped, and normalized to 24x24 with the
// SAME segmentation + Otsu-normalization path the reader runs at match time, so a badge self-matches
// its template. Only abstracted glyph masks live here — no screenshot pixels / PII. Regenerate by
// re-running that extraction over a labelled header set (see the reader for the exact pipeline).

export const GLYPH_N = 24;

export interface GlyphTemplate { kind: 'type' | 'gender'; name: string; rows: number[]; }

export const GLYPH_TEMPLATES: GlyphTemplate[] = [
  { kind: 'gender', name: 'M', rows: [0,0,0,0,0,522240,1046528,1015808,1015808,1032192,980864,950240,933856,407664,28784,28720,12400,14448,8160,8128,1920,0,0,0] },
  { kind: 'type', name: 'Fire', rows: [0,0,0,0,2048,6144,12288,12288,14336,15872,28416,65408,129408,129408,127104,127104,123008,122880,57344,24576,0,0,0,0] },
  { kind: 'type', name: 'Flying', rows: [0,0,0,0,0,491520,516096,261632,261888,130944,32704,98240,65472,16320,8128,16320,1984,224,96,32,0,0,0,0] },
  { kind: 'gender', name: 'F', rows: [0,0,0,15360,32256,65280,65280,124800,115584,229824,229824,115584,115584,65280,65024,15360,6144,130816,130816,65280,6144,6144,6144,0] },
  { kind: 'type', name: 'Dragon', rows: [0,0,0,32768,33280,50688,50688,56832,65024,130816,261888,2359056,3276568,7929400,3735160,3767672,1703792,1637936,1637936,64544,31744,31744,31744,0] },
  { kind: 'type', name: 'Ground', rows: [0,0,0,0,0,448,448,229824,229376,1536,1536,0,0,6144,32256,262080,524256,524256,130944,818784,491968,124800,32256,0] },
  { kind: 'gender', name: 'F', rows: [0,0,0,0,0,0,32256,65280,115584,229824,196800,229824,98688,130944,65280,6144,130944,130944,15360,6144,6144,0,0,0] },
  { kind: 'type', name: 'Dark', rows: [0,0,0,0,0,0,0,64,458976,1016800,1020912,1020912,1020912,492512,509888,262016,65280,31744,0,0,0,0,0,0] },
  { kind: 'type', name: 'Ghost', rows: [0,0,0,0,0,31744,65280,130816,130944,104832,234368,262016,2097136,2097144,1048544,65344,32256,15360,6144,0,0,0,0,0] },
  { kind: 'gender', name: 'F', rows: [0,0,0,0,0,0,15360,65280,59136,98688,229824,98688,115584,65280,65280,6144,65280,65280,6144,6144,6144,0,0,0] },
  { kind: 'type', name: 'Grass', rows: [0,0,0,0,0,0,0,16384,286720,287232,419328,488960,260864,260864,244608,244608,252864,123840,123328,49536,0,0,0,0] },
  { kind: 'type', name: 'Fairy', rows: [0,0,0,0,0,508400,518128,524272,1048560,1048560,524272,522208,130944,65408,131008,131008,130944,7168,5120,13824,0,0,0,0] },
  { kind: 'gender', name: 'M', rows: [0,0,0,0,0,0,520192,1044480,983040,1015808,902144,851840,293312,286912,24640,57408,28864,31168,16320,7936,0,0,0,0] },
  { kind: 'type', name: 'Water', rows: [0,0,0,0,0,0,6144,6144,14336,15360,32256,32256,65280,65280,130944,130944,130944,130944,49920,32256,0,0,0,0] },
  { kind: 'type', name: 'Ghost', rows: [0,0,0,0,0,0,65024,130816,130944,104832,234368,262016,524256,2097136,2097144,1048560,458560,32256,14336,0,0,0,0,0] },
  { kind: 'gender', name: 'M', rows: [0,0,0,0,0,0,522240,520192,491520,507904,517632,409472,399584,143456,12400,12400,12384,6624,8128,3968,0,0,0,0] },
  { kind: 'type', name: 'Steel', rows: [0,0,0,0,0,262016,131008,16064,135104,509920,421856,421856,1034224,1034352,1040256,499648,106368,16128,15360,6144,0,0,0,0] },
  { kind: 'type', name: 'Dragon', rows: [0,0,256,25344,25344,32512,65280,130944,130944,3735430,3735326,3964702,3964702,3948094,3997628,1900348,1867544,15872,15872,15872,15360,0,0,0] },
];

// 10 of 18 types covered by committed templates: Dark, Dragon, Fairy, Fire, Flying, Ghost, Grass, Ground, Steel, Water.
// Missing (reader abstains rather than guess): Normal, Electric, Ice, Fighting, Poison, Psychic, Bug, Rock.
export const COVERED_TYPES: ReadonlySet<string> = new Set(['Dark', 'Dragon', 'Fairy', 'Fire', 'Flying', 'Ghost', 'Grass', 'Ground', 'Steel', 'Water']);
