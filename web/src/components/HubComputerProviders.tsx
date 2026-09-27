import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { ComputerSummary, HostedClaudeAccount, HostedCodexAccount } from "@remy/contract";
import { ProviderMark } from "./ProviderMark";
import { RowMark, SettingsList, SettingsRow, SettingsSection } from "./SettingsList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";

type ModelKey = { id: string; label: string; runtime: string; configured: boolean };
type ModelKeys = { providers: ModelKey[] };
type Account = { phase: "signedOut" | "pending" | "connected" | "error"; verificationUrl?: string; userCode?: string; error?: string; label?: string };

const small = "h-7 rounded-lg px-2.5 text-xs";

/// How each provider runs on a computer you connected: its own sign-in, or an
/// API key Remy gives it. One row per provider, with that row's actions.
export function HubComputerProviders({ organizationId, computer }: { organizationId: string; computer: ComputerSummary }) {
  const base = `/computers/${encodeURIComponent(computer.computerId)}`;
  const offline = computer.availability === "offline";
  const keys = useHubResource<ModelKeys>(organizationId, `${base}/model-keys`);
  const [keyState, setKeyState] = useState<ModelKey[]>();
  useEffect(() => { if (keys.value) setKeyState(keys.value.providers); }, [keys.value]);
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState("");
  const installed = new Set((computer.capabilities.providers ?? []).map(provider => provider.id));
  const key = (id: string) => (keyState ?? keys.value?.providers)?.find(entry => entry.id === id);
  const saveKey = async (id: string, apiKey: string | null) => {
    setBusy(`key:${id}`);
    try {
      const result = await hubRequest<ModelKeys>(`${hubThreadBase(organizationId)}${base}/model-keys`, "PUT", { id, apiKey });
      setKeyState(result.providers);
      setEditing(undefined);
      toast.success(apiKey ? `Your key is on ${computer.name}.` : `Your key is off ${computer.name}.`);
    } catch (error) {
      toast.error("Couldn't save this key", { description: apiError(error) });
    } finally { setBusy(""); }
  };
  const keyActions = (id: string, name: string) => {
    const saved = key(id);
    if (!saved) return null;
    return saved.configured ? <>
      <Button size="sm" variant="ghost" className={small} disabled={!!busy} onClick={() => void saveKey(id, null)}>Remove key</Button>
      <Button size="sm" variant="outline" className={small} disabled={!!busy} onClick={() => setEditing(editing === id ? undefined : id)}>Replace key</Button>
    </> : <Button size="sm" variant="ghost" className={small} disabled={!!busy} aria-label={`Use an API key for ${name}`} onClick={() => setEditing(editing === id ? undefined : id)}>Use an API key</Button>;
  };
  const keyForm = (id: string, label: string, runtime: string) => editing === id
    ? <KeyForm label={label} runtime={runtime} computer={computer.name} busy={busy === `key:${id}`} onCancel={() => setEditing(undefined)} onSave={apiKey => saveKey(id, apiKey)} />
    : undefined;
  return <SettingsSection id={`providers-${computer.computerId}`} title="Providers" description={`Sign in with your own account, or give ${computer.name} an API key instead.`}>
    <SettingsList label="Providers">
      <AccountRow
        organizationId={organizationId}
        path={`${base}/claude-account`}
        name="Claude Code"
        provider="claude"
        offline={offline}
        keyed={key("anthropic")?.configured === true}
        keyLabel="an Anthropic API key"
        signedIn={(account: HostedClaudeAccount) => account.subscription ? `Signed in with ${account.subscription}` : "Signed in to your Claude account"}
        extra={keyActions("anthropic", "Claude Code")}
        below={keyForm("anthropic", "Anthropic", "Claude Code")}
        complete
      />
      <AccountRow
        organizationId={organizationId}
        path={`${base}/codex`}
        name="Codex"
        provider="codex"
        offline={offline}
        keyed={key("openai")?.configured === true}
        keyLabel="an OpenAI API key"
        signedIn={(account: HostedCodexAccount) => account.email ? `Signed in as ${account.email}` : "Signed in to ChatGPT"}
        signInLabel="Sign in with ChatGPT"
        extra={keyActions("openai", "Codex")}
        below={keyForm("openai", "OpenAI", "Codex")}
      />
      <SettingsRow
        media={<RowMark><ProviderMark provider="cursor" /></RowMark>}
        title="Cursor"
        description={key("cursor")?.configured ? "Uses a Cursor API key" : installed.has("cursor") ? `Installed · signs in on ${computer.name} with agent login` : `Not installed on ${computer.name}`}
        below={keyForm("cursor", "Cursor", "Cursor")}
      >
        {keyActions("cursor", "Cursor")}
      </SettingsRow>
    </SettingsList>
    {offline && <p className="text-xs leading-4 text-muted-foreground">Signing in needs {computer.name} online. API keys save now and reach it when it reconnects.</p>}
  </SettingsSection>;
}

