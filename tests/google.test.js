// Google Cloud TTS: chunking, clip keys, and routes with fetch mocked.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const Chunks = require("../tts-chunks.js");
const C = require("../clips.js");
const G = require("../api/_google.js");
const voicesRoute = require("../api/google-voices.js");
const ttsRoute = require("../api/google-tts.js");
const downloadRoute = require("../api/download.js");

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    send(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  };
}

const realFetch = global.fetch;
function withKey(key, fn) {
  return async () => {
    const prev = process.env.GOOGLE_TTS_API_KEY;
    if (key == null) delete process.env.GOOGLE_TTS_API_KEY; else process.env.GOOGLE_TTS_API_KEY = key;
    try { await fn(); } finally {
      global.fetch = realFetch;
      if (prev == null) delete process.env.GOOGLE_TTS_API_KEY; else process.env.GOOGLE_TTS_API_KEY = prev;
    }
  };
}
const jsonResp = (status, obj) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(obj),
});

/* ---------- chunking ---------- */

test("short text stays one chunk", () => {
  assert.deepEqual(Chunks.splitText("Hello Cap. How are you?"), ["Hello Cap. How are you?"]);
});

test("chunks respect the byte limit and split on sentence ends", () => {
  const sentence = "The vault is live on Base and both contracts check out onchain. ";
  const text = sentence.repeat(200); // ~13,000 bytes
  const chunks = Chunks.splitText(text, 4500);
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    assert.ok(Chunks.utf8Bytes(c) <= 4500, "chunk too big: " + Chunks.utf8Bytes(c));
    assert.ok(c.trim().length > 0);
    assert.ok(c.endsWith("onchain."), "chunk should end on a sentence: …" + c.slice(-20));
  }
  // Nothing lost (whitespace aside).
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), text.trim().replace(/\s+/g, " "));
});

test("byte limit counts UTF-8 bytes, not characters", () => {
  const text = ("Café ☕ naïve résumé — 東京 😀. ").repeat(300);
  const chunks = Chunks.splitText(text, 4500);
  for (const c of chunks) {
    assert.ok(Buffer.byteLength(c, "utf8") <= 4500);
    assert.equal(Chunks.utf8Bytes(c), Buffer.byteLength(c, "utf8"));
  }
  assert.ok(chunks.length > 1);
});

test("a run-on sentence with no punctuation is still cut safely", () => {
  const text = "word ".repeat(3000) + "x".repeat(6000);
  const chunks = Chunks.splitText(text, 4500);
  for (const c of chunks) {
    assert.ok(Chunks.utf8Bytes(c) <= 4500);
    assert.ok(c.length > 0);
  }
  assert.equal(chunks.join("").replace(/\s+/g, "").length, text.replace(/\s+/g, "").length);
});

test("emoji are never split in half", () => {
  const chunks = Chunks.splitText("😀".repeat(3000), 4500);
  for (const c of chunks) assert.ok(!/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c));
});

test("no empty chunks from blank lines / whitespace-only input", () => {
  assert.deepEqual(Chunks.splitText("   \n\n \t "), []);
  const chunks = Chunks.splitText("One.\n\n\n   \nTwo!\n\n", 4500);
  assert.deepEqual(chunks, ["One. Two!"]);
  assert.ok(Chunks.splitText("A. B. C.", 3).every((c) => c.length > 0));
});

test("paragraph breaks are sentence boundaries", () => {
  assert.deepEqual(Chunks.splitSentences("Title line\nBody text here. More"), ["Title line", "Body text here.", "More"]);
});

/* ---------- session clip key includes source ---------- */

test("clip key includes the source: Google and ElevenLabs never share a clip", async () => {
  const g = C.clipKey("google", "en-US-Chirp3-HD-Charon", 1, "hello");
  const e = C.clipKey("elevenlabs", "en-US-Chirp3-HD-Charon", 1, "hello");
  assert.notEqual(g, e);
  assert.equal(g, C.clipKey("google", "en-US-Chirp3-HD-Charon", "1.00", "hello"));

  const store = C.createClipStore({ createUrl: () => "blob:x", revokeUrl: () => {} });
  let calls = 0;
  const fetcher = async () => { calls++; return new Blob([new Uint8Array(8000)], { type: "audio/mpeg" }); };
  const meta = { key: g, source: "google", text: "hello", voiceId: "en-US-Chirp3-HD-Charon", voiceName: "Charon", rate: 1 };
  const a = await store.getOrFetch(meta, fetcher);
  const b = await store.getOrFetch(meta, fetcher);
  await store.getOrFetch({ ...meta, key: e, source: "elevenlabs" }, fetcher);
  assert.equal(calls, 2);
  assert.equal(a.clip, b.clip);
  assert.equal(a.clip.source, "google");
  assert.equal(a.clip.exportable, true);
  assert.equal(a.clip.duration, 2); // 8,000 bytes at Google's 32 kbps
  assert.equal(C.clipFilename(a.clip), "readit-charon-1.mp3");
});

