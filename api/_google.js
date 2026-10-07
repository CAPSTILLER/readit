/**
 * Shared Google Cloud Text-to-Speech helpers for api/google-voices.js,
 * api/google-tts.js and api/download.js (source=google).
 * The underscore prefix keeps Vercel from exposing this file as a route.
 *
 * Key: GOOGLE_TTS_API_KEY (server-only). REST + API key, no npm deps.
 */
var Chunks = require("../tts-chunks.js");

var GOOGLE_BASE = "https://texttospeech.googleapis.com/v1";
/** Per request. The app splits longer text (up to 20,000) into a few requests. */
var MAX_CHARS = 10000;
/** Google rejects input over 5,000 bytes; stay well under. */
var CHUNK_BYTES = 4500;
var MAX_CHUNKS = 16;
var CONCURRENCY = 3;
var CHUNK_TIMEOUT_MS = 45000;
var MIN_RATE = 0.25;
var MAX_RATE = 2.0;
var VOICE_RE = /^[a-z]{2,3}-[A-Z]{2,3}-[A-Za-z0-9-]{2,60}$/;

function apiKey() {
  var k = process.env.GOOGLE_TTS_API_KEY;
  return k && String(k).trim() ? String(k).trim() : "";
}

function notConfigured(res) {
  return res.status(503).json({ error: "Google TTS not configured" });
}

function clampRate(rate) {
  var r = typeof rate === "number" ? rate : parseFloat(rate);
  if (isNaN(r) || r <= 0) return 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, r));
}

/** "hd" (Chirp 3 HD), "wavenet", or null (skipped: Studio, Neural2, etc). */
function voiceTier(name) {
  var n = String(name || "");
  if (/-Chirp3-HD-/i.test(n)) return "hd";
  if (/-Wavenet-/i.test(n)) return "wavenet";
  return null;
}

function genderWord(g) {
  var s = String(g || "").toUpperCase();
  if (s === "MALE") return "male";
  if (s === "FEMALE") return "female";
  return "";
}

/** en-US-Chirp3-HD-Charon -> { name: "Charon", label: "Charon (HD, male)" } */
function friendlyVoice(v) {
  var id = String((v && v.name) || "");
  var tier = voiceTier(id);
  if (!tier) return null;
  var gender = genderWord(v.ssmlGender);
  var short;
  var tag;
  if (tier === "hd") {
    short = id.replace(/^.*-Chirp3-HD-/i, "");
    tag = "HD";
  } else {
    short = "WaveNet " + id.replace(/^.*-Wavenet-/i, "");
    tag = "Free 4M";
  }
  var langs = Array.isArray(v.languageCodes) ? v.languageCodes : [];
  return {
    id: id,
    name: short,
    label: short + " (" + tag + (gender ? ", " + gender : "") + ")",
    tier: tier,
    gender: gender || undefined,
    languageCode: langs[0] || id.split("-").slice(0, 2).join("-"),
  };
}

/** Chirp 3 HD first, then WaveNet; each A–Z. Only en-US. */
function shapeVoices(raw) {
  var out = [];
  (Array.isArray(raw) ? raw : []).forEach(function (v) {
    var langs = Array.isArray(v && v.languageCodes) ? v.languageCodes : [];
    if (langs.length && langs.indexOf("en-US") === -1) return;
    var f = friendlyVoice(v);
    if (f) out.push(f);
  });
  out.sort(function (a, b) {
    if (a.tier !== b.tier) return a.tier === "hd" ? -1 : 1;
    return a.name.localeCompare(b.name, "en", { numeric: true });
  });
  return out;
}

function parseGoogleError(text) {
  var info = { message: "", status: "", reason: "" };
  try {
    var j = JSON.parse(text);
    var e = (j && j.error) || {};
    info.message = String(e.message || "");
    info.status = String(e.status || "");
    (Array.isArray(e.details) ? e.details : []).forEach(function (d) {
      if (d && d.reason && !info.reason) info.reason = String(d.reason);
    });
  } catch (err) {
    info.message = String(text || "");
  }
  return info;
}

/**
 * Plain-words error for Cap, plus the real Google detail.
 * Returns { status, body: { error, reason, detail } }.
 */
