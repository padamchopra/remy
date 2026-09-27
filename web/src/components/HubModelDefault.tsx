import type { ReactNode } from "react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ModelPickerButton, REMY_DEFAULT } from "./ModelPicker";
import { Field, FieldContent, FieldLabel, FieldDescription } from "./ui/field";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { hostedModels } from "@/lib/hub-models";
import type { Provider, ModelChoice } from "@/lib/providers";
import type { ModelAccessResponse } from "./HubModelAccess";
import { apiError } from "@/lib/api-error";
/// A person's defaults for one workspace and one computer. There is no account-wide
/// default: a thread with neither follows the composer's last pick, then the
/// provider's own default.
export type HubModelDefaults = {workspace:ModelChoice|null;computer?:ModelChoice|null};
export const modelDefaultsPath=(workspaceId?:string,computerId?:string)=>{
  const query=new URLSearchParams();if(workspaceId)query.set("workspace",workspaceId);if(computerId)query.set("computer",computerId);
  return `/model-defaults${query.size ? `?${query}` : ""}`;
};
export function useHubModelDefaults(org:string,workspaceId?:string,computerId?:string) {
  return useHubResource<HubModelDefaults>(org,modelDefaultsPath(workspaceId,computerId));
}
export function HubModelDefault({organizationId,workspaceId,computerId,catalogue,label="Default model",description="You can still change this per thread."}:{organizationId:string;catalogue?:Provider[];label?:ReactNode;description?:ReactNode}&({workspaceId:string;computerId?:undefined}|{computerId:string;workspaceId?:undefined})) {
  const id=useId();
  const defaults=useHubModelDefaults(organizationId,workspaceId,computerId);
  const access=useHubResource<ModelAccessResponse>(organizationId,"/model-access");
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState<{source:typeof defaults.value;value:HubModelDefaults}>();
  const value=saved && saved.source===defaults.value ? saved.value : defaults.value;
  const choice=(computerId ? value?.computer : value?.workspace) ?? {provider:REMY_DEFAULT,model:""};
  return <Field orientation="horizontal" className="items-center">
    <FieldContent><FieldLabel htmlFor={id}>{label}</FieldLabel><FieldDescription className="text-xs">{description}</FieldDescription></FieldContent>
    <div className="flex min-w-0 flex-wrap justify-end gap-2">
    <ModelPickerButton id={id} className="w-48 min-w-0" value={choice} allowDefault catalogue={catalogue ?? hostedModels(access.value?.providers??[], choice.provider===REMY_DEFAULT ? undefined : choice)} cataloguePending={!catalogue && !access.value && !access.error} disabled={saving || !defaults.value || (!!computerId && !("computer" in defaults.value))} onPick={async choice=>{
      setSaving(true);
      try { const next=await hubRequest<HubModelDefaults>(`${hubThreadBase(organizationId)}${modelDefaultsPath(workspaceId,computerId)}`,"PATCH",{choice:choice.provider===REMY_DEFAULT ? null : choice}); setSaved({source:defaults.value,value:next}); }
      catch(error){toast.error("Couldn't save your default model",{description:apiError(error)});}
      finally{setSaving(false);}
    }} />
    </div>
    {defaults.error && <p role="alert">{defaults.error}</p>}
  </Field>;
}
