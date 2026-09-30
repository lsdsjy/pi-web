"use strict";

/**
 * Electron shell for Pi Web.
 *
 * The Pi Web server runs as a separate Node process, never inside Electron's
 * own runtime. That keeps native modules (node-pty) on the Node ABI they were
 * compiled for, so no electron-rebuild step is needed.
 *
 * Behavior: if something already listens on the target port, reuse it. Other-
 * wise start `next dev` (no production build) or the pi-web CLI (`next start`).
 */

const { app, BrowserWindow, Notification, ipcMain, shell } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

const HOST = process.env.PI_WEB_HOST || "127.0.0.1";
const PORT = Number(process.env.PI_WEB_PORT || 30141);
const APP_URL = process.env.PI_WEB_URL || `http://${HOST}:${PORT}`;

// Keep the Dock name consistent with the bundle, and make userData land in
// ~/Library/Application Support/Pi Web. Must run before app is ready.
app.setName("Pi Web");

/**
 * Where the Pi Web checkout lives. When this shell runs from a packaged .app in
 * /Applications it has no idea where the source tree is, so the installer bakes
 * the path into Resources/pi-web-project.json. A user-level config file in
 * userData overrides that, and PI_WEB_PROJECT overrides everything.
 */
function resolveProjectDir() {
  if (process.env.PI_WEB_PROJECT) return process.env.PI_WEB_PROJECT;

  // Same location in a dev checkout and inside a packaged app.asar.
  const bundled = path.join(__dirname, "..", "pi-web-project.json");
  const configFiles = [
    path.join(app.getPath("userData"), "pi-web-project.json"),
    bundled,
  ];
  if (process.resourcesPath) {
    configFiles.push(path.join(process.resourcesPath, "pi-web-project.json"));
  }

  for (const file of configFiles) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed.projectDir === "string" && parsed.projectDir) {
        return parsed.projectDir;
      }
    } catch {
      /* missing or unreadable: try the next candidate */
    }
  }

  // Dev checkout: electron/ sits directly inside the project.
  return path.join(__dirname, "..");
}

let PROJECT_DIR = path.join(__dirname, "..");

const BUNDLE_ID = "com.agegr.pi-web.desktop";
// `terminal-notifier -activate` needs a real bundle id. The dev run is plain
// Electron.app, which carries Electron's own id.
const ACTIVATOR_BUNDLE_ID = app.isPackaged ? BUNDLE_ID : "com.github.Electron";

/* ------------------------------------------------------------ notifications */

/**
 * Electron's own notifications never appear on macOS when the bundle is only
 * ad-hoc signed: the app never registers with the notification centre, so
 * UNUserNotificationCenter drops the request. terminal-notifier is a separate
 * process that macOS accepts, so prefer it and keep Electron's Notification as
 * the fallback for signed builds.
 */
let terminalNotifierPath;

function resolveTerminalNotifier() {
  if (terminalNotifierPath !== undefined) return terminalNotifierPath;
  const candidates = [
    process.env.PI_WEB_NOTIFIER,
    findOnPath("terminal-notifier"),
    "/opt/homebrew/bin/terminal-notifier",
    "/usr/local/bin/terminal-notifier",
  ];
  terminalNotifierPath = candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
  return terminalNotifierPath;
}

/* ----------------------------------------------------------- dock badge */

// Unread sessions as counted by the web app. The shim mirrors
// pi-web:unread-session-ids from localStorage onto this.
let unreadSessionCount = 0;
// Sessions that finished, or asked for input, while the window was unfocused.
// Cleared when the window comes back to the front.
//
// Both halves are needed: AppShell only raises a notification for the session
// that is currently open, so the app's own unread set never covers "the agent
// finished while I was in another app and that session was the open one".
const pendingAttention = new Set();

function refreshDockBadge() {
  setDockBadge(unreadSessionCount + pendingAttention.size);
}

