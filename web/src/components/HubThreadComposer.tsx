import { useEffect, useRef, useState } from "react";
import type { ComputerSummary } from "@remy/contract";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useHubResource } from "@/lib/hub-organization";
import { formatLocation } from "@/lib/route";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hubRequest, hubThreadPath, hubThreadBase } from "@/lib/hub-threads";
export function HubThreadComposer({
  organizationId,
  computers,
  canManageWorkspaces,
  open,
}: {
  organizationId: string;
  computers: ComputerSummary[];
  canManageWorkspaces: boolean;
  open: (computer: string, thread: string) => void;
}) {
  const created = useRef<{
    id: string;
    computerId: string;
    message: string;
  } | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const catalogue = useHubResource<{
    workspaces: { id: string; name: string; origin: string }[];
  }>(organizationId, "/workspaces");
  const workspaces = catalogue.value?.workspaces ?? [];
  const go = (name: "workspaces" | "settings") => {
    window.location.hash = formatLocation({
      route:
        name === "settings"
          ? { name, tab: "devices", organizationId }
          : { name, organizationId },
    });
  };
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const base = hubThreadBase(organizationId),
    [workspaceId, setWorkspace] = useState(""),
    [selected, select] = useState("automatic"),
    [preferenceLoaded, setPreferenceLoaded] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (catalogue.value)
      setWorkspace((id) =>
        catalogue.value!.workspaces.some((w) => w.id === id)
          ? id
          : (catalogue.value!.workspaces[0]?.id ?? ""),
      );
  }, [catalogue.value]);
  useEffect(() => {
    let cancelled = false;
    setPreferenceLoaded(false);
    if (workspaceId)
      void hubRequest<{ computerId: string | null }>(
        `${base}/routing/preference?workspaceId=${encodeURIComponent(workspaceId)}`,
      )
        .then((value) => {
          if (!cancelled) {
            select(value.computerId ?? "automatic");
            setPreferenceLoaded(true);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, base]);
  useEffect(() => {
    setRequestId(crypto.randomUUID());
    created.current = null;
    setError("");
  }, [workspaceId, organizationId]);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const eligible = computers.filter(
    (c) =>
      c.ownership !== "hosted" &&
      c.canUse &&
      c.availability !== "offline" &&
      !c.updateRequired &&
      c.capabilities.workspaces.some(
        (w) => w.id === workspaceId || w.origin === workspace?.origin,
      ),
  );
  if (!catalogue.value)
    return catalogue.error ? (
      <p role="alert">{catalogue.error}</p>
    ) : (
      <Skeleton
        className="h-48 w-full max-w-xl"
        aria-label="Loading workspaces"
      />
    );
  if (!workspaces.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {canManageWorkspaces
              ? "Add your first workspace"
              : "No workspaces available"}
          </EmptyTitle>
          <EmptyDescription>
            {canManageWorkspaces
              ? "Choose a repository, connect a computer, then send your first request."
              : "Ask an organization administrator to add a workspace or give you access."}
          </EmptyDescription>
        </EmptyHeader>
        {canManageWorkspaces && (
          <Button data-link onClick={() => go("workspaces")}>
            Add a workspace
          </Button>
        )}
        <Button variant="link" data-link onClick={() => go("settings")}>
          Set up a computer
        </Button>
      </Empty>
    );
  return (
    <form
      className="flex w-full max-w-xl flex-col gap-3 rounded-lg border p-4"
      aria-label="New thread"
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          !workspace ||
          busy ||
          !preferenceLoaded ||
          !message.trim() ||
          catalogue.stale
        )
          return;
        setBusy(true);
        setError("");
        try {
          const firstMessage = created.current?.message ?? message.trim();
          const title = firstMessage.slice(0, 200);
          if (!created.current) {
            let choice: {
              computerId?: string;
              workspaceId?: string;
              reason?: string;
              hostedWorkspaceId?: string;
            } = {};
            if (selected !== "automatic") {
              const c = eligible.find((c) => c.computerId === selected);
              if (!c) throw Error("Choose another computer to continue.");
              choice = {
                computerId: c.computerId,
                workspaceId: c.capabilities.workspaces.find(
                  (w) => w.id === workspaceId || w.origin === workspace.origin,
                )!.id,
              };
            } else {
              const thread = await hubRequest<{
                id: string;
                computerId: string;
              }>(`${base}/threads`, "POST", {
                workspaceId,
                title: title.trim(),
                requestId,
              });
              created.current = { ...thread, message: firstMessage };
            }
            if (!created.current) {
              if (!choice.computerId || !choice.workspaceId)
                throw Error(choice.reason ?? "Choose another computer.");
              const thread = await hubRequest<{ id: string }>(
                hubThreadPath(organizationId, choice.computerId),
                "POST",
                {
                  workspaceId: choice.workspaceId,
                  ...(title.trim() ? { title: title.trim() } : {}),
                },
              );
              created.current = {
                id: thread.id,
                computerId: choice.computerId,
                message: firstMessage,
              };
            }
          }
          const current = created.current!;
          await hubRequest(
            `${hubThreadPath(organizationId, current.computerId, current.id)}/message`,
            "POST",
            {
              text: current.message,
              messageId: `u-${requestId}`,
              attachmentIds: [],
            },
          );
          open(current.computerId, current.id);
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "This thread could not start.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="hub-thread-message">
            What would you like to work on?
          </FieldLabel>
          <Textarea
            id="hub-thread-message"
            maxLength={64000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            disabled={busy || !!created.current}
            placeholder="Describe a change or ask a question about your code."
          />
        </Field>
        <Field>
          <FieldLabel>Workspace</FieldLabel>
          <Select
            value={workspaceId}
            disabled={busy || !!created.current}
            onValueChange={(v) => {
              if (!v) return;
              setWorkspace(v);
              select("automatic");
            }}
          >
            <SelectTrigger aria-label="Thread workspace">
              <SelectValue placeholder="Choose a workspace" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Collapsible open={optionsOpen} onOpenChange={setOptionsOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost">
              Choose a computer
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <Field>
              <FieldLabel>Computer</FieldLabel>
              <Select
                value={selected}
                disabled={busy || !!created.current || !preferenceLoaded}
                onValueChange={async (v) => {
                  if (!v) return;
                  const previous = selected;
                  select(v);
                  setPreferenceLoaded(false);
                  setError("");
                  try {
                    await hubRequest(`${base}/routing/preference`, "POST", {
                      workspaceId,
                      computerId: v === "automatic" ? null : v,
                    });
                  } catch (e) {
                    select(previous);
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Your computer choice could not be saved.",
                    );
                  } finally {
                    setPreferenceLoaded(true);
                  }
                }}
              >
                <SelectTrigger aria-label="Thread computer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="automatic">
                      Choose automatically
                    </SelectItem>
                    {selected !== "automatic" &&
                      !eligible.some((c) => c.computerId === selected) && (
                        <SelectItem value={selected} disabled>
                          {computers.find((c) => c.computerId === selected)
                            ?.name ?? "Saved computer"}{" "}
                          (unavailable)
                        </SelectItem>
                      )}
                    {eligible.map((c) => (
                      <SelectItem key={c.computerId} value={c.computerId}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <p className="text-muted-foreground text-sm">
              Your computer choice is remembered for this workspace.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </FieldGroup>
      {!computers.some((c) => c.canUse && c.availability !== "offline") && (
        <p className="text-sm text-muted-foreground">
          Your request needs a connected Mac or configured cloud execution.
        </p>
      )}
      <Button
        type="button"
        variant="link"
        data-link
        onClick={() => go("settings")}
      >
        Set up a computer
      </Button>
      {catalogue.stale && (
        <p role="status">
          Reconnect to refresh your workspaces before starting a thread.
        </p>
      )}
      {busy && <p role="status">Preparing your thread…</p>}
      {error && <p role="alert">{error}</p>}
      <Button
        type="submit"
        disabled={
          busy ||
          !workspace ||
          !preferenceLoaded ||
          !message.trim() ||
          catalogue.stale
        }
      >
        {created.current ? "Retry sending request" : "Start thread"}
      </Button>
      {created.current && !busy && (
        <Button
          type="button"
          variant="outline"
          onClick={() => open(created.current!.computerId, created.current!.id)}
        >
          Open created thread
        </Button>
      )}
    </form>
  );
}
