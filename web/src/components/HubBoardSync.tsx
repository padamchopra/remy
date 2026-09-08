import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { transport } from "@/lib/transport";
import { apiError } from "@/lib/api-error";

type State = {
  enabled: boolean;
  imported: boolean;
  lastSyncAt?: number;
  error?: string;
};
export function HubBoardSync({
  organizationId,
  computerId,
  localId,
}: {
  organizationId: string;
  computerId: string;
  localId: string;
}) {
  const [state, setState] = useState<State>();
  const [open, setOpen] = useState(false);
  const [importExisting, setImportExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    const refresh = () =>
      void transport
        .request<State>(localId, "/server/hub/board")
        .then((value) => {
          if (!stopped) setState(value);
        })
        .catch((e) => {
          if (!stopped) setError(apiError(e));
        });
    refresh();
    const off = transport.subscribe(
      (id, value) => {
        const frame = value as { type?: string; organizationId?: string };
        if (
          id === localId &&
          (frame.type === "reset" ||
            (frame.type === "hub-board" &&
              frame.organizationId === organizationId))
        )
          refresh();
      },
      ["settings"],
    );
    const status = transport.onStatus((id, online) => {
      if (id === localId && online) refresh();
    });
    return () => {
      stopped = true;
      off();
      status();
    };
  }, [localId, organizationId]);
  const save = async (enabled: boolean) => {
    setBusy(true);
    setError("");
    try {
      await hubRequest(
        `${hubThreadBase(organizationId)}/computers/${encodeURIComponent(computerId)}/board-access`,
        enabled ? "PUT" : "DELETE",
      );
      setState(
        await transport.request<State>(localId, "/server/hub/board", {
          method: "PUT",
          body: { enabled, importExisting: enabled && importExisting },
        }),
      );
      setOpen(false);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field className="min-w-0">
      <FieldLabel>Shared Tasks on this computer</FieldLabel>
      <FieldDescription>
        {state?.enabled
          ? "Your organization’s Tasks remain readable when this computer is offline."
          : "Keep your organization’s Tasks available on this computer."}
      </FieldDescription>
      {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
      <Button
        variant="outline"
        className="h-auto min-h-9 whitespace-normal break-words"
        disabled={busy || !state}
        onClick={() => (state?.enabled ? void save(false) : setOpen(true))}
      >
        {state?.enabled ? "Stop synchronizing Tasks" : "Synchronize Tasks"}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Synchronize shared Tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This computer keeps a copy of your organization’s tickets, agents,
              memories, and routines.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!state?.imported && (
            <Field orientation="horizontal">
              <Checkbox
                id="import-board"
                checked={importExisting}
                onCheckedChange={(v) => setImportExisting(v === true)}
              />
              <FieldLabel htmlFor="import-board">
                Also share your existing local tickets, agents, memories, and
                routines
              </FieldLabel>
            </Field>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void save(true);
              }}
            >
              Synchronize Tasks
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Field>
  );
}
