import { create } from "zustand";
import { isMissingRoute } from "../lib/api-error";
import { codeFor, type DeviceIconId } from "../lib/devices";
import { agentConversation, availableAgentServers, preferredServer } from "../lib/inbox";
import { applyProjectIdentity } from "../lib/projects";
import { PROVIDERS, type Provider } from "../lib/providers";
import { transport } from "../lib/transport";
import type { TintId } from "../lib/tints";
import type {
  Agent,
  Chat,
  ChatApproval,
  ChatDetail,
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
  PullRequestSummary,
  Routine,
  Server,
  ServerSettings,
  Ticket,
  TicketActivity,
  TicketStatus,
  Workspace,
} from "./types";

/// A capability a paired Mac may not have. Remembered per device the first time
/// it answers 404, so a control can say the Mac cannot do this rather than
/// asking again on every paint and failing the same way.
export type Capability = "providers" | "routines";

interface RawChat {
  id: string;
  title: string;
  cwd: string;
  state?: ChatState;
  provider?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  preview?: string;
  createdAt?: number;
  updatedAt?: number;
  workingSince?: number | null;
  action?: string | null;
  pinned?: boolean;
  parentChatId?: string;
  turns?: number;
  costUsd?: number;
  context?: ContextUsage | null;
  live?: boolean;
  error?: string | null;
  dm?: boolean;
  unread?: boolean;
  agentId?: string;
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

interface State {
  servers: Server[];
  chats: Chat[];
  /// The inbox: one conversation per agent, across every paired machine.
  dms: Chat[];
  workspaces: Workspace[];
  openId?: string;
  detail?: ChatDetail;
  detailLoading: boolean;
  /// One Mac's settings, keyed by its device. Each paired Mac holds its own
  /// defaults, so what a new thread inherits depends on where it will run.
  settings: Record<string, ServerSettings>;
  /// What each Mac says a thread there can think with. A Mac too old to answer
  /// keeps the catalogue this app shipped with.
  providers: Record<string, Provider[]>;
  /// Capabilities a Mac has told us it does not have.
  missing: Record<string, Capability[]>;
  /// Why a Mac cannot hold threads at all, in its own words. An older Node, or
  /// a database it could not open.
  threadsUnavailable: Record<string, string>;
  agents: Agent[];
  projects: Project[];
  tickets: Ticket[];
  routines: Routine[];
  boardDevices: { deviceId: string; serverId: string }[];
  boardLoading: boolean;
  loading: boolean;
  error?: string;
  connected: boolean;
  pairRequests: PairRequest[];

