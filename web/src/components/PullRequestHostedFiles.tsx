import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FileDiff, FileMinus, FilePen, FilePlus, FileSymlink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible-base";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { FilePathLabel } from "@/components/PullRequestFileContext";
import { apiError } from "@/lib/api-error";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { parsePullRequestPatch } from "@/lib/pull-request-patch";
import { cn } from "@/lib/utils";
import type { AuthoredPullRequest } from "@/components/PullRequests";
import type { PullRequestDiffHunk } from "@/state/types";

/// One changed file as the hub reads it from GitHub. `patch` is missing for a
/// binary file or one GitHub will not diff; `patchOmitted` means the hub had
/// already carried as much patch text as one answer holds.
interface HostedFile {
  path: string;
  previousPath?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  patchOmitted?: boolean;
}

interface HostedFiles {
  files: HostedFile[];
  truncated?: boolean;
  patchesOmitted?: boolean;
}

/// A file this long starts folded, so one generated file cannot bury the rest.
const LARGE_FILE_LINES = 400;
const LINE_HEIGHT = 20;

const STATUS = {
  added: { Icon: FilePlus, label: "Added", className: "text-success-foreground" },
  removed: { Icon: FileMinus, label: "Deleted", className: "text-destructive" },
  renamed: { Icon: FileSymlink, label: "Renamed", className: "text-info-foreground" },
  copied: { Icon: FileSymlink, label: "Copied", className: "text-info-foreground" },
  modified: { Icon: FilePen, label: "Modified", className: "text-muted-foreground" },
} as const;

function statusOf(file: HostedFile) {
  return STATUS[file.status as keyof typeof STATUS] ?? STATUS.modified;
}

function fileId(index: number) {
  return `pull-request-file-${index}`;
}

function useHostedFiles(organizationId: string, pullRequest: AuthoredPullRequest) {
  const [state, setState] = useState<{ files?: HostedFiles; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setState({});
    const params = new URLSearchParams({
      repository: pullRequest.repository,
      number: String(pullRequest.number),
      ...(pullRequest.changedFiles ? { changedFiles: String(pullRequest.changedFiles) } : {}),
    });
    hubRequest<HostedFiles>(`${hubThreadBase(organizationId)}/github/pull-request-files?${params}`)
      .then((files) => { if (current) setState({ files: { ...files, files: Array.isArray(files.files) ? files.files : [] } }); })
      .catch((error) => { if (current) setState({ error: apiError(error) }); });
    return () => { current = false; };
    // The file list is read again only when asked; `updatedAt` names the revision.
  }, [organizationId, pullRequest.repository, pullRequest.number, pullRequest.changedFiles, pullRequest.updatedAt, attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

/// Lines of a hunk draw only once they come near the screen; until then a box
/// of the same height holds their place, so a long pull request opens at once
/// and the scrollbar is already the right length.
function useNearScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true);
    }, { rootMargin: "1200px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near] as const;
}

