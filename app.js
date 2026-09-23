(function () {
  "use strict";

  var STORAGE_KEY = "readit-voice-uri";
  var EL_STORAGE_KEY = "readit-el-voice-id";
  var SOURCE_KEY = "readit-voice-source";
  var RATE_KEY = "readit-rate";
  var PREVIEW =
    "Hey Cap. This is how I sound with the voice you picked.";
  var MAX_TTS_CHARS = 5000;

  var textEl = document.getElementById("text");
  var voiceEl = document.getElementById("voice");
  var rateEl = document.getElementById("rate");
  var rateValueEl = document.getElementById("rate-value");
  var countsEl = document.getElementById("counts");
  var playBtn = document.getElementById("play");
  var pauseBtn = document.getElementById("pause");
  var stopBtn = document.getElementById("stop");
  var unsupportedEl = document.getElementById("unsupported");
  var hintEl = document.getElementById("voice-hint");
  var footerEl = document.querySelector(".footer p");
  var sourceElBtn = document.getElementById("source-elevenlabs");
  var sourceDeviceBtn = document.getElementById("source-device");
  var sourceNoteEl = document.getElementById("source-note");
  var downloadBtn = document.getElementById("download");
  var downloadStatusEl = document.getElementById("download-status");
  var downloadDialog = document.getElementById("download-dialog");
  var downloadForm = document.getElementById("download-form");
  var downloadNameEl = document.getElementById("download-name");
  var downloadCancelBtn = document.getElementById("download-cancel");

  /** "elevenlabs" | "webspeech" */
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
  var audioEl = null;
  var audioUrl = null;
  var elVoices = [];
  var elevenLabsAvailable = false;
  var elUnavailableReason = "";
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

  function setControls() {
    var hasText = textEl.value.trim().length > 0;
    var hasVoices =
      mode === "elevenlabs" ? elVoices.length > 0 : voices.length > 0;
    var hasElVoice = mode === "elevenlabs" && !!voiceEl.value && elVoices.length > 0;
    var canResumeEl = mode === "elevenlabs" && isPaused && audioEl && audioEl.src;
    var canPlay =
      !loadingTts &&
      hasVoices &&
      (canResumeEl ||
        (hasText && (mode === "elevenlabs" || speechAvailable())));
    playBtn.disabled = !canPlay;
    pauseBtn.disabled = !speaking || loadingTts;
    stopBtn.disabled = !speaking && !isPaused && !loadingTts;
    if (loadingTts) {
      playBtn.textContent = "Loading…";
      playBtn.disabled = true;
    } else {
      playBtn.textContent = isPaused ? "Resume" : "Play";
    }
    if (downloadBtn) {
      var canDownload =
        mode === "elevenlabs" &&
        elevenLabsAvailable &&
        hasText &&
        hasElVoice &&
        !downloading;
      downloadBtn.disabled = !canDownload;
      if (mode !== "elevenlabs") {
        downloadBtn.title = "Download needs ElevenLabs (device voices can’t export a clean file)";
      } else if (!hasText) {
        downloadBtn.title = "Add text to download";
      } else if (!hasElVoice) {
        downloadBtn.title = "Pick an ElevenLabs voice";
      } else if (downloading) {
        downloadBtn.title = "Downloading…";
      } else {
        downloadBtn.title = "Save ElevenLabs speech as an MP3";
      }
      downloadBtn.textContent = downloading ? "Downloading…" : "Download";
    }
  }

  function saveSource() {
    var value = mode === "elevenlabs" ? "elevenlabs" : "device";
    try {
      localStorage.setItem(SOURCE_KEY, value);
    } catch (e) {}
  }

  function loadSavedSource() {
    try {
      var s = localStorage.getItem(SOURCE_KEY);
      if (s === "elevenlabs" || s === "device") return s;
    } catch (e) {}
    return null;
  }

  function updateSourceButtons() {
    var elActive = mode === "elevenlabs";
    if (sourceElBtn) {
      sourceElBtn.setAttribute("aria-pressed", elActive ? "true" : "false");
      sourceElBtn.disabled = !elevenLabsAvailable;
      if (!elevenLabsAvailable) {
        sourceElBtn.title = elUnavailableReason || "ElevenLabs unavailable";
      } else {
        sourceElBtn.removeAttribute("title");
      }
    }
    if (sourceDeviceBtn) {
      sourceDeviceBtn.setAttribute("aria-pressed", elActive ? "false" : "true");
      sourceDeviceBtn.disabled = false;
    }
    if (sourceNoteEl) {
      if (!elevenLabsAvailable && elUnavailableReason) {
        sourceNoteEl.hidden = false;
        sourceNoteEl.textContent = elUnavailableReason;
      } else {
        sourceNoteEl.hidden = true;
        sourceNoteEl.textContent = "";
      }
    }
  }

  function setModeCopy() {
    if (mode === "elevenlabs") {
      if (hintEl) {
        hintEl.textContent =
          "ElevenLabs selected — natural cloud voices. Use Download to save an MP3 (name the file first). Changing voice plays a short sample.";
      }
      if (footerEl) {
        footerEl.textContent =
          "Source: ElevenLabs (cloud). Tap Device voices for the smaller on-device list.";
      }
    } else {
      if (hintEl) {
        hintEl.textContent =
          "Device voices selected — only voices on this phone or computer. Prefer ones tagged “clearer.” Download is for ElevenLabs only (Web Speech can’t export a clean MP3).";
      }
      if (footerEl) {
        footerEl.textContent =
          "Source: Device (Web Speech). Tap ElevenLabs voices for cloud speech when the server is ready.";
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
    setControls();
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

  function speakWebSpeech(text, fromGesture) {
    if (!speechAvailable()) return;
    if (!text) return;

    if (speakTimer) {
      clearTimeout(speakTimer);
      speakTimer = null;
    }

    window.speechSynthesis.cancel();

    function start() {
      utterance = new SpeechSynthesisUtterance(text);
      var v = selectedWebSpeechVoice();
      applyVoice(utterance, v);
      utterance.rate = parseFloat(rateEl.value) || 1;
      utterance.pitch = 1.02;
      utterance.volume = 1;

      utterance.onstart = function () {
        speaking = true;
        isPaused = false;
        setControls();
      };
      utterance.onend = function () {
        clearUtterance();
      };
      utterance.onerror = function () {
        clearUtterance();
      };

      speaking = true;
      isPaused = false;
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

  /* ---------- ElevenLabs helpers ---------- */

  function elLabel(v) {
    var parts = [v.name || "Voice"];
    var labels = v.labels || {};
    var accent = labels.accent || labels.language || "";
    var desc = labels.description || labels.descriptive || labels.use_case || "";
    if (accent) parts.push("(" + accent + ")");
    if (desc) parts.push("· " + desc);
    return parts.join(" ");
  }

  function populateElevenVoices(list) {
    if (list) elVoices = list;
    voiceEl.innerHTML = "";

    if (!elVoices.length) {
      var empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "No ElevenLabs voices";
      voiceEl.appendChild(empty);
      voiceEl.disabled = true;
      setControls();
      return;
    }

    var saved = null;
    try {
      saved = localStorage.getItem(EL_STORAGE_KEY);
    } catch (e) {}

    var pick = null;
    elVoices.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v.id;
      o.textContent = elLabel(v);
      voiceEl.appendChild(o);
      if (saved && v.id === saved) pick = v.id;
    });

    if (!pick) pick = elVoices[0].id;
    voiceEl.value = pick;
    voiceEl.disabled = false;
    setControls();
  }

  function saveElVoice() {
    var id = voiceEl.value;
    if (!id) return;
    try {
      localStorage.setItem(EL_STORAGE_KEY, id);
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
      audioEl.addEventListener("error", function () {
        speaking = false;
        isPaused = false;
        loadingTts = false;
        setControls();
      });
    }
    return audioEl;
  }

  function playBlob(blob) {
    stopEleven();
    var audio = ensureAudio();
    audioUrl = URL.createObjectURL(blob);
    audio.src = audioUrl;
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

  function fetchTts(text, voiceId) {
    var rate = parseFloat(rateEl.value) || 1;
    return fetch("/api/tts", {
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
            throw new Error(err.error || "TTS failed");
          });
      }
      return res.blob();
    });
  }

  function playEleven(text) {
    var voiceId = voiceEl.value;
    if (!voiceId || !text) return;

    if (text.length > MAX_TTS_CHARS) {
      window.alert(
        "Text is too long for ElevenLabs (max " +
          MAX_TTS_CHARS +
          " characters). Shorten it a bit."
      );
      return;
    }

    // Resume paused audio without re-fetch
    if (isPaused && audioEl && audioEl.src) {
      var p = audioEl.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () {});
      }
      speaking = true;
      isPaused = false;
      setControls();
      return;
    }

    stopEleven();
    loadingTts = true;
    setControls();

    fetchTts(text, voiceId)
      .then(function (blob) {
        playBlob(blob);
      })
      .catch(function () {
        loadingTts = false;
        speaking = false;
        isPaused = false;
        setControls();
        window.alert("Couldn’t generate speech. Try again or pick another voice.");
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
    saveElVoice();
    playEleven(PREVIEW);
  }

  /* ---------- Source switching ---------- */

  function stopAll() {
    stopEleven();
    stopWebSpeech();
  }

  function applySource(source, persist) {
    stopAll();

    if (source === "elevenlabs" && elevenLabsAvailable) {
      mode = "elevenlabs";
      unsupportedEl.hidden = true;
      populateElevenVoices();
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
    if (persist !== false) saveSource();
    setControls();
  }

  function pickInitialSource() {
    var saved = loadSavedSource();
    if (saved === "elevenlabs" && elevenLabsAvailable) return "elevenlabs";
    if (saved === "device") return "device";
    if (elevenLabsAvailable) return "elevenlabs";
    return "device";
  }

  /* ---------- Download (ElevenLabs MP3) ---------- */

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

  function triggerBlobDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    // iOS Safari often ignores <a download> — open blob in a new tab so Cap can Share/Save
    var isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) {
      var opened = null;
      try {
        opened = window.open(url, "_blank");
      } catch (e) {}
      if (!opened) {
        // Popup blocked: fall through to anchor click
        var aIos = document.createElement("a");
        aIos.href = url;
        aIos.target = "_blank";
        aIos.rel = "noopener";
        aIos.style.display = "none";
        document.body.appendChild(aIos);
        try {
          aIos.click();
        } catch (e2) {}
        setTimeout(function () {
          try {
            document.body.removeChild(aIos);
          } catch (e3) {}
        }, 1000);
      }
    } else {
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      try {
        a.click();
      } catch (e4) {
        try {
          window.open(url, "_blank");
        } catch (e5) {}
      }
      setTimeout(function () {
        try {
          document.body.removeChild(a);
        } catch (e6) {}
      }, 1000);
    }
    setTimeout(function () {
      try {
        URL.revokeObjectURL(url);
      } catch (e7) {}
    }, 60000);
  }

  function askFilename(defaultName) {
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
    if (mode !== "elevenlabs" || !elevenLabsAvailable) {
      setDownloadStatus("Download needs ElevenLabs — switch source above.", "muted");
      return;
    }
    var text = textEl.value.trim();
    var voiceId = voiceEl.value;
    if (!text || !voiceId) {
      setDownloadStatus("Add text and pick a voice first.", "muted");
      return;
    }
    if (text.length > MAX_TTS_CHARS) {
      setDownloadStatus(
        "Text too long (max " + MAX_TTS_CHARS + " characters).",
        "error"
      );
      return;
    }

    var suggested = sanitizeFilename(suggestDownloadName(text));
    askFilename(suggested.replace(/\.mp3$/i, "")).then(function (filename) {
      if (!filename) {
        setDownloadStatus("");
        return;
      }
      filename = sanitizeFilename(filename);
      downloading = true;
      setControls();
      setDownloadStatus("Downloading…", "muted");

      fetchTts(text, voiceId)
        .then(function (blob) {
          triggerBlobDownload(blob, filename);
          downloading = false;
          setControls();
          setDownloadStatus("Saved · " + filename, "ok");
        })
        .catch(function (err) {
          downloading = false;
          setControls();
          setDownloadStatus(
            (err && err.message) || "Download failed — try again.",
            "error"
          );
        });
    });
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
    if (mode === "elevenlabs") {
      if (isPaused && audioEl && audioEl.src) {
        playEleven(text);
        return;
      }
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
    speakWebSpeech(text, true);
  }

  function pause() {
    if (mode === "elevenlabs") {
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
    if (mode === "elevenlabs") {
      stopEleven();
      return;
    }
    stopWebSpeech();
  }

  function previewVoice() {
    if (mode === "elevenlabs") {
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

  function fetchElevenVoices() {
    return fetch("/api/voices", { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (res.status === 503) {
          throw new Error("ElevenLabs not configured on the server (missing API key).");
        }
        if (!res.ok) {
          throw new Error("ElevenLabs voices unavailable (API error " + res.status + ").");
        }
        return res.json();
      })
      .then(function (data) {
        var list = (data && data.voices) || [];
        if (!list.length) {
          throw new Error("ElevenLabs returned no voices.");
        }
        elVoices = list;
        elevenLabsAvailable = true;
        elUnavailableReason = "";
      });
  }

  function markElevenUnavailable(err) {
    elevenLabsAvailable = false;
    elVoices = [];
    var msg =
      (err && err.message) ||
      "ElevenLabs unavailable — using device voices.";
    elUnavailableReason = msg;
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

    if (sourceElBtn) {
      sourceElBtn.addEventListener("click", function () {
        if (!elevenLabsAvailable || mode === "elevenlabs") return;
        applySource("elevenlabs", true);
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

    fetchElevenVoices()
      .catch(function (err) {
        markElevenUnavailable(err);
      })
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
