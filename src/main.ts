import './styles.css';
import {
  ChampionsMon,
  Division,
  PlayerProfile,
  StoredProfile,
  STAT_KEYS,
  StatKey,
  STAT_LABEL,
  emptyEvs,
} from './domain/types';
import { arrowsFromNature, validateSpread } from './domain/champions';
import { toShowdownPaste, parseShowdownPaste } from './domain/showdown';
import { vocab } from './data/vocab';
import { extractTeam, FieldFlag, SlotCrops } from './ocr/extract';
import { browserScreen, cropDataUrl, imageToCanvas, loadImageFile } from './ocr/browser';
import { classifyScreen } from './ocr/classify';
import { CARDS, movesFields, statsFields, within } from './ocr/layout';
import { buildBoth, savePdfs } from './pdf/generate';
import {
  activeProfile,
  emptyProfile,
  exportProfilesJson,
  importProfilesJson,
  loadStore,
  newProfileId,
  ProfileStore,
  saveStore,
} from './persist';
import { registerServiceWorker } from './pwa';
import type { jsPDF } from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';

/** True inside the native Capacitor app (Android), false in a plain browser/PWA. */
const isNative = Capacitor?.isNativePlatform?.() ?? false;

// The hardware/gesture Back on Android didn't navigate our History-API views (Capacitor's default
// didn't map to it here). Route it through the same history the in-app Back button uses, and only
// exit when there's nowhere left to go.
if (isNative) {
  App.addListener('backButton', () => {
    if (window.history.length > 1) window.history.back();
    else App.exitApp();
  });
}

/** Reliably trigger a download of a jsPDF doc via its own anchor + blob URL. */
function downloadDoc(doc: { output: (t: 'blob') => Blob }, filename: string): void {
  const url = URL.createObjectURL(doc.output('blob'));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 5000);
}

/**
 * Native (Android): the system WebView can't render a PDF blob in an iframe and has no print
 * dialog, so the browser flow below dead-ends ("nothing opens"). Instead we write the PDF into
 * the app cache and hand it to the OS via the share sheet, which offers a PDF viewer / Print.
 */
async function sharePdfsNative(items: { doc: jsPDF; filename: string }[]): Promise<void> {
  try {
    const files: string[] = [];
    for (const { doc, filename } of items) {
      const base64 = (doc.output('datauristring') as string).split('base64,')[1];
      const res = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
      files.push(res.uri);
    }
    await Share.share({ title: 'Team sheet', files });
  } catch (err) {
    showModal({
      title: 'Could not open the PDF',
      message: err instanceof Error ? err.message : String(err),
      buttons: [{ label: 'OK', kind: 'primary', onClick: () => {} }],
    });
  }
}

/**
 * Native (Android): actually SAVE the PDFs to the device's public Documents folder (visible in
 * Files), as opposed to the share sheet. Reports where they landed.
 */
async function savePdfsNative(items: { doc: jsPDF; filename: string }[]): Promise<void> {
  try {
    const saved: string[] = [];
    for (const { doc, filename } of items) {
      const base64 = (doc.output('datauristring') as string).split('base64,')[1];
      await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Documents });
      saved.push(filename);
    }
    showModal({
      title: 'Saved to Documents',
      message: saved.join('\n'),
      buttons: [{ label: 'OK', kind: 'primary', onClick: () => {} }],
    });
  } catch (err) {
    showModal({
      title: 'Could not save the PDF',
      message: err instanceof Error ? err.message : String(err),
      buttons: [{ label: 'OK', kind: 'primary', onClick: () => {} }],
    });
  }
}

/** Export the profile store: browser downloads the JSON; native offers share + save. */
function exportProfiles(): void {
  const json = exportProfilesJson(state.store);
  const filename = 'champions-profiles.json';
  if (!isNative) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 5000);
    return;
  }
  showModal({
    title: 'Export profiles',
    message: 'Share the file, or save it to your device Documents.',
    buttons: [
      { label: 'Share', icon: 'share', kind: 'primary', onClick: () => void shareJsonNative(json, filename) },
      { label: 'Save to Documents', icon: 'arrow-down', kind: 'secondary', onClick: () => void saveJsonNative(json, filename) },
      { label: 'Cancel', kind: 'secondary', onClick: () => {} },
    ],
  });
}

/** Native: write the JSON to app cache and hand it to the OS share sheet. */
async function shareJsonNative(json: string, filename: string): Promise<void> {
  try {
    const res = await Filesystem.writeFile({
      path: filename,
      data: json,
      encoding: Encoding.UTF8,
      directory: Directory.Cache,
    });
    await Share.share({ title: 'Champions profiles', files: [res.uri] });
  } catch (err) {
    showModal({
      title: 'Could not share the file',
      message: err instanceof Error ? err.message : String(err),
      buttons: [{ label: 'OK', kind: 'primary', onClick: () => {} }],
    });
  }
}

/** Native: save the JSON to the device's public Documents folder (visible in Files). */
async function saveJsonNative(json: string, filename: string): Promise<void> {
  try {
    await Filesystem.writeFile({
      path: filename,
      data: json,
      encoding: Encoding.UTF8,
      directory: Directory.Documents,
    });
    showModal({
      title: 'Saved to Documents',
      message: filename,
      buttons: [{ label: 'OK', kind: 'primary', onClick: () => {} }],
    });
  } catch (err) {
    showModal({
      title: 'Could not save the file',
      message: err instanceof Error ? err.message : String(err),
      buttons: [{ label: 'OK', kind: 'primary', onClick: () => {} }],
    });
  }
}

/**
 * Print a jsPDF doc. In the browser/PWA: a hidden iframe + the autoPrint OpenAction raises the
 * print dialog in-app (the manifest is `display: standalone`, so `window.open` opens nothing).
 * In the native app: fall back to the OS share/print sheet (see sharePdfsNative).
 */
