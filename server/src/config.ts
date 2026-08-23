import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { getKv, setKv } from "./db.js";
import {
  knowsEffort,
  knowsModel,
  provider,
  providerEffort,
  providerId,
  providerModel,
  PROVIDERS,
  type ProviderId,
} from "./providers.js";
// Type-only, so this module keeps no runtime dependency on the one that runs a
// thread — chat.ts already depends on this one.
import type { ChatPermissionMode } from "./chat.js";

export { configDir } from "./paths.js";

export interface Config {
  port: number;
  token: string;
  // The context window the sessions on this host run with, for the context
  // meter. Transcripts record the model but not its window size, and the 1M
  // variants share a model id with the 200k ones — so a session running with a
  // larger window has to be declared here. Sessions self-correct upward once
  // they exceed this (or once one auto-compacts, which pins the real ceiling).
  contextLimit: number;
  /// How this machine holds an idle-sleep assertion (`caffeinate -i`).
  /// `always` lasts until you pick another option or the process dies.
  preventSleep: PreventSleepMode;
  /// Where a chat opens when its workspace has worktrees: the primary checkout,
  /// or a worktree of the branch you picked.
  defaultCheckout: CheckoutMode;
  /// What a new worktree branches from — the remote's copy of the default
  /// branch, or whatever the primary checkout is on right now.
  worktreeBase: WorktreeBase;
  /// Directory that holds Remy's `.remy` worktree folder. Empty means each
  /// workspace holds its own, at `<workspace>/.remy`.
  worktreeRoot: string;
  /// The model a new thread starts with, in `defaultProvider`'s own naming.
  /// Empty leaves the choice to whatever that tool is configured with.
  defaultModel: string;
  /// How much reasoning a new thread asks its selected model to use. Empty
  /// leaves the choice to that provider's configuration.
  defaultEffort: string;
  /// What a new thread and every inherited agent thinks with. The pair is
  /// validated together: a provider only ever holds one of its own models.
  defaultProvider: ProviderId;
  /// Providers offered for new work on this machine. Existing threads keep
  /// their provider so their history remains readable.
  enabledProviders: ProviderId[];
  /// What a new thread may do without being asked. An agent or the thread
  /// itself can still say otherwise; this is where one starts when neither has.
  defaultPermissionMode: ChatPermissionMode;
  /// The face on your messages: empty for the default, `preset:<id>` for one
  /// of the built-in ones, or a `data:` URL for a picture you chose.
  avatar: string;
  /// How this machine introduces itself to a newly paired device. Empty values
  /// fall back to the hostname and the ordinary laptop mark.
  deviceName: string;
  deviceIcon: string;
  deviceTint: string;
  /// What Remy puts in front of a branch it creates for a worktree. Seeded
  /// from the GitHub login at boot, so a branch someone else sees says who
  /// made it.
  worktreeBranchPrefix: string;
  /// Whoever this machine is signed in as on GitHub, read from `gh` at boot.
  /// An agent's commit address is built from it, so a commit says both which
  /// agent wrote it and whose account stood behind the machine that ran it.
  githubLogin: string;
  /// How often Remy refreshes the repositories it knows about. `off` never
  /// does, which is the setting for anyone who wants git touched only by them.
  repoUpdate: RepoUpdateEvery;
  /// Who every inherited agent's commits credit. `off` keeps this machine's
  /// git identity; `author` credits the agent while leaving you as committer.
  /// Attribution only — a git identity says who wrote a commit, never proves it.
  defaultGitIdentity: GitIdentity;
  /// Whether notifications raised on this machine are shown on this machine.
  /// Off routes them only to the paired devices that asked for them, which is
  /// the setting for a machine that runs the work while you watch from another.
  notifySelf: boolean;
  /// What Remy runs its own small jobs on — naming a thread, and whatever else
  /// comes to need a model later. Separate from `defaultModel`, which is what
  /// your threads think with: this one should stay cheap. `off` declines them
  /// altogether.
  remyProvider: ProviderId;
  remyModel: string;
  remyEffort: string;
  /// Models starred in the shared picker, stored as `provider:model` keys.
  favoriteModels: string[];
}