  start(): () => void;
  refresh(): Promise<void>;
  /// Re-reads one Mac's threads and workspaces. What a live frame from that Mac
  /// asks for; the rest of the fleet is left alone.
  refreshServer(serverId: string): Promise<void>;
  /// Re-reads everything one Mac owns after its live stream came back.
  resync(serverId: string, options?: { reconnect?: boolean }): Promise<void>;
  loadSettings(serverId?: string): Promise<void>;
  loadProviders(serverId?: string): Promise<void>;
  loadBoard(serverId?: string): Promise<void>;
  loadPairRequests(): Promise<void>;
  updateServer(id: string, patch: { name?: string; icon?: DeviceIconId; tint?: TintId }): Promise<void>;
  addWorkspace(input: { path: string; name?: string; serverId?: string }): Promise<void>;
  workspaceFile(id: string, path: string): Promise<{ mime: string; data: string } | undefined>;
  suggestPaths(query: string, serverId?: string): Promise<PathSuggestion[]>;
  listBranches(workspaceId: string): Promise<GitBranch[]>;
  checkoutBranch(input: { workspaceId: string; branch: string; mode: "main" | "worktree" }): Promise<{ path: string }>;
  createChat(input: {
    cwd: string;
    text: string;
    serverId?: string;
    provider?: string;
    model?: string;
    effort?: string;
    permissionMode?: string;
  }): Promise<{ id: string; serverId: string }>;
  openChat(id: string): Promise<void>;
  /// Opens an agent's conversation, making it if this is the first time. The
  /// Mac holding the agent is the one that holds the conversation.
  openDm(agent: Agent): Promise<Chat>;
  /// Clears an inbox conversation's unread mark.
  readChat(id: string): Promise<void>;
  closeChat(): void;
  sendMessage(text: string): Promise<void>;
  answerApproval(requestId: string, decision: "allow" | "allowAlways" | "deny"): Promise<void>;
  answerQuestion(requestId: string, answers: Record<string, unknown>): Promise<void>;
  interrupt(): Promise<void>;
  setChatOptions(patch: {
    provider?: string;
    model?: string | null;
    effort?: string | null;
    permissionMode?: string;
  }): Promise<void>;
  /// The pull request on the open thread's branch, or nothing when the branch
  /// has none and when the Mac is too old to be asked.
  threadPullRequest(id: string): Promise<PullRequestSummary | undefined>;
  /// Writes an agent, or creates one when `id` is absent.
  saveAgent(id: string | undefined, patch: Record<string, unknown>): Promise<Agent>;
  deleteAgent(id: string): Promise<void>;
  saveRoutine(id: string, patch: Record<string, unknown>): Promise<Routine>;
  deleteRoutine(id: string): Promise<void>;
  runRoutine(id: string): Promise<Routine>;
  archiveThread(id: string): Promise<void>;
  deleteThread(id: string): Promise<void>;
  renameThread(id: string, title: string): Promise<void>;
  pinThread(id: string, pinned: boolean): Promise<void>;
  /// Ends the run a thread is in without sending anything.
  stopThread(id: string): Promise<void>;
  createTicket(input: { projectId: string; title: string; body?: string; parentId?: string }): Promise<Ticket>;
  updateTicket(id: string, patch: Record<string, unknown>): Promise<void>;
  moveTicket(id: string, status: TicketStatus): Promise<void>;
  commentOnTicket(id: string, body: string): Promise<void>;
  ticketActivity(id: string): Promise<TicketActivity[]>;
  answerPair(id: string, decision: "approve" | "deny"): Promise<void>;
}

// Push is the freshness path. Polling is the recovery one: a Mac that has
// announced its live stream is asked again only rarely, and a Mac that has not
// — an older build, or one whose socket is down — is asked often enough that
// the phone never goes quietly stale.
const POLL_PUSHING_MS = 60_000;
const POLL_CONNECTED_MS = 15_000;
const POLL_DISCONNECTED_MS = 4_000;

/// Macs that have said they push live frames, so polling can stand down for
/// them. Module state rather than store state: nothing renders it.
const pushing = new Set<string>();
/// Macs whose live stream has opened at least once, so a `hello` can tell the
/// first connect — whose state the boot read already covers — from a reconnect,
/// which may have missed frames while the socket was gone.
const streamed = new Set<string>();
let detailSubscription: (() => void) | undefined;

export const useStore = create<State>((set, get) => ({
  servers: [],
  chats: [],
  dms: [],
  workspaces: [],
  settings: {},
  providers: {},
  missing: {},
  threadsUnavailable: {},
  agents: [],
  projects: [],
  tickets: [],
  routines: [],
  pairRequests: [],
  boardDevices: [],
  boardLoading: false,
  detailLoading: false,
  loading: true,
  connected: false,

  start() {
    void get()
      .refresh()
      .then(() => get().loadPairRequests())
      .catch(() => {});

    const refreshTopics = (serverId: string, topics: string[] = []) => {
      if (topics.includes("sidebar")) void get().refreshServer(serverId);
      if (topics.includes("board")) void get().loadBoard(serverId);
      if (topics.includes("settings")) {
        void get().loadSettings(serverId);
        void get().loadProviders(serverId);
      }
      const open = get().detail;
      if (open?.serverId === serverId && topics.includes(`thread:${open.id}`)) {
        void get().openChat(open.id).catch(() => {});
      }
    };
    const offPush = transport.subscribe((serverId, payload) => {
      const frame = payload as ChatFrame;
      if (frame.type === "hello") {
        const relayed = frame.peerStreams ?? [];
        for (const id of [serverId, ...relayed]) pushing.add(id);
        if (frame.reset) refreshTopics(serverId, frame.topics ?? []);
        else if (!streamed.has(serverId)) void get().resync(serverId);
        return;
      }
      if (frame.type === "reset") {
        refreshTopics(serverId, frame.topics ?? []);
        return;
      }
      // The relay to one peer restarted, so its own history is gone whether or
      // not this phone had seen it before.
      if (frame.type === "peer-reset") {
        pushing.add(serverId);
        refreshTopics(serverId, frame.topics ?? []);
        return;
      }
      if (frame.type === "peer-disconnected") {
        pushing.delete(serverId);
        return;
      }
      if (frame.type === "chats") {
        void get().refreshServer(serverId);
        return;
      }
      if (frame.type === "board") {
        void get().loadBoard(serverId);
        return;
      }
      // The set of paired machines changed, which is the one thing no single
      // Mac's slice can answer.
      if (frame.type === "peers") {
        void get().refresh();
        return;
      }
      if (frame.type === "pair-requests") {
        void get().loadPairRequests();
        return;
      }
      if (frame.type === "chat" && frame.chatId) {
        set((current) => applyChatFrame(current, frame, serverId));
      }
    }, ["sidebar", "board", "settings"]);

    const offStatus = transport.onStatus((serverId, pushUp) => {
      if (!pushUp) pushing.delete(serverId);
      set((current) => ({
        connected: pushUp || current.servers.some((server) => server.id !== serverId && server.online),
        servers: pushUp
          ? current.servers.map((server) => (server.id === serverId ? { ...server, online: true } : server))
          : current.servers,
      }));
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      await get().refresh();
      await get().loadPairRequests().catch(() => {});
      if (stopped) return;
      timer = setTimeout(() => void poll(), pollDelay(get().servers, get().connected));
    };
    timer = setTimeout(() => void poll(), POLL_CONNECTED_MS);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      pushing.clear();
      streamed.clear();
      detailSubscription?.();
      detailSubscription = undefined;
      offPush();
      offStatus();
    };
  },

  /// Everything one Mac owns, after its live stream opened.
  ///
  /// On the first connect the boot read has already asked for its threads and
  /// workspaces, so only what nothing else reads is fetched. On a reconnect
  /// every list is asked again, including the thread on screen: a frame sent
  /// while the socket was down is never resent.
  async resync(serverId, options) {
    const reconnect = options?.reconnect === true || streamed.has(serverId);
    streamed.add(serverId);
    await Promise.all([
      get().loadSettings(serverId).catch(() => {}),
      get().loadProviders(serverId).catch(() => {}),
      ...(reconnect
        ? [get().refreshServer(serverId).catch(() => {}), get().loadBoard(serverId).catch(() => {})]
        : []),
    ]);
    if (!reconnect) return;
    const open = get().detail;
    if (open?.serverId === serverId) await get().openChat(open.id).catch(() => {});
  },

  async refresh() {
    if (get().servers.length === 0) set({ loading: true });
    const servers = await transport.servers();
    if (servers.length === 0) {
      slices.clear();
      pushing.clear();
      streamed.clear();
      set({
        servers: [],
        chats: [],
        dms: [],
        workspaces: [],
        settings: {},
        providers: {},
        missing: {},
        threadsUnavailable: {},
        loading: false,
        error: undefined,
        connected: false,
      });
      return;
    }

    const results = await Promise.all(servers.map((server) => readServer(server, get)));
    const failures = results.flatMap((r) => (r.failure ? [`${r.server.name}: ${r.failure}`] : []));
    // A Mac that is no longer paired takes its own answers with it, so nothing
    // it said is applied to whatever holds that id next.
    const paired = new Set(servers.map((server) => server.id));
    for (const id of [...slices.keys()]) if (!paired.has(id)) slices.delete(id);
    for (const id of [...pushing]) if (!paired.has(id)) pushing.delete(id);
    for (const id of [...streamed]) if (!paired.has(id)) streamed.delete(id);

    set((current) => ({
      settings: onlyPaired(current.settings, paired),
      providers: onlyPaired(current.providers, paired),
      missing: onlyPaired(current.missing, paired),
      threadsUnavailable: Object.fromEntries(
        results.flatMap((r) => (r.unavailable ? [[r.server.id, r.unavailable]] : [])),
      ),
      servers: results.map((r) => r.server),
      chats: results.flatMap((r) => r.chats).sort(byNewest),
      dms: results.flatMap((r) => r.dms),
      workspaces: applyProjectIdentity(results.flatMap((r) => r.workspaces), get().projects),
      loading: false,
      error: failures.length === servers.length ? failures.join("; ") : undefined,
      connected: results.some((r) => r.server.online),
    }));
  },

  async refreshServer(serverId) {
    const server = get().servers.find((entry) => entry.id === serverId);
    if (!server) {
      await get().refresh();
      return;
    }
    const result = await readServer(server, get);
    set((current) => {
      const others = <T extends { serverId: string }>(rows: T[]) =>
        rows.filter((row) => row.serverId !== serverId);
      const threadsUnavailable = { ...current.threadsUnavailable };
      if (result.unavailable) threadsUnavailable[serverId] = result.unavailable;
      else delete threadsUnavailable[serverId];
      return {
        threadsUnavailable,
        servers: current.servers.map((entry) => (entry.id === serverId ? result.server : entry)),
        chats: [...others(current.chats), ...result.chats].sort(byNewest),
        dms: [...others(current.dms), ...result.dms],
        workspaces: applyProjectIdentity(
          [...others(current.workspaces), ...result.workspaces],
          current.projects,
        ),
        connected: result.server.online || current.servers.some((entry) => entry.id !== serverId && entry.online),
      };
    });
  },

  async loadSettings(serverId) {
    const wanted = serverId
      ? get().servers.filter((server) => server.id === serverId)
      : get().servers.filter((server) => server.online && !server.cloud);
    const loaded = await Promise.all(wanted.map(async (server) => {
      try {
        return [server.id, await transport.request<ServerSettings>(server.id, "/server/settings")] as const;
      } catch {
        // Its own settings are the only thing this loses; every reader falls
        // back to what the phone can work out on its own.
        return undefined;
      }
    }));
    const answered = loaded.filter((entry): entry is readonly [string, ServerSettings] => Boolean(entry));
    if (answered.length === 0) return;
    set((current) => ({ settings: { ...current.settings, ...Object.fromEntries(answered) } }));
  },

  async loadProviders(serverId) {
    const wanted = serverId
      ? get().servers.filter((server) => server.id === serverId)
      : get().servers.filter((server) => server.online && !server.cloud);
    const loaded = await Promise.all(wanted.map(async (server) => {
      try {
        const body = await transport.request<{ providers?: Provider[] }>(server.id, "/server/providers");
        if (!body.providers?.length) return undefined;
        return { serverId: server.id, providers: body.providers };
      } catch (error) {
        // A Mac from before the catalogue route keeps the one this app shipped
        // with, and says so wherever the difference matters.
        return { serverId: server.id, missing: isMissingRoute(error) };
      }
    }));
    set((current) => {
      const providers = { ...current.providers };
      const missing = { ...current.missing };
      for (const entry of loaded) {
        if (!entry) continue;
        if (entry.providers) {
          providers[entry.serverId] = entry.providers;
          missing[entry.serverId] = without(missing[entry.serverId], "providers");
        } else if (entry.missing) {
          missing[entry.serverId] = withCapability(missing[entry.serverId], "providers");
        }
      }
      return { providers, missing };
    });
  },

  async loadPairRequests() {
    const homes = get().servers.filter((server) => server.home);
    if (homes.length === 0) {
      set({ pairRequests: [] });
      return;
    }
    const listed = await Promise.all(
      homes.map(async (home) => {
        try {
          const answer = await transport.request<{ requests?: Omit<PairRequest, "serverId">[] }>(
            home.id,
            "/pair/pending",
          );
          return (answer.requests ?? []).map((request) => ({ ...request, serverId: home.id }));
        } catch {
          return [] as PairRequest[];
        }
      }),
    );
    set({ pairRequests: listed.flat() });
  },

  async answerPair(id, decision) {
    const request = get().pairRequests.find((entry) => entry.id === id);
    const home =
      get().servers.find((server) => server.id === request?.serverId) ?? homeServer(get().servers);
    if (!home) throw new Error("This phone is not paired.");
    await transport.request(home.id, `/pair/pending/${encodeURIComponent(id)}/${decision}`, { method: "POST" });
    await get().loadPairRequests();
    if (decision === "approve") await get().refresh();
  },

  async loadBoard(serverId) {
    const servers = get().servers.length ? get().servers : await transport.servers();
    if (servers.length === 0) {
      slices.clear();
      set({ agents: [], projects: [], tickets: [], routines: [], boardDevices: [], boardLoading: false });
      return;
    }
    // One Mac's frame refreshes one Mac's slice. The board converges rather
    // than being copied, so every Mac answers with the same tickets and the
    // rest of the fleet has nothing to re-read.
    const wanted = serverId ? servers.filter((server) => server.id === serverId) : servers;
    if (wanted.length === 0) return;
    if (get().tickets.length === 0) set({ boardLoading: true });
    await Promise.all(wanted.map(async (server) => {
      try {
        const board = await transport.request<{
          deviceId?: string;
          agents?: RawAgent[];
          projects?: RawProject[];
          tickets?: RawTicket[];
          routines?: RawRoutine[];
        }>(server.id, "/board");
        slices.set(server.id, {
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
          // Absent on a Mac from before routines, which is not the same as
          // that Mac having none.
          routines: (board.routines ?? []).map((raw) => ({ ...raw, serverId: server.id }) as Routine),
          hasRoutines: board.routines !== undefined,
        });
      } catch {
        // Its last answer stays on screen; the Mac shows as unreachable.
      }
    }));
    const dedupe = <T extends { id: string }>(rows: T[]): T[] =>
      [...new Map(rows.map((row) => [row.id, row])).values()];
    const ordered = servers.flatMap((server) => {
      const slice = slices.get(server.id);
      return slice ? [slice] : [];
    });
    set((current) => {
      const projects = dedupe(ordered.flatMap((slice) => slice.projects));
      const missing = { ...current.missing };
      for (const server of servers) {
        const slice = slices.get(server.id);
        if (!slice) continue;
        missing[server.id] = slice.hasRoutines
          ? without(missing[server.id], "routines")
          : withCapability(missing[server.id], "routines");
      }
      return {
        agents: dedupe(ordered.flatMap((slice) => slice.agents)),
        projects,
        workspaces: applyProjectIdentity(current.workspaces, projects),
        tickets: dedupe(ordered.flatMap((slice) => slice.tickets))
          .sort((a, b) => a.rank.localeCompare(b.rank)),
        routines: dedupe(ordered.flatMap((slice) => slice.routines)),
        boardDevices: ordered.flatMap((slice) => slice.devices),
        boardLoading: false,
        missing,
      };
    });
  },

  async createTicket(input) {
    const project = get().projects.find((entry) => entry.id === input.projectId);
    const serverId = project?.serverId ?? homeServer(get().servers)?.id;
    if (!serverId) throw new Error("This Mac isn't connected.");
    const body = await transport.request<{ ticket: RawTicket }>(serverId, "/tickets", {
      method: "POST",
      body: input,
    });
    // The Mac that wrote it is the one with the answer. Its peers merge the
    // event and send a board frame of their own when they do.
    await get().loadBoard(serverId);
    return { ...body.ticket, serverId, threads: body.ticket.threads ?? [] } as Ticket;
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
    const server = get().servers.find((entry) => entry.id === input.serverId) ?? homeServer(get().servers);
    if (!server) throw new Error("This Mac isn't connected.");
    await transport.request(server.id, "/workspaces", { method: "POST", body: { name, path } });
    await get().refreshServer(server.id);
  },

  async workspaceFile(id, path) {
    const workspace = get().workspaces.find((entry) => entry.id === id);
    const server = get().servers.find((entry) => entry.id === workspace?.serverId) ?? homeServer(get().servers);
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

  async suggestPaths(query, serverId) {
    const server = get().servers.find((entry) => entry.id === serverId) ?? homeServer(get().servers);
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

  async listBranches(workspaceId) {
    const workspace = get().workspaces.find((entry) => entry.id === workspaceId);
    const fromTrees = branchesFromWorktrees(workspace);
    const server = get().servers.find((entry) => entry.id === workspace?.serverId) ?? homeServer(get().servers);
    if (!server) return fromTrees;
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
    if (input.mode === "main" && main && main.branch === input.branch) return { path: main.path };
    if (input.mode === "worktree") {
      const existing = workspace?.worktrees.find((tree) => tree.branch === input.branch && !tree.isMain);
      if (existing) return { path: existing.path };
      // A first send from origin/main leaves a detached tree at `.remy/origin/main`
      // until the namer claims a branch. Reuse it rather than failing on the folder.
      const marker = `/.remy/${input.branch}`;
      const detached = workspace?.worktrees.find((tree) => !tree.isMain && tree.path.endsWith(marker));
      if (detached) return { path: detached.path };
    }
    const server = get().servers.find((entry) => entry.id === workspace?.serverId) ?? homeServer(get().servers);
    if (!server) throw new Error("This Mac isn't connected.");
    const result = await transport.request<{ path?: string }>(
      server.id,
      `/workspaces/${encodeURIComponent(input.workspaceId)}/checkout`,
      { method: "POST", body: { branch: input.branch, mode: input.mode } },
    );
    await get().refreshServer(server.id);
    if (!result.path) throw new Error("Couldn't switch to that branch.");
    return { path: result.path };
  },

  async createChat(input) {
    const text = input.text.trim();
    if (!text) throw new Error("Write a message first.");
    const cwd = input.cwd.trim() || "~";
    const title = text.split("\n")[0]?.slice(0, 80) || "New thread";
    const server = get().servers.find((entry) => entry.id === input.serverId) ?? homeServer(get().servers);
    if (!server) throw new Error("This Mac isn't connected.");
    const created = await transport.request<{ chat?: RawChat }>(server.id, "/chats", {
      method: "POST",
      body: {
        cwd,
        title,
        ...(input.provider ? { provider: input.provider } : {}),
        // An empty model is a choice — that provider's own default — so it goes
        // as an empty string rather than being left out.
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.effort === undefined ? {} : { effort: input.effort }),
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      },
    });
    const id = created.chat?.id;
    if (!id) throw new Error("Couldn't start that thread.");
    try {
      await transport.request(server.id, `/chats/${encodeURIComponent(id)}/message`, {
        method: "POST",
        body: { text },
      });
    } catch (error) {
      await get().refreshServer(server.id);
      const failed = error instanceof Error ? error : new Error(String(error));
      (failed as Error & { chatId?: string }).chatId = id;
      throw failed;
    }
    await get().refreshServer(server.id);
    return { id, serverId: server.id };
  },

  async openChat(id) {
    // Both lists: an inbox conversation opens the same way a thread does.
    const chat = get().chats.find((entry) => entry.id === id)
      ?? get().dms.find((entry) => entry.id === id);
    if (!chat) return;
    if (get().openId !== id) {
      detailSubscription?.();
      detailSubscription = transport.subscribe(() => {}, [`thread:${id}`]);
    }
    const same = get().detail?.id === id;
    set({ openId: id, detailLoading: !same, ...(same ? {} : { detail: undefined }) });
    try {
      const raw = await transport.request<RawChatDetail>(chat.serverId, `/chats/${encodeURIComponent(id)}`);
      if (get().openId !== id) return;
      set({ detail: toDetail(raw, chat.serverId), detailLoading: false });
    } catch (error) {
      if (get().openId !== id) return;
      set({ detailLoading: false });
      throw error;
    }
  },

  closeChat() {
    detailSubscription?.();
    detailSubscription = undefined;
    set({ openId: undefined, detail: undefined, detailLoading: false });
  },

  async openDm(agent) {
    // An agent replicated to two Macs is still one agent with one conversation,
    // so which device holds it is the device preference order's answer rather
    // than whichever Mac happened to answer with the agent row.
    const preferenceOrder = deviceOrderOf(get());
    const candidates = availableAgentServers(get().servers, preferenceOrder);
    const available = new Set(candidates.map((server) => server.id));
    const existing = agentConversation(agent.id, get().dms, get().servers, preferenceOrder);
    if (existing && available.has(existing.serverId)) return existing;

    let failure: unknown;
    for (const server of candidates) {
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
    throw new Error("No Mac is available to run this agent.");
  },

  async readChat(id) {
    const chat = get().dms.find((entry) => entry.id === id);
    if (!chat?.unread) return;
    // Cleared here first: the row should stop being bold the moment you open
    // it, not when the Mac gets back to us.
    set((current) => ({
      dms: current.dms.map((entry) => (entry.id === id ? { ...entry, unread: false } : entry)),
    }));
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}/read`, { method: "POST" })
      .catch(() => {
        // A mark that did not save comes back on the next refresh.
      });
  },

  async sendMessage(text) {
    const detail = get().detail;
    const trimmed = text.trim();
    if (!detail || !trimmed) return;
    await transport.request(detail.serverId, `/chats/${encodeURIComponent(detail.id)}/message`, {
      method: "POST",
      body: { text: trimmed },
    });
    if (!get().connected) await get().openChat(detail.id);
  },

  async answerApproval(requestId, decision) {
    const detail = get().detail;
    if (!detail) return;
    await transport.request(detail.serverId, `/chats/${encodeURIComponent(detail.id)}/approval`, {
      method: "POST",
      body: { requestId, decision },
    });
  },

  async answerQuestion(requestId, answers) {
    const detail = get().detail;
    if (!detail) return;
    await transport.request(detail.serverId, `/chats/${encodeURIComponent(detail.id)}/question`, {
      method: "POST",
      body: { requestId, answers },
    });
  },

  async interrupt() {
    const detail = get().detail;
    if (!detail) return;
    await transport.request(detail.serverId, `/chats/${encodeURIComponent(detail.id)}/interrupt`, {
      method: "POST",
      body: {},
    });
  },

  async setChatOptions(patch) {
    const detail = get().detail;
    if (!detail) return;
    const body = await transport.request<{ chat?: RawChatDetail }>(
      detail.serverId,
      `/chats/${encodeURIComponent(detail.id)}`,
      { method: "PATCH", body: patch },
    );
    const chat = body.chat;
    if (!chat) return;
    // Read back rather than assumed: the Mac validates provider, model and
    // effort as one choice, and may answer with a different model than the one
    // asked for.
    const settled = { provider: chat.provider, model: chat.model, effort: chat.effort };
    set((current) => ({
      detail:
        current.detail?.id === detail.id
          ? { ...current.detail, ...settled, permissionMode: chat.permissionMode }
          : current.detail,
      chats: current.chats.map((entry) => (entry.id === detail.id ? { ...entry, ...settled } : entry)),
      dms: current.dms.map((entry) => (entry.id === detail.id ? { ...entry, ...settled } : entry)),
    }));
  },

  async threadPullRequest(id) {
    const chat = get().chats.find((entry) => entry.id === id)
      ?? get().dms.find((entry) => entry.id === id);
    if (!chat) return undefined;
    try {
      const body = await transport.request<{ pullRequest?: PullRequestSummary | null }>(
        chat.serverId,
        `/chats/${encodeURIComponent(id)}/pull-request`,
      );
      return body.pullRequest ?? undefined;
    } catch (error) {
      // This route answers 404 both for "no pull request on that branch" and on
      // a Mac that never had it, so it cannot mark the Mac as lacking it. A
      // thread with no pull request simply shows none.
      if (!isMissingRoute(error)) throw error;
      return undefined;
    }
  },

  async saveAgent(id, patch) {
    const existing = id ? get().agents.find((agent) => agent.id === id) : undefined;
    // A new agent belongs on the Mac this phone would run it on.
    const serverId = existing?.serverId
      ?? preferredServer(get().servers, deviceOrderOf(get()))?.id;
    if (!serverId) throw new Error("This Mac isn't connected.");
    const body = await transport.request<{ agent: RawAgent }>(
      serverId,
      id ? `/agents/${encodeURIComponent(id)}` : "/agents",
      { method: id ? "PATCH" : "POST", body: patch },
    );
    const agent = { ...body.agent, serverId } as Agent;
    set((current) => ({ agents: replace(current.agents, agent) }));
    void get().loadBoard(serverId).catch(() => {});
    return agent;
  },

  async deleteAgent(id) {
    const agent = get().agents.find((entry) => entry.id === id);
    if (!agent) return;
    await transport.request(agent.serverId, `/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
    // Deleting an agent deletes its conversation; `listDms` stops answering
    // with it, so both lists are read again rather than patched.
    set((current) => ({ agents: current.agents.filter((entry) => entry.id !== id) }));
    await get().refreshServer(agent.serverId).catch(() => {});
    void get().loadBoard(agent.serverId).catch(() => {});
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
    set((current) => ({ routines: replace(current.routines, routine) }));
    void get().loadBoard(existing.serverId).catch(() => {});
    return routine;
  },

  async deleteRoutine(id) {
    const routine = get().routines.find((entry) => entry.id === id);
    if (!routine) return;
    await transport.request(routine.serverId, `/routines/${encodeURIComponent(id)}`, { method: "DELETE" });
    set((current) => ({ routines: current.routines.filter((entry) => entry.id !== id) }));
    void get().loadBoard(routine.serverId).catch(() => {});
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
    set((current) => ({ routines: replace(current.routines, updated) }));
    // The run starts a turn, so the thread list has something new in it.
    await get().refreshServer(routine.serverId).catch(() => {});
    return updated;
  },

  async archiveThread(id) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) return;
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}/archive`, { method: "POST", body: {} });
    await get().refreshServer(chat.serverId);
  },

  async deleteThread(id) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) return;
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
    await get().refreshServer(chat.serverId);
    // A deleted thread was a ticket's linked thread until a moment ago.
    await get().loadBoard(chat.serverId).catch(() => {});
  },

  async renameThread(id, title) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === chat.title) return;
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { title: trimmed },
    });
    set((current) => ({
      chats: current.chats.map((entry) => (entry.id === id ? { ...entry, title: trimmed } : entry)),
      detail: current.detail?.id === id ? { ...current.detail, title: trimmed } : current.detail,
    }));
  },

  async pinThread(id, pinned) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) return;
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { pinned },
    });
    set((current) => ({
      chats: current.chats.map((entry) => (entry.id === id ? { ...entry, pinned } : entry)).sort(byNewest),
    }));
  },

  async stopThread(id) {
    const chat = get().chats.find((entry) => entry.id === id)
      ?? get().dms.find((entry) => entry.id === id);
    if (!chat) return;
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}/stop`, {
      method: "POST",
      body: {},
    });
  },