function printPdf(doc: jsPDF, filename = 'teamsheet.pdf'): void {
  if (isNative) {
    void sharePdfsNative([{ doc, filename }]);
    return;
  }
  doc.autoPrint();
  const url = doc.output('bloburl') as unknown as string;
  let frame = document.getElementById('print-frame') as HTMLIFrameElement | null;
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'print-frame';
    frame.style.cssText =
      'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;visibility:hidden';
    document.body.appendChild(frame);
  }
  frame.src = url;
}

/** Human-readable nature effect, e.g. "+Atk, −SpA" or "neutral". */
function natureMeaning(nature: string): string {
  const a = arrowsFromNature(nature);
  if (!a) return 'neutral';
  return `+${STAT_LABEL[a.up]}, −${STAT_LABEL[a.down]}`;
}

type View = 'setup' | 'processing' | 'review' | 'output' | 'profileEditor' | 'about';

/** Shown on the About screen; keep in sync with android/app/build.gradle versionName. */
const APP_VERSION = '1.0';

interface EditorState {
  mode: 'add' | 'edit' | 'delete';
  draft: StoredProfile;
  /** Baseline used to detect unsaved changes. */
  original: StoredProfile;
}

type InputMode = 'screenshots' | 'paste' | 'manual';

interface State {
  view: View;
  store: ProfileStore;
  /** Per-team, required, never saved. */
  teamName: string;
  editor: EditorState | null;
  files: File[];
  /** How the current team was built — drives the source-aware review view. */
  source: InputMode;
  /** Raw text in the Showdown-paste box (kept so switching modes doesn't lose it). */
  pasteText: string;
  statsCanvas: HTMLCanvasElement | null;
  movesCanvas: HTMLCanvasElement | null;
  mons: ChampionsMon[];
  flags: FieldFlag[];
  /** Exact crop rects (full-image fractions) the reader used, for the review "Compare" view. */
  crops: SlotCrops[] | null;
  progress: string;
}

const state: State = {
  view: 'setup',
  store: loadStore(),
  teamName: '',
  editor: null,
  files: [],
  source: 'screenshots',
  pasteText: '',
  statsCanvas: null,
  movesCanvas: null,
  mons: [],
  flags: [],
  crops: null,
  progress: '',
};

