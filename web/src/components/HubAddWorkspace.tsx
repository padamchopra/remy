import type { Organization } from "@remy/contract";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Github, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog-base";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuItemCheck, MenuTrigger } from "@/components/ui/menu-base";
import { Spinner } from "@/components/ui/spinner";
import { apiError } from "@/lib/api-error";
import { useHubResource, type HubWorkspace } from "@/lib/hub-organization";
import { HubRequestError, hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { cachedRepositories, forgetRepositories, rememberRepositories } from "@/lib/github-repositories";
import { relativeDate } from "@/lib/relative-date";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { ConnectionsState } from "./HubConnections";

type Repository = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  private: boolean;
  pushedAt: string | null;
};

/// GitHub's own colours, so a language reads the way it does on the repository
/// it came from. Anything unlisted falls back to the muted foreground.
const LANGUAGE_COLOURS: Record<string, string> = {
  C: "#555555", "C#": "#178600", "C++": "#f34b7d", CSS: "#563d7c", Dart: "#00b4ab",
  Elixir: "#6e4a7e", Go: "#00ADD8", HTML: "#e34c26", Java: "#b07219",
  JavaScript: "#f1e05a", Kotlin: "#A97BFF", Lua: "#000080", "Objective-C": "#438eff",
  PHP: "#4F5D95", Python: "#3572A5", Ruby: "#701516", Rust: "#dea584",
  Scala: "#c22d40", Shell: "#89e051", Svelte: "#ff3e00", Swift: "#F05138",
  TypeScript: "#3178C6", Vue: "#41b883", Zig: "#ec915c",
};

/// Rank a repository against what has been typed. cmdk's fuzzy default ranks a
/// scattered character match as highly as a real one, which puts the wrong
/// repository under the cursor when two share an owner.
function rankRepository(value: string, search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return 1;
  const haystack = value.toLowerCase();
  if (!haystack.includes(needle)) return 0;
  const name = haystack.slice(haystack.indexOf("/") + 1);
  return name.startsWith(needle) ? 1 : name.includes(needle) ? 0.8 : 0.5;
}

export function HubAddWorkspace({ organizationId, organizations, open, onOpenChange, onManual, onAdded }: {
  organizationId: string; organizations?: Organization[]; open: boolean; onOpenChange: (open: boolean) => void; onManual?: () => void; onAdded?: (organizationId: string) => void;
}) {
  const destinations = organizations?.filter(o => o.role !== "member");
  const [selected, setSelected] = useState(organizationId);
  const [manual, setManual] = useState(false);
  useEffect(() => { if (open) { setSelected(organizationId); setManual(false); } }, [open, organizationId]);
  const destination = destinations ? destinations.find(o => o.id === selected)?.id ?? destinations[0]?.id : organizationId;
  const added = () => { onOpenChange(false); if (destination) onAdded?.(destination); };
  const choosable = destinations && destinations.length > 1;
  const chosen = destinations?.find(o => o.id === destination);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[41.25rem]" showCloseButton={false}>
      <header className="flex min-w-0 items-center gap-2.5 py-3.5 pr-3.5 pl-5">
        <DialogTitle className="shrink-0 text-[0.9375rem] font-medium">Add a workspace{choosable ? " to" : ""}</DialogTitle>
        {choosable && <Menu>
          <MenuTrigger
            aria-label="Workspace account"
            className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {chosen?.personal ? "Personal" : chosen?.name}
            <ChevronDown className="size-3 text-muted-foreground" />
          </MenuTrigger>
          <MenuContent>
            {destinations.map(o => <MenuItem key={o.id} onClick={() => { setSelected(o.id); setManual(false); }}>
              {o.personal ? "Personal" : o.name}
              <MenuItemCheck checked={o.id === destination} />
            </MenuItem>)}
          </MenuContent>
        </Menu>}
        <div className="grow" />
        <DialogClose
          aria-label="Close"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </DialogClose>
      </header>
      {open && destination && (manual
        ? <ManualRepository key={destination} organizationId={destination} onAdded={added} onBack={() => setManual(false)} />
        : <RepositoryPicker key={destination} organizationId={destination} onAdded={added} onManual={onManual ?? (() => setManual(true))} />)}
    </DialogContent>
  </Dialog>;
}

