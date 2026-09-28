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
import { RowMark, SettingsLinkRow, SettingsList, SettingsRow, SettingsSection, StateDot } from "./SettingsList";
import { Button } from "./ui/button";
import { HubPersonalContext } from "@/lib/hub-scope";
import { useHubResource } from "@/lib/hub-organization";
import { CLOUD_PROVIDERS, cloudProvider, type CloudConnections } from "@/lib/cloud-providers";
import { useComputersAcross, threadIsLive, type ListedComputer } from "@/lib/computer-list";
import { deviceIcon, type DeviceIconId } from "@/lib/devices";
import { currentLocation, listenToLocationChanges, navigateLocation, parseLocation } from "@/lib/route";
import type { OwnModelAccessResponse } from "@/lib/hub-models";

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

/// Settings → Computers: one account-wide inventory of every cloud provider,
/// model connection, and connected computer available to you. Personal rows
/// are editable. Organization rows are read-only; grants change under
/// Organizations.
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
  const connectable = useMemo(() => accounts.filter(account => account.personal), [accounts]);
  const inventoryAccount = accounts.find(entry => entry.personal) ?? accounts[0];
  const account = accounts.find(entry => entry.id === where.account) ?? (accounts.length === 1 ? accounts[0] : accounts.find(entry => entry.personal));
  const connect = <HubConnectComputerDialog open={connecting} onOpenChange={setConnecting} accounts={connectable.length ? connectable : accounts.slice(0, 1)} initial={account?.id} onConnected={(org, computerId) => go(computerId, org)} />;
  const crumbs = (label?: string) => [{ label: "Settings" }, label ? { label: "Computers", onClick: back } : { label: "Computers" }, ...(label ? [{ label }] : [])];

  if (where.page && account) {
    const admin = account.personal === true;
    const owner = { name: account.name, personal: account.personal === true };
    const cloud = where.page.startsWith("cloud:") ? cloudProvider(where.page.slice(6)) : undefined;
    const listed = across.listed.find(entry => entry.computer.computerId === where.page);
    const title = cloud?.name ?? (where.page === "model-access" ? "Model access" : listed?.computer.name);
    return <HubPersonalContext value={owner.personal}>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PaneHeader sidebar crumbs={crumbs(title ?? "Computer")} />
        <div className="min-h-0 flex-1 overflow-auto">
          {cloud ? <HubCloudProviderPage key={`${account.id}:${cloud.id}`} organizationId={account.id} owner={owner} provider={cloud} admin={admin} onModelAccess={() => go("model-access", account.id)} organizationAccess={all && owner.personal ? <OrganizationCloudAccess accounts={accounts.filter(entry => !entry.personal)} providerId={cloud.id} providerName={cloud.name} /> : undefined} />
            : where.page === "model-access" ? <HubModelAccessPage key={account.id} organizationId={account.id} owner={owner} admin={admin} organizationAccess={all && owner.personal ? <OrganizationModelAccess accounts={accounts.filter(entry => !entry.personal)} /> : undefined} />
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
            {inventoryAccount && <CloudRows account={inventoryAccount} full={inventoryAccount.personal === true} named={false} open={(page) => go(page)} />}
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

function OrganizationCloudAccess({ accounts, providerId, providerName }: { accounts: Organization[]; providerId: string; providerName: string }) {
  if (!accounts.length) return null;
  return <SettingsSection id={`organization-${providerId}`} title="Organizations" description="See where your keys are available.">
    <SettingsList label={`${providerName} organization access`}>
      {accounts.map(account => <OrganizationCloudRow key={account.id} account={account} providerId={providerId} />)}
    </SettingsList>
  </SettingsSection>;
}

function OrganizationCloudRow({ account, providerId }: { account: Organization; providerId: string }) {
  const hosted = useHubResource<CloudConnections>(account.id, "/hosted");
  const placements = hosted.value?.cloudPlacements?.filter(placement => placement.provider === providerId) ?? [];
  return <SettingsRow
    title={account.name}
    description={placements.length ? placements.map(placement => `${placement.keyName} · ${placement.own ? "Yours" : placement.owner}`).join(", ") : "No key is available here."}
  >{hosted.value ? placements.length ? `${placements.length} ${placements.length === 1 ? "key" : "keys"}` : "None" : undefined}</SettingsRow>;
}

function OrganizationModelAccess({ accounts }: { accounts: Organization[] }) {
  if (!accounts.length) return null;
  return <SettingsSection id="organization-model-access" title="Organizations" description="See what your organizations can use.">
    <SettingsList label="Organization model access">
      {accounts.map(account => <OrganizationModelAccessRow key={account.id} account={account} />)}
    </SettingsList>
  </SettingsSection>;
}

function OrganizationModelAccessRow({ account }: { account: Organization }) {
  const access = useHubResource<ModelAccessResponse>(account.id, "/model-access");
  const memberAccess = useHubResource<OwnModelAccessResponse>(account.id, "/own-model-access", "/computers/live");
  const available = [
    ...(access.value?.providers ?? []).filter(entry => entry.enabled && entry.configured).map(entry => MODEL_ACCESS_LABELS[entry.id] ?? entry.id),
    ...(memberAccess.value?.providers ?? []).flatMap(provider => provider.id === "chatgpt" ? provider.configured ? ["Your ChatGPT"] : [] : provider.keys.map(key => `Your ${key.name}`)),
    ...(memberAccess.value?.enrolled ?? []).map(entry => `${entry.owner} · ${entry.keyName}`),
  ];
  return <SettingsRow title={account.name} description={available.length ? available.join(", ") : "No model access is available here."}>{(access.value || memberAccess.value) ? available.length ? `${available.length} available` : "None" : undefined}</SettingsRow>;
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
  const memberAccess = useHubResource<OwnModelAccessResponse>(account.id, account.personal ? null : "/own-model-access", "/computers/live");
  const chatgpt = useHubResource<{ available: boolean }>(account.id, account.personal ? "/chatgpt" : null, "/computers/live");
  const state = hosted.value;
  const prefix = named ? `${ownerLabel(account)} · ` : "";
  const rows = CLOUD_PROVIDERS.flatMap(provider => {
    const keys = state?.providerKeys?.[provider.id] ?? [];
    const placements = state?.cloudPlacements?.filter((placement) => placement.provider === provider.id) ?? [];
    const configured = full ? !!state?.connections?.includes(provider.id) || keys.length > 0 : placements.length > 0;
    const enabled = !!state?.enabledProviders?.includes(provider.id);
    if (!full && !configured) return [];
    const active = keys.find(key => key.active) ?? keys[0];
    const Icon = provider.icon;
    return [<SettingsLinkRow
      key={provider.id}
      label={`${provider.name}${named ? `, ${ownerLabel(account)}` : ""}`}
      media={<RowMark><Icon /></RowMark>}
      title={provider.name}
      description={`${prefix}${configured ? full ? `${keys.length || 1} ${keys.length === 1 || !keys.length ? "key" : "keys"}${active ? ` · ${active.name}` : ""}` : placements.map((placement) => `${placement.owner} · ${placement.keyName}`).join(", ") : `Add a ${provider.keyLabel} to run threads here.`}`}
      state={state && (configured ? <StateDot on={full ? enabled : true}>{full ? enabled ? "On" : "Off" : "Available"}</StateDot> : "Not set up")}
      onOpen={() => open(`cloud:${provider.id}`)}
    />];
  });
  const on = [
    ...(chatgpt.value?.available ? ["ChatGPT"] : []),
    ...(access.value?.providers ?? []).filter(entry => entry.enabled && entry.configured).map(entry => MODEL_ACCESS_LABELS[entry.id] ?? entry.id),
  ];
  const memberConnections = account.personal || !memberAccess.value ? [] : [
    ...memberAccess.value.providers.flatMap((provider) => provider.id === "chatgpt" ? provider.configured ? ["Your ChatGPT"] : [] : provider.keys.map((key) => `Your ${key.name}`)),
    ...memberAccess.value.enrolled.map((entry) => `${entry.owner} · ${entry.keyName}`),
  ];
  if (!full && !rows.length && !on.length && !memberConnections.length) return null;
  return <>
    {rows}
    <SettingsLinkRow
      label={`Model access${named ? `, ${ownerLabel(account)}` : ""}`}
      media={<RowMark><KeyRound /></RowMark>}
      title="Model access"
      description={`${prefix}${memberConnections.length ? memberConnections.join(", ") : on.length ? `What cloud threads can run: ${on.join(", ")}` : account.personal ? "Sign in to ChatGPT or add an API key so cloud threads have a model." : "No model connections are available to you."}`}
      state={(access.value || memberAccess.value) && (on.length + memberConnections.length ? `${on.length + memberConnections.length} available` : "None")}
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
