import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { Message, MessageContent, MessageGroup } from "@/components/ui/message";
import { apiError } from "@/lib/api-error";
import { reviewReference, sameReviewSource } from "@/lib/pull-request-review";
import { transport } from "@/lib/transport";
import type { ModelChoice } from "@/lib/providers";
import type { ChatCodeReference, PullRequestQuestion, PullRequestQuestionSource } from "@/state/types";

interface Selection { source: PullRequestQuestionSource; anchor: number; focus: number; tab: string }
type Action = "thread" | "comment" | "review";
interface ReviewContext {
  selection?: Selection;
  questions: PullRequestQuestion[];
  select(source: PullRequestQuestionSource, index: number, shift: boolean, element: HTMLElement, point?: { x: number; y: number }): void;
  composer: ReactNode;
}
const Context = createContext<ReviewContext | undefined>(undefined);
export const usePullRequestReview = () => useContext(Context);

export function PullRequestReviewProvider({ serverId, repository, number, tab, onAddReference, children }: {
  serverId: string; repository: string; number: number; chatId?: string; tab: string; choice?: ModelChoice;
  onAddReference?: (reference: ChatCodeReference) => void | Promise<void>;
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<Selection>();
  const [action, setAction] = useState<Action>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<PullRequestQuestion[]>([]);
  const [, setReadError] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const focusEditor = useRef(false);
  const trigger = useRef<HTMLElement | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setAction(undefined); setSelection(undefined); }, [tab]);

  useEffect(() => {
    let current = true, reading = false, again = false;
    const params = new URLSearchParams({ repository, number: String(number) });
    const merge = (incoming: PullRequestQuestion[]) => {
      if (current) setQuestions((old) => [...new Map([...old, ...incoming].map((question) => [question.id, question])).values()]
        .sort((a, b) => a.createdAt - b.createdAt));
    };
    const read = async () => {
      if (reading) { again = true; return; }
      reading = true;
      try {
        const [owner, discovery] = await Promise.allSettled([
          transport.request<{ questions: PullRequestQuestion[] }>(serverId, `/pull-requests/questions?${params}`).then((result) => merge(result.questions)),
          (async () => {
            const servers = await transport.servers();
            const localId = servers.find((server) => server.local)?.id ?? serverId;
            const result = await transport.request<{ questions: PullRequestQuestion[]; unavailable: boolean }>(localId, `/pull-requests/questions/discover?${params}`);
            merge(result.questions);
            return result;
          })(),
        ]);
        if (current) setReadError(discovery.status === "rejected" ? apiError(discovery.reason)
          : discovery.value.unavailable || owner.status === "rejected" ? "Some devices are unavailable; saved questions may be missing." : "");
      } catch (error) { if (current) setReadError(apiError(error)); }
      finally { reading = false; if (current && again) { again = false; void read(); } }
    };
    void read();
    const off = transport.subscribe((_source, payload) => {
      if (!payload || typeof payload !== "object") return;
      const frame = payload as { type?: string; repository?: string; number?: number };
      if (["hello", "peer-reset", "peers"].includes(frame.type ?? "")
        || frame.type === "pull-request-question" && frame.repository === repository && frame.number === number) void read();
    }, ["pull-requests", "sidebar"]);
    const offStatus = transport.onStatus((_source, online) => {
      if (online) void read();
      else if (current) setReadError("A device is offline; saved questions may be out of date.");
    });
    return () => { current = false; off(); offStatus(); };
  }, [serverId, repository, number]);

  const select: ReviewContext["select"] = (source, index, shift, element, point) => {
    if (busy) return;
    setSelection((previous) => shift && previous?.tab === tab && sameReviewSource(previous.source, source)
      ? { ...previous, focus: index } : { source, anchor: index, focus: index, tab });
    const rect = element.getBoundingClientRect();
    trigger.current = element;
    setAction(onAddReference ? "thread" : "review");
    focusEditor.current = true;
    void point;
    void rect;
  };

  const submit = async (chosen: Action = action ?? "comment") => {
    if (!selection || !text.trim() || busy) return;
    const start = Math.min(selection.anchor, selection.focus), end = Math.max(selection.anchor, selection.focus);
    setBusy(true);
    try {
      if (chosen === "thread") {
        const reference = reviewReference(selection.source, start, end, text);
        if (!reference || !onAddReference) return;
        await onAddReference(reference);
        toast.success("Sent to the thread.");
      } else {
        await transport.request(serverId, "/pull-requests/review", {
          method: "POST",
          body: {
            repository,
            number,
            event: chosen === "review" ? "PENDING" : "COMMENT",
            body: text.trim(),
            path: selection.source.path,
            line: selection.source.lines[end]?.newLine ?? selection.source.lines[end]?.oldLine,
          },
        });
        toast.success(chosen === "review" ? "Added to your review." : "Comment posted.");
      }
      if (mounted.current) { setText(""); setAction(undefined); setSelection(undefined); }
    } catch (error) {
      if (mounted.current) toast.error("Couldn't send that comment", { description: apiError(error) });
    } finally { if (mounted.current) setBusy(false); }
  };
  const numbers = selection?.source.lines.slice(Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus) + 1)
    .map((line) => line.newLine ?? line.oldLine).filter((line): line is number => line !== null) ?? [];
  const firstLine = Math.min(...numbers), lastLine = Math.max(...numbers);
  const lineLabel = numbers.length ? `L${firstLine}${firstLine === lastLine ? "" : `–${lastLine}`}` : "Selected lines";
  const composer = action && selection?.tab === tab && (
    <div className="shrink-0 border-t border-border bg-background p-3">
      <InputGroup>
        <InputGroupTextarea ref={editor} autoFocus value={text} disabled={busy} onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(onAddReference ? "thread" : "review"); } }}
          aria-label="Comment"
          placeholder="Comment on these lines." className="min-h-16" />
        <InputGroupAddon align="block-end" className="border-t">
          <InputGroupText className="min-w-0 truncate">{selection.source.path.split("/").at(-1)} · {lineLabel}</InputGroupText>
          <Button className="ml-auto" variant="ghost" size="sm" disabled={busy} onClick={() => { setText(""); setAction(undefined); setSelection(undefined); }}><X />Cancel</Button>
          {onAddReference ? (
            <>
              <Button variant="outline" size="sm" disabled={!text.trim() || busy} onClick={() => void submit("review")}>Add to review</Button>
              <Button variant="outline" size="sm" disabled={!text.trim() || busy} onClick={() => void submit("comment")}>Comment</Button>
              <Button size="sm" disabled={!text.trim() || busy} onClick={() => void submit("thread")}>
                {busy ? <LoaderCircle className="animate-spin" /> : null}
                Send to thread
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" disabled={!text.trim() || busy} onClick={() => void submit("comment")}>Comment</Button>
              <Button size="sm" disabled={!text.trim() || busy} onClick={() => void submit("review")}>Add to review</Button>
            </>
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
  return (
    <Context.Provider value={{ selection, questions, select, composer }}>
      {children}
    </Context.Provider>
  );
}

export function PullRequestReviewComposer() { return usePullRequestReview()?.composer; }

export function PullRequestLineQuestions({ source, index }: { source: PullRequestQuestionSource; index: number }) {
  const review = usePullRequestReview();
  const questions = review?.questions.filter((question) => question.end === index && sameReviewSource(question.source, source)) ?? [];
  if (!questions.length) return null;
  return <MessageGroup className="gap-3 border-y border-border bg-muted/30 px-4 py-4 font-sans">
    {questions.map((question) => <div key={question.id} className="flex min-w-0 flex-col gap-2">
      <Message align="end"><MessageContent><Bubble variant="secondary" align="end"><BubbleContent>{question.question}</BubbleContent></Bubble></MessageContent></Message>
      <Message><MessageContent><Bubble variant="outline"><BubbleContent><Markdown text={question.answer} className="text-sm" /></BubbleContent></Bubble></MessageContent></Message>
    </div>)}
  </MessageGroup>;
}
