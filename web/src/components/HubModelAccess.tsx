import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import type { ChatGPTAccount } from "@remy/contract";
import { AccessMark } from "./AccessMark";
import { HubKeyList, type NamedKey } from "./HubKeyList";
import { SettingsList, SettingsRow, SettingsSection } from "./SettingsList";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";
import { Spinner } from "./ui/spinner";
import { Switch } from "./ui/switch-base";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
import type { OwnModelAccessResponse } from "@/lib/hub-models";

export interface ModelAccessEntry {id:string;enabled:boolean;configured:boolean;models:string[];keys?:NamedKey[]}
export interface ModelAccessResponse { providers: ModelAccessEntry[] }
export const MODEL_ACCESS_LABELS: Record<string,string> = {anthropic:"Anthropic",openai:"OpenAI",router:"Router.com",openrouter:"OpenRouter"};

/// What cloud threads in one account can run. Personal holds your ChatGPT
/// sign-in and your own keys; an organization page is a read-only inventory.
export function HubModelAccessPage({ organizationId, owner, admin }: { organizationId: string; owner: { name: string; personal: boolean }; admin: boolean }) {
  return <div className="mx-auto flex w-full max-w-[760px] flex-col gap-9 px-4 pt-9 pb-10 sm:px-10">
    <div className="flex min-w-0 items-center gap-3.5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] border bg-muted"><KeyRound className="size-5" /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="truncate text-[22px] leading-7 font-semibold tracking-[-0.02em]">Model access</h1>
        <p className="text-[13px] leading-[18px] text-muted-foreground">{owner.personal ? "Personal" : owner.name} · Codex uses ChatGPT or an OpenAI key; Claude uses an Anthropic key.</p>
      </div>
    </div>
    <HubModelAccess organizationId={organizationId} owner={owner} admin={admin} />
    {!owner.personal && <AvailableMemberModelAccess organizationId={organizationId} />}
  </div>;
}

function AvailableMemberModelAccess({ organizationId }: { organizationId: string }) {
  const resource = useHubResource<OwnModelAccessResponse>(organizationId, "/own-model-access", "/computers/live");
  const rows = resource.value ? [
    ...resource.value.providers.flatMap((provider) => provider.id === "chatgpt"
      ? provider.configured ? [{ id: "chatgpt", provider: "chatgpt", name: "ChatGPT", owner: "Yours" }] : []
      : provider.keys.map((key) => ({ id: `own:${provider.id}:${key.id}`, provider: provider.id, name: key.name, owner: "Yours" }))),
    ...resource.value.enrolled.map((entry) => ({ id: `enrolled:${entry.connectionId}`, provider: entry.provider, name: entry.keyName, owner: entry.owner })),
  ] : [];
  return <SettingsSection id={`available-model-access-${organizationId}`} title="Available to you" description="Your connections follow you here. Enrolled connections are available to everyone.">
    {resource.error && <p role="alert" className="text-[13px] text-muted-foreground">{resource.error}</p>}
    {!resource.value && !resource.error && <Skeleton className="h-28 w-full rounded-[10px]" aria-label="Loading available model access" />}
    {resource.value && (rows.length ? <SettingsList label="Model connections available to you">
      {rows.map((row) => <SettingsRow key={row.id} media={<AccessMark id={row.provider === "chatgpt" ? "codex" : row.provider} />} title={row.name} description={row.owner} />)}
    </SettingsList> : <p className="text-[13px] text-muted-foreground">No model connections are available to you.</p>)}
  </SettingsSection>;
}

export function HubModelAccess({organizationId, owner, admin}:{organizationId:string; owner:{name:string; personal:boolean}; admin:boolean}) {
  const resource=useHubResource<ModelAccessResponse>(organizationId,"/model-access");
  const [entries,setEntries]=useState<ModelAccessEntry[]>([]);
  useEffect(()=>{if(resource.value)setEntries(resource.value.providers);},[resource.value]);
  const title = owner.personal ? "Yours" : `${owner.name}'s`;
  return <SettingsSection id={`model-access-${organizationId}`} title={title} description={owner.personal ? "These follow you into every thread you start." : admin ? "Every member's cloud threads here can use these." : `Members read these. Ask an admin of ${owner.name} to change them.`}>
    {resource.error && <p role="alert" className="text-[13px] text-muted-foreground">{resource.error === "Not found" ? "Update your hosted service to configure model access." : resource.error}</p>}
    {!resource.value && !resource.error && <Skeleton className="h-[220px] w-full rounded-[10px]" aria-label="Loading model access" />}
    {resource.value && <SettingsList label="Model access">
      {owner.personal && <ChatGPTRow />}
      {Object.entries(MODEL_ACCESS_LABELS).map(([id,label])=><ModelAccessRow key={`${organizationId}:${id}`} id={id} label={label} admin={admin} value={entries.find(e=>e.id===id) ?? {id,enabled:false,configured:false,models:[],keys:[]}} save={async (patch, keyId, remove)=>{
        const path = keyId
          ? `${hubThreadBase(organizationId)}/model-access/${id}/keys/${encodeURIComponent(keyId)}`
          : patch.apiKey || patch.name
            ? `${hubThreadBase(organizationId)}/model-access/${id}/keys`
            : `${hubThreadBase(organizationId)}/model-access/${id}`;
        const result=await hubRequest<ModelAccessResponse>(path, remove ? "DELETE" : keyId ? "PATCH" : patch.apiKey || patch.name ? "POST" : "PATCH", remove ? undefined : patch);
        setEntries(result.providers);
      }}/>)}
    </SettingsList>}
  </SettingsSection>;
}