// Which entry mode the setup screen shows; persisted so it's remembered next launch.
const INPUT_MODE_KEY = 'champions.inputMode.v1';
function loadInputMode(): InputMode {
  try {
    const v = localStorage.getItem(INPUT_MODE_KEY);
    if (v === 'paste' || v === 'manual') return v;
  } catch {
    /* ignore */
  }
  return 'screenshots';
}
function saveInputMode(mode: InputMode): void {
  try {
    localStorage.setItem(INPUT_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}
let inputMode: InputMode = loadInputMode();

/** A blank Pokémon for the manual-entry mode. Nature is empty on purpose (mandatory in review). */
function emptyMon(): ChampionsMon {
  return { species: '', gender: null, ability: '', item: null, nature: '', evs: emptyEvs(), moves: ['', '', '', ''] };
}

const app = document.getElementById('app')!;
const el = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// Button icons as inline SVG (Font Awesome Pro, solid). A bare arrow/emoji glyph sits on the font's
// baseline and reads as vertically off; a 1em SVG is a flex child, so the button's align-items:center
// centres it perfectly and it stays crisp at any DPI. fill=currentColor inherits the button colour.
const ICONS: Record<string, { vb: string; d: string }> = {
  'arrow-right': { vb: '0 0 512 512', d: 'M502.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L402.7 224 32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l370.7 0-105.4 105.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l160-160z' },
  'arrow-left': { vb: '0 0 512 512', d: 'M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.3 288 480 288c17.7 0 32-14.3 32-32s-14.3-32-32-32l-370.7 0 105.4-105.4c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z' },
  'arrow-down': { vb: '0 0 384 512', d: 'M169.4 502.6c12.5 12.5 32.8 12.5 45.3 0l160-160c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 402.7 224 32c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 370.7-105.4-105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160z' },
  'arrow-up': { vb: '0 0 384 512', d: 'M214.6 9.4c-12.5-12.5-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L160 109.3 160 480c0 17.7 14.3 32 32 32s32-14.3 32-32l0-370.7 105.4 105.4c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-160-160z' },
  share: { vb: '0 0 512 512', d: 'M384 192c53 0 96-43 96-96s-43-96-96-96-96 43-96 96c0 5.4 .5 10.8 1.3 16L159.6 184.1c-16.9-15-39.2-24.1-63.6-24.1-53 0-96 43-96 96s43 96 96 96c24.4 0 46.6-9.1 63.6-24.1L289.3 400c-.9 5.2-1.3 10.5-1.3 16 0 53 43 96 96 96s96-43 96-96-43-96-96-96c-24.4 0-46.6 9.1-63.6 24.1L190.7 272c.9-5.2 1.3-10.5 1.3-16s-.5-10.8-1.3-16l129.7-72.1c16.9 15 39.2 24.1 63.6 24.1z' },
  print: { vb: '0 0 512 512', d: 'M64 64C64 28.7 92.7 0 128 0L341.5 0c17 0 33.3 6.7 45.3 18.7l42.5 42.5c12 12 18.7 28.3 18.7 45.3l0 37.5-384 0 0-80zM0 256c0-35.3 28.7-64 64-64l384 0c35.3 0 64 28.7 64 64l0 96c0 17.7-14.3 32-32 32l-32 0 0 64c0 35.3-28.7 64-64 64l-256 0c-35.3 0-64-28.7-64-64l0-64-32 0c-17.7 0-32-14.3-32-32l0-96zM128 416l0 32 256 0 0-96-256 0 0 64zM456 272a24 24 0 1 0 -48 0 24 24 0 1 0 48 0z' },
  search: { vb: '0 0 512 512', d: 'M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376C296.3 401.1 253.9 416 208 416 93.1 416 0 322.9 0 208S93.1 0 208 0 416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z' },
};
const ico = (name: keyof typeof ICONS): string => {
  const i = ICONS[name];
  return `<svg class="ico" viewBox="${i.vb}" aria-hidden="true" focusable="false"><path fill="currentColor" d="${i.d}"/></svg>`;
};

function hasFlag(slot: number, field: string): FieldFlag | undefined {
  return state.flags.find((f) => f.slot === slot && f.field === field);
}

function flagByReason(slot: number, reason: FieldFlag['reason']): FieldFlag | undefined {
  return state.flags.find((f) => f.slot === slot && f.reason === reason);
}

// ---------------- Navigation (History API) ----------------

/** Move forward to a new view, adding a history entry so the Back button returns here. */
function goForward(view: View): void {
  state.view = view;
  history.pushState({ view }, '');
  render();
}

/** Apply a view without touching history (used by the popstate handler). */
function applyView(view: View): void {
  state.view = view;
  if (view !== 'profileEditor') state.editor = null;
  render();
}

/** The identity fields that count towards "unsaved changes" (id excluded). */
function idFields(p: PlayerProfile): string {
  const { playerName, trainerNameInGame, switchProfileName, playerId, dateOfBirth, division } = p;
  return JSON.stringify({ playerName, trainerNameInGame, switchProfileName, playerId, dateOfBirth, division });
}

function isEditorDirty(): boolean {
  const e = state.editor;
  if (!e || e.mode === 'delete') return false;
  return idFields(e.draft) !== idFields(e.original);
}

window.addEventListener('popstate', (ev: PopStateEvent) => {
  const target = ((ev.state && (ev.state as { view?: View }).view) || 'setup') as View;
  // Guard: leaving the editor with unsaved changes.
  if (state.view === 'profileEditor' && isEditorDirty()) {
    // Undo the pop — put the editor entry back on top — then ask what to do.
    history.pushState({ view: 'profileEditor' }, '');
    showModal({
      title: 'Unsaved changes',
      message: 'You have unsaved changes to this profile.',
      buttons: [
        { label: 'Save', kind: 'primary', onClick: () => { commitEditor(); state.editor = null; history.back(); } },
        { label: 'Discard', kind: 'danger', onClick: () => { state.editor = null; history.back(); } },
        { label: 'Cancel', kind: 'secondary', onClick: () => { /* stay in the editor */ } },
      ],
    });
    return;
  }
  applyView(target);
});

// ---------------- Modal ----------------

interface ModalButton {
  label: string;
  icon?: keyof typeof ICONS;
  kind?: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
}

function showModal(opts: { title: string; message: string; buttons: ModalButton[] }): void {
  const overlay = el(`<div class="modal-overlay">
    <div class="modal">
      <h3>${esc(opts.title)}</h3>
      <p>${esc(opts.message)}</p>
      <div class="row modal-actions"></div>
    </div>
  </div>`);
  const actions = overlay.querySelector('.modal-actions')!;
  opts.buttons.forEach((b) => {
    const btn = el(`<button class="${b.kind === 'primary' ? '' : b.kind === 'danger' ? 'danger' : 'secondary'}">${b.icon ? ico(b.icon) : ''}${esc(b.label)}</button>`);
    btn.addEventListener('click', () => {
      overlay.remove();
      b.onClick();
    });
    actions.appendChild(btn);
  });
  document.body.appendChild(overlay);
}

// ---------------- Setup / upload view ----------------

function profileSummary(p: StoredProfile): string {
  const rows: [string, string][] = [
    ['Player Name', p.playerName],
    ['Trainer Name in Game', p.trainerNameInGame],
    ['Switch Profile Name', p.switchProfileName],
    ['Player ID', p.playerId],
    ['Date of Birth', p.dateOfBirth],
    ['Age Division', p.division],
  ];
  return `<div class="grid2" style="margin-top:12px">${rows
    .map(([k, v]) => `<div><div class="muted">${k}</div><div>${esc(v || '—')}</div></div>`)
    .join('')}</div>`;
}

function openEditor(mode: EditorState['mode']): void {
  if (mode === 'add') {
    const draft: StoredProfile = { ...emptyProfile(), id: newProfileId() };
    state.editor = { mode, draft, original: { ...draft } };
  } else {
    const active = activeProfile(state.store);
    if (!active) return;
    state.editor = { mode, draft: { ...active }, original: { ...active } };
  }
  goForward('profileEditor');
}

function renderSetup() {
  const store = state.store;
  const active = activeProfile(store);
  const hasProfiles = store.profiles.length > 0;

  const seg = (mode: InputMode, label: string) =>
    `<button type="button" role="radio" data-mode="${mode}" aria-checked="${inputMode === mode}" tabindex="${inputMode === mode ? 0 : -1}">${label}</button>`;

  const modePanelHtml =
    inputMode === 'screenshots'
      ? `<p class="muted">Pick both screenshots (the <b>Stats</b> and the <b>Moves &amp; More</b> screen) — any order. The app tells them apart from the highlighted tab at the top.</p>
         <input type="file" id="files" accept="image/*" multiple>
         <div class="muted" id="filesName">${esc(state.files.map((f) => f.name).join(', '))}</div>`
      : inputMode === 'paste'
        ? `<p class="muted">Paste a Pokémon Showdown / PokePaste team. EVs are kept exactly as pasted; the review flags anything outside the Champions budget (66).</p>
           <textarea id="pasteBox" rows="10" placeholder="Paste your Showdown team here…">${esc(state.pasteText)}</textarea>`
        : `<p class="muted">Start with six blank Pokémon and fill them in by hand — species, moves, held items and abilities autocomplete as you type.</p>`;

  const actionHtml =
    inputMode === 'screenshots'
      ? `<button id="go" disabled>Read screenshots${ico('arrow-right')}</button>`
      : inputMode === 'paste'
        ? `<button id="goPaste" disabled>Import paste${ico('arrow-right')}</button>`
        : `<button id="goManual" disabled>Start blank${ico('arrow-right')}</button>`;

  const div = el(`<div>
    <h1>🏆 Champions Teamsheet Generator</h1>
    <p class="muted">Upload the two in-game screenshots (Stats and Moves &amp; More), review the read-out, and export the Showdown paste and the official OTS / Staff PDFs.</p>

    <div class="panel">
      <div class="row" style="justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <h2 style="margin:0 0 6px">Profile <span class="muted">(saved on this device)</span></h2>
          <select id="profileSel" style="width:100%" ${hasProfiles ? '' : 'disabled'}>
            ${
              hasProfiles
                ? store.profiles
                    .map((p) => `<option value="${esc(p.id)}" ${p.id === store.activeId ? 'selected' : ''}>${esc(p.playerName || '(unnamed)')}</option>`)
                    .join('')
                : '<option>No profiles yet</option>'
            }
          </select>
        </div>
        <div class="row" style="gap:6px">
          <button id="addProfile" class="secondary">+ Add</button>
          <button id="editProfile" class="secondary" ${active ? '' : 'disabled'}>Edit</button>
          <button id="delProfile" class="secondary" ${active ? '' : 'disabled'}>Delete</button>
          <button id="exportProfiles" class="secondary" ${hasProfiles ? '' : 'disabled'}>${ico('arrow-down')}Export</button>
          <button id="importProfiles" class="secondary">${ico('arrow-up')}Import</button>
          <input type="file" id="importFile" accept=".json,application/json" hidden>
        </div>
      </div>
      ${active ? profileSummary(active) : '<p class="muted" style="margin-top:12px">No profile yet — add one to continue.</p>'}
    </div>

    <div class="panel">
      <h2>Battle Team <span class="muted">(this team only — not saved)</span></h2>
      <label>Battle Team Number / Name <span style="color:var(--error)">*</span></label>
      <input id="teamName" value="${esc(state.teamName)}" placeholder="e.g. 3 or &quot;Sun Team&quot;">
    </div>

    <div class="panel">
      <h2>Build your team</h2>
      <div class="segmented" role="radiogroup" aria-label="How to build the team">
        ${seg('screenshots', 'Screenshots')}
        ${seg('paste', 'Showdown paste')}
        ${seg('manual', 'Manual')}
      </div>
      <div id="modePanel" style="margin-top:12px">${modePanelHtml}</div>
    </div>

    <div class="row">
      ${actionHtml}
      <span class="muted" id="hint"></span>
    </div>

    <footer class="app-footer">
      <button id="about" class="linkbtn">About</button>
    </footer>
  </div>`);

  const hint = div.querySelector<HTMLElement>('#hint')!;
  const updateGate = () => {
    const a = activeProfile(state.store);
    let ready = false;
    let msg = '';
    if (!a) msg = 'Add or select a profile.';
    else if (!state.teamName.trim()) msg = 'Enter the Battle Team number / name.';
    else if (inputMode === 'screenshots') {
      ready = state.files.length === 2;
      msg = ready ? 'Ready.' : 'Select exactly two screenshots.';
    } else if (inputMode === 'paste') {
      ready = state.pasteText.trim().length > 0;
      msg = ready ? 'Ready.' : 'Paste a Showdown team.';
    } else {
      ready = true;
      msg = 'Ready.';
    }
    const action = div.querySelector<HTMLButtonElement>('#go, #goPaste, #goManual');
    if (action) action.disabled = !ready;
    hint.textContent = msg;
  };

  // Segmented mode selector — one active, persisted, re-renders the panel below.
  const switchMode = (mode: InputMode) => {
    if (mode === inputMode) return;
    inputMode = mode;
    saveInputMode(mode);
    render();
  };
  div.querySelectorAll<HTMLButtonElement>('.segmented [role="radio"]').forEach((b) => {
    b.addEventListener('click', () => switchMode(b.dataset.mode as InputMode));
  });
  div.querySelector<HTMLElement>('.segmented')!.addEventListener('keydown', (e) => {
    const modes: InputMode[] = ['screenshots', 'paste', 'manual'];
    const i = modes.indexOf(inputMode);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      switchMode(modes[(i + 1) % modes.length]);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      switchMode(modes[(i + modes.length - 1) % modes.length]);
    }
  });

  div.querySelector<HTMLSelectElement>('#profileSel')!.addEventListener('change', (e) => {
    state.store.activeId = (e.target as HTMLSelectElement).value;
    saveStore(state.store);
    render();
  });
  div.querySelector('#addProfile')!.addEventListener('click', () => openEditor('add'));
  div.querySelector('#editProfile')!.addEventListener('click', () => openEditor('edit'));
  div.querySelector('#delProfile')!.addEventListener('click', () => openEditor('delete'));
  div.querySelector('#about')!.addEventListener('click', () => goForward('about'));

  div.querySelector('#exportProfiles')?.addEventListener('click', () => exportProfiles());
  const importFile = div.querySelector<HTMLInputElement>('#importFile');
  div.querySelector('#importProfiles')?.addEventListener('click', () => importFile?.click());
  importFile?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      state.store = importProfilesJson(await file.text(), state.store);
      saveStore(state.store);
      render();
    } catch {
      showModal({
        title: 'Could not import',
        message: 'That file is not a valid profiles export.',
        buttons: [{ label: 'OK', kind: 'primary', onClick: () => {} }],
      });
    }
  });

  div.querySelector<HTMLInputElement>('#teamName')!.addEventListener('input', (e) => {
    state.teamName = (e.target as HTMLInputElement).value;
    updateGate();
  });

  const filesInput = div.querySelector<HTMLInputElement>('#files');
  if (filesInput) {
    filesInput.addEventListener('change', (e) => {
      state.files = Array.from((e.target as HTMLInputElement).files ?? []).slice(0, 2);
      const namesEl = div.querySelector('#filesName');
      if (namesEl) namesEl.textContent = state.files.map((f) => f.name).join(', ');
      updateGate();
    });
  }
  const pasteBox = div.querySelector<HTMLTextAreaElement>('#pasteBox');
  if (pasteBox) {
    pasteBox.addEventListener('input', (e) => {
      state.pasteText = (e.target as HTMLTextAreaElement).value;
      updateGate();
    });
  }
  div.querySelector('#go')?.addEventListener('click', runExtraction);
  div.querySelector('#goPaste')?.addEventListener('click', runPaste);
  div.querySelector('#goManual')?.addEventListener('click', runManual);

  app.replaceChildren(div);
  updateGate();
}

