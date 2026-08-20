// Vendor the tesseract.js OCR engine into `public/tesseract/` so the app is FULLY OFFLINE:
// no CDN fetch for the worker, the WASM core, or the language data. Runs before every build.
//
// What we copy:
//   - worker.min.js                      (from tesseract.js)
//   - the entire tesseract.js-core dist  (both SIMD and non-SIMD LSTM cores + loaders)
//   - eng.traineddata.gz                 (gzipped from the repo-root eng.traineddata)
//
// Shipping BOTH cores lets tesseract.js auto-select at runtime: a modern WebView (Android 13)
// uses the SIMD core and is fast; an older WebView (Android 8) falls back to the base core.
// Nobody is left out. `public/tesseract/` is git-ignored — this script is the source of truth.

import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  mkdirSync,
  rmSync,
  readdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'tesseract');

function pkgDir(pkg) {
  // Resolve a package's install dir via its package.json (robust to hoisting).
  return dirname(require.resolve(`${pkg}/package.json`));
}

// Resolve a package via ANOTHER package's require context. pnpm's strict node_modules only exposes
// a package's own declared deps, so a transitive dep like `tesseract.js-core` (a dep of
// `tesseract.js`, not of this repo) isn't resolvable from the root — but it IS from tesseract.js's
// own dir. On npm's flat layout this simply falls through to the same place.
function pkgDirFrom(fromPkg, pkg) {
  const req = createRequire(require.resolve(`${fromPkg}/package.json`));
  return dirname(req.resolve(`${pkg}/package.json`));
}

// Fresh output dir.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// 1) worker script
const workerSrc = join(pkgDir('tesseract.js'), 'dist', 'worker.min.js');
copyFileSync(workerSrc, join(outDir, 'worker.min.js'));

// 2) core: ONLY the LSTM WASM variants. createWorker uses OEM 1 (LSTM), so getCore loads either
//    tesseract-core-simd-lstm.wasm.js (modern WebView with WASM SIMD) or tesseract-core-lstm.wasm.js
//    (older WebView, e.g. Android 8) — plus their .wasm. The non-LSTM cores and the asm.js
//    fallbacks are dead weight (~16 MB) and are intentionally not bundled.
const coreDir = pkgDirFrom('tesseract.js', 'tesseract.js-core');
const coreFiles = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
];
let coreCount = 0;
for (const name of coreFiles) {
  copyFileSync(join(coreDir, name), join(outDir, name));
  coreCount++;
}

// 3) language data: write GZIP-COMPRESSED bytes but name the file `eng.traineddata` (no `.gz`).
//    Why: the Android build auto-decompresses assets whose name ends in `.gz` and drops the
//    suffix, so `eng.traineddata.gz` 404s in the packaged WebView (OCR hangs). Naming it plain
//    `eng.traineddata` keeps Android's hands off it, and it stays ~3 MB in the APK (vs ~5 MB
//    uncompressed). With `gzip:false`, tesseract fetches this exact path; it then detects the
//    gzip magic bytes and inflates the data itself. Same file works on web and Android.
const langSrc = join(root, 'eng.traineddata');
if (!existsSync(langSrc)) {
  console.error(
    `[vendor-ocr] Missing ${langSrc}. It is the source for eng.traineddata and must be present.`
  );
  process.exit(1);
}
const gz = gzipSync(readFileSync(langSrc), { level: 9 });
writeFileSync(join(outDir, 'eng.traineddata'), gz);

console.log(
  `[vendor-ocr] wrote worker.min.js, ${coreCount} core files, eng.traineddata ` +
    `(gzip content, ${(gz.length / 1e6).toFixed(2)} MB) -> public/tesseract/`
);
