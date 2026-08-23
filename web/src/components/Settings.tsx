import { Archive, Boxes, Check, Cloud, Copy, Folder, GitBranch, Github, ImagePlus, Laptop, Monitor, Plus, RefreshCw, Smartphone, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import remyMark from "@/assets/remy-mark.png";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EditableName } from "@/components/EditableName";
import { IconPicker } from "@/components/IconPicker";
import { DEVICE_ICON_IDS, deviceIcon, type DeviceIconId } from "@/lib/devices";
import { formatPairCode, hostLabel, parsePairingLink } from "@/lib/pairing";
import { displayPath } from "@/lib/path";
import { workspaceForPath } from "@/lib/projects";
import { isNewer, summarizeNotes, type RemyRelease } from "@/lib/release";
import { transport } from "@/lib/transport";
import type { TintId } from "@/lib/tints";
import { cn } from "@/lib/utils";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { ModelPickerButton } from "@/components/ModelPicker";
import { PERMISSIONS, permissionOf } from "@/lib/chat-options";
import { ProviderMark } from "@/components/ProviderMark";
import { AvatarFrom, PresetAvatar } from "@/components/UserAvatar";
import { Markdown } from "@/components/Markdown";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaneHeader } from "@/components/PaneHeader";
import { PairingQr } from "@/components/PairingQr";
import { PathPickerDialog } from "@/components/PathPicker";
import { WorkspaceMark } from "@/components/WorkspaceIcon";
import { apiError } from "@/lib/api-error";
import { AVATAR_PRESETS, isImageAvatar, readAvatarFile } from "@/lib/avatars";
import {
  askToNotify,
  notificationsEnabled,
  notifyPermission,
  setNotificationsEnabled,
  type NotifyPermission,
} from "@/lib/notify";
import { IDENTITIES } from "@/components/AgentSettings";
import { useAppUpdate, type AppUpdatePhase } from "@/hooks/use-app-update";
import { useStore } from "@/state/store";
import type { Chat, ProviderMcpStatus, Server, TailnetDevice, ToolStatus } from "@/state/types";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type SettingsTab = "general" | "version-control" | "providers" | "devices" | "archive";

export const SETTINGS_SECTIONS: {
  id: SettingsTab;
  label: string;
  icon: typeof Monitor;
}[] = [
  { id: "general", label: "General", icon: Monitor },
  { id: "version-control", label: "Version control", icon: GitBranch },
  { id: "providers", label: "Providers", icon: Boxes },
  { id: "devices", label: "Devices", icon: Laptop },
  { id: "archive", label: "Archived threads", icon: Archive },
];

export function SettingsPane({
  tab,
  release,
}: {
  tab: SettingsTab;
  release: {
    current: string;
    latest?: RemyRelease;
    pending: RemyRelease[];
    available: boolean;
    local: boolean;
    checking: boolean;
    error?: string;
    check: () => Promise<RemyRelease | undefined>;
  };
}) {
  const section = SETTINGS_SECTIONS.find((entry) => entry.id === tab)!;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <PaneHeader crumbs={[{ label: "Settings" }, { label: section.label }]} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-6">
          {tab === "devices" ? (
            <DevicesPane />
          ) : tab === "archive" ? (
            <ArchivePane />
          ) : tab === "version-control" ? (
            <VersionControlPane />
          ) : tab === "providers" ? (
            <ProvidersPane />
          ) : (
            <GeneralPane release={release} />
          )}
        </div>
      </ScrollArea>
    </main>
  );
}

function GeneralPane({
  release,
}: {
  release: {
    current: string;
    latest?: RemyRelease;
    pending: RemyRelease[];
    available: boolean;
    local: boolean;
    checking: boolean;
    error?: string;
    check: () => Promise<RemyRelease | undefined>;
  };
}) {
  const { current, latest, pending, available, local, checking, check } = release;
  const update = useAppUpdate();

  const onCheck = async () => {
    try {
      const next = await check();
      if (!next || !isNewer(next.version, current)) {
        toast.success("You're on the latest version.");
      }
    } catch {
      toast.error("Couldn't check for updates", { description: "Try again in a bit." });
    }
  };

  const status =
    available && latest
      ? update.phase === "downloading"
        ? update.percent != null
          ? `Downloading ${latest.version} · ${update.percent}%`
          : `Downloading ${latest.version}…`
        : update.phase === "ready"
          ? `${latest.version} is ready to launch.`
          : update.phase === "installing"
            ? `Installing ${latest.version}…`
            : `${latest.version} is ready to install.`
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <img src={remyMark} alt="" className="size-10 rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Remy</p>
          {status ? (
            <p className="text-xs text-muted-foreground">
              {update.phase === "downloading" || update.phase === "installing" ? (
                <span className="shimmer">{status}</span>
              ) : (
                status
              )}
            </p>
          ) : (
            <p className="font-mono text-xs text-muted-foreground tabular-nums">
              {checking ? <span className="shimmer">Checking…</span> : current}
            </p>
          )}
        </div>
        {/* A copy built here is not behind any release, so it is told what it
            is rather than offered a download it does not want. */}
        {local ? (
          <Badge variant="secondary">Built here</Badge>
        ) : available && latest ? (
          <UpdateButton latest={latest} pending={pending} current={current} update={update} />
        ) : (
          <Button size="sm" variant="ghost" disabled={checking} onClick={() => void onCheck()}>
            {checking ? "Checking…" : "Check for updates"}
          </Button>
        )}
      </div>
      <AvatarField />
      <NotificationsField />
      <ThreadDefaultsField />
      <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
        <Monitor className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Appearance</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Dark is the only theme wired up today.</p>
        </div>
      </div>
    </div>
  );
}

const MAX_SHOWN_RELEASES = 6;

function busyLocalCount(chats: Chat[], servers: Server[]): number {
  const local = new Set(servers.filter((server) => server.local).map((server) => server.id));
  return chats.filter((chat) => {
    if (local.size > 0 && !local.has(chat.serverId)) return false;
    return chat.state === "working" || chat.state === "needs_input";
  }).length;
}

