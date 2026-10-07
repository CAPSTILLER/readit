// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../clips.js");

function fakeStore() {
  const made = [];
  const revoked = [];
  let n = 0;
  const store = C.createClipStore({
    createUrl: () => { const u = "blob:fake/" + ++n; made.push(u); return u; },
    revokeUrl: (u) => revoked.push(u),
  });
  return { store, made, revoked };
}

const mp3 = (bytes) => new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" });

test("key depends on voice, speed and exact text", () => {
  const a = C.clipKey("elevenlabs", "v1", 1, "hello");
  assert.equal(a, C.clipKey("elevenlabs", "v1", "1.0", "hello"));
  assert.notEqual(a, C.clipKey("elevenlabs", "v2", 1, "hello"));
  assert.notEqual(a, C.clipKey("elevenlabs", "v1", 1.1, "hello"));
  assert.notEqual(a, C.clipKey("elevenlabs", "v1", 1, "hello!"));
  assert.notEqual(a, C.clipKey("device", "v1", 1, "hello"));
});

test("same text+voice+speed reuses the clip: fetcher runs once", async () => {
  const { store } = fakeStore();
  let calls = 0;
  const fetcher = async () => { calls++; return mp3(32000); };
  const meta = { key: C.clipKey("elevenlabs", "v1", 1, "hi"), text: "hi", voiceId: "v1", voiceName: "Rachel", rate: 1 };
  const r1 = await store.getOrFetch(meta, fetcher);
  const r2 = await store.getOrFetch(meta, fetcher);
  assert.equal(calls, 1);
  assert.equal(r1.cached, false);
  assert.equal(r2.cached, true);
  assert.equal(r1.clip, r2.clip);
  assert.equal(r1.clip.duration, 2); // 32,000 bytes at 128 kbps
  assert.equal(r1.clip.exportable, true);
});

test("double tap while fetching shares one request", async () => {
  const { store } = fakeStore();
  let calls = 0;
  const fetcher = () => new Promise((res) => { calls++; setTimeout(() => res(mp3(10)), 10); });
  const meta = { key: "k", text: "t", voiceId: "v", rate: 1 };
  const [a, b] = await Promise.all([store.getOrFetch(meta, fetcher), store.getOrFetch(meta, fetcher)]);
  assert.equal(calls, 1);
  assert.equal(a.clip, b.clip);
  assert.equal(store.list().length, 1);
});

test("failed fetch is not cached; retry calls again", async () => {
  const { store } = fakeStore();
  let calls = 0;
  const meta = { key: "k", text: "t", voiceId: "v", rate: 1 };
  await assert.rejects(store.getOrFetch(meta, async () => { calls++; throw new Error("402"); }));
  await store.getOrFetch(meta, async () => { calls++; return mp3(5); });
  assert.equal(calls, 2);
  assert.equal(store.size(), 1);
});

test("list is newest first, numbered, hides voice samples; filenames", async () => {
  const { store } = fakeStore();
  store.add({ key: "a", text: "first", voiceName: "Rachel", blob: mp3(1) });
  store.add({ key: "s", text: "sample", voiceName: "Adam", blob: mp3(1), hidden: true });
  store.add({ key: "b", text: "second", voiceName: "Brian Deep", blob: mp3(1) });
  const l = store.list();
  assert.deepEqual(l.map((c) => c.text), ["second", "first"]);
  assert.equal(C.clipFilename(l[0]), "readit-brian-deep-2.mp3");
  assert.equal(C.clipFilename(l[1]), "readit-rachel-1.mp3");
  assert.ok(store.has("s"));
});

test("device clips have no blob and are not exportable", () => {
  const { store, made } = fakeStore();
  const c = store.add({ key: "d", text: "x", voiceName: "Google US", source: "device" });
  assert.equal(c.exportable, false);
  assert.equal(c.url, null);
  assert.equal(made.length, 0);
});

test("revokeAll revokes every URL and empties the session", async () => {
  const { store, made, revoked } = fakeStore();
  store.add({ key: "a", text: "1", blob: mp3(1) });
  store.add({ key: "b", text: "2", blob: mp3(1), hidden: true });
  store.revokeAll();
  assert.deepEqual(revoked.sort(), made.sort());
  assert.equal(store.size(), 0);
  assert.equal(store.list().length, 0);
});

test("a fetch that lands after Clear all is not kept", async () => {
  const { store } = fakeStore();
  let release;
  const p = store.getOrFetch({ key: "k", text: "t", rate: 1 }, () => new Promise((r) => (release = r)));
  await new Promise((r) => setTimeout(r, 0));
  store.revokeAll();
  release(mp3(3));
  const { clip } = await p;
  assert.equal(clip.detached, true);
  assert.equal(store.size(), 0);
});

test("formatDuration / previewText", () => {
  assert.equal(C.formatDuration(0), "");
  assert.equal(C.formatDuration(4.4), "0:04");
  assert.equal(C.formatDuration(75), "1:15");
  assert.equal(C.previewText("short"), "short");
  const long = "word ".repeat(40);
  const p = C.previewText(long, 30);
  assert.ok(p.length <= 30 && p.endsWith("…"));
});
