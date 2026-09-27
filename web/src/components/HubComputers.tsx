import { useEffect, useMemo, useState } from "react";
import { KeyRound, Laptop, Plus } from "lucide-react";
import type { HubThread, Organization } from "@remy/contract";
import { HubCloudProviderPage } from "./HubCloudProviderPage";
import { HubComputerPage } from "./HubComputerPage";
import { HubConnectComputerDialog } from "./HubConnectComputerDialog";
import { HubModelAccessPage, MODEL_ACCESS_LABELS, type ModelAccessResponse } from "./HubModelAccess";
import { PaneHeader } from "./PaneHeader";
import { PaneLoading } from "./PaneLoading";
import { EmptyState } from "./EmptyState";
import { RowMark, SettingsLinkRow, SettingsList, SettingsSection, StateDot } from "./SettingsList";
import { Button } from "./ui/button";
import { HubPersonalContext } from "@/lib/hub-scope";
import { useHubResource } from "@/lib/hub-organization";
import { CLOUD_PROVIDERS, cloudProvider, type CloudConnections } from "@/lib/cloud-providers";
import { useComputersAcross, threadIsLive, type ListedComputer } from "@/lib/computer-list";
import { deviceIcon, type DeviceIconId } from "@/lib/devices";
import { currentLocation, listenToLocationChanges, navigateLocation, parseLocation } from "@/lib/route";

/// Where Settings → Computers is: the list, or one page in it. A page is a
/// connected computer's id, `cloud:<provider>`, or `model-access`, in the
/// account named beside it.
function place(all: boolean) {
  const route = parseLocation(currentLocation()).route;
  if (route.name !== "settings" || route.tab !== "devices") return { page: "", account: "" };
  // Older links named the tabs this page used to have.
  const page = route.deviceId && !["cloud", "computers", "general"].includes(route.deviceId) ? route.deviceId : "";
  return { page, account: (all ? route.ownerOrganizationId : route.organizationId) ?? "" };
}

const ownerLabel = (account: Organization) => account.personal ? "Personal" : account.name;