// ---------------- Profile editor view ----------------

function commitEditor(): void {
  const e = state.editor;
  if (!e || e.mode === 'delete') return;
  const p: StoredProfile = { ...e.draft };
  const idx = state.store.profiles.findIndex((x) => x.id === p.id);
  if (idx >= 0) state.store.profiles[idx] = p;
  else state.store.profiles.push(p);
  state.store.activeId = p.id;
  saveStore(state.store);
}

function deleteActive(): void {
  const e = state.editor;
  if (!e) return;
  state.store.profiles = state.store.profiles.filter((x) => x.id !== e.draft.id);
  if (state.store.activeId === e.draft.id) state.store.activeId = state.store.profiles[0]?.id ?? null;
  saveStore(state.store);
  state.editor = null;
  history.back();
}

function renderProfileEditor() {
  const e = state.editor!;
  const d = e.draft;
  const ro = e.mode === 'delete';
  const title = e.mode === 'add' ? 'Add profile' : e.mode === 'edit' ? 'Edit profile' : 'Delete this profile?';

  const field = (id: keyof PlayerProfile, label: string, placeholder = '') =>
    `<div><label>${label}</label><input data-p="${id}" ${ro ? 'disabled' : ''}${placeholder ? ` placeholder="${placeholder}"` : ''} value="${esc(String(d[id]))}"></div>`;

  const wrap = el(`<div>
    <h1>🏆 ${esc(title)}</h1>
    <p class="muted">${ro ? 'Review the details and confirm.' : 'These details are saved on this device.'}</p>
    <div class="panel">
      <div class="grid2">
        ${field('playerName', 'Player Name')}
        ${field('trainerNameInGame', 'Trainer Name in Game')}
        ${field('switchProfileName', 'Switch Profile Name')}
        ${field('playerId', 'Player ID')}
        ${field('dateOfBirth', 'Date of Birth', 'DD/MM/YYYY')}
        <div><label>Age Division</label><select data-p="division" ${ro ? 'disabled' : ''}>
          ${(['Junior', 'Senior', 'Master'] as Division[]).map((x) => `<option ${d.division === x ? 'selected' : ''}>${x}</option>`).join('')}
        </select></div>
      </div>
    </div>
    <div class="row">
      ${
        e.mode === 'delete'
          ? '<button id="confirmDel" class="danger">Delete profile</button><button id="back" class="secondary">Cancel</button>'
          : `<button id="save">Save</button><button id="back" class="secondary">${ico('arrow-left')}Back</button>`
      }
    </div>
  </div>`);

  wrap.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-p]').forEach((input) => {
    input.addEventListener('input', () => {
      (d as any)[input.dataset.p!] = input.value;
      const save = wrap.querySelector<HTMLButtonElement>('#save');
      if (save) save.disabled = !d.playerName.trim();
    });
  });

  const save = wrap.querySelector<HTMLButtonElement>('#save');
  if (save) {
    save.disabled = !d.playerName.trim();
    save.addEventListener('click', () => {
      commitEditor();
      state.editor = null;
      history.back();
    });
  }
  const del = wrap.querySelector('#confirmDel');
  if (del) del.addEventListener('click', deleteActive);
  wrap.querySelector('#back')!.addEventListener('click', () => history.back());

  app.replaceChildren(wrap);
}

