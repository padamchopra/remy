import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiError } from "@/lib/api-error";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { navigateLocation } from "@/lib/route";
import { transport } from "@/lib/transport";
import { useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog-base";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type LinearAccountRow = {
  id: string;
  externalId: string;
  label: string;
  status: string;
  updatedAt: number;
  general?: boolean;
  organizationIds?: string[];
};
export type LinearLinkRow = { externalId: string; label: string } | null;
export type LinearConnectionView = { accounts: LinearAccountRow[]; link: LinearLinkRow };

export function LinearAccountsCard({
  accounts,
  busy,
  onConnect,
  onDisconnect,
}: {
  accounts: LinearAccountRow[];
  busy: boolean;
  onConnect: (accountId?: string) => void;
  onDisconnect: (accountId: string) => Promise<void>;
}) {
  const [remove, setRemove] = useState<LinearAccountRow | null>(null);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Linear</CardTitle>
        <CardDescription>Threads use the account you connect here.</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {accounts.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No Linear accounts.</EmptyTitle>
              <EmptyDescription>Connect one to use Linear in your threads.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button disabled={busy} onClick={() => onConnect()}>Connect Linear</Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <ItemGroup>
              {accounts.map((account) => (
                <Item key={account.id} variant="outline" role="listitem" aria-label={account.label}>
                  <ItemContent>
                    <ItemTitle>{account.label}</ItemTitle>
                    <ItemDescription>{account.status === "connected" ? "Connected" : "Reconnect your account"}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => onConnect(account.id)}>Reconnect</Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRemove(account)}>Disconnect</Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
            <Button variant="outline" disabled={busy} onClick={() => onConnect()}>Connect another account</Button>
          </>
        )}
      </CardContent>
      <Dialog open={!!remove} onOpenChange={(open) => { if (!open) setRemove(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Disconnect this account?</DialogTitle>
            <DialogDescription>Your existing work stays in both apps, and connected activity stops.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemove(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={() => { const account = remove; if (!account) return; setRemove(null); void onDisconnect(account.id); }}>
              Disconnect account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function LinearKeyDialog({
  open,
  accountId,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  accountId?: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (token: string, accountId?: string) => Promise<void>;
}) {
  const [token, setToken] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{accountId ? "Reconnect" : "Connect Linear"}</DialogTitle>
          <DialogDescription>Paste your Linear API key.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="linear-api-key">Linear API key</FieldLabel>
          <Input id="linear-api-key" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !token.trim()} onClick={() => { const next = token; setToken(""); onOpenChange(false); void onSubmit(next, accountId); }}>
            Connect Linear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LinearWorkspaceLink({
  accounts,
  link,
  busy,
  description,
  saved,
  onChoose,
  organizationId,
}: {
  accounts: LinearAccountRow[];
  link: LinearLinkRow;
  busy: boolean;
  description: string;
  saved: string;
  onChoose: (accountId: string | null) => Promise<void>;
  organizationId?: string;
}) {
  const match = link ? accounts.find((account) => account.externalId === link.externalId) : undefined;
  const foreign = link && !match ? `link:${link.externalId}` : undefined;
  const selected = foreign ?? match?.id ?? "none";
  if (organizationId === "all") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Linear</CardTitle>
          <CardDescription>Choose an organization before saving this.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Linear</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <Field>
          <FieldLabel>Your Linear account</FieldLabel>
          <Select
            value={selected}
            disabled={busy}
            onValueChange={(value) => {
              if (!value || value.startsWith("link:")) return;
              void onChoose(value === "none" ? null : value).then(
                () => toast.success(saved),
                (error) => toast.error("Couldn't save Linear", { description: apiError(error) }),
              );
            }}
          >
            <SelectTrigger className="w-full sm:w-80" aria-label="Your Linear account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {foreign && link ? <SelectItem value={foreign}>{link.label}</SelectItem> : null}
              {accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </CardContent>
    </Card>
  );
}

export function LinearThreadNotice({ notice, organizationId }: { notice?: string; organizationId?: string }) {
  if (!notice) return null;
  const go = (tab: "connections" | "organization") =>
    navigateLocation({ route: { name: "settings", tab, ...(organizationId ? { organizationId } : {}) } });
  return (
    <p role="status" className="mx-auto mb-3 w-full max-w-[44rem] text-sm text-muted-foreground">
      {notice.includes("Organization") ? (
        <>
          Connect your Linear account in <button type="button" data-link className="underline" onClick={() => go("connections")}>Connections</button>, or choose it in <button type="button" data-link className="underline" onClick={() => go("organization")}>Organization</button>.
        </>
      ) : notice.includes("Reconnect") ? (
        <>Reconnect your account in <button type="button" data-link className="underline" onClick={() => go("connections")}>Connections</button>.</>
      ) : (
        <>Connect your Linear account in <button type="button" data-link className="underline" onClick={() => go("connections")}>Connections</button>.</>
      )}
    </p>
  );
}

export function HubLinearWorkspace({ organizationId, personal = false }: { organizationId: string; personal?: boolean }) {
  const { value, stale } = useHubResource<LinearConnectionView>(organizationId, "/linear-workspace");
  const [busy, setBusy] = useState(false);
  const description = personal
    ? "Threads you start in Personal use this account."
    : "Threads you start in this organization use this account.";
  return (
    <LinearWorkspaceLink
      accounts={value?.accounts ?? []}
      link={value?.link ?? null}
      busy={busy || stale || !value}
      description={description}
      saved={description}
      organizationId={organizationId}
      onChoose={async (accountId) => {
        setBusy(true);
        try {
          await hubRequest(`${hubThreadBase(organizationId)}/linear-workspace`, "PUT", { accountId });
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

export function LocalLinearSettings() {
  const servers = useStore((state) => state.servers);
  const server = servers.find((item) => !item.peer && !item.cloud);
  const [view, setView] = useState<LinearConnectionView>();
  const [busy, setBusy] = useState(false);
  const [keyFor, setKeyFor] = useState<string | undefined>();
  const [keyOpen, setKeyOpen] = useState(false);
  useEffect(() => {
    if (!server) return;
    let stop = false;
    void transport.request<LinearConnectionView>(server.id, "/server/linear").then((next) => {
      if (!stop) setView(next);
    }, (error) => toast.error("Couldn't read Linear", { description: apiError(error) }));
    return () => { stop = true; };
  }, [server]);
  if (!server) return <p role="status">This computer is still starting.</p>;
  if (!view) return <p role="status">Reading your connections…</p>;
  const openKey = (accountId?: string) => { setKeyFor(accountId); setKeyOpen(true); };
  return (
    <div className="flex flex-col gap-4">
      <LinearAccountsCard
        accounts={view.accounts}
        busy={busy}
        onConnect={openKey}
        onDisconnect={async (accountId) => {
          setBusy(true);
          try {
            setView(await transport.request(server.id, `/server/linear/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" }));
            toast.success("This account is disconnected.");
          } catch (error) {
            toast.error("Couldn't disconnect Linear", { description: apiError(error) });
          } finally {
            setBusy(false);
          }
        }}
      />
      <LinearWorkspaceLink
        accounts={view.accounts}
        link={view.link}
        busy={busy}
        description="Threads you start in Personal use this account."
        saved="Threads you start in Personal use this account."
        onChoose={async (accountId) => {
          setBusy(true);
          try {
            setView(await transport.request(server.id, "/server/linear/link", { method: "PUT", body: { accountId } }));
          } finally {
            setBusy(false);
          }
        }}
      />
      <LinearKeyDialog
        open={keyOpen}
        accountId={keyFor}
        busy={busy}
        onOpenChange={setKeyOpen}
        onSubmit={async (token, accountId) => {
          setBusy(true);
          try {
            setView(await transport.request(server.id, "/server/linear/accounts", { method: "POST", body: { token, ...(accountId ? { accountId } : {}) } }));
            toast.success("Your Linear account is connected.");
          } catch (error) {
            toast.error("Couldn't connect Linear", { description: apiError(error) });
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
