import { useState } from "react";
import { toast } from "sonner";
import { apiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";

/// A connection key is single-use and short-lived, so it is created on demand
/// rather than shown beside the instructions from the start.
export function HubComputerConnect({ organizationId, ownership }: { organizationId: string; ownership: "personal" | "organization" }) {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const result = await hubRequest<{ key: string }>(`${hubThreadBase(organizationId)}/computers/connection-keys`, "POST", { ownership });
      setCommand(`remy login ${result.key}`);
    } catch (error) {
      toast.error("Couldn’t create a connection key", { description: apiError(error) });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success("Your command is copied.");
    } catch {
      toast.error("Couldn’t copy your command", { description: "Select the command and copy it." });
    }
  };

  return (
    <Field>
      <FieldLabel>Sign a computer in</FieldLabel>
      <FieldDescription>Install the Remy CLI with npm i -g @padamchopra/remy, then run this command on that machine.</FieldDescription>
      {command ? (
        <div className="flex min-w-0 flex-col gap-2">
          <code aria-label="Connection command" className="min-w-0 overflow-x-auto rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs break-all">{command}</code>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void copy()}>Copy command</Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void create()}>New key</Button>
          </div>
          <FieldDescription>This key works once, within fifteen minutes.</FieldDescription>
        </div>
      ) : (
        <Button type="button" className="w-full max-w-sm" disabled={busy} onClick={() => void create()}>
          {busy && <Spinner data-icon="inline-start" />}
          Create a connection key
        </Button>
      )}
    </Field>
  );
}
