import { create } from "zustand";
import type { Provider } from "~/lib/providers";
import { invalidateSharedResource, readSharedResource, seedSharedResource } from "~/lib/shared-read";
import { transport } from "~/lib/transport";
import { isHostedRuntime } from "~/lib/hub-session";
import { clearOptimisticUser, registerOptimisticUser, uniqueEntries } from "~/lib/thread-entry-merge";
import { readWarmCache } from "~/lib/warm-cache";
import { fixtureChats, fixtureServers, fixtureWorkspaces } from "./fixture";
import type {
  ArchivedThread,
  Chat,
  ChatApproval,
  ChatDetail,
  ChatCodeReference,
  ChatImageAttachment,
  ChatQuestionRequest,
  ChatState,
  ContextUsage,
  ConvEntry,
  ConvTodo,
  GitBranch,
  GitWorktree,
  PathSuggestion,
  ProviderMcpStatus,
  Server,
  ServerSettings,
  Tooling,
  UpdateRun,
  Workspace,
  WorkspaceIconMatch,
} from "./types";

/// The state the shared thread components read: servers, threads and
/// workspaces as a daemon reports them.
///
/// Nothing in the web app starts a daemon sync any more; the hosted app reads
/// the hub. The website's product preview seeds this store with sample state,
/// and the hosted app reads the few selectors its shared components use.

const useFixture = import.meta.env.VITE_MC_FIXTURE === "1";

interface RawChat {
  id: string;
  title: string;
  cwd: string;
  state?: ChatState;
  provider?: string;
  model?: string;
  effort?: string;
  preview?: string;
  createdAt?: number;
  updatedAt?: number;
  workingSince?: number | null;
  unread?: boolean;
  pinned?: boolean;
  parentChatId?: string;
}

interface RawArchive {
  id: string;
  chatId?: string;
  session: string;
  archivedAt: number;
  cwd?: string | null;
  agent?: string;
  summary?: boolean;
  conversation?: {
    title?: string;
    model?: string;
    effort?: string;
    permissionMode?: string;
    parentChatId?: string;
    entries?: ConvEntry[];
    todos?: ConvTodo[];
    context?: ContextUsage;
  };
}

interface RawWorkspace {
  id: string;
  name: string;
  path: string;
  origin?: string | null;
  icon?: string | null;
  tint?: string | null;
  provider?: string | null;
  model?: string | null;
  effort?: string | null;
  worktrees?: GitWorktree[];
  virtual?: boolean;
}

type ChatOptionPatch = {
  model?: string | null;
  effort?: string | null;
  permissionMode?: string;
};

export interface State {
  servers: Server[];
  chats: Chat[];
  archived: ArchivedThread[];
  workspaces: Workspace[];
  /// Every transcript currently mounted in the thread workspace. Keyed by id so
  /// parallel panes can stream independently without painting over each other.
  openIds: string[];
  details: Record<string, ChatDetail | undefined>;
  detailLoading: Record<string, boolean | undefined>;
  historyLoading: Record<string, boolean | undefined>;
  /// This machine's own settings and tool status. Both are read on demand by
  /// the panes that show them, not on every poll.
  settings?: ServerSettings;
  tooling?: Tooling;
  /// What this machine can run a thread on, as it reports it. Absent until a
  /// picker asks, and the built-in catalogue stands in until it answers.
  providers?: Provider[];
  /// Which ordinary provider sessions can use Remy's separately scoped MCP.
  mcpProviders?: Record<string, ProviderMcpStatus>;
  repoRun?: UpdateRun;
  /// A fleet catalogue read is still waiting on at least one device. This is
  /// separate from `loading`, which clears as soon as there is anything useful
  /// to paint.
  catalogLoading: boolean;
  loading: boolean;
  /// Set when every configured server failed, so the UI can say why rather than
  /// showing an empty list as though nothing were running.
  error?: string;
  connected: boolean;

  refresh(): Promise<void>;
  addWorkspace(input: { path: string; name?: string; serverId?: string }): Promise<void>;
  updateWorkspace(
    id: string,
    patch: { name?: string; icon?: string | null; tint?: string | null; provider?: string | null; model?: string | null; effort?: string | null },
  ): Promise<void>;
  removeWorkspace(id: string): Promise<void>;
  suggestPaths(query: string, serverId?: string): Promise<PathSuggestion[]>;
  suggestWorkspaceIcons(id: string, query: string): Promise<WorkspaceIconMatch[]>;
  workspaceFile(id: string, path: string): Promise<{ mime: string; data: string } | undefined>;
  loadWorkspaceWorktrees(id: string, serverId?: string): Promise<GitWorktree[]>;
  cleanWorkspaceWorktree(id: string, path: string, force: boolean, serverId?: string): Promise<GitWorktree[]>;
  listBranches(workspaceId: string): Promise<GitBranch[]>;
  checkoutBranch(input: {
    workspaceId: string;
    branch: string;
    mode: "main" | "worktree";
  }): Promise<{ path: string }>;
  createChat(input: {
    cwd: string;
    text: string;
    serverId?: string;
    provider?: string;
    model?: string;
    effort?: string;
    permissionMode?: string;
  }): Promise<{ id: string; serverId: string }>;
  createSubthread(input: {
    parentId: string;
    text: string;
    includeParent: boolean;
  }): Promise<Chat>;
  loadSettings(): Promise<void>;
  saveSettings(patch: Partial<ServerSettings>): Promise<void>;
  loadTooling(): Promise<void>;
  loadProviders(): Promise<void>;
  setProviderEnabled(provider: string, enabled: boolean): Promise<void>;
  loadMcpProviders(): Promise<void>;
  installProviderMcp(provider: string): Promise<void>;
  removeProviderMcp(provider: string): Promise<void>;
  useGithubAvatar(): Promise<void>;
  loadRepoRun(): Promise<void>;
  updateRepos(): Promise<void>;
  openChat(id: string): Promise<void>;
  loadEarlierEntries(id: string): Promise<void>;
  closeChat(id: string): void;
  uploadMessageImage(id: string, file: File): Promise<ChatImageAttachment>;
  sendMessage(id: string, text: string, attachments?: ChatImageAttachment[], codeReferences?: ChatCodeReference[]): Promise<void>;
  answerApproval(id: string, requestId: string, decision: "allow" | "allowAlways" | "deny"): Promise<void>;
  answerQuestion(id: string, requestId: string, answers: Record<string, unknown>): Promise<void>;
  interrupt(id: string): Promise<void>;
  setChatOptions(id: string, patch: ChatOptionPatch): Promise<void>;
  pinThread(id: string, pinned: boolean): Promise<void>;
  renameThread(id: string, title: string): Promise<void>;
  archiveThread(id: string): Promise<void>;
  loadArchivedThread(id: string, serverId: string): Promise<void>;
  restoreThread(id: string, serverId: string): Promise<Chat>;
  deleteArchivedThread(id: string, serverId: string): Promise<void>;
  deleteThread(id: string): Promise<void>;

