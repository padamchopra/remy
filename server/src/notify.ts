import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { RegistryEntry } from "./registry.js";
import { attachAppUpdateHost } from "./app-update.js";
import { attachNativeBrowserHost } from "./browser-host.js";
import { deviceId } from "./board-log.js";

export interface NotifyEvent {
  session: string;
  title: string;
  message: string;
  highPriority: boolean;
  /// Where opening the notification should land. Threads set their own deep link.
  click?: string;
  /// Stable routing identity for this computer.
  deviceId?: string;
}

interface Subscriber {
  socket: WebSocket;
  topics: Set<string>;
  scoped: boolean;
}

interface HistoryEntry {
  sequence: number;
  text: string;
  topics: string[];
}

interface PendingChatFrame {
  frame: Record<string, unknown>;
  entries: Map<string, unknown>;
  removed: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

const THROTTLE_MS = 5 * 60_000;
const CHAT_FRAME_MS = 16;
const HISTORY_LIMIT = 1_000;
const MAX_TOPICS = 128;
const MAX_TOPIC_LENGTH = 256;
const lastSent = new Map<string, number>();

// New clients declare the surfaces they can currently paint. Clients from
// before scoped streams remain wildcard subscribers so upgrades never make an
// older window silently stale.
const subscribers = new Map<WebSocket, Subscriber>();
const notifyTargets = new Set<WebSocket>();
const alive = new WeakSet<WebSocket>();
const streamId = randomUUID();
const history: HistoryEntry[] = [];
const pendingChats = new Map<string, PendingChatFrame>();
let sequence = 0;

export function notificationSequence(): number {
  return sequence;
}

function validTopic(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_TOPIC_LENGTH
    && (value === "sidebar"
      || value === "board"
      || value === "settings"
      || value === "pull-requests"
      || value.startsWith("thread:") && value.length > "thread:".length
      || value.startsWith("terminal:") && value.length > "terminal:".length
      || value.startsWith("workspace:") && value.length > "workspace:".length);
}

function topicsFrom(values: unknown): Set<string> {
  if (!Array.isArray(values) || values.length > MAX_TOPICS) return new Set();
  return new Set(values.filter(validTopic));
}

function topicsFromParams(params: URLSearchParams): Set<string> {
  return new Set(params.getAll("topic").filter(validTopic).slice(0, MAX_TOPICS));
}

function topicsFor(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return ["sidebar"];
  const frame = payload as Record<string, unknown>;
  const type = typeof frame.type === "string" ? frame.type : "";
  if (type === "reset" && Array.isArray(frame.topics)) {
    const topics = frame.topics.filter(validTopic);
    return topics.length > 0 ? topics : ["sidebar"];
  }
  if ((type === "chat" || type === "browser") && typeof frame.chatId === "string") {
    return [`thread:${frame.chatId}`];
  }
  if (type === "terminal" && typeof frame.terminalId === "string") {
    return [`terminal:${frame.terminalId}`];
  }
  if (type === "workspace-worktrees" && typeof frame.workspaceId === "string") {
    return [`workspace:${frame.workspaceId}`];
  }
  if (type === "pull-request-guide" || type === "pull-request-question" || type === "pull-requests") {
    return ["pull-requests"];
  }
  if (type === "settings" || type === "automatic-update") return ["settings"];
  if (type === "board") return ["board", "sidebar", "settings"];
  if (type === "quick-replies" || type === "environments") return ["settings"];
  return ["sidebar"];
}

function accepts(subscriber: Subscriber, topics: string[]): boolean {
  if (!subscriber.scoped) return true;
  return topics.some((topic) => subscriber.topics.has(topic));
}

function send(subscriber: Subscriber, text: string): void {
  if (subscriber.socket.readyState === subscriber.socket.OPEN) subscriber.socket.send(text);
}

/// Attaches one authenticated client and its current surface ownership.
export function attachNotifyStream(ws: WebSocket, notifies: boolean, params = new URLSearchParams()): void {
  const scoped = params.get("scoped") === "1";
  const subscriber: Subscriber = {
    socket: ws,
    topics: scoped ? topicsFromParams(params) : new Set(),
    scoped,
  };
  subscribers.set(ws, subscriber);
  if (notifies) notifyTargets.add(ws);
  attachAppUpdateHost(ws, params);
  attachNativeBrowserHost(ws, params);
  alive.add(ws);
  ws.on("pong", () => alive.add(ws));
  ws.on("message", (data) => {
    let message: unknown;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    const control = message as Record<string, unknown>;
    if (control.type !== "subscribe" || !subscriber.scoped) return;
    const next = topicsFrom(control.topics);
    const added = [...next].filter((topic) => !subscriber.topics.has(topic));
    subscriber.topics = next;
    if (added.length > 0) send(subscriber, JSON.stringify({ type: "reset", topics: added, sequence }));
  });
  const drop = () => {
    subscribers.delete(ws);
    notifyTargets.delete(ws);
  };
  ws.on("close", drop);
  ws.on("error", drop);

  if (ws.readyState === ws.OPEN) {
    const askedAfter = params.get("afterSequence");
    const askedStream = params.get("streamId");
    const after = Number(askedAfter);
    const resumable = askedAfter !== null && Number.isSafeInteger(after) && after >= 0;
    const oldest = history[0]?.sequence ?? sequence + 1;
    const reset = askedAfter !== null && (
      !resumable
      || askedStream !== streamId
      || after > sequence
      || after < oldest - 1
    );
    send(subscriber, JSON.stringify({
      type: "hello",
      push: true,
      streamId,
      sequence,
      ...(reset ? { reset: true, topics: [...subscriber.topics] } : {}),
    }));
    if (resumable && !reset) {
      for (const entry of history) {
        if (entry.sequence > after && accepts(subscriber, entry.topics)) send(subscriber, entry.text);
      }
    }
  }
}

function broadcastFrame(payload: unknown): void {
  sequence += 1;
  const frame = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...(payload as Record<string, unknown>), sequence }
    : { type: "message", payload, sequence };
  const topics = topicsFor(frame);
  const text = JSON.stringify(frame);
  history.push({ sequence, text, topics });
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  for (const subscriber of subscribers.values()) {
    if (accepts(subscriber, topics)) send(subscriber, text);
  }
}

