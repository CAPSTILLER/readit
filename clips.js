/**
 * Readit session clips — in-memory only.
 *
 * Every voiced prompt is kept here for this tab's lifetime so it can be
 * replayed and exported without a new ElevenLabs / Google request. Nothing is written
 * to localStorage / IndexedDB / the server. Call revokeAll() on pagehide.
 *
 * Works in the browser (window.ReaditClips) and in Node (module.exports) so
 * the cache logic can be unit-tested with `node --test tests/`.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ReaditClips = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** ElevenLabs mp3_44100_128 is CBR 128 kbps = 16,000 bytes per second. */
  var MP3_BYTES_PER_SEC = 16000;
  /** Google Cloud TTS MP3 is 32 kbps = 4,000 bytes per second. */
  var BYTES_PER_SEC_BY_SOURCE = { elevenlabs: 16000, google: 4000 };

  function normRate(rate) {
    var r = parseFloat(rate);
    if (isNaN(r) || r <= 0) r = 1;
    return r.toFixed(2);
  }

  /**
   * Cache key: source + voice + settings + exact text.
   * Same text, same voice, same speed => same clip (no new pull).
   */
  function clipKey(source, voiceId, rate, text) {
    return [
      String(source || "elevenlabs"),
      String(voiceId || ""),
      normRate(rate),
      String(text == null ? "" : text),
    ].join("\u0001");
  }

  function slug(raw) {
    var s = String(raw || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
    return s || "voice";
  }

  function clipFilename(clip) {
    return "readit-" + slug(clip && clip.voiceName) + "-" + (clip ? clip.n : 0) + ".mp3";
  }

  function previewText(text, max) {
    max = max || 90;
    var t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  }

  /** Rough length until the <audio> element reports the real duration. */
  function estimateDuration(bytes, source) {
    if (!bytes || bytes <= 0) return 0;
    return bytes / (BYTES_PER_SEC_BY_SOURCE[source] || MP3_BYTES_PER_SEC);
  }

  function formatDuration(sec) {
    if (!sec || !isFinite(sec) || sec <= 0) return "";
    var s = Math.max(1, Math.round(sec));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  /**
   * @param {object} [opts]
   * @param {function(Blob):string} [opts.createUrl]  default URL.createObjectURL
   * @param {function(string):void} [opts.revokeUrl]  default URL.revokeObjectURL
   * @param {function():void}       [opts.onChange]   called after add/clear
   */
  function createClipStore(opts) {
    opts = opts || {};
    var createUrl =
      opts.createUrl ||
      function (blob) {
        return URL.createObjectURL(blob);
      };
    var revokeUrl =
      opts.revokeUrl ||
      function (url) {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
      };
    var onChange = opts.onChange || function () {};

    var byKey = new Map();
    var byId = new Map();
    var order = []; // ids, oldest first
    var inflight = new Map(); // key -> Promise<clip>
    var seq = 0; // numbering for listed clips (readit-<voice>-<n>.mp3)
    var idSeq = 0;
    var generation = 0; // bumps on clear so late fetches don't resurrect

    function get(key) {
      return byKey.get(key) || null;
    }

    function getById(id) {
      return byId.get(id) || null;
    }

    function has(key) {
      return byKey.has(key);
    }

    /**
     * Store a clip. meta: { key, text, voiceId, voiceName, rate, source,
     * blob?, hidden? }. Blob clips (ElevenLabs, Google) get an object URL; device
     * clips have no blob (replay = re-speak, no export).
     */
    function add(meta) {
      if (!meta || !meta.key) throw new Error("clip key required");
      var existing = byKey.get(meta.key);
      if (existing) {
        // A hidden voice sample re-used as a real prompt becomes listed.
        if (existing.hidden && !meta.hidden) {
          existing.hidden = false;
          existing.n = ++seq;
          order.splice(order.indexOf(existing.id), 1);
          order.push(existing.id);
          onChange();
        }
        return existing;
      }
      var blob = meta.blob || null;
      var clip = {
        id: "c" + ++idSeq,
        key: meta.key,
        n: meta.hidden ? 0 : ++seq,
        source: meta.source || (blob ? "elevenlabs" : "device"),
        text: String(meta.text || ""),
        voiceId: meta.voiceId || "",
        voiceName: meta.voiceName || "Voice",
        rate: parseFloat(normRate(meta.rate)),
        hidden: !!meta.hidden,
        blob: blob,
        url: blob ? createUrl(blob) : null,
        bytes: blob ? blob.size || 0 : 0,
        duration: blob ? estimateDuration(blob.size || 0, meta.source || "elevenlabs") : 0,
        exportable: !!blob,
        createdAt: Date.now(),
      };
      byKey.set(clip.key, clip);
      byId.set(clip.id, clip);
      order.push(clip.id);
      onChange();
      return clip;
    }

    /**
     * Return the cached clip for meta.key, or call fetcher() once to make it.
     * Concurrent calls for the same key share one fetch (double-tap safe).
     * Resolves { clip, cached }.
     */
    function getOrFetch(meta, fetcher) {
      var hit = byKey.get(meta.key);
      if (hit) {
        if (hit.hidden && !meta.hidden) add(meta); // promote sample
        return Promise.resolve({ clip: hit, cached: true });
      }
      var pending = inflight.get(meta.key);
      if (pending) {
        return pending.then(function (clip) {
          if (clip.hidden && !meta.hidden) add(meta);
          return { clip: clip, cached: true };
        });
      }
      var gen = generation;
      var p = Promise.resolve()
        .then(fetcher)
        .then(function (blob) {
          inflight.delete(meta.key);
          var m = {};
          for (var k in meta) m[k] = meta[k];
          m.blob = blob;
          if (gen !== generation) {
            // Cleared while fetching: hand back a detached clip, don't keep it.
            return {
              id: "x" + ++idSeq,
              key: meta.key,
              n: 0,
              source: meta.source || "elevenlabs",
              text: String(meta.text || ""),
              voiceId: meta.voiceId || "",
              voiceName: meta.voiceName || "Voice",
              rate: parseFloat(normRate(meta.rate)),
              hidden: true,
              blob: blob,
              url: createUrl(blob),
              bytes: blob.size || 0,
              duration: estimateDuration(blob.size || 0, meta.source || "elevenlabs"),
              exportable: true,
              detached: true,
            };
          }
          return add(m);
        })
        .catch(function (err) {
          inflight.delete(meta.key);
          throw err;
        });
      inflight.set(meta.key, p);
      return p.then(function (clip) {
        return { clip: clip, cached: false };
      });
    }

    function setDuration(id, sec) {
      var c = byId.get(id);
      if (!c || !sec || !isFinite(sec) || sec <= 0) return;
      if (Math.abs((c.duration || 0) - sec) < 0.25) return;
      c.duration = sec;
      onChange();
    }

    /** Listed (non-hidden) clips, newest first. */
    function list() {
      var out = [];
      for (var i = order.length - 1; i >= 0; i--) {
        var c = byId.get(order[i]);
        if (c && !c.hidden) out.push(c);
      }
      return out;
    }

    function size() {
      return byKey.size;
    }

    /** Revoke every object URL and forget all clips (session end / Clear all). */
    function revokeAll() {
      byKey.forEach(function (c) {
        if (c.url) revokeUrl(c.url);
        c.url = null;
        c.blob = null;
      });
      byKey.clear();
      byId.clear();
      order = [];
      inflight.clear();
      seq = 0;
      generation++;
      onChange();
    }

    return {
      get: get,
      getById: getById,
      has: has,
      add: add,
      getOrFetch: getOrFetch,
      setDuration: setDuration,
      list: list,
      size: size,
      revokeAll: revokeAll,
      clear: revokeAll,
    };
  }

  return {
    clipKey: clipKey,
    clipFilename: clipFilename,
    previewText: previewText,
    estimateDuration: estimateDuration,
    formatDuration: formatDuration,
    createClipStore: createClipStore,
  };
});
