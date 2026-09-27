import { useEffect, useState } from "react";
import type { ComputerSummary, OrganizationWorkspace } from "@remy/contract";
import { watchHubResource } from "./hub-computers";
import type { HubMember } from "./hub-organization";
import { hubThreadBase } from "./hub-threads";

export interface AccountResources {
  members?: HubMember[];
  computers?: ComputerSummary[];
  workspaces?: OrganizationWorkspace[];
}

/// The All view reads several accounts at once, so the subscriptions live in
/// one hook keyed by account rather than one hook call per account, which the
/// rules of hooks would not allow to change length.
export function useAccountResources(organizationIds: string[]): Record<string, AccountResources> {
  const [byAccount, setByAccount] = useState<Record<string, AccountResources>>({});
  const key = organizationIds.join(",");
  useEffect(() => {
    const ids = key ? key.split(",") : [];
    const put = (id: string, patch: AccountResources) =>
      setByAccount((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    const stops = ids.flatMap((id) => [
      watchHubResource<{ members: HubMember[] }>(
        `${hubThreadBase(id)}/members`, (value) => put(id, { members: value?.members }), () => {},
        `${hubThreadBase(id)}/live`),
      watchHubResource<{ computers: ComputerSummary[] }>(
        `${hubThreadBase(id)}/computers`, (value) => put(id, { computers: value?.computers }), () => {},
        `${hubThreadBase(id)}/computers/live`),
      watchHubResource<{ workspaces: OrganizationWorkspace[] }>(
        `${hubThreadBase(id)}/workspaces`, (value) => put(id, { workspaces: value?.workspaces }), () => {},
        `${hubThreadBase(id)}/live`),
    ]);
    return () => { for (const stop of stops) stop(); };
  }, [key]);
  return byAccount;
}

