export type ThreadStartProgress =
  | "creating"
  | "waking"
  | "restoring"
  | "starting_runtime"
  | "connecting"
  | "preparing_branch"
  | "sending"
  | "ready"
  | "failed";

const LABELS: Record<Exclude<ThreadStartProgress, "ready" | "failed">, string> = {
  creating: "Creating thread…",
  waking: "Waking computer…",
  restoring: "Restoring computer…",
  starting_runtime: "Starting runtime…",
  connecting: "Connecting…",
  preparing_branch: "Preparing branch…",
  sending: "Sending message…",
};

/// Status text for a pending new-thread wait. Unknown phases stay on Creating thread….
export function threadStartProgressLabel(progress?: string): string {
  return LABELS[progress as keyof typeof LABELS] ?? LABELS.creating;
}
