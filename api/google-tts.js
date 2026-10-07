/**
 * POST /api/google-tts — Google Cloud Text-to-Speech (server-side key).
 * Body: { text, voiceId, rate? }  (voiceId e.g. "en-US-Chirp3-HD-Charon")
 * Text up to 10,000 chars per request: split on sentences into <=4,500-byte
 * chunks (Google's limit is 5,000 bytes), synthesized 3 at a time, MP3s
 * concatenated in order. Returns audio/mpeg.
 * 503 if GOOGLE_TTS_API_KEY is missing; errors carry { error, reason, detail }.
 */
var G = require("./_google.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!G.apiKey()) return G.notConfigured(res);
  var body = G.parseJsonBody(req);
  if (body === null) return res.status(400).json({ error: "Invalid JSON body" });
  return G.respondWithSpeech(body, res);
};
