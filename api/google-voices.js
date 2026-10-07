/**
 * GET /api/google-voices — en-US Google Cloud TTS voices (server-side key).
 * Chirp 3 HD first ("HD"), then WaveNet ("Free 4M"). Studio etc. skipped.
 * 503 { error: "Google TTS not configured" } if GOOGLE_TTS_API_KEY is missing.
 */
var G = require("./_google.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  var key = G.apiKey();
  if (!key) return G.notConfigured(res);

  try {
    var voices = await G.listVoices(key);
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ voices: voices });
  } catch (e) {
    if (e && e.mapped) return res.status(e.mapped.status).json(e.mapped.body);
    return res.status(502).json({ error: "Failed to reach Google", reason: "network" });
  }
};
