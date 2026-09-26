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

import type { HostedCodexAccount as Account } from "@remy/contract";

export function HubCodexAccount({
  organizationId,
  computerId,
}: {
  organizationId: string;
  computerId: string;
}) {
  const path = `/computers/${encodeURIComponent(computerId)}/codex`;
  const resource = useHubResource<Account>(organizationId, path, "/computers/live");
  const [account, setAccount] = useState<Account>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (resource.value) setAccount(resource.value); }, [resource.value]);
  const current = account ?? resource.value;
  const reconnecting = resource.stale && !resource.error;
  const change = async (action: "start" | "cancel" | "logout") => {
    setBusy(true);
    try {
      setAccount(await hubRequest<Account>(`${hubThreadBase(organizationId)}${path}/${action}`, "POST"));
    } catch (error) {
      toast.error("Couldn’t connect Codex", { description: apiError(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field>
      <FieldDescription>This computer uses your connected ChatGPT account.</FieldDescription>
      {current?.phase === "connected" ? (
        <>
          <p className="text-sm break-words" role="status">
            Connected{current.email ? ` as ${current.email}` : " to ChatGPT"}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || reconnecting} onClick={() => void change("logout")}>
              {busy && <Spinner data-icon="inline-start" />}
              Disconnect Codex
            </Button>
          </div>
        </>
      ) : current?.phase === "pending" ? (
        <>
          <FieldDescription>Enter this code on OpenAI’s sign-in page.</FieldDescription>
          <Input aria-label="Codex sign-in code" readOnly value={current.userCode ?? ""} />
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={current.verificationUrl} target="_blank" rel="noreferrer" data-link>
                Open sign-in page
              </a>
            </Button>
            <Button variant="outline" disabled={busy || reconnecting} onClick={() => void change("cancel")}>
              Cancel sign-in
            </Button>
          </div>
          <p role="status" className="text-sm text-muted-foreground">
            Waiting for you to sign in…
          </p>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || reconnecting} onClick={() => void change("start")}>
            {busy && <Spinner data-icon="inline-start" />}
            Connect Codex
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
