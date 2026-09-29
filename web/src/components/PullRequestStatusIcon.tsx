import { GitPullRequest, GitPullRequestDraft } from "lucide-react";
import type { PullRequestStatus } from "@/lib/pull-request-status";
import { cn } from "@/lib/utils";

const TONES: Record<PullRequestStatus["tone"], string> = {
  muted: "text-muted-foreground/60",
  error: "text-destructive",
  warning: "text-warning",
  info: "text-info",
  success: "text-success-foreground",
};

/// A list row's pull request icon, coloured by what it is waiting on. The row
/// says the same thing in words, so the colour is never the only signal.
export function PullRequestStatusIcon({ status, className }: { status: PullRequestStatus; className?: string }) {
  const Icon = status.kind === "draft" ? GitPullRequestDraft : GitPullRequest;
  return <Icon aria-hidden data-status={status.kind} className={cn("shrink-0", TONES[status.tone], className)} />;
}
