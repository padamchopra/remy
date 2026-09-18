export type ThreadStartProgress =
  | "creating"
  | "waking"
  | "restoring"
  | "starting_runtime"
  | "connecting"
  | "preparing_branch"
  | "ready"
  | "failed";

export type ManualThreadStart = {
  started?: boolean;
  phase?: ThreadStartProgress;
  workspaceId?: string;
  computerId?: string;
  id?: string;
  error?: string;
  at?: number;
};

const HOSTED_PROGRESS: Record<string, ThreadStartProgress> = {
  allocating: "waking",
  restoring: "restoring",
  starting_runtime: "starting_runtime",
  connecting: "connecting",
  ready: "connecting",
  failed: "failed",
};

/// Map the stored start record and live hosted lifecycle onto one client progress value.
export function threadStartProgress(input: {
  hostedPhase?: string | undefined;
  record?: ManualThreadStart | undefined;
}): ThreadStartProgress {
  const record = input.record;
  if (record?.id && record.computerId) return "ready";
  if (record?.error || record?.phase === "failed") return "failed";
  const hosted = input.hostedPhase ? HOSTED_PROGRESS[input.hostedPhase] : undefined;
  if (hosted) return hosted;
  if (record?.phase === "preparing_branch") return "preparing_branch";
  return "creating";
}
