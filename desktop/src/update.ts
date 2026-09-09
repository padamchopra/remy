import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";

/// GitHub Releases, through electron-updater. The DMG is for a first install;
/// the zip + `latest-mac.yml` on the same release is what actually replaces
/// this copy. A renderer `<a href>` on the DMG is what opened Chrome's save
/// dialog.

export type UpdateProgress = { received: number; total: number };

let configured = false;
let downloaded = false;
let pendingDownload: Promise<void> | undefined;
let lastProgressAt = 0;

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function configure(): void {
  if (configured) return;
  configured = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("download-progress", (progress) => {
    const now = Date.now();
    if (now - lastProgressAt < 80 && progress.transferred !== progress.total) return;
    lastProgressAt = now;
    broadcast("app:update-progress", {
      received: progress.transferred,
      total: progress.total,
    } satisfies UpdateProgress);
  });
  autoUpdater.on("update-downloaded", () => {
    downloaded = true;
  });
}

/// Pulls the zip from the GitHub feed. The UI still reads release notes from
/// the API; the bytes come from `latest-mac.yml` so the installer is the one
/// electron-updater knows how to apply.
export function downloadUpdate(): Promise<void> {
  if (downloaded) return Promise.resolve();
  if (!pendingDownload) pendingDownload = fetchUpdate().finally(() => { pendingDownload = undefined; });
  return pendingDownload;
}

async function fetchUpdate(): Promise<void> {
  if (!app.isPackaged) throw new Error("Updates install from the shipped Remy app.");
  configure();
  downloaded = false;
  lastProgressAt = 0;
  try {
    const check = await autoUpdater.checkForUpdates();
    if (!check?.isUpdateAvailable) throw new Error("You're on the latest version.");
    await autoUpdater.downloadUpdate();
    if (!downloaded) throw new Error("Couldn't download the update.");
  } catch (caught) {
    downloaded = false;
    if (caught instanceof Error && caught.message === "You're on the latest version.") throw caught;
    console.warn("remy: update download failed", caught);
    throw new Error("Couldn't download the update.");
  }
}

/// Hands off to electron-updater's Mac installer, which quits, swaps this .app,
/// and relaunches. Replacing the bundle ourselves is what the DMG helper was.
export function installUpdate(): void {
  if (!app.isPackaged) throw new Error("Updates install from the shipped Remy app.");
  if (!downloaded) throw new Error("Download the update first.");
  configure();
  autoUpdater.quitAndInstall(true, true);
}
