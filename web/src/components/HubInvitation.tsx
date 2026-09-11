import { useEffect, useState } from "react";
import { hubRequest } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type Preview = {
  organizationName: string;
  inviterName: string;
  role: string;
  accountName: string;
};

export function HubInvitation({
  token,
  close,
  accepted,
}: {
  token: string;
  close: () => void;
  accepted: (id: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPreview(undefined);
    setError("");
    void hubRequest<Preview>("/api/invitations/preview", "POST", { token })
      .then((value) => {
        if (!cancelled) setPreview(value);
      })
      .catch((e) => {
        if (!cancelled) setError(apiError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [token, retry]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {preview
              ? `Join ${preview.organizationName}`
              : "Review your invitation"}
          </DialogTitle>
          <DialogDescription>
            {preview
              ? `${preview.inviterName} invites you to join as ${preview.role === "admin" ? "an administrator" : "a member"}.`
              : "Check your invitation before joining an organization."}
          </DialogDescription>
        </DialogHeader>
        {preview && (
          <p className="text-sm">You’re joining as {preview.accountName}.</p>
        )}
        {!preview && !error && <p role="status">Loading your invitation…</p>}
        {error && (
          <p role="alert">
            {error} Ask your inviter for a new link if this invitation has
            expired.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          {!preview && error && (
            <Button
              variant="outline"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry invitation
            </Button>
          )}
          <Button
            disabled={!preview || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await hubRequest<{ organizationId: string }>(
                  "/api/invitations/accept",
                  "POST",
                  { token },
                );
                await accepted(result.organizationId);
              } catch (e) {
                setError(apiError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner data-icon="inline-start" />}Accept invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