function ManualRepository({ organizationId, onAdded, onBack }: { organizationId: string; onAdded: () => void; onBack: () => void }) {
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  return <form
    className="flex flex-col gap-4 border-t p-5"
    onSubmit={event => {
      event.preventDefault();
      setBusy(true);
      void hubRequest(`${hubThreadBase(organizationId)}/workspaces`, "POST", { name: name.trim(), origin: origin.trim() })
        .then(onAdded)
        .catch(e => toast.error("Couldn't add that workspace", { description: apiError(e) }))
        .finally(() => setBusy(false));
    }}
  >
    <Field><FieldLabel htmlFor="workspace-name">Name</FieldLabel><Input id="workspace-name" required value={name} onChange={event => setName(event.target.value)} disabled={busy} /></Field>
    <Field><FieldLabel htmlFor="workspace-repository">Repository URL</FieldLabel><Input id="workspace-repository" required value={origin} onChange={event => setOrigin(event.target.value)} disabled={busy} /></Field>
    <div className="flex items-center justify-end gap-2">
      <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>Back</Button>
      <Button disabled={busy || !name.trim() || !origin.trim()} type="submit">{busy && <Spinner />}Add workspace</Button>
    </div>
  </form>;
}

function RepositoryPicker({ organizationId, onAdded, onManual }: { organizationId: string; onAdded: () => void; onManual: () => void }) {
  const connection = useHubResource<ConnectionsState>(organizationId, "/connections");
  const workspaces = useHubResource<{ workspaces: HubWorkspace[] }>(organizationId, "/workspaces");
  const github = connection.value?.connections.find(c => c.provider === "github" && c.subject && c.status === "connected");
  const root = `${hubThreadBase(organizationId)}/github`;
  const connectionKey = github ? `${github.id}:${github.updated_at}` : "";
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  // Changing a connected account reopens the same panel, so there is one place
  // that connects GitHub rather than two that drift apart.
  const [changing, setChanging] = useState(false);
  const [cached] = useState(() => cachedRepositories(root, ""));
  const [repos, setRepos] = useState<Repository[]>(cached?.repositories ?? []);
  const [nextPage, setNextPage] = useState<number | null>(cached?.nextPage ?? 1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!!cached);
  // Set when the listing comes back 409: GitHub is not connected for this
  // account. The picker learns that from its own read rather than waiting for
  // the connections resource to say so.
  const [unconnected, setUnconnected] = useState(false);
  // The dialog opens on the search field: this surface exists to be typed into,
  // and Base UI would otherwise leave focus on the popup itself.
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (loaded) search.current?.focus(); }, [loaded]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } catch (e) { toast.error("Couldn't update GitHub", { description: apiError(e) }); } finally { setBusy(false); }
  };
  const load = async (page: number) => {
    const result = await hubRequest<{ repositories: Repository[]; nextPage: number | null }>(`${root}/accessible-repositories?page=${page}`);
    const merged = page === 1 ? result.repositories : [...new Map([...repos, ...result.repositories].map(r => [r.id, r])).values()];
    setRepos(merged); setNextPage(result.nextPage); setLoaded(true); setUnconnected(false);
    rememberRepositories(root, { repositories: merged, nextPage: result.nextPage, connection: connectionKey });
  };
  // The listing does not wait for the connections resource. Both are reads of
  // the same account, so asking for them in series put a GitHub round trip
  // behind a hub round trip for no answer the listing does not already carry:
  // a missing connection comes back as 409.
  const read = (signal: { current: boolean }) => {
    setBusy(true);
    hubRequest<{ repositories: Repository[]; nextPage: number | null }>(`${root}/accessible-repositories?page=1`).then(result => {
      if (!signal.current) return;
      setRepos(result.repositories); setNextPage(result.nextPage); setLoaded(true); setUnconnected(false);
      setShowToken(false); setChanging(false); setError("");
      rememberRepositories(root, { repositories: result.repositories, nextPage: result.nextPage, connection: connectionKey });
    }).catch(e => {
      if (!signal.current) return;
      setLoaded(false); setRepos([]); forgetRepositories(root);
      // 409 is the hub saying this account has no GitHub connection. Any other
      // failure still leaves the connect panel as the more useful answer than
      // an error paragraph, so the message is kept for the case where the
      // connections resource disagrees.
      if (e instanceof HubRequestError && e.status === 409) { setUnconnected(true); return; }
      setError(apiError(e));
    }).finally(() => { if (signal.current) setBusy(false); });
  };
  useEffect(() => {
    const signal = { current: true };
    read(signal);
    return () => { signal.current = false; };
  }, [root]);
  // A connection that arrives after an unconnected read is the OAuth popup
  // finishing. The token path reloads itself, so nothing reloads twice.
  useEffect(() => {
    if (!connectionKey || loaded) return;
    const signal = { current: true };
    read(signal);
    return () => { signal.current = false; };
  }, [connectionKey]);
  // A repository already registered here is shown rather than hidden, so the
  // answer to "did I add this one?" is on screen instead of missing.
  const alreadyAdded = useMemo(
    () => new Set((workspaces.value?.workspaces ?? []).map(w => w.origin.toLowerCase())),
    [workspaces.value],
  );
  const owners = useMemo(() => {
    const groups = new Map<string, Repository[]>();
    for (const repo of repos) {
      const owner = repo.full_name.split("/")[0] ?? "";
      const group = groups.get(owner) ?? [];
      group.push(repo);
      groups.set(owner, group);
    }
    return [...groups];
  }, [repos]);
  const missing = unconnected || (connection.value && !github);
  if (error && !missing) return <p role="alert" className="border-t p-5 text-sm text-destructive">{error}</p>;
  // Rows win over every other state. The list only needs its own read, so a
  // connections resource still in flight — or failing — does not hold back
  // repositories that already arrived.
  const connecting = missing && !loaded;
  if (!loaded && !connecting) {
    if (connection.error) return <p role="alert" className="border-t p-5 text-sm text-destructive">{connection.error}</p>;
    return <div className="flex h-24 items-center justify-center border-t"><Spinner aria-label="Loading repositories" className="text-muted-foreground motion-reduce:animate-none" /></div>;
  }
  if (connecting || changing) return <ConnectGitHub
    organizationId={organizationId}
    connected={!!github}
    configured={connection.value ? !!connection.value.providers.find(p => p.id === "github")?.configured : true}
    busy={busy}
    showToken={showToken}
    token={token}
    setToken={setToken}
    onShowToken={() => setShowToken(v => !v)}
    onConnected={() => void run(async () => { await hubRequest(`${root}/token`, "POST", { token: token.trim() }); setToken(""); forgetRepositories(root); await load(1); setShowToken(false); setChanging(false); })}
    onManual={onManual}
    onBack={github ? () => { setChanging(false); setShowToken(false); } : undefined}
    run={run}
  />;
  return <Command filter={rankRepository} className="min-w-0 bg-transparent" loop>
    <div className="relative min-w-0">
      <CommandInput ref={search} placeholder="Search repositories" className="pr-28" />
      <span className="pointer-events-none absolute inset-y-0 right-5 flex items-center text-xs text-muted-foreground">
        {loaded ? `${repos.length} available` : ""}
      </span>
    </div>
    <CommandList className="max-h-[21rem] px-2 pt-1 pb-2.5">
      {loaded && repos.length > 0 && <CommandEmpty className="py-8 text-sm text-muted-foreground">No repositories match.</CommandEmpty>}
      {owners.map(([owner, list]) => <CommandGroup key={owner} heading={owner} className="p-0 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[0.6875rem] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide">
        {list.map(repo => <RepositoryRow
          key={repo.id}
          repo={repo}
          added={alreadyAdded.has(`github.com/${repo.full_name}`.toLowerCase())}
          onPick={() => void run(async () => { await hubRequest(`${root}/import`, "POST", { fullName: repo.full_name }); onAdded(); })}
        />)}
      </CommandGroup>)}
      {busy && <div className="flex h-12 items-center justify-center"><Spinner aria-label="Loading repositories" className="text-muted-foreground motion-reduce:animate-none" /></div>}
      {loaded && !repos.length && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No repositories are available to this GitHub connection.</p>}
      {nextPage && loaded && <div className="px-1 pt-2"><Button variant="outline" size="sm" className="w-full" disabled={busy} onClick={() => void run(() => load(nextPage))}>Load more repositories</Button></div>}
    </CommandList>
    <footer className="flex min-w-0 items-center gap-2.5 border-t bg-sidebar px-5 py-3 text-xs">
      <Github className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="hidden min-w-0 truncate text-muted-foreground sm:block">{github?.label ?? ""}</span>
      <button type="button" data-link className="shrink-0 text-foreground underline-offset-2 hover:underline" onClick={() => { setShowToken(true); setChanging(true); }}>Use a token</button>
      <div className="grow" />
      <button type="button" data-link className="shrink-0 text-foreground underline-offset-2 hover:underline" onClick={onManual}>Add by URL</button>
      <span aria-hidden="true" className="hidden h-3.5 w-px shrink-0 bg-border sm:block" />
      <span className="hidden shrink-0 items-center gap-1.5 text-muted-foreground sm:flex"><Kbd>↑↓</Kbd>Move<Kbd className="ml-1.5">↵</Kbd>Add</span>
    </footer>
  </Command>;
}