// ---------------- Processing ----------------

/** Showdown-paste mode: parse the textarea into mons + flags, then go straight to review. */
function runPaste(): void {
  const { mons, flags } = parseShowdownPaste(state.pasteText);
  if (!mons.length) {
    showModal({
      title: 'Nothing to import',
      message: 'The paste looks empty — paste a Pokémon Showdown / PokePaste team and try again.',
      buttons: [{ label: 'OK', kind: 'primary', onClick: () => {} }],
    });
    return;
  }
  state.mons = mons;
  state.flags = flags;
  state.source = 'paste';
  state.statsCanvas = null;
  state.movesCanvas = null;
  state.crops = null;
  goForward('review');
}

/** Manual mode: open the review with six blank Pokémon to fill in by hand. */
function runManual(): void {
  state.mons = Array.from({ length: 6 }, emptyMon);
  state.flags = [];
  state.source = 'manual';
  state.statsCanvas = null;
  state.movesCanvas = null;
  state.crops = null;
  goForward('review');
}

async function runExtraction() {
  state.source = 'screenshots';
  state.view = 'processing';
  state.progress = 'Loading screenshots…';
  render();
  try {
    const imgs = await Promise.all(state.files.map(loadImageFile));
    const canvases = imgs.map(imageToCanvas);
    // Auto-detect which screenshot is which from the highlighted top tab.
    const kinds = canvases.map(classifyScreen);
    let statsCanvas = canvases[kinds.indexOf('stats')] ?? null;
    let movesCanvas = canvases[kinds.indexOf('moves')] ?? null;
    if (!statsCanvas || !movesCanvas) {
      state.progress =
        'Could not tell the two screens apart — please make sure one is the Stats screen and the other the Moves & More screen (different top tab highlighted).';
      render();
      return;
    }
    state.statsCanvas = statsCanvas;
    state.movesCanvas = movesCanvas;
    state.progress = 'Reading the two screenshots…';
    render();
    const result = await extractTeam(
      browserScreen(state.statsCanvas),
      browserScreen(state.movesCanvas),
      (done, total) => {
        state.progress =
          done === 0 ? 'Reading the team…' : `Read ${done} of ${total} Pokémon…`;
        if (state.view === 'processing') renderProcessing();
      }
    );
    state.mons = result.mons;
    state.flags = result.flags;
    state.crops = result.crops;
    // Guard against the user hitting Back while OCR was running.
    if (state.view === 'processing') goForward('review');
    return;
  } catch (err) {
    state.progress = 'Error: ' + (err instanceof Error ? err.message : String(err));
  }
  render();
}

