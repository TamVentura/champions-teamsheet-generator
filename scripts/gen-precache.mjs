// Post-build: generate the service-worker precache manifest so the installed PWA is FULLY
// OFFLINE after its first online launch (iOS Safari included). Vite content-hashes asset
// filenames, which a static sw.js cannot know ahead of time, so we scan dist/ after the build
// and inject the complete asset list + a content-derived cache version into dist/sw.js.
//
// The pure core (toPrecacheUrls / cacheVersion / injectSw) is exported and unit-tested; the CLI
// wrapper at the bottom does the filesystem I/O and only runs when executed as a script.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

const CACHE_TOKEN = '__CACHE_VERSION__';
const PRECACHE_TOKEN = '/*__PRECACHE__*/';

/**
 * dist-relative file paths -> sorted, de-duplicated, ./-prefixed URL list (plus the './' root
 * navigation alias). The service worker itself and source maps are never precached.
 */
export function toPrecacheUrls(relPaths) {
  const urls = new Set(['./']);
  for (const p of relPaths) {
    const posix = p.split('\\').join('/');
    if (posix === 'sw.js' || posix.endsWith('.map')) continue;
    urls.add('./' + posix);
  }
  return [...urls].sort();
}

/** Deterministic, order-independent cache name derived from each file's url + content hash. */
export function cacheVersion(entries) {
  const sorted = [...entries].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  const h = createHash('sha256');
  for (const { url, hash } of sorted) h.update(url + ':' + hash + '\n');
  return 'champions-teamsheet-' + h.digest('hex').slice(0, 12);
}

/** Replace the sw.js placeholders with the real precache list + cache version. */
export function injectSw(swSource, { precache, cacheVersion }) {
  if (!precache || precache.length === 0) throw new Error('gen-precache: precache list is empty');
  if (!swSource.includes(CACHE_TOKEN)) throw new Error(`gen-precache: missing ${CACHE_TOKEN} in sw.js`);
  if (!swSource.includes(PRECACHE_TOKEN)) throw new Error(`gen-precache: missing ${PRECACHE_TOKEN} in sw.js`);
  const list = precache.map((u) => JSON.stringify(u)).join(',');
  return swSource.split(CACHE_TOKEN).join(cacheVersion).split(PRECACHE_TOKEN).join(list);
}

// ---- CLI wrapper -----------------------------------------------------------------------------

function walk(dir, base, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(relative(base, full));
  }
  return out;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dist = join(root, 'dist');
  const swPath = join(dist, 'sw.js');
  const precache = toPrecacheUrls(walk(dist, dist));
  const entries = precache
    .filter((u) => u !== './')
    .map((u) => {
      const rel = u.slice(2).split('/').join(sep);
      const hash = createHash('sha256').update(readFileSync(join(dist, rel))).digest('hex');
      return { url: u, hash };
    });
  const version = cacheVersion(entries);
  const out = injectSw(readFileSync(swPath, 'utf8'), { precache, cacheVersion: version });
  writeFileSync(swPath, out);
  console.log(`[gen-precache] ${precache.length} urls, cache ${version} -> dist/sw.js`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
