# Readit

Paste text and hear it read aloud in a voice from your device.

Built for Capstiller — static, no API keys, works offline once loaded.

## Use

1. Open the site.
2. Paste or type text.
3. Pick a **Voice** (grouped by language).
4. Optionally adjust **Speed** (0.75×–1.5×).
5. Tap **Play**. Use **Pause** / **Stop** as needed.

Your last voice and speed are remembered in `localStorage`.

## How voices work

Uses the browser **Web Speech API** (`speechSynthesis` + `SpeechSynthesisUtterance`). Voices come from the OS / browser — no server TTS, no keys.

- Chrome / Edge: often many Google voices; `voiceschanged` fires when the list is ready.
- Safari (macOS / iOS): system voices; first **Play** must be from a user tap (browser gesture requirement).
- Mobile: voice lists can load a beat late — the app listens for `voiceschanged` and briefly polls.

If speech synthesis is missing, a clear banner is shown.

## Deploy (Vercel)

Static site — no build step.

1. Import [CAPSTILLER/readit](https://github.com/CAPSTILLER/readit) on [Vercel](https://vercel.com/new).
2. Framework preset: **Other** (or leave defaults). Root directory: `.`
3. Deploy. Optional custom domain later (e.g. `readit.gearup.wtf`) if Cap wants it.

Local preview:

```bash
# any static server
npx serve .
# or
python3 -m http.server 8080
```

## Stack

- `index.html` / `styles.css` / `app.js`
- `vercel.json` for clean URLs + basic headers

## License

Private to Capstiller / use freely for Gear projects.