/* ---------- voices route ---------- */

test("google-voices: missing key -> 503 'Google TTS not configured'", withKey(null, async () => {
  global.fetch = async () => { throw new Error("should not call Google"); };
  const res = fakeRes();
  await voicesRoute({ method: "GET" }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "Google TTS not configured");
}));

test("google-voices: Chirp 3 HD first, then WaveNet; Studio/Neural2 skipped", withKey("k-test", async () => {
  let url = "";
  global.fetch = async (u) => {
    url = u;
    return jsonResp(200, { voices: [
      { name: "en-US-Wavenet-B", ssmlGender: "MALE", languageCodes: ["en-US"] },
      { name: "en-US-Studio-O", ssmlGender: "FEMALE", languageCodes: ["en-US"] },
      { name: "en-US-Chirp3-HD-Kore", ssmlGender: "FEMALE", languageCodes: ["en-US"] },
      { name: "en-US-Neural2-A", ssmlGender: "MALE", languageCodes: ["en-US"] },
      { name: "en-US-Chirp3-HD-Charon", ssmlGender: "MALE", languageCodes: ["en-US"] },
      { name: "en-US-Wavenet-A", ssmlGender: "FEMALE", languageCodes: ["en-US"] },
    ] });
  };
  const res = fakeRes();
  await voicesRoute({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.match(url, /^https:\/\/texttospeech\.googleapis\.com\/v1\/voices\?languageCode=en-US&key=k-test$/);
  assert.deepEqual(res.body.voices.map((v) => v.label), [
    "Charon (HD, male)",
    "Kore (HD, female)",
    "WaveNet A (Free 4M, female)",
    "WaveNet B (Free 4M, male)",
  ]);
  assert.equal(res.body.voices[0].id, "en-US-Chirp3-HD-Charon");
}));

test("google-voices: API disabled is mapped to plain words", withKey("k", async () => {
  global.fetch = async () => jsonResp(403, { error: { code: 403, status: "PERMISSION_DENIED",
    message: "Cloud Text-to-Speech API has not been used in project 123 before or it is disabled.",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED" }] } });
  const res = fakeRes();
  await voicesRoute({ method: "GET" }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "Turn on Cloud Text-to-Speech API in Google Cloud");
  assert.match(res.body.detail, /has not been used/);
}));

/* ---------- tts route ---------- */

test("google-tts: missing key -> 503", withKey(null, async () => {
  const res = fakeRes();
  await ttsRoute({ method: "POST", body: { text: "hi", voiceId: "en-US-Chirp3-HD-Charon" } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "Google TTS not configured");
}));

test("google-tts: long text is chunked under 5,000 bytes and MP3s concatenate in order", withKey("k", async () => {
  const sent = [];
  global.fetch = async (url, init) => {
    assert.match(url, /\/v1\/text:synthesize\?key=k$/);
    const body = JSON.parse(init.body);
    sent.push(body);
    const n = sent.length;
    // Fake MP3: an ID3 tag (should be stripped) + a marker byte per chunk.
    const id3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 2, 0xaa, 0xaa]);
    const audio = Buffer.concat([id3, Buffer.from([0xff, 0xfb, n])]);
    await new Promise((r) => setTimeout(r, (4 - n) * 5)); // finish out of order
    return jsonResp(200, { audioContent: audio.toString("base64") });
  };
  const text = "Sentence number one is right here for the test. ".repeat(180); // ~8,800 chars
  const res = fakeRes();
  await ttsRoute({ method: "POST", body: { text, voiceId: "en-US-Chirp3-HD-Charon", rate: 1.25 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "audio/mpeg");
  assert.ok(sent.length >= 2, "expected several Google requests, got " + sent.length);
  for (const b of sent) {
    assert.ok(Buffer.byteLength(b.input.text, "utf8") <= 4500);
    assert.ok(b.input.text.length > 0);
    assert.equal(b.voice.name, "en-US-Chirp3-HD-Charon");
    assert.equal(b.voice.languageCode, "en-US");
    assert.equal(b.audioConfig.audioEncoding, "MP3");
    assert.equal(b.audioConfig.speakingRate, 1.25);
  }
  const expected = Buffer.concat(sent.map((_, i) => Buffer.from([0xff, 0xfb, i + 1])));
  assert.deepEqual(Buffer.from(res.body), expected);
  assert.equal(res.headers["x-readit-chunks"], String(sent.length));
}));

test("google-tts: speed is clamped to Google's 0.25–2.0", withKey("k", async () => {
  const rates = [];
  global.fetch = async (u, init) => { rates.push(JSON.parse(init.body).audioConfig.speakingRate); return jsonResp(200, { audioContent: "AAAA" }); };
  for (const rate of [5, 0.1, 1]) {
    await ttsRoute({ method: "POST", body: { text: "Hi.", voiceId: "en-US-Wavenet-A", rate } }, fakeRes());
  }
  assert.deepEqual(rates, [2, 0.25, undefined]); // 1.0 is the default, so it's left out
}));

test("google-tts: if a voice rejects speakingRate, retry once without it", withKey("k", async () => {
  const bodies = [];
  global.fetch = async (u, init) => {
    const b = JSON.parse(init.body);
    bodies.push(b);
    if (b.audioConfig.speakingRate) {
      return jsonResp(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "speaking_rate is not supported for this voice" } });
    }
    return jsonResp(200, { audioContent: Buffer.from([1, 2, 3]).toString("base64") });
  };
  const res = fakeRes();
  await ttsRoute({ method: "POST", body: { text: "Hi.", voiceId: "en-US-Chirp3-HD-Kore", rate: 1.2 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].audioConfig.speakingRate, undefined);
}));

test("google-tts: bad input -> 400", withKey("k", async () => {
  let res = fakeRes();
  await ttsRoute({ method: "POST", body: { text: "", voiceId: "en-US-Wavenet-A" } }, res);
  assert.equal(res.statusCode, 400);
  res = fakeRes();
  await ttsRoute({ method: "POST", body: { text: "x".repeat(G.MAX_CHARS + 1), voiceId: "en-US-Wavenet-A" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "text too long");
  res = fakeRes();
  await ttsRoute({ method: "POST", body: { text: "hi", voiceId: "../evil" } }, res);
  assert.equal(res.statusCode, 400);
}));

test("google error mapping: key, billing, quota, long sentence", () => {
  const m = (status, err) => G.mapGoogleError(status, JSON.stringify({ error: err }));
  assert.match(m(400, { message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT",
    details: [{ reason: "API_KEY_INVALID" }] }).body.error, /API key isn't valid.*GOOGLE_TTS_API_KEY/);
  assert.equal(m(403, { message: "This API method requires billing to be enabled. Please enable billing on project #1",
    details: [{ reason: "BILLING_DISABLED" }] }).body.error, "Google needs billing turned on (free tier still applies)");
  const q = m(429, { message: "Quota exceeded for quota metric 'Requests'", status: "RESOURCE_EXHAUSTED" });
  assert.equal(q.status, 429);
  assert.match(q.body.error, /quota or rate limit/);
  assert.match(m(403, { message: "Requests from referer <empty> are blocked.", details: [{ reason: "API_KEY_HTTP_REFERRER_BLOCKED" }] }).body.error,
    /Application restrictions to None/);
  assert.match(m(400, { message: "This request contains sentences that are too long." }).body.error, /very long sentence/);
  const other = m(500, { message: "Internal error encountered." });
  assert.equal(other.body.error, "Google TTS failed");
  assert.equal(other.body.detail, "Internal error encountered.");
});

test("download route: source=google uses Google with an attachment header", withKey("k", async () => {
  global.fetch = async (u) => {
    assert.match(u, /texttospeech\.googleapis\.com/);
    return jsonResp(200, { audioContent: Buffer.from([0xff, 0xfb, 9]).toString("base64") });
  };
  const res = fakeRes();
  await downloadRoute({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "text=Hello+Cap.&voiceId=en-US-Chirp3-HD-Charon&rate=1&filename=my+clip&source=google",
  }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-disposition"], /attachment; filename="my clip\.mp3"/);
  assert.deepEqual(Buffer.from(res.body), Buffer.from([0xff, 0xfb, 9]));
}));

test("download route: source=google without key -> 503", withKey(null, async () => {
  const res = fakeRes();
  await downloadRoute({ method: "POST", body: { text: "Hi", voiceId: "en-US-Wavenet-A", source: "google" } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "Google TTS not configured");
}));
