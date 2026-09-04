import { create } from "zustand";
import { ThreadRuntime } from "~/client-runtime/thread-runtime";
import { codeFor, type DeviceIconId } from "~/lib/devices";
import { agentConversation, availableAgentServers } from "~/lib/inbox";
import type { TintId } from "~/lib/tints";
import type { Provider } from "~/lib/providers";
import { applyProjectIdentity } from "~/lib/projects";
import { invalidateSharedResource, readSharedResource, seedSharedResource } from "~/lib/shared-read";
import { byRank } from "~/lib/tickets";
import { transport } from "~/lib/transport";
import { readWarmCache, warmSnapshot, writeWarmCache } from "~/lib/warm-cache";
import { fixtureChats, fixtureServers, fixtureWorkspaces } from "./fixture";
import type {
  Agent,
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
  PairRequest,
  PathSuggestion,
  Project,
  ProviderMcpStatus,
  Routine,
  Server,
  ServerSettings,
  Ticket,
  TicketActivity,
  TicketStatus,
  Tooling,
  UpdateRun,
  Workspace,
  WorkspaceIconMatch,
} from "./types";

/// The client's whole view of every connected server.
///
/// Pushes patch what is already here rather than triggering a refetch, so a
/// chat changing state costs no requests. `/notify/stream` sends `chats` when
/// the list changed, which is the one case that needs a fetch.
///
/// A poll runs underneath the push channel. The interval is loose while the
/// socket is up, because then it is only covering missed frames, and tight
/// while it is down, because then it is the only source of truth.

const useFixture = import.meta.env.VITE_MC_FIXTURE === "1";
const useSharedThreadRuntime = import.meta.env.VITE_THREAD_RUNTIME === "shared";

interface RawChat {
  id: string;
  title: string;
  cwd: string;
  state?: ChatState;
  provider?: string;
  agentId?: string;
  model?: string;
  effort?: string;
  preview?: string;
  createdAt?: number;
  updatedAt?: number;
  workingSince?: number | null;
  dm?: boolean;
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
    agentId?: string;
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
  /// The inbox: one conversation per agent, across every paired machine. Held
  /// apart from `chats` because they are two lists a person reads differently.
  dms: Chat[];
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
  agents: Agent[];
  projects: Project[];
  tickets: Ticket[];
  routines: Routine[];
  /// Which daemon each board device id belongs to. A ticket names the machine
  /// it runs on by that id rather than by a server row, because a server row is
  /// this client's pairing and means nothing to another client.
  boardDevices: { deviceId: string; serverId: string }[];
  boardLoading: boolean;
  /// A fleet catalogue read is still waiting on at least one device. This is
  /// separate from `loading`, which clears as soon as there is anything useful
  /// to paint.
  catalogLoading: boolean;
  loading: boolean;
  /// Set when every configured server failed, so the UI can say why rather than
  /// showing an empty list as though nothing were running.
  error?: string;
  connected: boolean;

  start(): () => void;
  refresh(): Promise<void>;
  addServer(input: { url: string; token: string; name?: string }): Promise<void>;
  removeServer(id: string): Promise<void>;
  updateServer(id: string, patch: { name?: string; icon?: DeviceIconId; tint?: TintId }): Promise<void>;
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

  /// The board. Read on demand by the pane that shows it rather than on every
  /// poll — a board nobody is looking at costs nothing.
  loadBoard(options?: { fresh?: boolean }): Promise<void>;
  /// Machines asking to pair with this one, waiting on you.
  pairRequests: PairRequest[];
  loadPairRequests(options?: { fresh?: boolean }): Promise<void>;
  createTicket(input: {
    projectId: string;
    title: string;
    body?: string;
    parentId?: string;
  }): Promise<Ticket>;
  startTicket(
    id: string,
    options?: { provider?: string; model?: string; effort?: string; checkout?: "main" | "worktree" },
  ): Promise<{ id: string; serverId: string }>;
  updateTicket(id: string, patch: Record<string, unknown>): Promise<void>;
  moveTicket(id: string, status: TicketStatus, before?: string, after?: string): Promise<void>;
  commentOnTicket(id: string, body: string): Promise<void>;
  editTicketComment(id: string, commentId: string, body: string): Promise<void>;
  deleteTicketComment(id: string, commentId: string): Promise<void>;
  deleteTicket(id: string): Promise<void>;
  ticketActivity(id: string): Promise<TicketActivity[]>;
  attachThread(ticketId: string, chatId: string): Promise<void>;
  detachThread(ticketId: string, chatId: string, deviceId: string): Promise<void>;
  /// Turns a thread you are already in into a ticket, adopting its worktree and
  /// branch rather than opening new ones.
  ticketFromThread(chatId: string): Promise<Ticket>;
  saveRoutine(id: string, patch: Record<string, unknown>): Promise<Routine>;
  deleteRoutine(id: string): Promise<void>;
  runRoutine(id: string): Promise<Routine>;
  saveAgent(id: string | undefined, patch: Record<string, unknown>): Promise<Agent>;
  deleteAgent(id: string): Promise<void>;
  /// Opens an agent's conversation, making it if this is the first time. The
  /// first available device that can run it holds the conversation.
  openDm(agent: Agent): Promise<Chat>;
  /// Clears an inbox conversation's unread mark.
  readChat(id: string): Promise<void>;
  /// Renames a project, or the slug its tickets are keyed by. Changing the slug
  /// re-keys every ticket it has, so the whole board is read back after.
  saveProject(
    id: string,
    patch: { name?: string; keyPrefix?: string; icon?: string | null; tint?: string | null },
  ): Promise<Project>;
}

