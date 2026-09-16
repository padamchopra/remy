import { threadStarts, watchThreadStarts } from "./hub-thread-start";
import { hubTransport } from "./transport";
import { shareSubscription } from "./shared-subscription";
import type { HubThread, ThreadLiveFrame, ThreadMember } from "@remy/contract";

export const hubThreadBase = (organizationId: string) =>
  `/api/organizations/${encodeURIComponent(organizationId)}`;
export const hubThreadPath = (
  organizationId: string,
  computerId: string,
  threadId?: string,
) =>
  `${hubThreadBase(organizationId)}/computers/${encodeURIComponent(computerId)}/threads${threadId ? `/${encodeURIComponent(threadId)}` : ""}`;

export class HubRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const pendingReads = new Map<string, Promise<unknown>>();

export function hubRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (method !== "GET") {
    pendingReads.clear();
    return readHubResponse<T>(path, method, body);
  }
  const pending = pendingReads.get(path);
  if (pending) return pending as Promise<T>;
  const request = readHubResponse<T>(path, method, body).finally(() => {
    if (pendingReads.get(path) === request) pendingReads.delete(path);
  });
  pendingReads.set(path, request);
  return request;
}

async function readHubResponse<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await hubTransport.request(path, method, body);
  const result = response.status === 204 ? {} : await response.json();
  if (!response.ok)
    throw new HubRequestError(
      typeof result.error === "string"
        ? result.error
        : "This request failed; try again.",
      response.status,
    );
  return result as T;
}

export const watchHubThreads = shareSubscription<[HubThread[], ThreadMember?]>(startHubThreads);

function startHubThreads(
  organizationId: string,
  changed: (threads: HubThread[], member?: ThreadMember) => void,
  failed: (error: string) => void,
): () => void {
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let cursor: number | undefined;
  let member: ThreadMember | undefined;
  let threads = new Map<string, HubThread>();
  let generation = 0;
  let attempt = 0;
  const key = (thread: { computerId: string; id: string }) =>
    `${thread.computerId}:${thread.id}`;
  const emit = () => {
    const pending: HubThread[] = member ? threadStarts().filter(s => s.ownerId === member!.id && s.organizationId === organizationId && ![...threads.values()].some(t => t.id === s.created?.id && t.computerId === s.created?.computerId)).map(s => ({
      id: s.requestId, computerId: "pending", revision: 0, stale: false, observedAt: s.at,
      access: {organizationId, owner: member!, participants: [], visibility: "private"},
      detail: {id: s.requestId, title: s.message.slice(0, 200), state: s.phase === "failed" ? "idle" : "working", entries: [{id: `u-${s.requestId}`,kind: "user",text: s.message}]},
    })) : [];
    changed([...threads.values(), ...pending], member);
  };
  const offStarts = watchThreadStarts(emit);
  const refresh = async () => {
    const current = ++generation;
    const result = await hubRequest<{
      threads: HubThread[];
      cursor: number;
      member: ThreadMember;
    }>(`${hubThreadBase(organizationId)}/threads`);
    if (stopped || generation !== current) return;
    threads = new Map(result.threads.map((thread) => [key(thread), thread]));
    member = result.member;
    cursor = result.cursor;
    emit();
  };
  const connect = () => {
    if (stopped) return;
    const url = new URL(
      `${hubThreadBase(organizationId)}/threads/live`,
      window.location.origin,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (cursor !== undefined) url.searchParams.set("cursor", String(cursor));
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      if (socket === ws) attempt = 0;
    };
    ws.onmessage = (event) => {
      if (stopped || socket !== ws) return;
      let frame: ThreadLiveFrame;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (frame.kind === "reset") {
        socket = undefined;
        ws.close();
        void refresh().then(connect).catch(recover);
        return;
      }
      if (frame.kind === "ready") {
        cursor = Math.max(cursor ?? 0, frame.cursor);
        emit();
        return;
      }
      if (cursor !== undefined && frame.cursor <= cursor) return;
      cursor = frame.cursor;
      if (frame.kind === "snapshot")
        threads.set(key(frame.thread), frame.thread);
      else if (frame.kind === "remove")
        threads.delete(`${frame.computerId}:${frame.threadId}`);
      emit();
    };
    ws.onclose = (event) => {
      if (stopped || socket !== ws) return;
      socket = undefined;
      if (event.code === 1008) { stopped = true; threads.clear(); emit(); failed("Sign in again."); return; }
      changed(
        [...threads.values()].map((thread) => ({ ...thread, stale: true })),
        member,
      );
      retry = setTimeout(connect, Math.min(500 * 2 ** attempt++, 30_000));
    };
  };
  const recover = (error: unknown) => {
    if (stopped) return;
    if (error instanceof HubRequestError && [401, 403, 404].includes(error.status)) { stopped = true; threads.clear(); emit(); socket?.close(); failed(error.message); return; }
    failed(
      error instanceof Error
        ? error.message
        : "Reconnect to continue reading your threads.",
    );
    retry = setTimeout(
      () => {
        void refresh().then(connect).catch(recover);
      },
      Math.min(500 * 2 ** attempt++, 30_000),
    );
  };
  void refresh().then(connect).catch(recover);
  return () => {
    stopped = true;
    offStarts();
    generation += 1;
    clearTimeout(retry);
    socket?.close();
    socket = undefined;
  };
}
