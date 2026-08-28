import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { config } from "./config.js";
import { forwardNotification } from "./peers.js";
import { sendPush } from "./push.js";
import type { RegistryEntry } from "./registry.js";
import { attachAppUpdateHost } from "./app-update.js";

export interface NotifyEvent {
  session: string;
  title: string;
  message: string;
  highPriority: boolean;
  /// Where tapping the push should land. Defaults to the session deep link;
  /// chats set their own, since they have no tmux session behind them.
  click?: string;
  /// The machine the thread is running on, when that is not this one. A banner
  /// on your laptop about a thread on the studio has to say which machine.
  device?: string;
}

const THROTTLE_MS = 5 * 60_000;
const lastSent = new Map<string, number>();

// Every client holds a WebSocket to /notify/stream while it's in the
// foreground: it's the channel that pushes live session state, so clients
// don't have to poll. Two roles ride on the same socket:
//
//   subscribers   — everyone, receives state pushes and settings sync.
//   notifyTargets — clients that render notifications themselves (the desktop
//                   app). If any is connected, notifications go there as
//                   native banners instead of Apple Push, so the phone only
//                   buzzes when no desktop client is around.
//
// The phone connects with `?notify=0`: it wants the live data but its
// banners arrive via APNs, so it must not count as a delivery target.
const subscribers = new Set<WebSocket>();
const notifyTargets = new Set<WebSocket>();
const relaySubscribers = new Set<WebSocket>();
const livePeerStreams = new Set<string>();
const alive = new WeakSet<WebSocket>();
const streamId = randomUUID();
const history: { sequence: number; text: string }[] = [];
const HISTORY_LIMIT = 1_000;
let sequence = 0;

export function attachNotifyStream(ws: WebSocket, notifies: boolean, params = new URLSearchParams()): void {
  subscribers.add(ws);
  if (notifies) notifyTargets.add(ws);
  const relay = params.get("relay") === "1";
  if (relay) relaySubscribers.add(ws);
  attachAppUpdateHost(ws, params);
  alive.add(ws);
  ws.on("pong", () => alive.add(ws));
  const drop = () => {
    subscribers.delete(ws);
    notifyTargets.delete(ws);
    relaySubscribers.delete(ws);
  };
  ws.on("close", drop);
  ws.on("error", drop);
  // Announce that this server pushes state. A client talking to an older
  // server never hears this and keeps polling fast, so it degrades instead of
  // going quietly stale.
  if (ws.readyState === ws.OPEN) {
    const askedAfter = params.get("afterSequence");
    const after = Number(askedAfter);
    const resumable = relay && askedAfter !== null && Number.isSafeInteger(after) && after >= 0;
    const reset = resumable && history.length > 0 && after < history[0].sequence - 1;
    ws.send(JSON.stringify({
      type: "hello",
      push: true,
      streamId,
      sequence,
      peerStreams: [...livePeerStreams],
      ...(reset ? { reset: true } : {}),
    }));
    if (resumable && !reset) {
      for (const entry of history) {
        if (entry.sequence > after) ws.send(entry.text);
      }
    }
  }
}

// Push an arbitrary message to every connected client. Used for live state and
// settings sync (e.g. quick replies) so a change shows up on every open device
// without a poll. Unlike notifications this never falls back to APNs — a client
// that isn't connected just picks it up on its next refresh.
export function broadcast(payload: unknown): void {
  sequence += 1;
  const frame = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...(payload as Record<string, unknown>), sequence }
    : { type: "message", payload, sequence };
  const text = JSON.stringify(frame);
  history.push({ sequence, text });
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  for (const ws of subscribers) {
    if (ws.readyState === ws.OPEN) ws.send(text);
  }
}

/// Delivers a peer's frame to local clients without sending it back out through
/// another peer relay.
export function broadcastPeer(serverId: string, payload: unknown): void {
  if (subscribers.size === 0) return;
  const text = JSON.stringify({ type: "peer-frame", serverId, payload });
  for (const ws of subscribers) {
    if (!relaySubscribers.has(ws) && ws.readyState === ws.OPEN) ws.send(text);
  }
}

/// Keeps late-arriving local clients aware of peer streams that were already
/// connected before their own socket opened.
export function setPeerStreamStatus(serverId: string, connected: boolean): void {
  if (connected) livePeerStreams.add(serverId);
  else livePeerStreams.delete(serverId);
  broadcastPeer(serverId, { type: connected ? "hello" : "peer-disconnected", push: connected });
}

// A session's hook-driven state changed. Clients patch the session in place —
// no refetch — so a fleet card's live label tracks the agent in real time.
// Mirrors the registry exactly: an absent field means "cleared".
export function pushSession(session: string, entry: RegistryEntry | undefined): void {
  broadcast({
    type: "session",
    session,
    agent: entry?.agent,
    state: entry?.state,
    detail: entry?.detail,
    currentAction: entry?.currentAction,
    interactionKind: entry?.interactionKind,
    interactionRequestId: entry?.interactionRequestId,
  });
}

// The set of sessions changed (created, killed, renamed, or a new agent
// session started in one). Clients refetch the list, which carries the fields
// only /sessions can produce — pane preview and diff stat.
export function pushSessionList(): void {
  broadcast({ type: "sessions" });
}

// A half-dead socket (slept laptop, dropped VPN) would swallow notifications:
// still "connected" so APNs is skipped, but nothing arrives. Ping regularly
// and drop clients that stop ponging, so delivery falls back to the phone.
setInterval(() => {
  for (const ws of subscribers) {
    if (!alive.has(ws)) {
      subscribers.delete(ws);
      notifyTargets.delete(ws);
      relaySubscribers.delete(ws);
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, 30_000).unref();

export async function sendNotification(evt: NotifyEvent): Promise<void> {
  // A title alone is too broad: a new question should still surface, but the
  // exact same event must never reappear because a hook/client retried it.
  const throttleKey = `${evt.session}:${evt.highPriority}:${evt.message}:${evt.title}`;
  const now = Date.now();
  if (now - (lastSent.get(throttleKey) ?? 0) < THROTTLE_MS) return;
  lastSent.set(throttleKey, now);

  // Two independent destinations, and one notification can have both: this
  // machine, if it still wants to be told about its own work, and whichever
  // paired machines asked to be told about it.
  await Promise.all([
    config.notifySelf ? deliverHere(evt) : Promise.resolve(),
    forwardNotification({ ...evt }),
  ]);
}

/// A notification a peer addressed to this machine. Always shown: being a
/// target is the whole reason it was sent here, and `notifySelf` governs what
/// this machine does about its own work rather than what it was handed.
export async function deliverFromPeer(evt: NotifyEvent): Promise<void> {
  await deliverHere(evt);
}

/// Shows a notification on this machine: a banner in a window that is open
/// here, or the phone push when no window is.
async function deliverHere(evt: NotifyEvent): Promise<void> {
  if (notifyTargets.size > 0) {
    const payload = JSON.stringify({ type: "notification", ...evt });
    for (const ws of notifyTargets) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
    return;
  }
  await sendPush(evt);
}