/// The download, then a relaunch that replaces this copy.
///
/// Hovering shows every release between the one running and the one on offer,
/// not just the newest of them — the point of the card is what changes for you,
/// and that is the whole run.
function UpdateButton({
  latest,
  pending,
  current,
  update,
}: {
  latest: RemyRelease;
  pending: RemyRelease[];
  current: string;
  update: {
    inApp: boolean;
    phase: AppUpdatePhase;
    percent?: number;
    download: (url?: string) => Promise<void>;
    install: () => Promise<void>;
  };
}) {
  // Someone a long way behind gets the recent run, not a scroll through every
  // release since they last opened the app.
  const shown = pending.slice(0, MAX_SHOWN_RELEASES);
  const [confirming, setConfirming] = useState(false);
  const [busyAtConfirm, setBusyAtConfirm] = useState(0);
  const busy = useStore((s) => busyLocalCount(s.chats, s.servers));
  const href = latest.downloadUrl ?? latest.pageUrl;
  const busyLabel =
    busyAtConfirm === 1 ? "A thread is still running" : `${busyAtConfirm} threads are still running`;

  const runInstall = async () => {
    try {
      await update.install();
    } catch (caught) {
      toast.error("Couldn't install the update", {
        description: caught instanceof Error ? caught.message : "Try again in a bit.",
      });
    }
  };

  const onAction = async () => {
    if (update.phase === "ready") {
      if (busy > 0) {
        setBusyAtConfirm(busy);
        setConfirming(true);
        return;
      }
      await runInstall();
      return;
    }
    if (!update.inApp && !latest.downloadUrl) {
      window.open(latest.pageUrl, "_blank", "noreferrer");
      return;
    }
    try {
      await update.download(latest.downloadUrl ?? latest.pageUrl);
    } catch (caught) {
      toast.error("Couldn't download the update", {
        description: caught instanceof Error ? caught.message : "Try again in a bit.",
      });
    }
  };

  const label =
    update.phase === "downloading"
      ? update.percent != null
        ? `Downloading ${update.percent}%`
        : "Downloading…"
      : update.phase === "ready"
        ? `Relaunch ${latest.version}`
        : update.phase === "installing"
          ? "Installing…"
          : `Download ${latest.version}`;

  const working = update.phase === "downloading" || update.phase === "installing";

  return (
    <>
      <HoverCard openDelay={120} closeDelay={80}>
        <HoverCardTrigger asChild>
          {update.inApp ? (
            <Button size="sm" disabled={working} onClick={() => void onAction()}>
              {working ? <span className="shimmer">{label}</span> : label}
            </Button>
          ) : (
            <Button asChild size="sm">
              <a href={href} target="_blank" rel="noreferrer">
                Download {latest.version}
              </a>
            </Button>
          )}
        </HoverCardTrigger>
        <HoverCardContent align="end" className="w-96 p-0">
          <div className="flex items-baseline gap-2 border-b border-border px-4 py-2.5">
            <p className="text-sm font-medium">What you'd be getting</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {current} → {latest.version}
            </p>
          </div>
          <ScrollArea className="max-h-72">
            <div className="flex flex-col gap-4 px-4 py-3">
              {shown.map((entry, index) => {
                const notes = summarizeNotes(entry.notes);
                return (
                  <div key={entry.version} className="flex flex-col gap-1">
                    {/* The one you would land on is the news; the ones under it
                        are what you skipped past to get there. */}
                    <p className="text-xs font-medium">
                      {index === 0 ? "What's changed" : `Changes in ${entry.version}`}
                    </p>
                    {notes ? (
                      <Markdown text={notes} className="text-xs" />
                    ) : (
                      <p className="text-xs text-muted-foreground">No notes for this one.</p>
                    )}
                  </div>
                );
              })}
              {pending.length > shown.length && (
                <p className="text-xs text-muted-foreground">
                  …and {pending.length - shown.length} earlier release
                  {pending.length - shown.length === 1 ? "" : "s"}.
                </p>
              )}
            </div>
          </ScrollArea>
          <a
            href={latest.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="block border-t border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Read it on GitHub
          </a>
        </HoverCardContent>
      </HoverCard>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{busyLabel}</AlertDialogTitle>
            <AlertDialogDescription>
              Installing replaces Remy and stops every agent that is not idle.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                void runInstall();
              }}
            >
              Install anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/// The face on your messages. Presets are drawn in the app; a picture is
/// resized and cropped square here before it is stored, so a settings row never
/// holds a photo straight off a phone.
function AvatarField() {
  const { settings, save } = useServerSettings();
  const useGithubAvatar = useStore((s) => s.useGithubAvatar);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  if (!settings) return null;
  const avatar = settings.avatar ?? "";

  const choose = (next: string) => {
    void save({ avatar: next }, "your avatar");
    setOpen(false);
  };

  const fromGithub = async () => {
    setBusy(true);
    try {
      await useGithubAvatar();
      setOpen(false);
    } catch (caught) {
      toast.error("Couldn't get your GitHub picture", { description: apiError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const upload = async (picked: File | undefined) => {
    if (!picked) return;
    try {
      choose(await readAvatarFile(picked));
    } catch (caught) {
      toast.error("Couldn't use that image", {
        description: caught instanceof Error ? caught.message : "Try a different one.",
      });
    }
  };

  return (
    <Field orientation="horizontal" className="items-center">
      <FieldContent>
        <FieldLabel>Your avatar</FieldLabel>
        <FieldDescription className="text-xs">
          Shown on your messages in a thread.
        </FieldDescription>
      </FieldContent>
      <div className="flex shrink-0 items-center gap-2">
        <AvatarFrom avatar={avatar} />
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          Change
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Your avatar</DialogTitle>
            <DialogDescription>Pick one, or use a picture of your own.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-4 gap-3">
            <button
              type="button"
              aria-label="Default"
              onClick={() => choose("")}
              className={cn(
                "flex items-center justify-center rounded-xl border p-2",
                avatar ? "border-transparent hover:bg-accent" : "border-primary",
              )}
            >
              <PresetAvatar className="size-12" />
            </button>
            {AVATAR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-label={preset.label}
                title={preset.label}
                onClick={() => choose(`preset:${preset.id}`)}
                className={cn(
                  "flex items-center justify-center rounded-xl border p-2",
                  avatar === `preset:${preset.id}` ? "border-primary" : "border-transparent hover:bg-accent",
                )}
              >
                <PresetAvatar preset={preset} className="size-12" />
              </button>
            ))}
          </div>

          <DialogFooter className="sm:justify-between">
            <input
              ref={file}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <span className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => file.current?.click()}>
                <ImagePlus />
                Use a picture
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void fromGithub()}>
                <Github />
                {busy ? "Fetching…" : "From GitHub"}
              </Button>
            </span>
            {isImageAvatar(avatar) && (
              <Button type="button" variant="ghost" size="sm" onClick={() => choose("")}>
                Remove picture
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Field>
  );
}

/// Banners for a thread that needs you or has finished. Permission belongs to
/// the browser and the answer sticks, so the switch says what the browser
/// decided rather than pretending it can ask again.
function NotificationsField() {
  const [on, setOn] = useState(() => notificationsEnabled());
  const [permission, setPermission] = useState<NotifyPermission>(() => notifyPermission());

  const toggle = async (next: boolean) => {
    if (!next) {
      setNotificationsEnabled(false);
      setOn(false);
      return;
    }
    const answer = await askToNotify();
    setPermission(answer);
    if (answer !== "granted") {
      setNotificationsEnabled(false);
      setOn(false);
      toast.error(
        answer === "unsupported"
          ? "This browser can't show notifications"
          : "Your browser is blocking notifications",
        { description: "Allow them for this site, then turn this back on." },
      );
      return;
    }
    setNotificationsEnabled(true);
    setOn(true);
  };

  return (
    <Field orientation="horizontal" className="items-center">
      <FieldContent>
        <FieldLabel htmlFor="notifications">Notify me</FieldLabel>
        <FieldDescription className="text-xs">
          {permission === "denied"
            ? "Your browser is blocking notifications for this site."
            : "When a thread needs you or finishes. Clicking it opens the thread."}
        </FieldDescription>
      </FieldContent>
      <Switch
        id="notifications"
        checked={on && permission === "granted"}
        disabled={permission === "unsupported"}
        onCheckedChange={(next) => void toggle(next)}
      />
    </Field>
  );
}

/// What a new thread starts as: the model it thinks with, and what it may do
/// before it asks you.
///
/// One place, here, because there is one answer. The model used to be chosen in
/// Providers as well, which read as two settings for one choice — Providers says
/// what this machine has installed, and that is a different question from what
/// to reach for. A workspace that wants something else says so in its own
/// settings, and a thread can still be moved after it starts.
function ThreadDefaultsField() {
  const { settings, online, save } = useServerSettings();
  if (!online || !settings) return null;

  const permission = permissionOf(settings.defaultPermissionMode);

  return (
    <Field orientation="horizontal" className="items-center">
      <FieldContent>
        <FieldLabel htmlFor="thread-default-model">Default model</FieldLabel>
        <FieldDescription className="text-xs">A workspace or agent can differ.</FieldDescription>
      </FieldContent>
      <div className="flex shrink-0 gap-2">
        <ModelPickerButton
          id="thread-default-model"
          className="w-48"
          value={{
            provider: settings.defaultProvider ?? "claude",
            model: settings.defaultModel ?? "",
            effort: settings.defaultEffort ?? "",
          }}
          onPick={(choice) =>
            void save(
              { defaultProvider: choice.provider, defaultModel: choice.model, defaultEffort: choice.effort ?? "" },
              "what a new thread thinks with",
            )
          }
        />
        <Select
          value={permission.value}
          onValueChange={(value) => void save({ defaultPermissionMode: value }, "what a new thread may do")}
        >
          <SelectTrigger
            id="thread-default-permission"
            aria-label="Default permission level"
            size="sm"
            className="w-48 shrink-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {PERMISSIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <SelectItem key={option.value} value={option.value}>
                    <Icon className="size-4 opacity-70" />
                    {option.label}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </Field>
  );
}

const CHECKOUTS = [
  { value: "main", label: "Main checkout" },
  { value: "worktree", label: "New worktree" },
] as const;

const WORKTREE_BASES = [
  { value: "remote", label: "Remote default" },
  { value: "local", label: "Current branch" },
] as const;

const REPO_UPDATES = [
  { value: "off", label: "Off" },
  { value: "hourly", label: "Every hour" },
  { value: "sixHourly", label: "Every 6 hours" },
  { value: "daily", label: "Once a day" },
] as const;

/// Settings live on the machine, not on this window, so both panes read them
/// from the server once and write each change straight back.
function useServerSettings() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const loadSettings = useStore((s) => s.loadSettings);
  const servers = useStore((s) => s.servers);
  const online = servers.some((server) => server.online);

  useEffect(() => {
    if (!online) return;
    void loadSettings().catch(() => {
      // The pane shows the machine as unreachable; a toast on top would repeat it.
    });
  }, [online, loadSettings]);

  const save = async (patch: Parameters<typeof saveSettings>[0], what: string) => {
    try {
      await saveSettings(patch);
    } catch (caught) {
      toast.error(`Couldn't change ${what}`, { description: apiError(caught) });
    }
  };

  return { settings, online, save };
}

function VersionControlPane() {
  const { settings, online, save } = useServerSettings();
  const tooling = useStore((s) => s.tooling);
  const loadTooling = useStore((s) => s.loadTooling);
  const [pickingRoot, setPickingRoot] = useState(false);

  useEffect(() => {
    if (online) void loadTooling().catch(() => {});
  }, [online, loadTooling]);

  if (!online) return <Unreachable />;
  if (!settings) return <p className="text-sm shimmer text-muted-foreground">Reading this machine's settings…</p>;

  return (
    <div className="flex flex-col gap-5">
      <Field orientation="horizontal" className="items-center">
        <FieldContent>
          <FieldLabel htmlFor="default-git-identity">Commit attribution</FieldLabel>
          <FieldDescription className="text-xs">
            Agents set to Remy default follow this choice.
          </FieldDescription>
        </FieldContent>
        <Select
          value={settings.defaultGitIdentity ?? "author"}
          onValueChange={(value) =>
            void save({ defaultGitIdentity: value as "off" | "author" }, "who agent commits credit")
          }
        >
          <SelectTrigger id="default-git-identity" size="sm" className="w-44 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {IDENTITIES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      <Field orientation="horizontal" className="items-center">
        <FieldContent>
          <FieldLabel htmlFor="default-checkout">New threads open in</FieldLabel>
          <FieldDescription className="text-xs">Only applies to a workspace with worktrees.</FieldDescription>
        </FieldContent>
        <Select
          value={settings.defaultCheckout}
          onValueChange={(value) => void save({ defaultCheckout: value as "main" | "worktree" }, "that default")}
        >
          <SelectTrigger id="default-checkout" size="sm" className="w-44 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {CHECKOUTS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      <Field orientation="horizontal" className="items-center">
        <FieldContent>
          <FieldLabel htmlFor="worktree-base">New worktrees branch from</FieldLabel>
          <FieldDescription className="text-xs">
            {settings.worktreeBase === "remote"
              ? "The remote's default branch, so a worktree starts current."
              : "Whatever the main checkout is on."}
          </FieldDescription>
        </FieldContent>
        <Select
          value={settings.worktreeBase}
          onValueChange={(value) => void save({ worktreeBase: value as "remote" | "local" }, "that default")}
        >
          <SelectTrigger id="worktree-base" size="sm" className="w-44 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {WORKTREE_BASES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      <BranchPrefixField
        value={settings.worktreeBranchPrefix || "remy"}
        onSave={(value) => save({ worktreeBranchPrefix: value }, "the branch prefix")}
      />

      <Field>
        <FieldContent>
          <FieldLabel>Worktree location</FieldLabel>
          <FieldDescription className="text-xs">
            A <code className="font-mono">.remy</code> folder here, hidden from git without touching any{" "}
            <code className="font-mono">.gitignore</code>.
          </FieldDescription>
        </FieldContent>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-w-0 flex-1 justify-start font-mono text-xs"
            onClick={() => setPickingRoot(true)}
          >
            <Folder />
            <span className="min-w-0 truncate">
              {settings.worktreeRoot ? displayPath(settings.worktreeRoot) : "Inside each workspace"}
            </span>
          </Button>
          {settings.worktreeRoot && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void save({ worktreeRoot: "" }, "the worktree location")}
            >
              Reset
            </Button>
          )}
        </div>
        <FieldDescription className="font-mono text-xs">
          {settings.worktreeRoot
            ? `${displayPath(settings.worktreeRoot)}/.remy/<repo>/<branch>`
            : "<workspace>/.remy/<branch>"}
        </FieldDescription>
      </Field>

      <PathPickerDialog
        open={pickingRoot}
        onOpenChange={setPickingRoot}
        title="Worktree location"
        description="Pick the folder Remy keeps its .remy worktrees in."
        initialPath={settings.worktreeRoot ? displayPath(settings.worktreeRoot) : "~/"}
        confirmLabel="Use folder"
        onConfirm={(picked) => void save({ worktreeRoot: picked }, "the worktree location")}
      />

      <RepoUpdateField />

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">On this machine</p>
        <ToolRow name="git" label="git" status={tooling?.git} />
        <ToolRow
          name="gh"
          label="GitHub CLI"
          status={tooling?.gh}
          detail={
            tooling?.gh.available && !tooling.gh.authenticated
              ? "Installed, but not signed in — run gh auth login to open pull requests."
              : tooling?.gh.account
                ? `Signed in as ${tooling.gh.account}.`
                : undefined
          }
        />
      </div>
    </div>
  );
}

