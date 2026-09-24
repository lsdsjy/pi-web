import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionOutline, OUTLINE_PREVIEW_MAX_CHARS } = await jiti.import("./session-outline.ts");

/** Minimal entry helper: only the fields the outline reads. */
function entry(id, parentId, message, timestamp = "2026-01-01T00:00:00.000Z") {
  return { type: "message", id, parentId, timestamp, message };
}

const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const assistant = (blocks = []) => ({ role: "assistant", content: blocks });
const toolCall = { type: "toolCall", toolCallId: "t", toolName: "bash", input: {} };

test("collects one turn per anchor along the active branch", () => {
  const entries = [
    entry("a", null, user("first")),
    entry("b", "a", assistant([toolCall])),
    entry("c", "b", assistant()),
    entry("d", "c", user("second")),
    entry("e", "d", assistant([toolCall, toolCall])),
  ];

  const outline = buildSessionOutline(entries, "e");
  assert.equal(outline.leafId, "e");
  assert.equal(outline.total, 2);
  assert.deepEqual(outline.turns.map((t) => [t.entryId, t.preview, t.assistantCount, t.toolCount]), [
    ["a", "first", 2, 1],
    ["d", "second", 1, 2],
  ]);
});

test("follows parentId, so a branch ignores entries off it", () => {
  const entries = [
    entry("a", null, user("kept")),
    entry("b", "a", assistant()),
    entry("off1", "a", user("abandoned")),
    entry("off2", "off1", assistant()),
  ];

  const outline = buildSessionOutline(entries, "b");
  assert.deepEqual(outline.turns.map((t) => t.entryId), ["a"]);
});

test("treats compaction and subagent notifications as anchors", () => {
  const entries = [
    entry("a", null, user("prompt")),
    entry("b", "a", assistant()),
    entry("c", "b", { role: "custom", customType: "compaction", content: [] }),
    entry("d", "c", assistant()),
    entry("e", "d", { role: "custom", customType: "pi-web:subagent-notification", content: [] }),
  ];

  const outline = buildSessionOutline(entries, "e");
  assert.deepEqual(outline.turns.map((t) => [t.entryId, t.preview]), [
    ["a", "prompt"],
    ["c", "compaction"],
    ["e", "subagent"],
  ]);
});

test("skips assistant entries that precede the first anchor", () => {
  const entries = [
    entry("a", null, assistant()),
    entry("b", "a", user("real start")),
  ];
  const outline = buildSessionOutline(entries, "b");
  assert.deepEqual(outline.turns.map((t) => t.entryId), ["b"]);
});

test("flattens and caps the preview instead of shipping whole prompts", () => {
  const long = `line one\n\nline two   ${"x".repeat(400)}`;
  const outline = buildSessionOutline([entry("a", null, user(long))], "a");
  const preview = outline.turns[0].preview;
  assert.equal(preview.length, OUTLINE_PREVIEW_MAX_CHARS);
  assert.ok(!preview.includes("\n"));
  assert.ok(preview.endsWith("…"));
});

test("an empty session yields no turns and no leaf", () => {
  const outline = buildSessionOutline([], null);
  assert.deepEqual(outline, { leafId: null, total: 0, truncated: false, turns: [] });
});