function rememberAttention(tag) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return;
  pendingAttention.add(tag || "pi-web");
  refreshDockBadge();
}

function deliverNotification(payload) {
  const title = String(payload?.title ?? "Pi Web");
  const body = String(payload?.body ?? "");
  const tag = payload?.tag ? String(payload.tag) : "";

  const notifier = resolveTerminalNotifier();
  if (notifier) {
    const args = ["-title", title, "-message", body];
    // -group makes macOS replace the previous notification for the same session
    // in place, which matches the tag semantics the web app already uses.
    if (tag) args.push("-group", tag);
    args.push("-activate", ACTIVATOR_BUNDLE_ID);
    try {
      spawn(notifier, args, { stdio: "ignore", detached: true }).unref();
      rememberAttention(tag);
      return "terminal-notifier";
    } catch (error) {
      console.warn(`[pi-web] terminal-notifier failed: ${error.message}`);
    }
  }

  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
    rememberAttention(tag);
    return "electron";
  }
  return "none";
}

function setDockBadge(value) {
  // PI_WEB_DEBUG_BADGE pins the badge so the dock rendering can be checked
  // independently of whether the app has counted any unread sessions yet.
  const forced = process.env.PI_WEB_DEBUG_BADGE;
  const count = forced !== undefined ? Number(forced) : Number(value);
  if (process.env.PI_WEB_DEBUG_NOTIFY === "1") {
    console.log("[pi-web][badge:set]", count);
  }
  if (process.platform !== "darwin" || !app.dock) return;
  app.dock.setBadge(Number.isFinite(count) && count > 0 ? String(Math.trunc(count)) : "");
}

function readDockBadge() {
  if (process.platform !== "darwin" || !app.dock) return null;
  return app.dock.getBadge();
}

/**
 * macOS gets the frameless look: traffic lights float inside the window
 * (hiddenInset) instead of occupying a native title bar. Pi Web draws its own
 * header in the top-left corner, so the lights need their own strip above the
 * app content — see TITLEBAR_CSS. Set PI_WEB_NATIVE_FRAME=1 to fall back to the
 * standard title bar.
 */
const INSET_TITLEBAR = process.platform === "darwin" && process.env.PI_WEB_NATIVE_FRAME !== "1";
// Standard macOS traffic light metrics: three 12pt buttons with 8pt gaps.
// y centers the lights on the sidebar's first control row, which sits at
// y 12..44 in the 260px sidebar.
const TRAFFIC_LIGHT_POSITION = { x: 16, y: 22 };
const TRAFFIC_LIGHT_SIZE = { width: 52, height: 12 };
// Left padding the app's top rows need to clear the lights, plus a 6px gap.
const LIGHT_INSET = TRAFFIC_LIGHT_POSITION.x + TRAFFIC_LIGHT_SIZE.width + 6;
const FALLBACK_STRIP_HEIGHT = 32;
// How long the brand row may stay unrecognized before the strip is reserved,
// and how often that is re-checked for the lifetime of the page.
const STRIP_FALLBACK_DELAY_MS = 5000;
const TITLEBAR_CHECK_INTERVAL_MS = 1000;

function trafficLightBox() {
  return { ...TRAFFIC_LIGHT_POSITION, ...TRAFFIC_LIGHT_SIZE };
}

/**
 * Preferred layout: no reserved strip. The lights sit inside the app's own
 * header rows, and those rows are indented so nothing lands under them.
 *
 * - Sidebar open: the brand row ("Pi Web" + New + search) is indented.
 * - Sidebar collapsed: the brand row is gone, and the center column's toolbar
 *   toggle button moves to the window's left edge, so that row is indented
 *   instead. `sidebar-closed + div` is the center column: the resize handle
 *   between them is only rendered while the sidebar is open.
 */
