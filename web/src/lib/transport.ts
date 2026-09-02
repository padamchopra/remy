import { codeFor, isDeviceIcon, loadAppearance, saveAppearance, type DeviceIconId } from "~/lib/devices";
import { isTint, type TintId } from "~/lib/tints";
import type { Server } from "~/state/types";

/// How the UI reaches a Remy server.
///
/// Two implementations, because the app runs in two places:
///
///   - **Electron.** The main process owns the connection and the token. The
///     renderer asks over IPC. This is the real one, and it exists because the
///     server sends no CORS headers and authorises the `/notify/stream`
///     upgrade with a header a browser `WebSocket` cannot set.
///
///   - **A plain browser.** Vite proxies `/api` to the server and injects the
///     bearer header, so the same UI runs at `localhost:5173` for development
///     and for the screenshot harness. Same-origin, so CORS never applies.
///
/// Both speak the same interface, so no component knows which one it has.

export interface Transport {
  readonly kind: "electron" | "proxy";
  servers(): Promise<Server[]>;
  request<T>(serverId: string, path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  upload<T>(serverId: string, path: string, input: { file: File }): Promise<T>;
  /// Live frames. Returns an unsubscribe.
  subscribe(handler: (serverId: string, payload: unknown) => void, topics: readonly string[]): () => void;
  onStatus(handler: (serverId: string, online: boolean, error?: string) => void): () => void;
  addServer(input: { url: string; token: string; name?: string }): Promise<void>;
  removeServer(id: string): Promise<void>;
  updateServer(id: string, patch: { name?: string; icon?: DeviceIconId; tint?: TintId }): Promise<void>;
}

/// A transport that only knows the daemon on this machine. Pairing is not its
/// job: `withPeers` adds that, in one place, for both platforms.
type LocalTransport = Omit<Transport, "addServer">;

/// A paired machine, as the daemon on this one describes it.
interface WirePeer {
  id: string;
  name: string;
  url: string;
  icon?: string;
  tint?: string;
  notify?: boolean;
  online?: boolean;
  lastSeen?: number;
}

interface CursorCloudStatus {
  configured?: boolean;
  visible?: boolean;
  enabled?: boolean;
}

function toCursorCloudServer(status: CursorCloudStatus): Server {
  return {
    id: "cursor-cloud",
    name: "Cursor Cloud",
    url: "cursor://cloud",
    code: "CLOUD",
    online: true,
    icon: "cloud",
    cloud: true,
    workspaceOnly: true,
    cloudConnected: status.configured === true && status.enabled !== false,
  };
}

function toPeerServer(peer: WirePeer): Server {
  const appearance = loadAppearance()[peer.id];
  const name = appearance?.name || peer.name;
  return {
    id: peer.id,
    name,
    url: peer.url,
    code: codeFor(name),
    online: peer.online === true,
    icon: appearance?.icon ?? (isDeviceIcon(peer.icon) ? peer.icon : "laptop"),
    ...(appearance?.tint
      ? { tint: appearance.tint }
      : isTint(peer.tint)
        ? { tint: peer.tint }
        : {}),
    peer: true,
    notify: peer.notify === true,
    ...(peer.lastSeen ? { lastSeen: peer.lastSeen } : {}),
  };
}

/// Adds the machines this one is paired with to a transport that only knows how
/// to reach the daemon here.
///
/// Pairing lives in the daemon, so the list is the same whichever window is
/// asking — pair once on this machine and the desktop app, the browser and the
/// phone all see it. Reaching a paired machine goes back out through that same
/// daemon: it is the only side holding the other machine's token, and a browser
/// could not call the other machine directly in any case.
function withPeers(base: LocalTransport): Transport {
  let localId: string | undefined;
  let peerIds = new Set<string>();
  let hasCursorCloud = false;
  // Three requests answer "which machines are there": health, the pairings,
  // and whether Cursor Cloud is on. Every read the window does begins by
  // asking, and a write asks twice over — once for its own read-back, once for
  // the frame the daemon sends afterwards. Callers in the same moment share one
  // answer instead; the store's poll is shorter-lived than nothing and longer
  // than this, so a machine that appears or goes still shows up on the next
  // round rather than being cached out of sight.
  const LIST_TTL_MS = 2_000;
  let listed: { at: number; servers: Server[] } | undefined;
  let listing: Promise<Server[]> | undefined;

  const localOf = (servers: Server[]) => servers.find((server) => server.local)?.id ?? servers[0]?.id;

  const home = async (): Promise<string> => {
    if (!localId) localId = localOf(await base.servers());
    if (!localId) throw new Error("Remy is still starting on this machine.");
    return localId;
  };

  return {
    ...base,

    servers() {
      if (listed && Date.now() - listed.at < LIST_TTL_MS) return Promise.resolve(listed.servers);
      listing ??= readServers()
        .then((servers) => {
          listed = { at: Date.now(), servers };
          return servers;
        })
        .finally(() => {
          listing = undefined;
        });
      return listing;
    },

    subscribe(handler, topics) {
      return base.subscribe((serverId, payload) => {
        const frame = payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload as { type?: unknown; serverId?: unknown; payload?: unknown }
          : undefined;
        if (frame?.type === "peer-frame" && typeof frame.serverId === "string") {
          handler(frame.serverId, frame.payload);
          return;
        }
        handler(serverId, payload);
      }, topics);
    },

    request<T>(serverId: string, path: string, init?: { method?: string; body?: unknown }) {
      if (serverId === "cursor-cloud" && hasCursorCloud && localId) {
        return base.request<T>(localId, `/cursor-cloud/api${path}`, init);
      }
      if (!peerIds.has(serverId) || !localId) return base.request<T>(serverId, path, init);
      return base.request<T>(localId, `/peers/${encodeURIComponent(serverId)}/api${path}`, init);
    },

    upload<T>(serverId: string, path: string, input: { file: File }) {
      if (serverId === "cursor-cloud" && hasCursorCloud && localId) {
        return base.upload<T>(localId, `/cursor-cloud/api${path}`, input);
      }
      if (!peerIds.has(serverId) || !localId) return base.upload<T>(serverId, path, input);
      return base.upload<T>(localId, `/peers/${encodeURIComponent(serverId)}/api${path}`, input);
    },

    async addServer(input) {
      await base.request(await home(), "/peers", { method: "POST", body: input });
      listed = undefined;
    },

    async removeServer(id) {
      listed = undefined;
      if (id === "cursor-cloud") throw new Error("Disconnect Cursor Cloud in Providers.");
      if (!peerIds.has(id)) return base.removeServer(id);
      await base.request(await home(), `/peers/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    async updateServer(id, patch) {
      listed = undefined;
      if (id === "cursor-cloud") return;
      // How a device looks is this window's business; what it is called is the
      // daemon's, so a rename reaches the other windows too.
      saveAppearance(id, patch);
      if (!peerIds.has(id)) return base.updateServer(id, patch);
      const body: Record<string, unknown> = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.icon !== undefined) body.icon = patch.icon;
      if (patch.tint !== undefined) body.tint = patch.tint;
      if (Object.keys(body).length === 0) return;
      await base.request(await home(), `/peers/${encodeURIComponent(id)}`, { method: "PATCH", body });
    },

  };

  async function readServers(): Promise<Server[]> {
    const own = await base.servers();
    localId = localOf(own);
    if (!localId) {
      peerIds = new Set();
      return own;
    }
    let answer: {
      name?: string;
      icon?: string;
      tint?: string;
      configured?: { name?: boolean; icon?: boolean; tint?: boolean };
      peers?: WirePeer[];
    } = {};
    let cursorCloud: CursorCloudStatus = {};
    try {
      [answer, cursorCloud] = await Promise.all([
        base.request<typeof answer>(localId, "/peers"),
        base.request<CursorCloudStatus>(localId, "/cursor-cloud/status").catch(() => ({})),
      ]);
    } catch {
      // A daemon from before pairing landed has no /peers, which simply means
      // this machine is the only one.
    }
    const paired = answer.peers ?? [];
    hasCursorCloud = cursorCloud.visible === true;
    peerIds = new Set(paired.map((peer) => peer.id));
    const ownIdentity = own.map((server) => {
      if (server.id !== localId) return server;
      const name = answer.configured?.name && answer.name ? answer.name : server.name;
      const icon = answer.configured?.icon && isDeviceIcon(answer.icon) ? answer.icon : server.icon;
      const tint = answer.configured?.tint && isTint(answer.tint) ? answer.tint : server.tint;
      return {
        ...server,
        name,
        code: codeFor(name),
        icon,
        ...(tint ? { tint } : {}),
      };
    });
    // A machine the desktop app paired the old way is already in `own`; it
    // must not appear a second time under its daemon-side id.
    const already = new Set(own.map((server) => server.url));
    const peers = paired.filter((peer) => !already.has(peer.url)).map(toPeerServer);
    return [...ownIdentity, ...peers, ...(hasCursorCloud ? [toCursorCloudServer(cursorCloud)] : [])];
  }
}

interface ListedServer {
  id: string;
  name: string;
  url: string;
  icon?: string;
  builtin?: boolean;
}

interface Bridge {
  platform: string;
  arch?: string;
  version?: string;
  info?: () => Promise<{ version: string; name: string; packaged?: boolean }>;
  downloadUpdate?(): Promise<void>;
  installUpdate?(): Promise<void>;
  onUpdateProgress?(handler: (progress: { received: number; total: number }) => void): () => void;
  servers(): Promise<ListedServer[]>;
  request(
    serverId: string,
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
  upload?(
    serverId: string,
    path: string,
    input: { data: Uint8Array; filename: string; mimeType: string },
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
  onPush(handler: (serverId: string, payload: unknown) => void): () => void;
  setLiveTopics?(topics: string[]): Promise<void>;
  onStatus(handler: (serverId: string, online: boolean, error?: string) => void): () => void;
  /// Raises the desktop window. Absent in a browser, and on an older shell.
  focus?(): Promise<void>;
  /// Captures the window to a file, and answers with where it went.
  snapshot?(): Promise<string>;
  presentBrowser?(input: {
    serverId: string;
    chatId: string;
    browserId: string;
    visible: boolean;
    focused: boolean;
    bounds: { x: number; y: number; width: number; height: number };
  }): Promise<boolean>;
  openBrowserExternally?(url: string): Promise<void>;
  removeServer(id: string): Promise<ListedServer[]>;
  updateServer?(id: string, patch: { name?: string; icon?: string }): Promise<ListedServer[]>;
}

declare global {
  interface Window {
    missionControl?: Bridge;
    remy?: Bridge;
  }
}


function toServer(listed: ListedServer, online: boolean): Server {
  const appearance = loadAppearance()[listed.id];
  const name = appearance?.name || listed.name;
  const icon: DeviceIconId = appearance?.icon ?? (isDeviceIcon(listed.icon) ? listed.icon : "laptop");
  return {
    id: listed.id,
    name,
    url: listed.url,
    code: codeFor(name),
    online,
    icon,
    tint: appearance?.tint,
    local: listed.builtin,
  };
}

function electronTransport(bridge: Bridge): LocalTransport {
  const topicRefs = new Map<string, number>();
  const syncTopics = () => {
    void bridge.setLiveTopics?.([...topicRefs.keys()].sort());
  };
  return {
    kind: "electron",
    async servers() {
      const list = await bridge.servers();
      return list.map((item) => toServer(item, false));
    },
    async request<T>(serverId: string, path: string, init?: { method?: string; body?: unknown }) {
      const result = await bridge.request(serverId, path, init);
      if (!result.ok) throw new Error(result.error);
      return result.data as T;
    },
    async upload<T>(serverId: string, path: string, input: { file: File }) {
      if (!bridge.upload) throw new Error("Update Remy on this machine to attach images.");
      const data = new Uint8Array(await input.file.arrayBuffer());
      const result = await bridge.upload(serverId, path, {
        data,
        filename: input.file.name,
        mimeType: input.file.type,
      });
      if (!result.ok) throw new Error(result.error);
      return result.data as T;
    },
    subscribe(handler, topics) {
      const off = bridge.onPush(handler);
      for (const topic of topics) topicRefs.set(topic, (topicRefs.get(topic) ?? 0) + 1);
      syncTopics();
      return () => {
        off();
        for (const topic of topics) {
          const next = (topicRefs.get(topic) ?? 0) - 1;
          if (next > 0) topicRefs.set(topic, next);
          else topicRefs.delete(topic);
        }
        syncTopics();
      };
    },
    onStatus: (handler) => bridge.onStatus(handler),
    async removeServer(id) {
      await bridge.removeServer(id);
    },
    async updateServer(id, patch) {
      saveAppearance(id, patch);
      if (bridge.updateServer) await bridge.updateServer(id, patch);
    },
  };
}

/// The browser path. `/api` is proxied by Vite; `/api/notify/stream` upgrades
/// through the same proxy, so the token stays server-side there too.
function proxyTransport(): LocalTransport {
  let socket: WebSocket | undefined;
  const pushHandlers = new Set<(serverId: string, payload: unknown) => void>();
  const statusHandlers = new Set<(serverId: string, online: boolean, error?: string) => void>();
  // A single proxied server has no id of its own; everything is tagged "local"
  // so the shape matches the multi-server Electron case.
  const ID = "local";
  let attempt = 0;
  let closed = false;
  let streamId: string | undefined;
  let sequence: number | undefined;
  const topicRefs = new Map<string, number>();

  const liveTopics = () => [...topicRefs.keys()].sort();
  const syncTopics = () => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "subscribe", topics: liveTopics() }));
    }
  };

  const connect = () => {
    if (closed) return;
    const url = new URL("/api/notify/stream", window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("scoped", "1");
    for (const topic of liveTopics()) url.searchParams.append("topic", topic);
    if (sequence !== undefined) {
      url.searchParams.set("afterSequence", String(sequence));
      if (streamId) url.searchParams.set("streamId", streamId);
    }
    // Every handler below checks that this socket is still the current one.
    // Closing is asynchronous, so a socket torn down by an unsubscribe is still
    // delivering events while its replacement is already connecting — and its
    // close would otherwise schedule a *second* live socket. Two sockets means
    // the server counts this window twice and every notification arrives twice.
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return;
      attempt = 0;
      syncTopics();
      for (const handler of statusHandlers) handler(ID, true);
    };
    ws.onmessage = (event) => {
      if (socket !== ws) return;
      try {
        const payload: unknown = JSON.parse(String(event.data));
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          const frame = payload as { type?: unknown; streamId?: unknown; sequence?: unknown; reset?: unknown };
          if (frame.type === "hello") {
            const nextStream = typeof frame.streamId === "string" ? frame.streamId : undefined;
            if (frame.reset === true || (streamId !== undefined && nextStream !== streamId)) {
              sequence = typeof frame.sequence === "number" ? frame.sequence : undefined;
            } else if (sequence === undefined && typeof frame.sequence === "number") {
              sequence = frame.sequence;
            }
            streamId = nextStream;
          } else if (typeof frame.sequence === "number" && (sequence === undefined || frame.sequence > sequence)) {
            sequence = frame.sequence;
          }
        }
        for (const handler of pushHandlers) handler(ID, payload);
      } catch {
        // Not JSON; not worth dropping the socket over.
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      for (const handler of statusHandlers) handler(ID, false);
      if (closed) return;
      const delay = Math.min(500 * 2 ** attempt, 30_000);
      attempt += 1;
      setTimeout(connect, delay);
    };
  };

  return {
    kind: "proxy",
    async servers() {
      // This preview talks to exactly one server — the one Vite is proxying.
      // List it even when /health is down so a blip looks like "offline", not
      // "nothing is paired".
      const fallback = import.meta.env.VITE_REMY_PROXY_DEVICE ?? "";
      if (!fallback) return [];
      const listed = { id: ID, name: fallback, url: "/api", builtin: true };
      try {
        const response = await fetch("/api/health");
        if (!response.ok) throw new Error(String(response.status));
        return [toServer(listed, true)];
      } catch {
        return [toServer(listed, false)];
      }
    },
    async request<T>(_serverId: string, path: string, init?: { method?: string; body?: unknown }) {
      const response = await fetch(`/api${path}`, {
        method: init?.method ?? "GET",
        headers: init?.body === undefined ? {} : { "Content-Type": "application/json" },
        ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(text || `${response.status} ${response.statusText}`);
      return (text ? JSON.parse(text) : null) as T;
    },
    async upload<T>(_serverId: string, path: string, input: { file: File }) {
      const response = await fetch(`/api${path}`, {
        method: "POST",
        headers: {
          "Content-Type": input.file.type,
          "X-Filename": input.file.name,
        },
        body: input.file,
      });
      const text = await response.text();
      if (!response.ok) {
        let message = text || `${response.status} ${response.statusText}`;
        try {
          const parsed = JSON.parse(text) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          // Keep a short non-JSON response as the useful detail.
        }
        throw new Error(message);
      }
      return (text ? JSON.parse(text) : null) as T;
    },
    subscribe(handler, topics) {
      // `closed` has to be cleared here, not just set on teardown. React mounts
      // effects twice in development, so the first unsubscribe would otherwise
      // latch the socket shut for the life of the page and no push would ever
      // arrive again — which is what happened.
      closed = false;
      pushHandlers.add(handler);
      for (const topic of topics) topicRefs.set(topic, (topicRefs.get(topic) ?? 0) + 1);
      if (!socket) connect();
      else syncTopics();
      return () => {
        pushHandlers.delete(handler);
        for (const topic of topics) {
          const next = (topicRefs.get(topic) ?? 0) - 1;
          if (next > 0) topicRefs.set(topic, next);
          else topicRefs.delete(topic);
        }
        syncTopics();
        if (pushHandlers.size === 0) {
          closed = true;
          socket?.close();
          socket = undefined;
        }
      };
    },
    onStatus(handler) {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },
    async removeServer() {
      throw new Error("This machine stays connected while Remy is running.");
    },
    async updateServer(id, patch) {
      saveAppearance(id, patch);
    },
  };
}

const desktopBridge = window.remy ?? window.missionControl;

export const nativeBrowserSurface = {
  available: Boolean(desktopBridge?.presentBrowser),
  present: (input: {
    serverId: string;
    chatId: string;
    browserId: string;
    visible: boolean;
    focused: boolean;
    bounds: { x: number; y: number; width: number; height: number };
  }): Promise<boolean> => desktopBridge?.presentBrowser?.(input) ?? Promise.resolve(false),
  openExternal: (url: string): Promise<void> => desktopBridge?.openBrowserExternally?.(url)
    ?? Promise.resolve().then(() => { window.open(url, "_blank", "noopener,noreferrer"); }),
};

export const transport: Transport = withPeers(
  desktopBridge
    ? electronTransport(desktopBridge)
      : proxyTransport(),
);
