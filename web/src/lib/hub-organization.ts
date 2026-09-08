import { useEffect, useState } from "react";
import { watchHubResource } from "./hub-computers";
import { hubThreadBase } from "./hub-threads";
import type {
  OrganizationMember,
  OrganizationTeam,
  OrganizationWorkspace,
} from "@remy/contract";
export type HubMember = OrganizationMember & { name: string };
export type HubWorkspace = OrganizationWorkspace & {
  access?: { userIds: string[]; teamIds: string[] };
};
export type HubPeople = { members: HubMember[]; teams: OrganizationTeam[] };
export function useHubResource<T>(organizationId: string, path: string, livePath = "/live") {
  const [value, setValue] = useState<T>();
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setValue(undefined);
    setError("");
    return watchHubResource<T>(
      `${hubThreadBase(organizationId)}${path}`,
      (next, outdated) => {
        setValue(next);
        setStale(outdated);
        if (!outdated) setError("");
      },
      setError,
      `${hubThreadBase(organizationId)}${livePath}`,
    );
  }, [organizationId, path, livePath]);
  return { value, stale, error };
}
