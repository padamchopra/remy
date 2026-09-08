import { useState } from "react";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type GitHubState = {
  repositories: {
    workspace_id: string;
    full_name: string;
    repository_id: number;
  }[];
  monitoring: {
    workspace_id: string;
    pull_number: number;
    enabled: number;
    agent_id: string | null;
  }[];
  activity: {
    id: string;
    workspace_id: string;
    summary: string;
    phase: string;
    pull_number: number;
    thread_id: string | null;
    computer_id: string | null;
  }[];
};
export function HubGitHub({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const {
    value,
    stale,
    error: readError,
  } = useHubResource<GitHubState>(organizationId, "/github");
  const { value: agents } = useHubResource<{
    agents: { id: string; fields: { name?: string; scope?: string } }[];
  }>(organizationId, "/agents", "/board/live");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [installations, setInstallations] = useState<
      { id: number; account: { login: string } }[]
    >([]),
    [installation, setInstallation] = useState(""),
    [repos, setRepos] = useState<{ id: number; full_name: string }[]>([]),
    [selected, setSelected] = useState<number[]>([]),
    [workspace, setWorkspace] = useState(""),
    [agent, setAgent] = useState(""),
    [pull, setPull] = useState("0"),
    [action, setAction] = useState("comment"),
    [number, setNumber] = useState(""),
    [title, setTitle] = useState(""),
    [head, setHead] = useState(""),
    [base, setBase] = useState("main"),
    [body, setBody] = useState(""),
    [review, setReview] = useState("COMMENT"),
    [notice, setNotice] = useState("");
  const root = `${hubThreadBase(organizationId)}/github`;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "GitHub is unavailable.");
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || stale;
  const pick = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    options: { value: string; label: string }[],
  ) => (
    <div className="flex min-w-0 flex-col gap-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder={`Choose ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub repositories</CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {(error || readError) && <p role="alert">{error || readError}</p>}
        {stale && (
          <p role="status">Reconnect to update your GitHub settings.</p>
        )}
        {notice && <p role="status">{notice}</p>}
        {canManage && (
          <>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() =>
                void run(async () =>
                  setInstallations(
                    (
                      await hubRequest<{ installations: typeof installations }>(
                        `${root}/installations`,
                      )
                    ).installations,
                  ),
                )
              }
            >
              Choose GitHub installation
            </Button>
            {installations.length > 0 &&
              pick(
                "Installation",
                installation,
                (v) => {
                  setInstallation(v);
                  setRepos([]);
                  setSelected([]);
                  void run(async () => {
                    const result = await hubRequest<{
                      repositories: typeof repos;
                    }>(`${root}/repositories?installation=${v}`);
                    setRepos(result.repositories);
                    setSelected(
                      value?.repositories.map((r) => r.repository_id) ?? [],
                    );
                  });
                },
                installations.map((i) => ({
                  value: String(i.id),
                  label: i.account.login,
                })),
              )}
            {repos.map((r) => (
              <Label key={r.id} className="flex min-w-0 gap-2">
                <Checkbox
                  checked={selected.includes(r.id)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    setSelected((ids) =>
                      checked
                        ? [...ids, r.id]
                        : ids.filter((id) => id !== r.id),
                    )
                  }
                />
                <span className="break-all">{r.full_name}</span>
              </Label>
            ))}
            {installation && (
              <Button
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    await hubRequest(`${root}/selection`, "POST", {
                      installation: Number(installation),
                      repositoryIds: selected,
                    });
                    setNotice("Your repository selection is saved.");
                  })
                }
              >
                Save repositories
              </Button>
            )}
          </>
        )}
        {!value?.repositories.length && (
          <p className="text-sm text-muted-foreground">
            Ask your administrator to select repositories for your workspaces.
          </p>
        )}
        {!!value?.repositories.length && (
          <>
            {pick(
              "Workspace",
              workspace,
              (v) => {
                setWorkspace(v);
                const policy = value.monitoring.find(
                  (p) => p.workspace_id === v && p.pull_number === 0,
                );
                setAgent(policy?.agent_id ?? "");
                setPull("0");
              },
              value.repositories.map((r) => ({
                value: r.workspace_id,
                label: r.full_name,
              })),
            )}
            {workspace && canManage && (
              <>
                <h3 className="font-medium">Pull request monitoring</h3>
                <p className="text-sm text-muted-foreground">
                  Choose an agent before enabling mentions, and use zero for
                  every pull request in this workspace.
                </p>
                <Input
                  aria-label="Monitor pull request number"
                  type="number"
                  min="0"
                  value={pull}
                  onChange={(e) => setPull(e.target.value)}
                  disabled={disabled}
                />
                {pick(
                  "Agent",
                  agent,
                  setAgent,
                  (agents?.agents ?? [])
                    .filter((a) => a.fields.scope !== "personal")
                    .map((a) => ({
                      value: a.id,
                      label: a.fields.name ?? "Agent",
                    })),
                )}
                {Number(pull) > 0 && (
                  <Button
                    variant="outline"
                    disabled={disabled}
                    onClick={() =>
                      void run(async () => {
                        await hubRequest(`${root}/monitoring`, "POST", {
                          workspaceId: workspace,
                          pullNumber: Number(pull),
                          inherit: true,
                        });
                        setNotice(
                          "This pull request uses your workspace default.",
                        );
                      })
                    }
                  >
                    Use workspace default
                  </Button>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={disabled || !agent}
                    onClick={() =>
                      void run(async () => {
                        await hubRequest(`${root}/monitoring`, "POST", {
                          workspaceId: workspace,
                          pullNumber: Number(pull),
                          enabled: true,
                          agentId: agent,
                        });
                        setNotice("Pull request monitoring is on.");
                      })
                    }
                  >
                    Enable monitoring
                  </Button>
                  <Button
                    variant="outline"
                    disabled={disabled}
                    onClick={() =>
                      void run(async () => {
                        await hubRequest(`${root}/monitoring`, "POST", {
                          workspaceId: workspace,
                          pullNumber: Number(pull),
                          enabled: false,
                        });
                        setNotice("Pull request monitoring is off.");
                      })
                    }
                  >
                    Turn off monitoring
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  {value.monitoring
                    .filter((p) => p.workspace_id === workspace)
                    .map(
                      (p) =>
                        `${p.pull_number ? `#${p.pull_number}` : "Workspace"}: ${p.enabled ? "On" : "Off"}`,
                    )
                    .join(" · ") || "Monitoring is off."}
                </p>
              </>
            )}
            {workspace && (
              <>
                <h3 className="font-medium">Act as your GitHub account</h3>
                {pick("Action", action, setAction, [
                  { value: "create", label: "Create pull request" },
                  { value: "comment", label: "Comment" },
                  { value: "review", label: "Review" },
                ])}
                {action === "create" ? (
                  <>
                    <Input
                      aria-label="Pull request title"
                      placeholder="Title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                    <Input
                      aria-label="Head branch"
                      placeholder="Head branch"
                      value={head}
                      onChange={(e) => setHead(e.target.value)}
                    />
                    <Input
                      aria-label="Base branch"
                      placeholder="Base branch"
                      value={base}
                      onChange={(e) => setBase(e.target.value)}
                    />
                  </>
                ) : (
                  <Input
                    aria-label="Pull request number"
                    type="number"
                    min="1"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                  />
                )}{" "}
                {action === "review" &&
                  pick("Review", review, setReview, [
                    { value: "COMMENT", label: "Comment" },
                    { value: "APPROVE", label: "Approve" },
                    { value: "REQUEST_CHANGES", label: "Request changes" },
                  ])}
                <Textarea
                  aria-label="GitHub message"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your message"
                />
                <Button
                  disabled={disabled}
                  onClick={() =>
                    void run(async () => {
                      await hubRequest(`${root}/actions`, "POST", {
                        workspaceId: workspace,
                        action,
                        number: Number(number),
                        title,
                        head,
                        base,
                        body,
                        event: review,
                      });
                      setNotice("Your GitHub action is complete.");
                      setBody("");
                    })
                  }
                >
                  Send to GitHub
                </Button>
              </>
            )}
            {value.activity
              .filter((a) => !workspace || a.workspace_id === workspace)
              .map((a) => (
                <div key={a.id} className="min-w-0 rounded-md border p-3">
                  <p>
                    #{a.pull_number} · {a.summary}
                  </p>
                  {a.thread_id && a.computer_id && (
                    <Button asChild variant="link">
                      <a
                        href={`#/threads/${encodeURIComponent(a.thread_id)}?organization=${encodeURIComponent(organizationId)}&computer=${encodeURIComponent(a.computer_id)}`}
                      >
                        Open thread
                      </a>
                    </Button>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {a.phase === "unmapped"
                      ? "Connect the commenter’s GitHub account to start work."
                      : a.phase === "unavailable"
                        ? "This request could not start; check the agent and computer."
                        : a.phase === "replied"
                          ? "Your agent replied on GitHub."
                          : a.phase === "running"
                            ? "Your agent is working."
                            : "Update received."}
                  </p>
                </div>
              ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
