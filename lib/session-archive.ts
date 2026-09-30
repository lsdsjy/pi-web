import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { scanSessionFileInfo } from "./session-list-scanner";
import { readSubagentRun, SUBAGENT_META_TYPE } from "./subagents";
import type { SessionEntry } from "./types";

/**
 * Archiving moves session files out of `~/.pi/agent/sessions/` into
 * `~/.pi/agent/sessions-archive/`, keeping the per-cwd folder, so a session
 * can be restored by moving its file back. Nothing is rewritten on the way.
 */
export function defaultSessionsArchiveDir(agentDir = getAgentDir()): string {
  return join(agentDir, "sessions-archive");
}

/**
 * Where `sessionPath` goes in the archive. Files inside `sessionsDir` keep
 * their relative path; any other file keeps its parent folder name, so two
 * cwds never mix. An existing file is never overwritten: a numeric suffix is
 * added before the extension instead.
 */
export function archivePathFor(
  sessionPath: string,
  sessionsDir: string,
  archiveDir: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const absolute = resolve(sessionPath);
  const rel = relative(resolve(sessionsDir), absolute);
  const inside = rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  const target = inside
    ? join(archiveDir, rel)
    : join(archiveDir, basename(dirname(absolute)), basename(absolute));
  if (!exists(target)) return target;
  const ext = extname(target);
  const stem = target.slice(0, target.length - ext.length);
  for (let index = 1; ; index += 1) {
    const candidate = `${stem}.${index}${ext}`;
    if (!exists(candidate)) return candidate;
  }
}

/** Moves one session file into the archive and returns its new path. */
export function moveSessionToArchive(
  sessionPath: string,
  sessionsDir = join(getAgentDir(), "sessions"),
  archiveDir = defaultSessionsArchiveDir(),
): string {
  const target = archivePathFor(sessionPath, sessionsDir, archiveDir);
  mkdirSync(dirname(target), { recursive: true });
  try {
    renameSync(sessionPath, target);
  } catch (error) {
    // Different volumes cannot rename; copy, then remove the original.
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    copyFileSync(sessionPath, target);
    unlinkSync(sessionPath);
  }
  // The archive list reads the archive time from mtime. ctime is not usable:
  // macOS bumps it whenever it adds extended attributes. Session activity
  // times come from the entries, so nothing else reads this mtime.
  const now = new Date();
  utimesSync(target, now, now);
  return target;
}

export interface ArchivedSessionFile {
  id: string;
  path: string;
  /** Set when this file is a subagent run of another session. */
  subagentParentId?: string;
}

export interface ArchivedSession {
  id: string;
  /** Path inside the archive. */
  path: string;
  cwd: string;
  name?: string;
  firstMessage: string;
  messageCount: number;
  /** Last activity in the session. */
  modified: string;
  /** When the file was moved into the archive (its mtime, set on archive). */
  archivedAt: string;
  /** Subagent sessions archived along with it; restored together. */
  subagentCount: number;
}

/**
 * Groups archived files into restorable families: every file that is not a
 * subagent of another archived file is a root, and its subagent descendants
 * travel with it. A subagent whose parent is not archived is its own root.
 */
export function groupArchivedFamilies(files: readonly ArchivedSessionFile[]): Map<string, ArchivedSessionFile[]> {
  const byId = new Map(files.map((file) => [file.id, file]));
  const rootOf = (file: ArchivedSessionFile): string => {
    const seen = new Set<string>();
    let current = file;
    while (current.subagentParentId && byId.has(current.subagentParentId) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.subagentParentId)!;
    }
    return current.id;
  };
  const families = new Map<string, ArchivedSessionFile[]>();
  for (const file of files) {
    const root = rootOf(file);
    const family = families.get(root) ?? [];
    if (root === file.id) family.unshift(file);
    else family.push(file);
    families.set(root, family);
  }
  return families;
}

function listArchiveFiles(archiveDir: string): string[] {
  let folders: string[];
  try {
    folders = readdirSync(archiveDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(archiveDir, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return folders.flatMap((folder) => readdirSync(folder)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(folder, name)));
}

function readArchivedSessionFile(path: string): ArchivedSessionFile | null {
  try {
    const lines = readFileSync(path, "utf8").split("\n");
    const header = JSON.parse(lines[0]) as { type?: string; id?: unknown };
    if (header.type !== "session" || typeof header.id !== "string") return null;
    const entries = lines.slice(1).flatMap((line) => {
      if (!line.includes(SUBAGENT_META_TYPE)) return [];
      try { return [JSON.parse(line) as SessionEntry]; } catch { return []; }
    });
    const subagent = readSubagentRun(entries, header.id, path);
    return { id: header.id, path, subagentParentId: subagent?.parentSessionId };
  } catch {
    return null;
  }
}

function readArchivedFiles(archiveDir: string): ArchivedSessionFile[] {
  return listArchiveFiles(archiveDir).flatMap((path) => {
    const file = readArchivedSessionFile(path);
    return file ? [file] : [];
  });
}

/** Archived sessions (family roots), most recently archived first. */
export async function listArchivedSessions(archiveDir = defaultSessionsArchiveDir()): Promise<ArchivedSession[]> {
  const families = groupArchivedFamilies(readArchivedFiles(archiveDir));
  const sessions: ArchivedSession[] = [];
  for (const [, family] of families) {
    const root = family[0];
    const info = await scanSessionFileInfo(root.path);
    if (!info) continue;
    let archivedAt: Date;
    try {
      archivedAt = statSync(root.path).mtime;
    } catch {
      continue;
    }
    sessions.push({
      id: root.id,
      path: root.path,
      cwd: info.cwd,
      name: info.name,
      firstMessage: info.firstMessage,
      messageCount: info.messageCount,
      modified: info.modified.toISOString(),
      archivedAt: archivedAt.toISOString(),
      subagentCount: family.length - 1,
    });
  }
  return sessions.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

export class ArchiveRestoreError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Moves an archived session and its archived subagent sessions back to the
 * sessions dir, at the relative path they had. Nothing moves if any target
 * already exists.
 */
export function restoreArchivedSession(
  sessionId: string,
  sessionsDir = join(getAgentDir(), "sessions"),
  archiveDir = defaultSessionsArchiveDir(),
): { restoredPaths: Record<string, string> } {
  const family = groupArchivedFamilies(readArchivedFiles(archiveDir)).get(sessionId);
  if (!family) throw new ArchiveRestoreError("Archived session not found", 404);
  const moves = family.map((file) => ({
    id: file.id,
    from: file.path,
    to: join(sessionsDir, relative(archiveDir, file.path)),
  }));
  const conflict = moves.find((move) => existsSync(move.to));
  if (conflict) throw new ArchiveRestoreError(`A session file already exists at ${conflict.to}`, 409);
  const restoredPaths: Record<string, string> = {};
  for (const move of moves) {
    mkdirSync(dirname(move.to), { recursive: true });
    try {
      renameSync(move.from, move.to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      copyFileSync(move.from, move.to);
      unlinkSync(move.from);
    }
    restoredPaths[move.id] = move.to;
  }
  return { restoredPaths };
}
