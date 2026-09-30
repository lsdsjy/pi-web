import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("the session list is one grouped virtual list with pinned sessions first", () => {
  assert.match(source, /splitPinned\(allSessionFamilies, pinnedSessionIds/);
  assert.match(source, /groups\.push\(\{ key: "pinned", header: \{ kind: "pinned" \}, items: pinnedFamilies \}\)/);
  assert.match(source, /visibleListRowIndices\(listLayout\.rows, listScrollTop, listViewportH, focusedSessionId\)/);
  // Pinned rows can belong to another workspace, so they name it and select
  // through the same path as activity rows, which switches the workspace.
  assert.match(source, /projectLabel=\{activityView \|\| isPinned \? projectLabelOf\(family\.root\) : undefined\}/);
  assert.match(source, /onClick=\{\(\) => handleSelectSessionFromList\(family\.root\)\}/);
});

test("pins load once, update optimistically, and leave with a deleted session", () => {
  assert.match(source, /fetch\(PINNED_SESSIONS_URL, \{ cache: "no-store" \}\)/);
  assert.match(source, /method: "PUT",[\s\S]*?body: JSON\.stringify\(\{ sessionIds: next \}\)/);
  assert.match(source, /const handleSessionRowDeleted[\s\S]*?setSessionPinned\(pinnedSessionIdsRef\.current, sessionId, false\)/);
  assert.match(sessionItemSource, /onTogglePinned\?\.\(session\.id, !isPinned\)/);
});

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("persists and exposes a vertical session/explorer resize handle", () => {
  assert.match(source, /axis: "vertical"/);
  assert.match(source, /storageKey: "pi-web:sidebar-session-pane-height"/);
  assert.match(source, /Math\.round\(\(paneHeight \+ explorerHeight\) \/ 2\)/);
  assert.match(source, /ref=\{sessionPaneRef\}[\s\S]*?<SessionSearch/);
  assert.match(source, /data-resize-handle="sidebar-sections"/);
  assert.match(source, /sidebar-section-resize-handle/);
  assert.match(globalStyles, /\.sidebar-section-resize-handle:focus-visible::after/);
  assert.doesNotMatch(globalStyles, /\.sidebar-section-resize-handle:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/);
  assert.match(globalStyles, /\.sidebar-section-resize-handle::after[\s\S]*?background: transparent/);
  assert.match(source, /borderTop: "1px solid var\(--border\)"/);
  assert.match(source, /var\(--sidebar-session-pane-height, 320px\)/);
  assert.match(source, /minHeight: explorerOpen \? EXPLORER_PANE_MIN_HEIGHT : 0/);
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("exposes the loaded session catalog to the shell", () => {
  assert.match(source, /onSessionsChange\?: \(sessions: SessionInfo\[\]\) => void/);
  assert.match(source, /onSessionsChange\?\.\(allSessions\)/);
});

test("subagent completion stays silent and never becomes unread", () => {
  assert.match(source, /completionNotificationSuppressedSessionIds\?: string\[\]/);
  assert.match(
    source,
    /completedWithNotifications = completedInBackground\.filter\([\s\S]*?!previousSuppressedCompletionSessionIdsRef\.current\.has\(id\)[\s\S]*?!knownSubagentIds\.has\(id\)/,
  );
  assert.match(source, /completedWithNotifications\.forEach\(\(id\) => next\.add\(id\)\)/);
  assert.match(source, /if \(completedWithNotifications\.length > 0\) \{\s*onBackgroundTaskDone\?\.\(\)/);
  assert.match(
    source,
    /filter\(\(session\) => session\.relation\?\.kind !== "subagent"\)[\s\S]*?unreadEligibleIds\.has\(id\)/,
  );
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("formats session timestamps with the active locale", () => {
  assert.match(source, /import \{ formatRelativeTime \} from "@\/lib\/i18n\/format"/);
  assert.match(sessionItemSource, /const \{ locale, t \} = useI18n\(\)/);
  assert.match(sessionItemSource, /formatRelativeTime\(session\.modified, locale\)/);
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("lifecycle refreshes bypass the cache while cross-window polling reuses it", () => {
  assert.match(source, /function sessionListUrl\(summary: boolean, force: boolean\)/);
  assert.match(source, /if \(summary\) return "\/api\/sessions\?summary=1"/);
  assert.match(source, /if \(force\) return "\/api\/sessions\?force=1"/);
  assert.match(source, /cache: "no-store"/);
  // First paint uses the cheap summary listing, then hydrates after a delay.
  assert.match(source, /loadSessions\(true, false, true\)/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?void loadSessions\(false, true\)/);
  assert.match(source, /data\.sessionListVersion !== sessionListVersionRef\.current[\s\S]*?await loadSessions\(\)/);
  assert.doesNotMatch(source, /sessionRefreshDone|sessionRefreshTimerRef|title=\{t\("sidebar\.refresh"\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\{hovered && !session\.transient && \(/);
});

test("hides subagent rows and aggregates their state into the main session row", () => {
  assert.match(source, /const sessionFamilies = useMemo\(\(\) => listSessionFamilies\(filteredSessions\)/);
  assert.match(source, /familySessions\.some\(\(session\) => session\.id === selectedSessionId\)/);
  assert.match(source, /familySessions\.some\(\(session\) => runningSessionIds\.has\(session\.id\)\)/);
  assert.doesNotMatch(source, /function SessionTreeItem/);
});
