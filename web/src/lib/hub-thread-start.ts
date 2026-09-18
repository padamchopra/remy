import { useSyncExternalStore } from "react";
import { HubRequestError, hubRequest, hubThreadBase, hubThreadPath } from "./hub-threads";
import { threadStartProgressLabel, type ThreadStartProgress } from "./thread-start-progress";

type StartedThread = { id: string; computerId: string; phase?: string; error?: string };
export type ThreadStart = {
  organizationId: string;
  ownerId: string;
  requestId: string;
  workspaceId: string;
  computerId: string;
  computerName: string;
  message: string;
  visibility: "private" | "open";
  branch?: string;
  provider?: string;
  model?: string;
  created?: StartedThread;
  phase: "starting" | "failed" | "ready";
  progress?: ThreadStartProgress;
  error?: string;
  at: number;
};
const storageKey = "remy:pending-hosted-threads";
let starts: ThreadStart[] = [];
try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as ThreadStart[];
  if (Array.isArray(saved)) starts = saved.filter(s => s.at > Date.now() - 86_400_000).slice(-10).map(s => ({...s, visibility: s.visibility ?? "private", ...(s.phase === "starting" ? {phase: "failed" as const, error: "Startup was interrupted. Retry to continue your thread."} : {})}));
} catch {}
const listeners = new Set<() => void>();
export const threadStarts = () => starts;
export function watchThreadStarts(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
const running = new Set<string>();
function update(value: ThreadStart) {
  starts = [...starts.filter(s => s.requestId !== value.requestId), value].slice(-10);
  try { sessionStorage.setItem(storageKey, JSON.stringify(starts)); } catch {}
  listeners.forEach(fn => fn());
}
export function useThreadStarts() {
  return useSyncExternalStore(watchThreadStarts, threadStarts);
}
export { threadStartProgressLabel };
export function startHubThread(input: Omit<ThreadStart, "phase" | "at" | "progress">) {
  const start: ThreadStart = {...input, phase: "starting", progress: "creating", at: Date.now()};
  update(start);
  void retryHubThread(start);
}
function applyProgress(current: ThreadStart, progress?: string): ThreadStart {
  if (!progress || progress === current.progress) return current;
  const next = {...current, progress: progress as ThreadStartProgress};
  update(next);
  return next;
}
function stillStarting(requestId: string) {
  return running.has(requestId) && starts.some(start => start.requestId === requestId && start.phase === "starting");
}
async function waitForCreated(start: ThreadStart): Promise<StartedThread | undefined> {
  let current = applyProgress(start, "creating");
  const created = await hubRequest<StartedThread>(`${hubThreadBase(start.organizationId)}/threads`, "POST", {
    workspaceId: start.workspaceId, computerId: start.computerId,
    title: start.message.slice(0, 200), requestId: start.requestId,
    branch: start.branch, provider: start.provider, model: start.model,
    visibility: start.visibility,
  });
  if (created.id && created.computerId) return created;
  current = applyProgress(current, created.phase ?? "creating");
  const path = `${hubThreadBase(start.organizationId)}/threads/starts/${encodeURIComponent(start.requestId)}`;
  while (stillStarting(start.requestId)) {
    const status = await hubRequest<StartedThread>(path);
    if (!stillStarting(start.requestId)) return undefined;
    current = applyProgress(current, status.phase);
    if (status.id && status.computerId) return status;
    if (status.phase === "failed") {
      throw new HubRequestError(status.error || "Your thread could not start. Retry to continue.", 409);
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  return undefined;
}
export async function retryHubThread(start: ThreadStart) {
  if (running.has(start.requestId)) return;
  running.add(start.requestId);
  let current: ThreadStart = {...start, phase: "starting", progress: start.created ? "sending" : "creating", error: undefined};
  update(current);
  try {
    if (!current.created) {
      const created = await waitForCreated(current);
      if (!created) return;
      current = {...current, created, progress: "sending"};
      update(current);
    }
    current = applyProgress(current, "sending");
    await hubRequest(`${hubThreadPath(start.organizationId, current.created!.computerId, current.created!.id)}/message`, "POST", {
      text: start.message, messageId: `u-${start.requestId}`, attachmentIds: [],
    });
    update({...current, phase: "ready", progress: "sending"});
  } catch (error) {
    if (!starts.some(item => item.requestId === start.requestId)) return;
    update({...current, phase: "failed", error: error instanceof Error ? error.message : "Your thread could not start. Retry to continue."});
  } finally { running.delete(start.requestId); }
}
export function forgetThreadStart(id: string) {
  starts = starts.filter(s => s.requestId !== id);
  try { sessionStorage.setItem(storageKey, JSON.stringify(starts)); } catch {}
  listeners.forEach(fn => fn());
}
