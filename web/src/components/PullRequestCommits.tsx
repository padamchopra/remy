import { useEffect, useId, useState } from "react";
import { ChevronDown, GitCommitHorizontal, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox-base";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover-base";
import { apiError } from "@/lib/api-error";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";

interface Commit { sha: string; title: string; author: string; date: string }
interface Commits { commits: Commit[]; truncated?: boolean }
function useCommits(organizationId: string, repository: string, number: number, revision: string) {
  const [state, setState] = useState<{ value?: Commits; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setState({});
    const query = new URLSearchParams({ repository, number: String(number) });
    hubRequest<Commits>(`${hubThreadBase(organizationId)}/github/pull-request-commits?${query}`)
      .then(value => { if (current) setState({ value }); })
      .catch(error => { if (current) setState({ error: apiError(error) }); });
    return () => { current = false; };
  }, [organizationId, repository, number, revision, attempt]);
  return { ...state, retry: () => setAttempt(value => value + 1) };
}
export function PullRequestCommits({ organizationId, repository, number, revision, selected, onChange, onShowFiles, picker = false }: {
  organizationId: string; repository: string; number: number; revision: string;
  selected: string[]; onChange: (commits: string[]) => void; onShowFiles?: () => void; picker?: boolean;
}) {
  const { value, error, retry } = useCommits(organizationId, repository, number, revision);
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const list = <div className="flex min-w-0 flex-col gap-1 p-3">
    <Button variant="ghost" className="justify-start" aria-pressed={!selected.length} onClick={() => onChange([])}>All commits</Button>
    {error ? <div className="p-2 text-sm"><p>{error}</p><Button variant="ghost" onClick={retry}><RefreshCw />Try again</Button></div> : !value ? <p className="p-2 text-sm text-muted-foreground">Loading commits…</p> : !value.commits.length ? <p className="p-2 text-sm text-muted-foreground">No commits.</p> : value.commits.map(commit => <label key={commit.sha} className="flex min-w-0 items-start gap-3 rounded-md p-2 hover:bg-muted/50">
      <span id={`${labelId}-${commit.sha}`} className="sr-only">Select commit {commit.sha.slice(0, 7)}</span>
      <Checkbox aria-labelledby={`${labelId}-${commit.sha}`} disabled={selected.length >= 50 && !selected.includes(commit.sha)} checked={selected.includes(commit.sha)} onCheckedChange={checked => onChange(checked ? [...selected, commit.sha] : selected.filter(sha => sha !== commit.sha))} className="mt-1 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm break-words">{commit.title}</span>
        <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground"><a href={`https://github.com/${repository}/commit/${commit.sha}`} target="_blank" rel="noreferrer" data-link className="font-mono underline underline-offset-2">{commit.sha.slice(0, 7)}</a><span>{commit.author}</span><span>{commit.date ? new Date(commit.date).toLocaleDateString() : ""}</span></span>
      </span>
    </label>)}
    {selected.length >= 50 && <p className="p-2 text-xs text-muted-foreground">Select up to 50 commits, or choose all commits.</p>}
    {value?.truncated && <p className="p-2 text-xs text-muted-foreground">Showing the first 1,000 commits.</p>}
    {onShowFiles && <Button className="mt-2 self-start" onClick={onShowFiles}>View files</Button>}
  </div>;
  if (!picker) return <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Pull request commits">{list}</div>;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant="outline" size="sm" className="max-w-full" />}><GitCommitHorizontal /><span className="truncate">{selected.length ? `${selected.length} ${selected.length === 1 ? "commit" : "commits"}` : "All commits"}</span><ChevronDown /></PopoverTrigger>
    <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] overflow-y-auto" align="start"><PopoverTitle className="sr-only">Choose commits</PopoverTitle>{list}</PopoverContent>
  </Popover>;
}