export type PreventSleepMode = "off" | "whileBusy" | "always";
export type CheckoutMode = "main" | "worktree";
export type WorktreeBase = "remote" | "local";
export type RepoUpdateEvery = "off" | "hourly" | "sixHourly" | "daily";
export type GitIdentity = "off" | "author";

/// Listed here rather than imported, so the type above can stay type-only. The
/// same shape `agents.ts` keeps, and for the same reason.
const PERMISSION_MODES: ChatPermissionMode[] = ["default", "auto", "acceptEdits", "plan", "bypassPermissions"];

const SLEEP_MODES: PreventSleepMode[] = ["off", "whileBusy", "always"];
const CHECKOUT_MODES: CheckoutMode[] = ["main", "worktree"];
const WORKTREE_BASES: WorktreeBase[] = ["remote", "local"];
const REPO_UPDATES: RepoUpdateEvery[] = ["off", "hourly", "sixHourly", "daily"];
const GIT_IDENTITIES: GitIdentity[] = ["off", "author"];
const DEVICE_ICONS = ["laptop", "monitor", "smartphone", "tablet", "server", "house"];
const DEVICE_TINTS = ["zinc", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink"];

function gitIdentity(value: unknown, fallback: GitIdentity): GitIdentity {
  // Older builds offered agent-as-committer. Keep those settings as agent
  // attribution while retiring the distinction from every current surface.
  if (value === "full") return "author";
  return oneOf(GIT_IDENTITIES, value, fallback);
}

/// How long between refreshes, or nothing when they are off.
export function repoUpdateInterval(every: RepoUpdateEvery): number | undefined {
  if (every === "hourly") return 60 * 60_000;
  if (every === "sixHourly") return 6 * 60 * 60_000;
  if (every === "daily") return 24 * 60 * 60_000;
  return undefined;
}
/// Which models each provider will answer to lives in `providers.ts`, so a
/// picker and this file cannot disagree about what is storable.
///
/// Remy's own jobs can also be declined outright, which a thread's model cannot.
const OFF = "off";

function preventSleepMode(value: unknown, legacyBusy?: unknown): PreventSleepMode {
  if (SLEEP_MODES.includes(value as PreventSleepMode)) return value as PreventSleepMode;
  return legacyBusy === true ? "whileBusy" : "off";
}

function oneOf<T extends string>(allowed: T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/// A model for Remy's own jobs, or `off`. Anything else falls back to that
/// provider's default rather than to a model it has never heard of.
function remyModelValue(provider: unknown, value: unknown): string {
  return value === OFF ? OFF : providerModel(provider, value);
}

/// The model a patch settles on.
///
/// A model this provider does not know keeps the one it had, like every other
/// setting here — except that "the one it had" may itself have belonged to the
/// other provider, and then it is that provider's default.
function modelFor(provider: ProviderId, asked: unknown, current: string): string {
  if (asked === undefined) return providerModel(provider, current);
  return knowsModel(provider, asked) ? String(asked) : providerModel(provider, current);
}

function effortFor(provider: ProviderId, model: string, asked: unknown, current: string): string {
  if (asked === undefined) return providerEffort(provider, model, current);
  return knowsEffort(provider, model, asked) ? String(asked) : providerEffort(provider, model, current);
}

function favoriteModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const split = entry.indexOf(":");
    if (split <= 0) return [];
    const provider = providerId(entry.slice(0, split));
    const model = entry.slice(split + 1);
    return model && knowsModel(provider, model) ? [`${provider}:${model}`] : [];
  }))].slice(0, 24);
}

function enabledProviders(value: unknown): ProviderId[] {
  if (!Array.isArray(value)) return PROVIDERS.map((entry) => entry.id);
  const enabled = [...new Set(value.flatMap((entry) => {
    const found = provider(entry);
    return found ? [found.id] : [];
  }))];
  return enabled.length > 0 ? enabled : [PROVIDERS[0].id];
}

