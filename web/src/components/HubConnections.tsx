import { HubGitHub } from "./HubGitHub";
import { useState } from "react";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

export type ConnectionSummary = {
  id: string;
  provider: string;
  subject: string;
  external_id: string;
  label: string;
  status: string;
  updated_at: number;
};
export type ConnectionsState = {
  canManage: boolean;
  providers: {
    id: string;
    name: string;
    subjects: ("organization" | "member")[];
    configured: boolean;
  }[];
  connections: ConnectionSummary[];
};

export function HubConnections({ organizationId }: { organizationId: string }) {
  const {
    value,
    stale,
    error: readError,
  } = useHubResource<ConnectionsState>(organizationId, "/connections");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [remove, setRemove] = useState<{ provider: string; scope: string } | null>(
      null,
    );
  const start = async (provider: string, scope: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await hubRequest<{ url: string }>(
        `${hubThreadBase(organizationId)}/connections/${provider}`,
        "POST",
        { scope },
      );
      window.location.assign(result.url);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your account could not connect.",
      );
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Connections"
      className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 p-4"
    >
      <h1 className="text-lg font-medium">Connections</h1>
      <p className="text-sm text-muted-foreground">
        Connect your organization's tools and choose the account you use.
      </p>
      {(error || readError) && <p role="alert">{error || readError}</p>}
      {stale && (
        <p role="status">
          Your connections are out of date; reconnect to make changes.
        </p>
      )}
      {!value && <p role="status">Reading your connections…</p>}
      {value?.providers.map((provider) => (
        <Card key={provider.id} className="min-w-0">
          <CardHeader>
            <CardTitle>{provider.name}</CardTitle>
            <CardDescription>
              {provider.configured
                ? "Your credentials stay with your organization."
                : "Ask your administrator to configure this connection."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            {provider.subjects.map((scope) => {
              const connection = value.connections.find(
                (c) =>
                  c.provider === provider.id &&
                  (scope === "organization" ? !c.subject : !!c.subject),
              );
              const disabled =
                busy || stale || (scope === "organization" && !value.canManage);
              return (
                <div
                  key={scope}
                  className="flex min-w-0 flex-wrap items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p>
                      {scope === "organization"
                        ? "Organization account"
                        : "Your account"}
                    </p>
                    <p className="whitespace-normal break-words text-sm text-muted-foreground">
                      {connection
                        ? `${connection.label} · ${connection.status === "reauth" ? "Reconnect your account" : "Connected"}`
                        : "Not connected"}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={disabled || !provider.configured}
                    onClick={() => void start(provider.id, scope)}
                  >
                    {connection ? "Reconnect" : "Connect"} {provider.name}
                  </Button>
                  {connection && (
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      onClick={() =>
                        setRemove({ provider: provider.id, scope })
                      }
                    >
                      Disconnect {provider.name}
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
      {value && <HubGitHub organizationId={organizationId} canManage={value.canManage} />}
      <AlertDialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect this account?</AlertDialogTitle>
            <AlertDialogDescription>
              Your existing work stays in both apps, and connected activity
              stops.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (event) => {
                event.preventDefault();
                if (!remove) return;
                setBusy(true);
                setError("");
                try {
                  await hubRequest(
                    `${hubThreadBase(organizationId)}/connections/${remove.provider}`,
                    "DELETE",
                    { scope: remove.scope },
                  );
                  setRemove(null);
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Your account could not disconnect.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Disconnect account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
