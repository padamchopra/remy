import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover-base";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group-base";
import { Spinner } from "@/components/ui/spinner";
import { apiError } from "@/lib/api-error";
import { finishReviewSummary } from "@/lib/pull-request-review-state";
import { cn } from "@/lib/utils";

type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

const EVENTS: { value: ReviewEvent; label: string; detail: string }[] = [
  { value: "COMMENT", label: "Comment", detail: "Leave notes without a verdict." },
  { value: "APPROVE", label: "Approve", detail: "These changes are good to merge." },
  { value: "REQUEST_CHANGES", label: "Request changes", detail: "Ask for work before this can merge." },
];

/// Finish review is always there, with how many comments wait in your pending
/// review. Its popover takes an overall note and a verdict, and Send review
/// submits the pending review, or a new one when nothing is queued. GitHub
/// does not let an author approve or request changes on their own work.
export function FinishReview({ queued, own, onSubmit }: {
  queued: number;
  own: boolean;
  onSubmit: (event: ReviewEvent, body: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [sending, setSending] = useState(false);
  const id = useId();
  const chosen = own && event !== "COMMENT" ? "COMMENT" : event;
  const empty = chosen === "COMMENT" && !note.trim() && queued === 0;
  const send = async () => {
    if (empty || sending) return;
    setSending(true);
    try {
      await onSubmit(chosen, note.trim());
      setOpen(false);
      setNote("");
      setEvent("COMMENT");
      toast.success(chosen === "APPROVE" ? "You approved this pull request." : chosen === "REQUEST_CHANGES" ? "You asked for changes." : "Your review is on GitHub.");
    } catch (caught) {
      toast.error("Couldn't send your review", { description: apiError(caught) });
    } finally {
      setSending(false);
    }
  };
  return (
    <Popover open={open} onOpenChange={(next) => { if (!sending) setOpen(next); }}>
      <PopoverTrigger
        render={(
          <Button
            type="button"
            data-slot="finish-review"
            className="h-[30px] gap-2 rounded-lg px-3 text-xs leading-4 font-semibold"
          />
        )}
      >
        Finish review
        <span
          aria-label={`${queued} queued`}
          className="flex h-4 min-w-4 items-center justify-center rounded-[5px] bg-primary-foreground/20 px-1 text-[10px] leading-3 font-bold tabular-nums"
        >
          {queued}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="flex w-[448px] flex-col gap-3.5 rounded-[14px] border-foreground/10 p-4 shadow-lg max-sm:w-[var(--available-width)]">
        <div className="flex flex-col gap-[3px]">
          <PopoverTitle className="text-sm leading-5 font-semibold text-foreground">Finish your review</PopoverTitle>
          <PopoverDescription className="text-xs leading-[17px]">{finishReviewSummary(queued)}</PopoverDescription>
        </div>
        <textarea
          aria-label="Overall note"
          value={note}
          maxLength={65_000}
          placeholder="Say what you think of the change as a whole"
          onChange={(change) => setNote(change.target.value)}
          onKeyDown={(key) => { if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) { key.preventDefault(); void send(); } }}
          className="field-sizing-content h-[74px] max-h-60 min-h-[74px] w-full resize-none rounded-[10px] border border-foreground/10 bg-background/45 px-3 py-2.5 text-xs leading-[18px] text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:border-primary"
        />
        <RadioGroup value={chosen} onValueChange={(value) => setEvent(value as ReviewEvent)} aria-label="Verdict" className="gap-2">
          {EVENTS.map((option) => {
            const disabled = own && option.value !== "COMMENT";
            return (
              <label key={option.value} htmlFor={`${id}-${option.value}`} className={cn("flex items-start gap-2.5", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
                <RadioGroupItem id={`${id}-${option.value}`} value={option.value} disabled={disabled} className="mt-0.5 size-[15px] border-foreground/20" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs leading-[18px] font-medium text-foreground">{option.label}</span>
                  <span className="text-[11px] leading-4 text-muted-foreground">{option.detail}</span>
                </span>
              </label>
            );
          })}
        </RadioGroup>
        {own && <p className="text-[11px] leading-4 text-muted-foreground">You can't approve or request changes on your own pull request.</p>}
        <div className="flex items-center justify-end gap-2.5 pt-0.5">
          <Button type="button" variant="outline" disabled={sending} onClick={() => setOpen(false)} className="h-[30px] rounded-lg border-foreground/10 bg-transparent px-3 text-xs font-normal text-foreground/70 shadow-none dark:bg-transparent">
            Cancel
          </Button>
          <Button type="button" disabled={empty || sending} onClick={() => void send()} className="h-[30px] rounded-lg px-3.5 text-xs font-semibold">
            {sending && <Spinner data-icon="inline-start" />}
            Send review
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