function RepositoryRow({ repo, added, onPick }: { repo: Repository; added: boolean; onPick: () => void }) {
  const colour = repo.language ? LANGUAGE_COLOURS[repo.language] : undefined;
  return <CommandItem
    value={repo.full_name}
    disabled={added}
    onSelect={onPick}
    className={cn(
      "group min-w-0 items-center gap-3 rounded-lg px-3 py-2.5",
      added && "opacity-100 data-[disabled=true]:opacity-100",
    )}
  >
    <span className={cn("flex size-[1.875rem] shrink-0 items-center justify-center rounded-lg bg-accent text-[0.8125rem] font-semibold", added ? "text-muted-foreground/70" : "text-muted-foreground")} aria-hidden="true">
      {repo.name.charAt(0).toUpperCase()}
    </span>
    <span className="flex min-w-0 grow flex-col gap-0.5">
      <span className="min-w-0 truncate text-[0.8125rem] leading-[1.125rem]">
        <span className="text-muted-foreground">{repo.full_name.split("/")[0]}/</span>
        <span className={cn("font-medium", added ? "text-muted-foreground" : "text-foreground")}>{repo.name}</span>
      </span>
      {repo.description && <span className="min-w-0 truncate text-xs leading-4 text-muted-foreground">{repo.description}</span>}
    </span>
    <span className="hidden w-[8.25rem] shrink-0 items-center gap-2 text-[0.6875rem] text-muted-foreground sm:flex">
      {repo.language && <span aria-hidden="true" className="size-[0.4375rem] shrink-0 rounded-full" style={{ backgroundColor: colour ?? "currentColor" }} />}
      <span className="min-w-0 grow truncate">{repo.language ?? ""}</span>
      <span className="shrink-0">{relativeDate(repo.pushedAt)}</span>
    </span>
    {/* Narrow keeps the age and drops the language: the name has to stay readable. */}
    <span className="shrink-0 text-[0.6875rem] text-muted-foreground sm:hidden">{relativeDate(repo.pushedAt)}</span>
    <span className="flex shrink-0 items-center justify-end gap-1.5 text-[0.6875rem] sm:w-16">
      {added
        ? <span className="flex items-center gap-1 text-muted-foreground"><svg viewBox="0 0 24 24" className="size-3 text-muted-foreground" aria-hidden="true"><path d="m5 13 4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>Added</span>
        : <span className="hidden items-center gap-1.5 group-data-[selected=true]:flex"><span className="font-medium text-foreground">Add</span><Kbd>↵</Kbd></span>}
    </span>
  </CommandItem>;
}

