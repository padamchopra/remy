import { shareSubscription } from "./shared-subscription";
import { useEffect, useState } from "react";
import { watchHubResource } from "./hub-computers";
import { hubRequest, hubThreadBase } from "./hub-threads";
export type HubProfile = { id: string; name: string; image?: string };
/// The profile is the person's, not the account's, so every account shares one
/// read of it. Keyed on the account, it was read again for each account id a
/// view asked under. The account whose view starts the subscription supplies
/// the live channel that announces a change made on another device.
let channel = "personal";
const watchProfile = shareSubscription<[HubProfile | undefined]>((_key, changed, failed) => {
  const update = (event: Event) => changed((event as CustomEvent<HubProfile>).detail);
  window.addEventListener("remy:profile", update);
  const stop = watchHubResource<HubProfile>("/api/profile", value => changed(value), failed, `${hubThreadBase(channel)}/live`);
  return () => { stop(); window.removeEventListener("remy:profile", update); };
});
export function useHubProfile(organizationId: string) {
  const [profile, setProfile] = useState<HubProfile>();
  const [error, setError] = useState("");
  channel = organizationId;
  useEffect(() => {
    return watchProfile("profile", value => { setProfile(value); if (value) setError(""); }, setError);
  }, []);
  return { profile, error };
}
export async function saveHubAvatar(image: string) {
  const profile = await hubRequest<HubProfile>("/api/profile", "PATCH", { image: image || null });
  window.dispatchEvent(new CustomEvent("remy:profile", { detail: profile }));
  return profile;
}
