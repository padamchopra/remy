import { useRef, useState } from "react";
import { ArrowDownUp, FileCode2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiError } from "@/lib/api-error";
import { contextGapLines, fileLines, validateFileContext, type ContextGap } from "@/lib/pull-request-context";
import { transport } from "@/lib/transport";
import type { PullRequestDiff, PullRequestDiffFile } from "@/state/types";

interface FileContent { text: string; revision: string }

export function FilePathLabel({ path }: { path: string }) {
  return <span title={path} dir="rtl" className="block min-w-0 flex-1 truncate text-left font-mono"><bdi dir="ltr">{path}</bdi></span>;
}

export function usePullRequestFileContent(serverId: string, pullRequest: PullRequestDiff, file: PullRequestDiffFile, revisionError?: string) {
  const [content, setContent] = useState<FileContent>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pending = useRef<Promise<FileContent | undefined> | undefined>(undefined);
  const load = (): Promise<FileContent | undefined> => {
    if (content) return Promise.resolve(content);
    if (pending.current) return pending.current;
    setLoading(true);
    setError("");
    pending.current = Promise.resolve().then(async () => {
      try {
        if (!pullRequest.headRefOid || (file.deleted && !pullRequest.baseRefOid)) {
          throw new Error(revisionError ?? "Refresh the pull request to load its file revision.");
        }
        const params = new URLSearchParams({ repository: pullRequest.repository, head: pullRequest.headRefOid, path: file.path });
        if (file.deleted) params.set("base", pullRequest.baseRefOid!);
        const result = await transport.request<FileContent>(serverId, `/pull-requests/file?${params}`);
        validateFileContext(file, fileLines(result.text));
        setContent(result);
        return result;
      } catch (caught) {
        const detail = apiError(caught);
        setError(/fetch failed|failed to fetch|network|timed? out/i.test(detail)
          ? "Couldn't reach this device. Check your connection and try again."
          : detail);
        return undefined;
      } finally {
        setLoading(false);
        pending.current = undefined;
      }
    });
    return pending.current;
  };
  return { content, error, loading, load };
}

type FileReader = ReturnType<typeof usePullRequestFileContent>;

export function PullRequestFileButton({ file, url, reader }: { file: PullRequestDiffFile; url: string; reader: FileReader }) {
  const [open, setOpen] = useState(false);
  const lines = reader.content ? fileLines(reader.content.text) : [];
  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) void reader.load(); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start rounded-none" aria-label={`View file ${file.path}`}>
          <FileCode2 />
          <FilePathLabel path={file.path} />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[85dvh] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="min-w-0 shrink-0 border-b border-border p-4 pr-12">
          <DialogTitle className="flex min-w-0"><FilePathLabel path={file.path} /></DialogTitle>
          <DialogDescription>
            {file.deleted ? "Before deletion" : "Diff version"}
            {reader.content && ` · ${reader.content.revision.slice(0, 7)} · ${lines.length.toLocaleString()} lines`}
          </DialogDescription>
        </DialogHeader>
        {reader.content ? (
          lines.length ? <ScrollArea className="min-h-0 flex-1">
            <div className="py-2 font-mono text-xs leading-5">
              {lines.map((line, index) => <div key={index} className="grid grid-cols-[4rem_minmax(0,1fr)]">
                <span className="border-r border-border px-3 text-right text-muted-foreground select-none">{index + 1}</span>
                <span className="whitespace-pre-wrap break-words px-3">{line || " "}</span>
              </div>)}
            </div>
          </ScrollArea> : <Empty><EmptyHeader><EmptyTitle>Empty file</EmptyTitle></EmptyHeader></Empty>
        ) : (
          <Empty className="min-h-0 flex-1">
            <EmptyHeader>
              <EmptyTitle>{reader.loading ? "Loading file…" : "Couldn't open this file"}</EmptyTitle>
              {reader.error && <EmptyDescription>{reader.error}</EmptyDescription>}
            </EmptyHeader>
            {!reader.loading && <EmptyContent>
              <Button variant="outline" size="sm" onClick={() => void reader.load()}>Try again</Button>
              <Button asChild variant="ghost" size="sm"><a href={`${url}/files`} target="_blank" rel="noreferrer">Open GitHub</a></Button>
            </EmptyContent>}
          </Empty>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PullRequestContextGap({ gap, path, reader }: { gap: ContextGap; path: string; reader: FileReader }) {
  const [shown, setShown] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const lines = reader.content ? fileLines(reader.content.text) : [];
  const count = gap.count ?? (reader.content ? Math.max(0, lines.length - gap.newStart + 1) : undefined);
  const remaining = count === undefined ? undefined : Math.max(0, count - shown);
  const expand = async () => {
    setAttempted(true);
    if (await reader.load()) setShown((value) => value + 20);
  };
  const control = remaining === 0 ? null : (
    <div className="border-y border-border bg-info/10">
      <Button variant="ghost" size="xs" className="w-full justify-start rounded-none px-3" disabled={reader.loading}
        aria-label={`Expand ${Math.min(20, remaining ?? 20)} lines in ${path} at line ${gap.newStart}`}
        onClick={() => void expand()}>
        {reader.loading ? <LoaderCircle className="animate-spin" /> : <ArrowDownUp />}
        {reader.loading ? "Loading lines…" : `Expand ${Math.min(20, remaining ?? 20)} lines`}
        {remaining !== undefined && <span className="text-muted-foreground">· {remaining} hidden</span>}
      </Button>
      {attempted && reader.error && <p role="alert" className="px-3 pb-2 text-xs text-destructive">{reader.error}</p>}
    </div>
  );
  return (
    <>
      {gap.fromEnd && control}
      {contextGapLines(gap, lines, shown).map((line) => (
        <div key={line.newLine} className="grid grid-cols-[2.25rem_2.25rem_minmax(0,1fr)] font-mono text-[11px] leading-5">
          <span className="border-r border-border px-1.5 text-right text-muted-foreground select-none">{line.oldLine}</span>
          <span className="border-r border-border px-1.5 text-right text-muted-foreground select-none">{line.newLine}</span>
          <span className="whitespace-pre-wrap break-words px-2"><span className="mr-1 select-none"> </span>{line.text || " "}</span>
        </div>
      ))}
      {!gap.fromEnd && control}
    </>
  );
}
