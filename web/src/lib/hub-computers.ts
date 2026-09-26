import { shareSubscription } from "./shared-subscription";
import type { ComputerSummary } from "@remy/contract";
import { HubRequestError, hubRequest, hubThreadBase, hubWrites } from "./hub-threads";

/// Watch one hosted resource: read it, then read again whenever its live
/// channel says it changed or reconnects.
///
/// Every watcher of the same path and channel shares one read and one value,
/// so a composer, a settings row and a picker asking for `/model-access` at
/// once cost one request. A watcher that mounts later paints the value already
/// in hand; if that value is older than a moment, or this window has written
/// anything since, it also reads again behind it, as opening a view always
/// did, so a change nothing announced still shows on the next open.
export function watchHubResource<T>(
  path: string,
  changed: (value: T | undefined, stale: boolean) => void,
  failed: (message: string) => void,
  livePath = `${path}/live`,
): () => void {
  const key = `${path}\n${livePath}`;
  const joined = sharedReads.get(key);
  const stop = watchSharedResource(key, (value, stale) => changed(value as T | undefined, stale), failed);
  if (joined && joined.readAt !== undefined && (Date.now() - joined.readAt > FRESH_MS || joined.writes !== hubWrites())) joined.refresh();
  return stop;
}

/// How long one load's answer serves every view that asks for it.
const FRESH_MS = 5_000;
const sharedReads = new Map<string, { refresh: () => void; readAt?: number; writes?: number }>();

const watchSharedResource = shareSubscription<[unknown, boolean]>((key, changed, failed) => {
  const split = key.indexOf("\n");
  const entry: { refresh: () => void; readAt?: number; writes?: number } = { refresh: () => {} };
  sharedReads.set(key, entry);
  const stop = startHubResource(key.slice(0, split), (value, stale) => {
    if (!stale) { entry.readAt = Date.now(); entry.writes = hubWrites(); }
    changed(value, stale);
  }, failed, key.slice(split + 1), refresh => { entry.refresh = refresh; });
  return () => {
    if (sharedReads.get(key) === entry) sharedReads.delete(key);
    stop();
  };
});

function startHubResource<T>(
  path: string,
  changed: (value: T | undefined, stale: boolean) => void,
  failed: (message: string) => void,
  livePath: string,
  expose: (refresh: () => void) => void,
): () => void {
  let stopped = false;
  let value: T | undefined;
  let reading = false;
  let again = false;
  const refresh = async () => {
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    try {
      do {
        again = false;
        const next = await hubRequest<T>(path);
        if (stopped) return;
        value = next;
        changed(next, false);
      } while (again && !stopped);
    } catch (e) {
      if (stopped) return;
      if (e instanceof HubRequestError && [401, 403, 404].includes(e.status)) {
        changed(undefined, true);
        stopped = true;
      }
      failed(e instanceof Error ? e.message : "Reconnect to continue.");
    } finally {
      reading = false;
    }
  };
  // A late watcher's revalidation is already covered by a read in flight.
  expose(() => { if (!stopped && !reading) void refresh(); });
  void refresh();
  // The read above already covers the first subscription. Only a reconnect has
  // to read again, because messages can be missed while the channel is down;
  // refreshing on every open asked every hosted resource for twice.
  let subscribed = false;
  const unsubscribe = watchResourceChannel(livePath, (kind, code) => {
    if (stopped) return;
    if (kind === "open") {
      const reconnected = subscribed;
      subscribed = true;
      if (reconnected) void refresh();
      return;
    }
    if (kind === "message") { void refresh(); return; }
    if (value !== undefined) changed(value, true);
    if (code === 1008) {
      stopped = true;
      value = undefined;
      changed(undefined, true);
      failed("Sign in again.");
    }
  }, failed);
  return () => { stopped = true; unsubscribe(); };

}

export function watchHubComputers(
  org: string,
  changed: (computers: ComputerSummary[], stale: boolean) => void,
  failed: (message: string) => void,
) {
  return watchHubResource<{ computers: ComputerSummary[] }>(
    `${hubThreadBase(org)}/computers`,
    (value, stale) => changed(value?.computers ?? [], stale),
    failed,
  );
}

/// A hosted live channel says "open", "message" or "close". Only open and close
/// are state a late watcher needs; a replayed message would make it read again
/// for a change its own first read already covers.
const watchResourceChannel = shareSubscription<["open" | "message" | "close", number?]>((path, changed) => {
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let attempt = 0;
  const connect = () => {
    const url = new URL(path, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    socket = ws;
    // The hub greets every socket with a reset. It says nothing that "open"
    // has not: a first open is covered by the read that started with it, and a
    // reconnect reads on open. Acting on both read every resource twice.
    let greeted = false;
    ws.onopen = () => { if (!stopped && socket === ws) { attempt = 0; changed("open"); } };
    ws.onmessage = (event?: MessageEvent) => {
      if (stopped || socket !== ws) return;
      const first = !greeted;
      greeted = true;
      if (first && isReset(event?.data)) return;
      changed("message");
    };
    ws.onerror = () => ws.close();
    ws.onclose = event => {
      if (stopped || socket !== ws) return;
      changed("close", event.code);
      if (event.code !== 1008) timer = setTimeout(connect, Math.min(30000, 500 * 2 ** attempt++));
    };
  };
  connect();
  return () => { stopped = true; clearTimeout(timer); socket?.close(); };
}, (kind) => kind !== "message");

function isReset(data: unknown): boolean {
  if (typeof data !== "string") return false;
  try { return (JSON.parse(data) as { kind?: unknown } | null)?.kind === "reset"; }
  catch { return false; }
}
