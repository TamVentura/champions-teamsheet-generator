# Building & publishing the Android app

The Android app is a [Capacitor](https://capacitorjs.com/) wrapper around the existing web app.
It bundles the built `dist/` (including the tesseract OCR engine) inside the APK, so it runs
**fully offline** — no dependency on the hosted site and no network needed on first launch.

- **appId (package):** `pt.tamventura.teamsheet` (permanent — never change it on the Play Store)
- **App name:** Teamsheet
- **Min Android:** 8.0 (API 26); recommended 13
- **Signing:** Play App Signing (Google holds the app signing key; you hold the *upload* key)

Everything up to the native compile is prepared in this repo. The steps below produce and publish
the signed `.aab`. They need a machine with the Android toolchain — **not** this dev box (which has
only Java 8 and no Android SDK).

## Prerequisites (one-time, on the build machine)

1. **JDK 17** (Temurin/Adoptium). Capacitor 7 + Android Gradle Plugin require Java 17.
2. **Android SDK** — easiest via [Android Studio](https://developer.android.com/studio). Install
   the SDK Platform for API 35 and the latest build-tools. Set `ANDROID_HOME` (or create
   `android/local.properties` with `sdk.dir=/path/to/Android/sdk`).
3. Node 20+ and `npm install` in the repo.

## Regenerate the web build and sync it into the native project

The OCR engine and web assets are generated, not committed, so always build before syncing:

```bash
npm run build            # runs vendor:ocr, tsc, vite build  -> dist/ (incl. dist/tesseract/)
npx cap sync android     # copies dist/ into android/app/src/main/assets/public/
# convenience: `npm run cap:sync` does both
```

Verify the engine landed in the native assets (should list worker + both cores + traineddata):

```bash
ls android/app/src/main/assets/public/tesseract/
```

## Create the upload keystore (one-time)

```bash
keytool -genkeypair -v \
  -keystore teamsheet-upload.jks \
  -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

Store `teamsheet-upload.jks` **outside** the repo and back it up — losing it complicates future
updates. Then create `android/keystore.properties` (git-ignored) so Gradle can sign the release:

```properties
storeFile=/absolute/path/to/teamsheet-upload.jks
storePassword=********
keyAlias=upload
keyPassword=********
```

`android/app/build.gradle` already reads this file for the `release` signing config. Without it,
release falls back to debug signing (fine for local testing, not for the Play Store).

## Build the signed App Bundle (.aab)

```bash
cd android
./gradlew bundleRelease
# output: android/app/build/outputs/bundle/release/app-release.aab
```

For a quick device/emulator test instead of a bundle:

```bash
./gradlew assembleDebug     # android/app/build/outputs/apk/debug/app-debug.apk
# or open in Android Studio and Run:  npm run android:open
```

## Final smoke test (do this before every release)

On a real device or emulator (ideally one Android 8 and one Android 13):

1. Install the APK.
2. **Enable airplane mode** (proves offline).
3. Open the app, load two Champions screenshots, generate the paste + PDFs.
   - First OCR run initialises tesseract from the bundled engine; there must be **no** network
     access and it must succeed offline.

## Publish to the Play Store

1. Play Console → your app → **Setup → App integrity**: keep **Play App Signing** enabled (default
   for new apps). Upload with the upload key; Google re-signs with the managed app-signing key.
2. **Testing → Internal testing**: create a release, upload `app-release.aab`, add testers, share
   the opt-in link. Validate on real devices.
3. Fill the store listing: title, short/full description, the 512 icon, phone screenshots, a
   feature graphic, category, contact details, and a **privacy policy URL**. This app collects and
   transmits no personal data — a short "no data collected" policy suffices, and answer the Data
   Safety form accordingly.
4. Complete the content rating questionnaire.
5. Promote the internal release to **Production** (or Closed/Open testing first).

## Releasing an update

1. Bump `versionCode` (integer, must increase every upload) and optionally `versionName` in
   `android/app/build.gradle`.
2. `npm run build && npx cap sync android`
3. `cd android && ./gradlew bundleRelease`
4. Upload the new `.aab` to a Play Console track.

## How the offline guarantee works

- `scripts/vendor-ocr.mjs` (run by `npm run build`) copies the tesseract worker, **both** the SIMD
  and non-SIMD LSTM WASM cores, and a gzipped `eng.traineddata` into `public/tesseract/`.
- `src/ocr/recognize.ts` points `createWorker` at `./tesseract/` in the browser, so the engine is
  loaded from the local WebView origin — the CDN defaults are never used.
- Shipping both cores lets tesseract.js pick SIMD on a modern WebView (fast) and fall back to the
  base core on older Android 8 WebViews, so the whole API-26+ range is covered.
