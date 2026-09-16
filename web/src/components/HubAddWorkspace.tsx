import { useEffect, useState } from "react";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
import type { ConnectionsState } from "./HubConnections";

type Repository = { id: number; name: string; full_name: string };
export function HubAddWorkspace({ organizationId, open, onOpenChange, onManual }: {
  organizationId: string; open: boolean; onOpenChange: (open: boolean) => void; onManual: () => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader className="text-center sm:text-center"><DialogTitle>Add a workspace</DialogTitle><DialogDescription>Choose a GitHub repository or enter its URL.</DialogDescription></DialogHeader>
      {open && <RepositoryPicker organizationId={organizationId} onAdded={() => onOpenChange(false)} onManual={onManual} />}
    </DialogContent>
  </Dialog>;
}
function RepositoryPicker({organizationId, onAdded, onManual}: {organizationId:string; onAdded:()=>void; onManual:()=>void}) {
  const connection = useHubResource<ConnectionsState>(organizationId, "/connections");
  const github = connection.value?.connections.find(c => c.provider === "github" && c.subject && c.status === "connected");
  const root = `${hubThreadBase(organizationId)}/github`;
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(1);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const run = async (work:()=>Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch(e) { setError(apiError(e)); } finally { setBusy(false); }
  };
  const load = async (page:number) => {
    const result = await hubRequest<{repositories:Repository[];nextPage:number|null}>(`${root}/accessible-repositories?page=${page}`);
    setRepos(previous => page === 1 ? result.repositories : [...new Map([...previous, ...result.repositories].map(r=>[r.id,r])).values()]);
    setNextPage(result.nextPage); setLoaded(true);
  };
  useEffect(() => {
    let current = true;
    setRepos([]); setLoaded(false); setNextPage(1);
    if (!github) return;
    setBusy(true);
    hubRequest<{repositories:Repository[];nextPage:number|null}>(`${root}/accessible-repositories?page=1`).then(result => {
      if(current) {setRepos(result.repositories);setNextPage(result.nextPage);setLoaded(true);setShowToken(false);}
    }).catch(e=>{if(current)setError(apiError(e));}).finally(()=>{if(current)setBusy(false);});
    return () => {current=false;};
  }, [root, github?.id, github?.updated_at]);
  return <div className="flex min-w-0 flex-col gap-4 text-center">
    {(error || connection.error) && <p role="alert" className="text-sm text-destructive">{error || connection.error}</p>}
    {!connection.value && !connection.error && <div className="flex h-9 items-center justify-center"><Spinner aria-label="Loading GitHub connection" className="text-muted-foreground motion-reduce:animate-none" /></div>}
    {!github && connection.value && <>
      <Button disabled={busy || !connection.value.providers.find(p=>p.id==="github")?.configured} onClick={() => {
        const popup = window.open("about:blank", "_blank");
        if(popup)popup.opener=null;
        void run(async()=>{
          try {
            const result=await hubRequest<{url:string}>(`${hubThreadBase(organizationId)}/connections/github`,"POST",{scope:"member"});
            if(popup)popup.location.href=result.url;else window.location.assign(result.url);
          } catch(e) {popup?.close();throw e;}
        });
      }}><Github />Connect GitHub</Button>
      {!connection.value.providers.find(p=>p.id==="github")?.configured && <p className="text-sm text-muted-foreground">GitHub sign-in isn’t available yet. You can use a personal access token.</p>}
    </>}
    {showToken && <form className="flex flex-col gap-3" onSubmit={e=>{e.preventDefault();void run(async()=>{
      await hubRequest(`${root}/token`,"POST",{token:token.trim()});setToken("");await load(1);setShowToken(false);
    });}}>
      <Field><FieldLabel className="justify-center" htmlFor="github-token">Personal access token</FieldLabel><Input id="github-token" type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} /></Field>
      <p className="text-sm text-muted-foreground">Choose the repositories your token can access. <a className="underline" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a token</a></p>
      <Button disabled={busy || !token.trim()} type="submit">{busy && <Spinner aria-label="Connecting GitHub" className="motion-reduce:animate-none" />}Connect GitHub</Button>
    </form>}
    {(github || loaded) && <>
      {github && <p className="text-sm text-muted-foreground">Connected as {github.label}</p>}
      <Input aria-label="Find a repository" placeholder="Find a repository…" value={query} onChange={e=>setQuery(e.target.value)} />
      <div className="flex max-h-64 min-w-0 flex-col gap-1 overflow-auto" aria-label="GitHub repositories">
        {repos.filter(r=>r.full_name.toLowerCase().includes(query.toLowerCase())).map(repo=><Button key={repo.id} variant="ghost" className="h-auto min-w-0 justify-start whitespace-normal text-left" disabled={busy} onClick={()=>void run(async()=>{await hubRequest(`${root}/import`,"POST",{fullName:repo.full_name});onAdded();})}><span className="min-w-0 break-words">{repo.full_name}</span></Button>)}
      </div>
      {busy && <div className="flex h-9 items-center justify-center"><Spinner aria-label="Loading repositories" className="text-muted-foreground motion-reduce:animate-none" /></div>}
      {loaded && !repos.length && <p className="text-sm text-muted-foreground">No repositories are available to this GitHub connection.</p>}
      {nextPage && <Button variant="outline" disabled={busy} onClick={()=>void run(()=>load(nextPage))}>Load more repositories</Button>}
      {error && <Button variant="outline" disabled={busy} onClick={()=>void run(()=>load(1))}>Try again</Button>}
    </>}
    <div className="flex flex-col gap-3">
      <Button variant="outline" disabled={busy} aria-expanded={showToken} onClick={()=>setShowToken(v=>!v)}>Use a personal access token</Button>
      <Button variant="outline" disabled={busy} onClick={onManual}>Enter a repository URL</Button>
    </div>
  </div>;
}