function renderProcessing() {
  app.replaceChildren(el(`<div>
    <h1>🏆 Reading…</h1>
    <div class="panel"><p>${esc(state.progress)}</p><p class="muted">Runs entirely on your device — no internet needed.</p></div>
  </div>`));
}

// ---------------- Review ----------------

function dataList(id: string, items: string[]) {
  // Cap options for performance; the input still accepts any value.
  return `<datalist id="${id}">${items.slice(0, 1500).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

function renderReview() {
  const intro =
    state.source === 'screenshots'
      ? `Fields the reader was unsure about are <span style="color:var(--warn)">highlighted</span>. Click a field's 🔍 to compare with the screenshot. Fix anything wrong, then generate.`
      : `Fill in and fix the team — species, moves, held items and abilities autocomplete as you type. Anything <span style="color:var(--warn)">highlighted</span> needs a look. Then generate.`;

  const wrap = el(`<div>
    <h1>🏆 Review</h1>
    <p class="muted">${intro}</p>
    ${dataList('dl-species', vocab.species)}
    ${dataList('dl-moves', vocab.moves)}
    ${dataList('dl-items', vocab.items)}
    ${dataList('dl-abilities', vocab.abilities)}
    <div id="cards" class="mon-grid"></div>
    <div class="row">
      <button id="gen">Generate paste + PDFs${ico('arrow-right')}</button>
      <button class="secondary" id="back">${ico('arrow-left')}Back</button>
      <span class="muted" id="genHint"></span>
    </div>
  </div>`);

  const cards = wrap.querySelector('#cards')!;
  state.mons.forEach((mon, slot) => cards.appendChild(renderMonCard(mon, slot)));

  // Nature is mandatory: block Generate until every Pokémon has one.
  const gen = wrap.querySelector<HTMLButtonElement>('#gen')!;
  const genHint = wrap.querySelector<HTMLElement>('#genHint')!;
  const revalidate = () => {
    const missing = state.mons.some((m) => !m.nature);
    gen.disabled = missing;
    genHint.textContent = missing ? 'Pick a nature for every Pokémon.' : '';
  };
  wrap.addEventListener('review:revalidate', revalidate);
  revalidate();

  gen.addEventListener('click', () => goForward('output'));
  wrap.querySelector('#back')!.addEventListener('click', () => history.back());
  app.replaceChildren(wrap);
}

function flagClass(slot: number, field: string): string {
  return hasFlag(slot, field) ? ' style="border-color:var(--warn);box-shadow:0 0 0 1px var(--warn)"' : '';
}

