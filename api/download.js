/**
 * POST /api/download — synthesize speech and force a file download.
 * Accepts application/x-www-form-urlencoded, multipart/form-data, or JSON:
 *   text, voiceId, rate?, filename?
 * Returns audio/mpeg with Content-Disposition: attachment.
 * Same ElevenLabs logic as api/tts.js (speed 0.7–1.2, turbo model).
 */
var MAX_CHARS = 5000;
var MODEL_ID = "eleven_turbo_v2_5";

function sanitizeFilename(raw) {
  var name = String(raw || "").trim();
  name = name.replace(/[/\\?%*:|"<>]/g, "");
  name = name.replace(/\.+/g, ".");
  name = name.replace(/^\.+/, "");
  name = name.replace(/\s+/g, " ").trim();
  if (!name) name = "readit-audio";
  if (!/\.mp3$/i.test(name)) name += ".mp3";
  var stem = name.replace(/\.mp3$/i, "");
  stem = stem.replace(/[^a-zA-Z0-9 _-]/g, "").trim();
  if (!stem) stem = "readit-audio";
  stem = stem.slice(0, 100);
  return stem + ".mp3";
}

function contentDisposition(filename) {
  var safe = sanitizeFilename(filename);
  var quoted = safe.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  var star = encodeURIComponent(safe).replace(/[!'()*]/g, function (c) {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
  return 'attachment; filename="' + quoted + '"; filename*=UTF-8\'\'' + star;
}

function parseMultipart(raw, boundary) {
  var out = {};
  if (!raw || !boundary) return out;
  var parts = String(raw).split("--" + boundary);
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (!part || part === "--" || part === "--\r\n") continue;
    var sep = part.indexOf("\r\n\r\n");
    if (sep < 0) sep = part.indexOf("\n\n");
    if (sep < 0) continue;
    var head = part.slice(0, sep);
    var body = part.slice(sep).replace(/^\r\n\r\n|^\n\n/, "");
    body = body.replace(/\r\n$/, "").replace(/\n$/, "");
    if (body.slice(-2) === "--") body = body.slice(0, -2);
    body = body.replace(/\r\n$/, "").replace(/\n$/, "");
    var nameMatch = /name="([^"]+)"/i.exec(head);
    if (nameMatch) out[nameMatch[1]] = body;
  }
  return out;
}

function parseBody(req) {
  var body = req.body;
  var ctype = String(
    (req.headers && (req.headers["content-type"] || req.headers["Content-Type"])) ||
      ""
  ).toLowerCase();

  if (body && typeof body === "object" && !Buffer.isBuffer(body) && !Array.isArray(body)) {
    // Vercel already parsed JSON / urlencoded / some multipart
    if (Object.keys(body).length) return body;
  }

  var raw = "";
  if (typeof body === "string") {
    raw = body;
  } else if (Buffer.isBuffer(body)) {
    raw = body.toString("utf8");
  }

  if (!raw) return body && typeof body === "object" ? body : {};

  if (ctype.indexOf("application/json") !== -1 || (raw.charAt(0) === "{" && raw.indexOf("text") !== -1)) {
    try {
      return JSON.parse(raw);
    } catch (e) {}
  }

  if (ctype.indexOf("multipart/form-data") !== -1) {
    var bMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
    var boundary = bMatch ? (bMatch[1] || bMatch[2] || "").trim() : "";
    var multi = parseMultipart(raw, boundary);
    if (Object.keys(multi).length) return multi;
  }

  try {
    var params = new URLSearchParams(raw);
    var obj = {};
    params.forEach(function (value, key) {
      obj[key] = value;
    });
    if (Object.keys(obj).length) return obj;
  } catch (e2) {}

  try {
    return JSON.parse(raw);
  } catch (e3) {}

  return {};
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  var apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "ElevenLabs not configured" });
  }

  var body = parseBody(req) || {};
  var text = typeof body.text === "string" ? body.text.trim() : "";
  var voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
  var rate = typeof body.rate === "number" ? body.rate : parseFloat(body.rate);
  var filename = sanitizeFilename(body.filename);

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

  // ElevenLabs voice_settings.speed is limited to 0.7–1.2
  var speed = 1;
  if (!isNaN(rate) && rate > 0) {
    speed = Math.min(1.2, Math.max(0.7, rate));
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
    res.setHeader("Content-Disposition", contentDisposition(filename));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(buffer.length));
    return res.status(200).send(buffer);
  } catch (e) {
    return res.status(502).json({ error: "Failed to reach ElevenLabs" });
  }
};
