import type { ComputerSummary } from "@remy/contract";
import { HubRequestError, hubRequest, hubThreadBase } from "./hub-threads";

export function watchHubResource<T>(
  path: string,
  changed: (value: T | undefined, stale: boolean) => void,
  failed: (message: string) => void,
): () => void {
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let value: T | undefined;
  let reading = false;
  let again = false;
  let attempt = 0;
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
        socket?.close();
        clearTimeout(timer);
      }
      failed(e instanceof Error ? e.message : "Reconnect to continue.");
    } finally {
      reading = false;
    }
  };
  const connect = () => {
    if (stopped) return;
    const url = new URL(`${path}/live`, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
    };
    ws.onmessage = () => {
      if (socket === ws) void refresh();
    };
    ws.onerror = () => ws.close();
    ws.onclose = (event) => {
      if (stopped || socket !== ws) return;
      if (value !== undefined) changed(value, true);
      if (event.code === 1008) {
        failed("Sign in again.");
        return;
      }
      timer = setTimeout(connect, Math.min(30000, 500 * 2 ** attempt++));
    };
  };
  void refresh();
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  };
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
