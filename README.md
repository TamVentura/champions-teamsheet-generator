# Champions Teamsheet Generator

Turn the two in-game **Pokémon Champions** screenshots (the *Stats* screen and the *Moves & More*
screen) into a **Pokémon Showdown** paste and the official **OTS / Staff** team sheet PDFs —
entirely on your device, fully offline.

- On-device OCR (tesseract.js), no servers, no account.
- Saves player profiles locally; handles the Champions specifics (level 50, EVs out of 66,
  natures, items, gender).
- Ships as a web app (PWA) and as a native **Android** app via Capacitor.

## Develop

```bash
npm install
npm run dev        # Vite dev server
npm test           # vitest
npm run build      # -> dist/ (vendors the OCR engine locally first)
```

## Android app

The Android build wraps the web app with Capacitor and bundles everything (including the OCR
engine) so it runs fully offline. See **[docs/ANDROID.md](docs/ANDROID.md)** for building the
signed `.aab` and publishing, and **[docs/PLAY_STORE_LISTING.md](docs/PLAY_STORE_LISTING.md)** for
the store copy and assets.

## Acknowledgements

The team sheet layout and the Pokémon data dictionaries are based on the open-source
**[PokemonTeamListCreator](https://github.com/DhSufi/PokemonTeamListCreator)** by **DhSufi**. The
PDF generation is a port of its Champions code path. Huge thanks for making it available. 🙏

## Community

Play Pokémon VGC and speak Portuguese? Join the Portuguese VGC community on Discord:
**https://discord.gg/u428smyhu**

## Disclaimer

Not affiliated with, endorsed by, or sponsored by Nintendo, The Pokémon Company, or Game Freak.
Pokémon and Pokémon character names are trademarks of their respective owners.
