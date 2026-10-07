# Readit

Paste text and hear it read aloud — three voice sources: **ElevenLabs** (premium, ~1 credit per character), **Google Cloud Text-to-Speech** (cheap, good for long reads), and **Device** voices (Web Speech, free).

Built for Capstiller.

## Use

1. Open the site (e.g. [readit.gearup.wtf](https://readit.gearup.wtf)).
2. Paste or type text.
3. Pick a **Voice**.
4. Optionally adjust **Speed** — **0.75×–1.2×** for ElevenLabs (API limit), **0.75×–1.5×** for Google and Device voices.
5. Tap **Play**. Use **Pause** / **Stop** as needed.
6. With **ElevenLabs** or **Google** selected:
   - **Download MP3** — names the file, then saves a **raw `.mp3`** via a real attachment download (`POST /api/download`). On iPhone, check **Files → Downloads** (or **On My iPhone**).
   - **Share…** — opens the system share sheet (AirDrop, Drive, etc.). **Share → Save to Files** also stores a **raw MP3 in Apple Files** — that is a local file you can upload into another app.
   - If you already tapped **Play**, Share can reuse that MP3 when text/voice/speed match (no second generation). Device / Web Speech voices can’t export a clean file, so Download / Share stay disabled there.

### This session (replay + export without new credits)

Every prompt you voice is kept as a clip under **This session**:

- **ElevenLabs** clips are the MP3 the server returned, held in memory as a Blob. **Play/Pause** replays it — no new API call, no credits. Playing the same text + voice + speed again (main Play, Download or Share) reuses the stored clip too.
- **Share** (shown when the browser can share files, e.g. Android Chrome) opens the share sheet with `readit-<voice>-<n>.mp3`; **Download** saves the same file via `<a download>`.
- **Device** voices can't produce an MP3 in the browser. Their clips replay by re-speaking (free) and show "No MP3 — device voices can’t export".
- Session-only: nothing goes to localStorage / IndexedDB / a server. Object URLs are revoked on `pagehide` (and by **Clear all**). Close the app and the clips are gone. Voice-change samples are cached (so re-picking a voice is free) but not listed.

Clip cache logic lives in `clips.js`; tests: `node --test tests/`.

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

### Google Cloud Text-to-Speech (cheap option for long reads)

When `GOOGLE_TTS_API_KEY` is set on the Vercel project, the **Google** button lists en-US voices from `GET /api/google-voices`: **Chirp 3 HD** voices first (labelled "HD"), then **WaveNet** (labelled "Free 4M"). Studio voices are skipped (expensive). Speech comes from `POST /api/google-tts`.

- Free tier each month: about **1M characters** for Chirp 3 HD (then ~$30 per 1M) and **4M characters** for WaveNet/Standard (then ~$4 per 1M).
- Up to **20,000 characters** per read. Google takes at most 5,000 bytes per request, so the server splits text on sentence boundaries into ≤4,500-byte chunks, synthesizes 3 at a time and joins the MP3s in order (`tts-chunks.js`). Text over ~9,000 characters is sent as a couple of requests from the app so each MP3 stays under Vercel's 4.5 MB response limit.
- Speed slider 0.75×–1.5× maps to Google `speakingRate` (Chirp 3 HD supports pace control; the server retries without it if a voice ever rejects it).
- Google clips use the same **This session** list as ElevenLabs: replay, Share and Download (`readit-<voice>-<n>.mp3`) without a new request.
- If the key is missing the picker shows "Google voices need setup". Other Google errors are shown in plain words (API not turned on, billing, key restrictions, quota).

**Setup (one time):**

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create (or pick) a project.
2. **Billing:** Google requires a billing account on the project even for the free tier (Billing → link a billing account). The free monthly characters still apply.
3. **APIs & Services → Library →** search **Cloud Text-to-Speech API → Enable**.
4. **APIs & Services → Credentials → Create credentials → API key.**
5. Edit the key: **Application restrictions: None** (the key is used from Vercel's servers, so website/IP limits would block it). **API restrictions: Restrict key → Cloud Text-to-Speech API.** Save.
6. In Vercel → readit → Settings → Environment Variables add **`GOOGLE_TTS_API_KEY`** = the key (Production + Preview), then **Redeploy**.
7. Optional: Billing → **Budgets & alerts** → a small budget (e.g. $5) so you get an email long before any real charge.

### Web Speech fallback

If the key is missing, the API returns an error, or you’re previewing statically without serverless functions, the app uses the browser **Web Speech API** (`speechSynthesis`) with OS/browser voices — same as before.

## Deploy (Vercel)

1. Import [CAPSTILLER/readit](https://github.com/CAPSTILLER/readit) on [Vercel](https://vercel.com/new).
2. Framework preset: **Other**. Root directory: `.`
3. In Project → Settings → Environment Variables, set **`ELEVENLABS_API_KEY`** and/or **`GOOGLE_TTS_API_KEY`** (Production + Preview as needed).
4. Redeploy so serverless functions pick up the env var.

Local static preview (Web Speech only):

```bash
npx serve .
# or
python3 -m http.server 8080
```

To exercise `/api/*` locally, use `vercel dev` with the env var set.

## Stack

- Static: `index.html` / `styles.css` / `app.js` / `clips.js` (session clip store) / `tts-chunks.js` (sentence chunking, shared with the server)
- Serverless: `api/voices.js`, `api/tts.js`, `api/download.js` (ElevenLabs; `source=google` → Google), `api/google-voices.js`, `api/google-tts.js`, `api/_google.js` (shared helper, not a route). Node `fetch` — no npm deps.
- Env vars (server-only): `ELEVENLABS_API_KEY`, `GOOGLE_TTS_API_KEY`
- `vercel.json` for clean URLs + basic headers

## License

Private to Capstiller / use freely for Gear projects.
