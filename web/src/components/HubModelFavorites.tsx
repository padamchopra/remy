import { useState, type ReactNode } from "react";
import { ModelFavoritesContext } from "@/lib/model-favorites";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";

export function HubModelFavorites({ organizationId, children }: { organizationId?: string; children: ReactNode }) {
  const { value } = useHubResource<{ favorites: string[] }>(organizationId ?? "", organizationId ? "/model-favorites" : null);
  const [saved, setSaved] = useState<{ source: typeof value; favorites: string[] }>();
  return <ModelFavoritesContext value={{
    values: saved && saved.source === value ? saved.favorites : value?.favorites ?? [],
    ready: value !== undefined,
    toggle: async (key, enabled) => {
      if (!organizationId) throw new Error("Choose a workspace.");
      const result = await hubRequest<{ favorites: string[] }>(`${hubThreadBase(organizationId)}/model-favorites`, "PATCH", { key, enabled });
      setSaved({ source: value, favorites: result.favorites });
    },
  }}>{children}</ModelFavoritesContext>;
}
