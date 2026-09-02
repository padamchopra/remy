import { writeFile } from "node:fs/promises";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir, hostname as osHostname } from "node:os";
import { join } from "node:path";
import {
  Connection,
  loadServers,
  saveServers,
  serversFile,
  type DeviceIcon,
  type ServerConfig,
} from "./connection";
import { ensureLocalServer, isLoopback, localTargetFromConfig, stopSpawnedServer } from "./local-server";
import { downloadUpdate, installUpdate } from "./update";

/// The desktop shell. Deliberately thin — it owns the window, starts the
/// bundled daemon, and holds the tokens. The UI stays a plain web app that can
/// be run and screenshotted in a browser without Electron in the way.

const DEV_SERVER = process.env.MC_DEV_SERVER_URL;
const isDev = Boolean(DEV_SERVER);

const LEGACY_USER_DATA = [
  join(homedir(), "Library/Application Support/remy-desktop"),
  join(homedir(), "Library/Application Support/Mission Control"),
];

function migrateUserData(): string {
  const current = app.getPath("userData");
  const db = join(current, "remy.db");
  if (existsSync(db)) return current;
  mkdirSync(current, { recursive: true });
  for (const dir of LEGACY_USER_DATA) {
    const from = join(dir, "remy.db");
    if (!existsSync(from)) continue;
    copyFileSync(from, db);
    break;
  }
  return current;
}

function webIndex(): string {
  if (app.isPackaged) return join(process.resourcesPath, "web/index.html");
  return join(__dirname, "../../web/dist/index.html");
}

function serverDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, "server");
  return join(__dirname, "../../server");
}

let connection: Connection | undefined;
let connectionReady: Promise<Connection> | undefined;
const remoteUpdates = new Set<string>();
const liveTopicsByWebContents = new Map<number, Set<string>>();

function syncLiveTopics(): void {
  const topics = new Set<string>();
  for (const owned of liveTopicsByWebContents.values()) {
    for (const topic of owned) topics.add(topic);
  }
  connection?.setTopics([...topics].sort());
}

function appUpdateRequest(payload: unknown): { requestId: string } | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = payload as { type?: unknown; action?: unknown; requestId?: unknown };
  if (value.type !== "app-update" || value.action !== "install-latest" || typeof value.requestId !== "string") {
    return undefined;
  }
  return { requestId: value.requestId };
}

async function reportRemoteUpdate(
  serverId: string,
  requestId: string,
  state: "downloading" | "installing" | "failed",
  error?: string,
): Promise<void> {
  try {
    await connection?.request(serverId, "/server/app-update", {
      method: "PATCH",
      body: { requestId, state, ...(error ? { error } : {}) },
    });
  } catch (caught) {
    console.warn("remy: could not report remote update state", caught);
  }
}

async function runRemoteUpdate(serverId: string, requestId: string): Promise<void> {
  if (remoteUpdates.has(requestId)) return;
  remoteUpdates.add(requestId);
  try {
    await reportRemoteUpdate(serverId, requestId, "downloading");
    await downloadUpdate();
    await reportRemoteUpdate(serverId, requestId, "installing");
    installUpdate();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Couldn't install the update.";
    await reportRemoteUpdate(serverId, requestId, "failed", message);
  } finally {
    remoteUpdates.delete(requestId);
  }
}

/// Bridges the connection to the renderer.
///
/// Everything crosses as plain JSON over IPC: the renderer asks for a path and
/// gets a body back, and pushes arrive as events. It never learns a token, and
/// it cannot reach a server the main process has not been told about.
///
/// Called once for the app, not once per window: `ipcMain.handle` throws on a
/// second registration for the same channel, so doing this in `createWindow`
/// would crash the moment a window was reopened from the dock.
function urlsMatch(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin;
  } catch {
    return a.replace(/\/$/, "") === b.replace(/\/$/, "");
  }
}

