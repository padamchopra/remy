import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { cloudComputerProvider } from "@remy/contract";
import { ModelPickerButton, REMY_DEFAULT } from "./ModelPicker";
import { SettingsList, SettingsRow } from "./SettingsList";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { cloudCatalogue, type OwnModelAccessResponse } from "@/lib/hub-models";
import type { Provider, ModelChoice } from "@/lib/providers";
import type { ModelAccessResponse } from "./HubModelAccess";
import { apiError } from "@/lib/api-error";
/// A person's default for one computer. There is no account-wide or workspace
/// default: a thread without one follows the composer's last pick, then the
/// provider's own default.
export type HubModelDefaults = {computer:ModelChoice|null};
export const modelDefaultsPath=(computerId?:string)=>computerId ? `/model-defaults?${new URLSearchParams({computer:computerId})}` : "/model-defaults";
export function useHubModelDefaults(org:string,computerId?:string) {
  return useHubResource<HubModelDefaults>(org,modelDefaultsPath(computerId));
}

/// What a cloud computer can start on for you: the account's model access,
/// ChatGPT when you allow it here, and your own keys where you turned them on.
function useCloudCatalogue(organizationId: string, cloud: boolean, choice: ModelChoice) {
  const access = useHubResource<ModelAccessResponse>(organizationId, cloud ? "/model-access" : null);
  const chatgpt = useHubResource<{ available: boolean }>(organizationId, cloud ? "/chatgpt" : null, "/computers/live");
  const own = useHubResource<OwnModelAccessResponse>(organizationId, cloud ? "/own-model-access" : null, "/computers/live");
  const catalogue = cloudCatalogue(
    access.value?.providers ?? [],
    choice.provider === REMY_DEFAULT ? undefined : choice,
    chatgpt.value?.available === true,
    own.value?.personal ? [] : own.value?.providers ?? [],
  );
  const pending = cloud && ((!access.value && !access.error) || (!chatgpt.value && !chatgpt.error));
  return { catalogue, pending };
}

/// The default model row on a computer's page. A connected computer passes the
/// models it reports; a cloud provider's comes from model access.
export function HubModelDefault({organizationId,computerId,catalogue,title,description="You can still change it per thread."}:{organizationId:string;computerId:string;catalogue?:Provider[];title:ReactNode;description?:ReactNode}) {
  const defaults=useHubModelDefaults(organizationId,computerId);
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState<{source:typeof defaults.value;value:HubModelDefaults}>();
  const value=saved && saved.source===defaults.value ? saved.value : defaults.value;
  const choice=value?.computer ?? {provider:REMY_DEFAULT,model:""};
  const cloud=useCloudCatalogue(organizationId, !catalogue && !!cloudComputerProvider(computerId), choice);
  return <SettingsList>
    <SettingsRow title={title} description={defaults.error || description}>
      <ModelPickerButton className="w-56 max-w-[60vw] min-w-0" value={choice} allowDefault catalogue={catalogue ?? cloud.catalogue} cataloguePending={!catalogue && cloud.pending} disabled={saving} pending={!defaults.value && !defaults.error} title="Default model" onPick={async choice=>{
        setSaving(true);
        try { const next=await hubRequest<HubModelDefaults>(`${hubThreadBase(organizationId)}${modelDefaultsPath(computerId)}`,"PATCH",{choice:choice.provider===REMY_DEFAULT ? null : choice}); setSaved({source:defaults.value,value:next}); }
        catch(error){toast.error("Couldn't save your default model",{description:apiError(error)});}
        finally{setSaving(false);}
      }} />
    </SettingsRow>
  </SettingsList>;
}
