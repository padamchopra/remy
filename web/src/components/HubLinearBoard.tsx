import { useState } from "react";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import type { LinearState } from "./HubLinear";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
export type LinearBoardState = {
  settings: {
    workspace_id: string;
    enabled: number;
    agent_map: string;
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
    { value: mapping } = useHubResource<LinearState>(organizationId, "/linear"),
    { value: agents } = useHubResource<{
      agents: { id: string; fields: Record<string, unknown> }[];
    }>(organizationId, "/agents", "/board/live");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async (
    workspaceId: string,
    enabled: boolean,
    agentMap: Record<string, string>,
  ) => {
    setBusy(true);
    setError("");
    try {
      await hubRequest(
        `${hubThreadBase(organizationId)}/linear-board`,
        "POST",
        { workspaceId, enabled, agentMap },
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Your sync preference could not be saved.",
      );
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
        {error && <p role="alert">{error}</p>}
        {mapping?.mappings.map((map) => {
          const policy = value?.settings.find(
              (p) => p.workspace_id === map.workspace_id,
            ),
            enabled = !!policy?.enabled,
            selected: Record<string, string> = JSON.parse(
              policy?.agent_map ?? "{}",
            ),
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
                onClick={() => void save(map.workspace_id, !enabled, selected)}
              >
                {enabled ? "Turn off Linear sync" : "Turn on Linear sync"}
              </Button>
              {mapping.canManage && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Choose agents for assignments made by matched members.
                  </p>
                  {mapping.catalog.users.map((user) => (
                    <div key={user.id} className="flex min-w-0 flex-col gap-2">
                      <Label>Agent for {user.name}</Label>
                      <Select
                        value={selected[user.id] ?? "none"}
                        disabled={busy || stale}
                        onValueChange={(id) => {
                          const next = { ...selected };
                          if (id === "none") delete next[user.id];
                          else next[user.id] = id;
                          void save(map.workspace_id, enabled, next);
                        }}
                      >
                        <SelectTrigger aria-label={`Agent for ${user.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            No automatic work
                          </SelectItem>
                          {agents?.agents
                            .filter(
                              (a) =>
                                a.fields.scope !== "personal" &&
                                (a.fields.scope !== "workspace" ||
                                  a.fields.ownerId === map.workspace_id),
                            )
                            .map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {String(a.fields.name)}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </>
              )}
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