  /// Clears a thread's unread mark.
  readChat(id: string): Promise<void>;
}

const DETAIL_CACHE_LIMIT = 12;
const CHAT_PAGE_TURNS = 10;
const detailCache = new Map<string, ChatDetail>();
const pendingDetails = new Map<string, Promise<ChatDetail>>();
const chatOptionVersions = new Map<string, number>();
const pendingChatOptionValues = new Map<string, unknown>();
const sidebarProjectionServers = new Set<string>();
const sidebarSequences = new Map<string, number>();
const detailSubscriptions = new Map<string, () => void>();
const detailOwners = new Map<string, number>();
let refreshRun = 0;
let pendingRefresh: Promise<void> | undefined;
let refreshAgain = false;

/// What the last window left behind, read once so the first render already has
/// devices, threads and the transcripts that were open. Everything here is
/// replaced by the reads `start` fires immediately after.
///
/// The transcripts go into `detailCache` oldest first, so the most recent one in
/// the snapshot is the most recent one here too.
const warm = useFixture || isHostedRuntime() ? undefined : readWarmCache();
for (const detail of [...(warm?.details ?? [])].reverse()) cacheDetail(detail);

function detailKey(id: string, serverId: string): string {
  return `${serverId}:${id}`;
}

function cacheDetail(detail: ChatDetail): void {
  const key = detailKey(detail.id, detail.serverId);
  detailCache.delete(key);
  detailCache.set(key, detail);
  while (detailCache.size > DETAIL_CACHE_LIMIT) {
    const oldest = detailCache.keys().next().value;
    if (oldest === undefined) break;
    detailCache.delete(oldest);
  }
}

async function readChatDetail(id: string, serverId: string): Promise<ChatDetail> {
  const key = detailKey(id, serverId);
  const existing = pendingDetails.get(key);
  if (existing) return existing;
  const pending = transport.request<RawChatDetail>(
    serverId,
    `/chats/${encodeURIComponent(id)}?turns=${CHAT_PAGE_TURNS}`,
  )
    .then((raw) => {
      const detail = toDetail(raw, serverId);
      cacheDetail(detail);
      return detail;
    })
    .finally(() => {
      if (pendingDetails.get(key) === pending) pendingDetails.delete(key);
    });
  pendingDetails.set(key, pending);
  return pending;
}