function withBuiltinLocal(existing: ServerConfig[], local: ServerConfig): ServerConfig[] {
  const match = existing.find((server) => urlsMatch(server.url, local.url));
  if (match) {
    return existing.map((server) =>
      server.id === match.id ? { ...server, token: local.token || server.token, builtin: true } : server,
    );
  }
  return [{ ...local, builtin: true }, ...existing];
}

async function openConnection(configPath: string): Promise<Connection> {
  let servers = loadServers(configPath);
  const envUrl = process.env.MC_SERVER_URL;
  if (!envUrl || isLoopback(envUrl)) {
    const target = await ensureLocalServer(serverDir(), localTargetFromConfig(), {
      electronNode: app.isPackaged,
      persistent: app.isPackaged && process.platform === "darwin",
      release: app.getVersion(),
    });
    if (target.token) {
      servers = withBuiltinLocal(servers, {
        id: "local",
        name: osHostname().replace(/\.local$/, ""),
        url: target.url,
        token: target.token,
        icon: "laptop",
        builtin: true,
      });
      if (!envUrl) saveServers(configPath, servers);
    }
  }
  return new Connection(servers, {
    version: app.getVersion(),
    arch: process.arch,
    updates: app.isPackaged,
  });
}

async function requireConnection(): Promise<Connection> {
  if (!connectionReady) throw new Error("no connection");
  return connectionReady;
}

