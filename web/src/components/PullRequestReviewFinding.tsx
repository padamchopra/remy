import { useState } from "react";
import { Book, Bot, Check, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Markdown } from "@/components/Markdown";
import { useReviewSurface } from "@/components/PullRequestLineComment";
import { findingLines, SEVERITY_LABEL, type ReviewFinding } from "@/lib/review-agent";
import { lineNumberOn } from "@/lib/pull-request-review-state";
import type { ChatCodeReference, PullRequestDiffLine } from "@/state/types";
import { cn } from "@/lib/utils";

const TONE: Record<ReviewFinding["severity"], { border: string; text: string }> = {
  must: { border: "border-l-destructive-foreground", text: "text-destructive-foreground" },
  should: { border: "border-l-warning-foreground", text: "text-warning-foreground" },
  note: { border: "border-l-muted-foreground", text: "text-muted-foreground" },
};

const ACTION = "h-[26px] rounded-lg px-2.5 text-xs leading-4 font-normal shadow-none";

/// The lines a finding is about, as a code reference its Flag carries.
export function findingReference(finding: ReviewFinding, lines: readonly PullRequestDiffLine[] | undefined, comment: string): ChatCodeReference {
  const rows = (lines ?? []).filter((line) => {
    const number = lineNumberOn(line, finding.side);
    return number !== null && number >= finding.startLine && number <= finding.endLine
      && (finding.side === "LEFT" ? line.kind !== "add" : line.kind !== "del");
  });
  return {
    id: crypto.randomUUID(),
    path: finding.path,
    startLine: finding.startLine,
    endLine: finding.endLine,
    comment,
    lines: rows.slice(0, 200).map((line) => ({ ...line, text: line.text.slice(0, 10_000) })),
  };
}

/// A review agent finding drawn at its lines: severity on the left edge, what
/// it found, the rule it follows, and what you can do with it. Add to GitHub
/// review drafts it into your pending review; Dismiss keeps it only in the
/// pane, struck through; Flag tells the agent why it is wrong.
export function ReviewFindingCard({ finding, lines, where, className }: {
  finding: ReviewFinding;
  /// The hunk it sits in, so Flag carries the code.
  lines?: readonly PullRequestDiffLine[];
  /// Shown for a finding folded away from its lines.
  where?: string;
  className?: string;
}) {
  const surface = useReviewSurface();
  const [busy, setBusy] = useState<"add" | "dismiss" | "flag">();
  const [flagging, setFlagging] = useState(false);
  const [words, setWords] = useState("");
  const tone = TONE[finding.severity];
  const added = finding.status === "added-to-github";
  const run = async (action: "add" | "dismiss" | "flag", work: () => Promise<void>) => {
    if (busy) return;
    setBusy(action);
    try { await work(); } catch { /* the toast said why */ } finally { setBusy(undefined); }
  };
  const flag = () => run("flag", async () => {
    await surface.flagFinding?.(finding, words.trim(), findingReference(finding, lines, words.trim()));
    setFlagging(false);
    setWords("");
  });
  return (
    <article
      id={`review-finding-${finding.id}`}
      data-slot="review-finding"
      data-focused={surface.focusedFinding === finding.id || undefined}
      aria-label={`${SEVERITY_LABEL[finding.severity]}: ${finding.title}`}
      className={cn(
        "flex min-w-0 scroll-mt-16 flex-col gap-2.5 rounded-[10px] border border-l-2 border-input bg-card px-3.5 py-3 transition-shadow data-focused:ring-2 data-focused:ring-primary/50",
        tone.border,
        className,
      )}
    >
      <header className="flex min-w-0 items-center gap-2">
        <Bot aria-hidden className="size-3.5 shrink-0 text-foreground/70" />
        <span className="shrink-0 text-xs leading-4 font-semibold text-foreground">Review agent</span>
        <span className={cn("shrink-0 text-[11px] leading-4 font-medium", tone.text)}>{SEVERITY_LABEL[finding.severity]}</span>
        <span aria-hidden className="min-w-0 flex-1" />
        <span className="shrink-0 font-mono text-[11px] leading-4 text-muted-foreground">{where ?? findingLines(finding)}</span>
      </header>
      <Markdown text={finding.body} repository={surface.repository} onOpenLink={surface.onOpenLink} className="text-xs leading-[19px] text-foreground/90" />
      {finding.suggestion && (
        <pre className="overflow-x-auto rounded-lg border border-border bg-sidebar/50 px-3 py-2 font-mono text-[11px] leading-5 text-foreground/80"><code>{finding.suggestion}</code></pre>
      )}
      {finding.rules.map((rule) => (
        <p key={rule.id} className="flex min-w-0 items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
          <Book aria-hidden className="mt-0.5 size-3 shrink-0" />
          <span className="min-w-0">Follows your rule: {rule.text.replace(/\.$/, "")}</span>
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {added ? (
          <span className="flex h-[26px] items-center gap-1.5 text-xs leading-4 text-muted-foreground">
            <Check aria-hidden className="size-3.5 text-success-foreground" />
            In your pending review
          </span>
        ) : (
          <Button type="button" variant="secondary" disabled={Boolean(busy)} className={cn(ACTION, "border border-input bg-foreground/6 text-foreground dark:bg-foreground/6")} onClick={() => void run("add", async () => { await surface.addFinding?.(finding); })}>
            {busy === "add" && <Spinner data-icon="inline-start" />}
            Add to GitHub review
          </Button>
        )}
        <Button type="button" variant="outline" disabled={Boolean(busy)} className={cn(ACTION, "border-input bg-transparent text-foreground/70 hover:text-foreground dark:bg-transparent")} onClick={() => void run("dismiss", async () => { await surface.dismissFinding?.(finding); })}>
          {busy === "dismiss" && <Spinner data-icon="inline-start" />}
          Dismiss
        </Button>
        <Button type="button" variant="outline" aria-expanded={flagging} disabled={Boolean(busy)} className={cn(ACTION, "gap-1.5 border-input bg-transparent text-foreground/70 hover:text-foreground dark:bg-transparent")} onClick={() => setFlagging((value) => !value)}>
          <Flag aria-hidden className="size-3" />
          Flag
        </Button>
      </div>
      {flagging && (
        <div className="flex flex-col gap-2">
          <textarea
            aria-label="Why it's wrong"
            autoFocus
            value={words}
            maxLength={2000}
            placeholder="Say what it got wrong, so it can learn"
            onChange={(change) => setWords(change.target.value)}
            onKeyDown={(key) => {
              if (key.key === "Escape") { key.preventDefault(); key.stopPropagation(); setFlagging(false); }
              else if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) { key.preventDefault(); void flag(); }
            }}
            className="field-sizing-content min-h-[38px] w-full resize-none rounded-lg border border-border bg-sidebar/50 px-2.5 py-2 text-xs leading-[19px] text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:border-primary"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy === "flag"} className={cn(ACTION, "border-input bg-transparent text-foreground/70 dark:bg-transparent")} onClick={() => setFlagging(false)}>Cancel</Button>
            <Button type="button" disabled={busy === "flag"} className={cn(ACTION, "font-semibold")} onClick={() => void flag()}>
              {busy === "flag" && <Spinner data-icon="inline-start" />}
              Send to review agent
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