export const useStore = create<State>((set, get) => ({
  servers: useFixture ? fixtureServers : warm?.servers ?? [],
  chats: useFixture ? fixtureChats : warm?.chats ?? [],
  archived: [],
  workspaces: useFixture ? fixtureWorkspaces : warm?.workspaces ?? [],
  // A warm window has something to show while every device is still answering,
  // so it is not "Connecting…" — but the catalogue is still out, and that is a
  // separate flag for a separate reason.
  catalogLoading: !useFixture,
  openIds: [],
  details: {},
  detailLoading: {},
  historyLoading: {},
  loading: !useFixture && !warm,
  connected: useFixture,

  async refresh() {
    if (useFixture) return;
    if (pendingRefresh) {
      refreshAgain = true;
      return pendingRefresh;
    }
    const pending = (async () => {
      const run = ++refreshRun;
      set({ catalogLoading: true });
      if (get().servers.length === 0) set({ loading: true });

      let servers: Server[];
      try {
        servers = await transport.servers();
      } catch (error) {
        if (run === refreshRun) set((current) => ({
          catalogLoading: false,
          loading: false,
          connected: false,
          servers: current.servers.map((server) => ({ ...server, online: false })),
          error: "Reconnect this machine to refresh its content.",
        }));
        throw error;
      }
      if (servers.length === 0) {
        set((current) => ({
          servers: current.servers.map((server) => ({ ...server, online: false })),
          loading: false,
          catalogLoading: run === refreshRun ? false : get().catalogLoading,
          connected: false,
          error: current.servers.length > 0 ? "Reconnect a device to refresh its content." : undefined,
        }));
        return;
      }

      // The device list itself is known now, so it lands before anything is
      // asked of any of them. A machine that has gone away takes its threads and
      // its workspaces with it rather than leaving them behind.
      const known = new Set(servers.map((server) => server.id));
      set((current) => ({
        servers: mergeDiscoveredServers(current.servers, servers),
        chats: keepKnownServers(current.chats, known),
        archived: keepKnownServers(current.archived, known),
        workspaces: keepKnownServers(current.workspaces, known),
      }));

      // Every resource lands independently. A large or unavailable archive
      // must never hold a healthy active-thread catalogue off the screen.
      const failures = new Map<string, string>();
      await Promise.all(
        servers.flatMap((server) => {
          const chats = transport
            .request<{ chats?: RawChat[]; dms?: RawChat[]; sequence?: number; projection?: boolean }>(server.id, "/chats")
            .catch((error: unknown) => {
                // An older server has no /chats; that is not an error worth showing.
                const message = error instanceof Error ? error.message : String(error);
                if (!/\b404\b/.test(message)) throw error;
                return { chats: [] } as {
                  chats?: RawChat[];
                  dms?: RawChat[];
                  sequence?: number;
                  projection?: boolean;
                };
            })
            .then((listed) => {
              if (listed.projection) sidebarProjectionServers.add(server.id);
              const snapshotSequence = typeof listed.sequence === "number" ? listed.sequence : undefined;
              if (snapshotSequence !== undefined
                && snapshotSequence < (sidebarSequences.get(server.id) ?? -1)) return;
              if (snapshotSequence !== undefined) sidebarSequences.set(server.id, snapshotSequence);
              set((current) => ({
                // One machine answering is enough to stop saying "Connecting…":
                // there is something to show, and there is somewhere to type.
                loading: false,
                servers: setServerOnline(current.servers, server.id, true),
                chats: replaceServerChats(
                  current.chats,
                  server.id,
                  (listed.chats ?? []).map((raw) => toChat(raw, server.id)),
                ).sort(byNewest),
              }));
            })
            .catch((error) => {
              failures.set(server.id, `${server.name}: ${error instanceof Error ? error.message : String(error)}`);
              set((current) => ({ servers: setServerOnline(current.servers, server.id, false) }));
            });

          const archives = transport.request<{ archives?: RawArchive[] }>(server.id, "/archives?summary=1")
            .then((listed) => set((current) => ({
              archived: [
                ...current.archived.filter((chat) => chat.serverId !== server.id),
                ...(listed.archives ?? []).map((raw) => toArchivedThread(raw, server.id)),
              ].sort((a, b) => b.archivedAt - a.archivedAt),
            })))
            .catch(() => {});

          const workspaces = transport.request<{ workspaces?: RawWorkspace[] }>(server.id, "/workspaces")
            .then((listed) => set((current) => ({
              workspaces: [
                ...current.workspaces.filter((workspace) => workspace.serverId !== server.id),
                ...(listed.workspaces ?? []).map((raw) => toWorkspace(raw, server.id)),
              ],
            })))
            .catch(() => {});

          return [chats, archives, workspaces];
        }),
      );

      set((current) => ({
        loading: false,
        catalogLoading: run === refreshRun ? false : current.catalogLoading,
        error: failures.size === servers.length ? [...failures.values()].join("; ") : undefined,
        connected: current.servers.some((server) => server.online),
      }));
    })();
    pendingRefresh = pending;
    try {
      await pending;
    } finally {
      if (pendingRefresh === pending) pendingRefresh = undefined;
      if (refreshAgain) {
        refreshAgain = false;
        void get().refresh();
      }
    }
  },

  async addWorkspace(input) {
    const path = input.path.trim();
    const name = input.name?.trim() || nameFromPath(path);
    if (!name) throw new Error("Pick a folder to add.");

    if (useFixture) {
      const serverId = input.serverId
        ?? get().servers.find((server) => server.local)?.id
        ?? get().servers[0]?.id
        ?? "studio";
      set((current) => ({
        workspaces: [
          ...current.workspaces.filter((workspace) => !(workspace.serverId === serverId && workspace.path === path)),
          { id: crypto.randomUUID(), serverId, name, path, origin: null, worktrees: [] },
        ],
      }));
      return;
    }

    const server = get().servers.find((entry) => entry.id === input.serverId) ?? localServer(get().servers);
    if (!server) throw new Error("This machine isn't connected.");
    await transport.request(server.id, "/workspaces", { method: "POST", body: { name, path } });
    await get().refresh();
  },

  async updateWorkspace(id, patch) {
    if (useFixture) {
      set((current) => ({
        workspaces: current.workspaces.map((workspace) => (workspace.id === id ? { ...workspace, ...patch } : workspace)),
      }));
      return;
    }
    const workspace = get().workspaces.find((entry) => entry.id === id);
    const server = get().servers.find((entry) => entry.id === workspace?.serverId) ?? localServer(get().servers);
    if (!server) throw new Error("This machine isn't connected.");
    // The machine has the last word on what was stored — a model the workspace's
    // provider would refuse comes back dropped — so the answer is what lands
    // here rather than what was asked for.
    const saved = await transport.request<{ workspace?: RawWorkspace }>(
      server.id,
      `/workspaces/${encodeURIComponent(id)}`,
      { method: "PATCH", body: patch },
    );
    const next = saved.workspace ? toWorkspace(saved.workspace, server.id) : undefined;
    set((current) => ({
      workspaces: current.workspaces.map((entry) =>
        entry.id === id ? (next ? { ...entry, ...next } : { ...entry, ...patch }) : entry),
    }));
  },

  async removeWorkspace(id) {
    if (useFixture) {
      set((current) => ({ workspaces: current.workspaces.filter((workspace) => workspace.id !== id) }));
      return;
    }
    const workspace = get().workspaces.find((entry) => entry.id === id);
    const server = get().servers.find((entry) => entry.id === workspace?.serverId) ?? localServer(get().servers);
    if (!server) throw new Error("This machine isn't connected.");
    await transport.request(server.id, `/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" });
    await get().refresh();
  },

  async suggestPaths(query, serverId) {
    if (useFixture) return [];
    const server = get().servers.find((entry) => entry.id === serverId) ?? localServer(get().servers);
    if (!server?.online) return [];
    try {
      const listed = await transport.request<{ paths?: PathSuggestion[] }>(
        server.id,
        `/paths?q=${encodeURIComponent(query)}`,
      );
      return listed.paths ?? [];
    } catch {
      return [];
    }
  },

  async suggestWorkspaceIcons(id, query) {
    if (useFixture) return [];
    const workspace = get().workspaces.find((entry) => entry.id === id);
    const server = get().servers.find((entry) => entry.id === workspace?.serverId) ?? localServer(get().servers);
    if (!server?.online) return [];
    try {
      const listed = await transport.request<{ icons?: WorkspaceIconMatch[] }>(
        server.id,
        `/workspaces/${encodeURIComponent(id)}/icons?q=${encodeURIComponent(query)}`,
      );
      return listed.icons ?? [];
    } catch {
      return [];
    }
  },

  async workspaceFile(id, path) {
    if (useFixture) return undefined;
    const workspace = get().workspaces.find((entry) => entry.id === id);
    const server = get().servers.find((entry) => entry.id === workspace?.serverId) ?? localServer(get().servers);
    if (!server?.online) return undefined;
    try {
      const file = await transport.request<{ mime?: string; data?: string }>(
        server.id,
        `/workspaces/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`,
      );
      if (!file.mime || !file.data) return undefined;
      return { mime: file.mime, data: file.data };
    } catch {
      return undefined;
    }
  },

  async loadWorkspaceWorktrees(id, serverId) {
    const workspace = get().workspaces.find((entry) => entry.id === id && (!serverId || entry.serverId === serverId));
    if (!workspace) throw new Error("This workspace is no longer available.");
    if (useFixture) return workspace.worktrees;
    const server = get().servers.find((entry) => entry.id === workspace.serverId);
    if (!server?.online) throw new Error("This device isn't connected.");
    const listed = await transport.request<{ dirty?: Record<string, boolean>; worktrees?: GitWorktree[] }>(
      server.id,
      `/workspaces/${encodeURIComponent(id)}/dirty`,
    );
    const dirty = listed.dirty ?? {};
    const worktrees = listed.worktrees ?? workspace.worktrees.filter((tree) => tree.path in dirty).map((worktree) => ({
      ...worktree,
      dirty: dirty[worktree.path] ?? true,
    }));
    set((current) => ({
      workspaces: current.workspaces.map((entry) =>
        entry.id === id && entry.serverId === server.id ? { ...entry, worktrees } : entry),
    }));
    return worktrees;
  },

  async cleanWorkspaceWorktree(id, path, force, serverId) {
    const workspace = get().workspaces.find((entry) => entry.id === id && (!serverId || entry.serverId === serverId));
    if (!workspace) throw new Error("This workspace is no longer available.");
    if (useFixture) {
      const target = workspace.worktrees.find((worktree) => worktree.path === path);
      if (!target || target.isMain) throw new Error("Only linked worktrees can be cleaned up.");
      if (target.dirty && !force) throw new Error("Commit or stash your changes before cleaning up this worktree.");
      const worktrees = workspace.worktrees.filter((worktree) => worktree.path !== path);
      set((current) => ({
        workspaces: current.workspaces.map((entry) => entry.id === id ? { ...entry, worktrees } : entry),
      }));
      return worktrees;
    }
    const server = get().servers.find((entry) => entry.id === workspace.serverId);
    if (!server?.online) throw new Error("This device isn't connected.");
    const result = await transport.request<{ closedPaths: string[] }>(
      server.id,
      `/workspaces/${encodeURIComponent(id)}/worktrees/close`,
      { method: "POST", body: { path, force } },
    );
    const worktrees = workspace.worktrees.filter((tree) => !result.closedPaths.includes(tree.path));
    set((current) => ({ workspaces: current.workspaces.map((entry) =>
      entry.id === id && entry.serverId === server.id ? { ...entry, worktrees } : entry),
    }));
    return worktrees;
  },

  async listBranches(workspaceId) {
    const workspace = get().workspaces.find((entry) => entry.id === workspaceId);
    const fromTrees = branchesFromWorktrees(workspace);
    if (useFixture) return fromTrees;
    const server = get().servers.find((entry) => entry.id === workspace?.serverId) ?? localServer(get().servers);
    if (!server) throw new Error("This machine isn't connected.");
    try {
      const listed = await transport.request<{ branches?: GitBranch[] }>(
        server.id,
        `/workspaces/${encodeURIComponent(workspaceId)}/branches`,
      );
      return listed.branches ?? fromTrees;
    } catch {
      return fromTrees;
    }
  },

  async checkoutBranch(input) {
    const workspace = get().workspaces.find((entry) => entry.id === input.workspaceId);
    const main = workspace?.worktrees.find((tree) => tree.isMain);
    if (input.mode === "main" && main && main.branch === input.branch) {
      return { path: main.path };
    }
    if (input.mode === "worktree") {
      const existing = workspace?.worktrees.find((tree) => tree.branch === input.branch && !tree.isMain);
      if (existing) return { path: existing.path };
    }
    if (useFixture) {
      return { path: main?.path ?? workspace?.path ?? "~" };
    }
    const server = get().servers.find((entry) => entry.id === workspace?.serverId) ?? localServer(get().servers);
    if (!server) throw new Error("This machine isn't connected.");
    const result = await transport.request<{ path?: string }>(
      server.id,
      `/workspaces/${encodeURIComponent(input.workspaceId)}/checkout`,
      { method: "POST", body: { branch: input.branch, mode: input.mode } },
    );
    await get().refresh();
    if (!result.path) throw new Error("Couldn't switch to that branch.");
    return { path: result.path };
  },

  async createChat(input) {
    const text = input.text.trim();
    if (!text) throw new Error("Write a message first.");
    const cwd = input.cwd.trim() || "~";
    const title = text.split("\n")[0]?.slice(0, 80) || "New thread";

    if (useFixture) {
      const serverId = input.serverId
        ?? preferredServer(get().servers)?.id
        ?? get().servers[0]?.id
        ?? "studio";
      const chat: Chat = {
        id: crypto.randomUUID(),
        serverId,
        title,
        cwd,
        state: "working",
        preview: text,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      set((current) => ({
        chats: [chat, ...current.chats].sort(byNewest),
        details: {
          ...current.details,
          [chat.id]: { ...chat, permissionMode: input.permissionMode, entries: [], todos: [] },
        },
      }));
      return { id: chat.id, serverId };
    }

    const server = get().servers.find((entry) => entry.id === input.serverId)
      ?? preferredServer(get().servers)
      ?? localServer(get().servers);
    if (!server) throw new Error("This machine isn't connected.");
    const created = await transport.request<{ chat?: RawChat }>(server.id, "/chats", {
      method: "POST",
      body: {
        cwd,
        title,
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.effort !== undefined ? { effort: input.effort } : {}),
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      },
    });
    if (!created.chat?.id) throw new Error("Couldn't start that thread.");
    const chat = toChat(created.chat, server.id);
    const detail: ChatDetail = {
      ...chat,
      permissionMode: input.permissionMode,
      entries: [],
      todos: [],
    };
    set((current) => ({
      chats: [chat, ...current.chats.filter((entry) => entry.id !== chat.id)].sort(byNewest),
      details: { ...current.details, [chat.id]: detail },
    }));
    return { id: chat.id, serverId: server.id };
  },

  async createSubthread(input) {
    const parent = get().chats.find((chat) => chat.id === input.parentId);
    if (!parent) throw new Error("That parent thread is no longer available.");
    if (parent.parentChatId) throw new Error("A subthread can't start another subthread.");
    const body = await transport.request<{ chat?: RawChat }>(
      parent.serverId,
      `/chats/${encodeURIComponent(parent.id)}/subthreads`,
      { method: "POST", body: { text: input.text, includeParent: input.includeParent } },
    );
    if (!body.chat) throw new Error("Couldn't start that subthread.");
    const child = toChat(body.chat, parent.serverId);
    set((current) => ({ chats: [...current.chats.filter((chat) => chat.id !== child.id), child] }));
    await get().refresh();
    return child;
  },

  async loadSettings() {
    const server = localServer(get().servers);
    if (!server) return;
    const settings = await readSharedResource(
      "settings",
      server.id,
      () => transport.request<ServerSettings>(server.id, "/server/settings"),
    );
    set({ settings });
  },

  async saveSettings(patch) {
    const server = localServer(get().servers);
    if (!server) throw new Error("This machine isn't connected.");
    // The server answers with the whole settings object, so what lands in the
    // store is what it actually stored rather than what was asked for.
    const settings = await transport.request<ServerSettings>(server.id, "/server/settings", {
      method: "PATCH",
      body: patch,
    });
    seedSharedResource("settings", server.id, settings);
    set({ settings });
  },

  async loadTooling() {
    const server = localServer(get().servers);
    if (!server) return;
    set({ tooling: await transport.request<Tooling>(server.id, "/server/tooling") });
  },

  async loadProviders() {
    const server = localServer(get().servers);
    if (!server) return;
    const body = await readSharedResource(
      "providers",
      server.id,
      () => transport.request<{ providers?: Provider[] }>(server.id, "/server/providers"),
    );
    if (body.providers?.length) set({ providers: body.providers });
  },

  async setProviderEnabled(provider, enabled) {
    const server = localServer(get().servers);
    if (!server) throw new Error("This machine isn't connected.");
    const settings = await transport.request<ServerSettings>(
      server.id,
      `/server/providers/${encodeURIComponent(provider)}`,
      { method: "PATCH", body: { enabled } },
    );
    seedSharedResource("settings", server.id, settings);
    invalidateSharedResource("providers", server.id);
    set({ settings });
    await get().loadProviders();
    await get().refresh();
  },

  async loadMcpProviders() {
    const server = localServer(get().servers);
    if (!server) return;
    const body = await transport.request<{ providers?: ProviderMcpStatus[] }>(server.id, "/server/mcp");
    set({
      mcpProviders: Object.fromEntries((body.providers ?? []).map((entry) => [entry.provider, entry])),
    });
  },

  async installProviderMcp(provider) {
    const server = localServer(get().servers);
    if (!server) throw new Error("This machine isn't connected.");
    const status = await transport.request<ProviderMcpStatus>(
      server.id,
      `/server/mcp/${encodeURIComponent(provider)}`,
      { method: "POST", body: {} },
    );
    set((current) => ({
      mcpProviders: { ...current.mcpProviders, [provider]: status },
    }));
  },

  async removeProviderMcp(provider) {
    const server = localServer(get().servers);
    if (!server) throw new Error("This machine isn't connected.");
    const status = await transport.request<ProviderMcpStatus>(
      server.id,
      `/server/mcp/${encodeURIComponent(provider)}`,
      { method: "DELETE", body: {} },
    );
    set((current) => ({
      mcpProviders: { ...current.mcpProviders, [provider]: status },
    }));
  },

  async useGithubAvatar() {
    const server = localServer(get().servers);
    if (!server) throw new Error("This machine isn't connected.");
    const settings = await transport.request<ServerSettings>(server.id, "/server/avatar/github", {
      method: "POST",
      body: {},
    });
    set({ settings });
  },

  async loadRepoRun() {
    const server = localServer(get().servers);
    if (!server) return;
    const body = await transport.request<{ run?: UpdateRun | null }>(server.id, "/server/repo-update");
    set({ repoRun: body.run ?? undefined });
  },

  async updateRepos() {
    const server = localServer(get().servers);
    if (!server) throw new Error("This machine isn't connected.");
    const body = await transport.request<{ run?: UpdateRun }>(server.id, "/server/repo-update", {
      method: "POST",
      body: {},
    });
    set({ repoRun: body.run });
    // A fetch can leave a workspace on a different commit, and a fast-forward
    // certainly does.
    await get().refresh();
  },

  async openChat(id) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) return;
    const cached = detailCache.get(detailKey(id, chat.serverId));
    if (cached) cacheDetail(cached);
    const same = get().details[id]?.id === id;
    detailOwners.set(id, (detailOwners.get(id) ?? 0) + 1);
    if (!detailSubscriptions.has(id)) {
      detailSubscriptions.set(id, transport.subscribe(() => {}, [`thread:${id}`]));
    }
    set((current) => ({
      openIds: current.openIds.includes(id) ? current.openIds : [...current.openIds, id],
      detailLoading: { ...current.detailLoading, [id]: !same && !cached },
      ...(same ? {} : { details: { ...current.details, [id]: cached } }),
    }));

    if (useFixture) {
      set((current) => ({
        details: { ...current.details, [id]: { ...chat, entries: [], todos: [] } },
        detailLoading: { ...current.detailLoading, [id]: false },
      }));
      return;
    }

    try {
      const next = await readChatDetail(id, chat.serverId);
      if (!get().openIds.includes(id)) return;
      set((current) => ({
        details: { ...current.details, [id]: mergeDetailRefresh(current.details[id], next) },
        detailLoading: { ...current.detailLoading, [id]: false },
      }));
    } catch (error) {
      if (!get().openIds.includes(id)) return;
      set((current) => ({ detailLoading: { ...current.detailLoading, [id]: false } }));
      throw error;
    }
  },

  async loadEarlierEntries(id) {
    const detail = get().details[id];
    const before = detail?.history?.before;
    if (!detail || !detail.history?.hasEarlier || !before || get().historyLoading[id]) return;
    set((current) => ({ historyLoading: { ...current.historyLoading, [id]: true } }));
    try {
      const raw = await transport.request<RawChatDetail>(
        detail.serverId,
        `/chats/${encodeURIComponent(id)}?turns=${CHAT_PAGE_TURNS}&before=${encodeURIComponent(before)}`,
      );
      const page = toDetail(raw, detail.serverId);
      set((current) => {
        const latest = current.details[id];
        if (!latest || latest.serverId !== detail.serverId) {
          return { historyLoading: { ...current.historyLoading, [id]: false } };
        }
        const known = new Set(latest.entries.map((entry) => entry.id));
        const entries = [...page.entries.filter((entry) => !known.has(entry.id)), ...latest.entries];
        const next = { ...latest, entries, history: page.history };
        cacheDetail(next);
        return {
          details: { ...current.details, [id]: next },
          historyLoading: { ...current.historyLoading, [id]: false },
        };
      });
    } catch (error) {
      set((current) => ({ historyLoading: { ...current.historyLoading, [id]: false } }));
      throw error;
    }
  },

  closeChat(id) {
    const owners = Math.max(0, (detailOwners.get(id) ?? 0) - 1);
    if (owners > 0) {
      detailOwners.set(id, owners);
      return;
    }
    detailOwners.delete(id);
    detailSubscriptions.get(id)?.();
    detailSubscriptions.delete(id);
    set((current) => {
      const details = { ...current.details };
      const loading = { ...current.detailLoading };
      const historyLoading = { ...current.historyLoading };
      delete details[id];
      delete loading[id];
      delete historyLoading[id];
      return {
        openIds: current.openIds.filter((openId) => openId !== id),
        details,
        detailLoading: loading,
        historyLoading,
      };
    });
  },

  async uploadMessageImage(id, file) {
    const detail = get().details[id];
    if (!detail) throw new Error("Open a thread before attaching an image.");
    const body = await transport.upload<{ attachment?: ChatImageAttachment }>(
      detail.serverId,
      `/chats/${encodeURIComponent(detail.id)}/upload`,
      { file },
    );
    if (!body.attachment) throw new Error("That image didn't finish uploading.");
    return body.attachment;
  },

  async sendMessage(id, text, attachments = [], codeReferences = []) {
    const detail = get().details[id];
    const trimmed = text.trim();
    if (!detail || (!trimmed && codeReferences.length === 0)) return;
    const messageId = `u-${crypto.randomUUID()}`;
    const shownText = trimmed || "Review these comments.";
    const optimisticAt = Date.now();
    const optimistic: ConvEntry = {
      id: messageId,
      kind: "user",
      at: optimisticAt,
      text: shownText,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(codeReferences.length > 0 ? { codeReferences } : {}),
    };
    registerOptimisticUser(detail.id, detail.serverId, optimistic);
    const previousRow = get().chats.find((chat) => chat.id === id && chat.serverId === detail.serverId);
    set((current) => ({
      details: {
        ...current.details,
        [id]: { ...current.details[id]!, entries: [...current.details[id]!.entries, optimistic] },
      },
      chats: current.chats.map((chat) => chat.id === id && chat.serverId === detail.serverId
        ? { ...chat, preview: shownText, state: "working", updatedAt: optimisticAt }
        : chat),
    }));
    try {
      const accepted = await transport.request<{ chat?: RawChatDetail }>(detail.serverId, `/chats/${encodeURIComponent(detail.id)}/message`, {
        method: "POST",
        body: { messageId, text: trimmed, attachments, codeReferences },
      });
      if (accepted.chat) {
        const fresh = toDetail(accepted.chat, detail.serverId);
        set((current) => ({
          details: current.details[detail.id]
            ? { ...current.details, [detail.id]: mergeDetailRefresh(current.details[detail.id], fresh) }
            : current.details,
        }));
      }
    } catch (error) {
      clearOptimisticUser(messageId);
      set((current) => ({
        details: current.details[id]?.entries.some((entry) => entry.id === messageId)
          ? {
              ...current.details,
              [id]: {
                ...current.details[id]!,
                entries: current.details[id]!.entries.filter((entry) => entry.id !== messageId),
              },
            }
          : current.details,
        ...(previousRow
          ? { chats: current.chats.map((chat) => chat.id === id && chat.serverId === detail.serverId ? previousRow : chat) }
          : {}),
      }));
      throw error;
    }
    // The server echoes the message back as a `chat` frame. With the socket
    // down there is no frame coming, so read the feed once instead.
    try {
      if (!get().connected) {
        const fresh = await readChatDetail(detail.id, detail.serverId);
        if (get().openIds.includes(detail.id)) {
          set((current) => ({
            details: { ...current.details, [detail.id]: mergeDetailRefresh(current.details[detail.id], fresh) },
            detailLoading: { ...current.detailLoading, [detail.id]: false },
          }));
        }
      }
    } finally {
      clearOptimisticUser(messageId);
    }
  },

  async answerApproval(id, requestId, decision) {
    const detail = get().details[id];
    if (!detail) return;
    await transport.request(detail.serverId, `/chats/${encodeURIComponent(detail.id)}/approval`, {
      method: "POST",
      body: { requestId, decision },
    });
  },

  async answerQuestion(id, requestId, answers) {
    const detail = get().details[id];
    if (!detail) return;
    await transport.request(detail.serverId, `/chats/${encodeURIComponent(detail.id)}/question`, {
      method: "POST",
      body: { requestId, answers },
    });
  },

  async archiveThread(id) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) return;
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}/archive`, {
      method: "POST",
      body: {},
    });
    detailCache.delete(detailKey(id, chat.serverId));
    await get().refresh();
  },

  async pinThread(id, pinned) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) return;
    const previous = chat.pinned;
    set((current) => ({
      chats: current.chats.map((entry) => entry.id === id ? { ...entry, pinned } : entry),
    }));
    try {
      await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { pinned },
      });
      await get().refresh();
    } catch (error) {
      set((current) => ({
        chats: current.chats.map((entry) => entry.id === id && entry.pinned === pinned
          ? { ...entry, pinned: previous }
          : entry),
      }));
      throw error;
    }
  },

  async renameThread(id, title) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) throw new Error("This thread is no longer available.");
    const previous = chat.title;
    set((current) => ({
      chats: current.chats.map((entry) => entry.id === id ? { ...entry, title } : entry),
      details: current.details[id] ? { ...current.details, [id]: { ...current.details[id], title } } : current.details,
    }));
    try {
      const response = await transport.request<{ chat: RawChat }>(chat.serverId, `/chats/${encodeURIComponent(id)}`, {
        method: "PATCH", body: { title },
      });
      set((current) => ({
        chats: current.chats.map((entry) => entry.id === id ? { ...entry, title: response.chat.title } : entry),
        details: current.details[id] ? { ...current.details, [id]: { ...current.details[id], title: response.chat.title } } : current.details,
      }));
      detailCache.delete(detailKey(id, chat.serverId));
    } catch (error) {
      set((current) => ({
        chats: current.chats.map((entry) => entry.id === id && entry.title === title ? { ...entry, title: previous } : entry),
        details: current.details[id]?.title === title
          ? { ...current.details, [id]: { ...current.details[id], title: previous } }
          : current.details,
      }));
      throw error;
    }
  },

  async restoreThread(id, serverId) {
    const body = await transport.request<{ chat: RawChat }>(
      serverId,
      `/archives/${encodeURIComponent(id)}/restore`,
      { method: "POST", body: {} },
    );
    await get().refresh();
    return toChat(body.chat, serverId);
  },

  async loadArchivedThread(id, serverId) {
    const current = get().archived.find((thread) => thread.id === id && thread.serverId === serverId);
    if (!current || current.detailLoaded) return;
    const body = await transport.request<{ archive?: RawArchive }>(
      serverId,
      `/archives/${encodeURIComponent(id)}`,
    );
    if (!body.archive) return;
    const archive = toArchivedThread(body.archive, serverId);
    set((state) => ({
      archived: state.archived.map((entry) => entry.id === id && entry.serverId === serverId ? archive : entry),
    }));
  },

  async deleteArchivedThread(id, serverId) {
    await transport.request(serverId, `/archives/${encodeURIComponent(id)}`, { method: "DELETE" });
    await get().refresh();
  },

  async deleteThread(id) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) return;
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
    detailCache.delete(detailKey(id, chat.serverId));
    await get().refresh();
  },

  async readChat(id) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat?.unread) return;
    // Cleared here first: the row should stop being bold the moment you open
    // it, not when the machine gets back to us.
    set((current) => ({
      chats: current.chats.map((entry) => (entry.id === id ? { ...entry, unread: false } : entry)),
    }));
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}/read`, { method: "POST" })
      .catch(() => {
        // A mark that did not save comes back on the next refresh, which is a
        // smaller wrong than a toast about a bold row.
      });
  },

  async setChatOptions(id, patch) {
    const detail = get().details[id];
    if (!detail) return;
    const fields = (Object.keys(patch) as (keyof typeof patch)[]).filter((field) => patch[field] !== undefined);
    const versions = new Map(fields.map((field) => {
      const key = `${id}:${field}`;
      if (!pendingChatOptionValues.has(key)) pendingChatOptionValues.set(key, detail[field]);
      const version = (chatOptionVersions.get(key) ?? 0) + 1;
      chatOptionVersions.set(key, version);
      return [field, version] as const;
    }));
    const previous = Object.fromEntries(fields.map((field) => [field, detail[field]]));
    set((current) => optimisticChatOptions(current, id, patch));
    // The server answers with the chat as it now stands, and retires the Claude
    // process so the next message starts under the new settings.
    try {
      const body = await transport.request<{ chat?: RawChatDetail }>(
        detail.serverId,
        `/chats/${encodeURIComponent(detail.id)}`,
        { method: "PATCH", body: patch },
      );
      const chat = body.chat;
      if (!chat) throw new Error("Try changing this thread's settings again.");
      const accepted = Object.fromEntries(fields.flatMap((field) =>
        chatOptionVersions.get(`${id}:${field}`) === versions.get(field)
          ? [[field, chatOptionValue(field, chat[field])]]
          : [])) as ChatOptionPatch;
      set((current) => optimisticChatOptions(current, id, accepted));
    } catch (error) {
      const rollback = Object.fromEntries(fields.flatMap((field) =>
        chatOptionVersions.get(`${id}:${field}`) === versions.get(field)
          ? [[field, chatOptionValue(field, previous[field])]]
          : [])) as ChatOptionPatch;
      set((current) => optimisticChatOptions(current, id, rollback));
      throw error;
    } finally {
      for (const field of fields) {
        const key = `${id}:${field}`;
        if (chatOptionVersions.get(key) === versions.get(field)) {
          chatOptionVersions.delete(key);
          pendingChatOptionValues.delete(key);
        }
      }
      if (![...chatOptionVersions.keys()].some((key) => key.startsWith(`${id}:`))) {
        const settled = get().details[id];
        if (settled) cacheDetail(settled);
      }
    }
  },

  async interrupt(id) {
    const chat = get().chats.find((entry) => entry.id === id) ?? get().details[id];
    if (!chat) throw new Error("This thread is no longer available.");
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}/interrupt`, {
      method: "POST",
      body: {},
    });
    await get().refresh();
  },
}));


