import { useHubResource } from "@/lib/hub-organization";
import { toast } from "sonner";
import { useState } from "react";
import { HubModelDefault } from "./HubModelDefault";
import { AvatarField, AppearanceField, NotificationsField, PermissionField, AppInfo } from "./GeneralFields";
import { useHubProfile, saveHubAvatar } from "@/lib/hub-profile";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { Button } from "./ui/button";
export default function HubGeneralSettings({organizationId}:{organizationId:string}) {
  const preferences = useHubResource<{permissionMode:string}>(organizationId, "/profile-preferences");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{source:typeof preferences.value;permissionMode:string}>();
  const permission = saved?.source === preferences.value ? saved?.permissionMode : preferences.value?.permissionMode;
  const { profile, error } = useHubProfile(organizationId);
  return <section className="mx-auto flex w-full max-w-2xl flex-col gap-6" aria-label="General settings">
    <AppInfo detail={<p className="text-xs text-muted-foreground">Web app</p>}>
      <Button asChild size="sm" variant="outline"><a href="https://github.com/padamchopra/remy/releases/latest" target="_blank" rel="noreferrer">Download for Mac</a></Button>
    </AppInfo>
    {profile && <AvatarField avatar={profile.image ?? ""} onSave={saveHubAvatar} onGithub={async () => {
      const {image} = await hubRequest<{image:string}>(`${hubThreadBase(organizationId)}/github/profile`);
      await saveHubAvatar(image);
    }} />}
    {error && <p role="alert">{error}</p>}
    <NotificationsField />
    <HubModelDefault organizationId={organizationId}>
      <PermissionField value={permission ?? "default"} disabled={saving || !preferences.value} onChange={async permissionMode => {
        setSaving(true);
        try { await hubRequest(`${hubThreadBase(organizationId)}/profile-preferences`, "PATCH", {permissionMode}); setSaved({source:preferences.value,permissionMode}); }
        catch(error) { toast.error("Couldn't save your permission level", {description:error instanceof Error ? error.message : "Try again."}); }
        finally { setSaving(false); }
      }} />
    </HubModelDefault>
    <AppearanceField />
  </section>;
}
