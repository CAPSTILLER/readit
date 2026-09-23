/**
 * POST /api/tts — synthesize speech via ElevenLabs (server-side API key).
 * Body: { text, voiceId, rate? }
 * Returns audio/mpeg. 503 if key missing; 400 on bad input.
 */
var MAX_CHARS = 5000;
var MODEL_ID = "eleven_turbo_v2_5";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  var apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "ElevenLabs not configured" });
  }

  var body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }
  body = body || {};

  var text = typeof body.text === "string" ? body.text.trim() : "";
  var voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
  var rate = typeof body.rate === "number" ? body.rate : parseFloat(body.rate);

  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }
  if (text.length > MAX_CHARS) {
    return res.status(400).json({
      error: "text too long",
      max: MAX_CHARS,
      length: text.length,
    });
  }
  if (!voiceId || !/^[a-zA-Z0-9_-]{10,80}$/.test(voiceId)) {
    return res.status(400).json({ error: "voiceId is required" });
  }

  // Map UI rate (~0.75–1.5) into ElevenLabs speed (REST allows ~0.25–4.0)
  var speed = 1;
  if (!isNaN(rate) && rate > 0) {
    speed = Math.min(1.5, Math.max(0.75, rate));
  }

  var payload = {
    text: text,
    model_id: MODEL_ID,
    voice_settings: {
      stability: 0.45,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
      speed: speed,
    },
  };

  try {
    var url =
      "https://api.elevenlabs.io/v1/text-to-speech/" +
      encodeURIComponent(voiceId) +
      "?output_format=mp3_44100_128";

    var upstream = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      var errText = await upstream.text().catch(function () {
        return "";
      });
      var status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
      return res.status(status).json({
        error: "ElevenLabs TTS failed",
        detail: errText.slice(0, 400),
      });
    }

    var arrayBuffer = await upstream.arrayBuffer();
    var buffer = Buffer.from(arrayBuffer);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(buffer.length));
    return res.status(200).send(buffer);
  } catch (e) {
    return res.status(502).json({ error: "Failed to reach ElevenLabs" });
  }
};