function chatOptionValue(field: keyof ChatOptionPatch, value: unknown): string | null {
  return field === "permissionMode" ? String(value) : typeof value === "string" ? value : null;
}

function optimisticChatOptions(current: State, id: string, patch: ChatOptionPatch): Partial<State> {
  const apply = <T extends Pick<ChatDetail, "model" | "effort"> & { permissionMode?: string }>(chat: T): T => ({
    ...chat,
    ...(patch.model !== undefined ? { model: patch.model ?? undefined } : {}),
    ...(patch.effort !== undefined ? { effort: patch.effort ?? undefined } : {}),
    ...(patch.permissionMode !== undefined ? { permissionMode: patch.permissionMode } : {}),
  });
  const applyRow = (chat: Chat): Chat => ({
    ...chat,
    ...(patch.model !== undefined ? { model: patch.model ?? undefined } : {}),
    ...(patch.effort !== undefined ? { effort: patch.effort ?? undefined } : {}),
  });
  return {
    details: current.details[id]
      ? { ...current.details, [id]: apply(current.details[id]) }
      : current.details,
    chats: current.chats.map((chat) => chat.id === id ? applyRow(chat) : chat),
  };
}

interface RawChatDetail extends RawChat {
  permissionMode?: string;
  entries?: ConvEntry[];
  history?: { hasEarlier?: boolean; before?: string };
  todos?: ConvTodo[];
  approval?: ChatApproval | null;
  question?: ChatQuestionRequest | null;
  action?: string | null;
  live?: boolean;
  error?: string | null;
  linearNotice?: string | null;
  context?: ContextUsage | null;
}

