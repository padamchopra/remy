import { httpError } from "./api-error";
import { appearanceOf, codeFor, isDeviceIcon, saveAppearance, type DeviceIconId } from "./devices";
import { hostLabel } from "./pairing";
import { directId, originOf, type Pairing } from "./session";
import { isTint, type TintId } from "./tints";
import type { Server } from "../state/types";

export interface Transport {
  pairings(): Pairing[];
  setPairings(next: Pairing[]): void;
  probe(pairing: Pairing): Promise<{ name: string; deviceId?: string }>;
  servers(): Promise<Server[]>;
  request<T>(serverId: string, path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  updateServer(id: string, patch: { name?: string; icon?: DeviceIconId; tint?: TintId }): Promise<void>;
  subscribe(handler: (serverId: string, payload: unknown) => void): () => void;
  onStatus(handler: (serverId: string, online: boolean, error?: string) => void): () => void;
}

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

interface Route {
  pairing: Pairing;
  peerId?: string;
  cloud?: boolean;
}

interface CursorCloudStatus {
  configured?: boolean;
  visible?: boolean;
  enabled?: boolean;
}

let pairings: Pairing[] = [];
const routes = new Map<string, Route>();
const sockets = new Map<string, WebSocket>();
const attempts = new Map<string, number>();
const pushHandlers = new Set<(serverId: string, payload: unknown) => void>();
const statusHandlers = new Set<(serverId: string, online: boolean, error?: string) => void>();
let closed = true;

type RNWebSocket = {
  new (
    url: string,
    protocols?: string | string[] | null,
    options?: { headers?: Record<string, string> },
  ): WebSocket;
};

function notifyUrl(base: string): string {
  const url = new URL("/notify/stream", `${originOf(base)}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("notify", "0");
  return url.toString();
}

function toDirect(name: string, url: string, online: boolean, id: string, icon?: string, tint?: string): Server {
  return {
    id,
    name,
    url,
    code: codeFor(name),
    online,
    icon: isDeviceIcon(icon) ? icon : "laptop",
    ...(isTint(tint) ? { tint } : {}),
    home: true,
  };
}

function withAppearance(server: Server): Server {
  const look = appearanceOf(server.id);
  const name = look.name || server.name;
  return {
    ...server,
    name,
    code: look.name ? codeFor(name) : server.code,
    icon: look.icon ?? server.icon,
    ...(look.tint ? { tint: look.tint } : server.tint ? { tint: server.tint } : {}),
  };
}

function toPeer(peer: WirePeer): Server {
  return {
    id: peer.id,
    name: peer.name,
    url: peer.url,
    code: codeFor(peer.name),
    online: peer.online === true,
    icon: isDeviceIcon(peer.icon) ? peer.icon : "laptop",
    ...(isTint(peer.tint) ? { tint: peer.tint } : {}),
    peer: true,
    notify: peer.notify === true,
    ...(peer.lastSeen ? { lastSeen: peer.lastSeen } : {}),
  };
}

async function fetchPath<T>(target: Pairing, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`${originOf(target.url)}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${target.token}`,
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  if (!response.ok) throw httpError(response.status, text);
  return (text ? JSON.parse(text) : null) as T;
}

function connectOne(pairing: Pairing): void {
  const origin = originOf(pairing.url);
  if (closed || sockets.has(origin)) return;
  const serverId = directId(pairing.url);
  const ws = new (WebSocket as unknown as RNWebSocket)(notifyUrl(pairing.url), undefined, {
    headers: { Authorization: `Bearer ${pairing.token}` },
  });
  sockets.set(origin, ws);
  ws.onopen = () => {
    if (sockets.get(origin) !== ws) return;
    attempts.set(origin, 0);
    for (const handler of statusHandlers) handler(serverId, true);
  };
  ws.onmessage = (event) => {
    if (sockets.get(origin) !== ws) return;
    try {
      const payload: unknown = JSON.parse(String(event.data));
      const frame = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as { type?: unknown; serverId?: unknown; payload?: unknown }
        : undefined;
      // A paired Mac relays its own peers' frames wrapped in `peer-frame`.
      // Unwrapped here, so a frame about a thread on the studio arrives under
      // the studio's id rather than under the Mac that forwarded it.
      if (frame?.type === "peer-frame" && typeof frame.serverId === "string") {
        for (const handler of pushHandlers) handler(frame.serverId, frame.payload);
        return;
      }
      for (const handler of pushHandlers) handler(serverId, payload);
    } catch {
      // Not JSON; not worth dropping the socket over.
    }
  };
  ws.onclose = () => {
    if (sockets.get(origin) !== ws) return;
    sockets.delete(origin);
    for (const handler of statusHandlers) handler(serverId, false);
    if (closed) return;
    const current = pairings.find((entry) => originOf(entry.url) === origin);
    if (!current) return;
    const next = Math.min(500 * 2 ** (attempts.get(origin) ?? 0), 30_000);
    attempts.set(origin, (attempts.get(origin) ?? 0) + 1);
    setTimeout(() => connectOne(current), next);
  };
}

function syncSockets(): void {
  const want = new Set(closed ? [] : pairings.map((entry) => originOf(entry.url)));
  for (const [origin, ws] of [...sockets]) {
    if (want.has(origin)) continue;
    sockets.delete(origin);
    ws.close();
  }
  if (closed) return;
  for (const pairing of pairings) connectOne(pairing);
}

export const transport: Transport = {
  pairings() {
    return pairings;
  },

  setPairings(next) {
    pairings = next.map((entry) => ({
      url: originOf(entry.url),
      token: entry.token,
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.deviceId ? { deviceId: entry.deviceId } : {}),
    }));
    routes.clear();
    syncSockets();
  },

  async probe(pairing) {
    const target = { ...pairing, url: originOf(pairing.url) };
    const health = await fetchPath<{ ok?: boolean }>(target, "/health");
    if (health.ok !== true) throw new Error("Can't reach that Mac. Check Tailscale and try again.");
    let name = pairing.name || hostLabel(target.url);
    let deviceId = pairing.deviceId;
    try {
      const listed = await fetchPath<{ deviceId?: string; name?: string }>(target, "/peers");
      if (listed.name?.trim()) name = listed.name.trim();
      if (listed.deviceId?.trim()) deviceId = listed.deviceId.trim();
    } catch {
      // A daemon from before pairing landed still answers /health.
    }
    return { name, ...(deviceId ? { deviceId } : {}) };
  },

  async servers() {
    if (pairings.length === 0) {
      routes.clear();
      return [];
    }

    // Built beside the live table and swapped in at the end. Clearing first
    // meant a request that landed mid-sweep — and there are more of them now
    // that one Mac can be re-read on its own — failed as "not paired".
    const next = new Map<string, Route>();
    const directUrls = new Set(pairings.map((entry) => originOf(entry.url)));
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    const out: Server[] = [];

    for (const pairing of pairings) {
      const origin = originOf(pairing.url);
      const id = directId(pairing.url);
      const name = pairing.name || hostLabel(origin);
      try {
        const health = await fetchPath<{ ok?: boolean }>(pairing, "/health");
        let listed: { deviceId?: string; name?: string; icon?: string; tint?: string; peers?: WirePeer[] } = {};
        let cursorCloud: CursorCloudStatus = {};
        try {
          [listed, cursorCloud] = await Promise.all([
            fetchPath<typeof listed>(pairing, "/peers"),
            fetchPath<CursorCloudStatus>(pairing, "/cursor-cloud/status").catch(() => ({})),
          ]);
        } catch {
          listed = {};
        }
        if (!seenIds.has(id) && !seenUrls.has(origin)) {
          next.set(id, { pairing });
          seenIds.add(id);
          seenUrls.add(origin);
          out.push(withAppearance(toDirect(listed.name || name, origin, health.ok === true, id, listed.icon, listed.tint)));
        }
        for (const peer of listed.peers ?? []) {
          const peerOrigin = originOf(peer.url);
          if (directUrls.has(peerOrigin) || seenIds.has(peer.id) || seenUrls.has(peerOrigin)) continue;
          next.set(peer.id, { pairing, peerId: peer.id });
          seenIds.add(peer.id);
          seenUrls.add(peerOrigin);
          out.push(withAppearance(toPeer(peer)));
        }
        if (cursorCloud.visible) {
          const cloudId = `${id}:cursor-cloud`;
          next.set(cloudId, { pairing, cloud: true });
          out.push({
            id: cloudId,
            name: pairings.length > 1 ? `${listed.name || name} · Cursor Cloud` : "Cursor Cloud",
            url: "cursor://cloud",
            code: "CLOUD",
            online: true,
            icon: "cloud",
            cloud: true,
            workspaceOnly: true,
            cloudConnected: cursorCloud.configured === true && cursorCloud.enabled !== false,
          });
        }
      } catch {
        if (seenUrls.has(origin)) continue;
        next.set(id, { pairing });
        seenIds.add(id);
        seenUrls.add(origin);
        out.push(withAppearance(toDirect(name, origin, false, id)));
      }
    }
    routes.clear();
    for (const [id, route] of next) routes.set(id, route);
    return out;
  },

  request<T>(serverId: string, path: string, init?: { method?: string; body?: unknown }) {
    const route = routes.get(serverId);
    if (!route) throw new Error("This phone is not paired with that Mac.");
    if (route.cloud) return fetchPath<T>(route.pairing, `/cursor-cloud/api${path}`, init);
    if (route.peerId) {
      return fetchPath<T>(route.pairing, `/peers/${encodeURIComponent(route.peerId)}/api${path}`, init);
    }
    return fetchPath<T>(route.pairing, path, init);
  },

  async updateServer(id, patch) {
    await saveAppearance(id, patch);
    const route = routes.get(id);
    if (!route?.peerId) return;
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.icon !== undefined) body.icon = patch.icon;
    if (patch.tint !== undefined) body.tint = patch.tint;
    if (Object.keys(body).length === 0) return;
    await fetchPath(route.pairing, `/peers/${encodeURIComponent(route.peerId)}`, { method: "PATCH", body });
  },

  subscribe(handler) {
    closed = false;
    pushHandlers.add(handler);
    syncSockets();
    return () => {
      pushHandlers.delete(handler);
      if (pushHandlers.size === 0) {
        closed = true;
        syncSockets();
      }
    };
  },

  onStatus(handler) {
    statusHandlers.add(handler);
    return () => statusHandlers.delete(handler);
  },
};
