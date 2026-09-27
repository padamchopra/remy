import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { hubRequest } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
import { toast } from "sonner";

import type { ChatGPTAccount as Account } from "@remy/contract";

const PATH = "/api/chatgpt-account";
/// The hub polls OpenAI at Codex's own interval; this only asks it how that went.
const PENDING_POLL_MS = 3000;

/// Your own ChatGPT sign-in for cloud Codex. The hub holds it; this page only
/// ever sees whether you are signed in, and the one-time code while you are.
export function HubChatGPTAccount() {
  const [account, setAccount] = useState<Account>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = account?.phase === "pending";
  useEffect(() => {
    let cancelled = false;
    const read = () => hubRequest<Account>(PATH)
      .then((next) => { if (!cancelled) { setAccount(next); setError(""); } })
      .catch((cause) => { if (!cancelled) setError(apiError(cause)); });
    void read();
    if (!pending) return () => { cancelled = true; };
    const timer = setInterval(() => void read(), PENDING_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pending]);
  const change = async (action: "start" | "cancel" | "logout") => {
    setBusy(true);
    try {
      setAccount(await hubRequest<Account>(`${PATH}/${action}`, "POST"));
    } catch (cause) {
      toast.error("Couldn’t connect Codex", { description: apiError(cause) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field>
      <FieldDescription>Cloud Codex threads you start use your ChatGPT plan.</FieldDescription>
      {account?.phase === "connected" ? (
        <>
          <p className="text-sm break-words" role="status">
            Connected{account.email ? ` as ${account.email}` : " to ChatGPT"}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void change("logout")}>
              {busy && <Spinner data-icon="inline-start" />}
              Disconnect Codex
            </Button>
          </div>
        </>
      ) : pending ? (
        <>
          <FieldDescription>Enter this code on OpenAI’s sign-in page.</FieldDescription>
          <Input aria-label="Codex sign-in code" readOnly value={account.userCode ?? ""} />
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={account.verificationUrl} target="_blank" rel="noreferrer" data-link>
                Open sign-in page
              </a>
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void change("cancel")}>
              Cancel sign-in
            </Button>
          </div>
          <p role="status" className="text-sm text-muted-foreground">Waiting for you to sign in…</p>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !account} onClick={() => void change("start")}>
            {busy && <Spinner data-icon="inline-start" />}
            Connect Codex
          </Button>
        </div>
      )}
      {(account?.error || error) && (
        <Alert variant="destructive">
          <AlertDescription>{account?.error || error}</AlertDescription>
        </Alert>
      )}
    </Field>
  );
}
