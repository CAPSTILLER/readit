# Readit

Paste text and hear it read aloud — natural **ElevenLabs** voices when configured, with a **Web Speech** fallback on your device.

Built for Capstiller.

## Use

1. Open the site (e.g. [readit.gearup.wtf](https://readit.gearup.wtf)).
2. Paste or type text.
3. Pick a **Voice**.
4. Optionally adjust **Speed** (0.75×–1.5×).
5. Tap **Play**. Use **Pause** / **Stop** as needed.
6. With **ElevenLabs** selected, tap **Download** to save an MP3 — you’ll name the file first. (Device / Web Speech voices can’t export a clean file.)

Your last voice and speed are remembered in `localStorage`.

## Voices

### ElevenLabs (preferred)

When `ELEVENLABS_API_KEY` is set on the Vercel project, the app loads voices from `GET /api/voices` and synthesizes via `POST /api/tts`. The key stays **server-only** — it is never sent to the browser or committed to Git.

### Web Speech fallback

If the key is missing, the API returns an error, or you’re previewing statically without serverless functions, the app uses the browser **Web Speech API** (`speechSynthesis`) with OS/browser voices — same as before.

## Deploy (Vercel)

1. Import [CAPSTILLER/readit](https://github.com/CAPSTILLER/readit) on [Vercel](https://vercel.com/new).
2. Framework preset: **Other**. Root directory: `.`
3. In Project → Settings → Environment Variables, set **`ELEVENLABS_API_KEY`** (Production + Preview as needed).
4. Redeploy so serverless functions pick up the env var.

Local static preview (Web Speech only):

```bash
npx serve .
# or
python3 -m http.server 8080
```

To exercise `/api/*` locally, use `vercel dev` with the env var set.

## Stack

- Static: `index.html` / `styles.css` / `app.js`
- Serverless: `api/voices.js`, `api/tts.js` (Node, `fetch` to ElevenLabs — no npm deps)
- `vercel.json` for clean URLs + basic headers

## License

Private to Capstiller / use freely for Gear projects.