function toDetail(raw: RawChatDetail, serverId: string): ChatDetail {
  return {
    id: raw.id,
    serverId,
    title: raw.title,
    cwd: raw.cwd,
    parentChatId: raw.parentChatId,
    provider: raw.provider,
    model: raw.model,
    effort: raw.effort,
    permissionMode: raw.permissionMode,
    state: raw.state ?? "idle",
    action: raw.action ?? undefined,
    entries: raw.entries ?? [],
    ...(raw.history ? {
      history: {
        hasEarlier: raw.history.hasEarlier === true,
        ...(raw.history.before ? { before: raw.history.before } : {}),
      },
    } : {}),
    todos: raw.todos ?? [],
    approval: raw.approval ?? undefined,
    question: raw.question ?? undefined,
    live: raw.live,
    error: raw.error ?? undefined,
    linearNotice: typeof raw.linearNotice === "string" ? raw.linearNotice : undefined,
    context: raw.context ?? undefined,
    workingSince: raw.workingSince ?? undefined,
  };
}

/// A fresh tail replaces the part it owns while history already loaded above
/// it stays mounted. If the two windows no longer overlap, the fresh read wins.
function mergeDetailRefresh(current: ChatDetail | undefined, fresh: ChatDetail): ChatDetail {
  if (!current || current.serverId !== fresh.serverId || fresh.entries.length === 0) {
    cacheDetail(fresh);
    return fresh;
  }
  const overlap = current.entries.findIndex((entry) => entry.id === fresh.entries[0].id);
  if (overlap < 0) {
    cacheDetail(fresh);
    return fresh;
  }
  const next = {
    ...fresh,
    entries: uniqueEntries([...current.entries.slice(0, overlap), ...fresh.entries]),
    history: overlap > 0 ? current.history : fresh.history,
  };
  cacheDetail(next);
  return next;
}

