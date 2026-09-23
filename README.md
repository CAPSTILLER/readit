# Readit

Paste text and hear it read aloud — natural **ElevenLabs** voices when configured, with a **Web Speech** fallback on your device.

Built for Capstiller.

## Use

1. Open the site (e.g. [readit.gearup.wtf](https://readit.gearup.wtf)).
2. Paste or type text.
3. Pick a **Voice**.
4. Optionally adjust **Speed** — **0.75×–1.2×** for ElevenLabs (API limit), **0.75×–1.5×** for Device voices.
5. Tap **Play**. Use **Pause** / **Stop** as needed.
6. With **ElevenLabs** selected:
   - **Download MP3** — names the file, then saves a **raw `.mp3`** via a real attachment download (`POST /api/download`). On iPhone, check **Files → Downloads** (or **On My iPhone**).
   - **Share…** — opens the system share sheet (AirDrop, Drive, etc.). **Share → Save to Files** also stores a **raw MP3 in Apple Files** — that is a local file you can upload into another app.
   - If you already tapped **Play**, Share can reuse that MP3 when text/voice/speed match (no second generation). Device / Web Speech voices can’t export a clean file, so Download / Share stay disabled there.

We do **not** mic-record the speaker on Play. ElevenLabs already returns an MP3 blob for playback; caching that for Share is higher quality and needs no mic permission. A speaker-mic hack would be noisier and still wouldn’t help Device voices.

Your last voice and speed are remembered in `localStorage`.

### Cap’s iPhone steps (raw MP3 into Files)

**Preferred — Download MP3**

1. ElevenLabs voice + text → tap **Download MP3**.
2. Name the file → confirm.
3. Open the **Files** app → **Downloads** (or **Browse → On My iPhone → Downloads**).
4. The `.mp3` is there — use Share / Open In from Files to upload into another app.

If Safari opens a player tab instead of saving: tap the **Share** icon in that tab → **Save to Files**.

**Also works — Share… → Save to Files**

1. Tap **Share…** → name the file if asked.
2. In the share sheet pick **Save to Files**.
3. Choose **On My iPhone** (or iCloud Drive) → Save.
4. That file **is** a raw MP3 in Apple Files — same as a download, ready to upload elsewhere.

## Voices

### ElevenLabs (preferred)

When `ELEVENLABS_API_KEY` is set on the Vercel project, the app loads voices from `GET /api/voices` and synthesizes via `POST /api/tts`. **Download MP3** uses `POST /api/download` (same TTS, with `Content-Disposition: attachment`). The key stays **server-only** — it is never sent to the browser or committed to Git.

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
- Serverless: `api/voices.js`, `api/tts.js`, `api/download.js` (Node, `fetch` to ElevenLabs — no npm deps)
- `vercel.json` for clean URLs + basic headers

## License

Private to Capstiller / use freely for Gear projects.
