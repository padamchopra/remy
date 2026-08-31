import type { ConvEntry, ThreadActivity } from "../state/types";

export const activityRunning = (row: ThreadActivity) => row.status === "running" || row.status === "waiting";

/// Old devices still expose ordinary tool entries, but cannot prove background lifetimes.
export function threadActivities(entries: readonly ConvEntry[], provider: string, working: boolean, connected: boolean): ThreadActivity[] {
  const native = entries.flatMap((entry) => entry.activity ? [entry.activity] : []);
  let lastUser = -1;
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].kind === "user") { lastUser = index; break; }
  }
  const rows = native.length ? native : entries.flatMap((entry, index): ThreadActivity[] => {
    if (entry.kind !== "tool" || !/^(Bash|Shell|execute|command_execution|Agent|Task)$/i.test(entry.tool ?? "")) return [];
    return [{
      id: entry.id, provider, kind: /^(Agent|Task)$/i.test(entry.tool!) ? "subagent" : "shell",
      title: entry.arg || entry.tool!, command: /^(Agent|Task)$/i.test(entry.tool!) ? undefined : entry.arg,
      status: entry.status === "ok" ? "completed" : entry.status === "error" ? "failed" : entry.status === "stopped" ? "stopped" : working && index > lastUser ? "running" : "unknown",
      startedAt: entry.at ?? 0, updatedAt: entry.completedAt ?? entry.at ?? 0, completedAt: entry.completedAt, output: entry.output,
    }];
  });
  return rows.map((row) => !connected && activityRunning(row) ? { ...row, status: "unknown" as const } : row);
}
