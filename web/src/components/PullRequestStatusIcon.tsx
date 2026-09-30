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

/// A list row's status, shown by its icon and exposed to assistive technology.
export function PullRequestStatusIcon({ status, className }: { status: PullRequestStatus; className?: string }) {
  const Icon = status.kind === "draft" ? GitPullRequestDraft : GitPullRequest;
  return <Icon role="img" aria-label={status.label} data-status={status.kind} className={cn("shrink-0", TONES[status.tone], className)} />;
}