const INLINE_TITLEBAR_CSS = `
  #session-sidebar > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) {
    padding-left: ${LIGHT_INSET}px !important;
  }
  /* The inset leaves no room for the "New" label next to the other header
     buttons, so it collapses to its + icon (the tooltip keeps the name). */
  #session-sidebar .sidebar-new-label {
    display: none !important;
  }
  #session-sidebar .sidebar-new-button {
    width: 32px !important;
    padding: 0 !important;
  }
  #session-sidebar.sidebar-closed + div > div:first-child > div:first-child {
    padding-left: ${LIGHT_INSET}px !important;
  }
`;

/**
 * Makes the app's own top chrome behave like an inset macOS title bar: the blank
 * areas drag the window, the controls stay clickable.
 *
 * `-webkit-app-region` is inherited, so marking the containers as draggable and
 * then opting every control back out is the reliable direction. The one
 * exception is the "Pi Web" title, which is a button but doubles as a drag
 * handle (its click, which toggles the version readout, no longer fires).
 *
 * The center column is found through .chat-content: it is the only element with
 * a direct child that itself has .chat-content, so it works whether or not the
 * sidebar resize handle (a conditional sibling) is rendered.
 */
const DRAG_REGION_CSS = `
  #session-sidebar > div:nth-child(1) > div:nth-child(1),
  #session-sidebar > div:nth-child(1) > div:nth-child(1) > div:nth-child(1),
  div:has(> div > .chat-content) > div:first-child,
  #file-panel > div:first-child {
    -webkit-app-region: drag;
  }

  /* Everything below the open header row (project picker, dropdown) stays
     interactive. */
  #session-sidebar > div:nth-child(1) > div:nth-child(1) > *:not(:first-child) {
    -webkit-app-region: no-drag;
  }

  button, input, select, textarea, a,
  [role="button"], [role="tab"], [role="listbox"], [role="option"],
  .panel-resize-handle {
    -webkit-app-region: no-drag;
  }

  #session-sidebar > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > button:first-child {
    -webkit-app-region: drag;
  }
`;

/**
 * Injected into the page's own world (contextIsolation stays on). It does two
 * things the app has no way to do by itself:
 *
 * 1. Replaces window.Notification so the existing turn-complete notification
 *    code reaches the main process instead of a dead end in the renderer.
 * 2. Mirrors the unread-session count onto the macOS dock badge. The app keeps
 *    that set in localStorage, so wrapping Storage covers every update without
 *    touching app code.
 */
const RENDERER_SHIM = `(() => {
  try {
  if (window.__piWebDesktopShim) return "already";
  const desktop = window.piWebDesktop;
  if (!desktop) return "no bridge";
  if (typeof desktop.setBadge !== "function") return "no setBadge";
  if (typeof desktop.notify !== "function") return "no notify";
  window.__piWebDesktopShim = true;

  function DesktopNotification(title, options) {
    this.title = String(title);
    const opts = options || {};
    this.body = opts.body ? String(opts.body) : "";
    this.tag = opts.tag ? String(opts.tag) : "";
    this.onclick = null;
    this.close = function () {};
    forward(String(title), options);
  }
  DesktopNotification.permission = "granted";
  DesktopNotification.requestPermission = function () { return Promise.resolve("granted"); };
  try { window.Notification = DesktopNotification; } catch (error) { return "assign failed"; }

  // showBrowserNotification() prefers the service-worker path when a
  // registration exists. Electron has no OS-level notifications there, so route
  // it to the same bridge and resolve, which stops the fallback from firing a
  // second time.
  const forward = (title, options) => {
    const opts = options || {};
    void desktop.notify({
      title: String(title),
      body: opts.body ? String(opts.body) : "",
      tag: opts.tag ? String(opts.tag) : "",
    });
  };
  if (window.ServiceWorkerRegistration && "showNotification" in ServiceWorkerRegistration.prototype) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      forward(title, options);
      return Promise.resolve();
    };
  }

  const UNREAD_KEY = "pi-web:unread-session-ids";
  const count = (raw) => {
    if (!raw) return 0;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch (error) { return 0; }
  };
  const push = () => { void desktop.setBadge(count(window.localStorage.getItem(UNREAD_KEY))); };
  const setItem = Storage.prototype.setItem;
  const removeItem = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (key, value) {
    const result = setItem.apply(this, arguments);
    if (key === UNREAD_KEY) push();
    return result;
  };
  Storage.prototype.removeItem = function (key) {
    const result = removeItem.apply(this, arguments);
    if (key === UNREAD_KEY) push();
    return result;
  };
  push();
  return "ok";
  } catch (error) {
    return "throw: " + (error && error.message ? error.message : String(error));
  }
})()`;

