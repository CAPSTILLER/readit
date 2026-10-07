(function () {
  "use strict";

  var STORAGE_KEY = "readit-voice-uri";
  var EL_STORAGE_KEY = "readit-el-voice-id";
  var GOOGLE_STORAGE_KEY = "readit-google-voice";
  var SOURCE_KEY = "readit-voice-source";
  var RATE_KEY = "readit-rate";
  var PREVIEW =
    "Hey Cap. This is how I sound with the voice you picked.";
  var MAX_TTS_CHARS = 5000; // ElevenLabs, per request
  var MAX_GOOGLE_CHARS = 20000; // Google, app-level max
  /** Google text above this is sent as a few requests (each MP3 stays under Vercel's 4.5 MB). */
  var GOOGLE_PART_BYTES = 9000;
  /** Server cap per /api/google-tts or /api/download request. */
  var GOOGLE_REQUEST_CHARS = 10000;
  var GOOGLE_FREE_NOTE = "Google: about 1M HD + 4M standard characters free each month.";
  var GOOGLE_SETUP_NOTE = "Google voices need setup";

  var textEl = document.getElementById("text");
  var voiceEl = document.getElementById("voice");
  var rateEl = document.getElementById("rate");
  var rateValueEl = document.getElementById("rate-value");
  var rateMaxLabelEl = document.getElementById("rate-max-label");
  var countsEl = document.getElementById("counts");
  var playBtn = document.getElementById("play");
  var pauseBtn = document.getElementById("pause");
  var stopBtn = document.getElementById("stop");
  var unsupportedEl = document.getElementById("unsupported");
  var hintEl = document.getElementById("voice-hint");
  var footerEl = document.querySelector(".footer p");
  var sourceElBtn = document.getElementById("source-elevenlabs");
  var sourceDeviceBtn = document.getElementById("source-device");
  var sourceGoogleBtn = document.getElementById("source-google");
  var googleNoteEl = document.getElementById("google-note");
  var sourceNoteEl = document.getElementById("source-note");
  var downloadBtn = document.getElementById("download");
  var downloadStatusEl = document.getElementById("download-status");
  var downloadDialog = document.getElementById("download-dialog");
  var downloadForm = document.getElementById("download-form");
  var downloadNameEl = document.getElementById("download-name");
  var downloadCancelBtn = document.getElementById("download-cancel");
  var downloadConfirmBtn = document.getElementById("download-confirm");
  var downloadHintEl = document.getElementById("download-hint");
  var shareBtn = document.getElementById("share");

  /** "elevenlabs" | "google" | "webspeech" */
  var mode = "webspeech";
  var voices = [];
  var voicesFingerprint = "";
  var utterance = null;
  var isPaused = false;
  var speaking = false;
  var speakTimer = null;
  var loadingTts = false;
  var downloading = false;
  var downloadStatusTimer = null;
  var Clips = window.ReaditClips;
  var clipStore = Clips.createClipStore({ onChange: renderClips });
  /** Clip currently loaded in audioEl (ElevenLabs MP3). */
  var currentClipId = null;
  /** Device clip currently being re-spoken. */
  var speakingClipId = null;
  /** True while audioEl (MP3) is the active player, whatever the source mode. */
  var audioActive = false;
  var clipsSection = document.getElementById("clips");
  var clipsList = document.getElementById("clips-list");
  var clipsClearBtn = document.getElementById("clips-clear");
  var audioEl = null;
  var audioUrl = null;
  var Chunks = window.ReaditChunks;
  /** Cloud voice sources (MP3 from our serverless routes). Device = Web Speech. */
  var providers = {
    elevenlabs: {
      id: "elevenlabs",
      label: "ElevenLabs",
      voicesUrl: "/api/voices",
      ttsUrl: "/api/tts",
      storageKey: EL_STORAGE_KEY,
      minRate: 0.7,
      maxRate: 1.2,
      maxChars: MAX_TTS_CHARS,
      voices: [],
      available: false,
      reason: "",
    },
    google: {
      id: "google",
      label: "Google",
      voicesUrl: "/api/google-voices",
      ttsUrl: "/api/google-tts",
      storageKey: GOOGLE_STORAGE_KEY,
      minRate: 0.25,
      maxRate: 2,
      maxChars: MAX_GOOGLE_CHARS,
      voices: [],
      available: false,
      reason: "",
    },
  };

  function cloudProvider(source) {
    return providers[source || mode] || null;
  }

  function isCloudMode() {
    return !!providers[mode];
  }
  var deviceVoicesWired = false;

  function speechAvailable() {
    return (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      typeof SpeechSynthesisUtterance !== "undefined"
    );
  }

  function updateCounts() {
    var raw = textEl.value;
    var trimmed = raw.trim();
    var words = trimmed ? trimmed.split(/\s+/).length : 0;
    var chars = raw.length;
    countsEl.textContent =
      words +
      " word" +
      (words === 1 ? "" : "s") +
      " · " +
      chars +
      " character" +
      (chars === 1 ? "" : "s");
  }

  function updateRateLabel() {
    var r = parseFloat(rateEl.value) || 1;
    rateValueEl.textContent = r.toFixed(2) + "×";
  }

  /** ElevenLabs speed max is 1.2×; Device/Web Speech keeps 1.5×. */
  function syncRateLimitsForMode() {
    var elMode = mode === "elevenlabs";
    var max = elMode ? 1.2 : 1.5;
    rateEl.min = "0.75";
    rateEl.max = String(max);
    var r = parseFloat(rateEl.value);
    if (isNaN(r)) r = 1;
    if (r > max) r = max;
    if (r < 0.75) r = 0.75;
    // Snap to step so a clamped 1.3 becomes a clean slider tick.
    r = Math.round(r / 0.05) * 0.05;
    if (r > max) r = max;
    rateEl.value = String(r);
    if (rateMaxLabelEl) rateMaxLabelEl.textContent = max.toFixed(1) + "×";
    updateRateLabel();
    saveRate();
  }

  function setControls() {
    var hasText = textEl.value.trim().length > 0;
    var prov = cloudProvider();
    var hasVoices = prov ? prov.voices.length > 0 : voices.length > 0;
    var hasElVoice = !!prov && !!voiceEl.value && prov.voices.length > 0;
    var canResumeEl = audioActive && isPaused && audioEl && audioEl.src;
    var canPlay =
      !loadingTts &&
      hasVoices &&
      (canResumeEl ||
        (hasText && (!!prov || speechAvailable())));
    playBtn.disabled = !canPlay;
    renderClipStates();
    pauseBtn.disabled = !speaking || loadingTts;
    stopBtn.disabled = !speaking && !isPaused && !loadingTts;
    if (loadingTts) {
      playBtn.textContent = "Loading…";
      playBtn.disabled = true;
    } else {
      playBtn.textContent = isPaused ? "Resume" : "Play";
    }
    var canExport =
      !!prov &&
      prov.available &&
      hasText &&
      hasElVoice &&
      !downloading;
    if (downloadBtn) {
      downloadBtn.disabled = !canExport;
      if (!prov) {
        downloadBtn.title = "Download needs ElevenLabs or Google (device voices can’t export a clean file)";
      } else if (!hasText) {
        downloadBtn.title = "Add text to download";
      } else if (!hasElVoice) {
        downloadBtn.title = "Pick a voice";
      } else if (downloading) {
        downloadBtn.title = "Downloading…";
      } else {
        downloadBtn.title = "Download a raw MP3 (Files → Downloads on iPhone)";
      }
      downloadBtn.textContent = downloading ? "Downloading…" : "Download MP3";
      if (downloadConfirmBtn) {
        downloadConfirmBtn.textContent = "Download MP3";
      }
    }
    if (shareBtn) {
      shareBtn.disabled = !canExport;
      if (!prov) {
        shareBtn.title = "Share needs ElevenLabs or Google";
      } else if (!hasText) {
        shareBtn.title = "Add text to share";
      } else if (!hasElVoice) {
        shareBtn.title = "Pick a voice";
      } else if (downloading) {
        shareBtn.title = "Busy…";
      } else {
        shareBtn.title = "Share MP3 (AirDrop, Drive, or Save to Files)";
      }
      shareBtn.textContent = "Share…";
    }
    if (downloadHintEl) {
      var showHint =
        !!prov && prov.available && !downloading;
      downloadHintEl.hidden = !showHint;
    }
  }

  function saveSource() {
    var value = isCloudMode() ? mode : "device";
    try {
      localStorage.setItem(SOURCE_KEY, value);
    } catch (e) {}
  }

  function loadSavedSource() {
    try {
      var s = localStorage.getItem(SOURCE_KEY);
      if (s === "elevenlabs" || s === "google" || s === "device") return s;
    } catch (e) {}
    return null;
  }

  function updateSourceButtons() {
    [
      [sourceElBtn, providers.elevenlabs],
      [sourceGoogleBtn, providers.google],
    ].forEach(function (pair) {
      var btn = pair[0];
      var prov = pair[1];
      if (!btn) return;
      btn.setAttribute("aria-pressed", mode === prov.id ? "true" : "false");
      btn.disabled = !prov.available;
      if (!prov.available) {
        btn.title = prov.reason || prov.label + " unavailable";
      } else {
        btn.removeAttribute("title");
      }
    });
    if (sourceDeviceBtn) {
      sourceDeviceBtn.setAttribute("aria-pressed", isCloudMode() ? "false" : "true");
      sourceDeviceBtn.disabled = false;
    }
    if (sourceNoteEl) {
      var notes = [];
      if (!providers.elevenlabs.available && providers.elevenlabs.reason) {
        notes.push(providers.elevenlabs.reason);
      }
      if (!providers.google.available && providers.google.reason) {
        notes.push(providers.google.reason);
      }
      sourceNoteEl.hidden = notes.length === 0;
      sourceNoteEl.textContent = notes.join(" · ");
    }
    if (googleNoteEl) {
      googleNoteEl.hidden = mode !== "google";
      googleNoteEl.textContent = GOOGLE_FREE_NOTE;
    }
  }

  function setModeCopy() {
    if (mode === "elevenlabs") {
      if (hintEl) {
        hintEl.textContent =
          "ElevenLabs selected — natural cloud voices, but about 1 credit per character, so save it for short pieces. Every clip you play is kept under This session, so you can replay or export it without using more credits. Changing voice plays a short sample.";
      }
      if (footerEl) {
        footerEl.textContent =
          "Source: ElevenLabs (cloud). Google is the cheap option for long reads; Device is free.";
      }
    } else if (mode === "google") {
      if (hintEl) {
        hintEl.textContent =
          "Google selected — HD voices sound most natural; WaveNet voices have the bigger free allowance. Up to " +
          MAX_GOOGLE_CHARS.toLocaleString("en-US") +
          " characters per read. Every clip is kept under This session to replay or export without a new request. Changing voice plays a short sample.";
      }
      if (footerEl) {
        footerEl.textContent =
          "Source: Google Cloud Text-to-Speech. " + GOOGLE_FREE_NOTE;
      }
    } else {
      if (hintEl) {
        hintEl.textContent =
          "Device voices selected — only voices on this phone or computer. Prefer ones tagged “clearer.” Device clips replay for free under This session, but MP3 export needs ElevenLabs or Google (device voices can’t make a file).";
      }
      if (footerEl) {
        footerEl.textContent =
          "Source: Device (Web Speech). Tap ElevenLabs or Google for cloud voices you can export as MP3.";
      }
    }
  }

  /* ---------- Web Speech helpers (device) ---------- */

  function voiceQuality(v) {
    var n = (v.name || "").toLowerCase();
    var lang = (v.lang || "").toLowerCase();
    var score = 0;
    if (/^en/.test(lang)) score += 50;
    if (/en-us|en_us/.test(lang)) score += 10;
    if (/neural|natural|enhanced|premium|wavenet|studio|journey|news|polyglot/i.test(n))
      score += 80;
    if (/google/.test(n)) score += 60;
    if (/microsoft/.test(n) && /online|natural|neural/.test(n)) score += 55;
    if (/samantha|aaron|nicky|susan|tom|moira|karen|daniel|fiona|tessa|rishi|martha|gordon/i.test(n))
      score += 40;
    if (v.localService) score += 5;
    if (/microsoft david|microsoft zira|microsoft mark|microsoft hazel/i.test(n) && !/natural|neural/.test(n))
      score -= 40;
    if (/compact|eloquence|espeak|robot|dummy/i.test(n)) score -= 50;
    return score;
  }

  function voiceKey(v) {
    return v.voiceURI || v.name + "|" + v.lang;
  }

  function voiceLabel(v) {
    var name = v.name || "Voice";
    var lang = v.lang || "";
    var q = voiceQuality(v);
    var tag = q >= 100 ? " · clearer" : !v.localService ? " · online" : "";
    return name + (lang ? " (" + lang + ")" : "") + tag;
  }

  function langGroup(lang) {
    if (!lang) return "Other";
    var parts = lang.replace("_", "-").split("-");
    return parts[0].toLowerCase() === "en"
      ? lang
      : parts[0].toUpperCase() + (parts[1] ? "-" + parts[1].toUpperCase() : "");
  }

  function fingerprint(list) {
    return list
      .map(function (v) {
        return voiceKey(v);
      })
      .join("\n");
  }

  function populateWebSpeechVoices(force) {
    if (!speechAvailable()) return;
    if (mode !== "webspeech") return;

    var list = window.speechSynthesis.getVoices() || [];
    var fp = fingerprint(list);
    if (!force && fp && fp === voicesFingerprint && voices.length) {
      return;
    }
    voices = list;
    voicesFingerprint = fp;

    var saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (e) {}

    var prev = voiceEl.value;
    voiceEl.innerHTML = "";

    if (!voices.length) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No voices found yet…";
      voiceEl.appendChild(opt);
      voiceEl.disabled = true;
      setControls();
      return;
    }

    var ranked = voices
      .map(function (v, i) {
        return { voice: v, index: i, q: voiceQuality(v) };
      })
      .sort(function (a, b) {
        if (b.q !== a.q) return b.q - a.q;
        return (a.voice.name || "").localeCompare(b.voice.name || "");
      });

    var groups = {};
    var order = [];
    ranked.forEach(function (item) {
      var g = langGroup(item.voice.lang);
      if (!groups[g]) {
        groups[g] = [];
        order.push(g);
      }
      groups[g].push(item);
    });

    order.sort(function (a, b) {
      var ae = a.toLowerCase().indexOf("en") === 0 ? 0 : 1;
      var be = b.toLowerCase().indexOf("en") === 0 ? 0 : 1;
      if (ae !== be) return ae - be;
      return a.localeCompare(b);
    });

    var bestKey = ranked[0] ? voiceKey(ranked[0].voice) : "";
    var pick = null;

    order.forEach(function (g) {
      var og = document.createElement("optgroup");
      og.label = g;
      groups[g].forEach(function (item) {
        var o = document.createElement("option");
        var key = voiceKey(item.voice);
        o.value = key;
        o.textContent = voiceLabel(item.voice);
        og.appendChild(o);
        if (saved && (item.voice.voiceURI === saved || item.voice.name === saved || key === saved)) {
          pick = key;
        }
      });
      voiceEl.appendChild(og);
    });

    if (!pick && prev && ranked.some(function (item) { return voiceKey(item.voice) === prev; })) {
      pick = prev;
    }
    if (!pick) pick = bestKey;

    voiceEl.value = pick;
    voiceEl.disabled = false;
    setControls();
  }

  function selectedWebSpeechVoice() {
    var key = voiceEl.value;
    if (!key) return null;
    for (var i = 0; i < voices.length; i++) {
      if (voiceKey(voices[i]) === key) return voices[i];
    }
    return null;
  }

  function saveWebSpeechVoice() {
    var v = selectedWebSpeechVoice();
    if (!v) return;
    try {
      localStorage.setItem(STORAGE_KEY, voiceKey(v));
    } catch (e) {}
  }

  function clearUtterance() {
    utterance = null;
    speaking = false;
    isPaused = false;
    speakingClipId = null;
    setControls();
  }

  function findDeviceVoice(key) {
    if (!speechAvailable() || !key) return null;
    var list = window.speechSynthesis.getVoices() || [];
    for (var i = 0; i < list.length; i++) {
      if (voiceKey(list[i]) === key) return list[i];
    }
    return null;
  }

  function stopWebSpeech() {
    if (!speechAvailable()) return;
    if (speakTimer) {
      clearTimeout(speakTimer);
      speakTimer = null;
    }
    window.speechSynthesis.cancel();
    clearUtterance();
  }

  function applyVoice(utt, v) {
    if (!v) return;
    try {
      utt.voice = v;
    } catch (e) {}
    if (v.lang) utt.lang = v.lang;
  }

  /**
   * opts (optional): { voice, rate, clipId } — used to replay a device clip
   * with the voice/speed it was first spoken with.
   */
  function speakWebSpeech(text, fromGesture, opts) {
    opts = opts || {};
    if (!speechAvailable()) return;
    if (!text) return;
    if (audioActive) stopEleven();

    if (speakTimer) {
      clearTimeout(speakTimer);
      speakTimer = null;
    }

    window.speechSynthesis.cancel();

    function start() {
      var u = new SpeechSynthesisUtterance(text);
      utterance = u;
      var v = opts.voice || selectedWebSpeechVoice();
      applyVoice(utterance, v);
      utterance.rate = opts.rate || parseFloat(rateEl.value) || 1;
      utterance.pitch = 1.02;
      utterance.volume = 1;

      utterance.onstart = function () {
        speaking = true;
        isPaused = false;
        setControls();
      };
      // Ignore late end/error events from an utterance we already replaced.
      utterance.onend = function () {
        if (utterance === u) clearUtterance();
      };
      utterance.onerror = function () {
        if (utterance === u) clearUtterance();
      };

      speaking = true;
      isPaused = false;
      speakingClipId = opts.clipId || null;
      setControls();
      window.speechSynthesis.speak(utterance);

      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }

    if (fromGesture) {
      speakTimer = setTimeout(start, 60);
    } else {
      start();
    }
  }

  /* ---------- Cloud voice helpers (ElevenLabs + Google) ---------- */

  function elLabel(v) {
    var parts = [v.name || "Voice"];
    var labels = v.labels || {};
    var accent = labels.accent || labels.language || "";
    var desc = labels.description || labels.descriptive || labels.use_case || "";
    if (accent) parts.push("(" + accent + ")");
    if (desc) parts.push("· " + desc);
    return parts.join(" ");
  }

  var GOOGLE_TIER_GROUPS = {
    hd: "HD voices · 1M free chars/mo",
    wavenet: "WaveNet · 4M free chars/mo",
  };

  /** Fill the voice list for the current cloud source (ElevenLabs or Google). */
  function populateCloudVoices() {
    var prov = cloudProvider();
    if (!prov) return;
    var list = prov.voices;
    voiceEl.innerHTML = "";

    if (!list.length) {
      var empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "No " + prov.label + " voices";
      voiceEl.appendChild(empty);
      voiceEl.disabled = true;
      setControls();
      return;
    }

    var saved = null;
    try {
      saved = localStorage.getItem(prov.storageKey);
    } catch (e) {}

    var pick = null;
    var groups = {};
    list.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v.id;
      o.textContent = prov.id === "google" ? v.label || v.name : elLabel(v);
      if (prov.id === "google" && GOOGLE_TIER_GROUPS[v.tier]) {
        if (!groups[v.tier]) {
          groups[v.tier] = document.createElement("optgroup");
          groups[v.tier].label = GOOGLE_TIER_GROUPS[v.tier];
          voiceEl.appendChild(groups[v.tier]);
        }
        groups[v.tier].appendChild(o);
      } else {
        voiceEl.appendChild(o);
      }
      if (saved && v.id === saved) pick = v.id;
    });

    if (!pick) pick = list[0].id;
    voiceEl.value = pick;
    voiceEl.disabled = false;
    setControls();
  }

  function saveCloudVoice() {
    var prov = cloudProvider();
    var id = voiceEl.value;
    if (!prov || !id) return;
    try {
      localStorage.setItem(prov.storageKey, id);
    } catch (e) {}
  }

  function revokeAudio() {
    if (audioUrl) {
      try {
        URL.revokeObjectURL(audioUrl);
      } catch (e) {}
      audioUrl = null;
    }
  }

  function stopEleven() {
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.removeAttribute("src");
        audioEl.load();
      } catch (e) {}
    }
    revokeAudio();
    currentClipId = null;
    audioActive = false;
    speaking = false;
    isPaused = false;
    loadingTts = false;
    setControls();
  }

  function ensureAudio() {
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.preload = "auto";
      audioEl.addEventListener("play", function () {
        speaking = true;
        isPaused = false;
        setControls();
      });
      audioEl.addEventListener("pause", function () {
        if (audioEl && !audioEl.ended && audioEl.currentTime > 0) {
          isPaused = true;
          speaking = false;
          setControls();
        }
      });
      audioEl.addEventListener("ended", function () {
        speaking = false;
        isPaused = false;
        setControls();
      });
      audioEl.addEventListener("loadedmetadata", function () {
        if (currentClipId && audioEl && isFinite(audioEl.duration)) {
          clipStore.setDuration(currentClipId, audioEl.duration);
        }
      });
      audioEl.addEventListener("error", function () {
        speaking = false;
        isPaused = false;
        loadingTts = false;
        setControls();
      });
    }
    return audioEl;
  }

  /** Play a stored clip's MP3 — no network, no credits. */
  function playClip(clip) {
    if (!clip || !clip.url) return;
    stopWebSpeech();
    stopEleven();
    var audio = ensureAudio();
    // Detached clips (fetched just as Clear all ran) own their URL here.
    if (clip.detached) audioUrl = clip.url;
    audio.src = clip.url;
    currentClipId = clip.detached ? null : clip.id;
    audioActive = true;
    speaking = true;
    isPaused = false;
    loadingTts = false;
    setControls();
    var p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(function () {
        speaking = false;
        isPaused = false;
        setControls();
      });
    }
  }

  /** Slider speed clamped to what the current cloud source accepts (mirrors the server). */
  function currentElRate() {
    var prov = cloudProvider() || providers.elevenlabs;
    var rate = parseFloat(rateEl.value) || 1;
    if (rate > prov.maxRate) rate = prov.maxRate;
    if (rate < prov.minRate) rate = prov.minRate;
    return rate;
  }

  function elVoiceName(id, source) {
    var prov = cloudProvider(source);
    var list = prov ? prov.voices : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i].name || "Voice";
    }
    return "Voice";
  }

  /** Clip metadata for the current cloud source + voice + speed + text. */
  function elClipMeta(text, voiceId, rate, hidden) {
    var source = isCloudMode() ? mode : "elevenlabs";
    return {
      key: Clips.clipKey(source, voiceId, rate, text),
      source: source,
      text: text,
      voiceId: voiceId,
      voiceName: elVoiceName(voiceId, source),
      rate: rate,
      hidden: !!hidden,
    };
  }

  /** Cached clip or one cloud request; resolves the stored clip. */
  function getElClip(text, voiceId, rate, hidden) {
    var meta = elClipMeta(text, voiceId, rate, hidden);
    return clipStore
      .getOrFetch(meta, function () {
        return fetchTts(text, voiceId, meta.source, rate);
      })
      .then(function (r) {
        return r.clip;
      });
  }

  function cachedElClip(text, voiceId, rate) {
    var source = isCloudMode() ? mode : "elevenlabs";
    return clipStore.get(Clips.clipKey(source, voiceId, rate, text));
  }

  function maxCharsForMode() {
    var prov = cloudProvider();
    return prov ? prov.maxChars : MAX_TTS_CHARS;
  }

  function tooLongMessage() {
    var prov = cloudProvider() || providers.elevenlabs;
    return (
      "Text is too long for " +
      prov.label +
      " (max " +
      prov.maxChars.toLocaleString("en-US") +
      " characters). Shorten it a bit" +
      (prov.id === "elevenlabs" ? " or use Google for long reads." : ".")
    );
  }

  function ttsErrorMessage(err, status) {
    var detail = "";
    if (err) {
      detail = String(err.detail || "") + " " + String(err.error || "");
    }
    if (/speed/i.test(detail) || /expected.*0\.7.*1\.2/i.test(detail)) {
      return "Speed too fast for ElevenLabs (max 1.2×)";
    }
    if (/quota_exceeded|credits remaining|quota/i.test(detail)) {
      var m = detail.match(/(\d[\d,]*) credits remaining[^\d]*(\d[\d,]*)/i);
      return m
        ? "Out of ElevenLabs credits: " + m[1] + " left, this needs " + m[2] + ". Try shorter text or top up ElevenLabs."
        : "Out of ElevenLabs credits. Try shorter text or top up ElevenLabs.";
    }
    if (status === 401 || /invalid_api_key|unauthorized/i.test(detail)) {
      return "ElevenLabs key problem (401). Check the API key in Vercel.";
    }
    if (status === 429 || /too_many|rate limit|concurrent/i.test(detail)) {
      return "ElevenLabs is busy (rate limit). Wait a moment and try again.";
    }
    if (status === 504 || /timeout|timed out/i.test(detail)) {
      return "ElevenLabs took too long. Try a shorter piece of text.";
    }
    if (err && err.error) {
      var d = String(err.detail || "").replace(/\s+/g, " ").trim().slice(0, 160);
      return err.error + (status ? " (" + status + ")" : "") + (d ? ": " + d : "");
    }
    return "TTS failed" + (status ? " (" + status + ")" : "");
  }

  /** Plain words for a Google failure; the server already maps Google's reasons. */
  function googleErrorMessage(err, status) {
    if (status === 503) {
      return GOOGLE_SETUP_NOTE + " (add GOOGLE_TTS_API_KEY in Vercel).";
    }
    if (err && err.error) {
      if (err.reason && err.reason !== "google_error" && err.reason !== "network") {
        return err.error;
      }
      var d = String(err.detail || "").replace(/\s+/g, " ").trim().slice(0, 160);
      return err.error + (status ? " (" + status + ")" : "") + (d ? ": " + d : "");
    }
    return "Google TTS failed" + (status ? " (" + status + ")" : "");
  }

  function postTts(source, text, voiceId, rate) {
    var prov = providers[source] || providers.elevenlabs;
    return fetch(prov.ttsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: text, voiceId: voiceId, rate: rate }),
    }).then(function (res) {
      if (!res.ok) {
        return res
          .json()
          .catch(function () {
            return { error: "TTS failed (" + res.status + ")" };
          })
          .then(function (err) {
            throw new Error(
              source === "google" ? googleErrorMessage(err, res.status) : ttsErrorMessage(err, res.status)
            );
          });
      }
      return res.blob().then(function (blob) {
        if (blob && typeof blob.type === "string" && blob.type.indexOf("audio/") === 0) {
          return blob;
        }
        return new Blob([blob], { type: "audio/mpeg" });
      });
    });
  }

  /**
   * One cloud MP3 for the whole text. Long Google text goes out as a few
   * requests (sentence boundaries) and the MP3s are joined in order.
   */
  function fetchTts(text, voiceId, source, rate) {
    source = source || "elevenlabs";
    if (rate == null) rate = currentElRate();
    if (source !== "google" || !Chunks || Chunks.utf8Bytes(text) <= GOOGLE_PART_BYTES) {
      return postTts(source, text, voiceId, rate);
    }
    var parts = Chunks.splitText(text, GOOGLE_PART_BYTES);
    var blobs = [];
    return parts
      .reduce(function (p, part) {
        return p.then(function () {
          return postTts(source, part, voiceId, rate).then(function (b) {
            blobs.push(b);
          });
        });
      }, Promise.resolve())
      .then(function () {
        return new Blob(blobs, { type: "audio/mpeg" });
      });
  }

  /** opts.sample: voice-change sample — cached but not listed. */
  function playEleven(text, opts) {
    opts = opts || {};
    var voiceId = voiceEl.value;
    if (!voiceId || !text) return;

    if (text.length > maxCharsForMode()) {
      window.alert(tooLongMessage());
      return;
    }

    // Resume paused audio without re-fetch
    if (audioActive && isPaused && audioEl && audioEl.src) {
      var p = audioEl.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () {});
      }
      speaking = true;
      isPaused = false;
      setControls();
      return;
    }

    var rate = currentElRate();
    var meta = elClipMeta(text, voiceId, rate, opts.sample);

    // Same text + voice + speed already voiced this session: replay it.
    var hit = clipStore.get(meta.key);
    if (hit) {
      if (hit.hidden && !opts.sample) clipStore.add(meta);
      playClip(hit);
      return;
    }

    stopWebSpeech();
    stopEleven();
    loadingTts = true;
    setControls();

    getElClip(text, voiceId, rate, opts.sample)
      .then(function (clip) {
        playClip(clip);
      })
      .catch(function (err) {
        loadingTts = false;
        speaking = false;
        isPaused = false;
        setControls();
        var msg =
          (err && err.message) ||
          "Couldn’t generate speech. Try again or pick another voice.";
        window.alert(msg);
      });
  }

  function pauseEleven() {
    if (!audioEl || !speaking) return;
    audioEl.pause();
    isPaused = true;
    speaking = false;
    setControls();
  }

  function previewEleven() {
    saveCloudVoice();
    playEleven(PREVIEW, { sample: true });
  }

  /* ---------- Source switching ---------- */

  function stopAll() {
    stopEleven();
    stopWebSpeech();
  }

  function applySource(source, persist) {
    stopAll();

    if (providers[source] && providers[source].available) {
      mode = source;
      unsupportedEl.hidden = true;
      populateCloudVoices();
    } else {
      mode = "webspeech";
      if (!speechAvailable()) {
        unsupportedEl.hidden = false;
        playBtn.disabled = true;
        pauseBtn.disabled = true;
        stopBtn.disabled = true;
        voiceEl.disabled = true;
        voiceEl.innerHTML = '<option value="">Unavailable</option>';
      } else {
        unsupportedEl.hidden = true;
        populateWebSpeechVoices(true);
      }
    }

    updateSourceButtons();
    setModeCopy();
    syncRateLimitsForMode();
    if (persist !== false) saveSource();
    setControls();
  }

  function pickInitialSource() {
    var saved = loadSavedSource();
    if (saved && providers[saved] && providers[saved].available) return saved;
    if (saved === "device") return "device";
    // Nothing saved (or that source is down): cheap Google first, then ElevenLabs.
    if (providers.google.available) return "google";
    if (providers.elevenlabs.available) return "elevenlabs";
    return "device";
  }

  /* ---------- Download (cloud MP3: ElevenLabs or Google) ---------- */

  function setDownloadStatus(msg, kind) {
    if (!downloadStatusEl) return;
    if (downloadStatusTimer) {
      clearTimeout(downloadStatusTimer);
      downloadStatusTimer = null;
    }
    if (!msg) {
      downloadStatusEl.hidden = true;
      downloadStatusEl.textContent = "";
      downloadStatusEl.classList.remove("is-error", "is-muted");
      return;
    }
    downloadStatusEl.hidden = false;
    downloadStatusEl.textContent = msg;
    downloadStatusEl.classList.toggle("is-error", kind === "error");
    downloadStatusEl.classList.toggle("is-muted", kind === "muted");
    if (kind === "ok" || kind === "error") {
      downloadStatusTimer = setTimeout(function () {
        setDownloadStatus("");
      }, 3200);
    }
  }

  function suggestDownloadName(text) {
    var words = (text || "")
      .trim()
      .replace(/[^\w\s-]+/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6);
    if (!words.length) return "readit-audio";
    var base = words.join(" ").slice(0, 48).trim();
    return base || "readit-audio";
  }

  function sanitizeFilename(raw) {
    var name = String(raw || "").trim();
    name = name.replace(/[/\\?%*:|"<>]/g, "");
    name = name.replace(/\.+/g, ".");
    name = name.replace(/^\.+/, "");
    name = name.replace(/\s+/g, " ").trim();
    if (!name) name = "readit-audio";
    if (!/\.mp3$/i.test(name)) name += ".mp3";
    // Keep only letters, numbers, spaces, hyphen, underscore, and .mp3
    var stem = name.replace(/\.mp3$/i, "");
    stem = stem.replace(/[^a-zA-Z0-9 _-]/g, "").trim();
    if (!stem) stem = "readit-audio";
    stem = stem.slice(0, 100);
    return stem + ".mp3";
  }

  function isTouchUi() {
    try {
      if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
        return true;
      }
    } catch (e) {}
    // iPadOS desktop UA still reports MacIntel + touch
    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) {
      return true;
    }
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  function isIOSLike() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }

  function ensureMpegBlob(blob) {
    if (blob && blob.type === "audio/mpeg") return blob;
    return new Blob([blob], { type: "audio/mpeg" });
  }

  function revokeLater(url) {
    setTimeout(function () {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    }, 60000);
  }

  function triggerAnchorDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    try {
      a.click();
    } catch (e) {
      try {
        document.body.removeChild(a);
      } catch (e2) {}
      revokeLater(url);
      return openBlobTab(url);
    }
    setTimeout(function () {
      try {
        document.body.removeChild(a);
      } catch (e3) {}
    }, 1000);
    revokeLater(url);
    return { method: "anchor" };
  }

  function openBlobTab(urlOrBlob) {
    var url =
      typeof urlOrBlob === "string"
        ? urlOrBlob
        : URL.createObjectURL(urlOrBlob);
    var opened = null;
    try {
      opened = window.open(url, "_blank");
    } catch (e) {}
    if (!opened) {
      var a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      try {
        a.click();
      } catch (e2) {}
      setTimeout(function () {
        try {
          document.body.removeChild(a);
        } catch (e3) {}
      }, 1000);
    }
    revokeLater(url);
    return { method: "tab" };
  }

  /**
   * Hidden form POST to /api/download so Safari navigates to an attachment
   * response (Content-Disposition) — more reliable than <a download> on iOS.
   */
  function submitDownloadForm(text, voiceId, rate, filename, source) {
    var form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/download";
    form.target = "_blank";
    form.enctype = "application/x-www-form-urlencoded";
    form.acceptCharset = "UTF-8";
    form.style.display = "none";
    form.setAttribute("aria-hidden", "true");

    function addField(name, value) {
      var input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value == null ? "" : String(value);
      form.appendChild(input);
    }

    addField("text", text);
    addField("voiceId", voiceId);
    addField("rate", rate);
    addField("filename", filename);
    if (source && source !== "elevenlabs") addField("source", source);

    document.body.appendChild(form);
    try {
      form.submit();
    } finally {
      setTimeout(function () {
        try {
          document.body.removeChild(form);
        } catch (e) {}
      }, 2000);
    }
    return { method: "form" };
  }

  /**
   * Web Share with an MP3 File (AirDrop / Drive / Save to Files).
   * Returns Promise<{ method: "share"|"cancelled"|"fallback" }>.
   */
  function triggerWebShare(blob, filename) {
    var mpegBlob = ensureMpegBlob(blob);
    try {
      if (typeof File !== "undefined" && navigator.share && navigator.canShare) {
        var file = new File([mpegBlob], filename, { type: "audio/mpeg" });
        var shareData = { files: [file], title: filename };
        if (navigator.canShare(shareData)) {
          return navigator
            .share(shareData)
            .then(function () {
              return { method: "share" };
            })
            .catch(function (err) {
              if (err && err.name === "AbortError") {
                return { method: "cancelled" };
              }
              return { method: "fallback" };
            });
        }
      }
    } catch (e) {}
    return Promise.resolve({ method: "fallback" });
  }

  function iosDownloadStatus(filename) {
    return (
      "Downloading MP3… If nothing appears: check Files → Downloads (or On My iPhone). " +
      "If a player tab opens: tap Share → Save to Files. " +
      "(" +
      filename +
      ")"
    );
  }

  function askFilename(defaultName, options) {
    options = options || {};
    var title = options.title || "Download MP3 as";
    var confirmLabel = options.confirmLabel || "Download MP3";
    var titleEl = document.getElementById("download-dialog-title");

    return new Promise(function (resolve) {
      if (!downloadDialog || !downloadNameEl || !downloadForm) {
        var fallback = window.prompt("File name for the MP3:", defaultName);
        if (fallback == null) {
          resolve(null);
          return;
        }
        resolve(sanitizeFilename(fallback));
        return;
      }

      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        downloadForm.removeEventListener("submit", onSubmit);
        if (downloadCancelBtn) {
          downloadCancelBtn.removeEventListener("click", onCancel);
        }
        downloadDialog.removeEventListener("cancel", onCancel);
        try {
          if (downloadDialog.open) downloadDialog.close();
        } catch (e) {}
        resolve(value);
      }

      function onSubmit(ev) {
        ev.preventDefault();
        finish(sanitizeFilename(downloadNameEl.value));
      }

      function onCancel(ev) {
        if (ev) ev.preventDefault();
        finish(null);
      }

      if (titleEl) titleEl.textContent = title;
      if (downloadConfirmBtn) downloadConfirmBtn.textContent = confirmLabel;
      downloadNameEl.value = defaultName;
      downloadForm.addEventListener("submit", onSubmit);
      if (downloadCancelBtn) {
        downloadCancelBtn.addEventListener("click", onCancel);
      }
      downloadDialog.addEventListener("cancel", onCancel);

      try {
        if (typeof downloadDialog.showModal === "function") {
          downloadDialog.showModal();
        } else {
          downloadDialog.setAttribute("open", "");
        }
      } catch (e) {
        var fallback2 = window.prompt("File name for the MP3:", defaultName);
        finish(fallback2 == null ? null : sanitizeFilename(fallback2));
        return;
      }

      setTimeout(function () {
        try {
          downloadNameEl.focus();
          downloadNameEl.select();
        } catch (e) {}
      }, 30);
    });
  }

  function downloadAudio() {
    if (downloading) return;
    if (!isCloudMode() || !cloudProvider().available) {
      setDownloadStatus("Download needs ElevenLabs or Google — switch source above.", "muted");
      return;
    }
    var text = textEl.value.trim();
    var voiceId = voiceEl.value;
    if (!text || !voiceId) {
      setDownloadStatus("Add text and pick a voice first.", "muted");
      return;
    }
    if (text.length > maxCharsForMode()) {
      setDownloadStatus(
        "Text too long (max " + maxCharsForMode().toLocaleString("en-US") + " characters).",
        "error"
      );
      return;
    }

    var suggested = sanitizeFilename(suggestDownloadName(text));
    askFilename(suggested.replace(/\.mp3$/i, "")).then(function (filename) {
      if (!filename) {
        setDownloadStatus("Cancelled", "muted");
        return;
      }
      filename = sanitizeFilename(filename);
      var rate = currentElRate();
      var cachedClip = cachedElClip(text, voiceId, rate);
      var hasCached = !!(cachedClip && cachedClip.blob);

      downloading = true;
      setControls();

      // iOS: browser navigation to Content-Disposition attachment is the
      // reliable raw-file path (<a download> is flaky in Safari). Very long
      // Google text is too big for one request, so it takes the blob path.
      var formSource = mode;
      var formOk = formSource !== "google" || text.length <= GOOGLE_REQUEST_CHARS;
      if (isIOSLike() && formOk) {
        setDownloadStatus(iosDownloadStatus(filename), "muted");
        submitDownloadForm(text, voiceId, rate, filename, formSource);
        // Also try blob+download when Play already cached the same audio —
        // harmless if Safari ignores it; helps when it works.
        if (hasCached) {
          try {
            triggerAnchorDownload(cachedClip.blob, filename);
          } catch (e) {}
        }
        downloading = false;
        setControls();
        return;
      }

      // Desktop / Android: prefer cached Play blob + <a download>; else form POST.
      if (hasCached) {
        setDownloadStatus("Downloading MP3…", "muted");
        var result = triggerAnchorDownload(cachedClip.blob, filename);
        downloading = false;
        setControls();
        if (result && result.method === "anchor") {
          setDownloadStatus("Saved · " + filename, "ok");
        } else {
          setDownloadStatus("Downloading MP3… check your Downloads folder", "muted");
        }
        return;
      }

      // Not voiced yet: make it once, keep it in This session, then save.
      setDownloadStatus("Generating speech…", "muted");
      getElClip(text, voiceId, rate, false)
        .then(function (clip) {
          triggerAnchorDownload(clip.blob, filename);
          downloading = false;
          setControls();
          setDownloadStatus("Saved · " + filename, "ok");
        })
        .catch(function (err) {
          downloading = false;
          setControls();
          setDownloadStatus(
            (err && err.message) || "Couldn’t generate speech.",
            "error"
          );
        });
    });
  }

  function shareAudio() {
    if (downloading) return;
    if (!isCloudMode() || !cloudProvider().available) {
      setDownloadStatus("Share needs ElevenLabs or Google — switch source above.", "muted");
      return;
    }
    var text = textEl.value.trim();
    var voiceId = voiceEl.value;
    if (!text || !voiceId) {
      setDownloadStatus("Add text and pick a voice first.", "muted");
      return;
    }
    if (text.length > maxCharsForMode()) {
      setDownloadStatus(
        "Text too long (max " + maxCharsForMode().toLocaleString("en-US") + " characters).",
        "error"
      );
      return;
    }

    var suggested = sanitizeFilename(suggestDownloadName(text));
    // Start TTS while Cap names the file so Share can run in the confirm gesture.
    downloading = true;
    setControls();
    var rate = currentElRate();
    var ttsPromise;
    var cachedClip = cachedElClip(text, voiceId, rate);
    if (cachedClip && cachedClip.blob) {
      setDownloadStatus("Using the clip from this session", "muted");
      ttsPromise = Promise.resolve(cachedClip.blob);
    } else {
      setDownloadStatus("Generating speech…", "muted");
      ttsPromise = getElClip(text, voiceId, rate, false).then(function (clip) {
        return clip.blob;
      });
    }

    askFilename(suggested.replace(/\.mp3$/i, ""), {
      title: "Share MP3 as",
      confirmLabel: "Share…",
    }).then(function (filename) {
      if (!filename) {
        downloading = false;
        setControls();
        setDownloadStatus("Cancelled", "muted");
        ttsPromise.catch(function () {});
        return;
      }
      filename = sanitizeFilename(filename);
      setDownloadStatus("Opening share sheet…", "muted");

      ttsPromise
        .then(function (blob) {
          return triggerWebShare(blob, filename).then(function (result) {
            return { result: result, filename: filename, blob: blob };
          });
        })
        .then(function (payload) {
          downloading = false;
          setControls();
          var result = payload.result || {};
          var name = payload.filename;
          if (result.method === "share") {
            setDownloadStatus(
              "Share sheet opened — Save to Files keeps a raw MP3 in Apple Files (or pick Drive/AirDrop)",
              "muted"
            );
          } else if (result.method === "cancelled") {
            setDownloadStatus("Cancelled", "muted");
          } else {
            // Share unavailable — fall back to true download form / anchor.
            if (isIOSLike() && (mode !== "google" || text.length <= GOOGLE_REQUEST_CHARS)) {
              setDownloadStatus(iosDownloadStatus(name), "muted");
              submitDownloadForm(text, voiceId, rate, name, mode);
            } else {
              triggerAnchorDownload(payload.blob, name);
              setDownloadStatus("Saved · " + name, "ok");
            }
          }
        })
        .catch(function (err) {
          downloading = false;
          setControls();
          setDownloadStatus(
            (err && err.message) || "Share failed — try Download MP3.",
            "error"
          );
        });
    });
  }

  /* ---------- This session (clip list) ---------- */

  var shareFilesSupport = null;
  function canShareFiles() {
    if (shareFilesSupport !== null) return shareFilesSupport;
    shareFilesSupport = false;
    try {
      if (typeof File !== "undefined" && navigator.share && navigator.canShare) {
        var probe = new File([new Uint8Array(4)], "readit.mp3", { type: "audio/mpeg" });
        shareFilesSupport = !!navigator.canShare({ files: [probe] });
      }
    } catch (e) {}
    return shareFilesSupport;
  }

  function clipPlayLabel(clip) {
    if (!clip.exportable) {
      return speakingClipId === clip.id ? "Stop" : "Play";
    }
    if (currentClipId === clip.id) {
      if (speaking) return "Pause";
      if (isPaused) return "Resume";
    }
    return "Play";
  }

  function clipMetaText(clip) {
    var parts = [clip.source === "google" ? clip.voiceName + " (Google)" : clip.voiceName];
    if (clip.exportable) {
      var d = Clips.formatDuration(clip.duration);
      if (d) parts.push(d);
    } else {
      parts.push("Device voice");
    }
    parts.push(clip.rate.toFixed(2).replace(/0$/, "") + "×");
    return parts.join(" · ");
  }

  function makeBtn(label, cls, action, id) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn " + cls;
    b.textContent = label;
    b.setAttribute("data-action", action);
    b.setAttribute("data-id", id);
    return b;
  }

  function renderClips() {
    if (!clipsList || !clipsSection) return;
    var list = clipStore.list();
    clipsSection.hidden = list.length === 0;
    clipsList.innerHTML = "";
    list.forEach(function (clip) {
      var li = document.createElement("li");
      li.className = "clip" + (clip.exportable ? "" : " clip-device");
      li.setAttribute("data-id", clip.id);

      var txt = document.createElement("p");
      txt.className = "clip-text";
      txt.textContent = "“" + Clips.previewText(clip.text, 90) + "”";
      li.appendChild(txt);

      var meta = document.createElement("p");
      meta.className = "clip-meta";
      meta.textContent = clipMetaText(clip);
      li.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "clip-actions";
      var playB = makeBtn(clipPlayLabel(clip), "btn-primary clip-play", "play", clip.id);
      playB.setAttribute("aria-label", clipPlayLabel(clip) + " clip " + clip.n);
      actions.appendChild(playB);
      if (clip.exportable) {
        if (canShareFiles()) {
          actions.appendChild(makeBtn("Share", "btn-secondary clip-share", "share", clip.id));
        }
        actions.appendChild(makeBtn("Download", "btn-secondary clip-download", "download", clip.id));
      } else {
        var note = document.createElement("span");
        note.className = "clip-noexport";
        note.textContent = "No MP3 — device voices can’t export";
        actions.appendChild(note);
      }
      li.appendChild(actions);
      clipsList.appendChild(li);
    });
  }

  /** Update only Play/Pause labels (cheap; runs on every control change). */
  function renderClipStates() {
    if (!clipsList) return;
    var btns = clipsList.querySelectorAll("button[data-action='play']");
    for (var i = 0; i < btns.length; i++) {
      var clip = clipStore.getById(btns[i].getAttribute("data-id"));
      if (!clip) continue;
      var label = clipPlayLabel(clip);
      if (btns[i].textContent !== label) {
        btns[i].textContent = label;
        btns[i].setAttribute("aria-label", label + " clip " + clip.n);
      }
      var li = btns[i].closest ? btns[i].closest(".clip") : null;
      if (li) {
        var on = currentClipId === clip.id || speakingClipId === clip.id;
        li.classList.toggle("is-playing", on);
      }
    }
  }

  function toggleClip(clip) {
    if (!clip.exportable) {
      // Device voice: re-speak for free (no MP3 exists to replay).
      if (speakingClipId === clip.id) {
        stopWebSpeech();
        return;
      }
      if (!speechAvailable()) return;
      var v = findDeviceVoice(clip.voiceId);
      speakWebSpeech(clip.text, true, { voice: v, rate: clip.rate, clipId: clip.id });
      return;
    }
    if (currentClipId === clip.id && speaking) {
      pauseEleven();
      return;
    }
    if (currentClipId === clip.id && isPaused && audioEl && audioEl.src) {
      var p = audioEl.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
      speaking = true;
      isPaused = false;
      setControls();
      return;
    }
    playClip(clip);
  }

  function exportClip(clip, how) {
    if (!clip || !clip.blob) return;
    var filename = Clips.clipFilename(clip);
    if (how === "share") {
      // Blob is already in memory, so share() runs inside this tap.
      triggerWebShare(clip.blob, filename).then(function (result) {
        if (result.method === "share") {
          setDownloadStatus("Shared · " + filename, "ok");
        } else if (result.method === "cancelled") {
          setDownloadStatus("Cancelled", "muted");
        } else {
          triggerAnchorDownload(clip.blob, filename);
          setDownloadStatus("Saved · " + filename, "ok");
        }
      });
      return;
    }
    triggerAnchorDownload(clip.blob, filename);
    setDownloadStatus("Saved · " + filename + " (check Downloads)", "ok");
  }

  function wireClips() {
    if (clipsList) {
      clipsList.addEventListener("click", function (ev) {
        var t = ev.target;
        var btn = t && t.closest ? t.closest("button[data-action]") : null;
        if (!btn) return;
        var clip = clipStore.getById(btn.getAttribute("data-id"));
        if (!clip) return;
        var action = btn.getAttribute("data-action");
        if (action === "play") toggleClip(clip);
        else if (action === "share" || action === "download") exportClip(clip, action);
      });
    }
    if (clipsClearBtn) {
      clipsClearBtn.addEventListener("click", function () {
        if (!clipStore.list().length) return;
        if (!window.confirm("Clear all clips from this session? You can’t get them back without voicing again.")) {
          return;
        }
        stopAll();
        clipStore.revokeAll();
      });
    }
    // Session-only: when the page really goes away, drop every MP3 + URL.
    // (persisted = kept in back/forward cache; the page may come back intact.)
    window.addEventListener("pagehide", function (ev) {
      if (ev && ev.persisted) return;
      stopAll();
      clipStore.revokeAll();
    });
    renderClips();
  }

  /* ---------- Shared controls ---------- */

  function saveRate() {
    try {
      localStorage.setItem(RATE_KEY, rateEl.value);
    } catch (e) {}
  }

  function loadRate() {
    try {
      var r = localStorage.getItem(RATE_KEY);
      if (r != null) {
        var n = parseFloat(r);
        if (!isNaN(n) && n >= 0.75 && n <= 1.5) {
          rateEl.value = String(n);
        }
      }
    } catch (e) {}
    updateRateLabel();
  }

  function play() {
    var text = textEl.value.trim();
    if (audioActive && isPaused && audioEl && audioEl.src) {
      var p = audioEl.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
      speaking = true;
      isPaused = false;
      setControls();
      return;
    }
    if (isCloudMode()) {
      if (!text) return;
      playEleven(text);
      return;
    }
    if (!speechAvailable()) return;
    if (!text) return;
    if (isPaused) {
      window.speechSynthesis.resume();
      isPaused = false;
      speaking = true;
      setControls();
      return;
    }
    var dc = rememberDeviceClip(text);
    speakWebSpeech(text, true, dc ? { clipId: dc.id } : null);
  }

  /** Device prompts go in the list too: replay = re-speak (free), no export. */
  function rememberDeviceClip(text) {
    var v = selectedWebSpeechVoice();
    if (!v || !text) return null;
    var rate = parseFloat(rateEl.value) || 1;
    var key = Clips.clipKey("device", voiceKey(v), rate, text);
    var clip = clipStore.add({
      key: key,
      source: "device",
      text: text,
      voiceId: voiceKey(v),
      voiceName: v.name || "Device voice",
      rate: rate,
    });
    return clip;
  }

  function pause() {
    if (audioActive || isCloudMode()) {
      pauseEleven();
      return;
    }
    if (!speechAvailable() || !speaking) return;
    window.speechSynthesis.pause();
    isPaused = true;
    speaking = false;
    setControls();
  }

  function stopSpeaking() {
    stopAll();
  }

  function previewVoice() {
    if (isCloudMode()) {
      previewEleven();
      return;
    }
    saveWebSpeechVoice();
    speakWebSpeech(PREVIEW, true);
  }

  function wireDeviceVoices() {
    if (deviceVoicesWired || !speechAvailable()) return;
    deviceVoicesWired = true;

    if (typeof window.speechSynthesis.addEventListener === "function") {
      window.speechSynthesis.addEventListener("voiceschanged", function () {
        if (mode === "webspeech") populateWebSpeechVoices(false);
      });
    } else {
      window.speechSynthesis.onvoiceschanged = function () {
        if (mode === "webspeech") populateWebSpeechVoices(false);
      };
    }

    var tries = 0;
    var poll = setInterval(function () {
      tries += 1;
      if (mode === "webspeech") populateWebSpeechVoices(false);
      if ((voices.length && mode === "webspeech") || tries > 20) clearInterval(poll);
    }, 250);
  }

  function fetchCloudVoices(prov) {
    return fetch(prov.voicesUrl, { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (res.status === 503) {
          throw new Error(
            prov.id === "google"
              ? GOOGLE_SETUP_NOTE
              : "ElevenLabs not configured on the server (missing API key)."
          );
        }
        if (!res.ok) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (err) {
              if (prov.id === "google") {
                throw new Error(
                  err && err.error && err.reason && err.reason !== "google_error"
                    ? "Google voices: " + err.error
                    : "Google voices unavailable (API error " + res.status + ")."
                );
              }
              throw new Error("ElevenLabs voices unavailable (API error " + res.status + ").");
            });
        }
        return res.json();
      })
      .then(function (data) {
        var list = (data && data.voices) || [];
        if (!list.length) {
          throw new Error(prov.label + " returned no voices.");
        }
        prov.voices = list;
        prov.available = true;
        prov.reason = "";
      });
  }

  function markUnavailable(prov, err) {
    prov.available = false;
    prov.voices = [];
    prov.reason =
      (err && err.message) || prov.label + " unavailable — using device voices.";
  }

  function wireUi() {
    textEl.addEventListener("input", function () {
      updateCounts();
      setControls();
    });
    voiceEl.addEventListener("change", previewVoice);
    rateEl.addEventListener("input", function () {
      updateRateLabel();
      saveRate();
    });

    playBtn.addEventListener("click", play);
    pauseBtn.addEventListener("click", pause);
    stopBtn.addEventListener("click", stopSpeaking);
    if (downloadBtn) {
      downloadBtn.addEventListener("click", downloadAudio);
    }
    if (shareBtn) {
      shareBtn.addEventListener("click", shareAudio);
    }

    if (sourceElBtn) {
      sourceElBtn.addEventListener("click", function () {
        if (!providers.elevenlabs.available || mode === "elevenlabs") return;
        applySource("elevenlabs", true);
      });
    }
    if (sourceGoogleBtn) {
      sourceGoogleBtn.addEventListener("click", function () {
        if (!providers.google.available || mode === "google") return;
        applySource("google", true);
      });
    }
    if (sourceDeviceBtn) {
      sourceDeviceBtn.addEventListener("click", function () {
        if (mode === "webspeech") return;
        applySource("device", true);
      });
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden && (speaking || isPaused || loadingTts)) {
        stopSpeaking();
      }
    });

    wireClips();
    updateCounts();
    setControls();
  }

  function init() {
    loadRate();
    wireUi();
    voiceEl.innerHTML = '<option value="">Loading voices…</option>';
    voiceEl.disabled = true;
    if (hintEl) {
      hintEl.textContent = "Loading voice sources…";
    }

    wireDeviceVoices();

    function load(prov) {
      return fetchCloudVoices(prov).catch(function (err) {
        markUnavailable(prov, err);
      });
    }

    Promise.all([load(providers.elevenlabs), load(providers.google)])
      .then(function () {
        // Don't overwrite a saved ElevenLabs preference if the API is briefly down.
        applySource(pickInitialSource(), false);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
