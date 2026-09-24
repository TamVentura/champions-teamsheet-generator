// Promote the current release of one Google Play track to another (default alpha -> production)
// without uploading a new AAB: the same versionCode(s) and release notes are copied over.
//
// Auth: same service-account key as scripts/publish-play.mjs.
// Production needs "production access" granted by Google first — until then the commit fails
// with FAILED_PRECONDITION (400).
//
// Usage:
//   node scripts/promote-play.mjs                   # alpha -> production, full rollout
//   FROM_TRACK=alpha TO_TRACK=beta node scripts/promote-play.mjs
//   DRY_RUN=1 node scripts/promote-play.mjs         # validate the edit, don't commit
import { google } from 'googleapis';

const PKG = 'pt.tamventura.teamsheet';
const FROM = process.env.FROM_TRACK || 'alpha';
const TO = process.env.TO_TRACK || 'production';
const KEY_PATH = process.env.PLAY_SA_KEY || 'C:/Users/tamve/.secrets/teamsheet-play-publisher.json';
const DRY_RUN = !!process.env.DRY_RUN;

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_PATH,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});
const androidpublisher = google.androidpublisher({ version: 'v3', auth });

async function main() {
  const edit = await androidpublisher.edits.insert({ packageName: PKG });
  const editId = edit.data.id;
  try {
    const src = await androidpublisher.edits.tracks.get({ packageName: PKG, editId, track: FROM });
    const release = (src.data.releases || []).find((r) => r.status === 'completed');
    if (!release) throw new Error(`no completed release on track ${FROM}`);
    // Older uploads went up with a literal "\n" in the notes — fix them on the way over.
    const releaseNotes = (release.releaseNotes || []).map((n) => ({ ...n, text: n.text.replace(/\\n/g, '\n') }));
    console.log(`[play] ${FROM} -> ${TO}: ${release.name} (versionCodes ${release.versionCodes})`);

    await androidpublisher.edits.tracks.update({
      packageName: PKG,
      editId,
      track: TO,
      requestBody: {
        track: TO,
        releases: [{ name: release.name, versionCodes: release.versionCodes, status: 'completed', releaseNotes }],
      },
    });

    if (DRY_RUN) {
      await androidpublisher.edits.validate({ packageName: PKG, editId });
      console.log('[play] DRY_RUN: edit validated, not committed');
      await androidpublisher.edits.delete({ packageName: PKG, editId });
      return;
    }
    const committed = await androidpublisher.edits.commit({ packageName: PKG, editId });
    console.log(`[play] committed edit ${committed.data.id} — sent for review`);
  } catch (e) {
    await androidpublisher.edits.delete({ packageName: PKG, editId }).catch(() => {});
    throw e;
  }
}

main().catch((e) => {
  console.error('[play] FAILED:', e?.errors || e?.message || e);
  process.exit(1);
});
