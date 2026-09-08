import { Badge } from "@/components/ui/badge";
import type { ChatState } from "@/state/types";

const states = {
  idle: { label: "Done", variant: "ghost" },
  working: { label: "Working", variant: "info" },
  needs_input: { label: "Needs you", variant: "warning" },
  error: { label: "Error", variant: "destructive" },
} as const;

export function ThreadStatus({ state }: { state: ChatState }) {
  const status = states[state];
  return <Badge variant={status.variant} className="thread-status">{status.label}</Badge>;
}
