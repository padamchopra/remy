import { useEffect, useState } from "react";
import type { ComputerSummary } from "@remy/contract";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hubRequest, hubThreadPath, hubThreadBase } from "@/lib/hub-threads";
export function HubThreadComposer({
  organizationId,
  computers,
  open,
}: {
  organizationId: string;
  computers: ComputerSummary[];
  open: (computer: string, thread: string) => void;
}) {
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  const base = hubThreadBase(organizationId),
    [workspaces, setWorkspaces] = useState<
      { id: string; name: string; origin: string }[]
    >([]),
    [workspaceId, setWorkspace] = useState(""),
    [selected, select] = useState("automatic"),
    [preferenceLoaded, setPreferenceLoaded] = useState(false),
    [title, setTitle] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void hubRequest<{ workspaces: typeof workspaces }>(`${base}/workspaces`)
      .then((r) => {
        setWorkspaces(r.workspaces);
        setWorkspace(r.workspaces[0]?.id ?? "");
      })
      .catch((e) => setError(e.message));
  }, [base]);
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
  useEffect(()=>setRequestId(crypto.randomUUID()),[workspaceId,organizationId]);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const eligible = computers.filter(
    (c) =>
      c.ownership !== "hosted" && c.canUse &&
      c.availability !== "offline" &&
      !c.updateRequired &&
      c.capabilities.workspaces.some(
        (w) => w.id === workspaceId || w.origin === workspace?.origin,
      ),
  );
  return (
    <form
      className="flex w-full max-w-xl flex-col gap-3 rounded-lg border p-4"
      aria-label="New thread"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!workspace || busy || !preferenceLoaded) return;
        setBusy(true);
        setError("");
        try {
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
            const thread = await hubRequest<{id:string;computerId:string}>(`${base}/threads`, "POST", {workspaceId, title:title.trim(), requestId});
            open(thread.computerId, thread.id);
            return;
          }
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
          open(choice.computerId, thread.id);
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "This thread could not start.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor="hub-thread-title">Thread name</FieldLabel>
        <Input
          id="hub-thread-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What are you working on?"
          maxLength={200}
          disabled={busy}
        />
      </Field>
      <Field>
        <FieldLabel>Workspace</FieldLabel>
        <Select
          value={workspaceId}
          disabled={busy}
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
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel>Computer</FieldLabel>
        <Select
          value={selected}
          disabled={busy || !preferenceLoaded}
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
            <SelectItem value="automatic">Use routing rules</SelectItem>
            {selected !== "automatic" &&
              !eligible.some((c) => c.computerId === selected) && (
                <SelectItem value={selected} disabled>
                  {computers.find((c) => c.computerId === selected)?.name ??
                    "Saved computer"}{" "}
                  (unavailable)
                </SelectItem>
              )}
            {eligible.map((c) => (
              <SelectItem key={c.computerId} value={c.computerId}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <p className="text-muted-foreground text-sm">
        Your computer choice is remembered for this workspace.
      </p>
      {busy && <p role="status">Preparing your thread…</p>}
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={busy || !workspace || !preferenceLoaded}>
        Start thread
      </Button>
    </form>
  );
}
