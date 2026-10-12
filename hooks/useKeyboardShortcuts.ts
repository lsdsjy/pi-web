"use client";

import { useEffect } from "react";
import { detectApplePlatform, matchGlobalShortcut } from "@/lib/global-shortcuts";

// ---------------------------------------------------------------------------
// Module-level registry — ChatWindow registers the abort handler here so that
// the global Esc listener in AppShell can call it without prop-drilling.
// ---------------------------------------------------------------------------
let globalAbortHandler: (() => void) | null = null;

/**
 * Register (or clear) the abort handler for the global Esc shortcut.
 * Call this from ChatWindow whenever agentRunning or handleAbort changes.
 */
export function registerAbortHandler(handler: (() => void) | null): void {
  globalAbortHandler = handler;
}

/**
 * The global Esc shortcut: stops the running agent, unless the key belongs to
 * something else. Typed into a textarea or input, it is that field's (ChatInput
 * has its own Esc logic). Marked handled already (`defaultPrevented`), it was
 * something nearer's: Settings, a menu or a viewer that closed on it. Those
 * listen on `document` or below and run before this one on `window`, and
 * closing them must not stop a run as well. Returns whether it stopped the
 * agent.
 */
export function handleGlobalEscape(event: KeyboardEvent): boolean {
  if (event.key !== "Escape" || event.defaultPrevented || !globalAbortHandler) return false;

  const tag = (event.target as HTMLElement | null)?.tagName;
  // Let textarea/input handle Esc internally (ChatInput menus / stop).
  if (tag === "TEXTAREA" || tag === "INPUT") return false;

  event.preventDefault();
  globalAbortHandler();
  return true;
}

// ---------------------------------------------------------------------------
// Module-level registry — SessionSidebar owns the search panel state, so it
// registers the toggle here for the global Cmd/Ctrl+K shortcut.
// ---------------------------------------------------------------------------
let globalSessionSearchHandler: (() => void) | null = null;

/**
 * Register (or clear) the session search toggle for the global Cmd/Ctrl+K
 * shortcut. Call this from SessionSidebar whenever the toggle changes.
 */
export function registerSessionSearchHandler(handler: (() => void) | null): void {
  globalSessionSearchHandler = handler;
}

// ---------------------------------------------------------------------------
// Module-level registry — SessionSidebar also owns the workspace selector, so
// it registers the opener here for the global Cmd/Ctrl+Shift+P shortcut.
// ---------------------------------------------------------------------------
let globalWorkspaceSelectorHandler: (() => void) | null = null;

/**
 * Register (or clear) the workspace selector opener for the global
 * Cmd/Ctrl+Shift+P shortcut. Call this from SessionSidebar whenever the opener
 * changes.
 */
export function registerWorkspaceSelectorHandler(handler: (() => void) | null): void {
  globalWorkspaceSelectorHandler = handler;
}

// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

interface UseGlobalKeyboardShortcutsOptions {
  /** Called when Ctrl+Alt+N or Cmd/Ctrl+J is pressed. Receives current cwd. */
  onNewSession?: (cwd: string) => void;
  /** The currently selected project directory (sidebar cwd). */
  activeCwd?: string | null;
}

/**
 * Register global keyboard shortcuts for the application.
 *
 * Shortcuts handled here:
 *   Esc                – stop the running agent (via module-level abort handler)
 *   Cmd/Ctrl+J         – create a new session in the active project directory
 *   Cmd/Ctrl+Shift+P   – open the sidebar workspace selector
 *   Cmd/Ctrl+K         – toggle the sidebar session search
 *   Ctrl+Alt+N         – create a new session in the active project directory
 *
 * "Cmd/Ctrl" is the platform's primary modifier: Command on Apple platforms,
 * Control elsewhere. Control chords are deliberately left alone on Apple
 * platforms, where Control belongs to Emacs-style text editing.
 *
 * Note: Esc inside <textarea> or <input> is deliberately NOT handled here.
 * ChatInput manages its own Esc logic (closing slash / @ file menus, stopping
 * the agent when no menu is open) because it needs intimate knowledge of menu
 * state that is local to that component. Nor is an Esc something nearer
 * already handled (see `handleGlobalEscape()`).
 */
export function useGlobalKeyboardShortcuts(
  options: UseGlobalKeyboardShortcutsOptions,
): void {
  const { onNewSession, activeCwd } = options;

  useEffect(() => {
    // Read once per effect run: the chords are bound to the platform's primary
    // modifier, so the handler has to know which one that is.
    const applePlatform = detectApplePlatform();
    const handler = (e: KeyboardEvent): void => {
      // ---- Esc: stop agent ----
      if (e.key === "Escape") {
        handleGlobalEscape(e);
        return;
      }

      const shortcut = matchGlobalShortcut(e, {
        hasAbortHandler: globalAbortHandler !== null,
        hasSessionSearchHandler: globalSessionSearchHandler !== null,
        hasWorkspaceSelectorHandler: globalWorkspaceSelectorHandler !== null,
        activeCwd,
        applePlatform,
      });

      if (shortcut === "newSession") {
        if (!activeCwd || !onNewSession) return;
        e.preventDefault();
        onNewSession(activeCwd);
        return;
      }

      if (shortcut === "toggleSessionSearch") {
        e.preventDefault();
        globalSessionSearchHandler?.();
        return;
      }

      if (shortcut === "openWorkspaceSelector") {
        e.preventDefault();
        globalWorkspaceSelectorHandler?.();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCwd, onNewSession]);
}
