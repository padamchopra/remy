import { useEffect, useMemo, useState } from "react";
import {
  Dimensions,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ArrowUp, ChevronDown, Folder, FolderGit2, GitBranch } from "lucide-react-native";
import { color, radius, space } from "../theme";
import { apiError, chatIdFrom } from "../lib/api-error";
import { CLOUD_MODES, cloudModeOf, PERMISSIONS, permissionOf, type PermissionValue } from "../lib/chat-options";
import { deviceIcon } from "../lib/devices";
import { preferredServer } from "../lib/inbox";
import { pairChoice, providerOf, type ModelChoice } from "../lib/providers";
import {
  useDevicePreferenceOrder,
  useProviders,
  useServerSettings,
  useStore,
  useSupportsEffort,
} from "../state/store";
import type { GitBranch as Branch, Workspace } from "../state/types";
import { ModelPicker } from "../components/ModelPicker";
import {
  ComposerMenu,
  MenuEmpty,
  MenuItem,
  MenuLoading,
  MenuSeparator,
  Popover,
} from "../components/ComposerMenu";
import { WorkspaceMark } from "../components/WorkspaceMark";
import { workspaceGroups } from "../lib/projects";

const HOME = "home";
const DEVICE_PREFIX = "device:";

function deviceValue(id: string): string {
  return `${DEVICE_PREFIX}${id}`;
}

function deviceIdFromValue(value: string): string | undefined {
  return value.startsWith(DEVICE_PREFIX) ? value.slice(DEVICE_PREFIX.length) : undefined;
}

const CHECKOUTS = [
  { value: "main", label: "Main checkout", icon: Folder },
  { value: "worktree", label: "New worktree", icon: FolderGit2 },
] as const;

function worktreeBase(branch?: string | null, mode?: "remote" | "local"): string {
  const name = branch || "main";
  return mode === "local" ? name : `origin/${name}`;
}

function mainPath(workspace?: Workspace): string {
  if (!workspace) return "~";
  return workspace.worktrees.find((entry) => entry.isMain)?.path ?? workspace.path;
}

