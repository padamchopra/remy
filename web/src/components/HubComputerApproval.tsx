import { useState } from "react";
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

export function HubComputerApproval({
  code,
  accountName,
  close,
}: {
  code: string;
  accountName: string;
  close: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
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
            {approved ? "Return to your Mac" : "Approve your computer"}
          </DialogTitle>
          <DialogDescription>
            {approved
              ? "Choose your account in Remy on your Mac, then finish connecting."
              : `Approve only if this code matches the one in Remy on your Mac; you’re signed in as ${accountName}.`}
          </DialogDescription>
        </DialogHeader>
        {!approved && (
          <p
            className="text-center font-mono text-2xl"
            aria-label="Computer authorization code"
          >
            {code}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={close}>
            {approved ? "Done" : "Cancel"}
          </Button>
          {!approved && (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await hubRequest("/api/device/approve", "POST", {
                    userCode: code,
                  });
                  setApproved(true);
                } catch (e) {
                  setError(apiError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Spinner data-icon="inline-start" />}Approve computer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
