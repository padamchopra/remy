import { useState } from "react";
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

export function HubClaudeAccount({ organizationId }: { organizationId: string }) {
  const base = hubThreadBase(organizationId);
  const resource = useHubResource<Account>(organizationId, "/claude-account");
  const [account, setAccount] = useState<Account>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const current = account ?? resource.value;
  const change = async (action: "start" | "complete" | "cancel" | "logout", body?: { code: string }) => {
    setBusy(true);
    try {
      const next = await hubRequest<Account>(`${base}/claude-account/${action}`, "POST", body);
      setAccount(next);
      if (action === "complete") setCode("");
    } catch (error) {
      toast.error("Couldn't connect Claude Code", { description: apiError(error) });
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
          <Button
            className="self-start"
            variant="outline"
            disabled={busy || resource.stale}
            onClick={() => void change("logout")}
          >
            {busy && <Spinner data-icon="inline-start" />}
            Disconnect Claude Code
          </Button>
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
              disabled={busy || resource.stale || !code.trim()}
              onClick={() => void change("complete", { code })}
            >
              {busy && <Spinner data-icon="inline-start" />}
              Finish connecting
            </Button>
            <Button
              variant="outline"
              disabled={busy || resource.stale}
              onClick={() => void change("cancel")}
            >
              Cancel sign-in
            </Button>
          </div>
        </>
      ) : (
        <Button
          className="self-start"
          disabled={busy || resource.stale}
          onClick={() => void change("start")}
        >
          {busy && <Spinner data-icon="inline-start" />}
          Connect Claude Code
        </Button>
      )}
      {resource.stale && (
        <p role="status" className="text-sm text-muted-foreground">
          Reconnecting…
        </p>
      )}
      {(resource.error || current?.error) && (
        <Alert variant="destructive">
          <AlertDescription>{resource.error || current?.error}</AlertDescription>
        </Alert>
      )}
    </Field>
  );
}
