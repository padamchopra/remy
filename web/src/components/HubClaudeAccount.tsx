import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useHubResource } from "@/lib/hub-organization";
import { HubRequestError, hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
import { toast } from "sonner";

import type { HostedClaudeAccount as Account } from "@remy/contract";

export function HubClaudeAccount({
  organizationId,
  listed,
}: {
  organizationId: string;
  listed?: Account;
}) {
  const base = hubThreadBase(organizationId);
  const resource = useHubResource<Account>(organizationId, "/claude-account");
  const [account, setAccount] = useState<Account>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const missing = resource.error === "Not found";
  const current = account ?? resource.value ?? listed;
  const reconnecting = resource.stale && !missing && !resource.error;
  const change = async (action: "start" | "complete" | "cancel" | "logout", body?: { code: string }) => {
    setBusy(true);
    try {
      const next = await hubRequest<Account>(`${base}/claude-account/${action}`, "POST", body);
      setAccount(next);
      if (action === "complete") setCode("");
    } catch (error) {
      const missing = error instanceof HubRequestError && error.status === 404;
      toast.error("Couldn't connect Claude Code", {
        description: missing ? "Update your hosted service to connect Claude Code." : apiError(error),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field>
      <FieldDescription>
        Cloud computers use your connected Claude account.
      </FieldDescription>
      {current?.phase === "connected" ? (
        <>
          <p className="text-sm break-words" role="status">
            Connected{current.subscription ? ` with ${current.subscription}` : " to Claude"}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || reconnecting}
              onClick={() => void change("logout")}
            >
              {busy && <Spinner data-icon="inline-start" />}
              Disconnect Claude Code
            </Button>
          </div>
        </>
      ) : current?.phase === "pending" ? (
        <>
          <FieldDescription>
            Approve access in Claude, then paste the code it shows you.
          </FieldDescription>
          <Input
            aria-label="Claude Code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={current.verificationUrl} target="_blank" rel="noreferrer" data-link>
                Open Claude
              </a>
            </Button>
            <Button
              disabled={busy || reconnecting || !code.trim()}
              onClick={() => void change("complete", { code })}
            >
              {busy && <Spinner data-icon="inline-start" />}
              Finish connecting
            </Button>
            <Button
              variant="outline"
              className="w-auto"
              disabled={busy || reconnecting}
              onClick={() => void change("cancel")}
            >
              Cancel sign-in
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || reconnecting}
            onClick={() => void change("start")}
          >
            {busy && <Spinner data-icon="inline-start" />}
            Connect Claude Code
          </Button>
        </div>
      )}
      {reconnecting && (
        <p role="status" className="text-sm text-muted-foreground">
          Reconnecting…
        </p>
      )}
      {(current?.error || (resource.error && !missing)) && (
        <Alert variant="destructive">
          <AlertDescription>{current?.error || resource.error}</AlertDescription>
        </Alert>
      )}
    </Field>
  );
}
