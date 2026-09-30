import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { archivePathFor } = await jiti.import("./session-archive.ts");

const sessions = "/agent/sessions";
const archive = "/agent/sessions-archive";

test("keeps the per-cwd folder for files inside the sessions dir", () => {
  assert.equal(
    archivePathFor(join(sessions, "--Users-me--", "a.jsonl"), sessions, archive, () => false),
    join(archive, "--Users-me--", "a.jsonl"),
  );
});

test("files outside the sessions dir keep their parent folder name", () => {
  assert.equal(
    archivePathFor("/elsewhere/project/b.jsonl", sessions, archive, () => false),
    join(archive, "project", "b.jsonl"),
  );
});

test("never overwrites an existing archived file", () => {
  const taken = new Set([join(archive, "d", "c.jsonl"), join(archive, "d", "c.1.jsonl")]);
  assert.equal(
    archivePathFor(join(sessions, "d", "c.jsonl"), sessions, archive, (path) => taken.has(path)),
    join(archive, "d", "c.2.jsonl"),
  );
});