function mapGoogleError(httpStatus, text) {
  var g = parseGoogleError(text);
  var all = (g.reason + " " + g.status + " " + g.message).trim();
  var status = httpStatus >= 400 && httpStatus < 600 ? httpStatus : 502;
  var error;
  var reason;

  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(all)) {
    reason = "key_invalid";
    error = "Google API key isn't valid. Check GOOGLE_TTS_API_KEY in Vercel.";
  } else if (/SERVICE_DISABLED|has not been used in project|it is disabled|API has not been enabled/i.test(all)) {
    reason = "api_disabled";
    error = "Turn on Cloud Text-to-Speech API in Google Cloud";
  } else if (/BILLING_DISABLED|billing/i.test(all)) {
    reason = "billing_disabled";
    error = "Google needs billing turned on (free tier still applies)";
  } else if (/API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_IP_ADDRESS_BLOCKED|referer|referrer|IP address/i.test(all) && /block/i.test(all)) {
    reason = "key_app_restricted";
    error =
      "Google key is locked to websites/IPs. In the key settings set Application restrictions to None (keep the Text-to-Speech API restriction).";
  } else if (/API_KEY_SERVICE_BLOCKED|are blocked/i.test(all)) {
    reason = "key_api_restricted";
    error = "This Google key isn't allowed to use Cloud Text-to-Speech. Add it under the key's API restrictions.";
  } else if (httpStatus === 429 || /RESOURCE_EXHAUSTED|RATE_LIMIT|quota/i.test(all)) {
    reason = "quota";
    error = "Google quota or rate limit hit. Wait a minute and try again.";
  } else if (/sentences? (that )?(are|is) too long|too long/i.test(all)) {
    reason = "sentence_too_long";
    error = "Google couldn't read a very long sentence. Add a few periods and try again.";
  } else if (/voice/i.test(all) && /not exist|not found|invalid|unsupported/i.test(all)) {
    reason = "bad_voice";
    error = "Google doesn't have that voice. Pick another one.";
  } else if (httpStatus === 401 || httpStatus === 403 || /PERMISSION_DENIED|UNAUTHENTICATED/i.test(all)) {
    reason = "denied";
    error = "Google refused the key (" + httpStatus + "). Check GOOGLE_TTS_API_KEY and its restrictions.";
  } else {
    reason = "google_error";
    error = "Google TTS failed";
  }
  return {
    status: status,
    body: { error: error, reason: reason, detail: (g.message || String(text || "")).slice(0, 400) },
  };
}

function GoogleError(mapped) {
  var e = new Error(mapped.body.error);
  e.mapped = mapped;
  return e;
}

/** Drop a leading ID3v2 tag so concatenated MP3 frames play straight through. */
function stripId3(buf) {
  if (!buf || buf.length < 10) return buf;
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return buf; // "ID3"
  var size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  var total = 10 + size + (buf[5] & 0x10 ? 10 : 0);
  return total < buf.length ? buf.subarray(total) : buf;
}

function withTimeout(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

async function listVoices(key, fetchImpl) {
  var f = fetchImpl || fetch;
  var upstream = await f(
    GOOGLE_BASE + "/voices?languageCode=en-US&key=" + encodeURIComponent(key),
    { headers: { Accept: "application/json" } }
  );
  var text = await upstream.text().catch(function () {
    return "";
  });
  if (!upstream.ok) throw GoogleError(mapGoogleError(upstream.status, text));
  var data = {};
  try {
    data = JSON.parse(text);
  } catch (e) {}
  return shapeVoices(data.voices);
}

async function postSynth(f, key, payload) {
  return f(GOOGLE_BASE + "/text:synthesize?key=" + encodeURIComponent(key), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    signal: withTimeout(CHUNK_TIMEOUT_MS),
  });
}

/** One <=4,500-byte chunk -> MP3 Buffer. Retries once without speakingRate if Google rejects it. */
async function synthesizeChunk(key, voiceName, text, rate, fetchImpl) {
  var f = fetchImpl || fetch;
  var payload = {
    input: { text: text },
    voice: { languageCode: voiceName.split("-").slice(0, 2).join("-"), name: voiceName },
    audioConfig: { audioEncoding: "MP3" },
  };
  if (rate !== 1) payload.audioConfig.speakingRate = rate;

  var upstream = await postSynth(f, key, payload);
  var text1 = await upstream.text().catch(function () {
    return "";
  });
  if (!upstream.ok && upstream.status === 400 && payload.audioConfig.speakingRate && /speaking.?rate/i.test(text1)) {
    delete payload.audioConfig.speakingRate;
    upstream = await postSynth(f, key, payload);
    text1 = await upstream.text().catch(function () {
      return "";
    });
  }
  if (!upstream.ok) throw GoogleError(mapGoogleError(upstream.status, text1));
  var data = {};
  try {
    data = JSON.parse(text1);
  } catch (e) {}
  if (!data.audioContent) {
    throw GoogleError({ status: 502, body: { error: "Google returned no audio", reason: "no_audio", detail: text1.slice(0, 200) } });
  }
  return stripId3(Buffer.from(data.audioContent, "base64"));
}

