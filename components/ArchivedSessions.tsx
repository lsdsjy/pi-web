"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { ArchivedSession } from "@/lib/session-archive";
import { skillExpansionToCommand } from "@/lib/slash-display";

type RowState = { kind: "restoring" } | { kind: "restored" } | { kind: "error"; message: string };

function workspaceName(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || trimmed;
}

function titleOf(session: ArchivedSession): string {
  const firstMessage = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  return session.name || firstMessage.slice(0, 80) || session.id.slice(0, 12);
}

/** Settings → Archive: sessions archived from the sidebar, with Restore. */
export function ArchivedSessions({ onRestored }: { onRestored: (sessionId: string) => void }) {
  const { t, locale } = useI18n();
  const [sessions, setSessions] = useState<ArchivedSession[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/sessions/archived", { cache: "no-store" });
      const data = await res.json().catch(() => ({})) as { sessions?: ArchivedSession[]; error?: string };
      if (!res.ok || !data.sessions) throw new Error(data.error || `HTTP ${res.status}`);
      setSessions(data.sessions);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = useCallback(async (sessionId: string) => {
    setRowStates((current) => ({ ...current, [sessionId]: { kind: "restoring" } }));
    try {
      const res = await fetch("/api/sessions/archived", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRowStates((current) => ({ ...current, [sessionId]: { kind: "restored" } }));
      onRestored(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRowStates((current) => ({ ...current, [sessionId]: { kind: "error", message } }));
    }
  }, [onRestored]);

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!sessions || !query) return sessions ?? [];
    return sessions.filter((session) => (
      titleOf(session).toLowerCase().includes(query) || session.cwd.toLowerCase().includes(query)
    ));
  }, [filter, sessions]);

  return (
    <section aria-labelledby="archived-sessions-title" className="flex min-h-0 flex-col gap-3 p-4">
      <div>
        <h2 id="archived-sessions-title" className="text-sm font-semibold text-text">
          {t("archive.title")}
          {sessions && <span className="ml-2 font-mono text-xs font-normal text-text-dim">{sessions.length}</span>}
        </h2>
        <p className="mt-1 text-xs text-text-muted">{t("archive.hint", { path: "~/.pi/agent/sessions-archive" })}</p>
      </div>

      {sessions && sessions.length > 0 && (
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("archive.filter")}
          aria-label={t("archive.filter")}
          className="h-[30px] w-full rounded-md border border-border bg-bg px-2 text-xs text-text focus:outline-2 focus:outline-accent"
        />
      )}

      {loadError ? (
        <p role="alert" className="text-xs text-red-600">{t("archive.loadFailed")}: {loadError}</p>
      ) : !sessions ? (
        <p className="text-xs text-text-muted">{t("sidebar.loading")}</p>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-text-muted">{t("archive.empty")}</p>
      ) : (
        <ul className="min-h-0 overflow-y-auto rounded-md border border-border">
          {visible.map((session) => {
            const state = rowStates[session.id];
            const restored = state?.kind === "restored";
            return (
              <li key={session.id} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
                <div className={`min-w-0 flex-1 ${restored ? "opacity-50" : ""}`}>
                  <div className="truncate text-xs font-medium text-text" title={titleOf(session)}>{titleOf(session)}</div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-text-dim">
                    <span className="shrink-0 text-text-muted" title={session.cwd}>{workspaceName(session.cwd)}</span>
                    <span className="shrink-0" title={session.archivedAt}>
                      {t("archive.archivedAt", { time: formatRelativeTime(session.archivedAt, locale) })}
                    </span>
                    <span className="shrink-0">{t("sidebar.messagesCount", { count: session.messageCount })}</span>
                    {session.subagentCount > 0 && (
                      <span className="shrink-0">{t("archive.subagents", { count: session.subagentCount })}</span>
                    )}
                  </div>
                  {state?.kind === "error" && <div role="alert" className="mt-1 text-[11px] text-red-600">{state.message}</div>}
                </div>
                <button
                  type="button"
                  disabled={state?.kind === "restoring" || restored}
                  onClick={() => void restore(session.id)}
                  className="h-[28px] shrink-0 cursor-pointer rounded-md border border-border bg-bg-hover px-3 text-xs text-text-muted hover:bg-bg-selected hover:text-accent disabled:cursor-default disabled:opacity-60"
                >
                  {state?.kind === "restoring" ? t("archive.restoring") : restored ? t("archive.restored") : t("archive.restore")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