function BranchPrefixField({ value, onSave }: { value: string; onSave: (value: string) => Promise<void> }) {
  const displayed = `${value.replace(/\/+$/, "")}/`;
  const [draft, setDraft] = useState(displayed);

  useEffect(() => setDraft(displayed), [displayed]);

  const commit = async () => {
    await onSave(draft.trim() || "remy/");
  };

  return (
    <Field orientation="horizontal" className="items-center">
      <FieldContent>
        <FieldLabel htmlFor="branch-prefix">Branch prefix</FieldLabel>
        <FieldDescription className="text-xs">Added before branches Remy creates.</FieldDescription>
      </FieldContent>
      <Input
        id="branch-prefix"
        value={draft}
        className="w-44 shrink-0 font-mono text-xs"
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(displayed);
            event.currentTarget.blur();
          }
        }}
      />
    </Field>
  );
}

/// How often Remy refreshes the repositories, and what happened last time.
///
/// The copy is careful about what this does: fetching is safe on any checkout,
/// but moving one is not, so a checkout with uncommitted work is fetched and
/// left exactly as it was.
function RepoUpdateField() {
  const { settings, save } = useServerSettings();
  const workspaces = useStore((s) => s.workspaces);
  const run = useStore((s) => s.repoRun);
  const loadRepoRun = useStore((s) => s.loadRepoRun);
  const updateRepos = useStore((s) => s.updateRepos);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadRepoRun().catch(() => {});
  }, [loadRepoRun]);

  const now = async () => {
    setBusy(true);
    try {
      await updateRepos();
      toast.success("Workspaces are up to date.");
    } catch (caught) {
      toast.error("Couldn't sync the workspaces", { description: apiError(caught) });
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return null;
  const updated = run?.repos.filter((repo) => repo.result === "updated").length ?? 0;
  const skipped = run?.repos.filter((repo) => repo.result === "dirty").length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <Field orientation="horizontal" className="items-center">
        <FieldContent>
          <FieldLabel htmlFor="repo-update">Sync workspaces</FieldLabel>
          <FieldDescription className="text-xs">
            Fetches every workspace. Fast-forwards a main checkout only when it is clean.
          </FieldDescription>
        </FieldContent>
        <Select
          value={settings.repoUpdate}
          onValueChange={(value) =>
            void save({ repoUpdate: value as typeof settings.repoUpdate }, "how often workspaces sync")
          }
        >
          <SelectTrigger id="repo-update" size="sm" className="w-44 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {REPO_UPDATES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {run
            ? `Last run ${when(run.at)} · ${updated} updated, ${run.repos.length - updated} left as they were${
                skipped ? ` (${skipped} had changes)` : ""
              }`
            : "Not run yet."}
        </p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void now()}>
          {busy ? "Updating…" : "Update now"}
        </Button>
      </div>

      {run && run.repos.length > 0 && (
        <ItemGroup className="gap-1">
          {run.repos.map((repo) => {
            const workspace = workspaces[workspaceForPath(repo.path, workspaces)];
            return (
              <Item key={repo.path} variant="muted" size="sm" className="gap-2.5">
                <ItemMedia>
                  <WorkspaceMark home={!workspace} workspace={workspace} size="sm" />
                </ItemMedia>
                <ItemContent className="gap-0.5">
                  <ItemTitle>{workspace?.name ?? repo.workspace}</ItemTitle>
                  <ItemDescription className="text-xs">
                    {repo.detail ?? REPO_RESULT[repo.result]}
                  </ItemDescription>
                </ItemContent>
                {repo.result === "updated" && (
                  <ItemActions>
                    <Badge variant="success">Updated</Badge>
                  </ItemActions>
                )}
                {repo.result === "failed" && (
                  <ItemActions>
                    <Badge variant="destructive">Failed</Badge>
                  </ItemActions>
                )}
              </Item>
            );
          })}
        </ItemGroup>
      )}
    </div>
  );
}

