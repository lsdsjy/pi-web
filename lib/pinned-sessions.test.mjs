import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  MAX_PINNED_SESSIONS,
  parsePinnedSessionIds,
  prunePinnedSessionIds,
  sanitizePinnedSessionIds,
  setSessionPinned,
  splitPinned,
} = await jiti.import("./pinned-sessions.ts");

test("pinning moves the id to the front and unpinning removes it", () => {
  assert.deepEqual(setSessionPinned([], "a", true), ["a"]);
  assert.deepEqual(setSessionPinned(["a", "b"], "c", true), ["c", "a", "b"]);
  assert.deepEqual(setSessionPinned(["a", "b", "c"], "c", true), ["c", "a", "b"]);
  assert.deepEqual(setSessionPinned(["a", "b"], "a", false), ["b"]);
  assert.deepEqual(setSessionPinned(["a", "b"], "z", false), ["a", "b"]);
});

test("pinning past the cap drops the oldest pin", () => {
  const full = Array.from({ length: MAX_PINNED_SESSIONS }, (_, i) => `s${i}`);
  const next = setSessionPinned(full, "new", true);
  assert.equal(next.length, MAX_PINNED_SESSIONS);
  assert.equal(next[0], "new");
  assert.ok(!next.includes(`s${MAX_PINNED_SESSIONS - 1}`));
});

test("splits pinned items in pin order and keeps the rest in list order", () => {
  const items = ["a", "b", "c", "d"].map((id) => ({ id }));
  const { pinned, rest } = splitPinned(items, ["d", "missing", "b"], (item) => item.id);
  assert.deepEqual(pinned.map((item) => item.id), ["d", "b"]);
  assert.deepEqual(rest.map((item) => item.id), ["a", "c"]);
  assert.deepEqual(splitPinned(items, [], (item) => item.id).rest, items);
});

test("prunes ids that no longer name a listed session", () => {
  const ids = ["a", "gone", "b"];
  assert.deepEqual(prunePinnedSessionIds(ids, new Set(["a", "b"])), ["a", "b"]);
  assert.equal(prunePinnedSessionIds(ids, new Set(["a", "b", "gone"])), ids);
});

test("request bodies are validated strictly, stored files leniently", () => {
  assert.deepEqual(parsePinnedSessionIds(["a", "b", "a"]), ["a", "b"]);
  assert.deepEqual(parsePinnedSessionIds([]), []);
  assert.equal(parsePinnedSessionIds("a"), null);
  assert.equal(parsePinnedSessionIds(["a", 1]), null);
  assert.equal(parsePinnedSessionIds([" "]), null);
  assert.equal(parsePinnedSessionIds(["x".repeat(257)]), null);
  assert.equal(parsePinnedSessionIds(Array.from({ length: MAX_PINNED_SESSIONS + 1 }, (_, i) => `s${i}`)), null);

  assert.deepEqual(sanitizePinnedSessionIds(["a", 1, "", "a", "b"]), ["a", "b"]);
  assert.deepEqual(sanitizePinnedSessionIds({ sessionIds: ["a"] }), []);
  assert.deepEqual(sanitizePinnedSessionIds(undefined), []);
});
