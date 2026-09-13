import { useEffect, useState } from "react";
import type { HubNotification } from "@remy/contract";
import { toast } from "sonner";
import { Bell, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemGroup,
} from "@/components/ui/item";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { watchHubResource } from "@/lib/hub-computers";
import { formatLocation } from "@/lib/route";
const announced = new Set<string>();
export function HubNotifications({
  organizationId,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: {
  organizationId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const [items, setItems] = useState<HubNotification[]>([]);
  const [savingDevice, setSavingDevice] = useState<string>();
  const [error, setError] = useState("");
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const key = `remy.hub-notifications.${organizationId}`;
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem(key) !== "off",
  );
  const [devices, setDevices] = useState<
    { id: string; name: string; enabled: number }[]
  >([]);
  const path = `${hubThreadBase(organizationId)}/notifications`;
  const read = async (item: HubNotification) => {
    await hubRequest(`${path}/${item.id}/read`, "POST");
    setOpen(false);
    window.location.hash = formatLocation({
      route: {
        name: "threads",
        organizationId,
        computerId: item.computerId,
        threadId: item.threadId,
      },
    });
  };
  useEffect(() => {
    let loaded = false;
    return watchHubResource<{
      notifications: HubNotification[];
      devices: typeof devices;
    }>(
      path,
      (value) => {
        if (!value) {
          setItems([]);
          setDevices([]);
          return;
        }
        setItems(value.notifications);
        setDevices(value.devices);
        setError("");
        for (const item of value.notifications) {
          const id = `${organizationId}:${item.id}`;
          if (
            loaded &&
            !item.readAt &&
            !announced.has(id) &&
            localStorage.getItem(key) !== "off"
          )
            toast(item.title, {
              description: item.message,
              action: {
                label: "Open thread",
                onClick: () => {
                  void read(item).catch((e) => setError(e.message));
                },
              },
            });
          announced.add(id);
        }
        loaded = true;
      },
      setError,
    );
  }, [path]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger && <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Bell />
          Notifications
          {items.some((item) => !item.readAt)
            ? ` (${items.filter((item) => !item.readAt).length})`
            : ""}
        </Button>
      </DialogTrigger>}
      <DialogContent className="max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Notifications</DialogTitle>
          <DialogDescription>
            Updates from threads you participate in.
          </DialogDescription>
        </DialogHeader>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="hub-alerts">
            Show alerts in this window
          </FieldLabel>
          <Switch
            id="hub-alerts"
            checked={enabled}
            onCheckedChange={(value) => {
              setEnabled(value);
              localStorage.setItem(key, value ? "on" : "off");
            }}
          />
        </Field>
        {devices.map((device) => (
          <Field key={device.id} orientation="horizontal">
            <FieldLabel htmlFor={`push-${device.id}`}>{device.name}</FieldLabel>
            <Switch
              id={`push-${device.id}`}
              checked={!!device.enabled}
              disabled={savingDevice === device.id}
              onCheckedChange={(enabled) => {
                setSavingDevice(device.id);
                setDevices((old) =>
                  old.map((d) =>
                    d.id === device.id ? { ...d, enabled: Number(enabled) } : d,
                  ),
                );
                void hubRequest(`${path}/devices/${device.id}`, "PATCH", {
                  enabled,
                })
                  .then(() =>
                    setDevices((old) =>
                      old.map((d) =>
                        d.id === device.id
                          ? { ...d, enabled: Number(enabled) }
                          : d,
                      ),
                    ),
                  )
                  .catch((e) => {
                    setDevices((old) =>
                      old.map((d) => (d.id === device.id ? device : d)),
                    );
                    setError(e.message);
                  })
                  .finally(() => setSavingDevice(undefined));
              }}
            />
          </Field>
        ))}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Your threads have no updates yet.
          </p>
        )}
        <ItemGroup>
          {items.map((item) => (
            <Item key={item.id}>
              <ItemContent className="min-w-0">
                <ItemTitle className="whitespace-normal break-words">
                  {item.title}
                </ItemTitle>
                <ItemDescription className="break-words">
                  {item.computerName} · {item.message}
                </ItemDescription>
                <Button
                  data-link
                  variant="link"
                  className="justify-start p-0"
                  onClick={() => {
                    void read(item).catch((e) => setError(e.message));
                  }}
                >
                  <MessageSquare />
                  Open thread
                </Button>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      </DialogContent>
    </Dialog>
  );
}