function toChat(raw: RawChat, serverId: string): Chat {
  return {
    id: raw.id,
    serverId,
    title: raw.title,
    cwd: raw.cwd,
    state: raw.state ?? "idle",
    provider: raw.provider,
    model: raw.model,
    effort: raw.effort,
    preview: raw.preview,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt ?? 0,
    workingSince: raw.workingSince ?? undefined,
    ...(raw.unread ? { unread: true } : {}),
    ...(raw.pinned ? { pinned: true } : {}),
    ...(raw.parentChatId ? { parentChatId: raw.parentChatId } : {}),
  };
}

function keepKnownServers<T extends { serverId: string }>(current: T[], known: Set<string>): T[] {
  return current.every((entry) => known.has(entry.serverId))
    ? current
    : current.filter((entry) => known.has(entry.serverId));
}

function mergeDiscoveredServers(current: Server[], incoming: Server[]): Server[] {
  const previous = new Map(current.map((server) => [server.id, server]));
  const next = incoming.map((server) => {
    const existing = previous.get(server.id);
    const merged = existing && !server.cloud ? { ...server, online: existing.online } : server;
    return existing && sameServer(existing, merged) ? existing : merged;
  });
  return next.length === current.length && next.every((server, index) => server === current[index])
    ? current
    : next;
}

