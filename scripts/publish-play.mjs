// Upload a signed AAB to the Google Play "Alpha" (closed testing) track via the
// Google Play Android Developer API — no 10MB browser bridge, no manual drag.
//
// Auth: a service-account JSON key. Path from PLAY_SA_KEY env or the default below.
// The service account (play-publisher@teamsheet-publish.iam.gserviceaccount.com) must be
// invited in Play Console → Users and permissions with "Release to testing tracks" for this app.
//
// Usage:
//   node scripts/publish-play.mjs <path-to-aab> ["release notes"]
// Example:
//   node scripts/publish-play.mjs android/app/build/outputs/bundle/release/app-release.aab
import { google } from 'googleapis';
import { readFileSync, createReadStream } from 'node:fs';

const PKG = 'pt.tamventura.teamsheet';
const TRACK = process.env.PLAY_TRACK || 'alpha'; // "Closed testing - Alpha"
const KEY_PATH = process.env.PLAY_SA_KEY || 'C:/Users/tamve/.secrets/teamsheet-play-publisher.json';
const AAB = process.argv[2] || 'android/app/build/outputs/bundle/release/app-release.aab';
// Version name shown in the release title. Passed by scripts/release.mjs; falls back to
// whatever is declared in android/app/build.gradle so a manual run stays correct.
const VERSION_NAME = process.env.PLAY_VERSION_NAME || readVersionName() || '1.1';
const NOTES = process.argv[3] || process.env.PLAY_RELEASE_NOTES ||
  "What's new in 1.1:\n- New: paste a Pokemon Showdown / PokePaste team directly, as an alternative to reading the two screenshots.\n- Save, export and import your player profiles.\n- Clearer review screen that shows which screenshot each value came from.\n- Polish and fixes.";

function readVersionName() {
  try {
    const gradle = readFileSync('android/app/build.gradle', 'utf8');
    return gradle.match(/versionName\s+"([^"]+)"/)?.[1] || null;
  } catch { return null; }
}

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_PATH,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});
const androidpublisher = google.androidpublisher({ version: 'v3', auth });

async function main() {
  console.log(`[play] package=${PKG} track=${TRACK}`);
  console.log(`[play] aab=${AAB}`);
  const edit = await androidpublisher.edits.insert({ packageName: PKG });
  const editId = edit.data.id;
  console.log(`[play] editId=${editId}`);

  const up = await androidpublisher.edits.bundles.upload({
    packageName: PKG,
    editId,
    media: { mimeType: 'application/octet-stream', body: createReadStream(AAB) },
  });
  const versionCode = up.data.versionCode;
  console.log(`[play] uploaded bundle versionCode=${versionCode}`);

  await androidpublisher.edits.tracks.update({
    packageName: PKG,
    editId,
    track: TRACK,
    requestBody: {
      track: TRACK,
      releases: [{
        name: `${versionCode} (${VERSION_NAME})`,
        versionCodes: [String(versionCode)],
        status: 'completed',
        releaseNotes: [{ language: 'en-US', text: NOTES }],
      }],
    },
  });
  console.log(`[play] track ${TRACK} set to versionCode ${versionCode}`);

  const committed = await androidpublisher.edits.commit({ packageName: PKG, editId });
  console.log(`[play] committed edit ${committed.data.id} — sent for review`);
}

main().catch((e) => {
  console.error('[play] FAILED:', e?.errors || e?.message || e);
  process.exit(1);
});
