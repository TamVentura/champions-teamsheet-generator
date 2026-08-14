// One-shot release: bump version -> build web -> sync Capacitor -> assemble signed AAB ->
// upload to Google Play (closed-testing "alpha" track) via scripts/publish-play.mjs.
//
// Runs unattended. Google Play requires a strictly increasing versionCode for every upload,
// so this always increments versionCode; versionName is bumped by minor (1.1 -> 1.2) unless
// you pass one explicitly.
//
// Usage:
//   node scripts/release.mjs                       # auto-bump code +1, versionName minor +1
//   NEW_VERSION_NAME=1.3 node scripts/release.mjs  # force a specific versionName
//   NEW_VERSION_CODE=9  node scripts/release.mjs   # force a specific versionCode
//   PLAY_RELEASE_NOTES="..." node scripts/release.mjs   # override the "what's new" text
//   SKIP_PUBLISH=1 node scripts/release.mjs        # build the .aab but do not upload
//
// Requires (already set up in this repo):
//   - android/keystore.properties  -> signed release build
//   - the Play service-account key  -> upload (see scripts/publish-play.mjs)
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const GRADLE = resolve(ROOT, 'android/app/build.gradle');
const AAB = resolve(ROOT, 'android/app/build/outputs/bundle/release/app-release.aab');
const IS_WIN = process.platform === 'win32';

function run(cmd, opts = {}) {
  console.log(`\n[release] $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

// --- 1. Bump version in android/app/build.gradle -----------------------------------------
let gradle = readFileSync(GRADLE, 'utf8');

const curCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
const curName = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
if (!Number.isFinite(curCode) || !curName) {
  console.error('[release] could not parse versionCode/versionName from build.gradle');
  process.exit(1);
}

const newCode = Number(process.env.NEW_VERSION_CODE) || curCode + 1;
const newName = process.env.NEW_VERSION_NAME || bumpMinor(curName);

function bumpMinor(name) {
  const m = name.match(/^(\d+)\.(\d+)(.*)$/);
  if (!m) return name; // non-semver: leave as-is, only versionCode changes
  return `${m[1]}.${Number(m[2]) + 1}${m[3]}`;
}

gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${newCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${newName}"`);
writeFileSync(GRADLE, gradle);
console.log(`[release] version ${curName} (code ${curCode})  ->  ${newName} (code ${newCode})`);

// --- 2. Build the web app + Capacitor precache -------------------------------------------
run('npm run build');

// --- 3. Sync the web assets into the Android project -------------------------------------
run('npx cap sync android');

// --- 4. Assemble the signed release bundle (.aab) ----------------------------------------
const androidDir = resolve(ROOT, 'android');
const gradlew = resolve(androidDir, IS_WIN ? 'gradlew.bat' : 'gradlew');
// The Android Gradle Plugin needs a JDK 11+ (Java 8 fails to resolve AGP). Prefer an explicit
// JAVA_HOME, else Android Studio's bundled JBR (21), else a modern JDK on disk.
const javaHome = pickJavaHome();
if (javaHome) console.log(`[release] JAVA_HOME=${javaHome}`);
run(`"${gradlew}" bundleRelease`, {
  cwd: androidDir,
  env: javaHome ? { ...process.env, JAVA_HOME: javaHome } : process.env,
});

function pickJavaHome() {
  const env = process.env.JAVA_HOME;
  if (env && existsSync(resolve(env, 'bin', IS_WIN ? 'java.exe' : 'java'))) return env;
  const candidates = IS_WIN ? [
    'C:/Program Files/Android/Android Studio/jbr',
    'C:/Program Files/Java/jdk-24',
    'C:/Program Files/Java/jdk-21',
  ] : [];
  return candidates.find((d) => existsSync(resolve(d, 'bin', IS_WIN ? 'java.exe' : 'java'))) || null;
}

if (!existsSync(AAB)) {
  console.error(`[release] expected AAB not found at ${AAB}`);
  process.exit(1);
}
console.log(`[release] built ${AAB}`);

// --- 5. Publish to Google Play -----------------------------------------------------------
if (process.env.SKIP_PUBLISH) {
  console.log('[release] SKIP_PUBLISH set — done (not uploaded).');
  process.exit(0);
}

const notes = process.env.PLAY_RELEASE_NOTES ||
  `What's new in ${newName}:\n` +
  '- Nicknamed Pokemon are now recognised — the app infers each Pokemon’s species even when you gave it a custom name.\n' +
  '- More reliable screenshot reading, including Tera-type detection.\n' +
  '- Polish and fixes.';

run(`node scripts/publish-play.mjs "${AAB}" ${JSON.stringify(notes)}`, {
  env: { ...process.env, PLAY_VERSION_NAME: newName },
});

console.log(`\n[release] DONE — v${newName} (code ${newCode}) uploaded to the Play "alpha" track and sent for review.`);
