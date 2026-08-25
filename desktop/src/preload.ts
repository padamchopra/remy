import { contextBridge, ipcRenderer } from "electron";

/// The renderer's whole view of the outside world.
///
/// Deliberately narrow: a path and a method, never a URL and never a token. The
/// main process owns which servers exist and how to authenticate to them, so
/// the UI cannot be talked into reaching somewhere else.
contextBridge.exposeInMainWorld("remy", {
  platform: process.platform,
  arch: process.arch,
  version: process.env.npm_package_version,

  info: (): Promise<{ version: string; name: string; packaged: boolean }> => ipcRenderer.invoke("app:info"),

  /// Main process pulls the zip from GitHub's updater feed and later swaps
  /// this .app for it. A renderer `<a href>` on the DMG is what opened Chrome.
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke("app:download-update"),
  installUpdate: (): Promise<void> => ipcRenderer.invoke("app:install-update"),
  onUpdateProgress: (handler: (progress: { received: number; total: number }) => void) => {
    const listener = (_event: unknown, progress: { received: number; total: number }) => handler(progress);
    ipcRenderer.on("app:update-progress", listener);
    return () => ipcRenderer.off("app:update-progress", listener);
  },

  servers: (): Promise<{ id: string; name: string; url: string; icon?: string; builtin?: boolean }[]> =>
    ipcRenderer.invoke("mc:servers"),

  setServers: (
    servers: { id: string; name: string; url: string; token: string }[],
  ): Promise<{ id: string; name: string; url: string }[]> =>
    ipcRenderer.invoke("mc:set-servers", servers),

  addServer: (input: {
    url: string;
    token: string;
    name?: string;
  }): Promise<{ id: string; name: string; url: string }[]> => ipcRenderer.invoke("mc:add-server", input),

  removeServer: (id: string): Promise<{ id: string; name: string; url: string; icon?: string; builtin?: boolean }[]> =>
    ipcRenderer.invoke("mc:remove-server", id),

  updateServer: (
    id: string,
    patch: { name?: string; icon?: string },
  ): Promise<{ id: string; name: string; url: string; icon?: string; builtin?: boolean }[]> =>
    ipcRenderer.invoke("mc:update-server", id, patch),

  request: (
    serverId: string,
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> =>
    ipcRenderer.invoke("mc:request", serverId, path, init),

  upload: (
    serverId: string,
    path: string,
    input: { data: Uint8Array; filename: string; mimeType: string },
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> =>
    ipcRenderer.invoke("mc:upload", serverId, path, input),

  /// Live frames from `/notify/stream`. Returns an unsubscribe.
  onPush: (handler: (serverId: string, payload: unknown) => void) => {
    const listener = (_event: unknown, serverId: string, payload: unknown) =>
      handler(serverId, payload);
    ipcRenderer.on("mc:push", listener);
    return () => ipcRenderer.off("mc:push", listener);
  },

  /// Brings the window forward. A notification click can focus the page on its
  /// own, but only the main process can raise the window itself.
  focus: (): Promise<void> => ipcRenderer.invoke("mc:focus"),

  /// Captures the window to a PNG on the desktop, and answers with its path.
  snapshot: (): Promise<string> => ipcRenderer.invoke("mc:snapshot"),

  onStatus: (handler: (serverId: string, online: boolean, error?: string) => void) => {
    const listener = (_event: unknown, serverId: string, online: boolean, error?: string) =>
      handler(serverId, online, error);
    ipcRenderer.on("mc:status", listener);
    return () => ipcRenderer.off("mc:status", listener);
  },
});