/** Chunk + synthesize (limited parallel, order kept) + concatenate MP3s. */
async function synthesizeText(key, voiceName, text, rate, fetchImpl, opts) {
  opts = opts || {};
  var chunks = Chunks.splitText(text, opts.chunkBytes || CHUNK_BYTES);
  if (!chunks.length) {
    throw GoogleError({ status: 400, body: { error: "text is required", reason: "empty" } });
  }
  if (chunks.length > MAX_CHUNKS) {
    throw GoogleError({ status: 400, body: { error: "text too long", reason: "too_many_chunks", max: MAX_CHARS } });
  }
  var limit = Math.max(1, opts.concurrency || CONCURRENCY);
  var results = new Array(chunks.length);
  var next = 0;
  async function worker() {
    while (next < chunks.length) {
      var i = next++;
      results[i] = await synthesizeChunk(key, voiceName, chunks[i], rate, fetchImpl);
    }
  }
  var workers = [];
  for (var w = 0; w < Math.min(limit, chunks.length); w++) workers.push(worker());
  await Promise.all(workers);
  return { buffer: Buffer.concat(results), chunks: chunks.length };
}

/**
 * Validate body { text, voiceId, rate } and answer with audio/mpeg.
 * opts.disposition: optional Content-Disposition (download route).
 * opts.fetch: injectable for tests.
 */
async function respondWithSpeech(body, res, opts) {
  opts = opts || {};
  var key = apiKey();
  if (!key) return notConfigured(res);

  body = body || {};
  var text = typeof body.text === "string" ? body.text.trim() : "";
  var voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });
  if (text.length > MAX_CHARS) {
    return res.status(400).json({ error: "text too long", max: MAX_CHARS, length: text.length });
  }
  if (!voiceId || !VOICE_RE.test(voiceId)) {
    return res.status(400).json({ error: "voiceId is required" });
  }
  var rate = clampRate(body.rate);

  try {
    var out = await synthesizeText(key, voiceId, text, rate, opts.fetch);
    res.setHeader("Content-Type", "audio/mpeg");
    if (opts.disposition) res.setHeader("Content-Disposition", opts.disposition);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(out.buffer.length));
    res.setHeader("X-Readit-Chunks", String(out.chunks));
    return res.status(200).send(out.buffer);
  } catch (e) {
    if (e && e.mapped) return res.status(e.mapped.status).json(e.mapped.body);
    if (e && (e.name === "TimeoutError" || e.name === "AbortError")) {
      return res.status(504).json({ error: "Google took too long. Try a shorter piece of text.", reason: "timeout" });
    }
    return res.status(502).json({ error: "Failed to reach Google", reason: "network", detail: String((e && e.message) || "").slice(0, 200) });
  }
}

function parseJsonBody(req) {
  var body = req.body;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (e) {
      return null;
    }
  }
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString("utf8"));
    } catch (e2) {
      return null;
    }
  }
  return body || {};
}

module.exports = {
  GOOGLE_BASE: GOOGLE_BASE,
  MAX_CHARS: MAX_CHARS,
  CHUNK_BYTES: CHUNK_BYTES,
  MIN_RATE: MIN_RATE,
  MAX_RATE: MAX_RATE,
  apiKey: apiKey,
  notConfigured: notConfigured,
  clampRate: clampRate,
  voiceTier: voiceTier,
  friendlyVoice: friendlyVoice,
  shapeVoices: shapeVoices,
  mapGoogleError: mapGoogleError,
  stripId3: stripId3,
  listVoices: listVoices,
  synthesizeChunk: synthesizeChunk,
  synthesizeText: synthesizeText,
  respondWithSpeech: respondWithSpeech,
  parseJsonBody: parseJsonBody,
};
