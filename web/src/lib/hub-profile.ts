import { shareSubscription } from "./shared-subscription";
import { useEffect, useState } from "react";
import { watchHubResource } from "./hub-computers";
import { hubRequest, hubThreadBase } from "./hub-threads";
export type HubProfile = { id: string; name: string; image?: string };
const watchProfile = shareSubscription<[HubProfile | undefined]>((org, changed, failed) => {
  const update = (event: Event) => changed((event as CustomEvent<HubProfile>).detail);
  window.addEventListener("remy:profile", update);
  const stop = watchHubResource<HubProfile>("/api/profile", value => changed(value), failed, `${hubThreadBase(org)}/live`);
  return () => { stop(); window.removeEventListener("remy:profile", update); };
});
export function useHubProfile(organizationId: string) {
  const [profile, setProfile] = useState<HubProfile>();
  const [error, setError] = useState("");
  useEffect(() => {
    setProfile(undefined);
    return watchProfile(organizationId, value => { setProfile(value); if (value) setError(""); }, setError);
  }, [organizationId]);
  return { profile, error };
}
export async function saveHubAvatar(image: string) {
  const profile = await hubRequest<HubProfile>("/api/profile", "PATCH", { image: image || null });
  window.dispatchEvent(new CustomEvent("remy:profile", { detail: profile }));
  return profile;
}
