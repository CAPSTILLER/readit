(function () {
  "use strict";

  var STORAGE_KEY = "readit-voice-uri";
  var RATE_KEY = "readit-rate";

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
  var utterance = null;
  var isPaused = false;
  var speaking = false;

  function speechAvailable() {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  }

  function updateCounts() {
    var raw = textEl.value;
    var trimmed = raw.trim();
    var words = trimmed ? trimmed.split(/\s+/).length : 0;
    var chars = raw.length;
    countsEl.textContent = words + " word" + (words === 1 ? "" : "s") + " · " + chars + " character" + (chars === 1 ? "" : "s");
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

  function voiceLabel(v) {
    var name = v.name || "Voice";
    var lang = v.lang || "";
    var local = v.localService ? "" : " · online";
    return name + (lang ? " (" + lang + ")" : "") + local;
  }

  function langGroup(lang) {
    if (!lang) return "Other";
    var parts = lang.replace("_", "-").split("-");
    return parts[0].toLowerCase() === "en"
      ? lang
      : parts[0].toUpperCase() + (parts[1] ? "-" + parts[1].toUpperCase() : "");
  }

  function populateVoices() {
    if (!speechAvailable()) return;

    voices = window.speechSynthesis.getVoices() || [];
    var saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (e) {}

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

    var groups = {};
    var order = [];
    voices.forEach(function (v, i) {
      var g = langGroup(v.lang);
      if (!groups[g]) {
        groups[g] = [];
        order.push(g);
      }
      groups[g].push({ voice: v, index: i });
    });

    order.sort(function (a, b) {
      var ae = a.toLowerCase().indexOf("en") === 0 ? 0 : 1;
      var be = b.toLowerCase().indexOf("en") === 0 ? 0 : 1;
      if (ae !== be) return ae - be;
      return a.localeCompare(b);
    });

    var selectedIndex = -1;
    order.forEach(function (g) {
      var og = document.createElement("optgroup");
      og.label = g;
      groups[g]
        .sort(function (a, b) {
          return (a.voice.name || "").localeCompare(b.voice.name || "");
        })
        .forEach(function (item) {
          var o = document.createElement("option");
          o.value = String(item.index);
          o.textContent = voiceLabel(item.voice);
          if (saved && (item.voice.voiceURI === saved || item.voice.name === saved)) {
            selectedIndex = item.index;
          }
          og.appendChild(o);
        });
      voiceEl.appendChild(og);
    });

    if (selectedIndex >= 0) {
      voiceEl.value = String(selectedIndex);
    } else {
      var preferred =
        voices.findIndex(function (v) {
          return /en-?US/i.test(v.lang) && /google|samantha|aaron|daniel|karen|moira/i.test(v.name);
        });
      if (preferred < 0) {
        preferred = voices.findIndex(function (v) {
          return /en/i.test(v.lang);
        });
      }
      voiceEl.value = String(preferred >= 0 ? preferred : 0);
    }

    voiceEl.disabled = false;
    setControls();
  }

  function selectedVoice() {
    var idx = parseInt(voiceEl.value, 10);
    if (isNaN(idx) || idx < 0 || idx >= voices.length) return null;
    return voices[idx];
  }

  function saveVoice() {
    var v = selectedVoice();
    if (!v) return;
    try {
      localStorage.setItem(STORAGE_KEY, v.voiceURI || v.name);
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
    window.speechSynthesis.cancel();
    clearUtterance();
  }

  function play() {
    if (!speechAvailable()) return;
    var text = textEl.value.trim();
    if (!text) return;

    // Safari / Chrome: resume after pause
    if (isPaused) {
      window.speechSynthesis.resume();
      isPaused = false;
      speaking = true;
      setControls();
      return;
    }

    // Fresh start — cancel any leftover queue (Safari quirk)
    window.speechSynthesis.cancel();

    utterance = new SpeechSynthesisUtterance(text);
    var v = selectedVoice();
    if (v) utterance.voice = v;
    utterance.rate = parseFloat(rateEl.value) || 1;
    utterance.pitch = 1;

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
    // Must be called from a user gesture on first speak (Safari / iOS)
    window.speechSynthesis.speak(utterance);
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
    populateVoices();

    // Voices often load asynchronously (Chrome, Safari)
    if (typeof window.speechSynthesis.addEventListener === "function") {
      window.speechSynthesis.addEventListener("voiceschanged", populateVoices);
    } else {
      window.speechSynthesis.onvoiceschanged = populateVoices;
    }
    // Extra poll for stubborn Safari / older WebKit
    var tries = 0;
    var poll = setInterval(function () {
      tries += 1;
      populateVoices();
      if (voices.length || tries > 20) clearInterval(poll);
    }, 250);

    textEl.addEventListener("input", function () {
      updateCounts();
      setControls();
    });
    voiceEl.addEventListener("change", saveVoice);
    rateEl.addEventListener("input", function () {
      updateRateLabel();
      saveRate();
    });

    playBtn.addEventListener("click", play);
    pauseBtn.addEventListener("click", pause);
    stopBtn.addEventListener("click", stopSpeaking);

    // Page hide: stop so audio doesn't leak across tabs on mobile
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