const REPO_RESULT: Record<string, string> = {
  updated: "Moved forward",
  current: "Already current",
  dirty: "Has uncommitted changes",
  "no-upstream": "Tracks no remote",
  diverged: "Has local commits",
  detached: "Not on a branch",
  failed: "Git refused",
};

/// A timestamp as someone would say it out loud.
function when(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric" });
}

/// What this machine has installed to run a thread on.
///
/// Only that. Which of them a new thread reaches for is a different question,
/// and it is answered once, in General — a picker here as well read as two
/// settings for one choice.
function ProvidersPane() {
  const servers = useStore((s) => s.servers);
  const online = servers.some((server) => server.online);
  const tooling = useStore((s) => s.tooling);
  const loadTooling = useStore((s) => s.loadTooling);
  const providers = useStore((s) => s.providers);
  const loadProviders = useStore((s) => s.loadProviders);
  const setProviderEnabled = useStore((s) => s.setProviderEnabled);
  const mcpProviders = useStore((s) => s.mcpProviders);
  const loadMcpProviders = useStore((s) => s.loadMcpProviders);
  const installProviderMcp = useStore((s) => s.installProviderMcp);
  const removeProviderMcp = useStore((s) => s.removeProviderMcp);
  const [mcpBusy, setMcpBusy] = useState<string>();
  const enabledCount = providers?.filter((provider) => provider.enabled !== false).length ?? 3;

  useEffect(() => {
    if (online) void Promise.all([loadTooling(), loadProviders(), loadMcpProviders()]).catch(() => {});
  }, [online, loadTooling, loadProviders, loadMcpProviders]);

  const toggle = async (provider: string, enabled: boolean) => {
    try {
      await setProviderEnabled(provider, enabled);
    } catch (caught) {
      toast.error("Couldn't change that provider", { description: apiError(caught) });
    }
  };

  const providerOn = (id: string) => providers?.find((provider) => provider.id === id)?.enabled !== false;

  const changeMcp = async (provider: string, label: string, install: boolean) => {
    setMcpBusy(provider);
    try {
      if (install) {
        await installProviderMcp(provider);
        toast.success(`Remy MCP was added to ${label}.`);
      } else {
        await removeProviderMcp(provider);
        toast.success(`Remy MCP was removed from ${label}.`);
      }
    } catch (caught) {
      toast.error(`Couldn't ${install ? "add" : "remove"} Remy MCP`, { description: apiError(caught) });
    } finally {
      setMcpBusy(undefined);
    }
  };

  if (!online) return <Unreachable />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <ToolRow
          name="claude"
          label="Claude Code"
          mark={<ProviderMark provider="claude" />}
          status={tooling?.claude}
          enabled={providerOn("claude")}
          disableToggle={enabledCount === 1 && providerOn("claude")}
          onEnabledChange={(enabled) => void toggle("claude", enabled)}
          mcp={mcpProviders?.claude}
          mcpBusy={mcpBusy === "claude"}
          onMcpChange={(install) => void changeMcp("claude", "Claude Code", install)}
          detail={
            tooling?.claude.available
              ? "Threads run through the copy of Claude Code on this machine."
              : "Install Claude Code on this machine to run threads on Claude."
          }
        />
        <ToolRow
          name="codex"
          label="Codex"
          mark={<ProviderMark provider="codex" />}
          status={tooling?.codex}
          enabled={providerOn("codex")}
          disableToggle={enabledCount === 1 && providerOn("codex")}
          onEnabledChange={(enabled) => void toggle("codex", enabled)}
          mcp={mcpProviders?.codex}
          mcpBusy={mcpBusy === "codex"}
          onMcpChange={(install) => void changeMcp("codex", "Codex", install)}
          detail={
            tooling?.codex?.available
              ? "Threads run through Codex on this machine."
              : "Install Codex on this machine to run threads on it."
          }
        />
        <ToolRow
          name="cursor"
          label="Cursor"
          mark={<ProviderMark provider="cursor" />}
          status={tooling?.cursor}
          enabled={providerOn("cursor")}
          disableToggle={enabledCount === 1 && providerOn("cursor")}
          onEnabledChange={(enabled) => void toggle("cursor", enabled)}
          mcp={mcpProviders?.cursor}
          mcpBusy={mcpBusy === "cursor"}
          onMcpChange={(install) => void changeMcp("cursor", "Cursor", install)}
          detail={
            tooling?.cursor?.available
              ? "Threads run through Cursor on this machine."
              : "Install Cursor Agent on this machine to run threads on it."
          }
        />
      </div>
    </div>
  );
}

