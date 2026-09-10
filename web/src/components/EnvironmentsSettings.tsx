import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { watchHubResource } from "@/lib/hub-computers";
import { transport } from "@/lib/transport";
import { useStore } from "@/state/store";
type Profile = { id: string; name: string; variables: { name: string }[] };
type Data = {
  environments: Profile[];
  assignments: { projectId: string; environmentId: string }[];
  workspaces: { id: string; name: string }[];
};
export function EnvironmentsSettings({
  organizationId,
}: {
  organizationId?: string;
}) {
  const servers = useStore((s) => s.servers);
  const computer =
    servers.find((s) => s.local) ?? servers.find((s) => !s.cloud);
  const base = organizationId
    ? `${hubThreadBase(organizationId)}/environments`
    : "/environments";
  const [data, setData] = useState<Data>({
    environments: [],
    assignments: [],
    workspaces: [],
  });
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [variable, setVariable] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const request = useCallback(
    async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
      if (organizationId) return hubRequest<T>(base + path, method, body);
      if (!computer)
        throw Error("Connect your computer to manage environments.");
      return transport.request<T>(computer.id, base + path, { method, body });
    },
    [base, organizationId, computer?.id],
  );
  const load = useCallback(
    async () => setData(await request<Data>("")),
    [request],
  );
  useEffect(() => {
    if (organizationId)
      return watchHubResource<Data>(
        base,
        (data, stale) => {
          if (data) setData(data);
          setStale(stale);
        },
        setError,
        `${hubThreadBase(organizationId)}/computers/live`,
      );
    void load().catch((e) => setError(e.message));
    return transport.subscribe(
      () => void load().catch((e) => setError(e.message)),
      ["settings", "board"],
    );
  }, [base, organizationId, load]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your environment could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const profile = data.environments.find((e) => e.id === selected);
  const disabled = busy || stale;
  const managed = !!profile?.id.startsWith("hub:") && !organizationId;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <FieldDescription>
        Define values once and assign them to your workspaces; tasks use them on
        local and cloud computers.
      </FieldDescription>
      <Card>
        <CardHeader>
          <CardTitle>Environments</CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const result = await request<{ environment: Profile }>(
                  "",
                  "POST",
                  { name },
                );
                setSelected(result.environment.id);
                setName("");
              });
            }}
          >
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="new-environment">
                Environment name
              </FieldLabel>
              <Input
                id="new-environment"
                placeholder="Development"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Button disabled={disabled || !name.trim()}>Add environment</Button>
          </form>
          <Field>
            <FieldLabel>Environment</FieldLabel>
            <Select
              value={selected}
              onValueChange={(id) => {
                setSelected(id);
                setVariable("");
                setValue("");
              }}
              disabled={disabled}
            >
              <SelectTrigger aria-label="Environment">
                <SelectValue placeholder="Choose an environment" />
              </SelectTrigger>
              <SelectContent>
                {data.environments.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {profile && (
            <>
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await request(`/${profile.id}`, "PATCH", {
                      values: { [variable]: value },
                    });
                    setVariable("");
                    setValue("");
                  });
                }}
              >
                <Field>
                  <FieldLabel htmlFor="variable-name">Variable name</FieldLabel>
                  <Input
                    id="variable-name"
                    value={variable}
                    onChange={(e) => setVariable(e.target.value)}
                    placeholder="DATABASE_URL"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="variable-value">Value</FieldLabel>
                  <Input
                    id="variable-value"
                    type="password"
                    autoComplete="new-password"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </Field>
                <Button
                  className="self-start"
                  disabled={disabled || managed || !variable.trim()}
                >
                  Save value
                </Button>
              </form>
              <FieldDescription>
                {managed
                  ? "Manage this environment in your organization settings."
                  : "Your stored values stay hidden; tasks and their commands can use them."}
              </FieldDescription>
              <ul className="flex min-w-0 flex-col gap-2">
                {profile.variables.map((v) => (
                  <li key={v.name} className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 break-words text-sm">
                      {v.name}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled || managed}
                      aria-label={`Remove ${v.name}`}
                      onClick={() =>
                        void act(() =>
                          request(`/${profile.id}`, "PATCH", {
                            remove: v.name,
                          }),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="self-start"
                    disabled={disabled || managed}
                  >
                    Delete environment
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {profile.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Your workspaces stop using these values on their next
                      turn.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        void act(async () => {
                          await request(`/${profile.id}`, "DELETE");
                          setSelected("");
                        })
                      }
                    >
                      Delete environment
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Workspace environments</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.workspaces.map((w) => (
            <Field key={w.id}>
              <FieldLabel>{w.name}</FieldLabel>
              <Select
                value={
                  data.assignments.find((a) => a.projectId === w.id)
                    ?.environmentId || "none"
                }
                disabled={disabled}
                onValueChange={(id) =>
                  void act(() =>
                    request(`/${w.id}/assign`, "PUT", {
                      environmentId: id === "none" ? "" : id,
                    }),
                  )
                }
              >
                <SelectTrigger aria-label={`Environment for ${w.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No environment</SelectItem>
                  {data.environments.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ))}
          {!data.workspaces.length && (
            <FieldDescription>
              Add a workspace to assign an environment.
            </FieldDescription>
          )}
        </CardContent>
      </Card>
      {(error || stale) && (
        <p role="alert" className="text-sm text-destructive">
          {error || "Reconnecting; wait before changing your environment."}
        </p>
      )}
    </div>
  );
}
