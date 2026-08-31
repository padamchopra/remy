import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, MessageSquarePlus, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { Message, MessageContent, MessageGroup } from "@/components/ui/message";
import { apiError } from "@/lib/api-error";
import { reviewReference, sameReviewSource } from "@/lib/pull-request-review";
import { transport } from "@/lib/transport";
import type { ModelChoice } from "@/lib/providers";
import type { ChatCodeReference, PullRequestQuestion, PullRequestQuestionSource } from "@/state/types";

interface Selection { source: PullRequestQuestionSource; anchor: number; focus: number; tab: string }
type Action = "comment" | "question";
interface ReviewContext {
  selection?: Selection;
  questions: PullRequestQuestion[];
  select(source: PullRequestQuestionSource, index: number, shift: boolean, element: HTMLElement, point?: { x: number; y: number }): void;
  composer: ReactNode;
}
const Context = createContext<ReviewContext | undefined>(undefined);
export const usePullRequestReview = () => useContext(Context);

export function PullRequestReviewProvider({ serverId, repository, number, chatId, tab, choice, onAddReference, children }: {
  serverId: string; repository: string; number: number; chatId?: string; tab: string; choice?: ModelChoice;
  onAddReference?: (reference: ChatCodeReference) => void | Promise<void>;
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<Selection>();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [action, setAction] = useState<Action>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<PullRequestQuestion[]>([]);
  const [readError, setReadError] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const focusEditor = useRef(false);
  const trigger = useRef<HTMLElement | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setMenu(undefined); }, [tab]);

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
    });
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
    setMenu({ x: point?.x ?? rect.left + 80, y: point?.y ?? rect.bottom });
    setAction(undefined);
  };

  const submit = async () => {
    if (!selection || !action || !text.trim() || busy) return;
    const start = Math.min(selection.anchor, selection.focus), end = Math.max(selection.anchor, selection.focus);
    setBusy(true);
    try {
      if (action === "comment") {
        const reference = reviewReference(selection.source, start, end, text);
        if (!reference || !onAddReference) return;
        await onAddReference(reference);
        toast.success("Change comment added to the thread.");
      } else {
        const response = await transport.request<{ question: PullRequestQuestion }>(serverId, "/pull-requests/questions", {
          method: "POST", body: { repository, number, chatId, choice, source: selection.source, start, end, question: text.trim() },
        });
        if (!mounted.current) return;
        setQuestions((old) => [...old.filter((question) => question.id !== response.question.id), response.question]);
      }
      if (mounted.current) { setText(""); setAction(undefined); setSelection(undefined); }
    } catch (error) {
      if (mounted.current) toast.error(action === "question" ? "Couldn't answer that question" : "Couldn't add the comment", { description: apiError(error) });
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
          onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); } }}
          aria-label={action === "question" ? "Review question" : "Change comment"}
          placeholder={action === "question" ? "Ask about these lines." : "Describe the change you want."} className="min-h-16" />
        <InputGroupAddon align="block-end" className="border-t">
          <InputGroupText className="min-w-0 truncate">{selection.source.path.split("/").at(-1)} · {lineLabel}</InputGroupText>
          <InputGroupButton className="ml-auto" aria-label="Cancel line action" disabled={busy} onClick={() => { setText(""); setAction(undefined); setSelection(undefined); }}><X /></InputGroupButton>
          <InputGroupButton variant="default" disabled={!text.trim() || busy || action === "comment" && !onAddReference} onClick={() => void submit()}>
            {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : action === "question" ? <Send data-icon="inline-start" /> : <MessageSquarePlus data-icon="inline-start" />}
            {busy ? action === "question" ? "Answering…" : "Adding…" : action === "question" ? "Ask" : "Add to thread"}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {action === "question" && readError && <p role="status" className="mt-2 text-xs text-muted-foreground">{readError}</p>}
      {action === "comment" && !onAddReference && <p className="mt-2 text-xs text-muted-foreground">Open this pull request in a thread to add a change comment.</p>}
    </div>
  );
  return (
    <Context.Provider value={{ selection, questions, select, composer }}>
      {children}
      <DropdownMenu modal={false} open={Boolean(menu)} onOpenChange={(open) => { if (!open) setMenu(undefined); }}>
        <DropdownMenuTrigger asChild><span aria-hidden className="pointer-events-none fixed size-px" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} /></DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (focusEditor.current) { focusEditor.current = false; editor.current?.focus(); }
          else trigger.current?.focus();
        }}>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => { focusEditor.current = true; setAction("comment"); }}><MessageSquarePlus />Change comment</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { focusEditor.current = true; setAction("question"); }}><Sparkles />Ask question</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
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