function renderMonCard(mon: ChampionsMon, slot: number): HTMLElement {
  const v = validateSpread(mon.evs);
  const card = el(`<div class="panel">
    <div class="row" style="justify-content:space-between">
      <strong>#${slot + 1}</strong>
      <span class="muted">EV total: <b id="evtotal" style="color:${v.ok ? 'var(--ok)' : 'var(--error)'}">${v.total}</b>/66</span>
    </div>
    <div class="grid2">
      <div><label>Species ${flagBadge(slot, 'species')}${flagByReason(slot, 'name-mismatch') ? '<span class="mismatch-badge" title="OCR name differs from the inferred species — please confirm" style="color:var(--warn);cursor:default">⚠ name?</span>' : ''}</label>
        <input list="dl-species" data-f="species"${flagClass(slot, 'species')} value="${esc(mon.species)}">
        <div class="species-candidates" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px"></div>
      </div>
      <div><label>Gender</label><select data-f="gender">
        <option value=""${mon.gender === null ? ' selected' : ''}>—</option>
        <option value="M"${mon.gender === 'M' ? ' selected' : ''}>♂ Male</option>
        <option value="F"${mon.gender === 'F' ? ' selected' : ''}>♀ Female</option>
      </select></div>
      <div><label>Ability ${flagBadge(slot, 'ability')}</label><input list="dl-abilities" data-f="ability"${flagClass(slot, 'ability')} value="${esc(mon.ability)}"></div>
      <div><label>Held Item ${flagBadge(slot, 'item')}</label><input list="dl-items" data-f="item"${flagClass(slot, 'item')} value="${esc(mon.item ?? '')}"></div>
      <div><label>Nature ${!mon.nature || hasFlag(slot, 'nature') ? '<span title="Nature is required" style="color:var(--warn)">⚠</span>' : ''} <span class="muted">(${esc(mon.nature ? natureMeaning(mon.nature) : 'required')})</span></label><select data-f="nature"${!mon.nature || hasFlag(slot, 'nature') ? ' style="border-color:var(--warn);box-shadow:0 0 0 1px var(--warn)"' : ''}>
        <option value=""${mon.nature === '' ? ' selected' : ''}>— Select nature —</option>
        ${vocab.natures.map((n) => `<option value="${n}" ${mon.nature === n ? 'selected' : ''}>${n} — ${natureMeaning(n)}</option>`).join('')}
      </select></div>
      <div></div>
      ${mon.moves.map((mv, j) => `<div><label>Move ${j + 1} ${flagBadge(slot, 'move' + (j + 1))}</label><input list="dl-moves" data-f="move${j}"${flagClass(slot, 'move' + (j + 1))} value="${esc(mv)}"></div>`).join('')}
    </div>
    <label>EVs (total must be 66, max 32 each)</label>
    <div class="row" id="evrow">
      ${STAT_KEYS.map((k) => `<div style="text-align:center"><div class="muted">${STAT_LABEL[k]}</div>
        <input type="number" min="0" max="32" data-ev="${k}" style="width:64px;text-align:center${hasFlag(slot, 'ev.' + k) || hasFlag(slot, 'evs') ? ';border-color:var(--warn)' : ''}" value="${mon.evs[k]}"></div>`).join('')}
    </div>
    <div id="crops" class="row" style="margin-top:8px"></div>
  </div>`);

  // Text/select field bindings
  card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-f]').forEach((input) => {
    input.addEventListener('input', () => {
      const f = input.dataset.f!;
      const val = input.value;
      if (f === 'species') mon.species = val;
      else if (f === 'gender') mon.gender = (val || null) as ChampionsMon['gender'];
      else if (f === 'ability') mon.ability = val;
      else if (f === 'item') mon.item = val.trim() ? val : null;
      else if (f === 'nature') {
        mon.nature = val;
        const lbl = input.closest('div')?.querySelector('label .muted');
        if (lbl) lbl.textContent = `(${val ? natureMeaning(val) : 'required'})`;
        (input as HTMLElement).style.borderColor = val ? '' : 'var(--warn)';
        (input as HTMLElement).style.boxShadow = val ? '' : '0 0 0 1px var(--warn)';
        input.dispatchEvent(new CustomEvent('review:revalidate', { bubbles: true }));
      } else if (f.startsWith('move')) mon.moves[Number(f.slice(4))] = val;
    });
  });
  // EV bindings + live total
  card.querySelectorAll<HTMLInputElement>('[data-ev]').forEach((input) => {
    input.addEventListener('input', () => {
      mon.evs[input.dataset.ev as StatKey] = Math.max(0, Math.min(99, Number(input.value) || 0));
      const vv = validateSpread(mon.evs);
      const total = card.querySelector('#evtotal')!;
      total.textContent = String(vv.total);
      (total as HTMLElement).style.color = vv.ok ? 'var(--ok)' : 'var(--error)';
    });
  });

  // Screenshot comparison crops (lazy) — only meaningful when the team came from screenshots.
  if (state.source === 'screenshots') {
  const cropsRow = card.querySelector('#crops')!;
  const compareBtn = el(`<button class="secondary" style="padding:6px 10px;font-size:0.8rem">${ico('search')}Compare with screenshots</button>`);
  compareBtn.addEventListener('click', () => {
    if (cropsRow.childElementCount) { cropsRow.replaceChildren(); return; }
    if (!state.movesCanvas || !state.statsCanvas) return;
    // Prefer the EXACT regions the reader cropped (content-adaptive, so they track the real card
    // positions on any phone). Fall back to the static reference layout only if geometry is absent.
    const c = state.crops?.[slot];
    const nameCrop = cropDataUrl(state.movesCanvas, c ? c.name : within(CARDS[slot], movesFields.name));
    const abilityCrop = cropDataUrl(state.movesCanvas, c ? c.ability : within(CARDS[slot], movesFields.ability));
    const itemCrop = cropDataUrl(state.movesCanvas, c ? c.item ?? within(CARDS[slot], movesFields.item) : within(CARDS[slot], movesFields.item));
    const movesCrop = cropDataUrl(state.movesCanvas, c ? c.moves : within(CARDS[slot], movesFields.movesBlock));
    const statsCrop = cropDataUrl(state.statsCanvas, c ? c.statsCard : CARDS[slot]);
    for (const [lbl, src] of [['name', nameCrop], ['ability', abilityCrop], ['item', itemCrop], ['moves', movesCrop], ['stats', statsCrop]] as const) {
      cropsRow.appendChild(el(`<div style="text-align:center"><div class="muted">${lbl}</div><img src="${src}" style="max-width:220px;border:1px solid var(--border);border-radius:4px"></div>`));
    }
  });
  card.appendChild(compareBtn);
  }

  const ambiguous = flagByReason(slot, 'ambiguous-species');
  const candWrap = card.querySelector<HTMLElement>('.species-candidates');
  const speciesInput = card.querySelector<HTMLInputElement>('input[data-f="species"]');
  if (ambiguous && ambiguous.candidates && candWrap && speciesInput) {
    for (const cand of ambiguous.candidates) {
      const isName = cand === mon.species; // pre-highlight the current pick (the inferred top species)
      const chip = el(
        `<button type="button" class="chip" style="padding:3px 8px;font-size:0.8rem;border-radius:12px;border:1px solid var(--border);background:${isName ? 'var(--panel-2)' : 'transparent'};color:var(--text);cursor:pointer">${esc(cand)}</button>`
      );
      chip.addEventListener('click', () => {
        mon.species = cand;
        speciesInput.value = cand;
        speciesInput.dispatchEvent(new CustomEvent('review:revalidate', { bubbles: true }));
      });
      candWrap.appendChild(chip);
    }
  }

  return card;
}

function flagBadge(slot: number, field: string): string {
  return hasFlag(slot, field) ? `<span title="Reader was unsure — please check" style="color:var(--warn)">⚠</span>` : '';
}