const Hunk = memo(function Hunk({ hunk }: { hunk: PullRequestDiffHunk }) {
  const [ref, near] = useNearScreen<HTMLDivElement>();
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="bg-info/10 px-3 py-1 font-mono text-[11px] leading-5 break-all text-muted-foreground">{hunk.header}</div>
      <div ref={ref} className="font-mono text-[11px] leading-5 sm:text-xs" style={near ? undefined : { height: hunk.lines.length * LINE_HEIGHT }}>
        {near && hunk.lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              // A phone keeps one number column; two leave the code no room.
              "grid grid-cols-[2.5rem_minmax(0,1fr)] sm:grid-cols-[3rem_3rem_minmax(0,1fr)]",
              line.kind === "add" && "bg-success/10",
              line.kind === "del" && "bg-destructive/10",
            )}
          >
            <span className="hidden border-r border-border px-2 text-right text-muted-foreground/80 tabular-nums select-none sm:block">{line.oldLine ?? ""}</span>
            <span className="border-r border-border px-1.5 text-right text-muted-foreground/80 tabular-nums select-none sm:px-2">
              <span className="sm:hidden">{line.newLine ?? line.oldLine}</span>
              <span className="hidden sm:inline">{line.newLine ?? ""}</span>
            </span>
            <span className="px-2 break-words whitespace-pre-wrap">
              <span className={cn("mr-1.5 select-none", line.kind === "add" ? "text-success-foreground" : line.kind === "del" ? "text-destructive" : "text-transparent")}>
                {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
              </span>
              {line.text || " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

const FileDiffView = memo(function FileDiffView({ file, index, open, onOpenChange, url }: {
  file: HostedFile;
  index: number;
  open: boolean;
  onOpenChange: (index: number, open: boolean) => void;
  url: string;
}) {
  const status = statusOf(file);
  const hunks = useMemo(() => (open && file.patch ? parsePullRequestPatch(file.patch) : []), [open, file.patch]);
  return (
    <Collapsible
      id={fileId(index)}
      data-index={index}
      open={open}
      onOpenChange={(next) => onOpenChange(index, next)}
      data-slot="pull-request-file"
      className="scroll-mt-2 overflow-hidden rounded-lg border border-border"
    >
      <CollapsibleTrigger
        data-file-index={index}
        aria-label={`${open ? "Collapse" : "Expand"} ${file.path}`}
        className="group/file sticky top-0 z-10 flex h-10 w-full min-w-0 items-center gap-2 bg-background px-3 text-left text-xs outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 data-[panel-open]:border-b data-[panel-open]:border-border"
      >
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[panel-open]/file:rotate-90" />
        <status.Icon className={cn("size-3.5 shrink-0", status.className)} aria-label={status.label} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {file.previousPath && file.previousPath !== file.path && (
            <>
              <span className="max-w-[40%] min-w-0 shrink text-muted-foreground"><FilePathLabel path={file.previousPath} /></span>
              <span className="shrink-0 text-muted-foreground">→</span>
            </>
          )}
          <FilePathLabel path={file.path} />
        </span>
        <span className="shrink-0 font-mono tabular-nums" aria-label={`${file.additions} additions, ${file.deletions} deletions`}>
          <span className="text-success-foreground">+{file.additions}</span> <span className="text-destructive">−{file.deletions}</span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {file.patch ? (
          hunks.map((hunk, hunkIndex) => <Hunk key={`${hunk.header}:${hunkIndex}`} hunk={hunk} />)
        ) : (
          <p className="flex flex-wrap items-center justify-center gap-x-1 px-3 py-6 text-center text-xs text-muted-foreground">
            {file.patchOmitted
              ? "This diff is too large to show here."
              : file.status === "renamed" && file.additions + file.deletions === 0 ? "Renamed without changes." : "GitHub has no text diff for this file."}
            <a href={`${url}/files`} target="_blank" rel="noreferrer" data-link className="underline underline-offset-2 hover:text-foreground">Open on GitHub</a>
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
});

function initiallyOpen(files: HostedFile[]) {
  return new Set(files.flatMap((file, index) => (file.additions + file.deletions <= LARGE_FILE_LINES ? [index] : [])));
}

/// The files a pull request changes, each as its own diff. `j` and `k` move
/// between files the way they do on GitHub.
export function PullRequestHostedFiles({ organizationId, pullRequest, active }: {
  organizationId: string;
  pullRequest: AuthoredPullRequest;
  active: boolean;
}) {
  const { files: read, error, retry } = useHostedFiles(organizationId, pullRequest);
  const files = read?.files;
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => { if (files) setOpen(initiallyOpen(files)); }, [files]);

  const onOpenChange = useCallback((index: number, next: boolean) => {
    setOpen((value) => {
      const copy = new Set(value);
      if (next) copy.add(index); else copy.delete(index);
      return copy;
    });
  }, []);

  const scrollArea = () => viewport.current?.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']");
  const goTo = useCallback((index: number, { reveal = false } = {}) => {
    if (!files?.length) return;
    const next = Math.max(0, Math.min(files.length - 1, index));
    setCurrent(next);
    if (reveal) onOpenChange(next, true);
    const element = document.getElementById(fileId(next));
    element?.scrollIntoView({ block: "start" });
    element?.querySelector<HTMLElement>("[data-file-index]")?.focus({ preventScroll: true });
  }, [files, onOpenChange]);

  // The file whose header is at the top is the one you are reading.
  useEffect(() => {
    const root = scrollArea();
    if (!root || !files?.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
        .map((entry) => Number((entry.target as HTMLElement).dataset.index));
      if (visible.length) setCurrent(Math.min(...visible));
    }, { root, rootMargin: "0px 0px -70% 0px" });
    for (const element of root.querySelectorAll<HTMLElement>("[data-slot='pull-request-file']")) observer.observe(element);
    return () => observer.disconnect();
  }, [files]);

  useEffect(() => {
    if (!active || !files?.length) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']")) return;
      if (event.key === "j") { event.preventDefault(); goTo(current + 1); }
      else if (event.key === "k") { event.preventDefault(); goTo(current - 1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, files, current, goTo]);

  if (error) {
    return (
      <Empty className="min-h-0 flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon"><FileDiff /></EmptyMedia>
          <EmptyTitle>Files didn't load</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button variant="outline" size="sm" onClick={retry}><RefreshCw data-icon="inline-start" />Try again</Button>
          <Button asChild variant="ghost" size="sm"><a href={`${pullRequest.url}/files`} target="_blank" rel="noreferrer" data-link>Open on GitHub</a></Button>
        </EmptyContent>
      </Empty>
    );
  }

  const allOpen = Boolean(files?.length) && open.size === files!.length;
  const additions = files?.reduce((sum, file) => sum + file.additions, 0) ?? pullRequest.additions;
  const deletions = files?.reduce((sum, file) => sum + file.deletions, 0) ?? pullRequest.deletions;

  return (
    <div data-slot="pull-request-files" className="flex min-h-0 min-w-0 flex-1">
      <aside aria-label="Changed files" className="hidden w-72 shrink-0 border-r border-border lg:block">
        <ScrollArea className="h-full">
          <ItemGroup className="gap-0 p-2">
            {files ? files.map((file, index) => {
              const status = statusOf(file);
              const name = file.path.split("/").at(-1) ?? file.path;
              const folder = file.path.slice(0, file.path.length - name.length).replace(/\/$/, "");
              return (
                <Item key={`${file.path}:${index}`} asChild size="sm" className={cn("min-w-0 gap-2 px-2 py-1.5", index === current ? "bg-accent" : "hover:bg-accent/50")}>
                  <button type="button" className="w-full text-left" aria-current={index === current ? "true" : undefined} onClick={() => goTo(index, { reveal: true })}>
                    <ItemMedia><status.Icon className={cn("size-3.5", status.className)} aria-label={status.label} /></ItemMedia>
                    <ItemContent className="min-w-0 gap-0">
                      <ItemTitle className="w-full min-w-0 truncate font-mono text-xs font-normal" title={file.path}>{name}</ItemTitle>
                      {folder && <span className="block w-full truncate text-[11px] text-muted-foreground" title={folder}>{folder}</span>}
                    </ItemContent>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums">
                      <span className="text-success-foreground">+{file.additions}</span> <span className="text-destructive">−{file.deletions}</span>
                    </span>
                  </button>
                </Item>
              );
            }) : Array.from({ length: Math.min(12, pullRequest.changedFiles || 6) }, (_, index) => <Skeleton key={index} className="mx-2 my-2 h-5" />)}
          </ItemGroup>
        </ScrollArea>
      </aside>
      <div ref={viewport} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-4 text-xs text-muted-foreground">
          <span className="tabular-nums">{(files?.length ?? pullRequest.changedFiles ?? 0).toLocaleString()} {(files?.length ?? pullRequest.changedFiles) === 1 ? "file" : "files"}</span>
          <span className="font-mono tabular-nums"><span className="text-success-foreground">+{additions.toLocaleString()}</span> <span className="text-destructive">−{deletions.toLocaleString()}</span></span>
          <span className="ml-auto hidden items-center gap-1 sm:inline-flex" aria-hidden>
            <Kbd>J</Kbd><Kbd>K</Kbd> next and previous file
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="sm:ml-2 ml-auto"
            disabled={!files?.length}
            onClick={() => setOpen(allOpen ? new Set() : new Set(files!.map((_, index) => index)))}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1" viewportProps={{ tabIndex: 0, "aria-label": "Diffs" }}>
          <div className="flex flex-col gap-3 p-3 sm:p-4">
            {read?.truncated && (
              <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                GitHub lists the first 3,000 files. <a href={`${pullRequest.url}/files`} target="_blank" rel="noreferrer" data-link className="underline underline-offset-2 hover:text-foreground">Open on GitHub</a> for the rest.
              </p>
            )}
            {!files ? (
              Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-40 rounded-lg" />)
            ) : files.length === 0 ? (
              <Empty className="min-h-60">
                <EmptyHeader><EmptyTitle>No changed files</EmptyTitle><EmptyDescription>This pull request has no file changes.</EmptyDescription></EmptyHeader>
              </Empty>
            ) : files.map((file, index) => (
              <FileDiffView key={`${file.path}:${index}`} file={file} index={index} open={open.has(index)} onOpenChange={onOpenChange} url={pullRequest.url} />
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