async function wireIpc(): Promise<void> {
  const configPath = serversFile(migrateUserData());
  connectionReady = openConnection(configPath);

  // Broadcast rather than target one window, so a reopened window still
  // receives pushes without re-wiring anything.
  const send = (channel: string, ...args: unknown[]) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, ...args);
    }
  };
  connectionReady.then((ready) => {
    connection = ready;
    ready.on("push", (serverId: string, payload: unknown) => {
      const requested = appUpdateRequest(payload);
      const target = connection?.configs().find((server) => server.id === serverId);
      if (requested && target?.builtin) {
        void runRemoteUpdate(serverId, requested.requestId);
        return;
      }
      send("mc:push", serverId, payload);
    });
    ready.on("status", (serverId: string, online: boolean, error?: string) =>
      send("mc:status", serverId, online, error),
    );
    ready.start();
  }).catch((error) => console.error("remy: could not open connections", error));

  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    name: app.getName(),
    packaged: app.isPackaged,
  }));

  ipcMain.handle("app:download-update", async () => {
    await downloadUpdate();
  });

  ipcMain.handle("app:install-update", async () => {
    await installUpdate();
  });

  ipcMain.handle("mc:servers", async () => (await requireConnection()).list());
  ipcMain.handle("mc:set-live-topics", async (event, topics: string[]) => {
    await requireConnection();
    const id = event.sender.id;
    if (!liveTopicsByWebContents.has(id)) {
      event.sender.once("destroyed", () => {
        liveTopicsByWebContents.delete(id);
        syncLiveTopics();
      });
    }
    liveTopicsByWebContents.set(id, new Set(Array.isArray(topics) ? topics : []));
    syncLiveTopics();
  });

  // A real capture of the window, written where macOS puts screenshots. The
  // renderer cannot do this: it can only draw what it can already reach, which
  // is not the same picture.
  ipcMain.handle("mc:snapshot", async () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("no window to capture");
    const image = await window.webContents.capturePage();
    const size = image.getSize();
    const scale = 3840 / Math.max(size.width, size.height);
    const fourKImage = image.resize({
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
      quality: "best",
    });
    const stamp = new Date()
      .toLocaleString("sv", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .replace(/[: ]/g, (match) => (match === " " ? " at " : "."));
    const file = join(app.getPath("desktop"), `Remy ${stamp}.png`);
    await writeFile(file, fourKImage.toPNG());
    return file;
  });

  // Raising the window is the main process's job; the renderer can only focus
  // the page inside it.
  ipcMain.handle("mc:focus", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    app.focus({ steal: true });
  });

  ipcMain.handle("mc:add-server", async (_event, input: { url: string; token: string; name?: string }) => {
    const connection = await requireConnection();
    const url = input.url.trim();
    const token = input.token.trim();
    if (!url || !token) throw new Error("url and token are required");
    let hostname = url;
    try {
      hostname = new URL(url).hostname || url;
    } catch {
      // Keep the raw string as the name if it isn't a URL yet.
    }
    const existing = connection.configs();
    const id = existing.find((server) => server.url === url)?.id ?? crypto.randomUUID();
    const next = [
      ...existing.filter((server) => server.url !== url),
      { id, name: input.name?.trim() || hostname, url, token },
    ];
    saveServers(configPath, next);
    connection.replace(next);
    return connection.list();
  });

  ipcMain.handle("mc:remove-server", async (_event, id: string) => {
    const connection = await requireConnection();
    const target = connection.configs().find((server) => server.id === id);
    if (target?.builtin) throw new Error("This machine stays connected while Remy is running.");
    const next = connection.configs().filter((server) => server.id !== id);
    saveServers(configPath, next);
    connection.replace(next);
    return connection.list();
  });

  ipcMain.handle("mc:update-server", async (_event, id: string, patch: { name?: string; icon?: DeviceIcon }) => {
    const connection = await requireConnection();
    connection.update(id, patch);
    saveServers(configPath, connection.configs());
    return connection.list();
  });

  ipcMain.handle(
    "mc:request",
    async (_event, serverId: string, path: string, init?: { method?: string; body?: unknown }) => {
      const connection = await requireConnection();
      // Errors are returned rather than thrown across IPC so the renderer gets
      // the server's message instead of Electron's serialisation of it.
      try {
        return { ok: true as const, data: await connection.request(serverId, path, init ?? {}) };
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  ipcMain.handle(
    "mc:upload",
    async (
      _event,
      serverId: string,
      path: string,
      input: { data: Uint8Array; filename: string; mimeType: string },
    ) => {
      const connection = await requireConnection();
      try {
        return { ok: true as const, data: await connection.upload(serverId, path, input) };
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  ipcMain.handle("mc:set-servers", async (_event, servers: ServerConfig[]) => {
    const connection = await requireConnection();
    saveServers(configPath, servers);
    connection.replace(servers);
    return connection.list();
  });
}

const RENDERER_RECOVERY_LIMIT = 2;
const RENDERER_RECOVERY_WINDOW_MS = 60_000;

function createWindow(): void {
  const recoveries: number[] = [];
  const window = new BrowserWindow({
    title: "Remy",
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 560,
    show: false,
    paintWhenInitiallyHidden: true,
    // `hiddenInset` keeps the native traffic lights but lets the app draw its
    // own titlebar strip behind them. The offset matches T3's, and the web side
    // reserves the space with --titlebar-traffic-light-inset.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    // Matches --background, so the first paint isn't a white flash.
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // The hidden renderer gets a normal foreground slice through first paint.
  // Once the useful frame is visible it returns to Electron's normal hidden
  // window throttling instead of continuing to consume foreground resources.
  window.once("ready-to-show", () => {
    window.webContents.setBackgroundThrottling(true);
    window.show();
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    if (window.isDestroyed() || details.reason === "clean-exit") return;
    const now = Date.now();
    while (recoveries[0] !== undefined && now - recoveries[0] > RENDERER_RECOVERY_WINDOW_MS) {
      recoveries.shift();
    }
    if (recoveries.length >= RENDERER_RECOVERY_LIMIT) {
      console.error("remy: renderer recovery limit reached", details.reason);
      return;
    }
    recoveries.push(now);
    console.warn("remy: recovering renderer", details.reason, recoveries.length);
    window.webContents.reload();
  });

  // External links belong in the browser, not in a chrome-less app window with
  // no way back.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    void window.loadURL(DEV_SERVER!);
  } else {
    void window.loadFile(webIndex());
  }
}

void app.setName("Remy");

void app.whenReady().then(() => {
  void wireIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  connection?.stop();
  stopSpawnedServer();
});
