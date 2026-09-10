import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { watchHubResource } from "@/lib/hub-computers";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";

import type { HostedCodexAccount as Account } from "@remy/contract";

export function HubCodexAccount({
  organizationId,
  workspaceId,
  ready,
}: {
  organizationId: string;
  workspaceId: string;
  ready: boolean;
}) {
  const base = hubThreadBase(organizationId);
  const path = `${base}/hosted/${encodeURIComponent(workspaceId)}/codex`;
  const [account, setAccount] = useState<Account>();
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAccount(undefined);
    setError("");
    if (!ready) return;
    return watchHubResource<Account>(
      path,
      (account, stale) => {
        setAccount(account);
        setStale(stale);
        if (!stale) setError("");
      },
      setError,
      `${base}/computers/live`,
    );
  }, [path, base, ready]);
  const change = async (action: "start" | "cancel" | "logout") => {
    setBusy(true);
    setError("");
    try {
      setAccount(await hubRequest<Account>(`${path}/${action}`, "POST"));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Codex could not connect; try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field>
      <FieldLabel>Codex connection</FieldLabel>
      <FieldDescription>
        Threads on this computer use your connected ChatGPT account.
      </FieldDescription>
      {!ready ? (
        <FieldDescription>
          Start your computer to connect Codex.
        </FieldDescription>
      ) : (
        <>
          {account?.phase === "connected" ? (
            <>
              <p className="text-sm break-words" role="status">
                Connected
                {account.email ? ` as ${account.email}` : " to ChatGPT"}.
              </p>
              <Button
                className="self-start"
                variant="outline"
                disabled={busy || stale}
                onClick={() => void change("logout")}
              >
                Disconnect Codex
              </Button>
            </>
          ) : account?.phase === "pending" ? (
            <>
              <FieldDescription>
                Enter this code on OpenAI’s sign-in page.
              </FieldDescription>
              <Input
                aria-label="Codex sign-in code"
                readOnly
                value={account.userCode ?? ""}
              />
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <a
                    href={account.verificationUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-link
                  >
                    Open sign-in page
                  </a>
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || stale}
                  onClick={() => void change("cancel")}
                >
                  Cancel sign-in
                </Button>
              </div>
              <p role="status" className="text-sm text-muted-foreground">
                Waiting for you to sign in…
              </p>
            </>
          ) : (
            <>
              <Button
                className="self-start"
                disabled={busy || stale}
                onClick={() => void change("start")}
              >
                {busy ? "Connecting…" : "Connect Codex"}
              </Button>
              <FieldDescription>
                {account?.apiKeyConfigured
                  ? "You use your OpenAI API key until you connect ChatGPT."
                  : "Use your ChatGPT account or add an OpenAI API key in your defaults."}
              </FieldDescription>
            </>
          )}
          {stale && (
            <p role="status" className="text-sm text-muted-foreground">
              Reconnecting to your computer…
            </p>
          )}
        </>
      )}
      {(error || account?.error) && (
        <Alert variant="destructive">
          <AlertDescription>{error || account?.error}</AlertDescription>
        </Alert>
      )}
    </Field>
  );
}
