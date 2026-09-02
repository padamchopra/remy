import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";

export interface NativeBrowserHostEvent {
  chatId: string;
  browserId: string;
  view: Record<string, unknown>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let host: WebSocket | undefined;
const pending = new Map<string, PendingRequest>();
const eventListeners = new Set<(event: NativeBrowserHostEvent) => void>();
const availabilityListeners = new Set<(available: boolean) => void>();

function cleanId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : undefined;
}

function unavailable(message = "Open Remy on this device to use its native browser."): Error {
  return new Error(message);
}

function rejectPending(error: Error): void {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}

function drop(socket: WebSocket): void {
  if (host !== socket) return;
  host = undefined;
  rejectPending(unavailable("The native browser disconnected."));
  for (const listener of availabilityListeners) listener(false);
}

/// Registers the authenticated desktop shell as this device's native browser host.
export function attachNativeBrowserHost(socket: WebSocket, params: URLSearchParams): void {
  if (params.get("client") !== "desktop" || params.get("browserHost") !== "1") return;
  if (host && host !== socket) rejectPending(unavailable("The native browser host changed."));
  host = socket;
  socket.on("message", (data) => {
    if (host !== socket) return;
    let message: Record<string, unknown>;
    try {
      const parsed = JSON.parse(String(data)) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      message = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === "browser-host-result" && typeof message.requestId === "string") {
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      clearTimeout(request.timer);
      if (message.ok === true) request.resolve(message.view ?? message.result);
      else request.reject(new Error(typeof message.error === "string" ? message.error : "The native browser action failed."));
      return;
    }
    if (message.type !== "browser-host-event") return;
    const chatId = cleanId(message.chatId);
    const browserId = cleanId(message.browserId);
    if (!chatId || !browserId || !message.view || typeof message.view !== "object" || Array.isArray(message.view)) return;
    for (const listener of eventListeners) {
      listener({ chatId, browserId, view: message.view as Record<string, unknown> });
    }
  });
  socket.on("close", () => drop(socket));
  socket.on("error", () => drop(socket));
  for (const listener of availabilityListeners) listener(true);
}

export function nativeBrowserHostAvailable(): boolean {
  return Boolean(host && host.readyState === host.OPEN);
}

/// Executes one browser operation in the desktop process that owns the page.
export function requestNativeBrowserHost<T>(
  action: string,
  input: { chatId: string; browserId: string; [key: string]: unknown },
  timeoutMs = 25_000,
): Promise<T> {
  const socket = host;
  if (!socket || socket.readyState !== socket.OPEN) return Promise.reject(unavailable());
  const requestId = randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("The native browser did not answer."));
    }, timeoutMs);
    timer.unref?.();
    pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer });
    socket.send(JSON.stringify({ type: "browser-host-command", requestId, action, ...input }));
  });
}

export function onNativeBrowserHostEvent(listener: (event: NativeBrowserHostEvent) => void): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export function onNativeBrowserHostAvailability(listener: (available: boolean) => void): () => void {
  availabilityListeners.add(listener);
  return () => availabilityListeners.delete(listener);
}
