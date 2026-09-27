import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, WifiOff } from "lucide-react";
import { toast } from "sonner";
import type { ComputerAccess, ComputerSummary, HubThread, OrganizationTeam, ThreadMember } from "@remy/contract";
import { EditableName } from "./EditableName";
import { HubComputerProviders } from "./HubComputerProviders";
import { HubModelDefault } from "./HubModelDefault";
import { SettingsList, SettingsRow, SettingsSection, StateDot } from "./SettingsList";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox-base";
import { Menu, MenuContent, MenuItem, MenuItemCheck, MenuTrigger } from "./ui/menu-base";
import { Segmented, SegmentedItem } from "./ui/segmented-base";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog-base";
import { computerModels } from "@/lib/hub-models";
import { DEVICE_ICON_IDS, deviceIcon, type DeviceIconId } from "@/lib/devices";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
import { lastSeen, platformLabel, threadIsLive } from "@/lib/computer-list";

type Options = { role: string; members: ThreadMember[]; teams: OrganizationTeam[] };

/// A connected computer's own page: what it is, who may use it, what it runs
/// and what is running on it now. Everything saves as you change it.
export function HubComputerPage({ organizationId, owner, computer, threads, onOpenThread, onRemoved }: {
  organizationId: string;
  owner: { name: string; personal: boolean };
  computer: ComputerSummary;
  threads: HubThread[];
  onOpenThread: (thread: HubThread) => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const manage = computer.canManage === true;
  const Icon = deviceIcon(computer.icon as DeviceIconId);
  const offline = computer.availability === "offline";
  const running = threads.filter(thread => thread.computerId === computer.computerId && threadIsLive(thread));
  const update = async (patch: { name?: string; icon?: string; access?: ComputerAccess }) => {
    setBusy(true);
    try { await hubRequest(`${hubThreadBase(organizationId)}/computers/${encodeURIComponent(computer.computerId)}`, "PATCH", patch); }
    catch (cause) { toast.error(`Couldn't save ${computer.name}`, { description: apiError(cause) }); }
    finally { setBusy(false); }
  };
  return <div className="mx-auto flex w-full max-w-[760px] flex-col gap-9 px-4 pt-9 pb-10 sm:px-10">
    <div className="flex min-w-0 items-center gap-3.5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] border bg-muted"><Icon className="size-5" /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {manage
          ? <EditableName value={computer.name} label="computer name" className="text-[22px] leading-7 font-semibold tracking-[-0.02em]" onCommit={name => void update({ name })} />
          : <h1 className="truncate text-[22px] leading-7 font-semibold tracking-[-0.02em]">{computer.name}</h1>}
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] leading-[18px] text-muted-foreground">
          <StateDot on={!offline}>{offline ? `Offline${computer.lastSeenAt ? ` · last seen ${lastSeen(computer.lastSeenAt)}` : ""}` : "Online"}</StateDot>
          <span aria-hidden>·</span>
          <span>{owner.personal ? "Personal" : owner.name}</span>
          <span aria-hidden>·</span>
          <span className="font-mono text-xs">{platformLabel(computer.platform)} · remy {computer.daemonVersion}</span>
          {computer.updateRequired && <><span aria-hidden>·</span><span className="text-warning">Needs an update</span></>}
        </p>
      </div>
    </div>
    {offline && <div role="status" className="flex min-w-0 items-start gap-3 rounded-[10px] border bg-card px-3.5 py-3">
      <WifiOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-[13px] leading-[18px]">{computer.name} isn't connected. Start Remy on it to run threads there.</p>
        <code className="self-start rounded-md border bg-background px-2 py-0.5 font-mono text-xs">remy start</code>
      </div>
    </div>}
    {manage && <ComputerDetails organizationId={organizationId} owner={owner} computer={computer} busy={busy} update={update} />}
    {computer.canUse && <SettingsSection id={`default-${computer.computerId}`} title="Default model">
      <HubModelDefault organizationId={organizationId} computerId={computer.computerId} catalogue={computerModels(computer.capabilities.providers ?? [])} title={`New threads on ${computer.name}`} />
    </SettingsSection>}
    {manage && <HubComputerProviders organizationId={organizationId} computer={computer} />}
    {running.length > 0 && <SettingsSection id={`running-${computer.computerId}`} title={<>Running now <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{running.length}</span></>}>
      <SettingsList label="Running now">
        {running.map(thread => <div key={thread.id} role="listitem" className="border-border not-first:border-t"><button type="button" data-link onClick={() => onOpenThread(thread)} className="flex w-full min-w-0 items-center gap-3 px-3.5 py-2.5 text-left hover:bg-accent/40">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[13px] leading-[18px]">{String(thread.detail.title || "Untitled thread")}</span>
            <span className="truncate text-xs leading-4 text-muted-foreground">{thread.access.owner.label}</span>
          </span>
          <ThreadState state={String(thread.detail.state)} />
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
        </button></div>)}
      </SettingsList>
    </SettingsSection>}
    {manage && <RemoveComputer organizationId={organizationId} computer={computer} running={running.length} onRemoved={onRemoved} />}
  </div>;
}

function ThreadState({ state }: { state: string }) {
  const needs = state === "waiting" || state === "needs_input";
  return <span className={needs ? "shrink-0 rounded-[5px] bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning" : "shrink-0 rounded-[5px] bg-info/15 px-1.5 py-0.5 text-[11px] font-medium text-info"}>
    {needs ? "Needs you" : "Working"}
  </span>;
}

