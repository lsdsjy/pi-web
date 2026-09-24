import type { AgentMessage, SessionEntry } from "./types";
import { isMessageGroupAnchor } from "./message-display";

/**
 * One displayed turn, as the chat minimap needs it: the anchor to jump to and
 * just enough metadata for the hover list.
 *
 * This is deliberately not a `SessionMessage`: the outline covers the whole
 * active branch, so it must stay small even for sessions with thousands of
 * entries. Assistant text, tool results, images, and thinking stay on the
 * server; only the player of the anchor is sent.
 */
export interface OutlineTurn {
  entryId: string;
  /** Single-line user prompt, or a label for a compaction / subagent anchor. */
  preview: string;
  /** Assistant entries between this anchor and the next one. */
  assistantCount: number;
  /** Tool calls issued anywhere in this turn. */
  toolCount: number;
  /** ISO timestamp of the anchor entry, when the session has one. */
  timestamp?: string;
}

export interface SessionOutline {
  /** Entry the branch was walked from; null for an empty session. */
  leafId: string | null;
  /** Number of turns in `turns`, before any cap. */
  total: number;
  /** True when older turns were dropped to bound the payload. */
  truncated: boolean;
  turns: OutlineTurn[];
}

/** Longest preview kept per turn. */
export const OUTLINE_PREVIEW_MAX_CHARS = 160;
/** Upper bound on returned turns, so a pathological session cannot blow up the response. */
export const OUTLINE_MAX_TURNS = 5000;

function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => (
      block && typeof block === "object" && (block as { type?: string }).type === "text"
        ? [(block as { text?: unknown }).text]
        : []
    ))
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

/** Collapse to a single trimmed line, then cap the length. */
function previewOf(message: AgentMessage): string {
  const text = messageText(message).replace(/\s+/g, " ").trim();
  if (text.length <= OUTLINE_PREVIEW_MAX_CHARS) return text;
  return `${text.slice(0, OUTLINE_PREVIEW_MAX_CHARS - 1)}…`;
}

/** Label for anchors that carry no user text of their own. */
export function anchorLabel(message: AgentMessage): string | null {
  if (message.role !== "custom") return null;
  if (message.customType === "compaction") return "compaction";
  if (message.customType === "pi-web:subagent-notification") return "subagent";
  return null;
}

function countToolCalls(message: AgentMessage): number {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return 0;
  let count = 0;
  for (const block of message.content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "toolCall") count += 1;
  }
  return count;
}

/**
 * Walk the active branch from `leafId` and collect one entry per displayed
 * turn, in conversation order.
 *
 * Mirrors the client's turn grouping: `isMessageGroupAnchor` starts a turn, and
 * every assistant entry until the next anchor belongs to it. Entries with no
 * preceding anchor (a branch that starts mid-turn) are skipped, exactly as the
 * minimap skips them.
 */
export function buildSessionOutline(
  entries: readonly SessionEntry[],
  leafId: string | null,
): SessionOutline {
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) byId.set(entry.id, entry);

  const leaf = (leafId ? byId.get(leafId) : undefined) ?? entries[entries.length - 1];
  const branch: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  while (current) {
    branch.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  branch.reverse();

  const turns: OutlineTurn[] = [];
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const message = entry.message as AgentMessage;
    if (!message) continue;

    if (isMessageGroupAnchor(message)) {
      turns.push({
        entryId: entry.id,
        preview: previewOf(message) || anchorLabel(message) || "",
        assistantCount: 0,
        toolCount: 0,
        timestamp: entry.timestamp,
      });
      continue;
    }

    const turn = turns[turns.length - 1];
    if (!turn || message.role !== "assistant") continue;
    turn.assistantCount += 1;
    turn.toolCount += countToolCalls(message);
  }

  const total = turns.length;
  const truncated = total > OUTLINE_MAX_TURNS;
  return {
    leafId: leaf?.id ?? null,
    total,
    truncated,
    turns: truncated ? turns.slice(total - OUTLINE_MAX_TURNS) : turns,
  };
}