/**
 * Fallback for when the app's header markup does not match the selectors above.
 * Reserving a strip is uglier but never overlaps.
 */
const STRIP_TITLEBAR_CSS = `
  body {
    padding-top: ${FALLBACK_STRIP_HEIGHT}px !important;
    box-sizing: border-box !important;
    background: var(--bg-panel) !important;
  }
  body > div {
    height: calc(var(--app-viewport-height, 100dvh) - ${FALLBACK_STRIP_HEIGHT}px) !important;
  }
  .image-preview-dialog {
    top: ${FALLBACK_STRIP_HEIGHT}px !important;
    height: calc(100dvh - ${FALLBACK_STRIP_HEIGHT}px) !important;
  }
  .image-preview-close {
    top: calc(max(12px, env(safe-area-inset-top)) + ${FALLBACK_STRIP_HEIGHT}px) !important;
  }
`;

// Confirms the sidebar brand row has the shape INLINE_TITLEBAR_CSS assumes:
// a short button (the "Pi Web" logo) as the row's first child.
const BRAND_ROW_PROBE = `(() => {
  const row = document.querySelector("#session-sidebar > div:nth-child(1) > div:nth-child(1) > div:nth-child(1)");
  const brand = row && row.firstElementChild;
  if (!brand || brand.tagName !== "BUTTON") return false;
  const r = brand.getBoundingClientRect();
  return r.width > 30 && r.width < 90 && r.height > 16 && r.height < 36;
})()`;

let mainWindow = null;
let serverChild = null;
let serverLog = "";

/* ------------------------------------------------------------------ probe */

function isPortOpen(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitForPort(host, port, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(host, port)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/* ------------------------------------------------------------ node lookup */

function findOnPath(name) {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [name], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const first = (result.stdout || "").split("\n")[0].trim();
  return first || null;
}

/**
 * Resolve a real Node binary for the server process. Electron's own binary is
 * only usable as Node through ELECTRON_RUN_AS_NODE, and its bundled Node may be
 * older than the version Pi Web requires, so prefer a system `node`.
 */
function resolveServerRuntime() {
  if (process.env.PI_WEB_NODE) {
    return { command: process.env.PI_WEB_NODE, env: {}, label: process.env.PI_WEB_NODE };
  }

  const candidates = [findOnPath("node")];
  const home = process.env.HOME || "";
  if (home) {
    candidates.push(
      path.join(home, ".local/share/fnm/aliases/default/bin/node"),
      path.join(home, ".nvm/current/bin/node"),
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
    );
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!fs.existsSync(candidate)) continue;
    if (candidate === process.execPath) continue;
    try {
      const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
      if (probe.status === 0) {
        return { command: candidate, env: {}, label: `${candidate} (${probe.stdout.trim()})` };
      }
    } catch {
      /* keep looking */
    }
  }

  // Last resort: run Electron as plain Node.
  return {
    command: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: "1" },
    label: `${process.execPath} (ELECTRON_RUN_AS_NODE, node ${process.versions.node})`,
  };
}

/* ------------------------------------------------------------ server boot */

function hasProductionBuild() {
  return fs.existsSync(path.join(PROJECT_DIR, ".next", "BUILD_ID"));
}

