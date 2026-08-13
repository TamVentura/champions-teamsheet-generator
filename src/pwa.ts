import { Capacitor } from '@capacitor/core';

/** Register the service worker in production browser/PWA builds (no-op during `vite dev`). */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  // The native Capacitor app already ships every asset in the APK and runs fully offline; a
  // service worker there adds no value and some WebView risk, so register only in the browser/PWA.
  if (Capacitor?.isNativePlatform?.()) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {
        /* offline support is best-effort */
      });
  });
}
