"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { skillExpansionToCommand } from "@/lib/slash-display";
import type { SessionInfo } from "@/lib/types";

/** The title the sidebar shows for a session: its name, else its first message. */
export function sessionDisplayTitle(session: Pick<SessionInfo, "id" | "name" | "firstMessage">): string {
  const firstMessage = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  return session.name || firstMessage.slice(0, 50) || session.id.slice(0, 12);
}

/**
 * Top-bar action that edits the open session's title in a small popover under
 * the button. Saving an empty title clears the stored name, which falls back
 * to the first message, the same as the old inline rename in the sidebar.
 */
export function SessionRenameButton({ session, mobile, onRenamed }: {
  session: SessionInfo | null;
  mobile: boolean;
  onRenamed: (sessionId: string, name: string) => void;
}) {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const disabled = !session || Boolean(session.transient);
  const sessionId = session?.id ?? null;

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  // A different session invalidates an open editor.
  useEffect(() => {
    close();
  }, [sessionId, close]);

  const placePopover = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(360, window.innerWidth - 16);
    setAnchor({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    placePopover();
    window.addEventListener("resize", placePopover);
    return () => window.removeEventListener("resize", placePopover);
  }, [open, placePopover]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.select());
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open, close]);

  const start = useCallback(() => {
    if (!session || disabled) return;
    if (open) {
      close();
      return;
    }
    setValue(sessionDisplayTitle(session));
    setError(null);
    setOpen(true);
  }, [close, disabled, open, session]);

  const save = useCallback(async () => {
    if (!session || saving) return;
    const name = value.trim();
    // Unchanged: the fallback title is not a stored name, so do not persist it.
    if (name === (session.name ?? "") || (!session.name && value === sessionDisplayTitle(session))) {
      close();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onRenamed(session.id, name);
      close();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, [close, onRenamed, saving, session, value]);

  const label = t("sidebar.rename");
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={start}
        disabled={disabled}
        title={disabled ? t("title.unsaved") : label}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          width: mobile ? 36 : undefined, // TOP_BAR_ICON_BUTTON_SIZE
          height: "100%", padding: mobile ? 0 : "0 12px",
          background: open ? "var(--bg-selected)" : "none", border: "none",
          borderTop: open ? "2px solid var(--accent)" : "2px solid transparent",
          borderRight: "1px solid var(--border)",
          color: disabled ? "var(--text-dim)" : open ? "var(--text)" : "var(--text-muted)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.45 : 1,
          flexShrink: 0, fontSize: 11, whiteSpace: "nowrap",
          transition: "color 0.1s, background 0.1s, opacity 0.1s",
        }}
        onMouseEnter={(event) => {
          if (disabled || open) return;
          event.currentTarget.style.color = "var(--text)";
          event.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(event) => {
          if (open) return;
          event.currentTarget.style.color = disabled ? "var(--text-dim)" : "var(--text-muted)";
          event.currentTarget.style.background = "none";
        }}
        data-mobile-toolbar-action={mobile ? "rename" : undefined}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
        {!mobile && <span>{label}</span>}
      </button>
      {open && anchor && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          data-toolbar-popover=""
          aria-label={label}
          className="rounded-lg border border-border bg-bg p-2 shadow-lg"
          style={{ position: "fixed", top: anchor.top, left: anchor.left, width: "min(360px, calc(100vw - 16px))", zIndex: 1000 }}
        >
          <input
            ref={inputRef}
            value={value}
            maxLength={200}
            disabled={saving}
            aria-label={label}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void save();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
            className="block h-[30px] w-full min-w-0 rounded-md border border-accent bg-bg px-2 text-xs text-text outline-none"
          />
          {error && <div role="alert" className="mt-1 text-[11px] text-red-600">{error}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
