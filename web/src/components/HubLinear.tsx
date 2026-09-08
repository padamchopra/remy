import { useState } from "react";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
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
export type LinearState = {
  canManage: boolean;
  connected: boolean;
  catalog: {
    teams: {
      id: string;
      name: string;
      key: string;
      states: { id: string; name: string; type: string }[];
    }[];
    projects: { id: string; name: string; teamIds: string[] }[];
    users: { id: string; name: string; suggestedMemberId: string | null }[];
  };
  mappings: {
    workspace_id: string;
    linear_team_id: string;
    linear_project_id: string;
    remy_team_id: string | null;
    status_map: string;
  }[];
  matches: { linear_user_id: string; member_id: string }[];
  members: { id: string; name: string }[];
  workspaces: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  columns: string[];
};
const columnNames: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  needs_input: "Needs input",
  pr_review: "PR review",
  done: "Done",
  cancelled: "Cancelled",
};
export function HubLinear({ organizationId }: { organizationId: string }) {
  const {
    value,
    stale,
    error: readError,
  } = useHubResource<LinearState>(organizationId, "/linear");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [workspace, setWorkspace] = useState(""),
    [team, setTeam] = useState(""),
    [group, setGroup] = useState("none"),
    [remyTeam, setRemyTeam] = useState("none"),
    [statuses, setStatuses] = useState<Record<string, string>>({});
  const root = `${hubThreadBase(organizationId)}/linear`,
    disabled = busy || stale || !value?.canManage;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Your Linear connection could not update.",
      );
    } finally {
      setBusy(false);
    }
  };
  const pick = (
    label: string,
    current: string,
    change: (v: string) => void,
    options: { id: string; name: string }[],
  ) => (
    <div className="flex min-w-0 flex-col gap-2">
      <Label>{label}</Label>
      <Select value={current} onValueChange={change} disabled={disabled}>
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder="Choose an option" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  const chooseTeam = (id: string) => {
    setTeam(id);
    setGroup("none");
    setStatuses(
      Object.fromEntries(
        (value?.catalog.teams.find((t) => t.id === id)?.states ?? []).map(
          (s) => [
            s.id,
            (
              {
                backlog: "backlog",
                unstarted: "todo",
                started: "in_progress",
                completed: "done",
                canceled: "cancelled",
              } as Record<string, string>
            )[s.type] ?? "backlog",
          ],
        ),
      ),
    );
  };
  const selectedTeam = value?.catalog.teams.find((t) => t.id === team);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Linear mappings</CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {(error || readError) && <p role="alert">{error || readError}</p>}
        {notice && <p role="status">{notice}</p>}
        {stale && <p role="status">Reconnect to update your mappings.</p>}
        {value?.canManage ? (
          <>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  await hubRequest(`${root}/refresh`, "POST", {});
                  setNotice("Your Linear teams and members are refreshed.");
                })
              }
            >
              Refresh Linear teams
            </Button>
            {!value.connected && (
              <p className="text-sm text-muted-foreground">
                Connect Linear, then refresh your teams to map your workspaces.
              </p>
            )}
            {value.catalog.teams.map((t) => (
              <div key={t.id} className="min-w-0 rounded-md border p-3">
                <p className="break-words">
                  {t.name} · {t.key}
                </p>
                <p className="break-words text-sm text-muted-foreground">
                  {value.mappings
                    .filter((m) => m.linear_team_id === t.id)
                    .map(
                      (m) =>
                        `${value.workspaces.find((w) => w.id === m.workspace_id)?.name ?? "Unavailable workspace"}${m.linear_project_id ? ` · ${value.catalog.projects.find((p) => p.id === m.linear_project_id)?.name ?? "Unavailable grouping"}` : ""}`,
                    )
                    .join(", ") || "Choose a workspace for this team."}
                </p>
              </div>
            ))}
            {value.connected && (
              <>
                {pick(
                  "Remy workspace",
                  workspace,
                  (id) => {
                    setWorkspace(id);
                    const map = value.mappings.find(
                      (m) => m.workspace_id === id,
                    );
                    setTeam(map?.linear_team_id ?? "");
                    setGroup(map?.linear_project_id || "none");
                    setRemyTeam(map?.remy_team_id || "none");
                    setStatuses(map ? JSON.parse(map.status_map) : {});
                  },
                  value.workspaces,
                )}
                {workspace && (
                  <>
                    {pick(
                      "Linear team",
                      team,
                      chooseTeam,
                      value.catalog.teams.map((t) => ({
                        id: t.id,
                        name: `${t.name} · ${t.key}`,
                      })),
                    )}
                    {selectedTeam && (
                      <>
                        {pick("Linear grouping", group, setGroup, [
                          { id: "none", name: "Entire team" },
                          ...value.catalog.projects.filter((p) =>
                            p.teamIds.includes(team),
                          ),
                        ])}
                        {pick("Remy team", remyTeam, setRemyTeam, [
                          { id: "none", name: "No team mapping" },
                          ...value.teams,
                        ])}
                        <h3 className="font-medium">Ticket columns</h3>
                        {selectedTeam.states.map((s) => (
                          <div key={s.id}>
                            {pick(
                              `Column for ${s.name}`,
                              statuses[s.id] ?? "backlog",
                              (v) =>
                                setStatuses((old) => ({ ...old, [s.id]: v })),
                              value.columns.map((c) => ({
                                id: c,
                                name: columnNames[c] ?? c,
                              })),
                            )}
                          </div>
                        ))}
                        <Button
                          disabled={disabled}
                          onClick={() =>
                            void run(async () => {
                              await hubRequest(`${root}/workspace`, "POST", {
                                workspaceId: workspace,
                                linearTeamId: team,
                                linearProjectId: group === "none" ? "" : group,
                                remyTeamId:
                                  remyTeam === "none" ? null : remyTeam,
                                statusMap: statuses,
                              });
                              setNotice("Your workspace mapping is saved.");
                            })
                          }
                        >
                          Save Linear mapping
                        </Button>
                      </>
                    )}
                  </>
                )}
                <h3 className="font-medium">Member matches</h3>
                {value.catalog.users.map((u) => (
                  <div key={u.id} className="min-w-0 rounded-md border p-3">
                    {pick(
                      `Match ${u.name}`,
                      value.matches.find((m) => m.linear_user_id === u.id)
                        ?.member_id ?? "none",
                      (member) =>
                        void run(async () => {
                          await hubRequest(`${root}/member`, "POST", {
                            linearUserId: u.id,
                            memberId: member === "none" ? null : member,
                          });
                          setNotice("Your member match is saved.");
                        }),
                      [
                        { id: "none", name: `Unmatched · ${u.name}` },
                        ...value.members,
                      ],
                    )}
                    {u.suggestedMemberId &&
                      !value.matches.some((m) => m.linear_user_id === u.id) && (
                        <p className="text-sm text-muted-foreground">
                          Suggested:{" "}
                          {
                            value.members.find(
                              (m) => m.id === u.suggestedMemberId,
                            )?.name
                          }
                        </p>
                      )}
                  </div>
                ))}
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ask your administrator to manage Linear mappings.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
