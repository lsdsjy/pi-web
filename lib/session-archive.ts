import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

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
  return target;
}