// ---------------- Output ----------------

function renderOutput() {
  const profile: StoredProfile = activeProfile(state.store) ?? { ...emptyProfile(), id: '' };
  const team = { profile, mons: state.mons };
  const paste = toShowdownPaste(team);
  const id = profile.playerId.trim() || 'teamsheet';
  // Fresh docs per action (cheap enough, avoids reusing a consumed jsPDF).
  const sheets = () => {
    const { open, staff } = savePdfs(profile, state.teamName, state.mons);
    return {
      staff: { doc: staff, filename: `${id}-staff.pdf` },
      open: { doc: open, filename: `${id}-OTS.pdf` },
    };
  };

  const shareVerb = isNative ? 'Share / print' : 'Print';
  const wrap = el(`<div>
    <h1>🏆 Output</h1>
    <div class="panel">
      <h2>Official PDFs</h2>
      <p class="muted">Filled from your player details and the reviewed team. <b>Staff</b> = page 1 (for tournament staff), <b>Open</b> = page 2 (for opponents).</p>
      <label>${shareVerb}</label>
      <div class="row">
        <button id="shBoth">${isNative ? ico('share') : ico('print')}Both sheets</button>
        <button id="shStaff" class="secondary">Staff only</button>
        <button id="shOpen" class="secondary">Open (OTS) only</button>
      </div>
      <label style="margin-top:14px">Save to device</label>
      <div class="row"><button id="dlBoth" class="secondary">${ico('arrow-down')}Download both</button></div>
    </div>
    <div class="panel">
      <h2>Showdown / PokePaste</h2>
      <textarea id="paste" readonly style="width:100%;height:320px;background:var(--panel-2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px;font-family:ui-monospace,Consolas,monospace">${esc(paste)}</textarea>
      <div class="row" style="margin-top:8px"><button id="copy" class="secondary">Copy paste</button></div>
    </div>
    <div class="row"><button class="secondary" id="back">${ico('arrow-left')}Back to review</button></div>
  </div>`);

  // Share / print — both sheets.
  wrap.querySelector('#shBoth')!.addEventListener('click', () => {
    const { staff, open } = sheets();
    if (isNative) void sharePdfsNative([staff, open]);
    else printPdf(buildBoth(profile, state.teamName, state.mons), `${id}-teamsheet.pdf`);
  });
  // Share / print — a single sheet (so one can go to WhatsApp, the other to email).
  wrap.querySelector('#shStaff')!.addEventListener('click', () => {
    const { staff } = sheets();
    if (isNative) void sharePdfsNative([staff]);
    else printPdf(staff.doc, staff.filename);
  });
  wrap.querySelector('#shOpen')!.addEventListener('click', () => {
    const { open } = sheets();
    if (isNative) void sharePdfsNative([open]);
    else printPdf(open.doc, open.filename);
  });
  // Download both — save real files (device Documents on native; browser download on web).
  wrap.querySelector('#dlBoth')!.addEventListener('click', () => {
    const { staff, open } = sheets();
    if (isNative) void savePdfsNative([staff, open]);
    else {
      downloadDoc(staff.doc, staff.filename);
      setTimeout(() => downloadDoc(open.doc, open.filename), 900);
    }
  });
  wrap.querySelector('#copy')!.addEventListener('click', async () => {
    await navigator.clipboard.writeText(paste);
    (wrap.querySelector('#copy') as HTMLElement).textContent = 'Copied ✓';
  });
  wrap.querySelector('#back')!.addEventListener('click', () => history.back());
  app.replaceChildren(wrap);
}

// ---------------- About ----------------

function renderAbout() {
  // External links: in the browser they open a new tab; inside the Capacitor app, links to a
  // different host than the local app origin are opened in the system browser by default.
  const wrap = el(`<div>
    <h1>🏆 About</h1>

    <div class="panel">
      <h2 style="margin-top:0">Champions Teamsheet Generator</h2>
      <p>Turn the two in-game Pokémon Champions screenshots into a Showdown paste and the
      official OTS / Staff team sheets — entirely on your device. No account, no servers:
      your screenshots and player details never leave your phone.</p>
      <p class="muted">Version ${esc(APP_VERSION)}</p>
    </div>

    <div class="panel">
      <h2 style="margin-top:0">Made by</h2>
      <p><strong>Tiago Ventura</strong></p>
    </div>

    <div class="panel">
      <h2 style="margin-top:0">Portuguese VGC community</h2>
      <p>Play Pokémon VGC and speak Portuguese? Come say hi — tournaments, team help and more.</p>
      <p><a href="https://discord.gg/u428smyhu" target="_blank" rel="noopener noreferrer">Join the Discord →</a></p>
    </div>

    <div class="panel">
      <h2 style="margin-top:0">Acknowledgements</h2>
      <p>The team sheet layout and the Pokémon data are based on the open-source
      <a href="https://github.com/DhSufi/PokemonTeamListCreator" target="_blank" rel="noopener noreferrer">PokemonTeamListCreator</a>
      by DhSufi. Thank you! 🙏</p>
    </div>

    <div class="row"><button class="secondary" id="back">${ico('arrow-left')}Back</button></div>
  </div>`);

  wrap.querySelector('#back')!.addEventListener('click', () => history.back());
  app.replaceChildren(wrap);
}

// ---------------- Router ----------------

function render() {
  if (state.view === 'setup') renderSetup();
  else if (state.view === 'processing') renderProcessing();
  else if (state.view === 'review') renderReview();
  else if (state.view === 'profileEditor') renderProfileEditor();
  else if (state.view === 'about') renderAbout();
  else renderOutput();
}

history.replaceState({ view: 'setup' }, '');
render();
registerServiceWorker();

// Silence unused import in dev builds that tree-shake statsFields.
void statsFields;
