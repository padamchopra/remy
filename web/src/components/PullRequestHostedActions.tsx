import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog-base";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover-base";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip-base";
import { apiError } from "@/lib/api-error";
import { hubRequest, HubRequestError, hubThreadBase } from "@/lib/hub-threads";
import { stripMarkdownHtmlComments } from "@/lib/markdown-html-comments";
import { initials } from "@/lib/pull-request-detail";
import { cn } from "@/lib/utils";

/// A pull request write goes through the hub with the member's own GitHub
/// connection; `workspaceId` names the repository it goes to.
export function pullRequestAction<T>(
  organizationId: string,
  workspaceId: string,
  number: number,
  action:
    | "merge" | "request-reviewers" | "ready" | "draft" | "comment"
    | "view-file" | "line-comment" | "pending-comment" | "reply" | "edit-comment" | "delete-comment" | "submit-review",
  input: Record<string, unknown> = {},
) {
  return hubRequest<T>(`${hubThreadBase(organizationId)}/github/actions`, "POST", { workspaceId, number, action, ...input });
}

/// Squash and merge is always its own button. It stays off, saying why, until
/// GitHub says the pull request can merge; the dialog then carries the commit
/// GitHub will write.
export function SquashAndMerge({
  organizationId,
  workspaceId,
  pullRequest,
  headRefOid,
  blocker,
  onMerged,
}: {
  organizationId: string;
  workspaceId: string;
  pullRequest: { number: number; title: string; body?: string };
  headRefOid?: string | null;
  blocker: string;
  onMerged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [merging, setMerging] = useState(false);
  const change = (next: boolean) => {
    if (merging) return;
    if (next) {
      setTitle(`${pullRequest.title} (#${pullRequest.number})`);
      // Hidden markers a tool left in the description are not the commit message.
      setMessage(stripMarkdownHtmlComments(pullRequest.body ?? "").trim());
    }
    setOpen(next);
  };
  const merge = async () => {
    const commitTitle = title.trim();
    if (!commitTitle || blocker || merging) return;
    setMerging(true);
    try {
      await pullRequestAction(organizationId, workspaceId, pullRequest.number, "merge", {
        title: commitTitle,
        body: message.trim(),
        ...(headRefOid ? { sha: headRefOid } : {}),
      });
      setOpen(false);
      toast.success(`#${pullRequest.number} is merged.`);
      onMerged();
    } catch (caught) {
      toast.error("Couldn't merge the pull request", { description: apiError(caught) });
    } finally {
      setMerging(false);
    }
  };
  const button = (
    <Button
      type="button"
      data-slot="pull-request-merge"
      disabled={Boolean(blocker)}
      onClick={() => change(true)}
      className={cn(
        "h-[34px] w-full rounded-[9px] text-xs font-medium",
        "disabled:border disabled:border-border disabled:bg-secondary disabled:text-muted-foreground/60 disabled:opacity-100",
      )}
    >
      Squash and merge
    </Button>
  );
  return (
    <>
      {blocker ? (
        // A disabled button takes no pointer, so the reason sits on its box.
        <Tooltip>
          <TooltipTrigger render={<span className="block w-full" tabIndex={0} aria-label={`Squash and merge: ${blocker}`} />}>
            {button}
          </TooltipTrigger>
          <TooltipContent>{blocker}</TooltipContent>
        </Tooltip>
      ) : button}
      <Dialog open={open} onOpenChange={change}>
        <DialogContent showCloseButton={false} className="gap-4 rounded-2xl bg-popover p-5 sm:max-w-[568px]">
          <DialogHeader className="gap-1">
            <DialogTitle className="text-base leading-[22px] font-semibold">Squash and merge #{pullRequest.number}</DialogTitle>
            <DialogDescription className="sr-only">This lands the pull request as one commit.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field className="gap-1.5">
              <FieldLabel htmlFor={`merge-title-${pullRequest.number}`} className="text-xs leading-[17px] font-medium">Commit title</FieldLabel>
              <Input
                id={`merge-title-${pullRequest.number}`}
                value={title}
                maxLength={256}
                disabled={merging}
                autoFocus
                onChange={(event) => setTitle(event.target.value)}
                className="h-[34px] rounded-[9px] px-[11px] text-xs md:text-xs"
              />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor={`merge-message-${pullRequest.number}`} className="text-xs leading-[17px] font-medium">Commit message</FieldLabel>
              <Textarea
                id={`merge-message-${pullRequest.number}`}
                value={message}
                maxLength={60_000}
                disabled={merging}
                onChange={(event) => setMessage(event.target.value)}
                className="max-h-56 min-h-[72px] resize-y rounded-[9px] px-[11px] py-[9px] text-xs leading-[18px] md:text-xs"
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="gap-2.5 pt-0.5">
            <DialogClose render={<Button type="button" variant="outline" disabled={merging} className="h-8 rounded-[9px] px-[13px] text-xs font-normal" />}>
              Cancel
            </DialogClose>
            <Button type="button" disabled={merging || !title.trim()} onClick={() => void merge()} className="h-8 rounded-[9px] px-[15px] text-xs font-semibold">
              {merging && <Spinner data-icon="inline-start" />}
              Squash and merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface Candidate {
  login: string;
  name: string | null;
  suggested: boolean;
}

/// Request, beside the Reviewers heading: a picker of the people GitHub says
/// can review. Choosing one asks them straight away.
export function RequestReviewers({
  organizationId,
  workspaceId,
  repository,
  number,
  requested,
  onRequested,
}: {
  organizationId: string;
  workspaceId: string;
  repository: string;
  number: number;
  /// Logins already asked or already reviewing, marked rather than offered again.
  requested: readonly string[];
  onRequested: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>();
  const [unavailable, setUnavailable] = useState(false);
  const [sending, setSending] = useState<string>();
  useEffect(() => {
    if (!open) return;
    let current = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ repository, number: String(number), q: query });
      hubRequest<{ reviewers: Candidate[] }>(`${hubThreadBase(organizationId)}/github/pull-request-reviewers?${params}`)
        .then((response) => { if (current) { setCandidates(response.reviewers ?? []); setUnavailable(false); } })
        .catch((caught) => {
          if (!current) return;
          setCandidates([]);
          // An older hub has no reviewer list; GitHub still does.
          setUnavailable(caught instanceof HubRequestError && (caught.status === 404 || caught.status === 400));
        });
    }, query ? 200 : 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [open, query, organizationId, repository, number]);
  const asked = new Set(requested.map((login) => login.toLowerCase()));
  const request = async (login: string) => {
    if (sending || asked.has(login.toLowerCase())) return;
    setSending(login);
    try {
      await pullRequestAction(organizationId, workspaceId, number, "request-reviewers", { reviewers: [login] });
      toast.success(`${login} is asked to review.`);
      setOpen(false);
      onRequested();
    } catch (caught) {
      toast.error("Couldn't request a review", { description: apiError(caught) });
    } finally {
      setSending(undefined);
    }
  };
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverTrigger
        render={(
          <Button
            type="button"
            variant="ghost"
            className="h-auto rounded-sm px-1 py-0 text-[11px] leading-4 font-normal text-muted-foreground hover:text-foreground"
          />
        )}
      >
        Request
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0 max-sm:w-[var(--available-width)]">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search people" aria-label="Search people" />
          <CommandList>
            {candidates === undefined ? (
              <div role="status" className="shimmer px-3 py-6 text-center text-xs">Finding reviewers</div>
            ) : (
              <>
                <CommandEmpty className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {unavailable ? (
                    <a href={`https://github.com/${repository}/pull/${number}`} target="_blank" rel="noreferrer" data-link className="underline underline-offset-2 hover:text-foreground">
                      Request reviewers on GitHub
                    </a>
                  ) : "Nobody matches that."}
                </CommandEmpty>
                {candidates.map((candidate) => {
                  const already = asked.has(candidate.login.toLowerCase());
                  return (
                    <CommandItem
                      key={candidate.login}
                      value={candidate.login}
                      disabled={already || Boolean(sending)}
                      onSelect={() => void request(candidate.login)}
                      className="gap-2"
                    >
                      <ReviewerInitials name={candidate.name || candidate.login} />
                      <span className="min-w-0 flex-1 truncate text-xs">{candidate.name || candidate.login}</span>
                      {candidate.name && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{candidate.login}</span>}
                      {sending === candidate.login ? <Spinner className="size-3" /> : already ? <span className="shrink-0 text-[11px] text-muted-foreground">Asked</span> : null}
                    </CommandItem>
                  );
                })}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/// A reviewer's mark: their initials in a small well.
export function ReviewerInitials({ name }: { name: string }) {
  return (
    <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[9px] leading-3 font-semibold text-foreground/75">
      {initials(name)}
    </span>
  );
}
