import { useEffect, useState } from "react";
import { toast } from "sonner";
import { transport } from "@/lib/transport";
import { apiError } from "@/lib/api-error";
import { useStore } from "@/state/store";
import type { Server, ServerSettings } from "@/state/types";
import {
  Field,
  FieldContent,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type Status = {
  enabled: boolean;
  supported: boolean;
  phase: string;
  deadline?: number;
  snoozedUntil?: number;
};

function useAutomaticUpdate(server: Server) {
  const [status, setStatus] = useState<Status>();
  useEffect(() => {
    let active = true;
    let revision = 0;
    const load = async () => {
      const request = ++revision;
      try {
        const next = await transport.request<Status>(
          server.id,
          "/server/automatic-update",
        );
        if (active && revision === request) setStatus(next);
      } catch {
        if (active && revision === request) setStatus(undefined);
      }
    };
    if (server.online) void load();
    else setStatus(undefined);
    const off = transport.subscribe(
      (id, payload) => {
        if (id !== server.id) return;
        const frame = payload as { type?: string; status?: Status };
        if (frame.type === "automatic-update" && frame.status) {
          revision++;
          setStatus(frame.status);
        } else if (
          ["hello", "reset", "peer-reset", "settings"].includes(
            frame.type ?? "",
          )
        )
          void load();
        else if (frame.type === "peer-disconnected") {
          revision++;
          setStatus(undefined);
        }
      },
      ["settings"],
    );
    const offStatus = transport.onStatus((id, online) => {
      if (id !== server.id) return;
      if (online) void load();
      else {
        revision++;
        setStatus(undefined);
      }
    });
    return () => {
      active = false;
      off();
      offStatus();
    };
  }, [server.id, server.online]);
  return { status, setStatus };
}

export function AutomaticUpdateField({ server }: { server: Server }) {
  const { status, setStatus } = useAutomaticUpdate(server);
  const [saving, setSaving] = useState(false);
  const id = `automatic-updates-${server.id}`;
  const change = async (enabled: boolean) => {
    setSaving(true);
    try {
      const settings = await transport.request<ServerSettings>(
        server.id,
        "/server/settings",
        {
          method: "PATCH",
          body: { automaticUpdates: enabled },
        },
      );
      setStatus(
        (previous) =>
          previous && {
            ...previous,
            enabled: settings.automaticUpdates === true,
          },
      );
    } catch (error) {
      toast.error("Couldn't change automatic updates", {
        description: apiError(error),
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Field orientation="horizontal" className="items-center px-4 py-3">
      <FieldContent>
        <FieldLabel htmlFor={id}>Automatic updates</FieldLabel>
        <FieldDescription className="text-xs">
          Download updates and relaunch after your threads settle, with 30
          seconds to snooze.
        </FieldDescription>
      </FieldContent>
      <Switch
        id={id}
        checked={status?.enabled === true}
        disabled={saving || !status || !server.online}
        onCheckedChange={(value) => void change(value)}
      />
    </Field>
  );
}

function ComputerUpdateNotice({ server }: { server: Server }) {
  const { status } = useAutomaticUpdate(server);
  useEffect(() => {
    const id = `automatic-update-${server.id}`;
    if (!status?.enabled || status.phase !== "countdown" || !status.deadline) {
      toast.dismiss(id);
      return;
    }
    const deadline = status.deadline;
    const act = async (action: string) => {
      try {
        await transport.request(server.id, "/server/automatic-update", {
          method: "POST",
          body: { action, deadline },
        });
      } catch (error) {
        toast.error("Couldn't change the update countdown", {
          description: apiError(error),
        });
      }
    };
    const show = () =>
      toast(
        <div className="flex min-w-0 flex-col gap-3">
          <p>
            Remy on {server.name} will relaunch in{" "}
            {Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void act("relaunch")}>
              Relaunch now
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void act("snooze")}
            >
              Snooze 5 min
            </Button>
          </div>
        </div>,
        { id, duration: Infinity, dismissible: false, position: "top-right" },
      );
    show();
    const timer = window.setInterval(show, 1000);
    return () => {
      window.clearInterval(timer);
      toast.dismiss(id);
    };
  }, [server.id, server.name, status]);
  return null;
}

export function AutomaticUpdateNotices() {
  const servers = useStore((state) => state.servers);
  return (
    <>
      {servers.map((server) => (
        <ComputerUpdateNotice key={server.id} server={server} />
      ))}
    </>
  );
}
