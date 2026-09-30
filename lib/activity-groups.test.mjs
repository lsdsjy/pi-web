import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  activityBucketFor,
  groupByActivity,
  layoutGroupedRows,
  visibleActivityRowIndices,
  visibleListRowIndices,
} = await jiti.import("./activity-groups.ts");

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

test("lays out header and item rows and windows them by viewport", () => {
  const groups = groupByActivity(
    Array.from({ length: 50 }, (_, index) => ({ id: String(index), modified: new Date(2025, 5, 15, 9, 59 - index).toISOString() })),
    (item) => item.modified,
    now,
  );
  const { rows, totalHeight } = layoutGroupedRows(
    groups.map((group) => ({ key: group.key, header: group.bucket, items: group.items })),
    (item) => item.id,
    28,
    54,
  );
  assert.equal(rows.length, 51);
  assert.equal(totalHeight, 28 + 50 * 54);
  assert.equal(rows[1].top, 28);
  const visible = visibleActivityRowIndices(rows, 1000, 300, 0);
  assert.ok(visible.length > 0 && visible.length <= 8);
  for (const index of visible) {
    assert.ok(rows[index].top + rows[index].height >= 1000 && rows[index].top <= 1300);
  }
});

test("groups without a header add no row and header heights can be overridden", () => {
  const { rows, totalHeight } = layoutGroupedRows(
    [
      { key: "pinned", header: { kind: "pinned" }, items: [{ id: "p" }] },
      { key: "rest", header: { kind: "separator" }, headerHeight: 9, items: [{ id: "a" }, { id: "b" }] },
      { key: "tail", header: null, items: [{ id: "c" }] },
    ],
    (item) => item.id,
    28,
    54,
  );
  assert.deepEqual(rows.map((row) => row.key), ["h:pinned", "p", "h:rest", "a", "b", "c"]);
  assert.deepEqual(rows.map((row) => row.top), [0, 28, 82, 91, 145, 199]);
  assert.equal(totalHeight, 253);
});

test("keeps a focused row mounted while it is scrolled out of the window", () => {
  const { rows } = layoutGroupedRows(
    [{ key: "all", header: null, items: Array.from({ length: 2000 }, (_, index) => ({ id: String(index) })) }],
    (item) => item.id,
    28,
    54,
  );
  for (const [scrollTop, focused] of [[0, "1999"], [10000, "0"]]) {
    const indices = visibleListRowIndices(rows, scrollTop, 335, focused);
    const firstVisible = Math.floor(scrollTop / 54);
    const lastVisible = Math.ceil((scrollTop + 335) / 54) - 1;
    for (let index = firstVisible; index <= lastVisible; index++) assert.ok(indices.includes(index));
    assert.ok(indices.includes(Number(focused)));
    assert.equal(new Set(indices).size, indices.length);
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
    assert.ok(indices.length < 40);
  }
  const blurred = visibleListRowIndices(rows, 10000, 335, null);
  assert.ok(!blurred.includes(0));
  assert.deepEqual(visibleListRowIndices(rows, 0, 335, "missing"), visibleListRowIndices(rows, 0, 335));
  assert.deepEqual(visibleListRowIndices([], 80000, 335, "0"), []);
});