/// A worktree root has to be somewhere `git worktree add` can actually write,
/// so it is an absolute path or nothing. `~` is expanded here because the
/// clients that set it are showing people a home-relative path.
export function worktreeRootPath(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const expanded = trimmed === "~" || trimmed.startsWith("~/")
    ? join(homedir(), trimmed.slice(1))
    : trimmed;
  return isAbsolute(expanded) ? expanded.replace(/\/+$/, "") : "";
}

/// A picture small enough to live in a settings row. Anything bigger is a
/// mistake rather than an avatar, and the client resizes before sending.
const MAX_AVATAR_BYTES = 96 * 1024;

/// Either one of the built-in faces or an image someone chose. A `data:` URL is
/// the only kind of image accepted: a remote one would phone out from a window
/// that otherwise never does.
export function avatarValue(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^preset:[a-z0-9-]{1,32}$/.test(trimmed)) return trimmed;
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(trimmed)) return "";
  return trimmed.length > MAX_AVATAR_BYTES ? "" : trimmed;
}

function deviceAppearanceValue(value: unknown, allowed: string[]): string {
  return typeof value === "string" && allowed.includes(value.trim()) ? value.trim() : "";
}

function deviceNameValue(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

/// A GitHub login, held to what GitHub itself allows. It ends up on the right
/// of an `@` in every commit an agent signs, so anything else is dropped rather
/// than passed through.
export function githubAccount(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(trimmed) ? trimmed : "";
}

/// A prefix has to survive `git check-ref-format`: no spaces, no leading or
/// trailing slash, none of the characters git reserves. Undefined when nothing
/// usable is left.
export function branchPrefix(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .trim()
    .replace(/[\s~^:?*[\\]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[/.]+|[/.]+$/g, "")
    .slice(0, 40);
  return cleaned || undefined;
}

function load(): Config {
  const parsed = getKv<Partial<Config> & { preventSleepWhileBusy?: boolean }>("config") ?? {};
  const enabled = enabledProviders(parsed.enabledProviders);
  const parsedDefaultProvider = providerId(parsed.defaultProvider);
  const defaultProvider = enabled.includes(parsedDefaultProvider) ? parsedDefaultProvider : enabled[0];
  const parsedRemyProvider = providerId(parsed.remyProvider);
  const remyProvider = enabled.includes(parsedRemyProvider) ? parsedRemyProvider : defaultProvider;
  const defaultModel = providerModel(defaultProvider, parsed.defaultModel);
  const remyModel = remyModelValue(remyProvider, parsed.remyModel ?? "haiku");
  const config: Config = {
    port: Number(parsed.port) || 8420,
    token: typeof parsed.token === "string" && parsed.token.length >= 32 ? parsed.token : randomBytes(32).toString("hex"),
    contextLimit: Number(parsed.contextLimit) > 0 ? Number(parsed.contextLimit) : 200_000,
    preventSleep: preventSleepMode(parsed.preventSleep, parsed.preventSleepWhileBusy),
    defaultCheckout: oneOf(CHECKOUT_MODES, parsed.defaultCheckout, "main"),
    worktreeBase: oneOf(WORKTREE_BASES, parsed.worktreeBase, "remote"),
    worktreeRoot: worktreeRootPath(parsed.worktreeRoot),
    defaultProvider,
    defaultModel,
    defaultEffort: providerEffort(defaultProvider, defaultModel, parsed.defaultEffort),
    enabledProviders: enabled,
    defaultPermissionMode: oneOf(PERMISSION_MODES, parsed.defaultPermissionMode, "default"),
    remyProvider,
    remyModel,
    remyEffort: remyModel === OFF ? "" : providerEffort(remyProvider, remyModel, parsed.remyEffort),
    favoriteModels: favoriteModels(parsed.favoriteModels),
    repoUpdate: oneOf(REPO_UPDATES, parsed.repoUpdate, "off"),
    defaultGitIdentity: gitIdentity(parsed.defaultGitIdentity, "author"),
    worktreeBranchPrefix: branchPrefix(parsed.worktreeBranchPrefix) ?? "",
    githubLogin: githubAccount(parsed.githubLogin),
    avatar: avatarValue(parsed.avatar),
    deviceName: deviceNameValue(parsed.deviceName),
    deviceIcon: deviceAppearanceValue(parsed.deviceIcon, DEVICE_ICONS),
    deviceTint: deviceAppearanceValue(parsed.deviceTint, DEVICE_TINTS),
    // Absent means this is the only device, so it is the one to buzz.
    notifySelf: parsed.notifySelf !== false,
  };
  setKv("config", config);
  return config;
}

export const config = load();

export interface PublicSettings {
  preventSleep: PreventSleepMode;
  defaultCheckout: CheckoutMode;
  worktreeBase: WorktreeBase;
  worktreeRoot: string;
  defaultModel: string;
  defaultEffort: string;
  defaultProvider: ProviderId;
  enabledProviders: ProviderId[];
  defaultPermissionMode: ChatPermissionMode;
  remyProvider: ProviderId;
  remyModel: string;
  remyEffort: string;
  favoriteModels: string[];
  repoUpdate: RepoUpdateEvery;
  worktreeBranchPrefix: string;
  avatar: string;
  deviceName: string;
  deviceIcon: string;
  deviceTint: string;
  defaultGitIdentity: GitIdentity;
  notifySelf: boolean;
}

export function publicSettings(): PublicSettings {
  return {
    preventSleep: config.preventSleep,
    defaultCheckout: config.defaultCheckout,
    worktreeBase: config.worktreeBase,
    worktreeRoot: config.worktreeRoot,
    defaultModel: config.defaultModel,
    defaultEffort: config.defaultEffort,
    defaultProvider: config.defaultProvider,
    enabledProviders: config.enabledProviders,
    defaultPermissionMode: config.defaultPermissionMode,
    remyProvider: config.remyProvider,
    remyModel: config.remyModel,
    remyEffort: config.remyEffort,
    favoriteModels: config.favoriteModels,
    repoUpdate: config.repoUpdate,
    worktreeBranchPrefix: config.worktreeBranchPrefix,
    avatar: config.avatar,
    deviceName: config.deviceName,
    deviceIcon: config.deviceIcon,
    deviceTint: config.deviceTint,
    defaultGitIdentity: config.defaultGitIdentity,
    notifySelf: config.notifySelf,
  };
}

/// Applies only the keys the caller actually sent, so a client that knows about
/// one setting cannot reset the rest to their defaults.
export function patchSettings(patch: Record<string, unknown>): PublicSettings {
  let touched = false;
  const set = <K extends keyof Config>(key: K, value: Config[K]) => {
    config[key] = value;
    touched = true;
  };

  if (patch.preventSleep !== undefined || patch.preventSleepWhileBusy !== undefined) {
    set("preventSleep", preventSleepMode(patch.preventSleep, patch.preventSleepWhileBusy));
  }
  if (patch.defaultCheckout !== undefined) {
    set("defaultCheckout", oneOf(CHECKOUT_MODES, patch.defaultCheckout, config.defaultCheckout));
  }
  if (patch.worktreeBase !== undefined) {
    set("worktreeBase", oneOf(WORKTREE_BASES, patch.worktreeBase, config.worktreeBase));
  }
  if (patch.worktreeRoot !== undefined) {
    set("worktreeRoot", worktreeRootPath(patch.worktreeRoot));
  }
  // A provider and a model are one choice, so they are validated as one: a
  // patch that moves to Codex and keeps `sonnet` lands on Codex's default
  // rather than on a model Codex has never heard of.
  if (patch.defaultProvider !== undefined || patch.defaultModel !== undefined || patch.defaultEffort !== undefined) {
    const asked = patch.defaultProvider === undefined
      ? config.defaultProvider
      : providerId(patch.defaultProvider, config.defaultProvider);
    const provider = config.enabledProviders.includes(asked) ? asked : config.defaultProvider;
    const model = modelFor(provider, patch.defaultModel, config.defaultModel);
    set("defaultProvider", provider);
    set("defaultModel", model);
    set("defaultEffort", effortFor(provider, model, patch.defaultEffort, config.defaultEffort));
  }
  if (patch.remyProvider !== undefined || patch.remyModel !== undefined || patch.remyEffort !== undefined) {
    const asked = patch.remyProvider === undefined
      ? config.remyProvider
      : providerId(patch.remyProvider, config.remyProvider);
    const provider = config.enabledProviders.includes(asked) ? asked : config.remyProvider;
    const model = patch.remyModel === OFF
      ? OFF
      : modelFor(provider, patch.remyModel, remyModelValue(provider, config.remyModel));
    set("remyProvider", provider);
    set("remyModel", model);
    set("remyEffort", model === OFF ? "" : effortFor(provider, model, patch.remyEffort, config.remyEffort));
  }
  if (patch.favoriteModels !== undefined) {
    set("favoriteModels", favoriteModels(patch.favoriteModels));
  }
  if (patch.defaultPermissionMode !== undefined) {
    set("defaultPermissionMode", oneOf(PERMISSION_MODES, patch.defaultPermissionMode, config.defaultPermissionMode));
  }
  if (patch.repoUpdate !== undefined) {
    set("repoUpdate", oneOf(REPO_UPDATES, patch.repoUpdate, config.repoUpdate));
  }
  if (patch.defaultGitIdentity !== undefined) {
    set("defaultGitIdentity", gitIdentity(patch.defaultGitIdentity, config.defaultGitIdentity));
  }
  if (patch.avatar !== undefined) {
    set("avatar", avatarValue(patch.avatar));
  }
  if (patch.deviceName !== undefined) {
    set("deviceName", deviceNameValue(patch.deviceName));
  }
  if (patch.deviceIcon !== undefined) {
    set("deviceIcon", deviceAppearanceValue(patch.deviceIcon, DEVICE_ICONS));
  }
  if (patch.deviceTint !== undefined) {
    set("deviceTint", deviceAppearanceValue(patch.deviceTint, DEVICE_TINTS));
  }
  if (patch.notifySelf !== undefined) {
    set("notifySelf", patch.notifySelf === true);
  }
  // Seeded from `gh` at boot rather than typed, but it has to be settable for
  // that seeding to persist it.
  if (patch.githubLogin !== undefined) {
    set("githubLogin", githubAccount(patch.githubLogin));
  }
  if (patch.worktreeBranchPrefix !== undefined) {
    // An unusable prefix falls back to Remy's own name rather than producing a
    // branch git will refuse to create.
    set("worktreeBranchPrefix", branchPrefix(patch.worktreeBranchPrefix) ?? "remy");
  }

  if (touched) setKv("config", config);
  return publicSettings();
}

export function setProviderEnabled(value: unknown, enabled: boolean): PublicSettings {
  const selected = provider(value);
  if (!selected) throw new Error("no such provider");
  const next = new Set(config.enabledProviders);
  if (enabled) next.add(selected.id);
  else next.delete(selected.id);
  if (next.size === 0) throw new Error("keep at least one provider on");
  config.enabledProviders = PROVIDERS.map((entry) => entry.id).filter((id) => next.has(id));
  if (!next.has(config.defaultProvider)) {
    config.defaultProvider = config.enabledProviders[0];
    config.defaultModel = "";
    config.defaultEffort = "";
  }
  if (!next.has(config.remyProvider)) {
    config.remyProvider = config.defaultProvider;
    if (config.remyModel !== OFF) {
      config.remyModel = config.defaultModel;
      config.remyEffort = config.defaultEffort;
    }
  }
  setKv("config", config);
  return publicSettings();
}