function ConnectGitHub({ organizationId, connected, configured, busy, showToken, token, setToken, onShowToken, onConnected, onManual, onBack, run }: {
  organizationId: string; connected: boolean; configured: boolean; busy: boolean; showToken: boolean; token: string;
  setToken: (value: string) => void; onShowToken: () => void; onConnected: () => void; onManual: () => void;
  onBack?: () => void; run: (work: () => Promise<void>) => Promise<void>;
}) {
  // A token is not only the fallback for a missing connection. It is how you
  // reach an organization that will not install Remy, so it stays available
  // after GitHub is connected — and there it is the whole point of the panel.
  const form = showToken || connected;
  return <div className="flex flex-col items-center gap-0 border-t px-10 pt-11 pb-10 text-center">
    <Github className="size-8 text-muted-foreground" aria-hidden="true" />
    <h2 className="mt-5 text-lg font-semibold tracking-tight">{connected ? "Reach repositories with a token" : "Your repositories live on GitHub"}</h2>
    <p className="mt-2 max-w-[24rem] text-sm text-muted-foreground">
      {connected
        ? "A token lists repositories in organizations that have not installed Remy, and replaces the GitHub connection for your account."
        : "Connect it and Remy lists everything your account can reach."}
    </p>
    {form
      ? <form
          className="mt-6 flex w-full max-w-[22rem] flex-col gap-3"
          onSubmit={event => { event.preventDefault(); onConnected(); }}
        >
          <Field><FieldLabel className="justify-center" htmlFor="github-token">Personal access token</FieldLabel><Input id="github-token" type="password" autoComplete="off" autoFocus value={token} onChange={e => setToken(e.target.value)} /></Field>
          <p className="text-sm text-muted-foreground">Choose the repositories your token can access. <a className="underline" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a token</a></p>
          <Button disabled={busy || !token.trim()} type="submit">{busy && <Spinner aria-label="Connecting GitHub" className="motion-reduce:animate-none" />}{connected ? "Use this token" : "Connect GitHub"}</Button>
        </form>
      : <Button
          className="mt-6"
          disabled={busy || !configured}
          onClick={() => {
            const popup = window.open("about:blank", "_blank");
            if (popup) popup.opener = null;
            void run(async () => {
              try {
                const result = await hubRequest<{ url: string }>(`${hubThreadBase(organizationId)}/connections/github`, "POST", { scope: "member" });
                if (popup) popup.location.href = result.url; else window.location.assign(result.url);
              } catch (e) { popup?.close(); throw e; }
            });
          }}
        >Connect GitHub</Button>}
    {!configured && !form && <p className="mt-3 text-sm text-muted-foreground">GitHub sign-in isn’t available yet. Use a personal access token instead.</p>}
    <div className="mt-6 flex flex-col items-center gap-2.5 text-xs sm:flex-row">
      {!form && <button type="button" data-link className="text-foreground underline-offset-2 hover:underline" onClick={onShowToken}>Use a personal access token</button>}
      {!form && <span aria-hidden="true" className="hidden size-[3px] rounded-full bg-muted-foreground/60 sm:block" />}
      <button type="button" data-link className="flex items-center gap-1.5 text-foreground underline-offset-2 hover:underline" onClick={onManual}><Link2 className="size-3.5" />Add by URL</button>
      {onBack && <><span aria-hidden="true" className="hidden size-[3px] rounded-full bg-muted-foreground/60 sm:block" /><button type="button" className="text-foreground underline-offset-2 hover:underline" onClick={onBack}>Back to repositories</button></>}
    </div>
  </div>;
}
