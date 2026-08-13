// Types for the precache generator's pure, unit-tested core (scripts/gen-precache.mjs).
export function toPrecacheUrls(relPaths: string[]): string[];
export function cacheVersion(entries: Array<{ url: string; hash: string }>): string;
export function injectSw(
  swSource: string,
  opts: { precache: string[]; cacheVersion: string }
): string;
