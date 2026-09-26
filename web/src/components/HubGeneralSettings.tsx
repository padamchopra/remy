import { useHubResource } from "@/lib/hub-organization";
import { toast } from "sonner";
import { useState } from "react";
import { HubLinearWorkspace } from "./LinearConnection";
import { HubModelDefault } from "./HubModelDefault";
import { AvatarField, AppearanceField, NotificationsField, PermissionField, AppInfo } from "./GeneralFields";
import { useHubProfile, saveHubAvatar } from "@/lib/hub-profile";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { Button } from "./ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "./ui/field";
type Preferences = {permissionMode:string};
export default function HubGeneralSettings({organizationId,showModelDefault=true}:{organizationId:string;showModelDefault?:boolean}) {
  const preferences = useHubResource<Preferences>(organizationId, "/profile-preferences");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{source:typeof preferences.value;permissionMode:string}>();
  const permission = saved?.source === preferences.value ? saved?.permissionMode : preferences.value?.permissionMode;
  const { profile, error } = useHubProfile(organizationId);
  return <section className="mx-auto flex w-full max-w-2xl flex-col gap-6" aria-label="General settings">
    <AppInfo detail={<p className="text-xs text-muted-foreground">Web app</p>}>
      <Button asChild size="sm" variant="outline" data-link><a href="https://tryremy.dev/docs/#installation" target="_blank" rel="noreferrer">Set up a computer</a></Button>
    </AppInfo>
    {profile && <AvatarField avatar={profile.image ?? ""} onSave={saveHubAvatar} onGithub={async () => {
      const {image} = await hubRequest<{image:string}>(`${hubThreadBase(organizationId)}/github/profile`);
      await saveHubAvatar(image);
    }} />}
    {error && <p role="alert">{error}</p>}
    <NotificationsField />
    {showModelDefault ? <HubLinearWorkspace organizationId={organizationId} personal /> : null}
    {showModelDefault ? <HubModelDefault organizationId={organizationId}>
      <PermissionControl permission={permission} saving={saving} source={preferences.value} setSaving={setSaving} saved={setSaved} organizationId={organizationId} />
    </HubModelDefault> : <Field orientation="horizontal" className="items-center">
      <FieldContent><FieldLabel>Default permission level</FieldLabel><FieldDescription className="text-xs">You can still change this per thread.</FieldDescription></FieldContent>
      <PermissionControl permission={permission} saving={saving} source={preferences.value} setSaving={setSaving} saved={setSaved} organizationId={organizationId} />
    </Field>}
    <AppearanceField />
  </section>;
}

function PermissionControl({permission,saving,source,setSaving,saved:setSaved,organizationId}:{permission?:string;saving:boolean;source:Preferences|undefined;setSaving:(saving:boolean)=>void;saved:(value:{source:Preferences|undefined;permissionMode:string})=>void;organizationId:string}) {
  return <PermissionField value={permission ?? "default"} disabled={saving || !source} onChange={async permissionMode => {
        setSaving(true);
        try { await hubRequest(`${hubThreadBase(organizationId)}/profile-preferences`, "PATCH", {permissionMode}); setSaved({source,permissionMode}); }
        catch(error) { toast.error("Couldn't save your permission level", {description:error instanceof Error ? error.message : "Try again."}); }
        finally { setSaving(false); }
      }} />;
}
