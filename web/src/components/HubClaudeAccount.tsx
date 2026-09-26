import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
import { toast } from "sonner";

import type { HostedClaudeAccount as Account } from "@remy/contract";

export function HubClaudeAccount({
  organizationId,
  computerId,
}: {
  organizationId: string;
  computerId: string;
}) {
  const path = `/computers/${encodeURIComponent(computerId)}/claude-account`;
  const resource = useHubResource<Account>(organizationId, path, "/computers/live");
  const [account, setAccount] = useState<Account>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (resource.value) setAccount(resource.value); }, [resource.value]);
  const current = account ?? resource.value;
  const reconnecting = resource.stale && !resource.error;
  const change = async (action: "start" | "complete" | "cancel" | "logout", body?: { code: string }) => {
    setBusy(true);
    try {
      const next = await hubRequest<Account>(`${hubThreadBase(organizationId)}${path}/${action}`, "POST", body);
      setAccount(next);
      if (action === "complete") setCode("");
    } catch (error) {
      toast.error("Couldn’t connect Claude Code", { description: apiError(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field>
      <FieldDescription>This computer uses your connected Claude account.</FieldDescription>
      {current?.phase === "connected" ? (
        <>
          <p className="text-sm break-words" role="status">
            Connected{current.subscription ? ` with ${current.subscription}` : " to Claude"}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || reconnecting} onClick={() => void change("logout")}>
              {busy && <Spinner data-icon="inline-start" />}
              Disconnect Claude Code
            </Button>
          </div>
        </>
      ) : current?.phase === "pending" ? (
        <>
          <FieldDescription>Approve access in Claude, then paste the code it shows you.</FieldDescription>
          <Input aria-label="Claude Code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" />
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={current.verificationUrl} target="_blank" rel="noreferrer" data-link>
                Open Claude
              </a>
            </Button>
            <Button disabled={busy || reconnecting || !code.trim()} onClick={() => void change("complete", { code })}>
              {busy && <Spinner data-icon="inline-start" />}
              Finish connecting
            </Button>
            <Button variant="outline" className="w-auto" disabled={busy || reconnecting} onClick={() => void change("cancel")}>
              Cancel sign-in
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || reconnecting} onClick={() => void change("start")}>
            {busy && <Spinner data-icon="inline-start" />}
            Connect Claude Code
          </Button>
        </div>
      )}
      {(current?.error || resource.error) && (
        <Alert variant="destructive">
          <AlertDescription>{current?.error || resource.error}</AlertDescription>
        </Alert>
      )}
    </Field>
  );
}
