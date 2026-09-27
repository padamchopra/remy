import { codeFor, isDeviceIcon, loadAppearance, type DeviceIconId } from "~/lib/devices";
import type { Server } from "~/state/types";
import { isHostedRuntime } from "./hub-session";

/// How the shared thread components reach a daemon.
///
/// The web app is the hosted app, where `servers()` is empty and threads go
/// through the hub instead. The website's product preview replaces this module
/// with `web/website/demo/transport.ts`. What remains is the same-origin `/api`
/// shape those components were written against.

export interface Transport {
  readonly kind: "proxy";
  servers(): Promise<Server[]>;
  request<T>(serverId: string, path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  upload<T>(serverId: string, path: string, input: { file: File }): Promise<T>;
  /// Live frames. Returns an unsubscribe.
  subscribe(handler: (serverId: string, payload: unknown) => void, topics: readonly string[]): () => void;
  onStatus(handler: (serverId: string, online: boolean, error?: string) => void): () => void;
}

interface ListedServer {
  id: string;
  name: string;
  url: string;
  icon?: string;
  builtin?: boolean;
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

/// The browser path. `/api` is proxied by Vite; `/api/notify/stream` upgrades
/// through the same proxy, so the token stays server-side there too.
function proxyTransport(): Transport {
  let socket: WebSocket | undefined;
  const pushHandlers = new Set<(serverId: string, payload: unknown) => void>();
  const statusHandlers = new Set<(serverId: string, online: boolean, error?: string) => void>();
  // A single proxied server has no id of its own; everything is tagged "local".
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
      if (isHostedRuntime()) return [];
      // This preview talks to exactly one server — the one Vite is proxying.
      // List it even when /health is down so a blip looks like "offline", not
      // "nothing is there".
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
  };
}

/// A page draws the shared browser itself. A native surface over the top of it
/// belonged to the desktop shell.
export const nativeBrowserSurface = {
  available: false,
  present: (_input: {
    serverId: string;
    chatId: string;
    browserId: string;
    visible: boolean;
    focused: boolean;
    bounds: { x: number; y: number; width: number; height: number };
  }): Promise<boolean> => Promise.resolve(false),
  openExternal: (url: string): Promise<void> => Promise.resolve().then(() => { window.open(url, "_blank", "noopener,noreferrer"); }),
};

export const transport: Transport = proxyTransport();

/// Hosted reads carry the organization in the path and use the same-origin session cookie.
export const hubTransport = {
  kind: "hub" as const,
  async request(path: string, method = "GET", body?: unknown): Promise<Response> {
    if (!/^\/api\/(organizations(?:\/[^/]+(?:\/.*)?)?|auth\/.*|sessions(?:\/.*)?|profile|personal|review-rules(?:[/?].*)?|device\/.*|invitations\/(?:accept|preview))$/.test(path) || path.includes("..")) throw new Error("Open this page in Remy.");
    return fetch(path, { method, credentials: "same-origin", headers: body === undefined ? {} : { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  },
};
