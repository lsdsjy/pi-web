import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { activityBucketFor, groupByActivity } = await jiti.import("./activity-groups.ts");

const now = new Date(2025, 5, 15, 10, 0); // Sun 15 Jun 2025, 10:00 local

test("buckets by local calendar day, not 24h windows", () => {
  assert.equal(activityBucketFor(new Date(2025, 5, 15, 0, 1), now).kind, "today");
  assert.equal(activityBucketFor(new Date(2025, 5, 14, 23, 59), now).kind, "yesterday");
  assert.equal(activityBucketFor(new Date(2025, 5, 13, 1, 0), now).kind, "dayBeforeYesterday");
  assert.equal(activityBucketFor(new Date(2025, 5, 9), now).kind, "thisWeek");
  assert.equal(activityBucketFor(new Date(2025, 5, 8), now).kind, "last30Days");
  assert.deepEqual(activityBucketFor(new Date(2025, 3, 2), now), { kind: "month", year: 2025, month: 3 });
  // Clock skew (future timestamps) counts as today.
  assert.equal(activityBucketFor(new Date(2025, 5, 16), now).kind, "today");
});

test("sorts newest first and groups consecutive buckets", () => {
  const items = [
    { id: "old", modified: new Date(2025, 2, 1).toISOString() },
    { id: "today", modified: new Date(2025, 5, 15, 9).toISOString() },
    { id: "yesterday", modified: new Date(2025, 5, 14, 9).toISOString() },
    { id: "today-later", modified: new Date(2025, 5, 15, 9, 30).toISOString() },
    { id: "bad", modified: "not a date" },
  ];
  const groups = groupByActivity(items, (item) => item.modified, now);
  assert.deepEqual(groups.map((group) => group.key), ["today", "yesterday", "month:2025-2", "month:1970-0"]);
  assert.deepEqual(groups[0].items.map((item) => item.id), ["today-later", "today"]);
});
