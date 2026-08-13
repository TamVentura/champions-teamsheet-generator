import { describe, expect, it } from 'vitest';
// Pure core of the post-build precache generator (scripts/gen-precache.mjs).
import { toPrecacheUrls, cacheVersion, injectSw } from '../../scripts/gen-precache.mjs';

describe('toPrecacheUrls', () => {
  it('maps dist-relative files to ./-prefixed URLs and adds the root alias', () => {
    const urls = toPrecacheUrls(['index.html', 'assets/index-AbC123.js']);
    expect(urls).toContain('./');
    expect(urls).toContain('./index.html');
    expect(urls).toContain('./assets/index-AbC123.js');
  });

  it('includes the tesseract engine files', () => {
    const urls = toPrecacheUrls([
      'index.html',
      'tesseract/worker.min.js',
      'tesseract/eng.traineddata',
      'tesseract/tesseract-core-simd-lstm.wasm',
    ]);
    expect(urls).toContain('./tesseract/worker.min.js');
    expect(urls).toContain('./tesseract/eng.traineddata');
    expect(urls).toContain('./tesseract/tesseract-core-simd-lstm.wasm');
  });

  it('excludes the service worker itself and source maps', () => {
    const urls = toPrecacheUrls(['index.html', 'sw.js', 'assets/index-AbC123.js.map']);
    expect(urls).not.toContain('./sw.js');
    expect(urls.some((u) => u.endsWith('.map'))).toBe(false);
  });

  it('normalizes Windows path separators to forward slashes', () => {
    const urls = toPrecacheUrls(['assets\\index-AbC123.js', 'icons\\icon-192.png']);
    expect(urls).toContain('./assets/index-AbC123.js');
    expect(urls).toContain('./icons/icon-192.png');
  });

  it('returns a sorted, de-duplicated list', () => {
    const urls = toPrecacheUrls(['b.js', 'a.js', 'a.js']);
    expect(urls).toEqual([...new Set(urls)]);
    const sorted = [...urls].sort();
    expect(urls).toEqual(sorted);
  });
});

describe('cacheVersion', () => {
  it('is deterministic for the same inputs', () => {
    const entries = [
      { url: './index.html', hash: 'aaa' },
      { url: './app.js', hash: 'bbb' },
    ];
    expect(cacheVersion(entries)).toBe(cacheVersion(entries));
  });

  it('is order-independent (sorts before hashing)', () => {
    const a = [
      { url: './index.html', hash: 'aaa' },
      { url: './app.js', hash: 'bbb' },
    ];
    const b = [
      { url: './app.js', hash: 'bbb' },
      { url: './index.html', hash: 'aaa' },
    ];
    expect(cacheVersion(a)).toBe(cacheVersion(b));
  });

  it('changes when any file content hash changes', () => {
    const before = [{ url: './index.html', hash: 'aaa' }];
    const after = [{ url: './index.html', hash: 'zzz' }];
    expect(cacheVersion(before)).not.toBe(cacheVersion(after));
  });
});

describe('injectSw', () => {
  const template = `const CACHE = '__CACHE_VERSION__';\nconst PRECACHE = [/*__PRECACHE__*/];\n`;

  it('replaces the cache-version and precache tokens', () => {
    const out = injectSw(template, {
      precache: ['./', './index.html'],
      cacheVersion: 'champions-teamsheet-deadbeef',
    });
    expect(out).toContain("const CACHE = 'champions-teamsheet-deadbeef';");
    expect(out).toContain('const PRECACHE = ["./","./index.html"];');
    expect(out).not.toContain('__CACHE_VERSION__');
    expect(out).not.toContain('__PRECACHE__');
  });

  it('throws when the precache list is empty (never ships a no-op SW)', () => {
    expect(() => injectSw(template, { precache: [], cacheVersion: 'x' })).toThrow();
  });

  it('throws when a placeholder token is missing', () => {
    expect(() =>
      injectSw('no tokens here', { precache: ['./'], cacheVersion: 'x' })
    ).toThrow();
  });
});