function setServerOnline(servers: Server[], id: string, online: boolean): Server[] {
  const index = servers.findIndex((server) => server.id === id);
  const server = servers[index];
  if (!server || (server.cloud && online) || server.online === online) return servers;
  const next = servers.slice();
  next[index] = { ...server, online };
  return next;
}

function sameServer(left: Server, right: Server): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)] as (keyof Server)[]);
  for (const key of keys) if (left[key] !== right[key]) return false;
  return true;
}

function replaceServerChats(current: Chat[], serverId: string, incoming: Chat[]): Chat[] {
  const previous = new Map(
    current.filter((chat) => chat.serverId === serverId).map((chat) => [chat.id, chat]),
  );
  return [
    ...current.filter((chat) => chat.serverId !== serverId),
    ...incoming.map((chat) => {
      const existing = previous.get(chat.id);
      return existing && sameChat(existing, chat) ? existing : chat;
    }),
  ];
}

function sameChat(left: Chat, right: Chat): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)] as (keyof Chat)[]);
  for (const key of keys) if (left[key] !== right[key]) return false;
  return true;
}

function toArchivedThread(raw: RawArchive, serverId: string): ArchivedThread {
  const entries = raw.conversation?.entries ?? [];
  const preview = [...entries]
    .reverse()
    .find((entry) => (entry.kind === "assistant" || entry.kind === "user") && entry.text?.trim())
    ?.text;
  return {
    id: raw.id,
    chatId: raw.chatId,
    serverId,
    title: raw.conversation?.title?.trim() || raw.session,
    cwd: raw.cwd ?? "~",
    provider: raw.agent,
    model: raw.conversation?.model,
    effort: raw.conversation?.effort,
    permissionMode: raw.conversation?.permissionMode,
    parentChatId: raw.conversation?.parentChatId,
    preview,
    archivedAt: raw.archivedAt,
    entries,
    todos: raw.conversation?.todos ?? [],
    context: raw.conversation?.context,
    detailLoaded: raw.summary !== true,
  };
}

