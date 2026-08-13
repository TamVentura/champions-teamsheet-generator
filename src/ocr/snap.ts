/** Case-insensitive Levenshtein distance. */
export function levenshtein(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export interface SnapResult {
  value: string;
  distance: number;
  confident: boolean;
}

/**
 * Snap a raw OCR string to the nearest entry in a closed vocabulary.
 * Confident when the best match is unique and within ~25% of the raw length.
 */
export function snap(raw: string, list: string[]): SnapResult {
  const cleaned = raw.trim();
  if (!cleaned) return { value: '', distance: Infinity, confident: false };

  let best = list[0];
  let bestDist = Infinity;
  let secondDist = Infinity;
  for (const candidate of list) {
    const d = levenshtein(cleaned, candidate);
    if (d < bestDist) {
      secondDist = bestDist;
      bestDist = d;
      best = candidate;
    } else if (d < secondDist) {
      secondDist = d;
    }
    if (bestDist === 0) break;
  }

  const threshold = Math.max(1, Math.ceil(cleaned.length * 0.25));
  const confident = bestDist <= threshold && bestDist < secondDist;
  return { value: best, distance: bestDist, confident };
}
