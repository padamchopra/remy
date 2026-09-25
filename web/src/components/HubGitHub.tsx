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
import { formatBrowserLocation } from "@/lib/route";
import { toast } from "sonner";
import { apiError } from "@/lib/api-error";

type GitHubState = {
  repositories: {
    workspace_id: string;
    full_name: string;
    repository_id: number;
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
  const [busy, setBusy] = useState(false),
    [installations, setInstallations] = useState<
      { id: number; account: { login: string } }[]
    >([]),
    [installation, setInstallation] = useState(""),
    [repos, setRepos] = useState<{ id: number; full_name: string }[]>([]),
    [selected, setSelected] = useState<number[]>([]),
    [workspace, setWorkspace] = useState(""),
    [action, setAction] = useState("comment"),
    [number, setNumber] = useState(""),
    [title, setTitle] = useState(""),
    [head, setHead] = useState(""),
    [base, setBase] = useState("main"),
    [body, setBody] = useState(""),
    [review, setReview] = useState("COMMENT");
  const root = `${hubThreadBase(organizationId)}/github`;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      toast.error("Couldn't update GitHub", { description: apiError(e) });
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
        {readError && <p role="alert">{readError}</p>}
        {stale && (
          <p role="status">Reconnect to update your GitHub settings.</p>
        )}
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
                    toast.success("Your repository selection is saved.");
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
              setWorkspace,
              value.repositories.map((r) => ({
                value: r.workspace_id,
                label: r.full_name,
              })),
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
                      toast.success("Your GitHub action is complete.");
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
                        href={formatBrowserLocation({ route: { name: "threads", threadId: a.thread_id, organizationId } })}
                      >
                        Open thread
                      </a>
                    </Button>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {a.phase === "unmapped"
                      ? "Connect the commenter’s GitHub account to follow this."
                      : a.phase === "unavailable"
                        ? "This request could not start; check the computer."
                        : a.phase === "replied"
                          ? "Remy replied on GitHub."
                          : a.phase === "running"
                            ? "A thread is working on this."
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
