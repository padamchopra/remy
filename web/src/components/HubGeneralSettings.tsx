import { AvatarField, NotificationsField, AppInfo } from "./GeneralFields";
import { useHubProfile, saveHubAvatar } from "@/lib/hub-profile";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { Button } from "./ui/button";

/// Who you are and how Remy reaches you. A new thread's model and permission are
/// not set here: a computer can carry a default model, and a new
/// thread always starts by asking.
export default function HubGeneralSettings({organizationId}:{organizationId:string}) {
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
  </section>;
}
