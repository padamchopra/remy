import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PathPicker, PathPickerHints } from "@/components/PathPicker";
import { deviceIcon } from "@/lib/devices";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStore } from "@/state/store";

export function AddWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addWorkspace = useStore((s) => s.addWorkspace);
  const servers = useStore((s) => s.servers);
  const devices = useMemo(
    () => servers.filter((server) => server.online && !server.workspaceOnly),
    [servers],
  );
  const [path, setPath] = useState("~/");
  const [serverId, setServerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setPath("~/");
    setBusy(false);
    setError(undefined);
  }, [open]);

  useEffect(() => {
    if (!open || devices.some((device) => device.id === serverId)) return;
    setServerId(
      devices.find((server) => server.local)?.id
        ?? devices[0]?.id
        ?? "",
    );
  }, [open, devices, serverId]);


  const submit = async (value = path) => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await addWorkspace({ path: trimmed, serverId });
      toast.success("Added the workspace.");
      onOpenChange(false);
    } catch (caught) {
      const message = apiError(caught);
      setError(message);
      toast.error("Couldn't add that folder", { description: message });
    } finally {
      setBusy(false);
    }
  };



  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 p-0 sm:max-w-[520px]" showCloseButton>
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Add workspace</DialogTitle>
          <DialogDescription>
            {devices.length > 1 ? "Pick a folder on a connected device." : `Pick a folder on ${devices[0]?.name ?? "this machine"}.`}
          </DialogDescription>
        </DialogHeader>
        {devices.length > 1 && (
          <div className="px-6">
            <Select
              value={serverId}
              onValueChange={(next) => {
                setServerId(next);
                setPath("~/");
                setError(undefined);
              }}
            >
              <SelectTrigger className="w-full" aria-label="Device">
                <SelectValue placeholder="Choose a device" />
              </SelectTrigger>
              <SelectContent>
                {devices.map((server) => {
                  const DeviceIcon = deviceIcon(server.icon);
                  return (
                    <SelectItem key={server.id} value={server.id}>
                      <DeviceIcon />
                      {server.name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        )}
        <PathPicker
          value={path}
          onChange={(next) => {
            setPath(next);
            setError(undefined);
          }}
          onSubmit={(next) => void submit(next)}
          serverId={serverId}
          autoFocus
        />
        {error && <p className="px-6 text-[13px] text-destructive">{error}</p>}
        <DialogFooter className="border-t border-border bg-muted px-4 py-2 sm:justify-between">
          <PathPickerHints confirm="Add" />
          <Button size="sm" disabled={busy || !path.trim()} onClick={() => void submit()}>
            {busy ? "Adding…" : "Add workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function apiError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // The transport already unwrapped some failures into a plain string.
  }
  return raw;
}
