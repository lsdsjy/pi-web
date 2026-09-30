import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { sanitizePinnedSessionIds } from "./pinned-sessions";

/** `~/.pi/agent/pi-web/pinned-sessions.json`, shared by every browser and the desktop shell. */
export function getPinnedSessionsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web", "pinned-sessions.json");
}

/**
 * Reads the stored pins, most recently pinned first. A missing file means no
 * pins; an unparsable one is treated the same, since pins are a convenience
 * and the next write replaces the file anyway.
 */
export function readPinnedSessionIds(path = getPinnedSessionsPath()): string[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as { sessionIds?: unknown } | null;
    return sanitizePinnedSessionIds(parsed?.sessionIds);
  } catch {
    return [];
  }
}

/** Replaces the stored pins. The caller validates `sessionIds`. */
export function writePinnedSessionIds(sessionIds: string[], path = getPinnedSessionsPath()): string[] {
  mkdirSync(dirname(path), { recursive: true });
  writePrivateFileAtomicSync(path, `${JSON.stringify({ sessionIds }, null, 2)}\n`);
  return sessionIds;
}
