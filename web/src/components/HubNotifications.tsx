import { notificationsEnabled, notifyPermission } from "@/lib/notify";
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
import { navigateLocation } from "@/lib/route";
const announced = new Set<string>();
export function HubNotifications({
  organizationId,
  organizationIds,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: {
  organizationId: string;
  organizationIds?: string[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const [items, setItems] = useState<(HubNotification & {ownerOrganizationId:string})[]>([]);
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
    { id: string; name: string; enabled: number; ownerOrganizationId:string }[]
  >([]);
  const read = async (item: HubNotification & {ownerOrganizationId:string}) => {
    await hubRequest(`${hubThreadBase(item.ownerOrganizationId)}/notifications/${item.id}/read`, "POST");
    setOpen(false);
    navigateLocation({
      route: {
        name: "threads",
        organizationId: organizationIds ? "all" : organizationId,
        threadId: item.threadId,
      },
    });
  };
  const ownersKey = (organizationIds ?? [organizationId]).join(",");
  useEffect(() => {
    const snapshots = new Map<string, {notifications:(HubNotification & {ownerOrganizationId:string})[]; devices:typeof devices}>();
    const stops = ownersKey.split(",").filter(Boolean).map(ownerOrganizationId => {
    let loaded = false;
    return watchHubResource<{
      notifications: HubNotification[];
      devices: typeof devices;
    }>(
      `${hubThreadBase(ownerOrganizationId)}/notifications`,
      (value) => {
        snapshots.set(ownerOrganizationId, {notifications:(value?.notifications ?? []).map(item => ({...item,ownerOrganizationId})),devices:(value?.devices ?? []).map(device => ({...device,ownerOrganizationId}))});
        setItems([...snapshots.values()].flatMap(s => s.notifications));
        setDevices([...snapshots.values()].flatMap(s => s.devices));
        if (!value) return;
        setError("");
        for (const original of value.notifications) {
          const item = {...original,ownerOrganizationId};
          const id = `${ownerOrganizationId}:${item.id}`;
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
          if (loaded && !item.readAt && !announced.has(id) && localStorage.getItem(key) !== "off" && document.hidden && notificationsEnabled() && notifyPermission() === "granted") {
            const banner = new Notification(item.title, { body: item.message, tag: id });
            banner.onclick = () => { window.focus(); void read(item).catch(e => setError(e.message)); banner.close(); };
          }
          announced.add(id);
        }
        loaded = true;
      },
      setError,
    );
    });
    return () => stops.forEach(stop => stop());
  }, [ownersKey]);
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
          <Field key={`${device.ownerOrganizationId}:${device.id}`} orientation="horizontal">
            <FieldLabel htmlFor={`push-${device.ownerOrganizationId}-${device.id}`}>{device.name}</FieldLabel>
            <Switch
              id={`push-${device.ownerOrganizationId}-${device.id}`}
              checked={!!device.enabled}
              disabled={savingDevice === device.id}
              onCheckedChange={(enabled) => {
                setSavingDevice(device.id);
                setDevices((old) =>
                  old.map((d) =>
                    d.id === device.id && d.ownerOrganizationId === device.ownerOrganizationId ? { ...d, enabled: Number(enabled) } : d,
                  ),
                );
                void hubRequest(`${hubThreadBase(device.ownerOrganizationId)}/notifications/devices/${device.id}`, "PATCH", {
                  enabled,
                })
                  .then(() =>
                    setDevices((old) =>
                      old.map((d) =>
                        d.id === device.id && d.ownerOrganizationId === device.ownerOrganizationId
                          ? { ...d, enabled: Number(enabled) }
                          : d,
                      ),
                    ),
                  )
                  .catch((e) => {
                    setDevices((old) =>
                      old.map((d) => (d.id === device.id && d.ownerOrganizationId === device.ownerOrganizationId ? device : d)),
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
            <Item key={`${item.ownerOrganizationId}:${item.id}`}>
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