function startServer() {
  const runtime = resolveServerRuntime();
  const useProduction = hasProductionBuild();

  const args = useProduction
    ? [path.join(PROJECT_DIR, "bin", "pi-web.js"), "--no-open", "-p", String(PORT), "-H", HOST]
    : [path.join(PROJECT_DIR, "node_modules", "next", "dist", "bin", "next"), "dev", "-H", HOST, "-p", String(PORT)];

  console.log(`[pi-web] starting ${useProduction ? "next start" : "next dev"} with ${runtime.label}`);
  console.log(`[pi-web] pid target ${APP_URL}`);

  serverChild = spawn(runtime.command, args, {
    cwd: PROJECT_DIR,
    // Own process group on POSIX so stopServer() can kill next dev's children too.
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...runtime.env,
      PI_WEB_HOSTNAME: HOST,
      PI_WEB_NO_OPEN: "1",
    },
  });

  const remember = (chunk) => {
    const text = chunk.toString();
    serverLog = (serverLog + text).slice(-8000);
    process.stdout.write(text);
  };
  serverChild.stdout.on("data", remember);
  serverChild.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    serverLog = (serverLog + text).slice(-8000);
    process.stderr.write(text);
  });

  serverChild.on("exit", (code, signal) => {
    serverChild = null;
    if (!app.isQuitting) {
      showServerFailure(`Pi Web server exited (code ${code ?? "null"}, signal ${signal ?? "none"}).`);
    }
  });

  serverChild.on("error", (error) => {
    showServerFailure(`Could not start Pi Web server: ${error.message}`);
  });
}

