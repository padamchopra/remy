import { useState } from "react";
import { GitMerge } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiError } from "@/lib/api-error";
import { transport } from "@/lib/transport";
import type { PullRequestDiff } from "@/state/types";

function mergeBlocker(pullRequest: PullRequestDiff): string {
  if (pullRequest.isDraft) return "Mark this pull request ready before merging.";
  if (pullRequest.checks.some((check) => check.state === "fail")) return "Fix the failing checks before merging.";
  if (pullRequest.checks.some((check) => check.state === "pending")) return "Wait for the checks to finish before merging.";
  if (pullRequest.mergeable === "CONFLICTING") return "Resolve the merge conflicts before merging.";
  if (pullRequest.mergeable !== "MERGEABLE" || pullRequest.mergeStateStatus !== "CLEAN") {
    return "GitHub isn't ready to merge this pull request yet.";
  }
  return "";
}

export function PullRequestMergeDialog({
  serverId,
  pullRequest,
  onMerged,
}: {
  serverId: string;
  pullRequest: PullRequestDiff;
  onMerged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(pullRequest.title);
  const [message, setMessage] = useState(pullRequest.body);
  const [merging, setMerging] = useState(false);
  const blocker = mergeBlocker(pullRequest);

  const changeOpen = (next: boolean) => {
    if (merging) return;
    if (next) {
      setTitle(pullRequest.title);
      setMessage(pullRequest.body);
    }
    setOpen(next);
  };

  const merge = async () => {
    const commitTitle = title.trim();
    if (!commitTitle || blocker || merging || !pullRequest.headRefOid) return;
    setMerging(true);
    try {
      await transport.request(serverId, "/pull-requests/merge", {
        method: "POST",
        body: {
          repository: pullRequest.repository,
          number: pullRequest.number,
          headRefOid: pullRequest.headRefOid,
          title: commitTitle,
          message: message.trim(),
        },
      });
      setOpen(false);
      onMerged();
      toast.success("Pull request merged.");
    } catch (caught) {
      toast.error("Couldn't merge the pull request", { description: apiError(caught) });
    } finally {
      setMerging(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <Button type="button" size="sm" variant="secondary" onClick={() => changeOpen(true)}>
        <GitMerge />
        Squash and merge
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Squash and merge #{pullRequest.number}?</AlertDialogTitle>
          <AlertDialogDescription>
            {blocker || `This merges into ${pullRequest.baseRefName} as one commit.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor={`merge-title-${pullRequest.number}`}>Commit title</FieldLabel>
            <Input
              id={`merge-title-${pullRequest.number}`}
              value={title}
              maxLength={256}
              onChange={(event) => setTitle(event.target.value)}
              disabled={merging}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`merge-message-${pullRequest.number}`}>Commit message</FieldLabel>
            <Textarea
              id={`merge-message-${pullRequest.number}`}
              value={message}
              maxLength={65_536}
              onChange={(event) => setMessage(event.target.value)}
              disabled={merging}
              className="max-h-56 min-h-28 resize-y"
            />
          </Field>
        </FieldGroup>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={merging}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={Boolean(blocker) || !title.trim() || merging || !pullRequest.headRefOid}
            onClick={(event) => {
              event.preventDefault();
              void merge();
            }}
          >
            {merging ? "Merging…" : "Squash and merge"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
