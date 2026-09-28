"use strict";

/**
 * Bridge between the Pi Web page and the Electron main process.
 *
 * The page keeps using the standard Web Notification API; main.cjs replaces
 * `window.Notification` with a shim that forwards here. Nothing in the app has
 * to know it is running inside Electron.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piWebDesktop", {
  platform: process.platform,
  notify: (payload) => ipcRenderer.invoke("pi-web:notify", payload),
  setBadge: (count) => ipcRenderer.invoke("pi-web:badge", count),
});
