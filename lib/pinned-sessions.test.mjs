import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  MAX_PINNED_SESSIONS,
  isValidSessionId,
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

test("session ids are validated, stored files are read leniently", () => {
  assert.equal(isValidSessionId("a"), true);
  assert.equal(isValidSessionId(1), false);
  assert.equal(isValidSessionId(" "), false);
  assert.equal(isValidSessionId("x".repeat(257)), false);

  assert.deepEqual(sanitizePinnedSessionIds(["a", 1, "", "a", "b"]), ["a", "b"]);
  assert.deepEqual(sanitizePinnedSessionIds({ sessionIds: ["a"] }), []);
  assert.deepEqual(sanitizePinnedSessionIds(undefined), []);
});
