/**
 * The sidebar's activity view (lib/session-tree.ts): buckets items by local
 * calendar day of their latest activity (today / yesterday / the day before /
 * earlier this week / last 30 days / one bucket per older month).
 */

export type ActivityBucket =
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "dayBeforeYesterday" }
  | { kind: "thisWeek" }
  | { kind: "last30Days" }
  | { kind: "month"; year: number; month: number };

export interface ActivityGroup<T> {
  key: string;
  bucket: ActivityBucket;
  items: T[];
}

const DAY_MS = 86_400_000;

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole local calendar days between `date` and `now` (0 = same day). */
function calendarDaysAgo(date: Date, now: Date): number {
  return Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / DAY_MS);
}

export function activityBucketFor(date: Date, now: Date): ActivityBucket {
  const days = calendarDaysAgo(date, now);
  if (days <= 0) return { kind: "today" };
  if (days === 1) return { kind: "yesterday" };
  if (days === 2) return { kind: "dayBeforeYesterday" };
  if (days < 7) return { kind: "thisWeek" };
  if (days < 30) return { kind: "last30Days" };
  return { kind: "month", year: date.getFullYear(), month: date.getMonth() };
}

/** A bucket's stable key: its kind, or the month for older ones. */
export function activityBucketKey(bucket: ActivityBucket): string {
  return bucket.kind === "month" ? `month:${bucket.year}-${bucket.month}` : bucket.kind;
}

/**
 * Sorts items newest first and splits them into consecutive activity groups.
 * Items with an unparsable timestamp land in the oldest position.
 */
export function groupByActivity<T>(
  items: readonly T[],
  getModified: (item: T) => string,
  now: Date = new Date(),
): ActivityGroup<T>[] {
  const withTime = items.map((item) => {
    const time = new Date(getModified(item)).getTime();
    return { item, time: Number.isFinite(time) ? time : 0 };
  });
  withTime.sort((a, b) => b.time - a.time);

  const groups: ActivityGroup<T>[] = [];
  for (const { item, time } of withTime) {
    const bucket = activityBucketFor(new Date(time), now);
    const key = activityBucketKey(bucket);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, bucket, items: [item] });
  }
  return groups;
}
