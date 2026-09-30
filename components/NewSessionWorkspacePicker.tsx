"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { RecentProject } from "@/lib/project-groups";
import { DirectoryPicker } from "./DirectoryPicker";

/** Window event that asks the picker on the new-session page to open. */
export const OPEN_WORKSPACE_PICKER_EVENT = "pi-web:open-workspace-picker";

function workspaceName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || trimmed;
}

const FolderIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

/**
 * "New session in <workspace>" line on the empty new-session page. Clicking it
 * picks the workspace the next session is created in; this is the workspace
 * selector while the sidebar shows the cross-workspace activity view.
 */
export function NewSessionWorkspacePicker({ cwd, projects, onSelect }: {
  cwd: string | null;
  projects: readonly RecentProject[];
  onSelect: (cwd: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [validating, setValidating] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visibleProjects = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? projects.filter((project) => project.root.toLowerCase().includes(query)) : projects;
  }, [filter, projects]);
  // The last option is "Custom path…".
  const optionCount = visibleProjects.length + 1;

  const openPicker = useCallback(() => {
    setFilter("");
    const current = cwd ? projects.findIndex((project) => project.root === cwd) : -1;
    setActiveIndex(current >= 0 ? current : 0);
    setOpen(true);
  }, [cwd, projects]);

  const close = useCallback(() => {
    setOpen(false);
    setFilter("");
  }, []);

  const choose = useCallback((path: string) => {
    close();
    if (path !== cwd) onSelect(path);
  }, [close, cwd, onSelect]);

  const chooseIndex = useCallback((index: number) => {
    const project = visibleProjects[index];
    if (project) {
      choose(project.root);
      return;
    }
    close();
    setBrowseError(null);
    setBrowseOpen(true);
  }, [choose, close, visibleProjects]);

  useEffect(() => {
    const handler = () => openPicker();
    window.addEventListener(OPEN_WORKSPACE_PICKER_EVENT, handler);
    return () => window.removeEventListener(OPEN_WORKSPACE_PICKER_EVENT, handler);
  }, [openPicker]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  // Same checks as the sidebar's custom path: validation also adds the folder
  // to the file allow-list and resolves its project identity.
  const commitBrowsedPath = useCallback(async (path: string) => {
    if (validating) return;
    setValidating(true);
    setBrowseError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { cwd?: string; error?: string };
      if (!res.ok || data.error || !data.cwd) {
        setBrowseError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setBrowseOpen(false);
      if (data.cwd !== cwd) onSelect(data.cwd);
    } catch (error) {
      setBrowseError(error instanceof Error ? error.message : String(error));
    } finally {
      setValidating(false);
    }
  }, [cwd, onSelect, validating]);

  return (
    <div ref={rootRef} className="relative mx-auto mt-[10px]" style={{ maxWidth: "var(--chat-content-max-width, 820px)" }}>
      {browseOpen && (
        <DirectoryPicker
          initialPath={cwd ?? undefined}
          busy={validating}
          error={browseError ?? undefined}
          onCancel={() => {
            setBrowseOpen(false);
            setBrowseError(null);
          }}
          onSelect={(path) => void commitBrowsedPath(path)}
        />
      )}
      <button
        type="button"
        onClick={() => (open ? close() : openPicker())}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={cwd ?? t("sidebar.selectProject")}
        className="-mx-2 flex max-w-full min-w-0 cursor-pointer items-center gap-[6px] rounded-md px-2 py-1 text-xs text-text-muted hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        <FolderIcon />
        {cwd ? (
          <>
            <span className="shrink-0">{t("chat.newSessionWorkspace")}</span>
            <span className="shrink-0 font-semibold text-text">{workspaceName(cwd)}</span>
            <span className="min-w-0 truncate font-mono text-[11px] text-text-dim">{cwd}</span>
          </>
        ) : (
          <span className="shrink-0 text-accent">{t("sidebar.selectProject")}</span>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none" }} aria-hidden="true">
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-[min(520px,100%)] overflow-hidden rounded-lg border border-border bg-bg shadow-lg"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => (event.key === "ArrowDown"
                ? (current + 1) % optionCount
                : (current - 1 + optionCount) % optionCount));
            } else if (event.key === "Enter") {
              event.preventDefault();
              chooseIndex(activeIndex);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <input
            autoFocus
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setActiveIndex(0);
            }}
            placeholder={t("sidebar.filterProjects")}
            aria-label={t("sidebar.filterProjects")}
            className="block w-full border-0 border-b border-border bg-bg px-3 py-2 text-xs text-text outline-none"
          />
          <div ref={listRef} role="listbox" className="max-h-[300px] overflow-y-auto py-1">
            {visibleProjects.map((project, index) => (
              <button
                key={project.key}
                type="button"
                role="option"
                aria-selected={project.root === cwd}
                data-option-index={index}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(project.root)}
                title={project.root}
                className={`flex w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-[6px] text-left text-xs ${index === activeIndex ? "bg-bg-hover" : ""}`}
              >
                <FolderIcon size={12} />
                <span className={`shrink-0 ${project.root === cwd ? "font-semibold text-accent" : "text-text"}`}>{workspaceName(project.root)}</span>
                <span className="min-w-0 truncate font-mono text-[11px] text-text-dim">{project.root}</span>
              </button>
            ))}
            <button
              type="button"
              role="option"
              aria-selected={false}
              data-option-index={visibleProjects.length}
              onMouseEnter={() => setActiveIndex(visibleProjects.length)}
              onClick={() => chooseIndex(visibleProjects.length)}
              className={`flex w-full cursor-pointer items-center gap-2 border-t border-border px-3 py-[6px] text-left text-xs text-text-muted ${activeIndex === visibleProjects.length ? "bg-bg-hover" : ""}`}
            >
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" style={{ flexShrink: 0 }} aria-hidden="true">
                <line x1="5" y1="1" x2="5" y2="9" />
                <line x1="1" y1="5" x2="9" y2="5" />
              </svg>
              {t("sidebar.customPath")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