/// How often to poll. Long while pushes are arriving, short while they aren't.
const POLL_CONNECTED_MS = 15_000;
const POLL_DISCONNECTED_MS = 4_000;
const PEER_DETAIL_POLL_VISIBLE_MS = 1_000;
const PEER_DETAIL_POLL_HIDDEN_MS = 5_000;
const DETAIL_CACHE_LIMIT = 12;
const CHAT_PAGE_TURNS = 10;
/// The closest together two warm-cache writes may be. Far enough apart that a
/// streaming turn does not pay for one frame by frame, close enough that a
/// window is never more than a moment behind what it last knew.
const WARM_WRITE_MS = 500;
const detailCache = new Map<string, ChatDetail>();
const pendingDetails = new Map<string, Promise<ChatDetail>>();
const chatOptionVersions = new Map<string, number>();
const pendingChatOptionValues = new Map<string, unknown>();
const pushPeerServers = new Set<string>();
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
const warm = useFixture ? undefined : readWarmCache();
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

/// Most recently used first, so a snapshot that has to drop a transcript drops
/// the one a person is least likely to open next.
function recentDetails(): ChatDetail[] {
  return [...detailCache.values()].reverse();
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
  dms: warm?.dms ?? [],
  workspaces: useFixture ? fixtureWorkspaces : warm?.workspaces ?? [],
  agents: warm?.agents ?? [],
  projects: warm?.projects ?? [],
  tickets: [],
  routines: [],
  pairRequests: [],
  boardDevices: [],
  boardLoading: false,
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

  start() {
    if (useFixture) return () => {};
    if (useSharedThreadRuntime) return sharedThreadRuntime().start();

    // Servers first, then anything keyed to them. A machine that asked to pair
    // while this window was closed is standing there waiting for an answer, so
    // its prompt cannot wait for the first poll fifteen seconds from now.
    void get()
      .refresh()
      .then(() => get().loadPairRequests())
      .catch(() => {});

    const refreshTopics = (serverId: string, topics: string[] = []) => {
      if (topics.includes("sidebar")) void get().refresh();
      if (topics.includes("board")) void get().loadBoard({ fresh: true });
      if (topics.includes("settings")) void get().loadSettings();
      const current = get();
      for (const topic of topics) {
        if (!topic.startsWith("thread:")) continue;
        const id = topic.slice("thread:".length);
        const detail = current.details[id];
        if (!detail || detail.serverId !== serverId || !current.openIds.includes(id)) continue;
        void readChatDetail(id, serverId).then((next) => {
          if (!get().openIds.includes(next.id)) return;
          set((state) => ({
            details: { ...state.details, [next.id]: mergeDetailRefresh(state.details[next.id], next) },
            detailLoading: { ...state.detailLoading, [next.id]: false },
          }));
        }).catch(() => {});
      }
    };
    const offPush = transport.subscribe((serverId, payload) => {
      const frame = payload as ChatFrame;
      if (frame.type === "hello") {
        pushPeerServers.add(serverId);
        for (const peerId of frame.peerStreams ?? []) pushPeerServers.add(peerId);
        if (frame.reset) refreshTopics(serverId, frame.topics);
        return;
      }
      if (frame.type === "reset") {
        refreshTopics(serverId, frame.topics);
        return;
      }
      if (frame.type === "peer-disconnected") {
        pushPeerServers.delete(serverId);
        return;
      }
      if (frame.type === "peer-reset") {
        pushPeerServers.add(serverId);
        refreshTopics(serverId, (frame.topics?.length ?? 0) > 0
          ? frame.topics ?? []
          : get().openIds.map((id) => `thread:${id}`));
        return;
      }
      if (frame.type === "chats") {
        if (sidebarProjectionServers.has(serverId)) return;
        void get().refresh();
        return;
      }
      if (frame.type === "chat-list") {
        set((current) => applyChatListFrame(current, frame, serverId));
        return;
      }
      // A board frame says a ticket, agent or project changed — on this machine
      // or on one of the machines paired with it.
      if (frame.type === "board") {
        void get().loadBoard({ fresh: true });
        return;
      }
      // A machine was paired or unpaired. Every window onto this daemon shows
      // the same list, so none of them should wait for its next poll to agree.
      if (frame.type === "peers") {
        void get().refresh();
        return;
      }
      // A machine is asking to pair. Somebody is standing at it waiting for an
      // answer, so this is the one frame that must not wait for a poll.
      if (frame.type === "pair-requests") {
        void get().loadPairRequests({ fresh: true });
        return;
      }
      // A turn streams as `chat` frames: the entries that changed, plus the
      // whole scalar state. Patch what is on screen rather than refetching.
      if (frame.type === "chat" && frame.chatId) set((current) => applyChatFrame(current, frame, serverId));
    }, ["sidebar", "board", "settings"]);

    // What is on screen becomes what the next launch opens with.
    const warmWrites = keepWarmCache();

    const offStatus = transport.onStatus((serverId, pushUp) => {
      // The notify socket is a live-update channel, not reachability. In the
      // preview tunnel it flaps constantly; treating that as "device offline"
      // made a healthy local server look disconnected.
      set((current) => ({
        connected: pushUp || current.servers.some((server) => server.id !== serverId && server.online),
        servers: pushUp
          ? current.servers.map((server) => (server.id === serverId ? { ...server, online: true } : server))
          : current.servers,
      }));
    });

    // Re-armed after each run rather than a fixed interval, so a slow refresh
    // cannot stack requests on a struggling server.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let detailTimer: ReturnType<typeof setTimeout> | undefined;
    let detailPolling = false;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      await get().refresh();
      // A request arriving while the notify socket was down would otherwise sit
      // unanswered until the socket came back.
      await get().loadPairRequests().catch(() => {});
      if (stopped) return;
      timer = setTimeout(
        () => void poll(),
        get().connected ? POLL_CONNECTED_MS : POLL_DISCONNECTED_MS,
      );
    };
    timer = setTimeout(() => void poll(), POLL_CONNECTED_MS);

    // A daemon from before peer streaming landed cannot relay another
    // machine's live frames. Keep the open feed fresh for that compatibility
    // case, and stop as soon as this daemon announces a peer stream.
    const pollOpenPeer = async () => {
      if (stopped || detailPolling) return;
      detailPolling = true;
      try {
        const current = get();
        const stale = current.openIds
          .map((id) => current.details[id])
          .filter((detail): detail is ChatDetail => Boolean(
            detail
            && current.servers.find((server) => server.id === detail.serverId)?.peer
            && !pushPeerServers.has(detail.serverId),
          ));
        const refreshed = await Promise.all(stale.map((detail) => readChatDetail(detail.id, detail.serverId)));
        if (refreshed.length > 0) {
          set((state) => ({
            details: refreshed.reduce(
              (details, detail) => state.openIds.includes(detail.id)
                ? { ...details, [detail.id]: mergeDetailRefresh(details[detail.id], detail) }
                : details,
              state.details,
            ),
            detailLoading: refreshed.reduce(
              (loading, detail) => ({ ...loading, [detail.id]: false }),
              state.detailLoading,
            ),
          }));
        }
      } catch {
        // The existing feed remains useful through a transient peer failure.
      } finally {
        detailPolling = false;
        if (!stopped) {
          detailTimer = setTimeout(
            () => void pollOpenPeer(),
            document.visibilityState === "visible"
              ? PEER_DETAIL_POLL_VISIBLE_MS
              : PEER_DETAIL_POLL_HIDDEN_MS,
          );
        }
      }
    };
    const wakePeerPoll = () => {
      if (document.visibilityState !== "visible") return;
      if (detailTimer) clearTimeout(detailTimer);
      detailTimer = undefined;
      void pollOpenPeer();
    };
    detailTimer = setTimeout(() => void pollOpenPeer(), PEER_DETAIL_POLL_VISIBLE_MS);
    document.addEventListener("visibilitychange", wakePeerPoll);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (detailTimer) clearTimeout(detailTimer);
      document.removeEventListener("visibilitychange", wakePeerPoll);
      warmWrites.stop();
      for (const off of detailSubscriptions.values()) off();
      detailSubscriptions.clear();
      detailOwners.clear();
      offPush();
      offStatus();
    };
  },

  async refresh() {
    if (useFixture) return;
    if (useSharedThreadRuntime) return sharedThreadRuntime().refresh();
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
        dms: keepKnownServers(current.dms, known),
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
                // The inbox comes back in the same answer, so it lands with the
                // threads rather than costing a second round trip.
                dms: replaceServerChats(
                  current.dms,
                  server.id,
                  (listed.dms ?? []).map((raw) => toChat(raw, server.id)),
                ),
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
            .then((listed) => set((current) => {
              const nextWorkspaces = [
                ...current.workspaces.filter((workspace) => workspace.serverId !== server.id),
                ...(listed.workspaces ?? []).map((raw) => toWorkspace(raw, server.id)),
              ];
              return { workspaces: applyProjectIdentity(nextWorkspaces, current.projects) };
            }))
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

  async addServer(input) {
    await transport.addServer(input);
    await get().refresh();
  },

  async removeServer(id) {
    await transport.removeServer(id);
    set((current) => ({
      servers: current.servers.filter((server) => server.id !== id),
      chats: current.chats.filter((chat) => chat.serverId !== id),
      archived: current.archived.filter((chat) => chat.serverId !== id),
      dms: current.dms.filter((chat) => chat.serverId !== id),
      workspaces: current.workspaces.filter((workspace) => workspace.serverId !== id),
    }));
    await get().refresh();
  },

  async updateServer(id, patch) {
    await transport.updateServer(id, patch);
    set((current) => ({
      servers: current.servers.map((server) => {
        if (server.id !== id) return server;
        const name = patch.name?.trim() || server.name;
        return {
          ...server,
          name,
          code: patch.name ? codeFor(name) : server.code,
          icon: patch.icon ?? server.icon,
          tint: patch.tint ?? server.tint,
        };
      }),
    }));
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
        ?? availableAgentServers(get().servers, get().settings?.devicePreferenceOrder)[0]?.id
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
      set((current) => ({ chats: [chat, ...current.chats].sort(byNewest) }));
      return { id: chat.id, serverId };
    }

    const server = get().servers.find((entry) => entry.id === input.serverId)
      ?? availableAgentServers(get().servers, get().settings?.devicePreferenceOrder)[0]
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
    const id = created.chat?.id;
    if (!id) throw new Error("Couldn't start that thread.");
    await transport.request(server.id, `/chats/${encodeURIComponent(id)}/message`, {
      method: "POST",
      body: { text },
    });
    await get().refresh();
    return { id, serverId: server.id };
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
    await get().loadBoard({ fresh: true });
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
    if (useSharedThreadRuntime) return sharedThreadRuntime().openChat(id);
    // Both lists: an inbox conversation opens the same way a thread does.
    const chat = get().chats.find((entry) => entry.id === id)
      ?? get().dms.find((entry) => entry.id === id);
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
    if (useSharedThreadRuntime) return sharedThreadRuntime().loadEarlierEntries(id);
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
    if (useSharedThreadRuntime) return sharedThreadRuntime().closeChat(id);
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
    const previousRow = get().chats.find((chat) => chat.id === id && chat.serverId === detail.serverId)
      ?? get().dms.find((chat) => chat.id === id && chat.serverId === detail.serverId);
    set((current) => ({
      details: {
        ...current.details,
        [id]: { ...current.details[id]!, entries: [...current.details[id]!.entries, optimistic] },
      },
      chats: current.chats.map((chat) => chat.id === id && chat.serverId === detail.serverId
        ? { ...chat, preview: shownText, state: "working", updatedAt: optimisticAt }
        : chat),
      dms: current.dms.map((chat) => chat.id === id && chat.serverId === detail.serverId
        ? { ...chat, preview: shownText, state: "working", updatedAt: optimisticAt }
        : chat),
    }));
    try {
      await transport.request(detail.serverId, `/chats/${encodeURIComponent(detail.id)}/message`, {
        method: "POST",
        body: { messageId, text: trimmed, attachments, codeReferences },
      });
    } catch (error) {
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
        ...(previousRow?.dm
          ? { dms: current.dms.map((chat) => chat.id === id && chat.serverId === detail.serverId ? previousRow : chat) }
          : previousRow
            ? { chats: current.chats.map((chat) => chat.id === id && chat.serverId === detail.serverId ? previousRow : chat) }
            : {}),
      }));
      throw error;
    }
    // The server echoes the message back as a `chat` frame. With the socket
    // down there is no frame coming, so read the feed once instead.
    if (!get().connected) {
      const fresh = await readChatDetail(detail.id, detail.serverId);
      if (get().openIds.includes(detail.id)) {
        set((current) => ({
          details: { ...current.details, [detail.id]: mergeDetailRefresh(current.details[detail.id], fresh) },
          detailLoading: { ...current.detailLoading, [detail.id]: false },
        }));
      }
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
    // The thread let go of any ticket it was on, so the board is stale.
    await get().loadBoard({ fresh: true }).catch(() => {});
  },

  // ── the board ─────────────────────────────────────────────────────────────
  // Every machine answers with its own whole board. Once daemons replicate to
  // each other those answers are the same board, and merging by id here is what
  // keeps that from showing up twice.

  /// Only ever asked of the daemon on this machine: a request to pair with
  /// another machine is that machine's business to answer, not ours.
  async loadPairRequests(options) {
    if (useFixture) return;
    const home = get().servers.find((server) => server.local) ?? get().servers[0];
    if (!home) return;
    if (options?.fresh) invalidateSharedResource("pairing", home.id);
    try {
      const answer = await readSharedResource(
        "pairing",
        home.id,
        () => transport.request<{ requests?: PairRequest[] }>(home.id, "/pair/pending"),
      );
      set({ pairRequests: answer.requests ?? [] });
    } catch {
      // Keep requests already on screen while an older or unavailable daemon
      // cannot answer. A successful empty response is what clears them.
    }
  },

  async loadBoard(options) {
    if (useFixture) return;
    const servers = await transport.servers();
    // The board is read from the machines this window holds a daemon of, and a
    // paired one is not among them: daemons converge the board log between
    // themselves, so a peer's tickets, agents and routines are already
    // in the answer here. Asking that machine for them again waits on a device
    // that may be asleep for something this one already knows — and its answer
    // carries `workspaceIds` for folders on *its* disk, which are not ours.
    //
    // Threads and workspaces are the opposite: those live on one machine and
    // replicate nowhere, so `refresh` does go and ask each one.
    const asked = servers.filter((server) => !server.peer && !server.cloud);
    if (asked.length === 0) {
      set({ agents: [], projects: [], tickets: [], routines: [], boardDevices: [], boardLoading: false });
      return;
    }
    if (options?.fresh) {
      for (const server of asked) invalidateSharedResource("board", server.id);
    }
    if (get().tickets.length === 0) set({ boardLoading: true });
    const results = await Promise.all(
      asked.map(async (server) => {
        try {
          const board = await readSharedResource(
            "board",
            server.id,
            () => transport.request<{
              deviceId?: string;
              agents?: RawAgent[];
              projects?: RawProject[];
              tickets?: RawTicket[];
              routines?: RawRoutine[];
            }>(server.id, "/board"),
          );
          return {
            serverId: server.id,
            devices: board.deviceId ? [{ deviceId: board.deviceId, serverId: server.id }] : [],
            agents: (board.agents ?? []).map((raw) => ({ ...raw, serverId: server.id }) as Agent),
            projects: (board.projects ?? []).map((raw) => ({
              ...raw,
              serverId: server.id,
              workspaceIds: raw.workspaceIds ?? [],
            }) as Project),
            tickets: (board.tickets ?? []).map((raw) => ({
              ...raw,
              serverId: server.id,
              threads: raw.threads ?? [],
            }) as Ticket),
            routines: (board.routines ?? []).map((raw) => ({ ...raw, serverId: server.id }) as Routine),
          };
        } catch {
          // A failed device contributes no replacement rows. Its useful board
          // state remains in the store until a successful read can replace it.
          return undefined;
        }
      }),
    );
    const dedupe = <T extends { id: string }>(rows: T[]): T[] => [
      ...new Map(rows.map((row) => [row.id, row])).values(),
    ];
    // A paired machine still takes its place in the device map. It costs no
    // request: the id this window reaches that machine by *is* the id its
    // events are written with, because pairing keys a device on exactly that.
    const paired = servers
      .filter((server) => server.peer)
      .map((server) => ({ deviceId: server.id, serverId: server.id }));
    set((current) => {
      const answered = results.filter((result): result is NonNullable<typeof result> => result !== undefined);
      const answeredServerIds = new Set(answered.map((result) => result.serverId));
      const agents = dedupe([
        ...current.agents.filter((row) => !answeredServerIds.has(row.serverId)),
        ...answered.flatMap((result) => result.agents),
      ]);
      const projects = dedupe([
        ...current.projects.filter((row) => !answeredServerIds.has(row.serverId)),
        ...answered.flatMap((result) => result.projects),
      ]);
      const tickets = dedupe([
        ...current.tickets.filter((row) => !answeredServerIds.has(row.serverId)),
        ...answered.flatMap((result) => result.tickets),
      ]);
      const routines = dedupe([
        ...current.routines.filter((row) => !answeredServerIds.has(row.serverId)),
        ...answered.flatMap((result) => result.routines),
      ]);
      return {
        agents,
        projects,
        workspaces: applyProjectIdentity(current.workspaces, projects),
        tickets: tickets.sort(byRank),
        routines: routines.sort((a, b) => a.nextRunAt - b.nextRunAt),
        boardDevices: [
          ...current.boardDevices.filter((entry) =>
            !answeredServerIds.has(entry.serverId)
            && !paired.some((peer) => peer.serverId === entry.serverId)),
          ...answered.flatMap((result) => result.devices),
          ...paired,
        ],
        boardLoading: false,
      };
    });
  },

  async createTicket(input) {
    const server = boardServer(get().servers, get().projects, input.projectId);
    const body = await transport.request<{ ticket: RawTicket }>(server, "/tickets", {
      method: "POST",
      body: input,
    });
    const ticket = toTicket(body.ticket, server);
    set((current) => ({ tickets: withTicket(current.tickets, ticket) }));
    void get().loadBoard({ fresh: true }).catch(() => {});
    return ticket;
  },

  async startTicket(id, options = {}) {
    const ticket = get().tickets.find((entry) => entry.id === id);
    if (!ticket) throw new Error("That ticket is gone.");
    const target = ticket.deviceId
      ? get().boardDevices.find((entry) => entry.deviceId === ticket.deviceId)?.serverId
      : ticket.serverId;
    if (!target) throw new Error("That device isn't connected.");
    const body = await transport.request<{ chat?: RawChat }>(
      target,
      `/tickets/${encodeURIComponent(id)}/start`,
      { method: "POST", body: options },
    );
    const chatId = body.chat?.id;
    if (!chatId) throw new Error("Couldn't start that thread.");
    await Promise.all([get().refresh(), get().loadBoard({ fresh: true })]);
    return { id: chatId, serverId: target };
  },

  async updateTicket(id, patch) {
    const ticket = get().tickets.find((entry) => entry.id === id);
    if (!ticket) return;
    const body = await transport.request<{ ticket: RawTicket }>(
      ticket.serverId,
      `/tickets/${encodeURIComponent(id)}`,
      { method: "PATCH", body: patch },
    );
    // The answer *is* the ticket, so the pane repaints from it now rather than
    // waiting on a read of the whole board. That read still happens, behind the
    // change, for what a write moves elsewhere — a parent's progress ring, a
    // sub-ticket, a sibling's rank.
    set((current) => ({ tickets: withTicket(current.tickets, toTicket(body.ticket, ticket.serverId)) }));
    void get().loadBoard({ fresh: true }).catch(() => {});
  },

  async moveTicket(id, status, before, after) {
    const ticket = get().tickets.find((entry) => entry.id === id);
    if (!ticket) return;
    // Optimistic, because dragging a card that snaps back while the request
    // flies reads as the app refusing the move.
    set((current) => ({
      tickets: current.tickets.map((entry) => (entry.id === id ? { ...entry, status } : entry)),
    }));
    try {
      const body = await transport.request<{ ticket: RawTicket }>(
        ticket.serverId,
        `/tickets/${encodeURIComponent(id)}/move`,
        { method: "POST", body: { status, before, after } },
      );
      set((current) => ({ tickets: withTicket(current.tickets, toTicket(body.ticket, ticket.serverId)) }));
    } finally {
      void get().loadBoard({ fresh: true }).catch(() => {});
    }
  },

  async commentOnTicket(id, body) {
    const ticket = get().tickets.find((entry) => entry.id === id);
    if (!ticket) return;
    const answer = await transport.request<{ ticket: RawTicket }>(
      ticket.serverId,
      `/tickets/${encodeURIComponent(id)}/comment`,
      { method: "POST", body: { body } },
    );
    set((current) => ({ tickets: withTicket(current.tickets, toTicket(answer.ticket, ticket.serverId)) }));
    void get().loadBoard({ fresh: true }).catch(() => {});
  },

  async editTicketComment(id, commentId, body) {
    const ticket = get().tickets.find((entry) => entry.id === id);
    if (!ticket) return;
    await transport.request(
      ticket.serverId,
      `/tickets/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`,
      { method: "PATCH", body: { body } },
    );
  },

  async deleteTicketComment(id, commentId) {
    const ticket = get().tickets.find((entry) => entry.id === id);
    if (!ticket) return;
    await transport.request(
      ticket.serverId,
      `/tickets/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`,
      { method: "DELETE" },
    );
  },

  async deleteTicket(id) {
    const ticket = get().tickets.find((entry) => entry.id === id);
    if (!ticket) return;
    await transport.request(ticket.serverId, `/tickets/${encodeURIComponent(id)}`, { method: "DELETE" });
    set((current) => ({ tickets: current.tickets.filter((entry) => entry.id !== id) }));
    void get().loadBoard({ fresh: true }).catch(() => {});
  },

  async ticketActivity(id) {
    const ticket = get().tickets.find((entry) => entry.id === id);
    if (!ticket) return [];
    const body = await transport.request<{ activity?: TicketActivity[] }>(
      ticket.serverId,
      `/tickets/${encodeURIComponent(id)}/activity`,
    );
    return body.activity ?? [];
  },

  async attachThread(ticketId, chatId) {
    const ticket = get().tickets.find((entry) => entry.id === ticketId);
    const chat = get().chats.find((entry) => entry.id === chatId);
    if (!ticket) return;
    if (!chat) throw new Error("That thread is gone.");
    const threadDevice = get().boardDevices.find((entry) => entry.serverId === chat.serverId)?.deviceId;
    if (!threadDevice) throw new Error("That thread's device is not connected.");
    const body = await transport.request<{ ticket: RawTicket }>(
      ticket.serverId,
      `/tickets/${encodeURIComponent(ticketId)}/threads`,
      {
        method: "POST",
        body: {
          chatId,
          deviceId: threadDevice,
          state: chat.state,
          ...(chat.agentId ? { agentId: chat.agentId } : {}),
        },
      },
    );
    set((current) => ({ tickets: withTicket(current.tickets, toTicket(body.ticket, ticket.serverId)) }));
    void get().loadBoard({ fresh: true }).catch(() => {});
  },

  async detachThread(ticketId, chatId, deviceId) {
    const ticket = get().tickets.find((entry) => entry.id === ticketId);
    if (!ticket) return;
    const body = await transport.request<{ ticket: RawTicket }>(
      ticket.serverId,
      `/tickets/${encodeURIComponent(ticketId)}/threads/${encodeURIComponent(chatId)}?device=${encodeURIComponent(deviceId)}`,
      { method: "DELETE" },
    );
    set((current) => ({ tickets: withTicket(current.tickets, toTicket(body.ticket, ticket.serverId)) }));
    void get().loadBoard({ fresh: true }).catch(() => {});
  },

  async ticketFromThread(chatId) {
    const chat = get().chats.find((entry) => entry.id === chatId);
    if (!chat) throw new Error("That thread is gone.");
    const body = await transport.request<{ ticket: RawTicket }>(
      chat.serverId,
      `/chats/${encodeURIComponent(chatId)}/ticket`,
      { method: "POST", body: {} },
    );
    const ticket = toTicket(body.ticket, chat.serverId);
    set((current) => ({ tickets: withTicket(current.tickets, ticket) }));
    void get().loadBoard({ fresh: true }).catch(() => {});
    return ticket;
  },

  async saveRoutine(id, patch) {
    const existing = get().routines.find((entry) => entry.id === id);
    if (!existing) throw new Error("That routine is gone.");
    const body = await transport.request<{ routine: RawRoutine }>(
      existing.serverId,
      `/routines/${encodeURIComponent(id)}`,
      { method: "PATCH", body: patch },
    );
    const routine = { ...body.routine, serverId: existing.serverId } as Routine;
    set((current) => ({ routines: withRoutine(current.routines, routine) }));
    void get().loadBoard({ fresh: true }).catch(() => {});
    return routine;
  },

  async deleteRoutine(id) {
    const routine = get().routines.find((entry) => entry.id === id);
    if (!routine) return;
    await transport.request(routine.serverId, `/routines/${encodeURIComponent(id)}`, { method: "DELETE" });
    set((current) => ({ routines: current.routines.filter((entry) => entry.id !== id) }));
    void get().loadBoard({ fresh: true }).catch(() => {});
  },

  async runRoutine(id) {
    const routine = get().routines.find((entry) => entry.id === id);
    if (!routine) throw new Error("That routine is gone.");
    const body = await transport.request<{ routine: RawRoutine }>(
      routine.serverId,
      `/routines/${encodeURIComponent(id)}/run`,
      { method: "POST", body: {} },
    );
    const updated = { ...body.routine, serverId: routine.serverId } as Routine;
    set((current) => ({ routines: withRoutine(current.routines, updated) }));
    void get().loadBoard({ fresh: true }).catch(() => {});
    return updated;
  },

  async saveAgent(id, patch) {
    const existing = id ? get().agents.find((agent) => agent.id === id) : undefined;
    const server = existing?.serverId ?? localServer(get().servers)?.id;
    if (!server) throw new Error("This machine isn't connected.");
    const body = await transport.request<{ agent: RawAgent }>(
      server,
      id ? `/agents/${encodeURIComponent(id)}` : "/agents",
      { method: id ? "PATCH" : "POST", body: patch },
    );
    const agent = { ...body.agent, serverId: server } as Agent;
    set((current) => ({ agents: withRow(current.agents, agent) }));
    void get().loadBoard({ fresh: true }).catch(() => {});
    return agent;
  },

  async deleteAgent(id) {
    const agent = get().agents.find((entry) => entry.id === id);
    if (!agent) return;
    await transport.request(agent.serverId, `/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
    set((current) => ({ agents: current.agents.filter((entry) => entry.id !== id) }));
    void get().loadBoard({ fresh: true }).catch(() => {});
  },

  async openDm(agent) {
    const preferenceOrder = get().settings?.devicePreferenceOrder ?? [];
    const servers = availableAgentServers(get().servers, preferenceOrder);
    const available = new Set(servers.map((server) => server.id));
    const existing = agentConversation(agent.id, get().dms, get().servers, preferenceOrder);
    if (existing && available.has(existing.serverId)) return existing;

    let failure: unknown;
    for (const server of servers) {
      try {
        const body = await transport.request<{ chat: RawChat }>(
          server.id,
          `/agents/${encodeURIComponent(agent.id)}/dm`,
          { method: "POST" },
        );
        const chat = toChat(body.chat, server.id);
        set((current) => ({ dms: [chat, ...current.dms.filter((entry) => entry.id !== chat.id)] }));
        return chat;
      } catch (error) {
        failure = error;
      }
    }
    if (failure) throw failure;
    throw new Error("No device is available.");
  },

  async readChat(id) {
    const chat = get().dms.find((entry) => entry.id === id);
    if (!chat?.unread) return;
    // Cleared here first: the row should stop being bold the moment you open
    // it, not when the machine gets back to us.
    set((current) => ({
      dms: current.dms.map((entry) => (entry.id === id ? { ...entry, unread: false } : entry)),
    }));
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}/read`, { method: "POST" })
      .catch(() => {
        // A mark that did not save comes back on the next refresh, which is a
        // smaller wrong than a toast about a bold row.
      });
  },

  async saveProject(id, patch) {
    const project = get().projects.find((entry) => entry.id === id);
    if (!project) throw new Error("That workspace isn't on the board.");
    const body = await transport.request<{ project: RawProject }>(
      project.serverId,
      `/projects/${encodeURIComponent(id)}`,
      { method: "PATCH", body: patch },
    );
    await get().loadBoard({ fresh: true });
    return { ...body.project, serverId: project.serverId, workspaceIds: project.workspaceIds } as Project;
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
    if (useSharedThreadRuntime) return sharedThreadRuntime().interrupt(id);
    const chat = get().chats.find((entry) => entry.id === id) ?? get().details[id];
    if (!chat) throw new Error("This thread is no longer available.");
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}/interrupt`, {
      method: "POST",
      body: {},
    });
    await get().refresh();
  },
}));

let runtime: ThreadRuntime | undefined;

function sharedThreadRuntime(): ThreadRuntime {
  runtime ??= new ThreadRuntime(transport, useStore, recentDetails());
  return runtime;
}

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
    dms: current.dms.map((chat) => chat.id === id ? applyRow(chat) : chat),
  };
}

function settledChatRowsForWarm(current: State): State {
  if (pendingChatOptionValues.size === 0) return current;
  const settle = (chat: Chat): Chat => {
    const modelKey = `${chat.id}:model`;
    const effortKey = `${chat.id}:effort`;
    if (!pendingChatOptionValues.has(modelKey) && !pendingChatOptionValues.has(effortKey)) return chat;
    return {
      ...chat,
      ...(pendingChatOptionValues.has(modelKey)
        ? { model: pendingChatOptionValues.get(modelKey) as string | undefined }
        : {}),
      ...(pendingChatOptionValues.has(effortKey)
        ? { effort: pendingChatOptionValues.get(effortKey) as string | undefined }
        : {}),
    };
  };
  return {
    ...current,
    chats: current.chats.map(settle),
    dms: current.dms.map(settle),
  };
}

/// Writes the settled part of the store to the warm cache.
///
/// The projection is rebuilt on a slow throttle and written only when it
/// actually changed, so a streaming turn costs nothing: its deltas are not
/// settled truth and never reach a snapshot in the first place. Leaving is the
/// one moment a throttle must not swallow, so being hidden, being unloaded and
/// being torn down each flush it.
function keepWarmCache(): { stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ran = 0;
  const save = () => {
    timer = undefined;
    const current = useStore.getState();
    // Before the first device answers there is nothing to attribute a row to,
    // and overwriting a good snapshot with that would be a loss. Nothing was
    // built either, so this does not spend the interval.
    if (current.servers.length === 0) return;
    ran = Date.now();
    writeWarmCache(warmSnapshot(settledChatRowsForWarm(current), recentDetails()));
  };
  const flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    save();
  };
  // The first settled state after a launch is written straight away rather than
  // an interval later: a window somebody opens and closes again is exactly the
  // one that most needs the next launch to be warm.
  const off = useStore.subscribe(() => {
    if (timer) return;
    const due = WARM_WRITE_MS - (Date.now() - ran);
    if (due <= 0) save();
    else timer = setTimeout(save, due);
  });
  const flushWhenHidden = () => {
    if (document.visibilityState === "hidden") flush();
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", flushWhenHidden);
  return {
    stop: () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      off();
      flush();
    },
  };
}

/// A live frame for one chat. `entries` are the ones that changed; the scalar
/// fields are always sent whole, so `null` means cleared rather than unchanged.
interface ChatFrame {
  type?: string;
  sequence?: number;
  peerStreams?: string[];
  reset?: boolean;
  topics?: string[];
  chatId?: string;
  unread?: boolean;
  entries?: ConvEntry[];
  removed?: string[];
  state?: ChatState;
  action?: string | null;
  approval?: ChatApproval | null;
  question?: ChatQuestionRequest | null;
  todos?: ConvTodo[];
  title?: string;
  live?: boolean;
  error?: string | null;
  context?: ContextUsage | null;
  updatedAt?: number;
  workingSince?: number | null;
  operation?: "upsert" | "remove";
  chat?: RawChat;
  chatIds?: string[];
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
    agentId: raw.agentId,
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
    entries: [...current.entries.slice(0, overlap), ...fresh.entries],
    history: overlap > 0 ? current.history : fresh.history,
  };
  cacheDetail(next);
  return next;
}

function patchRow(chat: Chat, frame: ChatFrame): Chat {
  if (chat.id !== frame.chatId) return chat;
  const next: Chat = {
    ...chat,
    state: frame.state ?? chat.state,
    title: frame.title ?? chat.title,
    updatedAt: frame.updatedAt ?? chat.updatedAt,
    workingSince:
      frame.workingSince === undefined ? chat.workingSince : (frame.workingSince ?? undefined),
    ...(frame.unread === undefined ? {} : { unread: frame.unread }),
  };
  return sameChat(chat, next) ? chat : next;
}

function applyChatListFrame(current: State, frame: ChatFrame, serverId: string): Partial<State> {
  if (typeof frame.sequence === "number") {
    const previous = sidebarSequences.get(serverId) ?? -1;
    if (frame.sequence <= previous) return current;
    sidebarSequences.set(serverId, frame.sequence);
  }
  sidebarProjectionServers.add(serverId);
  if (frame.operation === "remove" && frame.chatIds?.length) {
    const removed = new Set(frame.chatIds);
    return {
      chats: current.chats.filter((chat) => chat.serverId !== serverId || !removed.has(chat.id)),
      dms: current.dms.filter((chat) => chat.serverId !== serverId || !removed.has(chat.id)),
    };
  }
  if (frame.operation !== "upsert" || !frame.chat) return current;
  const chat = toChat(frame.chat, serverId);
  const upsert = (items: Chat[]) => {
    const existing = items.findIndex((entry) => entry.serverId === serverId && entry.id === chat.id);
    if (existing < 0) return [...items, chat];
    if (sameChat(items[existing]!, chat)) return items;
    const next = items.slice();
    next[existing] = chat;
    return next;
  };
  return chat.dm
    ? {
        chats: current.chats.filter((entry) => entry.serverId !== serverId || entry.id !== chat.id),
        dms: upsert(current.dms),
      }
    : {
        chats: upsert(current.chats).sort(byNewest),
        dms: current.dms.filter((entry) => entry.serverId !== serverId || entry.id !== chat.id),
      };
}

function applyChatFrame(current: State, frame: ChatFrame, serverId: string): Partial<State> {
  // The row in the list is patched in place rather than re-sorted: a chat that
  // is streaming would otherwise walk up and down the sidebar on every frame.
  // A frame does not say which list its conversation is in, so both are asked.
  const chats = patchChatList(current.chats, frame, serverId);
  const dms = patchChatList(current.dms, frame, serverId);
  const detail = current.details[frame.chatId ?? ""];
  const details = detail && detail.serverId === serverId
    ? { ...current.details, [detail.id]: mergeDetail(detail, frame) }
    : current.details;
  if (chats === current.chats && dms === current.dms && details === current.details) return current;
  return {
    ...(chats === current.chats ? {} : { chats }),
    ...(dms === current.dms ? {} : { dms }),
    ...(details === current.details ? {} : { details }),
  };
}

function patchChatList(chats: Chat[], frame: ChatFrame, serverId: string): Chat[] {
  const index = chats.findIndex((chat) => chat.id === frame.chatId && chat.serverId === serverId);
  if (index < 0) return chats;
  const next = patchRow(chats[index]!, frame);
  if (next === chats[index]) return chats;
  const patched = chats.slice();
  patched[index] = next;
  return patched;
}

function mergeDetail(detail: ChatDetail, frame: ChatFrame): ChatDetail {
  let entries = detail.entries;
  if (frame.removed?.length) {
    const gone = new Set(frame.removed);
    entries = entries.filter((entry) => !gone.has(entry.id));
  }
  if (frame.entries?.length) {
    const next = entries.slice();
    for (const entry of frame.entries) {
      // A streaming entry keeps its place in the feed while its text grows.
      const at = next.findIndex((existing) => existing.id === entry.id);
      if (at >= 0) next[at] = entry;
      else next.push(entry);
    }
    entries = next;
  }
  const next = {
    ...detail,
    entries,
    state: frame.state ?? detail.state,
    action: frame.action === undefined ? detail.action : frame.action ?? undefined,
    approval: frame.approval === undefined ? detail.approval : frame.approval ?? undefined,
    question: frame.question === undefined ? detail.question : frame.question ?? undefined,
    todos: frame.todos ?? detail.todos,
    title: frame.title ?? detail.title,
    live: frame.live ?? detail.live,
    error: frame.error === undefined ? detail.error : frame.error ?? undefined,
    context: frame.context === undefined ? detail.context : frame.context ?? undefined,
    workingSince:
      frame.workingSince === undefined ? detail.workingSince : (frame.workingSince ?? undefined),
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
    agentId: raw.agentId,
    model: raw.model,
    effort: raw.effort,
    preview: raw.preview,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt ?? 0,
    workingSince: raw.workingSince ?? undefined,
    ...(raw.dm ? { dm: true } : {}),
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
    agentId: raw.conversation?.agentId,
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

/// Which machine owns a project's tickets. A project belongs to whichever
/// server answered with it, so a write goes back to that one rather than to
/// whichever machine happens to be local.
function boardServer(servers: Server[], projects: Project[], projectId: string): string {
  const project = projects.find((entry) => entry.id === projectId);
  const server = project?.serverId ?? localServer(servers)?.id;
  if (!server) throw new Error("This machine isn't connected.");
  return server;
}

type RawAgent = Omit<Agent, "serverId">;
type RawProject = Omit<Project, "serverId" | "workspaceIds"> & { workspaceIds?: string[] };
type RawTicket = Omit<Ticket, "serverId" | "threads"> & { threads?: Ticket["threads"] };
type RawRoutine = Omit<Routine, "serverId">;

function toTicket(raw: RawTicket, serverId: string): Ticket {
  return { ...raw, serverId, threads: raw.threads ?? [] } as Ticket;
}

/// Puts the row a write answered with back where it came from.
///
/// A write already holds the record it made, so the pane it is on repaints from
/// that rather than from a read of the whole board — which is a round trip the
/// person is watching, and one that used to wait on every paired machine.
function withRow<T extends { id: string }>(rows: T[], row: T): T[] {
  return rows.some((entry) => entry.id === row.id)
    ? rows.map((entry) => (entry.id === row.id ? row : entry))
    : [...rows, row];
}

function withTicket(rows: Ticket[], row: Ticket): Ticket[] {
  return withRow(rows, row).sort(byRank);
}

function withRoutine(rows: Routine[], row: Routine): Routine[] {
  return withRow(rows, row).sort((a, b) => a.nextRunAt - b.nextRunAt);
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
