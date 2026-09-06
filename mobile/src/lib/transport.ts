import { httpError } from "./api-error";
import { appearanceOf, codeFor, isDeviceIcon, saveAppearance, type DeviceIconId } from "./devices";
import { directPairingForPeer, pairingServerId, type PeerIdentity } from "./fleet-pairing";
import {
  rememberPeerCatalogue,
  retainPeerCatalogues,
  type PeerCatalogues,
  type RememberedPeer,
} from "./peer-catalogue";
import { hostLabel } from "./pairing";
import {
  loadPeerCatalogues,
  originOf,
  removePairing,
  savePairings,
  savePeerCatalogues,
  upsertPairing,
  type Pairing,
} from "./session";
import { isTint, type TintId } from "./tints";
import type { Server } from "../state/types";

export interface Transport {
  pairings(): Pairing[];
  hydratePeerCatalogues(): Promise<void>;
  setPairings(next: Pairing[]): void;
  savePairing(pairing: Pairing): Promise<void>;
  forgetPairing(url: string): Promise<void>;
  onPairings(handler: (pairings: Pairing[]) => void): () => void;
  probe(pairing: Pairing): Promise<{ name: string; deviceId?: string }>;
  servers(): Promise<Server[]>;
  request<T>(serverId: string, path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  upload<T>(
    serverId: string,
    path: string,
    file: { uri: string; name: string; mimeType: string },
    onProgress?: (ratio: number) => void,
  ): Promise<T>;
  updateServer(id: string, patch: { name?: string; icon?: DeviceIconId; tint?: TintId }): Promise<void>;
  subscribe(handler: (serverId: string, payload: unknown) => void, topics: readonly string[]): () => void;
  onStatus(handler: (serverId: string, online: boolean, error?: string) => void): () => void;
}

interface WirePeer extends RememberedPeer {
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
const pairingHandlers = new Set<(pairings: Pairing[]) => void>();
const topicRefs = new Map<string, number>();
const cursors = new Map<string, { streamId?: string; sequence?: number }>();
const peerCatalogues = new Map<string, WirePeer[]>();
let durablePeerCatalogues: PeerCatalogues = {};
let peerCataloguesHydrated = false;
let catalogueWrite = Promise.resolve();
let savedCatalogueSnapshot = "{}";
let pairingWrite = Promise.resolve();
const learningPeers = new Set<string>();
let closed = true;

type RNWebSocket = {
  new (
    url: string,
    protocols?: string | string[] | null,
    options?: { headers?: Record<string, string> },
  ): WebSocket;
};

function liveTopics(): string[] {
  return [...topicRefs.keys()].sort();
}

function notifyUrl(base: string): string {
  const url = new URL("/notify/stream", `${originOf(base)}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("notify", "0");
  url.searchParams.set("scoped", "1");
  for (const topic of liveTopics()) url.searchParams.append("topic", topic);
  const cursor = cursors.get(originOf(base));
  if (cursor?.sequence !== undefined) {
    url.searchParams.set("afterSequence", String(cursor.sequence));
    if (cursor.streamId) url.searchParams.set("streamId", cursor.streamId);
  }
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

function targetFor(serverId: string, path: string): { pairing: Pairing; path: string } {
  const route = routes.get(serverId);
  if (!route) throw new Error("This phone is not paired with that Mac.");
  if (route.cloud) return { pairing: route.pairing, path: `/cursor-cloud/api${path}` };
  if (route.peerId) {
    return {
      pairing: route.pairing,
      path: `/peers/${encodeURIComponent(route.peerId)}/api${path}`,
    };
  }
  return { pairing: route.pairing, path };
}

async function fetchPath<T>(
  target: Pairing,
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<T> {
  const controller = init?.timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), init?.timeoutMs) : undefined;
  try {
    const response = await fetch(`${originOf(target.url)}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${target.token}`,
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(controller ? { signal: controller.signal } : {}),
    });
    const text = await response.text();
    if (!response.ok) throw httpError(response.status, text);
    return (text ? JSON.parse(text) : null) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function connectOne(pairing: Pairing): void {
  const origin = originOf(pairing.url);
  if (closed || sockets.has(origin)) return;
  const serverId = pairingServerId(pairing);
  const ws = new (WebSocket as unknown as RNWebSocket)(notifyUrl(pairing.url), undefined, {
    headers: { Authorization: `Bearer ${pairing.token}` },
  });
  sockets.set(origin, ws);
  ws.onopen = () => {
    if (sockets.get(origin) !== ws) return;
    attempts.set(origin, 0);
    ws.send(JSON.stringify({ type: "subscribe", topics: liveTopics() }));
    for (const handler of statusHandlers) handler(serverId, true);
  };
  ws.onmessage = (event) => {
    if (sockets.get(origin) !== ws) return;
    try {
      const payload: unknown = JSON.parse(String(event.data));
      const frame = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as { type?: unknown; serverId?: unknown; payload?: unknown; streamId?: unknown; sequence?: unknown; reset?: unknown }
        : undefined;
      if (frame?.type === "hello") {
        const previous = cursors.get(origin);
        const nextStream = typeof frame.streamId === "string" ? frame.streamId : undefined;
        const restarted = previous?.streamId !== undefined && previous.streamId !== nextStream;
        if (frame.reset === true || restarted || previous?.sequence === undefined) {
          cursors.set(origin, {
            streamId: nextStream,
            sequence: typeof frame.sequence === "number" ? frame.sequence : undefined,
          });
        } else {
          cursors.set(origin, { ...previous, streamId: nextStream });
        }
      } else if (typeof frame?.sequence === "number") {
        const previous = cursors.get(origin);
        if (previous?.sequence === undefined || frame.sequence > previous.sequence) {
          cursors.set(origin, { ...previous, sequence: frame.sequence });
        }
      }
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

function syncTopics(): void {
  const control = JSON.stringify({ type: "subscribe", topics: liveTopics() });
  for (const socket of sockets.values()) {
    if (socket.readyState === WebSocket.OPEN) socket.send(control);
  }
}

function persistPeerCatalogues(): Promise<void> {
  const snapshot = durablePeerCatalogues;
  const serialized = JSON.stringify(snapshot);
  catalogueWrite = catalogueWrite
    .catch(() => {})
    .then(async () => {
      if (serialized === savedCatalogueSnapshot) return;
      await savePeerCatalogues(snapshot);
      savedCatalogueSnapshot = serialized;
    });
  return catalogueWrite.catch(() => {});
}

async function cachePeerCatalogue(origin: string, peers: WirePeer[]): Promise<void> {
  peerCatalogues.set(origin, peers);
  const remembered = rememberPeerCatalogue(durablePeerCatalogues, origin, peers);
  if (remembered.changed) durablePeerCatalogues = remembered.catalogues;
  await persistPeerCatalogues();
}

function updateStoredPairings(update: (current: Pairing[]) => Pairing[]): Promise<void> {
  pairingWrite = pairingWrite
    .catch(() => {})
    .then(async () => {
      const next = update(pairings);
      await savePairings(next);
      transport.setPairings(next);
      for (const handler of pairingHandlers) handler(pairings);
    });
  return pairingWrite;
}

async function learnDirectPairings(gateway: Pairing, peers: WirePeer[]): Promise<void> {
  const knownIds = new Set(pairings.flatMap((pairing) => pairing.deviceId ? [pairing.deviceId] : []));
  const knownUrls = new Set(pairings.map((pairing) => originOf(pairing.url)));
  const candidates = peers.filter((peer) =>
    peer.online === true
    && !knownIds.has(peer.id)
    && !knownUrls.has(originOf(peer.url))
    && !learningPeers.has(peer.id));
  if (candidates.length === 0) return;

  for (const peer of candidates) learningPeers.add(peer.id);
  const learned = await Promise.all(candidates.map(async (peer) => {
    try {
      const identity = await fetchPath<PeerIdentity>(
        gateway,
        `/peers/${encodeURIComponent(peer.id)}/api/server/identity`,
      );
      return directPairingForPeer(peer, identity) as Pairing | undefined;
    } catch {
      return undefined;
    } finally {
      learningPeers.delete(peer.id);
    }
  }));

  const additions = learned.filter((pairing): pairing is Pairing => Boolean(pairing));
  if (additions.length === 0) return;
  await updateStoredPairings((current) =>
    additions.reduce((next, pairing) => upsertPairing(next, pairing), current));
}

export const transport: Transport = {
  pairings() {
    return pairings;
  },

  async hydratePeerCatalogues() {
    try {
      durablePeerCatalogues = await loadPeerCatalogues();
    } catch {
      durablePeerCatalogues = {};
    }
    savedCatalogueSnapshot = JSON.stringify(durablePeerCatalogues);
    peerCatalogues.clear();
    for (const [origin, peers] of Object.entries(durablePeerCatalogues)) {
      peerCatalogues.set(origin, peers);
    }
    peerCataloguesHydrated = true;
  },

  setPairings(next) {
    pairings = next.map((entry) => ({
      url: originOf(entry.url),
      token: entry.token,
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.deviceId ? { deviceId: entry.deviceId } : {}),
    }));
    const retained = new Set(pairings.map((entry) => originOf(entry.url)));
    const byOrigin = new Map(pairings.map((pairing) => [originOf(pairing.url), pairing]));
    for (const origin of peerCatalogues.keys()) {
      if (!retained.has(origin)) peerCatalogues.delete(origin);
    }
    if (peerCataloguesHydrated) {
      const kept = retainPeerCatalogues(durablePeerCatalogues, retained);
      if (kept.changed) {
        durablePeerCatalogues = kept.catalogues;
        void persistPeerCatalogues();
      }
    }
    for (const [id, route] of routes) {
      const current = byOrigin.get(originOf(route.pairing.url));
      if (current) routes.set(id, { ...route, pairing: current });
      else routes.delete(id);
    }
    for (const pairing of pairings) routes.set(pairingServerId(pairing), { pairing });
    syncSockets();
  },

  savePairing(pairing) {
    return updateStoredPairings((current) => upsertPairing(current, pairing));
  },

  forgetPairing(url) {
    return updateStoredPairings((current) => removePairing(current, url));
  },

  onPairings(handler) {
    pairingHandlers.add(handler);
    return () => pairingHandlers.delete(handler);
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
      peerCatalogues.clear();
      return [];
    }

    // Built beside the live table and swapped in at the end. Clearing first
    // meant a request that landed mid-sweep — and there are more of them now
    // that one Mac can be re-read on its own — failed as "not paired".
    const next = new Map<string, Route>();
    const directUrls = new Set(pairings.map((entry) => originOf(entry.url)));
    const directIds = new Set(pairings.map(pairingServerId));
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    const out: Server[] = [];
    const appendPeers = (pairing: Pairing, peers: WirePeer[]) => {
      for (const peer of peers) {
        const peerOrigin = originOf(peer.url);
        if (directIds.has(peer.id) || directUrls.has(peerOrigin)) continue;
        if (seenIds.has(peer.id)) {
          const index = out.findIndex((server) => server.id === peer.id);
          if (index >= 0 && !out[index].online && peer.online === true) {
            next.set(peer.id, { pairing, peerId: peer.id });
            out[index] = withAppearance(toPeer(peer));
          }
          continue;
        }
        if (seenUrls.has(peerOrigin)) continue;
        next.set(peer.id, { pairing, peerId: peer.id });
        seenIds.add(peer.id);
        seenUrls.add(peerOrigin);
        out.push(withAppearance(toPeer(peer)));
      }
    };

    const scans = await Promise.all(pairings.map(async (pairing) => {
      const origin = originOf(pairing.url);
      const id = pairingServerId(pairing);
      const name = pairing.name || hostLabel(origin);
      try {
        const health = await fetchPath<{ ok?: boolean }>(pairing, "/health", { timeoutMs: 8_000 });
        let listed: { deviceId?: string; name?: string; icon?: string; tint?: string; peers?: WirePeer[] } = {};
        let cursorCloud: CursorCloudStatus = {};
        try {
          [listed, cursorCloud] = await Promise.all([
            fetchPath<typeof listed>(pairing, "/peers", { timeoutMs: 8_000 }),
            fetchPath<CursorCloudStatus>(pairing, "/cursor-cloud/status", { timeoutMs: 8_000 })
              .catch(() => ({})),
          ]);
          await cachePeerCatalogue(origin, listed.peers ?? []);
          void learnDirectPairings(pairing, listed.peers ?? []).catch(() => {});
        } catch {
          listed = {
            peers: (peerCatalogues.get(origin) ?? []).map((peer) => ({ ...peer, online: false })),
          };
        }
        return { pairing, origin, id, name, health, listed, cursorCloud };
      } catch {
        return {
          pairing,
          origin,
          id,
          name,
          health: { ok: false },
          listed: {
            peers: (peerCatalogues.get(origin) ?? []).map((peer) => ({ ...peer, online: false })),
          },
          cursorCloud: {},
        };
      }
    }));

    for (const { pairing, origin, id, name, health, listed, cursorCloud } of scans) {
      if (!seenIds.has(id) && !seenUrls.has(origin)) {
        next.set(id, { pairing });
        seenIds.add(id);
        seenUrls.add(origin);
        out.push(withAppearance(
          toDirect(listed.name || name, origin, health.ok === true, id, listed.icon, listed.tint),
        ));
      }
      appendPeers(pairing, listed.peers ?? []);
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
    }
    routes.clear();
    for (const [id, route] of next) routes.set(id, route);
    // Discovery can promote a relayed computer while this sweep is in flight.
    // Its direct route wins immediately instead of waiting for another poll.
    for (const pairing of pairings) routes.set(pairingServerId(pairing), { pairing });
    return out;
  },

  request<T>(serverId: string, path: string, init?: { method?: string; body?: unknown }) {
    const target = targetFor(serverId, path);
    return fetchPath<T>(target.pairing, target.path, init);
  },

  async upload<T>(
    serverId: string,
    path: string,
    file: { uri: string; name: string; mimeType: string },
    onProgress?: (ratio: number) => void,
  ): Promise<T> {
    const target = targetFor(serverId, path);
    const source = await fetch(file.uri);
    if (!source.ok) throw new Error("That image couldn't be opened.");
    const blob = await source.blob();
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${originOf(target.pairing.url)}${target.path}`);
      xhr.setRequestHeader("Authorization", `Bearer ${target.pairing.token}`);
      xhr.setRequestHeader("Content-Type", file.mimeType);
      xhr.setRequestHeader("X-Filename", file.name);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
      };
      xhr.onerror = () => reject(new Error("That image couldn't be uploaded."));
      xhr.onload = () => {
        const body = xhr.responseText ?? "";
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(httpError(xhr.status, body));
          return;
        }
        try {
          resolve((body ? JSON.parse(body) : null) as T);
        } catch {
          reject(new Error("That image returned an unreadable response."));
        }
      };
      xhr.send(blob);
    });
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

  subscribe(handler, topics) {
    closed = false;
    pushHandlers.add(handler);
    for (const topic of topics) topicRefs.set(topic, (topicRefs.get(topic) ?? 0) + 1);
    syncSockets();
    syncTopics();
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
        syncSockets();
      }
    };
  },

  onStatus(handler) {
    statusHandlers.add(handler);
    return () => statusHandlers.delete(handler);
  },
};