function ToolRow({
  name,
  label,
  status,
  detail,
  mark,
  enabled,
  disableToggle,
  onEnabledChange,
  mcp,
  mcpBusy,
  onMcpChange,
}: {
  name: string;
  label: string;
  status?: ToolStatus;
  detail?: string;
  /// A provider's own logo, where the row stands for one.
  mark?: ReactNode;
  enabled?: boolean;
  disableToggle?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  mcp?: ProviderMcpStatus;
  mcpBusy?: boolean;
  onMcpChange?: (install: boolean) => void;
}) {
  const ok = status?.available && status.authenticated !== false;
  return (
    <Item variant="outline" size="sm" className="gap-2.5">
      <ItemMedia>
        {mark ?? (
          <span
            className={cn(
              "flex size-4 items-center justify-center rounded-full",
              status === undefined ? "bg-muted" : ok ? "bg-success/20 text-success-foreground" : "bg-muted",
            )}
          >
            {status === undefined ? null : ok ? <Check className="size-3" /> : <X className="size-3" />}
          </span>
        )}
      </ItemMedia>
      <ItemContent className="gap-0.5">
        <ItemTitle>{label}</ItemTitle>
        <ItemDescription className="text-xs">
          {enabled === false
            ? "Turned off. Existing threads stay available."
            : status === undefined
            ? "Checking…"
            : (detail ?? (status.available ? "Ready." : (status.error ?? `Remy can't run ${name} here.`)))}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="gap-2">
        {status !== undefined && !ok && <Badge variant="secondary">Not ready</Badge>}
        {status?.version && (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{status.version}</span>
        )}
        {onMcpChange && status?.available && mcp && (
          <Button
            size="xs"
            variant="outline"
            disabled={mcpBusy}
            onClick={() => onMcpChange(!mcp.installed)}
          >
            {mcpBusy ? "Working…" : mcp.installed ? "Remove MCP" : mcp.configured ? "Repair MCP" : "Add MCP"}
          </Button>
        )}
        {onEnabledChange && (
          <Switch
            checked={enabled !== false}
            disabled={disableToggle}
            aria-label={`${enabled === false ? "Turn on" : "Turn off"} ${label}`}
            onCheckedChange={onEnabledChange}
          />
        )}
      </ItemActions>
    </Item>
  );
}

