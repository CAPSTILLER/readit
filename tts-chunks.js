/**
 * Readit text chunking for Google Cloud Text-to-Speech.
 *
 * Google rejects any synthesize request whose input is over 5,000 bytes
 * (UTF-8 bytes, not characters). splitText() cuts text on sentence
 * boundaries into pieces of at most maxBytes (default 4,500), falling back
 * to clause punctuation, then spaces, then a hard UTF-8-safe cut for a run
 * with no break at all. No chunk is ever empty.
 *
 * Used by api/_google.js (server: per-request chunks) and app.js (browser:
 * splits very long text into a few requests so each MP3 response stays
 * under Vercel's 4.5 MB body limit). UMD: window.ReaditChunks / module.exports.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ReaditChunks = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULT_MAX_BYTES = 4500;

  /** UTF-8 byte length without TextEncoder/Buffer (works everywhere). */
  function utf8Bytes(str) {
    var s = String(str == null ? "" : str);
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          n += 4;
          i++;
        } else n += 3;
      } else n += 3;
    }
    return n;
  }

  /**
   * Sentences (with their trailing punctuation/quotes), split at . ! ? …
   * followed by whitespace, and at line breaks. Whitespace is collapsed.
   */
  function splitSentences(text) {
    var out = [];
    var paras = String(text == null ? "" : text).split(/\n+/);
    for (var p = 0; p < paras.length; p++) {
      var para = paras[p].replace(/\s+/g, " ").trim();
      if (!para) continue;
      var last = 0;
      var m;
      // Walk sentence-ending punctuation that is followed by space or end.
      var endRe = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
      while ((m = endRe.exec(para))) {
        var end = m.index + m[0].length;
        var s = para.slice(last, end).trim();
        if (s) out.push(s);
        last = end;
      }
      var rest = para.slice(last).trim();
      if (rest) out.push(rest);
    }
    return out;
  }

  /** Hard cut by bytes without splitting a surrogate pair. */
  function hardSplit(str, maxBytes) {
    var out = [];
    var cur = "";
    var curBytes = 0;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var c = str.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        ch += str.charAt(i + 1);
        i++;
      }
      var b = utf8Bytes(ch);
      if (curBytes + b > maxBytes && cur) {
        out.push(cur);
        cur = "";
        curBytes = 0;
      }
      cur += ch;
      curBytes += b;
    }
    if (cur) out.push(cur);
    return out;
  }

  /** Pack pieces (joined by a space) into runs of at most maxBytes. */
  function pack(pieces, maxBytes) {
    var out = [];
    var cur = "";
    for (var i = 0; i < pieces.length; i++) {
      var piece = pieces[i].trim();
      if (!piece) continue;
      var next = cur ? cur + " " + piece : piece;
      if (utf8Bytes(next) <= maxBytes) {
        cur = next;
      } else {
        if (cur) out.push(cur);
        cur = piece;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  /** Break one over-long sentence: clauses, then words, then hard cut. */
  function splitLong(sentence, maxBytes) {
    if (utf8Bytes(sentence) <= maxBytes) return [sentence];
    // No lookbehind: older iOS Safari can't parse it.
    var clauses = sentence.replace(/([,;:—–])\s+/g, "$1\u0000").split("\u0000");
    var out = [];
    var packed = pack(clauses, maxBytes);
    for (var i = 0; i < packed.length; i++) {
      if (utf8Bytes(packed[i]) <= maxBytes) {
        out.push(packed[i]);
        continue;
      }
      var words = pack(packed[i].split(/\s+/), maxBytes);
      for (var j = 0; j < words.length; j++) {
        if (utf8Bytes(words[j]) <= maxBytes) out.push(words[j]);
        else out = out.concat(hardSplit(words[j], maxBytes));
      }
    }
    return out;
  }

  /**
   * Split text into non-empty chunks of at most maxBytes UTF-8 bytes,
   * keeping whole sentences together whenever they fit.
   */
  function splitText(text, maxBytes) {
    maxBytes = maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES;
    var sentences = splitSentences(text);
    var pieces = [];
    for (var i = 0; i < sentences.length; i++) {
      pieces = pieces.concat(splitLong(sentences[i], maxBytes));
    }
    return pack(pieces, maxBytes).filter(function (c) {
      return c.trim().length > 0;
    });
  }

  return {
    DEFAULT_MAX_BYTES: DEFAULT_MAX_BYTES,
    utf8Bytes: utf8Bytes,
    splitSentences: splitSentences,
    splitText: splitText,
  };
});
