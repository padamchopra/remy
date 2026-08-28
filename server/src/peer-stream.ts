import WebSocket from "ws";
import { broadcastPeer, setPeerStreamStatus } from "./notify.js";
import { getPeer, listPeers, type Peer } from "./peers.js";

interface Relay {
  fingerprint: string;
  socket?: WebSocket;
  timer?: ReturnType<typeof setTimeout>;
  attempt: number;
  streamId?: string;
  sequence?: number;
  greeted: boolean;
}

const relays = new Map<string, Relay>();
const RECONCILE_MS = 5_000;
let reconcileTimer: ReturnType<typeof setInterval> | undefined;

function streamUrl(peer: Peer, sequence?: number): string {
  const url = new URL(`${peer.url}/notify/stream`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("notify", "0");
  url.searchParams.set("relay", "1");
  if (sequence !== undefined) url.searchParams.set("afterSequence", String(sequence));
  return url.toString();
}

function schedule(peerId: string, relay: Relay): void {
  if (relay.timer || relay.socket || !getPeer(peerId)) return;
  const delay = Math.min(500 * 2 ** relay.attempt, 30_000);
  relay.attempt += 1;
  relay.timer = setTimeout(() => {
    relay.timer = undefined;
    connect(peerId, relay);
  }, delay);
  relay.timer.unref?.();
}

function connect(peerId: string, relay: Relay): void {
  const peer = getPeer(peerId);
  if (!peer || relays.get(peerId) !== relay || relay.socket) return;
  const socket = new WebSocket(streamUrl(peer, relay.sequence), {
    headers: { Authorization: `Bearer ${peer.token}` },
  });
  relay.socket = socket;

  socket.on("open", () => {
    if (relay.socket !== socket) return;
    relay.attempt = 0;
  });
  socket.on("message", (data) => {
    if (relay.socket !== socket) return;
    let payload: unknown;
    try {
      payload = JSON.parse(String(data));
    } catch {
      return;
    }
    const frame = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : undefined;
    if (!frame) return;

    if (frame.type === "hello") {
      const nextStream = typeof frame.streamId === "string" ? frame.streamId : undefined;
      const nextSequence = typeof frame.sequence === "number" ? frame.sequence : undefined;
      const restarted = relay.greeted && (nextStream === undefined || nextStream !== relay.streamId);
      const reset = restarted || frame.reset === true;
      relay.greeted = true;
      setPeerStreamStatus(peerId, true);
      relay.streamId = nextStream;
      if (reset) {
        relay.sequence = nextSequence;
        broadcastPeer(peerId, { type: "chats" });
        broadcastPeer(peerId, { type: "peer-reset" });
      } else if (relay.sequence === undefined) {
        relay.sequence = nextSequence;
      }
      broadcastPeer(peerId, frame);
      return;
    }

    const nextSequence = typeof frame.sequence === "number" ? frame.sequence : undefined;
    if (nextSequence !== undefined) {
      if (relay.sequence !== undefined && nextSequence <= relay.sequence) return;
      relay.sequence = nextSequence;
    }
    broadcastPeer(peerId, frame);
  });

  const disconnected = () => {
    if (relay.socket !== socket) return;
    relay.socket = undefined;
    if (relays.get(peerId) !== relay) return;
    setPeerStreamStatus(peerId, false);
    schedule(peerId, relay);
  };
  socket.on("close", disconnected);
  socket.on("error", () => socket.terminate());
}

function reconcile(): void {
  const peers = listPeers();
  const current = new Set(peers.map((peer) => peer.id));
  for (const [peerId, relay] of relays) {
    if (current.has(peerId)) continue;
    if (relay.timer) clearTimeout(relay.timer);
    relay.socket?.close();
    relays.delete(peerId);
  }
  for (const peer of peers) {
    const fingerprint = `${peer.url}\n${peer.token}`;
    const existing = relays.get(peer.id);
    if (existing?.fingerprint === fingerprint) {
      if (!existing.socket && !existing.timer) connect(peer.id, existing);
      continue;
    }
    if (existing?.timer) clearTimeout(existing.timer);
    existing?.socket?.close();
    const relay: Relay = { fingerprint, attempt: 0, greeted: false };
    relays.set(peer.id, relay);
    connect(peer.id, relay);
  }
}

/// Relays each paired machine's live state through this daemon, which is the
/// only process that holds the peer token.
export function startPeerStreamRelay(): () => void {
  if (reconcileTimer) return stopPeerStreamRelay;
  reconcile();
  reconcileTimer = setInterval(reconcile, RECONCILE_MS);
  reconcileTimer.unref?.();
  return stopPeerStreamRelay;
}

export function stopPeerStreamRelay(): void {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = undefined;
  const current = [...relays];
  relays.clear();
  for (const [peerId, relay] of current) {
    if (relay.timer) clearTimeout(relay.timer);
    relay.socket?.terminate();
    setPeerStreamStatus(peerId, false);
  }
}
