import { useState } from "react";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { toast } from "sonner";
import { apiError } from "@/lib/api-error";
import type { LinearState } from "./HubLinear";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
export type LinearBoardState = {
  settings: {
    workspace_id: string;
    enabled: number;
    error: string | null;
  }[];
  labels: Record<string, { id: string; name: string }[]>;
  rule: string;
};
export function HubLinearBoard({ organizationId }: { organizationId: string }) {
  const { value, stale } = useHubResource<LinearBoardState>(
      organizationId,
      "/linear-board",
    ),
    { value: mapping } = useHubResource<LinearState>(organizationId, "/linear");
  const [busy, setBusy] = useState(false);
  const save = async (workspaceId: string, enabled: boolean) => {
    setBusy(true);
    try {
      await hubRequest(
        `${hubThreadBase(organizationId)}/linear-board`,
        "POST",
        { workspaceId, enabled },
      );
    } catch (e) {
      toast.error("Couldn't save Linear sync", { description: apiError(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Linear ticket sync</CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          The latest timestamp wins for each field, and comments are appended
          once.
        </p>
        <p className="text-sm text-muted-foreground">
          Turning sync off keeps your tickets in both apps.
        </p>
        {mapping?.mappings.map((map) => {
          const policy = value?.settings.find(
              (p) => p.workspace_id === map.workspace_id,
            ),
            enabled = !!policy?.enabled,
            workspace = mapping.workspaces.find(
              (w) => w.id === map.workspace_id,
            );
          return (
            <div
              key={map.workspace_id}
              className="flex min-w-0 flex-col gap-3 rounded-md border p-3"
            >
              <h3 className="font-medium">{workspace?.name ?? "Workspace"}</h3>
              <p role="status">
                {enabled ? "Linear sync is on." : "Linear sync is off."}
              </p>
              {policy?.error && <p role="alert">{policy.error}</p>}
              <Button
                variant={enabled ? "outline" : "default"}
                disabled={busy || stale || !mapping.canManage}
                onClick={() => void save(map.workspace_id, !enabled)}
              >
                {enabled ? "Turn off Linear sync" : "Turn on Linear sync"}
              </Button>
            </div>
          );
        })}
        {!mapping?.mappings.length && (
          <p className="text-sm text-muted-foreground">
            Map a Linear team to your workspace before turning sync on.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