function ModelAccessRow({id,label,value,admin,save}:{id:string;label:string;value:ModelAccessEntry;admin:boolean;save:(patch:{enabled?:boolean;apiKey?:string;name?:string;active?:boolean}, keyId?:string, remove?:boolean)=>Promise<void>}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[adding,setAdding]=useState(false);
  const on = value.enabled && value.configured;
  const persist=async (patch:{enabled?:boolean;apiKey?:string;name?:string;active?:boolean}, keyId?:string, remove?:boolean)=>{
    setBusy(true);
    try { await save(patch, keyId, remove); }
    catch (cause) { toast.error(`Couldn't save ${label}`,{description:apiError(cause)}); }
    finally { setBusy(false); }
  };
  const keys = value.keys ?? [];
  const active = keys.find(key=>key.active);
  const shown = open || (on && admin);
  return <SettingsRow
    media={<AccessMark id={id} />}
    title={label}
    description={on ? `On${active ? ` · new threads use ${active.name}` : ""}` : value.configured ? "Off" : id === "anthropic" ? "Off · Claude needs an API key in the cloud" : "Off"}
    below={shown && admin && <div className="flex min-w-0 flex-col gap-2">
      <HubKeyList label={`${label} key`} keys={keys} fields={[{ id: "apiKey", label: "API key" }]} busy={busy} adding={adding || !keys.length} setAdding={setAdding}
        onSave={input=>persist({ name: input.name, apiKey: input.values.apiKey || undefined }, input.keyId)}
        onRemove={keyId=>persist({}, keyId, true)}
        onActivate={keys.length>1 ? keyId=>persist({ active: true }, keyId) : undefined} />
      {keys.length>0 && !adding && <Button size="sm" variant="ghost" className="h-7 self-start rounded-lg px-2.5 text-xs" disabled={busy} onClick={()=>setAdding(true)}>Add another key</Button>}
    </div>}
  >
    <Switch aria-label={label} checked={on || (open && !value.configured)} disabled={!admin || busy} onCheckedChange={enabled=>{
      if(!enabled){ setOpen(false); if(value.enabled) void persist({enabled:false}); return; }
      setOpen(true);
      if(value.configured) void persist({enabled:true});
    }}/>
  </SettingsRow>;
}

const CHATGPT_PATH = "/api/chatgpt-account";
/// The hub polls OpenAI at Codex's own interval; this only asks it how that went.
const PENDING_POLL_MS = 3000;

/// Your own ChatGPT sign-in for cloud Codex. The hub holds it; this page only
/// ever sees whether you are signed in, and the one-time code while you are.
function ChatGPTRow() {
  const [account, setAccount] = useState<ChatGPTAccount>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = account?.phase === "pending";
  useEffect(() => {
    let cancelled = false;
    const read = () => hubRequest<ChatGPTAccount>(CHATGPT_PATH)
      .then(next => { if (!cancelled) { setAccount(next); setError(""); } })
      .catch(cause => { if (!cancelled) setError(apiError(cause)); });
    void read();
    if (!pending) return () => { cancelled = true; };
    const timer = setInterval(() => void read(), PENDING_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pending]);
  const change = async (action: "start" | "cancel" | "logout") => {
    setBusy(true);
    try { setAccount(await hubRequest<ChatGPTAccount>(`${CHATGPT_PATH}/${action}`, "POST")); }
    catch (cause) { toast.error(action === "logout" ? "Couldn't sign out of ChatGPT" : "Couldn't sign in to ChatGPT", { description: apiError(cause) }); }
    finally { setBusy(false); }
  };
  const connected = account?.phase === "connected";
  return <SettingsRow
    media={<AccessMark id="codex" />}
    title="ChatGPT"
    description={connected ? `Codex runs on your plan${account.email ? ` · ${account.email}` : ""}` : pending ? "Waiting for you to sign in…" : account?.error || error || "Sign in so cloud Codex runs on your plan"}
    below={pending && <div className="flex min-w-0 max-w-md flex-col gap-2.5">
      <p className="text-xs leading-4 text-muted-foreground">Enter this code on OpenAI's sign-in page.</p>
      <Input aria-label="ChatGPT sign-in code" readOnly value={account.userCode ?? ""} className="font-mono" />
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" className="h-7 rounded-lg px-2.5 text-xs"><a href={account.verificationUrl} target="_blank" rel="noreferrer" data-link>Open sign-in page</a></Button>
        <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2.5 text-xs" disabled={busy} onClick={() => void change("cancel")}>Cancel</Button>
      </div>
    </div>}
  >
    {connected && <Button size="sm" variant="outline" className="h-7 rounded-lg px-2.5 text-xs" disabled={busy} onClick={() => void change("logout")}>{busy && <Spinner data-icon="inline-start" />}Disconnect</Button>}
    {!connected && !pending && <Button size="sm" className="h-7 rounded-lg px-2.5 text-xs" disabled={busy || !account} onClick={() => void change("start")}>{busy && <Spinner data-icon="inline-start" />}Sign in with ChatGPT</Button>}
  </SettingsRow>;
}
