/**
 * GET /api/voices — list ElevenLabs voices (server-side API key).
 * Returns 503 if ELEVENLABS_API_KEY is missing.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  var apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "ElevenLabs not configured" });
  }

  try {
    var upstream = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        Accept: "application/json",
        "xi-api-key": apiKey,
      },
    });

    if (!upstream.ok) {
      var errText = await upstream.text().catch(function () {
        return "";
      });
      var status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
      return res.status(status).json({
        error: "ElevenLabs voices request failed",
        detail: errText.slice(0, 300),
      });
    }

    var data = await upstream.json();
    var raw = Array.isArray(data.voices) ? data.voices : [];

    var voices = raw.map(function (v) {
      return {
        id: v.voice_id,
        name: v.name || "Voice",
        labels: v.labels || undefined,
      };
    });

    // Prefer English / popular first
    voices.sort(function (a, b) {
      var sa = scoreVoice(a);
      var sb = scoreVoice(b);
      if (sb !== sa) return sb - sa;
      return (a.name || "").localeCompare(b.name || "");
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ voices: voices });
  } catch (e) {
    return res.status(502).json({ error: "Failed to reach ElevenLabs" });
  }
};

function scoreVoice(v) {
  var score = 0;
  var labels = v.labels || {};
  var lang = String(labels.language || labels.accent || "").toLowerCase();
  var name = String(v.name || "").toLowerCase();
  var useCase = String(labels.use_case || labels.descriptive || "").toLowerCase();

  if (lang.indexOf("en") === 0 || lang === "english" || /american|british|australian|irish/.test(lang)) {
    score += 50;
  }
  if (/narrat|story|conversational|news|audiobook/.test(useCase) || /narrat|story/.test(name)) {
    score += 20;
  }
  // Common pre-made popular voices
  if (
    /rachel|domi|bella|antoni|elli|josh|arnold|adam|sam|nicole|jessie|callum|charlotte|matilda|matthew|brian|lily|george|bill|sarah|laura/i.test(
      name
    )
  ) {
    score += 30;
  }
  return score;
}