/// Settings → Computers: one list of every cloud provider and connected
/// computer you can use in the accounts in view, and a page for each.
/// `accounts` is Personal and each organization under All, or the one account
/// the switcher narrowed to.
export function HubComputers({ accounts, all }: { accounts: Organization[]; all: boolean }) {
  const [where, setWhere] = useState(() => place(all));
  useEffect(() => listenToLocationChanges(() => setWhere(place(all))), [all]);
  const scopeId = all ? "all" : accounts[0]?.id;
  const go = (page: string, account?: string) => {
    setWhere({ page, account: account ?? "" });
    navigateLocation({ route: { name: "settings", tab: "devices", ...(page ? { deviceId: page } : {}), organizationId: scopeId, ...(all && account ? { ownerOrganizationId: account } : {}) } });
  };
  const back = () => go("");
  const openThread = (thread: HubThread, account: string) => navigateLocation({ route: { name: "threads", organizationId: all ? "all" : account, threadId: thread.id } });
  const across = useComputersAcross(accounts);
  const [connecting, setConnecting] = useState(false);
  const connectable = useMemo(() => accounts.filter(account => account.personal || account.role !== "member"), [accounts]);
  const account = accounts.find(entry => entry.id === where.account) ?? (accounts.length === 1 ? accounts[0] : accounts.find(entry => entry.personal));
  const connect = <HubConnectComputerDialog open={connecting} onOpenChange={setConnecting} accounts={connectable.length ? connectable : accounts.slice(0, 1)} initial={account?.id} onConnected={(org, computerId) => go(computerId, org)} />;
  const crumbs = (label?: string) => [{ label: "Settings" }, label ? { label: "Computers", onClick: back } : { label: "Computers" }, ...(label ? [{ label }] : [])];

  if (where.page && account) {
    const admin = account.personal || account.role !== "member";
    const owner = { name: account.name, personal: account.personal === true };
    const cloud = where.page.startsWith("cloud:") ? cloudProvider(where.page.slice(6)) : undefined;
    const listed = across.listed.find(entry => entry.computer.computerId === where.page);
    const title = cloud?.name ?? (where.page === "model-access" ? "Model access" : listed?.computer.name);
    return <HubPersonalContext value={owner.personal}>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PaneHeader sidebar crumbs={crumbs(title ?? "Computer")} />
        <div className="min-h-0 flex-1 overflow-auto">
          {cloud ? <HubCloudProviderPage key={`${account.id}:${cloud.id}`} organizationId={account.id} owner={owner} provider={cloud} admin={admin} onModelAccess={() => go("model-access", account.id)} />
            : where.page === "model-access" ? <HubModelAccessPage key={account.id} organizationId={account.id} owner={owner} admin={admin} />
            : listed ? <HubComputerPage key={listed.computer.computerId} organizationId={listed.account.id} owner={{ name: listed.account.name, personal: listed.account.personal === true }} computer={listed.computer} threads={across.threads} onOpenThread={thread => openThread(thread, listed.account.id)} onRemoved={back} />
            : !across.loaded ? <PaneLoading label="Loading computer" />
            : <EmptyState title="Computer unavailable" description="It was removed, or you no longer have access to it.">
              <Button variant="outline" data-link onClick={back}>View computers</Button>
            </EmptyState>}
        </div>
      </main>
    </HubPersonalContext>;
  }

  return <main aria-label="Computers" className="flex min-h-0 min-w-0 flex-1 flex-col">
    <PaneHeader sidebar crumbs={crumbs()}>
      <Button size="sm" variant="outline" className="h-7 gap-1.5 rounded-lg px-2.5 text-xs" onClick={() => setConnecting(true)}><Plus className="size-3.5" />Connect a computer</Button>
    </PaneHeader>
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-9 px-4 pt-9 pb-10 sm:px-10">
        <SettingsSection id="computers-cloud" title="Cloud" description="Each thread gets a fresh computer in your own cloud account.">
          {accounts[0] && <CloudAvailability organizationId={accounts[0].id} />}
          <SettingsList label="Cloud">
            {accounts.map(entry => <CloudRows key={entry.id} account={entry} full={entry.personal === true || accounts.length === 1} named={accounts.length > 1} open={(page) => go(page, entry.id)} />)}
          </SettingsList>
        </SettingsSection>
        <SettingsSection id="computers-connected" title="Connected" description="Your Macs and Linux machines. Threads run in the folders on them.">
          {across.error && <p role="alert" className="text-[13px] text-destructive">{across.error}</p>}
          {across.stale && <p role="status" className="text-[13px] text-muted-foreground">You're reading the last saved computer list.</p>}
          {!across.loaded && !across.error ? <PaneLoading label="Loading computers" />
            : across.listed.length ? <SettingsList label="Connected computers">
              {across.listed.map(entry => <ConnectedRow key={entry.computer.computerId} entry={entry} named={accounts.length > 1} running={across.threads.filter(thread => thread.computerId === entry.computer.computerId && threadIsLive(thread)).length} open={() => go(entry.computer.computerId, entry.account.id)} />)}
            </SettingsList>
            : <div className="flex flex-col items-center gap-3 rounded-[10px] border border-dashed px-6 py-8 text-center">
              <span className="flex size-10 items-center justify-center rounded-[10px] bg-muted"><Laptop className="size-[18px] text-muted-foreground" /></span>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">No computers connected</p>
                <p className="text-[13px] text-muted-foreground">Sign a Mac or Linux machine in to run threads in its folders.</p>
              </div>
              <Button size="sm" onClick={() => setConnecting(true)}>Connect a computer</Button>
            </div>}
        </SettingsSection>
      </div>
    </div>
    {connect}
  </main>;
}

/// Whether the hub can start cloud computers at all. It is the same for every
/// account, so one account's answer speaks for the list.
function CloudAvailability({ organizationId }: { organizationId: string }) {
  const hosted = useHubResource<CloudConnections>(organizationId, "/hosted");
  return hosted.value?.available === false ? <p role="status" className="text-[13px] text-warning">Cloud computers are temporarily unavailable.</p> : null;
}

/// One account's cloud rows. Personal, or the only account in view, lists
/// every provider so you can set one up; an organization under All lists the
/// ones it has.
function CloudRows({ account, full, named, open }: { account: Organization; full: boolean; named: boolean; open: (page: string) => void }) {
  const hosted = useHubResource<CloudConnections>(account.id, "/hosted");
  const access = useHubResource<ModelAccessResponse>(account.id, "/model-access");
  const chatgpt = useHubResource<{ available: boolean }>(account.id, account.personal ? "/chatgpt" : null, "/computers/live");
  const state = hosted.value;
  const prefix = named ? `${ownerLabel(account)} · ` : "";
  const rows = CLOUD_PROVIDERS.flatMap(provider => {
    const keys = state?.providerKeys?.[provider.id] ?? [];
    const configured = !!state?.connections?.includes(provider.id) || keys.length > 0;
    const enabled = !!state?.enabledProviders?.includes(provider.id);
    if (!full && !configured) return [];
    const active = keys.find(key => key.active) ?? keys[0];
    const Icon = provider.icon;
    return [<SettingsLinkRow
      key={provider.id}
      label={`${provider.name}${named ? `, ${ownerLabel(account)}` : ""}`}
      media={<RowMark><Icon /></RowMark>}
      title={provider.name}
      description={`${prefix}${configured ? `${keys.length || 1} ${keys.length === 1 || !keys.length ? "key" : "keys"}${active ? ` · ${active.name}` : ""}` : `Add a ${provider.keyLabel} to run threads here.`}`}
      state={state && (configured ? <StateDot on={enabled}>{enabled ? "On" : "Off"}</StateDot> : "Not set up")}
      onOpen={() => open(`cloud:${provider.id}`)}
    />];
  });
  const on = [
    ...(chatgpt.value?.available ? ["ChatGPT"] : []),
    ...(access.value?.providers ?? []).filter(entry => entry.enabled && entry.configured).map(entry => MODEL_ACCESS_LABELS[entry.id] ?? entry.id),
  ];
  if (!full && !rows.length && !on.length) return null;
  return <>
    {rows}
    <SettingsLinkRow
      label={`Model access${named ? `, ${ownerLabel(account)}` : ""}`}
      media={<RowMark><KeyRound /></RowMark>}
      title="Model access"
      description={`${prefix}${on.length ? `What cloud threads can run: ${on.join(", ")}` : account.personal ? "Sign in to ChatGPT or add an API key so cloud threads have a model." : "What cloud threads here can run"}`}
      state={access.value && (on.length ? `${on.length} on` : "None on")}
      onOpen={() => open("model-access")}
    />
  </>;
}

function ConnectedRow({ entry, named, running, open }: { entry: ListedComputer; named: boolean; running: number; open: () => void }) {
  const { computer, account } = entry;
  const Icon = deviceIcon(computer.icon as DeviceIconId);
  const offline = computer.availability === "offline";
  const providers = (computer.capabilities.providers ?? []).map(provider => provider.id === "claude" ? "Claude Code" : provider.id === "codex" ? "Codex" : provider.id === "cursor" ? "Cursor" : provider.id);
  const who = account.personal ? "" : computer.access.mode === "owner" ? "Only you" : computer.access.mode === "selected" ? "Selected people" : "Everyone";
  const parts = [
    named || !account.personal ? ownerLabel(account) : "Personal",
    ...(who ? [who] : []),
    ...(providers.length ? [providers.join(", ")] : []),
    ...(running ? [`${running} ${running === 1 ? "thread" : "threads"} running`] : []),
    ...(computer.updateRequired ? ["Needs an update"] : []),
  ];
  return <SettingsLinkRow
    label={computer.name}
    media={<RowMark className={offline ? "text-muted-foreground" : undefined}><Icon /></RowMark>}
    title={computer.name}
    description={parts.join(" · ")}
    state={<StateDot on={!offline}>{offline ? "Offline" : "Online"}</StateDot>}
    onOpen={open}
  />;
}