function toWorkspace(raw: RawWorkspace, serverId: string): Workspace {
  return {
    id: raw.id,
    serverId,
    name: raw.name,
    path: raw.path,
    origin: raw.origin,
    icon: raw.icon,
    tint: raw.tint,
    provider: raw.provider ?? null,
    model: raw.model ?? null,
    effort: raw.effort ?? null,
    worktrees: raw.worktrees ?? [],
    virtual: raw.virtual === true,
  };
}

function branchesFromWorktrees(workspace?: Workspace): GitBranch[] {
  if (!workspace) return [];
  return workspace.worktrees.flatMap((tree) =>
    tree.branch
      ? [{ name: tree.branch, current: tree.isMain, checkout: tree.isMain ? "main" as const : "worktree" as const }]
      : [],
  );
}

function localServer(servers: Server[]): Server | undefined {
  return servers.find((server) => server.local) ?? servers.find((server) => server.online) ?? servers[0];
}

/// The computer a thread with no workspace starts on: the first available one.
function preferredServer(servers: Server[]): Server | undefined {
  return servers.find((server) => server.online && !server.cloud);
}

function nameFromPath(path: string): string {
  const part = path
    .replace(/\/+$/, "")
    .split("/")
    .filter((segment) => segment && segment !== "~")
    .pop();
  return part ?? "";
}

/// Pinned first, then newest thread first. Creation time rather than activity
/// keeps a row where you left it: a thread you started an hour ago does not
/// walk up the list every time it says something.
function byNewest(a: Chat, b: Chat): number {
  return Number(b.pinned ?? false) - Number(a.pinned ?? false)
    || (b.createdAt ?? b.updatedAt) - (a.createdAt ?? a.updatedAt);
}