  async updateTicket(id, patch) {
    const ticket = get().tickets.find((entry) => entry.id === id);
    if (!ticket) return;
    await transport.request(ticket.serverId, `/tickets/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
    await get().loadBoard(ticket.serverId);
  },

  async moveTicket(id, status) {
    const ticket = get().tickets.find((entry) => entry.id === id);
    if (!ticket) return;
    set((current) => ({
      tickets: current.tickets.map((entry) => (entry.id === id ? { ...entry, status } : entry)),
    }));
    try {
      await transport.request(ticket.serverId, `/tickets/${encodeURIComponent(id)}/move`, {
        method: "POST",
        body: { status },
      });
    } finally {
      await get().loadBoard(ticket.serverId);
    }
  },

  async commentOnTicket(id, body) {
    const ticket = get().tickets.find((entry) => entry.id === id);
    if (!ticket) return;
    await transport.request(ticket.serverId, `/tickets/${encodeURIComponent(id)}/comment`, {
      method: "POST",
      body: { body },
    });
    await get().loadBoard(ticket.serverId);
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
}));

interface ChatFrame {
  type?: string;
  /// On a `hello`, the peers this Mac already relays live frames for.
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
}

interface RawChatDetail extends RawChat {
  entries?: ConvEntry[];
  todos?: ConvTodo[];
  approval?: ChatApproval | null;
  question?: ChatQuestionRequest | null;
}

function toDetail(raw: RawChatDetail, serverId: string): ChatDetail {
  return {
    id: raw.id,
    serverId,
    title: raw.title,
    cwd: raw.cwd,
    model: raw.model,
    effort: raw.effort,
    permissionMode: raw.permissionMode,
    state: raw.state ?? "idle",
    provider: raw.provider,
    action: raw.action ?? undefined,
    entries: raw.entries ?? [],
    todos: raw.todos ?? [],
    approval: raw.approval ?? undefined,
    question: raw.question ?? undefined,
    live: raw.live,
    error: raw.error ?? undefined,
    context: raw.context ?? undefined,
    ...(raw.dm ? { dm: true } : {}),
    ...(raw.agentId ? { agentId: raw.agentId } : {}),
    ...(raw.pinned ? { pinned: true } : {}),
    ...(raw.parentChatId ? { parentChatId: raw.parentChatId } : {}),
    ...(raw.turns === undefined ? {} : { turns: raw.turns }),
    ...(raw.costUsd === undefined ? {} : { costUsd: raw.costUsd }),
  };
}

function patchRow(chat: Chat, frame: ChatFrame): Chat {
  if (chat.id !== frame.chatId) return chat;
  return {
    ...chat,
    state: frame.state ?? chat.state,
    title: frame.title ?? chat.title,
    updatedAt: frame.updatedAt ?? chat.updatedAt,
    workingSince: frame.workingSince === undefined ? chat.workingSince : (frame.workingSince ?? undefined),
    action: frame.action === undefined ? chat.action : (frame.action ?? undefined),
    ...(frame.unread === undefined ? {} : { unread: frame.unread }),
  };
}

function applyChatFrame(current: State, frame: ChatFrame, serverId: string): Partial<State> {
  // A frame does not say which list its conversation is in, so both are asked.
  // It does say which Mac it came from, and two Macs can hold a thread with the
  // same id, so the row has to agree on both.
  const owned = (chat: Chat) => chat.serverId === serverId;
  const chats = current.chats.map((chat) => (owned(chat) ? patchRow(chat, frame) : chat));
  const dms = current.dms.map((chat) => (owned(chat) ? patchRow(chat, frame) : chat));
  const detail =
    current.detail && current.detail.id === frame.chatId && current.detail.serverId === serverId
      ? mergeDetail(current.detail, frame)
      : current.detail;
  return { chats, dms, detail };
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
      const at = next.findIndex((existing) => existing.id === entry.id);
      if (at >= 0) next[at] = entry;
      else next.push(entry);
    }
    entries = next;
  }
  return {
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
  };
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
    permissionMode: raw.permissionMode,
    preview: raw.preview,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt ?? 0,
    workingSince: raw.workingSince ?? undefined,
    action: raw.action ?? undefined,
    context: raw.context ?? undefined,
    error: raw.error ?? undefined,
    ...(raw.pinned ? { pinned: true } : {}),
    ...(raw.parentChatId ? { parentChatId: raw.parentChatId } : {}),
    ...(raw.turns === undefined ? {} : { turns: raw.turns }),
    ...(raw.costUsd === undefined ? {} : { costUsd: raw.costUsd }),
    ...(raw.live === undefined ? {} : { live: raw.live }),
    ...(raw.dm ? { dm: true } : {}),
    ...(raw.unread ? { unread: true } : {}),
    ...(raw.agentId ? { agentId: raw.agentId } : {}),
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
      ? [{ name: tree.branch, current: tree.isMain, checkout: tree.isMain ? ("main" as const) : ("worktree" as const) }]
      : [],
  );
}

function homeServer(servers: Server[]): Server | undefined {
  return servers.find((server) => server.home) ?? servers.find((server) => server.online) ?? servers[0];
}

function nameFromPath(path: string): string {
  const part = path
    .replace(/\/+$/, "")
    .split("/")
    .filter((segment) => segment && segment !== "~")
    .pop();
  return part ?? "";
}

/// Pinned first, then newest thread first. The same order the window uses.
function byNewest(a: Chat, b: Chat): number {
  return Number(b.pinned ?? false) - Number(a.pinned ?? false)
    || (b.createdAt ?? b.updatedAt) - (a.createdAt ?? a.updatedAt);
}

type RawAgent = Omit<Agent, "serverId">;
type RawProject = Omit<Project, "serverId" | "workspaceIds"> & { workspaceIds?: string[] };
type RawTicket = Omit<Ticket, "serverId" | "threads"> & { threads?: Ticket["threads"] };
type RawRoutine = Omit<Routine, "serverId">;

/// One Mac's answer to `/board`. Held per device so a frame from one of them
/// re-reads that Mac alone.
interface BoardSlice {
  devices: { deviceId: string; serverId: string }[];
  agents: Agent[];
  projects: Project[];
  tickets: Ticket[];
  routines: Routine[];
  hasRoutines: boolean;
}

const slices = new Map<string, BoardSlice>();

/// One row in place, or appended when it is new. The board slice it came from
/// answers with it too on the next read; this is so the screen you are on does
/// not wait for that.
function replace<T extends { id: string }>(rows: T[], row: T): T[] {
  return rows.some((entry) => entry.id === row.id)
    ? rows.map((entry) => (entry.id === row.id ? row : entry))
    : [...rows, row];
}

function onlyPaired<T>(rows: Record<string, T>, paired: Set<string>): Record<string, T> {
  const kept = Object.entries(rows).filter(([id]) => paired.has(id));
  return kept.length === Object.keys(rows).length ? rows : Object.fromEntries(kept);
}

function withCapability(list: Capability[] | undefined, capability: Capability): Capability[] {
  return list?.includes(capability) ? list : [...(list ?? []), capability];
}

function without(list: Capability[] | undefined, capability: Capability): Capability[] {
  return (list ?? []).filter((entry) => entry !== capability);
}

/// How long until the next recovery read. Every reachable Mac pushing means the
/// poll is only there in case one of them stops.
function pollDelay(servers: Server[], connected: boolean): number {
  if (!connected) return POLL_DISCONNECTED_MS;
  const reachable = servers.filter((server) => server.online && !server.cloud);
  const allPushing = reachable.length > 0 && reachable.every((server) => pushing.has(server.id));
  return allPushing ? POLL_PUSHING_MS : POLL_CONNECTED_MS;
}

/// One Mac's threads, inbox conversations and workspaces.
async function readServer(
  server: Server,
  get: () => State,
): Promise<{
  server: Server;
  chats: Chat[];
  dms: Chat[];
  workspaces: Workspace[];
  unavailable?: string;
  failure?: string;
}> {
  const held = () => get().workspaces.filter((workspace) => workspace.serverId === server.id);
  try {
    let chats: { chats?: RawChat[]; dms?: RawChat[]; unavailable?: string };
    try {
      chats = await transport.request<typeof chats>(server.id, "/chats");
    } catch (error) {
      // A Mac too old to store threads answers 404 rather than an empty list.
      if (!isMissingRoute(error)) throw error;
      chats = { chats: [] };
    }
    let workspaces: Workspace[] = [];
    try {
      const listed = await transport.request<{ workspaces?: RawWorkspace[] }>(server.id, "/workspaces");
      workspaces = (listed.workspaces ?? []).map((raw) => toWorkspace(raw, server.id));
    } catch {
      workspaces = held();
    }
    return {
      server: { ...server, online: server.cloud ? server.online : true },
      chats: (chats.chats ?? []).map((raw) => toChat(raw, server.id)),
      dms: (chats.dms ?? []).map((raw) => toChat(raw, server.id)),
      workspaces,
      ...(chats.unavailable ? { unavailable: chats.unavailable } : {}),
    };
  } catch (error) {
    return {
      server: { ...server, online: false },
      chats: [],
      dms: [],
      workspaces: held(),
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

/// The catalogue for one Mac: what it answered with, or the one this app ships
/// with while it has not answered yet.
export function useProviders(serverId?: string): Provider[] {
  return useStore((s) => (serverId ? s.providers[serverId] : undefined) ?? PROVIDERS);
}

/// True when that Mac has said it cannot do this.
export function useLacks(serverId: string | undefined, capability: Capability): boolean {
  return useStore((s) => Boolean(serverId && s.missing[serverId]?.includes(capability)));
}

/// Whether a thread on that Mac can be given a reasoning effort. A Mac that
/// answered with neither a catalogue nor a default effort predates the choice,
/// and sending one would be silently dropped.
export function useSupportsEffort(serverId?: string): boolean {
  return useStore((s) => {
    if (!serverId) return false;
    if (s.missing[serverId]?.includes("providers")) return false;
    return Boolean(s.providers[serverId]) || s.settings[serverId]?.defaultEffort !== undefined;
  });
}

/// One Mac's settings, or nothing when it has not answered.
export function useServerSettings(serverId?: string): ServerSettings | undefined {
  return useStore((s) => (serverId ? s.settings[serverId] : undefined));
}

const NO_ORDER: string[] = [];

/// The order a device-agnostic piece of work tries paired Macs in, as the Mac
/// this phone is paired with directly has it.
function deviceOrderOf(state: State): string[] {
  const home = state.servers.find((server) => server.home && server.online)
    ?? state.servers.find((server) => server.home);
  return (home ? state.settings[home.id]?.devicePreferenceOrder : undefined) ?? NO_ORDER;
}

/// The order to try devices in for work that could run on any of them. It comes
/// from the Mac this phone is paired with directly: the phone is a view onto
/// that machine, so it is that machine's preference the phone follows.
export function useDevicePreferenceOrder(): string[] {
  return useStore(deviceOrderOf);
}
