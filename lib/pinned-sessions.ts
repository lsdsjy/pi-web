/**
 * Pinned sessions: a most-recently-pinned-first list of session family root
 * ids, shown above the sidebar's session list regardless of workspace.
 *
 * Pure helpers shared by the sidebar and the `/api/sessions/pinned` route.
 * The server-side file IO lives in `pinned-sessions-store.ts`.
 */

export const MAX_PINNED_SESSIONS = 500;
export const MAX_PINNED_SESSION_ID_LENGTH = 256;

function isValidSessionId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= MAX_PINNED_SESSION_ID_LENGTH;
}

/**
 * Strict validation for request bodies: `null` unless `value` is an array of
 * at most `MAX_PINNED_SESSIONS` non-empty id strings. Duplicates are dropped,
 * keeping the first (most recently pinned) occurrence.
 */
export function parsePinnedSessionIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_PINNED_SESSIONS) return null;
  if (!value.every(isValidSessionId)) return null;
  return [...new Set(value)];
}

/**
 * Lenient reading of the stored file: keeps the valid ids, drops everything
 * else, so a hand-edited or damaged file never hides every pin.
 */
export function sanitizePinnedSessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isValidSessionId))].slice(0, MAX_PINNED_SESSIONS);
}

/** Pinning moves `id` to the front; unpinning removes it. */
export function setSessionPinned(ids: readonly string[], id: string, pinned: boolean): string[] {
  const rest = ids.filter((existing) => existing !== id);
  return pinned ? [id, ...rest].slice(0, MAX_PINNED_SESSIONS) : rest;
}

/** Drops ids that no longer name a listed session. Returns `ids` itself when nothing changed. */
export function prunePinnedSessionIds<T extends readonly string[]>(ids: T, knownIds: ReadonlySet<string>): T | string[] {
  const kept = ids.filter((id) => knownIds.has(id));
  return kept.length === ids.length ? ids : kept;
}

/**
 * Splits `items` into the pinned ones, in pin order (most recently pinned
 * first), and the rest in their original order. Pinned ids with no matching
 * item are ignored.
 */
export function splitPinned<T>(
  items: readonly T[],
  pinnedIds: readonly string[],
  keyOf: (item: T) => string,
): { pinned: T[]; rest: T[] } {
  if (pinnedIds.length === 0) return { pinned: [], rest: [...items] };
  const order = new Map(pinnedIds.map((id, index) => [id, index]));
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (order.has(keyOf(item))) pinned.push(item);
    else rest.push(item);
  }
  pinned.sort((a, b) => order.get(keyOf(a))! - order.get(keyOf(b))!);
  return { pinned, rest };
}
