(function () {
  "use strict";

  var STORAGE_KEY = "readit-voice-uri";
  var RATE_KEY = "readit-rate";
  var PREVIEW =
    "Hey Cap. This is how I sound with the voice you picked.";

  var textEl = document.getElementById("text");
  var voiceEl = document.getElementById("voice");
  var rateEl = document.getElementById("rate");
  var rateValueEl = document.getElementById("rate-value");
  var countsEl = document.getElementById("counts");
  var playBtn = document.getElementById("play");
  var pauseBtn = document.getElementById("pause");
  var stopBtn = document.getElementById("stop");
  var unsupportedEl = document.getElementById("unsupported");

  var voices = [];
  var voicesFingerprint = "";
  var utterance = null;
  var isPaused = false;
  var speaking = false;
  var speakTimer = null;

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
    var hasVoices = voices.length > 0;
    playBtn.disabled = !speechAvailable() || !hasText || !hasVoices;
    pauseBtn.disabled = !speaking;
    stopBtn.disabled = !speaking && !isPaused;
    playBtn.textContent = isPaused ? "Resume" : "Play";
  }

  /** Higher = more natural / preferred for Cap */
  function voiceQuality(v) {
    var n = (v.name || "").toLowerCase();
    var lang = (v.lang || "").toLowerCase();
    var score = 0;
    if (/^en/.test(lang)) score += 50;
    if (/en-us|en_us/.test(lang)) score += 10;
    // Neural / enhanced / premium system voices
    if (/neural|natural|enhanced|premium|wavenet|studio|journey|news|polyglot/i.test(n))
      score += 80;
    if (/google/.test(n)) score += 60;
    if (/microsoft/.test(n) && /online|natural|neural/.test(n)) score += 55;
    if (/samantha|aaron|nicky|susan|tom|moira|karen|daniel|fiona|tessa|rishi|martha|gordon/i.test(n))
      score += 40;
    if (v.localService) score += 5;
    // Demote classic robotic compact voices
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

  function populateVoices(force) {
    if (!speechAvailable()) return;

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

  function selectedVoice() {
    var key = voiceEl.value;
    if (!key) return null;
    for (var i = 0; i < voices.length; i++) {
      if (voiceKey(voices[i]) === key) return voices[i];
    }
    return null;
  }

  function saveVoice() {
    var v = selectedVoice();
    if (!v) return;
    try {
      localStorage.setItem(STORAGE_KEY, voiceKey(v));
    } catch (e) {}
  }

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

  function clearUtterance() {
    utterance = null;
    speaking = false;
    isPaused = false;
    setControls();
  }

  function stopSpeaking() {
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
    // Chrome often ignores .voice unless .lang matches
    try {
      utt.voice = v;
    } catch (e) {}
    if (v.lang) utt.lang = v.lang;
  }

  function speakText(text, fromGesture) {
    if (!speechAvailable()) return;
    if (!text) return;

    if (speakTimer) {
      clearTimeout(speakTimer);
      speakTimer = null;
    }

    // Cancel leftover queue (Safari / Chrome quirks)
    window.speechSynthesis.cancel();

    function start() {
      utterance = new SpeechSynthesisUtterance(text);
      var v = selectedVoice();
      applyVoice(utterance, v);
      utterance.rate = parseFloat(rateEl.value) || 1;
      // Slight pitch can soften some robotic system voices
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

      // Chrome bug: sometimes needs a kick if paused internally
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }

    // After cancel(), Chrome needs a beat before speak() or the voice sticks to default
    if (fromGesture) {
      speakTimer = setTimeout(start, 60);
    } else {
      start();
    }
  }

  function play() {
    if (!speechAvailable()) return;
    var text = textEl.value.trim();
    if (!text) return;

    if (isPaused) {
      window.speechSynthesis.resume();
      isPaused = false;
      speaking = true;
      setControls();
      return;
    }

    speakText(text, true);
  }

  function previewVoice() {
    saveVoice();
    // Short sample so Cap hears the change immediately
    speakText(PREVIEW, true);
  }

  function pause() {
    if (!speechAvailable() || !speaking) return;
    window.speechSynthesis.pause();
    isPaused = true;
    speaking = false;
    setControls();
  }

  function init() {
    if (!speechAvailable()) {
      unsupportedEl.hidden = false;
      playBtn.disabled = true;
      pauseBtn.disabled = true;
      stopBtn.disabled = true;
      voiceEl.disabled = true;
      voiceEl.innerHTML = '<option value="">Unavailable</option>';
      return;
    }

    loadRate();
    populateVoices(true);

    if (typeof window.speechSynthesis.addEventListener === "function") {
      window.speechSynthesis.addEventListener("voiceschanged", function () {
        populateVoices(false);
      });
    } else {
      window.speechSynthesis.onvoiceschanged = function () {
        populateVoices(false);
      };
    }

    var tries = 0;
    var poll = setInterval(function () {
      tries += 1;
      populateVoices(false);
      if (voices.length || tries > 20) clearInterval(poll);
    }, 250);

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

    document.addEventListener("visibilitychange", function () {
      if (document.hidden && (speaking || isPaused)) {
        stopSpeaking();
      }
    });

    updateCounts();
    setControls();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