export function ComposeScreen({ onCreated }: { onCreated: (id: string) => void }) {
  const workspaces = useStore((s) => s.workspaces);
  const servers = useStore((s) => s.servers);
  const groupedWorkspaces = useMemo(
    () => workspaceGroups(workspaces, servers),
    [workspaces, servers],
  );
  const createChat = useStore((s) => s.createChat);
  const checkoutBranch = useStore((s) => s.checkoutBranch);
  const loadSettings = useStore((s) => s.loadSettings);
  const loadProviders = useStore((s) => s.loadProviders);
  const deviceOrder = useDevicePreferenceOrder();
  const [target, setTarget] = useState<string | undefined>(workspaces[0]?.id);
  const [serverId, setServerId] = useState(() => workspaces[0]?.serverId ?? preferredServer(servers)?.id ?? "");
  const [choice, setChoice] = useState<ModelChoice>({ provider: "claude", model: "", effort: "" });
  const [modelPicked, setModelPicked] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionValue>("default");
  const [permissionPicked, setPermissionPicked] = useState(false);
  const [checkout, setCheckout] = useState<(typeof CHECKOUTS)[number]["value"]>("main");
  const [branch, setBranch] = useState<string>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [pickingPlace, setPickingPlace] = useState(false);
  const [keyboard, setKeyboard] = useState(0);

  useEffect(() => {
    void loadSettings().catch(() => {});
    void loadProviders().catch(() => {
      // Each Mac says elsewhere that it is unreachable; the catalogue this app
      // ships with is enough to paint the picker.
    });
  }, [loadSettings, loadProviders]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillChangeFrame", (event) => {
      const overlap = Dimensions.get("window").height - event.endCoordinates.screenY;
      setKeyboard(Math.max(0, overlap));
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (target) return;
    if (workspaces[0]) {
      setTarget(workspaces[0].id);
      setServerId(workspaces[0].serverId);
      return;
    }
    if (preferredServer(servers, deviceOrder)) setTarget(HOME);
  }, [target, workspaces, servers, deviceOrder]);

  const workspace = target && target !== HOME ? workspaces.find((entry) => entry.id === target) : undefined;
  const home = !workspace;
  const workspaceServers = workspace
    ? servers.filter((entry) => {
        if (entry.cloud && !entry.cloudConnected) return false;
        return workspaces.some((candidate) =>
          candidate.serverId === entry.id
          && (candidate.id === workspace.id || Boolean(workspace.origin && candidate.origin === workspace.origin)),
        );
      })
    : [];
  const server = home
    ? servers.find((entry) => entry.id === serverId) ?? preferredServer(servers, deviceOrder)
    : servers.find((entry) => entry.id === workspace.serverId) ?? preferredServer(servers, deviceOrder);
  // Every Mac holds its own defaults and its own catalogue, so both follow the
  // device this thread will run on rather than whichever answered first.
  const settings = useServerSettings(server?.id);
  const providers = useProviders(server?.id);
  const noEffort = Boolean(server) && !useSupportsEffort(server?.id);
  const cloud = server?.cloud === true;
  const git = Boolean(!home && workspace && workspace.worktrees.length > 0);
  const mainBranch =
    (!home && workspace
      ? workspace.worktrees.find((entry) => entry.isMain)?.branch ?? workspace.worktrees[0]?.branch
      : undefined) ?? undefined;
  const place = home ? (server?.name ?? "~") : workspace.name;
  const DeviceIcon = deviceIcon(server?.icon);
  const canSend = Boolean(text.trim() && server && !busy);
  const permission = cloud ? cloudModeOf(permissionMode) : permissionOf(permissionMode);
  const PermissionIcon = permission.icon;
  const providerName = providerOf(providers, choice.provider)?.label ?? "This provider";
  const asks = cloud || providerOf(providers, choice.provider)?.approvals !== false;
  const checkoutLabel = CHECKOUTS.find((entry) => entry.value === checkout)?.label ?? "Main checkout";
  const CheckoutIcon = checkout === "worktree" ? FolderGit2 : Folder;
  const branchName = branch ?? mainBranch;

  // The workspace's own choice if it has one, the Mac's otherwise — and then
  // yours for as long as the composer is open.
  useEffect(() => {
    if (cloud) {
      setChoice({ provider: "cursor", model: "", effort: "" });
      return;
    }
    if (modelPicked) return;
    setChoice(
      workspace?.provider
        ? { provider: workspace.provider, model: workspace.model ?? "", effort: workspace.effort ?? "" }
        : {
            provider: settings?.defaultProvider ?? "claude",
            model: settings?.defaultModel ?? "",
            effort: settings?.defaultEffort ?? "",
          },
    );
  }, [
    workspace?.provider,
    workspace?.model,
    workspace?.effort,
    settings?.defaultProvider,
    settings?.defaultModel,
    settings?.defaultEffort,
    modelPicked,
    cloud,
  ]);

  useEffect(() => {
    if (permissionPicked) return;
    setPermissionMode(permissionOf(settings?.defaultPermissionMode).value);
  }, [settings?.defaultPermissionMode, permissionPicked]);

  useEffect(() => {
    const mode = settings?.defaultCheckout ?? "main";
    setCheckout(mode);
    setBranch(mode === "worktree" ? worktreeBase(mainBranch, settings?.worktreeBase) : mainBranch ?? undefined);
  }, [workspace?.id, mainBranch, settings?.defaultCheckout, settings?.worktreeBase]);

  const pickWorkspace = (value: string) => {
    const id = deviceIdFromValue(value);
    if (id) {
      setTarget(HOME);
      setServerId(id);
      return;
    }
    setTarget(value);
    const next = workspaces.find((entry) => entry.id === value);
    if (next) setServerId(next.serverId);
  };

  const pickCheckout = (value: string) => {
    const next = value as (typeof CHECKOUTS)[number]["value"];
    setCheckout(next);
    setBranch(next === "worktree" ? worktreeBase(mainBranch, settings?.worktreeBase) : mainBranch);
  };

  const pickDevice = (id: string) => {
    setServerId(id);
    if (!workspace || workspace.serverId === id) return;
    const sibling = workspaces.find(
      (entry) =>
        entry.serverId === id && (workspace.origin ? entry.origin === workspace.origin : entry.name === workspace.name),
    );
    setTarget(sibling?.id ?? HOME);
  };

  const submit = async () => {
    if (!canSend || !server) return;
    setBusy(true);
    setError(undefined);
    try {
      let cwd = home || !workspace ? "~" : mainPath(workspace);
      if (git && workspace && branchName) {
        const next = await checkoutBranch({
          workspaceId: workspace.id,
          branch: branchName,
          mode: checkout,
        });
        cwd = next.path;
      }
      const created = await createChat({
        cwd,
        text,
        serverId: server.id,
        provider: choice.provider,
        model: choice.model,
        effort: noEffort ? "" : choice.effort ?? "",
        permissionMode,
      });
      onCreated(created.id);
    } catch (caught) {
      const started = chatIdFrom(caught);
      if (started) onCreated(started);
      setError(apiError(caught));
    } finally {
      setBusy(false);
    }
  };

  const selectedPlace = home ? deviceValue(server?.id ?? "") : workspace?.id;

  return (
    <View style={[styles.wrap, keyboard > 0 && { paddingBottom: keyboard + space.lg }]}>
      <ScrollView
        contentContainerStyle={[styles.body, keyboard > 0 && styles.bodyRaised]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Text style={styles.headline}>
          What do you want to do in{" "}
          <View collapsable={false} style={styles.placeCluster}>
            <Pressable onPress={() => setPickingPlace(true)} style={styles.placeHit}>
              <WorkspaceMark home={home} workspace={workspace} server={server} size="lg" />
              <Text style={styles.placeName}>{place}</Text>
            </Pressable>
          </View>
          ?
        </Text>

        <View style={styles.card}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Ask a question or describe a change."
            placeholderTextColor={color.mutedForeground}
            multiline
            editable={!busy}
            style={styles.input}
            textAlignVertical="top"
            scrollEnabled={false}
          />
          <View style={styles.toolbar}>
            {cloud ? (
              <Text style={styles.cloudModel}>Cursor Cloud default</Text>
            ) : (
              <ModelPicker
                providers={providers}
                value={choice}
                effortUnavailable={noEffort}
                onPick={(next) => {
                  setModelPicked(true);
                  setChoice(pairChoice(providers, next));
                }}
              />
            )}
            <ComposerMenu
              icon={PermissionIcon}
              label={permission.label}
              value={permissionMode}
              onChange={(value) => {
                setPermissionPicked(true);
                setPermissionMode(value as PermissionValue);
              }}
              options={cloud ? CLOUD_MODES : PERMISSIONS}
            />
            <Pressable
              onPress={() => void submit()}
              disabled={!canSend}
              accessibilityLabel="Send"
              style={[styles.send, !canSend && styles.sendOff]}
            >
              <ArrowUp size={16} color={color.primaryForeground} />
            </Pressable>
          </View>
          <View style={styles.meta}>
            <ComposerMenu
              icon={DeviceIcon}
              label={server?.name ?? "This machine"}
              value={server?.id ?? ""}
              onChange={pickDevice}
              style={styles.device}
              options={(home ? servers.filter((entry) => !entry.workspaceOnly) : workspaceServers).map((entry) => ({
                value: entry.id,
                label: entry.name,
                icon: deviceIcon(entry.icon),
              }))}
            />
            {git && workspace && branchName ? (
              <View style={styles.git}>
                <BranchPicker workspaceId={workspace.id} branch={branchName} onPick={setBranch} />
                <ComposerMenu
                  icon={CheckoutIcon}
                  label={checkoutLabel}
                  value={checkout}
                  onChange={pickCheckout}
                  style={styles.checkout}
                  options={CHECKOUTS}
                />
              </View>
            ) : null}
          </View>
        </View>
        {!asks && permissionMode === "default" ? (
          <Text style={styles.note}>{providerName} can't stop to ask, so Ask keeps it read-only.</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <Popover open={pickingPlace} onClose={() => setPickingPlace(false)}>
        {groupedWorkspaces.map(({ id, workspace: entry, copies }) => (
          <MenuItem
            key={id}
            leading={<WorkspaceMark home={false} workspace={entry} size="sm" />}
            label={entry.name}
            selected={copies.some((copy) => copy.id === selectedPlace)}
            onPress={() => {
              pickWorkspace(entry.id);
              setPickingPlace(false);
            }}
          />
        ))}
        {groupedWorkspaces.length > 0 && servers.some((entry) => !entry.workspaceOnly) ? <MenuSeparator /> : null}
        {servers.filter((entry) => !entry.workspaceOnly).map((entry) => {
          const Icon = deviceIcon(entry.icon);
          const value = deviceValue(entry.id);
          return (
            <MenuItem
              key={entry.id}
              icon={Icon}
              label={entry.name}
              selected={selectedPlace === value}
              onPress={() => {
                pickWorkspace(value);
                setPickingPlace(false);
              }}
            />
          );
        })}
      </Popover>
    </View>
  );
}

function BranchPicker({
  workspaceId,
  branch,
  onPick,
}: {
  workspaceId: string;
  branch: string;
  onPick: (value: string) => void;
}) {
  const listBranches = useStore((s) => s.listBranches);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    void listBranches(workspaceId)
      .then((next) => {
        if (!cancelled) setBranches(next);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, listBranches]);

  const needle = query.trim().toLowerCase();
  const listed = needle ? branches.filter((entry) => entry.name.toLowerCase().includes(needle)) : branches;

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [styles.branch, pressed && styles.pressed]}>
        <GitBranch size={14} color={color.mutedForeground} />
        <Text style={styles.branchLabel} numberOfLines={1}>
          {branch}
        </Text>
        <ChevronDown size={14} color={color.mutedForeground} />
      </Pressable>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        search={{ value: query, onChange: setQuery, placeholder: "Search branches" }}
      >
        {loading ? (
          <MenuLoading />
        ) : listed.length === 0 ? (
          <MenuEmpty>No matching branch.</MenuEmpty>
        ) : (
          listed.map((entry) => (
            <MenuItem
              key={entry.name}
              icon={GitBranch}
              label={entry.name}
              detail={
                entry.checkout === "main" ? "Main checkout" : entry.checkout === "worktree" ? "Worktree" : undefined
              }
              selected={entry.name === branch}
              onPress={() => {
                onPick(entry.name);
                setOpen(false);
              }}
            />
          ))
        )}
      </Popover>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  body: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
    gap: 28,
  },
  bodyRaised: {
    justifyContent: "flex-end",
    paddingTop: space.md,
    paddingBottom: 0,
  },
  headline: {
    color: color.foreground,
    fontSize: 28,
    fontWeight: "500",
    letterSpacing: -0.4,
    lineHeight: 36,
    textAlign: "center",
  },
  placeCluster: {
    flexDirection: "row",
    alignItems: "center",
  },
  placeHit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: color.mutedForeground,
    paddingBottom: 1,
  },
  placeName: {
    color: color.foreground,
    fontSize: 28,
    fontWeight: "500",
    letterSpacing: -0.4,
    lineHeight: 36,
  },
  card: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.card,
    borderRadius: radius.xl,
    overflow: "hidden",
  },
  input: {
    minHeight: 112,
    width: "100%",
    color: color.foreground,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingBottom: 6,
    gap: 2,
  },
  cloudModel: {
    color: color.mutedForeground,
    fontSize: 13,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  send: {
    marginLeft: "auto",
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendOff: { opacity: 0.4 },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  device: { flexShrink: 1, minWidth: 0, maxWidth: "42%" },
  git: { marginLeft: "auto", flexDirection: "row", alignItems: "center", flexShrink: 1, minWidth: 0 },
  checkout: { flexShrink: 0 },
  error: { color: color.destructive, fontSize: 13, textAlign: "center" },
  note: { color: color.mutedForeground, fontSize: 12, textAlign: "center" },
  pressed: { backgroundColor: color.accent },
  branch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.sm,
    flexShrink: 1,
    minWidth: 0,
  },
  branchLabel: { color: color.mutedForeground, fontSize: 13, flexShrink: 1 },
});
