import { useState } from "react";
import { Book, GitPullRequest, ListChecks } from "lucide-react";
import { PaneHeader } from "./PaneHeader";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover-base";
import { ReviewAgentRules } from "./ReviewAgentRules";
import { FindingsList, ProposalCard } from "./ReviewAgentPane";
import { useThreadReview, useReviewRules } from "@/lib/review-agent-data";
import type { Route } from "@/lib/route";
import { reviewNewChanges } from "@/lib/review-agent";
import { HubRequestError } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
import { toast } from "sonner";

export interface ReviewThreadReference { repository: string; number: number }

export default function ReviewThreadSurface({ organizationId, computerId, threadId, reference, navigate, showRules, onShowRules }: {
  organizationId: string;
  computerId?: string;
  threadId?: string;
  reference: ReviewThreadReference;
  navigate: (route: Route) => void;
  showRules: boolean;
  onShowRules: (show: boolean) => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const { review, setReview, error, reload: reloadReview } = useThreadReview(organizationId, computerId, threadId);
  const { rules, reload } = useReviewRules(organizationId, reference.repository);
  const workspace = { name: reference.repository.split("/").at(-1) ?? reference.repository };
  const openPullRequest = (files = false) => navigate({ name: "prs", organizationId, repository: reference.repository, number: reference.number, ...(files ? { view: "files" } : {}) });
  const reviewNew = async () => {
    if (!review || reviewing) return;
    setReviewing(true);
    try {
      const result = await reviewNewChanges(organizationId, review.computerId, review.threadId);
      setReview(result.review);
    } catch (caught) {
      if (caught instanceof HubRequestError && caught.status === 409) toast("There are no new commits since the review.");
      else toast.error("Couldn't review the new changes", { description: apiError(caught) });
    } finally { setReviewing(false); }
  };
  const proposals = review?.proposals.map(proposal => <ProposalCard key={proposal.id} organizationId={organizationId} proposal={proposal} workspace={workspace} onDecided={(decided, rule) => {
    setReview(current => current ? { ...current, proposals: current.proposals.filter(entry => entry.id !== decided.id) } : current);
    if (rule) void reload();
  }} />);
  return (
    <>
      <PaneHeader crumbs={[{ label: "Review agent" }]}>
        <Button size="sm" variant="ghost" data-link aria-label={`Open pull request #${reference.number}`} onClick={() => openPullRequest()}><GitPullRequest />#{reference.number}</Button>
        <Popover>
          <PopoverTrigger render={<Button size="sm" variant="ghost" aria-label="Review findings" />}><ListChecks />{review?.findings.length ?? 0}</PopoverTrigger>
          <PopoverContent align="end" className="flex max-h-[70dvh] w-96 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-auto">
            {review ? <FindingsList findings={review.findings} onFinding={() => openPullRequest(true)} /> : error ? <><p role="alert">{error}</p><Button onClick={() => void reloadReview()}>Try again</Button></> : <p role="status">Loading findings…</p>}
            {review && <Button disabled={reviewing} onClick={() => void reviewNew()}>Review new changes</Button>}
          </PopoverContent>
        </Popover>
        <Button size="sm" variant="ghost" aria-pressed={showRules} onClick={() => onShowRules(!showRules)}><Book />Rules{review?.proposals.length ? ` · ${review.proposals.length}` : ""}</Button>
      </PaneHeader>
      {showRules && <div className="flex min-h-0 flex-1 flex-col">
        {proposals?.length ? <div className="flex max-h-[40dvh] shrink-0 flex-col gap-3 overflow-auto p-4">{proposals}</div> : null}
        <ReviewAgentRules repository={reference.repository} workspace={workspace} rules={rules} onBack={() => onShowRules(false)} onChanged={() => void reload()} />
      </div>}
    </>
  );
}
