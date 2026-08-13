import { describe, it, expect } from 'vitest';
import { readNumber } from '../../src/ocr/digits';
import { DIGIT_TEMPLATES, TW, TH } from '../../src/ocr/digit-templates';
import type { RegionData } from '../../src/ocr/pixels';

/**
 * Render digit glyphs into a RegionData that `readNumber` will read back byte-for-byte.
 *
 * Each digit is painted at 1:1 scale from its own DIGIT_TEMPLATES bit grid (bit=1 -> a pure
 * white "text" pixel, bit=0 -> pure black "background"). `binarize` (inside readNumber)
 * classifies bright/low-saturation pixels as ink, so this reproduces exactly the "ink" pattern
 * `normalizeGlyph` expects. Because the ink bounding box of every digit used here spans the
 * full TWxTH grid (verified against DIGIT_TEMPLATES below), normalizeGlyph's area-average
 * resampling degenerates to a 1:1 pixel copy, so matchGlyph recovers the source digit exactly.
 * Digits are separated by a multi-column blank gap so detectColumnClusters segments them.
 */
function renderDigits(chars: string[], gap = 3): RegionData {
  const width = chars.length * TW + (chars.length - 1) * gap;
  const height = TH;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  // Start fully black (background); we'll paint "ink" (white) pixels per template bit.
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  chars.forEach((ch, di) => {
    const bits = DIGIT_TEMPLATES[ch].split('').map(Number);
    const xOff = di * (TW + gap);
    for (let ty = 0; ty < TH; ty++) {
      for (let tx = 0; tx < TW; tx++) {
        if (!bits[ty * TW + tx]) continue;
        const x = xOff + tx;
        const y = ty;
        const o = (y * width + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = 255; // bright, unsaturated -> classified as ink
      }
    }
  });
  return { data, width, height };
}

describe('DIGIT_TEMPLATES sanity (precondition for renderDigits)', () => {
  it('every used digit template has ink touching all four edges of its TWxTH grid', () => {
    // renderDigits relies on the ink bounding box of each rendered digit being exactly
    // [0, TW-1] x [0, TH-1] so normalizeGlyph's resample is a 1:1 copy. Confirm that holds
    // for the digits this test file actually renders (1, 5, 3).
    for (const ch of ['1', '5', '3']) {
      const bits = DIGIT_TEMPLATES[ch].split('').map(Number);
      let minX = TW, maxX = -1, minY = TH, maxY = -1;
      for (let ty = 0; ty < TH; ty++)
        for (let tx = 0; tx < TW; tx++)
          if (bits[ty * TW + tx]) {
            if (tx < minX) minX = tx;
            if (tx > maxX) maxX = tx;
            if (ty < minY) minY = ty;
            if (ty > maxY) maxY = ty;
          }
      expect(minX).toBe(0);
      expect(maxX).toBe(TW - 1);
      expect(minY).toBe(0);
      expect(maxY).toBe(TH - 1);
    }
  });
});

describe('readNumber maxDigits', () => {
  it('reads all 3 digits of a synthesized "153" region when maxDigits=3', () => {
    const region = renderDigits(['1', '5', '3']);
    const result = readNumber(region, 3);
    expect(result.text).toBe('153');
  });

  it('defaults to reading only the first 2 digits (EV behavior unchanged)', () => {
    const region = renderDigits(['1', '5', '3']);
    const result = readNumber(region);
    expect(result.text).toBe('15');
  });
});