function queueChat(frame: Record<string, unknown>): void {
  const chatId = String(frame.chatId);
  const existing = pendingChats.get(chatId);
  if (existing) {
    existing.frame = { ...existing.frame, ...frame };
    for (const id of Array.isArray(frame.removed) ? frame.removed : []) {
      if (typeof id !== "string") continue;
      existing.removed.add(id);
      existing.entries.delete(id);
    }
    for (const entry of Array.isArray(frame.entries) ? frame.entries : []) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const id = (entry as Record<string, unknown>).id;
      if (typeof id !== "string") continue;
      existing.entries.set(id, entry);
      existing.removed.delete(id);
    }
    return;
  }
  const entries = new Map<string, unknown>();
  for (const entry of Array.isArray(frame.entries) ? frame.entries : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const id = (entry as Record<string, unknown>).id;
    if (typeof id === "string") entries.set(id, entry);
  }
  const removed = new Set((Array.isArray(frame.removed) ? frame.removed : []).filter(
    (id): id is string => typeof id === "string",
  ));
  const pending: PendingChatFrame = {
    frame,
    entries,
    removed,
    timer: setTimeout(() => {
      pendingChats.delete(chatId);
      const next = { ...pending.frame };
      if (pending.entries.size > 0) next.entries = [...pending.entries.values()];
      else delete next.entries;
      if (pending.removed.size > 0) next.removed = [...pending.removed];
      else delete next.removed;
      broadcastFrame(next);
    }, CHAT_FRAME_MS),
  };
  pending.timer.unref?.();
  pendingChats.set(chatId, pending);
}

// Chat frames merge for one animation frame per thread. Each thread has its own
// timer, so a burst in one cannot hold another back.
/// Queues a local live frame for only the clients that own its surface.
const localListeners = new Set<(payload: unknown) => void>();

export function onLocalBroadcast(listener: (payload: unknown) => void): () => void {
  localListeners.add(listener);
  return () => { localListeners.delete(listener); };
}

export function broadcast(payload: unknown): void {
  for (const listener of localListeners) listener(payload);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const frame = payload as Record<string, unknown>;
    if (frame.type === "chat" && typeof frame.chatId === "string") {
      queueChat(frame);
      return;
    }
  }
  broadcastFrame(payload);
}

/// Pushes hook-driven sidebar state without asking clients to refetch it.
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

/// Invalidates sidebar metadata when the set of sessions changes.
export function pushSessionList(): void {
  broadcast({ type: "sessions" });
}

setInterval(() => {
  for (const subscriber of subscribers.values()) {
    const ws = subscriber.socket;
    if (!alive.has(ws)) {
      subscribers.delete(ws);
      notifyTargets.delete(ws);
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, 30_000).unref();

const notificationRouters = new Set<(event: NotifyEvent) => boolean>();
export function onAddressedNotification(route: (event: NotifyEvent) => boolean): () => void {
  notificationRouters.add(route);
  return () => notificationRouters.delete(route);
}

/// Routes a notification to the hub when it is about a hub thread, and to this
/// computer's own clients otherwise.
export async function sendNotification(evt: NotifyEvent): Promise<void> {
  evt = { ...evt, deviceId: evt.deviceId ?? deviceId };
  const throttleKey = `${evt.session}:${evt.highPriority}:${evt.message}:${evt.title}`;
  const now = Date.now();
  if (now - (lastSent.get(throttleKey) ?? 0) < THROTTLE_MS) return;
  lastSent.set(throttleKey, now);
  for (const route of notificationRouters) if (route(evt)) return;
  deliverHere(evt);
}

function deliverHere(evt: NotifyEvent): void {
  const payload = JSON.stringify({ type: "notification", ...evt });
  for (const ws of notifyTargets) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}
