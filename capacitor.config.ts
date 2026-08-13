import type { CapacitorConfig } from '@capacitor/cli';

// No `server.url` on purpose: the app loads the bundled `dist/` from the local WebView origin
// (http://localhost), so it runs fully offline with no dependency on the hosted site.
const config: CapacitorConfig = {
  appId: 'pt.tamventura.teamsheet',
  appName: 'Teamsheet',
  webDir: 'dist',
  android: {
    // Android 8.0 is the floor (matches where Pokémon Champions runs); set in variables.gradle.
    // Keep the WebView on https-like local scheme so tesseract's WASM/worker load cleanly.
    allowMixedContent: false,
  },
};

export default config;