/// Name lives in the header. Here: its icon and who may start threads on it.
function ComputerDetails({ organizationId, owner, computer, busy, update }: {
  organizationId: string;
  owner: { name: string; personal: boolean };
  computer: ComputerSummary;
  busy: boolean;
  update: (patch: { icon?: string; access?: ComputerAccess }) => Promise<void>;
}) {
  const [options, setOptions] = useState<Options>();
  useEffect(() => {
    if (owner.personal) return;
    let live = true;
    void hubRequest<Options>(`${hubThreadBase(organizationId)}/computers/options`).then(value => { if (live) setOptions(value); }).catch(() => {});
    return () => { live = false; };
  }, [organizationId, owner.personal]);
  const access = computer.access;
  const modes: { mode: ComputerAccess["mode"]; label: string }[] = [
    ...(computer.ownerUserId ? [{ mode: "owner" as const, label: "Only me" }] : []),
    { mode: "selected", label: "Selected members and teams" },
    { mode: "organization", label: `Everyone in ${owner.name}` },
  ];
  const choose = (key: "userIds" | "teamIds", id: string, checked: boolean) => void update({
    access: { ...access, [key]: checked ? [...new Set([...access[key], id])] : access[key].filter(value => value !== id) },
  });
  return <SettingsSection id={`details-${computer.computerId}`} title="Details">
    <SettingsList label="Details">
      <SettingsRow title="Icon">
        <Segmented value={(computer.icon || "laptop") as DeviceIconId} onValueChange={icon => void update({ icon })} disabled={busy} aria-label="Computer icon" className="flex-none">
          {DEVICE_ICON_IDS.map(id => {
            const Glyph = deviceIcon(id);
            return <SegmentedItem key={id} value={id} aria-label={id[0].toUpperCase() + id.slice(1)} className="h-7 w-8 flex-none px-0"><Glyph className="size-4" /></SegmentedItem>;
          })}
        </Segmented>
      </SettingsRow>
      <SettingsRow
        title="Who can use it"
        description={owner.personal ? "Only you. Enroll it from an organization's Computers and models settings when everyone should be able to use it." : "They start threads on it with the providers it runs."}
        below={!owner.personal && access.mode === "selected" && options && <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <fieldset className="flex min-w-0 flex-col gap-2" disabled={busy}>
            <legend className="mb-1 text-xs font-medium">Members</legend>
            {options.members.filter(member => member.id !== computer.ownerUserId).map(member => <label key={member.id} className="flex min-w-0 items-center gap-2 text-[13px]">
              <Checkbox checked={access.userIds.includes(member.id)} onCheckedChange={checked => choose("userIds", member.id, checked === true)} />
              <span className="min-w-0 break-words">{member.label}</span>
            </label>)}
          </fieldset>
          <fieldset className="flex min-w-0 flex-col gap-2" disabled={busy}>
            <legend className="mb-1 text-xs font-medium">Teams</legend>
            {options.teams.length === 0 && <p className="text-xs text-muted-foreground">{owner.name} has no teams.</p>}
            {options.teams.map(team => <label key={team.id} className="flex min-w-0 items-center gap-2 text-[13px]">
              <Checkbox checked={access.teamIds.includes(team.id)} onCheckedChange={checked => choose("teamIds", team.id, checked === true)} />
              <span className="min-w-0 break-words">{team.name}</span>
            </label>)}
          </fieldset>
        </div>}
      >
        {!owner.personal && <Menu>
          <MenuTrigger render={<Button variant="outline" size="sm" className="h-7 rounded-lg px-2.5 text-xs" disabled={busy} />}>
            {modes.find(mode => mode.mode === access.mode)?.label ?? "Choose who"}
            <ChevronDown className="size-3.5 opacity-60" />
          </MenuTrigger>
          <MenuContent align="end">
            {modes.map(mode => <MenuItem key={mode.mode} onClick={() => void update({ access: { ...access, mode: mode.mode } })}>
              {mode.label}
              <MenuItemCheck checked={access.mode === mode.mode} />
            </MenuItem>)}
          </MenuContent>
        </Menu>}
      </SettingsRow>
    </SettingsList>
  </SettingsSection>;
}

function RemoveComputer({ organizationId, computer, running, onRemoved }: { organizationId: string; computer: ComputerSummary; running: number; onRemoved: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await hubRequest(`${hubThreadBase(organizationId)}/computers/${encodeURIComponent(computer.computerId)}`, "DELETE");
      setOpen(false);
      toast.success(`${computer.name} is removed.`);
      onRemoved();
    } catch (cause) {
      toast.error(`Couldn't remove ${computer.name}`, { description: apiError(cause) });
    } finally { setBusy(false); }
  };
  return <SettingsList className="border-destructive/25">
    <SettingsRow title={`Remove ${computer.name}`} description={<>It signs out of Remy. Run <code className="font-mono">remy login</code> on it to add it back.</>}>
      <AlertDialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
        <AlertDialogTrigger render={<Button variant="outline" size="sm" className="h-7 rounded-lg px-2.5 text-xs text-destructive hover:text-destructive" />}>
          Remove computer
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {computer.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {running > 0 ? `Its ${running === 1 ? "running thread keeps" : `${running} running threads keep`} going on it, but you can't open ${running === 1 ? "it" : "them"} here.` : "You can't start threads on it here after this."} Run remy login on it to add it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} />
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>Remove computer</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsRow>
  </SettingsList>;
}
