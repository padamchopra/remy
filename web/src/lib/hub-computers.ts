import { shareSubscription } from "./shared-subscription";
import type { ComputerSummary } from "@remy/contract";
import { HubRequestError, hubRequest, hubThreadBase } from "./hub-threads";

export function watchHubResource<T>(
  path: string,
  changed: (value: T | undefined, stale: boolean) => void,
  failed: (message: string) => void,
  livePath = `${path}/live`,
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
    ws.onopen = () => { if (!stopped && socket === ws) { attempt = 0; changed("open"); } };
    ws.onmessage = () => { if (!stopped && socket === ws) changed("message"); };
    ws.onerror = () => ws.close();
    ws.onclose = event => {
      if (stopped || socket !== ws) return;
      changed("close", event.code);
      if (event.code !== 1008) timer = setTimeout(connect, Math.min(30000, 500 * 2 ** attempt++));
    };
  };
  connect();
  return () => { stopped = true; clearTimeout(timer); socket?.close(); };
});