function stopServer() {
  if (!serverChild) return;
  const child = serverChild;
  serverChild = null;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    } else {
      // next dev spawns its own children; kill the group.
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/* ------------------------------------------------------------- splash/UI */

const SPLASH_TEMPLATE = (message) => `
<!doctype html><meta charset="utf-8">
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
  background:#111114;color:#e6e6e9;font:14px/1.6 -apple-system,Segoe UI,sans-serif">
<div style="text-align:center">
  <div style="font-size:20px;font-weight:600;margin-bottom:8px">Pi Web</div>
  <div style="opacity:.7">${escapeHtml(message)}</div>
</div>
</body>`;

const FAILURE_TEMPLATE = (message) => `
<!doctype html><meta charset="utf-8">
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
  background:#111114;color:#e6e6e9;font:14px/1.6 ui-monospace,Menlo,monospace">
<div style="max-width:720px;padding:24px">
  <div style="font-size:18px;font-weight:600;margin-bottom:12px">Pi Web 启动失败</div>
  <div style="opacity:.85;white-space:pre-wrap">${escapeHtml(message)}</div>
  <pre style="margin-top:16px;padding:12px;background:#000;border-radius:8px;overflow:auto;max-height:40vh;font-size:12px">${escapeHtml(serverLog.slice(-4000) || "(no output)")}</pre>
</div>
</body>`;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function loadHtml(html) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function showSplash(message) {
  loadHtml(SPLASH_TEMPLATE(message));
}

function showServerFailure(message) {
  loadHtml(FAILURE_TEMPLATE(message));
}

/* ---------------------------------------------------------------- window */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#111114",
    title: "Pi Web",
    // hiddenInset keeps the lights inside the window; TITLEBAR_CSS then keeps the
    // page content out from under them. A plain native title bar (the fallback)
    // needs neither.
    ...(INSET_TITLEBAR
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: TRAFFIC_LIGHT_POSITION }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (INSET_TITLEBAR) {
    // insertCSS applies to the current document only, so re-apply after every
    // navigation. Skip the data: URL splash screens.
    //
    // The inline layout is always installed (its selectors are inert when the
    // markup differs). The strip fallback is only added after the brand row has
    // stayed unrecognized for a while, and is removed again as soon as the row
    // shows up. A one-shot probe at load time would lock in the strip whenever
    // the page loaded mid-compile or before the header rendered.
    let titlebarWatch = null;
    const applyTitlebarCss = async () => {
      if (titlebarWatch) clearInterval(titlebarWatch);
      titlebarWatch = null;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const contents = mainWindow.webContents;
      if (!contents.getURL().startsWith("http")) return;
      await contents.insertCSS(INLINE_TITLEBAR_CSS);
      await contents.insertCSS(DRAG_REGION_CSS);

      let stripKey = null;
      let missingSince = Date.now();
      let busy = false;
      const check = async () => {
        if (busy || !mainWindow || mainWindow.isDestroyed()) return;
        busy = true;
        try {
          const matched = await contents.executeJavaScript(BRAND_ROW_PROBE).catch(() => false);
          if (matched) {
            if (missingSince !== null) console.log("[pi-web] title bar: traffic lights inline with the sidebar header");
            missingSince = null;
            if (stripKey) {
              await contents.removeInsertedCSS(stripKey).catch(() => {});
              stripKey = null;
            }
          } else {
            missingSince ??= Date.now();
            if (!stripKey && Date.now() - missingSince >= STRIP_FALLBACK_DELAY_MS) {
              console.warn("[pi-web] sidebar header not recognized; reserving a title bar strip");
              stripKey = await contents.insertCSS(STRIP_TITLEBAR_CSS);
            }
          }
        } finally {
          busy = false;
        }
      };
      await check();
      titlebarWatch = setInterval(check, TITLEBAR_CHECK_INTERVAL_MS);
    };
    mainWindow.webContents.on("did-finish-load", applyTitlebarCss);
    mainWindow.on("closed", () => {
      if (titlebarWatch) clearInterval(titlebarWatch);
      titlebarWatch = null;
    });
  }

  // Layout check for the inset title bar. Run with PI_WEB_DEBUG_LAYOUT=1 to print,
  // for both sidebar states, whether any control lands under the traffic lights.
  if (process.env.PI_WEB_DEBUG_LAYOUT === "1") {
    mainWindow.webContents.on("did-finish-load", async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (!mainWindow.webContents.getURL().startsWith("http")) return;
      await new Promise((resolve) => setTimeout(resolve, 4000));

      mainWindow.show();
      mainWindow.focus();
      const box = trafficLightBox();

      const inspect = `(() => {
        const box = ${JSON.stringify(box)};
        const hit = (r) => !(r.right <= box.x || r.left >= box.x + box.width || r.bottom <= box.y || r.top >= box.y + box.height);
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom) };
        };
        // Every visible control in the strip the lights occupy.
        const controls = Array.from(document.querySelectorAll("button, input, a, [role=button]"))
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => ({ label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 20), rect: rect(el) }))
          .filter((c) => hit(c.rect));
        // Every element in the top band, to pick drag-region selectors.
        const band = [];
        const walk = (el, depth) => {
          if (!el || depth > 5) return;
          const r = el.getBoundingClientRect();
          if (r.top > 40 || r.width === 0 || r.height === 0) return;
          band.push({
            depth,
            path: el.id ? "#" + el.id : (el.className && typeof el.className === "string" ? "." + el.className.split(" ").filter(Boolean).slice(0, 2).join(".") : el.tagName.toLowerCase()),
            tag: el.tagName.toLowerCase(),
            rect: rect(el),
          });
          Array.from(el.children).forEach((c) => walk(c, depth + 1));
        };
        const root = document.querySelector("body > div:nth-of-type(2)") || document.querySelector("body > div:last-of-type");
        if (root) walk(root, 0);
        return {
          lightBox: box,
          bodyPaddingTop: getComputedStyle(document.body).paddingTop,
          overlapping: controls,
          topBand: band,
          dragRegions: [
            "#session-sidebar > div:nth-child(1) > div:nth-child(1)",
            "#session-sidebar > div:nth-child(1) > div:nth-child(1) > div:nth-child(1)",
            "div:has(> div > .chat-content) > div:first-child",
            "#file-panel > div:first-child",
          ].map((sel) => {
            const el = document.querySelector(sel);
            return { sel, region: el ? getComputedStyle(el).getPropertyValue("-webkit-app-region").trim() || "none" : "MISSING" };
          }),
          controlRegion: (() => {
            const b = document.querySelector("#session-sidebar button[title]");
            return b ? getComputedStyle(b).getPropertyValue("-webkit-app-region").trim() || "none" : "MISSING";
          })(),
          brandRegion: (() => {
            const el = document.querySelector("#session-sidebar > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > button:first-child");
            return el ? getComputedStyle(el).getPropertyValue("-webkit-app-region").trim() || "none" : "MISSING";
          })(),
        };
      })()`;

      const open = await mainWindow.webContents.executeJavaScript(inspect);
      console.log("[pi-web][layout:sidebar-open]", JSON.stringify(open, null, 2));

      // Collapse the sidebar and re-check: the center column's toggle button
      // moves to the window's left edge at that point.
      await mainWindow.webContents.executeJavaScript(
        `document.querySelector('#session-sidebar button')?.click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 800));
      const closed = await mainWindow.webContents.executeJavaScript(inspect);
      console.log("[pi-web][layout:sidebar-closed]", JSON.stringify(closed, null, 2));

      // Draw the light box so an external screenshot can be eyeballed too.
      if (INSET_TITLEBAR) {
        await mainWindow.webContents.insertCSS(`
          body::after {
            content: "";
            position: fixed;
            top: ${box.y}px;
            left: ${box.x}px;
            width: ${box.width}px;
            height: ${box.height}px;
            border: 1px dashed rgba(255,0,0,0.9);
            z-index: 2147483647;
            pointer-events: none;
          }
        `);
      }

      const bounds = mainWindow.getBounds();
      console.log("[pi-web][screenRect]", JSON.stringify({ bounds }));
      console.log(
        `[pi-web][screencapture] screencapture -x -o -R${bounds.x},${bounds.y},${bounds.width},${bounds.height} /tmp/pi-web-window.png`,
      );
    });
  }

  // Notification probe: PI_WEB_DEBUG_NOTIFY=1 reports what the renderer can do
  // and fires one notification from each of the two available paths.
  if (process.env.PI_WEB_DEBUG_NOTIFY === "1") {
    mainWindow.webContents.on("did-finish-load", async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (!mainWindow.webContents.getURL().startsWith("http")) return;
      await new Promise((resolve) => setTimeout(resolve, 4000));

      const js = (expr) => mainWindow.webContents.executeJavaScript(expr);
      const state = await js(`(() => ({
        hasNotification: "Notification" in window,
        permission: "Notification" in window ? Notification.permission : null,
        serviceWorker: "serviceWorker" in navigator,
        secureContext: window.isSecureContext,
      }))()`);
      console.log("[pi-web][notify:renderer-state]", JSON.stringify(state));

      console.log(
        "[pi-web][notify:sw-registration]",
        await js(`navigator.serviceWorker.getRegistration().then((r) => r ? "registered" : "none").catch((e) => "error: " + e.message)`),
      );
      console.log(
        "[pi-web][notify:sw-showNotification]",
        await js(`navigator.serviceWorker.getRegistration()
          .then((r) => r ? r.showNotification("Pi Web sw 测试", { body: "service worker 路径" }).then(() => "ok").catch((e) => "throw: " + e.message) : "no registration")
          .catch((e) => "error: " + e.message)`),
      );
      console.log("[pi-web][notify:notifier]", resolveTerminalNotifier() || "none");
      console.log(
        "[pi-web][notify:page-path]",
        await js(`(() => { try { new Notification("Pi Web 页面路径测试", { body: "走 window.Notification shim", tag: "pi-web-debug" }); return "ok"; } catch (e) { return "throw: " + e.message; } })()`),
      );

      // Exercise the whole badge path (localStorage -> shim -> IPC -> dock) and
      // put the stored value back so the app's unread state is untouched.
      const UNREAD = JSON.stringify("pi-web:unread-session-ids");
      console.log(
        "[pi-web][badge:after-notify]",
        `unread=${unreadSessionCount} pending=${pendingAttention.size} tile=${readDockBadge()}`,
      );
      const original = await js(`window.localStorage.getItem(${UNREAD})`);
      await js(`window.localStorage.setItem(${UNREAD}, JSON.stringify(["__probe_a__", "__probe_b__"]))`);
      await new Promise((resolve) => setTimeout(resolve, 700));
      console.log(
        "[pi-web][badge:after-unread]",
        `unread=${unreadSessionCount} pending=${pendingAttention.size} tile=${readDockBadge()}`,
      );
      await js(
        original === null
          ? `window.localStorage.removeItem(${UNREAD})`
          : `window.localStorage.setItem(${UNREAD}, ${JSON.stringify(original)})`,
      );
      await new Promise((resolve) => setTimeout(resolve, 700));
      console.log(
        "[pi-web][badge:restored]",
        `unread=${unreadSessionCount} pending=${pendingAttention.size} tile=${readDockBadge()}`,
      );

      // Focusing the window is what clears the attention half.
      mainWindow.show();
      mainWindow.focus();
      await new Promise((resolve) => setTimeout(resolve, 800));
      console.log(
        "[pi-web][badge:after-focus]",
        `unread=${unreadSessionCount} pending=${pendingAttention.size} tile=${readDockBadge()}`,
      );
    });
  }

  // Links that ask for a new window go to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Coming back to the window is the signal that the user has seen whatever the
  // dock badge was counting.
  mainWindow.on("focus", () => {
    if (pendingAttention.size === 0) return;
    pendingAttention.clear();
    refreshDockBadge();
  });

  // Re-run after every document load; the shim is idempotent. Next.js client-side
  // navigation keeps the same document, so the shim stays installed.
  const applyRendererShim = async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.webContents.getURL().startsWith("http")) return;
    try {
      const result = await mainWindow.webContents.executeJavaScript(RENDERER_SHIM);
      if (result !== "ok" && result !== "already") {
        console.warn(`[pi-web] renderer shim not applied: ${result}`);
      }
    } catch (error) {
      console.warn(`[pi-web] renderer shim failed: ${error.message}`);
    }
  };
  mainWindow.webContents.on("dom-ready", applyRendererShim);

  showSplash("正在启动本地服务…");
}

async function boot() {
  PROJECT_DIR = resolveProjectDir();
  console.log(`[pi-web] project directory: ${PROJECT_DIR}`);

  ipcMain.handle("pi-web:notify", (_event, payload) => deliverNotification(payload ?? {}));
  ipcMain.handle("pi-web:badge", (_event, count) => {
    const parsed = Number(count);
    unreadSessionCount = Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
    refreshDockBadge();
  });

  createWindow();

  const alreadyRunning = await isPortOpen(HOST, PORT);
  if (alreadyRunning) {
    console.log(`[pi-web] reusing server already listening on ${APP_URL}`);
  } else if (!fs.existsSync(path.join(PROJECT_DIR, "package.json"))) {
    showServerFailure(
      `Pi Web source not found at:\n${PROJECT_DIR}\n\n` +
        `Set the path in ${path.join(app.getPath("userData"), "pi-web-project.json")} ` +
        `as {"projectDir": "/path/to/pi-web"}, or export PI_WEB_PROJECT.`,
    );
    return;
  } else {
    startServer();
    const ready = await waitForPort(HOST, PORT, 120000);
    if (!ready) {
      showServerFailure(`Timed out waiting for http://${HOST}:${PORT}.`);
      return;
    }
  }

  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    await mainWindow.loadURL(APP_URL);
  } catch (error) {
    showServerFailure(`Could not load ${APP_URL}: ${error.message}`);
  }
}

/* ------------------------------------------------------------------ lifecycle */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(boot);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
    stopServer();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
