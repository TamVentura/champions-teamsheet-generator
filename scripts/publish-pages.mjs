// Publish the app to GitHub Pages by snapshotting the current branch's tree onto the
// orphan `main` branch and pushing (the .github/workflows/deploy.yml Action then builds
// dist/ and deploys). We deliberately do NOT `git merge feat/... into main`: main's history
// is disjoint on purpose so the PII in the feat branches' old commits never reaches the
// public repo. Instead we overlay the working tree of the source branch, commit, and push.
//
// Usage:
//   node scripts/publish-pages.mjs              # snapshot the CURRENT branch
//   node scripts/publish-pages.mjs feat/xyz     # snapshot a specific branch
import { execSync } from 'node:child_process';

const DEPLOY = 'main';         // orphan branch wired to GitHub Pages (Pages source = Actions)
const REMOTE = 'origin';       // public repo github.com/TamVentura/champions-teamsheet-generator
const WORKING_DOCS = 'docs/superpowers'; // internal specs/plans — never publish

const git = (args, opts = {}) =>
  execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const gitLoud = (args) => execSync(`git ${args}`, { stdio: 'inherit' });

const source = process.argv[2] || git('rev-parse --abbrev-ref HEAD');

if (source === DEPLOY || source === 'master') {
  console.error(`[pages] refusing to snapshot from "${source}" — run this from a feat/* branch.`);
  process.exit(1);
}

// The snapshot uses the source branch's *committed* tree, so uncommitted tracked changes would
// be silently left out. Require a clean tree (untracked files like .superpowers/ are fine).
const dirty = git('status --porcelain --untracked-files=no');
if (dirty) {
  console.error(`[pages] "${source}" has uncommitted tracked changes — commit them first:\n${dirty}`);
  process.exit(1);
}

console.log(`[pages] deploying snapshot of "${source}" -> ${REMOTE}/${DEPLOY}`);

try {
  gitLoud(`checkout ${DEPLOY}`);

  // Overlay the source tree over main's working dir, then undo the two things that must NOT
  // follow the feat branch: keep main's own .gitignore (it ignores .superpowers/), and drop the
  // internal working docs that were force-added on the feat branch.
  gitLoud(`checkout ${source} -- .`);
  gitLoud(`checkout ${DEPLOY} -- .gitignore`);
  git(`rm -r --cached --ignore-unmatch ${WORKING_DOCS}`);
  gitLoud('add -A');

  // Completeness check: main's staged tree must equal the source tree, except the carve-outs
  // that main deliberately owns and the feat branches never carry:
  //   - docs/superpowers  (internal working docs, force-added on feat, stripped above)
  //   - .gitignore        (main keeps its own, restored above)
  //   - .github/workflows/deploy.yml  (the Pages deploy Action lives only on main)
  const drift = git(
    `diff --cached ${source} -- . ":(exclude)${WORKING_DOCS}" ":(exclude).gitignore" ":(exclude).github/workflows/deploy.yml"`
  );
  if (drift) {
    console.error('[pages] ABORT — staged tree differs from source beyond the expected carve-outs:');
    console.error(drift);
    throw new Error('tree drift');
  }

  if (!git('status --porcelain')) {
    console.log('[pages] nothing changed since the last deploy — main is already up to date.');
  } else {
    const short = git(`rev-parse --short ${source}`);
    gitLoud(`commit -m "deploy: snapshot from ${source} (${short})"`);
    gitLoud(`push ${REMOTE} ${DEPLOY}`);
    console.log(`[pages] pushed. The deploy Action will build dist/ and publish to GitHub Pages.`);
    console.log('[pages] live at https://tamventura.github.io/champions-teamsheet-generator/');
  }

  gitLoud(`checkout ${source}`);
  console.log(`[pages] DONE — back on "${source}".`);
} catch (e) {
  console.error(`[pages] FAILED: ${e?.message || e}`);
  // Restore the source branch; the overlaid, uncommitted copies on main are disposable.
  try { gitLoud(`checkout -f ${source}`); } catch {}
  process.exit(1);
}
