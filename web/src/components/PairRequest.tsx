import { useState } from "react";
import { Laptop } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiError } from "@/lib/api-error";
import { transport } from "@/lib/transport";
import { useStore } from "@/state/store";
import { formatPairCode } from "@/lib/pairing";

/// Another machine asking to pair with this one.
///
/// It appears wherever you are rather than only in Settings, because the machine
/// asking is sitting there waiting on you, and a prompt you have to go looking
/// for is one you will miss.
///
/// The code is the whole check: the machine that asked shows the same six
/// digits. If they do not match, this is not the request you started.
export function PairRequestDialog() {
  const requests = useStore((s) => s.pairRequests);
  const homeId = useStore((s) => s.servers.find((server) => server.local)?.id ?? s.servers[0]?.id);
  const loadPairRequests = useStore((s) => s.loadPairRequests);
  const refresh = useStore((s) => s.refresh);
  const [busy, setBusy] = useState(false);

  const request = requests[0];
  if (!request || !homeId) return null;

  const decide = async (decision: "approve" | "deny") => {
    setBusy(true);
    try {
      await transport.request(homeId, `/pair/pending/${encodeURIComponent(request.id)}/${decision}`, {
        method: "POST",
      });
      if (decision === "approve") {
        toast.success(`Pairing with ${request.fromName}.`);
        // Their half lands when they collect the token; ours follows on the
        // announcement they send straight back.
        window.setTimeout(() => void refresh(), 2_000);
      }
    } catch (caught) {
      toast.error("Couldn't answer that request", { description: apiError(caught) });
    } finally {
      setBusy(false);
      await loadPairRequests({ fresh: true });
    }
  };

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Laptop className="size-4 text-muted-foreground" />
            {request.fromName} wants to pair
          </AlertDialogTitle>
          <AlertDialogDescription>
            Allow it and the two machines share their boards, and can send each other
            notifications. Only allow it if this code matches the one on that machine.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-lg border border-border bg-muted/40 py-4 text-center">
          <span className="font-mono text-3xl tracking-[0.2em] tabular-nums">
            {formatPairCode(request.code)}
          </span>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={() => void decide("deny")}>
            Deny
          </AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={() => void decide("approve")}>
            Allow
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
