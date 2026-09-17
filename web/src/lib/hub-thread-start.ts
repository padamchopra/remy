import { useSyncExternalStore } from "react";
import { hubRequest, hubThreadBase, hubThreadPath } from "./hub-threads";

type StartedThread = { id: string; computerId: string };
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
export function startHubThread(input: Omit<ThreadStart, "phase" | "at">) {
  const start: ThreadStart = {...input, phase: "starting", at: Date.now()};
  update(start);
  void retryHubThread(start);
}
export async function retryHubThread(start: ThreadStart) {
  if (running.has(start.requestId)) return;
  running.add(start.requestId);
  let current: ThreadStart = {...start, phase: "starting", error: undefined};
  update(current);
  try {
    if (!current.created) {
      const created = await hubRequest<StartedThread>(`${hubThreadBase(start.organizationId)}/threads`, "POST", {
        workspaceId: start.workspaceId, computerId: start.computerId,
        title: start.message.slice(0, 200), requestId: start.requestId,
        branch: start.branch, provider: start.provider, model: start.model,
        visibility: start.visibility,
      });
      current = {...current, created};
      update(current);
    }
    await hubRequest(`${hubThreadPath(start.organizationId, current.created!.computerId, current.created!.id)}/message`, "POST", {
      text: start.message, messageId: `u-${start.requestId}`, attachmentIds: [],
    });
    update({...current, phase: "ready"});
  } catch (error) {
    update({...current, phase: "failed", error: error instanceof Error ? error.message : "Your thread could not start. Retry to continue."});
  } finally { running.delete(start.requestId); }
}
export function forgetThreadStart(id: string) {
  starts = starts.filter(s => s.requestId !== id);
  try { sessionStorage.setItem(storageKey, JSON.stringify(starts)); } catch {}
  listeners.forEach(fn => fn());
}