/// One provider that signs in on the computer: Claude Code with a pasted code,
/// Codex with a device code.
function AccountRow<T extends Account>({ organizationId, path, name, provider, offline, keyed, keyLabel, signedIn, signInLabel = "Sign in", extra, below, complete }: {
  organizationId: string;
  path: string;
  name: string;
  provider: string;
  offline: boolean;
  keyed: boolean;
  keyLabel: string;
  signedIn: (account: T) => string;
  signInLabel?: string;
  extra: ReactNode;
  below?: ReactNode;
  /// Claude asks for the code it shows you; Codex finishes on its own.
  complete?: boolean;
}) {
  const resource = useHubResource<T>(organizationId, offline ? null : path, "/computers/live");
  const [account, setAccount] = useState<T>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (resource.value) setAccount(resource.value); }, [resource.value]);
  const current = account ?? resource.value;
  const reconnecting = resource.stale && !resource.error;
  const change = async (action: "start" | "complete" | "cancel" | "logout", body?: { code: string }) => {
    setBusy(true);
    try {
      setAccount(await hubRequest<T>(`${hubThreadBase(organizationId)}${path}/${action}`, "POST", body));
      if (action === "complete") setCode("");
    } catch (error) {
      toast.error(`Couldn't ${action === "logout" ? "sign out of" : "sign in to"} ${name}`, { description: apiError(error) });
    } finally { setBusy(false); }
  };
  const connected = current?.phase === "connected";
  const pending = current?.phase === "pending";
  const description = offline
    ? keyed ? `Uses ${keyLabel}` : "Waiting for the computer to come online"
    : connected ? signedIn(current as T)
    : keyed ? `Uses ${keyLabel}`
    : pending ? "Signing in…"
    : !current && !resource.error ? "Checking…"
    : current?.error || resource.error || "Not signed in";
  const disabled = busy || reconnecting || offline;
  const signIn = pending ? <>
    <p className="text-xs leading-4 text-muted-foreground">{complete ? `Approve access in Claude, then paste the code it shows you.` : "Enter this code on OpenAI's sign-in page."}</p>
    {complete
      ? <Input aria-label={`${name} sign-in code`} value={code} autoComplete="off" onChange={event => setCode(event.target.value)} />
      : <Input aria-label={`${name} sign-in code`} readOnly value={current?.userCode ?? ""} className="font-mono" />}
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm" variant={complete ? "outline" : "default"} className={small}><a href={current?.verificationUrl} target="_blank" rel="noreferrer" data-link>Open sign-in page</a></Button>
      {complete && <Button size="sm" className={small} disabled={disabled || !code.trim()} onClick={() => void change("complete", { code })}>{busy && <Spinner data-icon="inline-start" />}Finish signing in</Button>}
      <Button size="sm" variant="ghost" className={small} disabled={disabled} onClick={() => void change("cancel")}>Cancel</Button>
    </div>
  </> : undefined;
  return <SettingsRow
    media={<RowMark className={provider === "claude" ? "bg-claude/15" : undefined}><ProviderMark provider={provider} /></RowMark>}
    title={name}
    description={description}
    below={below ?? (signIn && <div className="flex min-w-0 max-w-md flex-col gap-2.5">{signIn}</div>)}
  >
    {!pending && !connected && extra}
    {connected && <Button size="sm" variant="outline" className={small} disabled={disabled} onClick={() => void change("logout")}>{busy && <Spinner data-icon="inline-start" />}Sign out</Button>}
    {!pending && !connected && !keyed && <Button size="sm" className={small} disabled={disabled || !current} onClick={() => void change("start")}>{busy && <Spinner data-icon="inline-start" />}{signInLabel}</Button>}
  </SettingsRow>;
}

function KeyForm({ label, runtime, computer, busy, onCancel, onSave }: { label: string; runtime: string; computer: string; busy: boolean; onCancel: () => void; onSave: (apiKey: string) => Promise<void> }) {
  const [apiKey, setApiKey] = useState("");
  return <form className="flex min-w-0 max-w-lg flex-col gap-2" onSubmit={event => { event.preventDefault(); if (apiKey.trim()) void onSave(apiKey.trim()); }}>
    <label htmlFor={`${label}-computer-key`} className="text-xs font-medium">{label} API key</label>
    <div className="flex min-w-0 gap-2">
      <Input id={`${label}-computer-key`} type="password" autoComplete="new-password" autoFocus className="min-w-0 flex-1 font-mono text-xs" value={apiKey} maxLength={8192} disabled={busy} onChange={event => setApiKey(event.target.value)} />
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      <Button type="submit" size="sm" disabled={busy || !apiKey.trim()}>{busy && <Spinner data-icon="inline-start" />}Save key</Button>
    </div>
    <p className="text-xs leading-4 text-muted-foreground">{runtime} on {computer} uses the key instead of a sign-in. Only {computer} can read it.</p>
  </form>;
}