function Unreachable() {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Laptop />
        </EmptyMedia>
        <EmptyTitle>This machine is offline</EmptyTitle>
        <EmptyDescription>Open Remy on it to change these settings.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ArchivePane() {
  const servers = useStore((s) => s.servers);
  const [items, setItems] = useState<ArchiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const serverKey = servers.map((server) => `${server.id}:${server.online ? "1" : "0"}`).join("|");

  useEffect(() => {
    let cancelled = false;
    const currentServers = useStore.getState().servers;
    setLoading(true);
    void Promise.all(
      currentServers.map(async (server) => {
        if (!server.online) return [];
        try {
          const body = await transport.request<{ archives?: RawArchive[] }>(server.id, "/archives");
          return (body.archives ?? []).map((archive) => toRow(archive, server));
        } catch {
          return [];
        }
      }),
    ).then((listed) => {
      if (cancelled) return;
      setItems(listed.flat().sort((a, b) => b.archivedAt - a.archivedAt));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [serverKey]);

  const remove = async (row: ArchiveRow) => {
    try {
      await transport.request(row.serverId, `/archives/${encodeURIComponent(row.id)}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== row.id || item.serverId !== row.serverId));
      toast.success("Removed the archived thread.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      toast.error("Couldn't remove that archive", { description: message });
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground shimmer">Loading archives…</p>;
  }

  if (items.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Archive />
          </EmptyMedia>
          <EmptyTitle>No archived threads</EmptyTitle>
          <EmptyDescription>Archive a finished thread from its conversation when you're done.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((row) => (
        <div key={`${row.serverId}:${row.id}`} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{row.title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {[row.serverName, row.cwd ? displayPath(row.cwd) : undefined, archivedWhen(row.archivedAt)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={`Remove ${row.title}`}>
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {row.title}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Remy deletes the saved copy. The original chat is already gone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void remove(row)}>
                  Remove archive
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ))}
    </div>
  );
}

interface RawArchive {
  id: string;
  session: string;
  archivedAt: number;
  cwd?: string | null;
  conversation?: { title?: string | null };
}

interface ArchiveRow {
  id: string;
  serverId: string;
  serverName: string;
  title: string;
  cwd?: string | null;
  archivedAt: number;
}

function toRow(archive: RawArchive, server: Server): ArchiveRow {
  return {
    id: archive.id,
    serverId: server.id,
    serverName: server.name,
    title: archive.conversation?.title?.trim() || archive.session,
    cwd: archive.cwd,
    archivedAt: archive.archivedAt,
  };
}

function archivedWhen(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function DevicesPane() {
  const servers = useStore((s) => s.servers);
  const addServer = useStore((s) => s.addServer);
  const removeServer = useStore((s) => s.removeServer);
  const updateServer = useStore((s) => s.updateServer);
  const [busy, setBusy] = useState(false);
  // Pairing lives in the daemon on this machine rather than in any one window,
  // so the desktop app, a browser and the phone all pair once and see one list.
  const home = servers.find((server) => server.local) ?? servers.find((server) => !server.cloud);
  // Nothing can pair with a machine nothing can reach, so the list below says
  // so rather than offering buttons that cannot work.
  const homeReachable = useIdentity(home?.id)?.exposed === true;

  const unpair = async (server: Server) => {
    setBusy(true);
    try {
      await removeServer(server.id);
      toast.success(`Unpaired ${server.name}.`);
    } catch (caught) {
      toast.error("Couldn't unpair that device", { description: apiError(caught) });
    } finally {
      setBusy(false);
    }
  };

  if (servers.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Starting Remy on this machine</EmptyTitle>
          <EmptyDescription>Give it a moment.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {servers.filter((server) => !server.cloud).map((server) => (
        <DeviceCard
          key={server.id}
          server={server}
          homeId={home?.id}
          busy={busy}
          onUnpair={() => void unpair(server)}
          onUpdate={async (patch) => {
            if (server.local) {
              await transport.request(server.id, "/server/identity", { method: "PATCH", body: patch });
            }
            await updateServer(server.id, patch);
          }}
        />
      ))}
      {home ? <CursorCloudCard homeId={home.id} /> : null}
      {home ? <PhonesField serverId={home.id} /> : null}
      <DiscoveredDevices homeId={home?.id} reachable={homeReachable} />
      <AddDevice onAdd={addServer} />
    </div>
  );
}

interface CursorCloudStatus {
  configured: boolean;
  visible: boolean;
  enabled: boolean;
  account?: string;
  keyName?: string;
}

function CursorCloudCard({ homeId }: { homeId: string }) {
  const refresh = useStore((s) => s.refresh);
  const [status, setStatus] = useState<CursorCloudStatus>();
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus(await transport.request<CursorCloudStatus>(homeId, "/cursor-cloud/status"));
  }, [homeId]);

  useEffect(() => {
    void load().catch(() => {});
  }, [load]);

  const connect = async () => {
    setBusy(true);
    try {
      const next = await transport.request<CursorCloudStatus>(homeId, "/cursor-cloud/connect", {
        method: "POST",
        body: { apiKey },
      });
      setStatus(next);
      setApiKey("");
      setOpen(false);
      await refresh();
      toast.success("Cursor Cloud is connected.");
    } catch (caught) {
      toast.error("Couldn't connect Cursor Cloud", { description: apiError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const next = await transport.request<CursorCloudStatus>(homeId, "/cursor-cloud/connect", { method: "DELETE" });
      setStatus(next);
      await refresh();
      toast.success("Cursor Cloud is disconnected.");
    } catch (caught) {
      toast.error("Couldn't disconnect Cursor Cloud", { description: apiError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const detail = status?.configured
    ? status.enabled
      ? [status.account, status.keyName].filter(Boolean).join(" · ") || "Ready for workspace threads."
      : "Cursor is off in Providers."
    : "Run workspace threads in Cursor Cloud.";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3">
      <span className="flex size-8 items-center justify-center rounded-md bg-muted">
        <Cloud className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Cursor Cloud</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      {status?.configured ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy}>Disconnect</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect Cursor Cloud?</AlertDialogTitle>
              <AlertDialogDescription>
                Saved transcripts stay in Remy, but you can't start or continue cloud threads.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void disconnect()}>Disconnect</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setOpen(true)}>Connect</Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Cursor Cloud</DialogTitle>
            <DialogDescription>
              Paste an API key from Cursor. Remy keeps it in this Mac's Keychain.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="cursor-cloud-api-key">API key</FieldLabel>
            <Input
              id="cursor-cloud-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <FieldDescription>Workspace environment values are never sent to Cursor Cloud.</FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!apiKey.trim() || busy} onClick={() => void connect()}>Connect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeviceCard({
  server,
  homeId,
  busy,
  onUnpair,
  onUpdate,
}: {
  server: Server;
  homeId?: string;
  busy: boolean;
  onUnpair: () => void;
  onUpdate: (patch: { name?: string; icon?: DeviceIconId; tint?: TintId }) => Promise<void>;
}) {
  const identity = useIdentity(server.local ? server.id : undefined);
  const migratedIdentity = useRef(false);

  useEffect(() => {
    if (!server.local || !identity || migratedIdentity.current) return;
    migratedIdentity.current = true;
    const patch: { name?: string; icon?: DeviceIconId; tint?: TintId } = {};
    if (!identity.configured?.name && server.name !== identity.name) patch.name = server.name;
    if (!identity.configured?.icon && server.icon !== identity.icon) patch.icon = server.icon;
    if (!identity.configured?.tint && server.tint && server.tint !== identity.tint) patch.tint = server.tint;
    if (Object.keys(patch).length > 0) void onUpdate(patch);
  }, [identity, onUpdate, server.icon, server.local, server.name, server.tint]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3">
        <IconPicker
          label={`Change icon for ${server.name}`}
          icon={server.icon}
          tint={server.tint}
          icons={DEVICE_ICON_IDS}
          renderIcon={deviceIcon}
          onChange={(patch) => void onUpdate(patch)}
          badge={
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-card",
                server.online ? "bg-success" : "bg-muted-foreground",
              )}
            />
          }
        />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <EditableName value={server.name} label="device name" onCommit={(name) => void onUpdate({ name })} />
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {server.local
              ? identity?.tailnetHost
                ? `This machine · ${identity.tailnetHost}`
                : "This machine"
              : `${server.code} · ${hostLabel(server.url)}`}
          </span>
        </span>

        {!server.local && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon-xs" disabled={busy} aria-label={`Unpair ${server.name}`}>
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unpair {server.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Its threads and board stop syncing here. Pair it again from its link.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={onUnpair}>
                  Unpair device
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      <NotifyField server={server} homeId={homeId} />
      {server.local ? <ReachableField serverId={server.id} identity={identity} /> : null}
      {server.online ? <StayAwakeField serverId={server.id} /> : null}
    </div>
  );
}

/// Where notifications raised on this machine go.
///
/// One switch per device, which is the whole answer: the machine running the
/// thread, the machine you are sitting at, several of them, or none. A paired
/// machine decides for itself what its own threads do — this is about the work
/// happening here.
function NotifyField({ server, homeId }: { server: Server; homeId?: string }) {
  const refresh = useStore((s) => s.refresh);
  const [on, setOn] = useState<boolean>();
  const [saving, setSaving] = useState(false);
  const switchId = `notify-${server.id}`;

  useEffect(() => {
    if (server.peer) {
      setOn(server.notify === true);
      return;
    }
    let cancelled = false;
    void transport
      .request<{ notifySelf?: boolean }>(server.id, "/server/settings")
      .then((settings) => {
        if (!cancelled) setOn(settings.notifySelf !== false);
      })
      .catch(() => {
        // A daemon from before routing landed has no say in where these go.
      });
    return () => {
      cancelled = true;
    };
  }, [server.id, server.peer, server.notify]);

  if (on === undefined) return null;

  const toggle = async (next: boolean) => {
    const previous = on;
    setOn(next);
    setSaving(true);
    try {
      if (server.peer) {
        if (!homeId) throw new Error("Remy is still starting on this machine.");
        await transport.request(homeId, `/peers/${encodeURIComponent(server.id)}`, {
          method: "PATCH",
          body: { notify: next },
        });
        await refresh();
      } else {
        await transport.request(server.id, "/server/settings", {
          method: "PATCH",
          body: { notifySelf: next },
        });
      }
    } catch (caught) {
      setOn(previous);
      toast.error("Couldn't change where notifications go", { description: apiError(caught) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-3">
      <Field orientation="horizontal" className="items-center">
        <FieldContent>
          <FieldLabel htmlFor={switchId}>Notifications</FieldLabel>
          <FieldDescription className="text-xs">
            {server.local
              ? "A thread on this machine reaches you here."
              : `A thread on this machine also reaches you on ${server.name}.`}
          </FieldDescription>
        </FieldContent>
        <Switch
          id={switchId}
          checked={on}
          disabled={saving}
          onCheckedChange={(next) => void toggle(next)}
        />
      </Field>
    </div>
  );
}

/// Whether anything off this machine can reach it, and the link that pairs
/// another machine with it once something can.
///
/// One switch, because it is one fact. The daemon binds loopback, so
/// `tailscale serve` is the whole of what lets anything in — every paired
/// machine included, not just pairing. Turning it off is the honest opposite of
/// turning it on, which is why this is a switch and not a button that only goes
/// one way. The link sits underneath because it cannot exist before there is an
/// address to put in it.
function ReachableField({ serverId, identity }: { serverId: string; identity?: Identity }) {
  const [changed, setChanged] = useState<Identity>();
  const [saving, setSaving] = useState(false);
  const switchId = `reachable-${serverId}`;
  const shown = changed ?? identity;

  if (!shown) return null;

  const hasTailscale = shown.tailnet ? shown.tailnet === "running" : Boolean(shown.tailnetHost);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      setChanged(
        await transport.request<Identity>(serverId, "/server/identity", {
          method: "PATCH",
          body: { exposed: next },
        }),
      );
      toast.success(next ? "Your other machines can reach this one." : "Nothing else can reach this machine.");
    } catch (caught) {
      toast.error(next ? "Couldn't make this machine reachable" : "Couldn't close this machine off", {
        description: apiError(caught),
      });
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    const link = `remy://configure?url=${encodeURIComponent(shown.url)}&token=${encodeURIComponent(shown.token)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Copied this machine's pairing link.");
    } catch {
      toast.error("Couldn't copy that link", { description: "Your browser is blocking the clipboard." });
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 px-3.5 py-3">
      <Field orientation="horizontal" data-disabled={!hasTailscale || undefined} className="items-center">
        <FieldContent>
          <FieldLabel htmlFor={switchId}>Reachable from your other machines</FieldLabel>
          <FieldDescription className="text-xs">
            {!hasTailscale
              ? shown.tailnet === "missing"
                ? "Tailscale isn't installed here, so nothing can reach this machine."
                : "Tailscale isn't running here, so nothing can reach this machine."
              : shown.exposed
                ? `Your machines reach it at ${shown.tailnetHost}. Nothing outside your tailnet can.`
                : "Only this machine can reach it. Turn this on to pair anything with it."}
          </FieldDescription>
        </FieldContent>
        <Switch
          id={switchId}
          checked={shown.exposed}
          disabled={saving || !hasTailscale}
          onCheckedChange={(next) => void toggle(next)}
        />
      </Field>

      {shown.exposed && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <Field orientation="horizontal" className="items-center">
            <FieldContent>
              <FieldLabel>Pairing link</FieldLabel>
              <FieldDescription className="text-xs">
                Scan it from the iPhone app, or paste it on a machine that never shows up below.
              </FieldDescription>
            </FieldContent>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => void copy()}>
              <Copy />
              Copy link
            </Button>
          </Field>
          <PairingQr
            value={`remy://configure?url=${encodeURIComponent(shown.url)}&token=${encodeURIComponent(shown.token)}`}
          />
        </div>
      )}
    </div>
  );
}

/// iPhones that have registered an Apple Push token with this machine.
///
/// They buzz when a thread here needs you and no window is open to show a
/// banner. The key that signs those pushes lives in `~/.remy/apns.json`, not
/// in this pane — this is just who will hear it.
function PhonesField({ serverId }: { serverId: string }) {
  const [status, setStatus] = useState<{
    configured: boolean;
    devices: { token: string; name: string; lastSeen: number }[];
  }>();

  const reload = useCallback(() => {
    void transport
      .request<{ configured?: boolean; devices?: { token: string; name: string; lastSeen: number }[] }>(
        serverId,
        "/push/devices",
      )
      .then((body) => setStatus({ configured: body.configured === true, devices: body.devices ?? [] }))
      .catch(() => {
        // A daemon from before Apple Push landed has no phones.
      });
  }, [serverId]);

  useEffect(() => reload(), [reload]);

  const forget = async (token: string, name: string) => {
    try {
      await transport.request(serverId, `/push/devices/${encodeURIComponent(token)}`, { method: "DELETE" });
      toast.success(`Forgot ${name}.`);
      reload();
    } catch (caught) {
      toast.error("Couldn't forget that iPhone", { description: apiError(caught) });
    }
  };

  if (!status) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 px-3.5 py-3">
      <Field>
        <FieldContent>
          <FieldLabel className="flex items-center gap-2">
            <Smartphone className="size-3.5" />
            iPhone
          </FieldLabel>
          <FieldDescription className="text-xs">
            {!status.configured
              ? "Apple Push isn't set up on this machine yet, so the iPhone stays quiet."
              : status.devices.length === 0
                ? "Pair the iPhone app and it gets a push when no window is open."
                : "A thread on this machine reaches these phones when no window is open."}
          </FieldDescription>
        </FieldContent>
      </Field>
      {status.devices.map((device) => (
        <div key={device.token} className="flex items-center gap-3 border-t border-border pt-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{device.name}</span>
            <span className="block text-xs text-muted-foreground">
              Last seen {new Date(device.lastSeen).toLocaleString(undefined, { month: "short", day: "numeric" })}
            </span>
          </span>
          <Button variant="ghost" size="icon-xs" aria-label={`Forget ${device.name}`} onClick={() => void forget(device.token, device.name)}>
            <Trash2 />
          </Button>
        </div>
      ))}
    </div>
  );
}

/// Your machines on the tailnet, and what it takes to pair one.
///
/// Tailscale already knows every device you own, so this is a list to pick from
/// rather than a link to carry. Clicking Pair asks that machine; a person there
/// compares a six-digit code and allows it. Nothing is shared until they do.
function DiscoveredDevices({ homeId, reachable }: { homeId?: string; reachable: boolean }) {
  const refresh = useStore((s) => s.refresh);
  const [devices, setDevices] = useState<TailnetDevice[]>();
  const [attempt, setAttempt] = useState<PairAttempt>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (force = false) => {
      if (!homeId) return;
      try {
        const answer = await transport.request<{ devices?: TailnetDevice[] }>(
          homeId,
          `/tailnet${force ? "?refresh=1" : ""}`,
        );
        setDevices(answer.devices ?? []);
      } catch {
        // A daemon from before discovery landed, or no Tailscale here.
        setDevices([]);
      }
    },
    [homeId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // While an ask is outstanding, poll it: the answer arrives when somebody at
  // the other machine presses Allow.
  useEffect(() => {
    if (!homeId || !attempt || attempt.state !== "waiting") return;
    const timer = window.setInterval(() => {
      void transport
        .request<PairAttempt>(homeId, `/pair/attempt/${encodeURIComponent(attempt.id)}`)
        .then((next) => {
          setAttempt(next);
          if (next.state === "approved") {
            toast.success(`Paired ${next.name}.`);
            void refresh();
            void load(true);
          }
          if (next.state === "denied") toast.error(`${next.name} denied that request.`);
          if (next.state === "failed") {
            toast.error("Couldn't finish pairing", { description: next.error });
          }
        })
        .catch(() => {
          // Keep waiting; the deadline on the daemon ends this eventually.
        });
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [homeId, attempt, refresh, load]);

  const pair = async (device: TailnetDevice) => {
    if (!homeId || !device.url) return;
    setBusy(true);
    try {
      setAttempt(
        await transport.request<PairAttempt>(homeId, "/pair/start", {
          method: "POST",
          body: { url: device.url, name: device.name },
        }),
      );
    } catch (caught) {
      toast.error(`Couldn't ask ${device.name} to pair`, { description: apiError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const unpaired = (devices ?? []).filter((device) => !device.paired);
  const candidates = unpaired.filter((device) => device.remy);
  const others = unpaired.filter((device) => !device.remy);

  if (devices === undefined) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>On your tailnet</Label>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void load(true)}>
          <RefreshCw />
          Look again
        </Button>
      </div>

      {attempt && attempt.state === "waiting" ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-muted/40 px-3.5 py-4">
          <span className="text-sm">Waiting for {attempt.name}</span>
          <span className="font-mono text-2xl tracking-[0.2em] tabular-nums">
            {formatPairCode(attempt.code)}
          </span>
          <span className="text-xs text-muted-foreground">
            Allow it on {attempt.name} if it shows this code.
          </span>
        </div>
      ) : null}

      {unpaired.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          {reachable
            ? devices.length > 0
              ? "Every available machine is already paired."
              : "No other machines of yours are on the tailnet."
            : "Turn on Reachable from your other machines to pair anything."}
        </p>
      ) : (
        <ItemGroup className="gap-1">
          {[...candidates, ...others].map((device) => (
            <Item key={device.host} variant="outline" size="sm">
              <ItemMedia>
                <Laptop className="size-4 text-muted-foreground" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{device.name}</ItemTitle>
                <ItemDescription>
                  {device.remy
                    ? "Remy is running here."
                    : device.online
                      ? "Remy isn't answering here."
                      : "Asleep or offline."}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {device.remy ? (
                  <Button
                    size="sm"
                    disabled={busy || attempt?.state === "waiting" || !reachable}
                    onClick={() => void pair(device)}
                  >
                    Pair
                  </Button>
                ) : null}
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </div>
  );
}

/// The state of an ask this machine started, as the daemon reports it.
interface PairAttempt {
  id: string;
  code: string;
  url: string;
  name: string;
  at: number;
  state: "waiting" | "approved" | "denied" | "expired" | "failed";
  error?: string;
  peerId?: string;
}

/// Pairing with a machine from a link it showed you. The way in for a machine
/// that discovery cannot see — one not on the tailnet, or reached some other way.
function AddDevice({ onAdd }: { onAdd: (input: { url: string; token: string }) => Promise<void> }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    const parsed = parsePairingLink(link);
    if (!parsed) {
      setError("Copy the pairing link from Devices on the other machine.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onAdd(parsed);
      setLink("");
      toast.success("Paired the machine.");
    } catch (caught) {
      const message = apiError(caught);
      setError(message);
      toast.error("Couldn't pair that machine", { description: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="pairing-link">Pair with a link instead</Label>
      <div className="flex gap-2">
        <Input
          id="pairing-link"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder="remy://configure?url=…"
          spellCheck={false}
          disabled={busy}
        />
        <Button variant="outline" onClick={() => void submit()} disabled={busy || !link.trim()}>
          <Plus />
          Add
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/// What a machine says about itself: its tailnet name, whether anything can
/// reach it, and the token a peer needs. Only asked of the local daemon.
interface Identity {
  deviceId: string;
  name: string;
  icon: DeviceIconId;
  tint?: TintId;
  configured?: { name?: boolean; icon?: boolean; tint?: boolean };
  url: string;
  token: string;
  exposed: boolean;
  tailnetHost?: string;
  /// Absent from a machine on an older build, which only said whether it had a
  /// tailnet name — so the name is still what decides when this is missing.
  tailnet?: "missing" | "stopped" | "running";
}

function useIdentity(serverId: string | undefined): Identity | undefined {
  const [identity, setIdentity] = useState<Identity>();

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    void transport
      .request<Identity>(serverId, "/server/identity")
      .then((answer) => {
        if (!cancelled) setIdentity(answer);
      })
      .catch(() => {
        // A daemon from before pairing landed cannot introduce itself.
      });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  return identity;
}

function StayAwakeField({ serverId }: { serverId: string }) {
  const [mode, setMode] = useState<StayAwakeMode>();
  const [supported, setSupported] = useState(true);
  const [saving, setSaving] = useState(false);
  const selectId = `stay-awake-${serverId}`;

  useEffect(() => {
    let cancelled = false;
    void transport
      .request<{ preventSleep?: string; preventSleepSupported?: boolean }>(serverId, "/server/settings")
      .then((settings) => {
        if (cancelled) return;
        setMode(stayAwakeMode(settings.preventSleep) ?? "off");
        setSupported(settings.preventSleepSupported !== false);
      })
      .catch(() => {
        // Older servers have no settings route; hide the control.
      });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  if (mode === undefined) return null;

  const disabled = saving || !supported;

  const pick = async (next: string) => {
    const value = stayAwakeMode(next);
    if (!value || value === mode) return;
    const previous = mode;
    setMode(value);
    setSaving(true);
    try {
      await transport.request(serverId, "/server/settings", {
        method: "PATCH",
        body: { preventSleep: value },
      });
    } catch {
      setMode(previous);
      toast.error("Couldn't update that setting", { description: "Try again in a bit." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-3">
      <Field orientation="horizontal" data-disabled={disabled || undefined} className="items-center">
        <FieldContent>
          <FieldLabel htmlFor={selectId}>Stay awake</FieldLabel>
          <FieldDescription className="text-xs">
            {supported ? stayAwakeDetail(mode) : "Sleep prevention isn't available on this machine."}
          </FieldDescription>
        </FieldContent>
        <Select value={mode} onValueChange={(value) => void pick(value)} disabled={disabled}>
          <SelectTrigger id={selectId} size="sm" className="w-44 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {STAY_AWAKE.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

type StayAwakeMode = "off" | "whileBusy" | "always";

const STAY_AWAKE: { value: StayAwakeMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "whileBusy", label: "While working" },
  { value: "always", label: "Always" },
];

function stayAwakeMode(value: unknown): StayAwakeMode | undefined {
  return STAY_AWAKE.some((option) => option.value === value) ? (value as StayAwakeMode) : undefined;
}

function stayAwakeDetail(mode: StayAwakeMode): string {
  if (mode === "whileBusy") {
    return "Stays awake while a thread is running or waiting on you. Closing the lid can still sleep it.";
  }
  if (mode === "always") {
    return "Stays awake until you pick another option or turn the machine off. Closing the lid can still sleep it.";
  }
  return "This machine sleeps as usual.";
}
