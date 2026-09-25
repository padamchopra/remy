import { useEffect, useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccessMark } from "./AccessMark";
import { HubClaudeAccount } from "./HubClaudeAccount";
import { HubCodexAccount } from "./HubCodexAccount";
import { HubNamedKeys, type NamedKey } from "./HubNamedKeys";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { useHubResource, type HubWorkspace } from "@/lib/hub-organization";
import { apiError } from "@/lib/api-error";
import { toast } from "sonner";
import type { HostedClaudeAccount } from "@remy/contract";

export interface ModelAccessEntry {id:string;enabled:boolean;configured:boolean;models:string[];keys?:NamedKey[]}
export interface ModelAccessResponse {
  providers: ModelAccessEntry[];
  accounts?: { claude?: HostedClaudeAccount };
}
const labels:Record<string,string>={anthropic:"Anthropic",openai:"OpenAI",router:"Router.com",openrouter:"OpenRouter"};
export function HubModelAccess({organizationId}:{organizationId:string}) {
  const resource=useHubResource<ModelAccessResponse>(organizationId,"/model-access");
  const [entries,setEntries]=useState<ModelAccessEntry[]>([]);
  useEffect(()=>{if(resource.value)setEntries(resource.value.providers);},[resource.value]);
  return <section aria-label="Model access" className="min-w-0 space-y-4 border-t pt-6">
    <div className="space-y-1">
      <h2 className="text-sm font-medium">Model access</h2>
      {resource.error && <p role="alert" className="text-sm text-muted-foreground">{resource.error === "Not found" ? "Update your hosted service to configure model access." : resource.error}</p>}
    </div>
    {!resource.value && !resource.error && <div aria-label="Loading model access" role="status" className="space-y-4">{["claude-code","codex",...Object.keys(labels)].map(id=><Skeleton key={id} className="h-[54px] w-full rounded-xl" />)}</div>}
    {resource.value && <>
      <AccountSection id="claude-code" label="Claude Code">
        <HubClaudeAccount organizationId={organizationId} />
      </AccountSection>
      <AccountSection id="codex" label="Codex">
        <CodexAccess organizationId={organizationId} />
      </AccountSection>
      {Object.entries(labels).map(([id,label])=><ModelAccessSection key={`${organizationId}:${id}`} id={id} label={label} value={entries.find(e=>e.id===id) ?? resource.value!.providers.find(e=>e.id===id) ?? {id,enabled:false,configured:false,models:[],keys:[]}} available={!!resource.value} save={async (patch, keyId, remove)=>{
      const path = keyId
        ? `${hubThreadBase(organizationId)}/model-access/${id}/keys/${encodeURIComponent(keyId)}`
        : patch.apiKey || patch.name
          ? `${hubThreadBase(organizationId)}/model-access/${id}/keys`
          : `${hubThreadBase(organizationId)}/model-access/${id}`;
      const result=await hubRequest<ModelAccessResponse>(path, remove ? "DELETE" : keyId ? "PATCH" : patch.apiKey || patch.name ? "POST" : "PATCH", remove ? undefined : patch);
      setEntries(result.providers);
      return result.providers.find(e=>e.id===id)!;
    }}/>)}
    </>}
  </section>;
}
function AccountSection({id,label,children}:{id:string;label:string;children:ReactNode}) {
  return <section aria-label={`${label} model access`} className="min-w-0 rounded-xl border p-4">
    <div className="flex min-w-0 items-center gap-3">
      <AccessMark id={id} />
      <h3 className="min-w-0 flex-1 text-sm leading-snug font-medium">{label}</h3>
    </div>
    <div className="mt-4">{children}</div>
  </section>;
}
function CodexAccess({organizationId}:{organizationId:string}) {
  const workspaces=useHubResource<{workspaces:HubWorkspace[]}>(organizationId,"/workspaces");
  const list=workspaces.value?.workspaces ?? [];
  const [workspaceId,setWorkspaceId]=useState("");
  const selected=workspaceId || list[0]?.id || "";
  useEffect(()=>{if(!workspaceId && list[0])setWorkspaceId(list[0].id);},[list,workspaceId]);
  const hosted=useHubResource<{state?:{phase?:string}|null}>(organizationId, selected ? `/hosted/${encodeURIComponent(selected)}` : null, "/computers/live");
  const [starting,setStarting]=useState(false);
  const ready=hosted.value?.state?.phase === "ready";
  const start=async ()=>{
    if(!selected)return;
    setStarting(true);
    try { await hubRequest(`${hubThreadBase(organizationId)}/hosted/${encodeURIComponent(selected)}/prewarm`,"POST"); }
    catch(error){ toast.error("Couldn't start that computer",{description:apiError(error)}); }
    finally { setStarting(false); }
  };
  return <div className="flex min-w-0 flex-col gap-4">
    <Field>
      <FieldLabel>Workspace</FieldLabel>
      <FieldDescription>
        This ChatGPT sign-in stays on that workspace's computer.
      </FieldDescription>
      {list.length ? (
        <Select value={selected} onValueChange={setWorkspaceId}>
          <SelectTrigger aria-label="Workspace" className="w-full min-w-0 max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {list.map((workspace)=>(
              <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <FieldDescription>
          Add a workspace, then connect Codex on its computer.
        </FieldDescription>
      )}
    </Field>
    {selected && !ready && (
      <Button className="self-start" disabled={starting || hosted.stale} onClick={()=>void start()}>
        {starting && <Spinner data-icon="inline-start" />}
        Start computer
      </Button>
    )}
    {selected && ready && (
      <HubCodexAccount organizationId={organizationId} workspaceId={selected} ready />
    )}
  </div>;
}
function ModelAccessSection({id,label,value,available,save}:{id:string;label:string;value:ModelAccessEntry;available:boolean;save:(patch:{enabled?:boolean;apiKey?:string;name?:string;active?:boolean}, keyId?:string, remove?:boolean)=>Promise<ModelAccessEntry>}) {
  const [expanded,setExpanded]=useState(value.enabled),[busy,setBusy]=useState(false);
  useEffect(()=>{if(!busy)setExpanded(value.enabled);},[value.enabled,value.configured,busy]);
  const persist=async (patch:{enabled?:boolean;apiKey?:string;name?:string;active?:boolean}, keyId?:string, remove?:boolean)=>{
    setBusy(true);
    try { await save(patch, keyId, remove); }
    catch { toast.error("Couldn't save model access",{description:"Your changes could not be saved. Try again."}); setExpanded(value.enabled); }
    finally { setBusy(false); }
  };
  return <section aria-label={`${label} model access`} className="min-w-0 rounded-xl border p-4">
    <div className="flex min-w-0 items-center gap-3"><AccessMark id={id} /><h3 className="min-w-0 flex-1 text-sm leading-snug font-medium">{label}</h3><Switch aria-label={label} checked={expanded} disabled={!available || busy && !expanded} onCheckedChange={enabled=>{
      setExpanded(enabled);
      if(!enabled) void persist({enabled:false});
      else if(value.configured) void persist({enabled:true});
    }}/></div>
    {expanded && <div className="mt-4">
      <HubNamedKeys
        label={label}
        keys={value.keys ?? []}
        fields={[{ id: "apiKey", label: "API key", name: `${label} API key` }]}
        busy={busy}
        onSave={(input) => persist({ name: input.name, apiKey: input.values.apiKey || undefined }, input.keyId)}
        onRemove={(keyId) => persist({}, keyId, true)}
        onActivate={ (value.keys?.length ?? 0) > 1 ? (keyId) => persist({ active: true }, keyId) : undefined }
      />
    </div>}
  </section>;
}
