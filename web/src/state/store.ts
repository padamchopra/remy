import { create } from "zustand";
import { codeFor, type DeviceIconId } from "~/lib/devices";
import { agentConversation, availableAgentServers } from "~/lib/inbox";
import type { TintId } from "~/lib/tints";
import type { Provider } from "~/lib/providers";
import { byRank } from "~/lib/tickets";
import { transport } from "~/lib/transport";
import { fixtureChats, fixtureServers, fixtureWorkspaces } from "./fixture";
import type {
  Agent,
  ArchivedThread,
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
  ProviderMcpStatus,
  Recurrence,
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
  updatedAt?: number;
  workingSince?: number | null;
  dm?: boolean;
  unread?: boolean;
  pinned?: boolean;
}

interface RawArchive {
  id: string;
  session: string;
  archivedAt: number;
  cwd?: string | null;
  agent?: string;
  conversation?: {
    title?: string;
    model?: string;
    entries?: ConvEntry[];
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

interface State {
  servers: Server[];
  chats: Chat[];
  archived: ArchivedThread[];
  /// The inbox: one conversation per agent, across every paired machine. Held
  /// apart from `chats` because they are two lists a person reads differently.
  dms: Chat[];
  workspaces: Workspace[];
  /// The chat the main pane has open. Held here rather than in the component so
  /// a push can patch it without the view refetching.
  openId?: string;
  detail?: ChatDetail;
  detailLoading: boolean;
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
  /// The tickets that come back. Read with the board, since they are part of it.
  recurring: Recurrence[];
  /// Which daemon each board device id belongs to. A ticket names the machine
  /// it runs on by that id rather than by a server row, because a server row is
  /// this client's pairing and means nothing to another client.
  boardDevices: { deviceId: string; serverId: string }[];
  boardLoading: boolean;
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
  addWorkspace(input: { path: string; name?: string }): Promise<void>;
  updateWorkspace(
    id: string,
    patch: { name?: string; icon?: string | null; tint?: string | null; provider?: string | null; model?: string | null; effort?: string | null },
  ): Promise<void>;
  removeWorkspace(id: string): Promise<void>;
  suggestPaths(query: string): Promise<PathSuggestion[]>;
  suggestWorkspaceIcons(id: string, query: string): Promise<WorkspaceIconMatch[]>;
  workspaceFile(id: string, path: string): Promise<{ mime: string; data: string } | undefined>;
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
  closeChat(): void;
  sendMessage(text: string): Promise<void>;
  answerApproval(requestId: string, decision: "allow" | "allowAlways" | "deny"): Promise<void>;
  answerQuestion(requestId: string, answers: Record<string, unknown>): Promise<void>;
  interrupt(): Promise<void>;
  setChatOptions(patch: { model?: string | null; effort?: string | null; permissionMode?: string }): Promise<void>;
  pinThread(id: string, pinned: boolean): Promise<void>;
  archiveThread(id: string): Promise<void>;
  restoreThread(id: string, serverId: string): Promise<Chat>;
  deleteArchivedThread(id: string, serverId: string): Promise<void>;
  deleteThread(id: string): Promise<void>;

  /// The board. Read on demand by the pane that shows it rather than on every
  /// poll — a board nobody is looking at costs nothing.
  loadBoard(): Promise<void>;
  /// Machines asking to pair with this one, waiting on you.
  pairRequests: PairRequest[];
  loadPairRequests(): Promise<void>;
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
  /// Writes a recurring ticket, or edits one. `projectId` says which machine
  /// holds it, the way a ticket's project does.
  saveRecurrence(
    id: string | undefined,
    patch: Record<string, unknown> & { projectId?: string },
  ): Promise<Recurrence>;
  deleteRecurrence(id: string): Promise<void>;
  /// Writes this recurrence's ticket now, without waiting for its hour.
  runRecurrence(id: string): Promise<Ticket>;
  saveAgent(id: string | undefined, patch: Record<string, unknown>): Promise<Agent>;
  deleteAgent(id: string): Promise<void>;
  /// Opens an agent's conversation, making it if this is the first time. The
  /// first available device that can run it holds the conversation.
  openDm(agent: Agent): Promise<Chat>;
  /// Clears an inbox conversation's unread mark.
  readChat(id: string): Promise<void>;
  /// Renames a project, or the slug its tickets are keyed by. Changing the slug
  /// re-keys every ticket it has, so the whole board is read back after.
  saveProject(id: string, patch: { name?: string; keyPrefix?: string }): Promise<Project>;
}

/// How often to poll. Long while pushes are arriving, short while they aren't.
const POLL_CONNECTED_MS = 15_000;
const POLL_DISCONNECTED_MS = 4_000;

export const useStore = create<State>((set, get) => ({
  servers: useFixture ? fixtureServers : [],
  chats: useFixture ? fixtureChats : [],
  archived: [],
  dms: [],
  workspaces: useFixture ? fixtureWorkspaces : [],
  agents: [],
  projects: [],
  tickets: [],
  recurring: [],
  pairRequests: [],
  boardDevices: [],
  boardLoading: false,
  detailLoading: false,
  loading: !useFixture,
  connected: useFixture,

  start() {
    if (useFixture) return () => {};

    // Servers first, then anything keyed to them. A machine that asked to pair
    // while this window was closed is standing there waiting for an answer, so
    // its prompt cannot wait for the first poll fifteen seconds from now.
    void get()
      .refresh()
      .then(() => get().loadPairRequests())
      .catch(() => {});

    const offPush = transport.subscribe((_serverId, payload) => {
      const frame = payload as ChatFrame;
      if (frame.type === "chats") {
        void get().refresh();
        return;
      }
      // A board frame says a ticket, agent or project changed — on this machine
      // or on one of the machines paired with it.
      if (frame.type === "board") {
        void get().loadBoard();
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
        void get().loadPairRequests();
        return;
      }
      // A turn streams as `chat` frames: the entries that changed, plus the
      // whole scalar state. Patch what is on screen rather than refetching.
      if (frame.type === "chat" && frame.chatId) set((current) => applyChatFrame(current, frame));
    });

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

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      offPush();
      offStatus();
    };
  },

  async refresh() {
    if (useFixture) return;
    if (get().servers.length === 0) set({ loading: true });

    const servers = await transport.servers();
    if (servers.length === 0) {
      set({ servers: [], chats: [], archived: [], dms: [], workspaces: [], loading: false, error: undefined });
      return;
    }

    // The device list itself is known now, so it lands before anything is
    // asked of any of them. A machine that has gone away takes its threads and
    // its workspaces with it rather than leaving them behind.
    const known = new Set(servers.map((server) => server.id));
    set((current) => ({
      servers,
      chats: current.chats.filter((chat) => known.has(chat.serverId)),
      archived: current.archived.filter((chat) => known.has(chat.serverId)),
      dms: current.dms.filter((chat) => known.has(chat.serverId)),
      workspaces: current.workspaces.filter((workspace) => known.has(workspace.serverId)),
    }));

    // Every machine is asked in parallel and each one paints as it answers,
    // rather than the round landing all at once at the end. The threads on this
    // machine come back in a millisecond; waiting for a device that is asleep
    // to give up first is what kept them off the screen for seconds.
    const failures = new Map<string, string>();
    await Promise.all(
      servers.map(async (server) => {
        try {
          const [chats, archives, workspaces] = await Promise.all([
            transport.request<{ chats?: RawChat[]; dms?: RawChat[] }>(server.id, "/chats").catch((error: unknown) => {
              // An older server has no /chats; that is not an error worth showing.
              const message = error instanceof Error ? error.message : String(error);
              if (!/\b404\b/.test(message)) throw error;
              return { chats: [] } as { chats?: RawChat[]; dms?: RawChat[] };
            }),
            transport
              .request<{ archives?: RawArchive[] }>(server.id, "/archives")
              .then((listed) => listed.archives ?? [])
              .catch(() => []),
            transport
              .request<{ workspaces?: RawWorkspace[] }>(server.id, "/workspaces")
              .then((listed) => listed.workspaces ?? [])
              .catch(() => []),
          ]);
          set((current) => ({
            // One machine answering is enough to stop saying "Connecting…":
            // there is something to show, and there is somewhere to type.
            loading: false,
            servers: current.servers.map((entry) =>
              entry.id === server.id ? { ...entry, online: entry.cloud ? entry.online : true } : entry),
            chats: [
              ...current.chats.filter((chat) => chat.serverId !== server.id),
              ...(chats.chats ?? []).map((raw) => toChat(raw, server.id)),
            ].sort(byAttention),
            archived: [
              ...current.archived.filter((chat) => chat.serverId !== server.id),
              ...archives.map((raw) => toArchivedThread(raw, server.id)),
            ].sort((a, b) => b.archivedAt - a.archivedAt),
            // The inbox comes back in the same answer, so it lands with the
            // threads rather than costing a second round trip.
            dms: [
              ...current.dms.filter((chat) => chat.serverId !== server.id),
              ...(chats.dms ?? []).map((raw) => toChat(raw, server.id)),
            ],
            workspaces: [
              ...current.workspaces.filter((workspace) => workspace.serverId !== server.id),
              ...workspaces.map((raw) => toWorkspace(raw, server.id)),
            ],
          }));
        } catch (error) {
          failures.set(server.id, `${server.name}: ${error instanceof Error ? error.message : String(error)}`);
          set((current) => ({
            servers: current.servers.map((entry) =>
              entry.id === server.id ? { ...entry, online: false } : entry),
            chats: current.chats.filter((chat) => chat.serverId !== server.id),
            archived: current.archived.filter((chat) => chat.serverId !== server.id),
            dms: current.dms.filter((chat) => chat.serverId !== server.id),
            workspaces: current.workspaces.filter((workspace) => workspace.serverId !== server.id),
          }));
        }
      }),
    );

    set((current) => ({
      loading: false,
      error: failures.size === servers.length ? [...failures.values()].join("; ") : undefined,
      connected: current.servers.some((server) => server.online),
    }));
  },

  async addServer(input) {
    await transport.addServer(input);
    await get().refresh();
  },

  async removeServer(id) {
    await transport.removeServer(id);
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
      const serverId = get().servers.find((server) => server.local)?.id ?? get().servers[0]?.id ?? "studio";
      set((current) => ({
        workspaces: [
          ...current.workspaces.filter((workspace) => !(workspace.serverId === serverId && workspace.path === path)),
          { id: crypto.randomUUID(), serverId, name, path, origin: null, worktrees: [] },
        ],
      }));
      return;
    }

    const server = localServer(get().servers);
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

  async suggestPaths(query) {
    if (useFixture) return [];
    const server = localServer(get().servers);
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
      const serverId = input.serverId ?? get().servers.find((server) => server.local)?.id ?? get().servers[0]?.id ?? "studio";
      const chat: Chat = {
        id: crypto.randomUUID(),
        serverId,
        title,
        cwd,
        state: "working",
        preview: text,
        updatedAt: Date.now(),
      };
      set((current) => ({ chats: [chat, ...current.chats].sort(byAttention) }));
      return { id: chat.id, serverId };
    }

    const server = get().servers.find((entry) => entry.id === input.serverId) ?? localServer(get().servers);
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

  async loadSettings() {
    const server = localServer(get().servers);
    if (!server) return;
    const settings = await transport.request<ServerSettings>(server.id, "/server/settings");
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
    const body = await transport.request<{ providers?: Provider[] }>(server.id, "/server/providers");
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
    set({ settings });
    await get().loadProviders();
    await get().refresh();
    await get().loadBoard();
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
    // Both lists: an inbox conversation opens the same way a thread does.
    const chat = get().chats.find((entry) => entry.id === id)
      ?? get().dms.find((entry) => entry.id === id);
    if (!chat) return;
    // Keep whatever is already on screen for this chat, so reopening it does
    // not blank the feed while the fetch is in flight.
    const same = get().detail?.id === id;
    set({ openId: id, detailLoading: !same, ...(same ? {} : { detail: undefined }) });

    if (useFixture) {
      set({ detail: { ...chat, entries: [], todos: [] }, detailLoading: false });
      return;
    }

    try {
      const raw = await transport.request<RawChatDetail>(
        chat.serverId,
        `/chats/${encodeURIComponent(id)}`,
      );
      // A slow fetch for a chat that has since been closed must not paint over
      // the one that is open now.
      if (get().openId !== id) return;
      set({ detail: toDetail(raw, chat.serverId), detailLoading: false });
    } catch (error) {
      if (get().openId !== id) return;
      set({ detailLoading: false });
      throw error;
    }
  },

  closeChat() {
    set({ openId: undefined, detail: undefined, detailLoading: false });
  },

  async sendMessage(text) {
    const detail = get().detail;
    const trimmed = text.trim();
    if (!detail || !trimmed) return;
    await transport.request(detail.serverId, `/chats/${encodeURIComponent(detail.id)}/message`, {
      method: "POST",
      body: { text: trimmed },
    });
    // The server echoes the message back as a `chat` frame. With the socket
    // down there is no frame coming, so read the feed once instead.
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

  async archiveThread(id) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) return;
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}/archive`, {
      method: "POST",
      body: {},
    });
    await get().refresh();
  },

  async pinThread(id, pinned) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) return;
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { pinned },
    });
    await get().refresh();
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

  async deleteArchivedThread(id, serverId) {
    await transport.request(serverId, `/archives/${encodeURIComponent(id)}`, { method: "DELETE" });
    await get().refresh();
  },

  async deleteThread(id) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) return;
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
    await get().refresh();
    // The thread let go of any ticket it was on, so the board is stale.
    await get().loadBoard().catch(() => {});
  },

  // ── the board ─────────────────────────────────────────────────────────────
  // Every machine answers with its own whole board. Once daemons replicate to
  // each other those answers are the same board, and merging by id here is what
  // keeps that from showing up twice.

  /// Only ever asked of the daemon on this machine: a request to pair with
  /// another machine is that machine's business to answer, not ours.
  async loadPairRequests() {
    if (useFixture) return;
    const home = get().servers.find((server) => server.local) ?? get().servers[0];
    if (!home) return;
    try {
      const answer = await transport.request<{ requests?: PairRequest[] }>(home.id, "/pair/pending");
      set({ pairRequests: answer.requests ?? [] });
    } catch {
      // A daemon from before pairing landed has none, which is the same as none.
      set({ pairRequests: [] });
    }
  },

  async loadBoard() {
    if (useFixture) return;
    const servers = await transport.servers();
    // The board is read from the machines this window holds a daemon of, and a
    // paired one is not among them: daemons converge the board log between
    // themselves, so a peer's tickets, agents and recurring tickets are already
    // in the answer here. Asking that machine for them again waits on a device
    // that may be asleep for something this one already knows — and its answer
    // carries `workspaceIds` for folders on *its* disk, which are not ours.
    //
    // Threads and workspaces are the opposite: those live on one machine and
    // replicate nowhere, so `refresh` does go and ask each one.
    const asked = servers.filter((server) => !server.peer && !server.cloud);
    if (asked.length === 0) {
      set({ agents: [], projects: [], tickets: [], recurring: [], boardDevices: [], boardLoading: false });
      return;
    }
    if (get().tickets.length === 0) set({ boardLoading: true });
    const results = await Promise.all(
      asked.map(async (server) => {
        try {
          const board = await transport.request<{
            deviceId?: string;
            agents?: RawAgent[];
            projects?: RawProject[];
            tickets?: RawTicket[];
            recurring?: RawRecurrence[];
          }>(server.id, "/board");
          return {
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
            recurring: (board.recurring ?? []).map((raw) => ({ ...raw, serverId: server.id }) as Recurrence),
          };
        } catch {
          // An older server has no board, which is not worth an error banner.
          return { devices: [], agents: [], projects: [], tickets: [], recurring: [] };
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
    set({
      agents: dedupe(results.flatMap((r) => r.agents)),
      projects: dedupe(results.flatMap((r) => r.projects)),
      tickets: dedupe(results.flatMap((r) => r.tickets)).sort(byRank),
      recurring: dedupe(results.flatMap((r) => r.recurring)).sort((a, b) => a.nextRunAt - b.nextRunAt),
      boardDevices: [...results.flatMap((r) => r.devices), ...paired],
      boardLoading: false,
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
    void get().loadBoard().catch(() => {});
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
    await Promise.all([get().refresh(), get().loadBoard()]);
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
    void get().loadBoard().catch(() => {});
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
      void get().loadBoard().catch(() => {});
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
    void get().loadBoard().catch(() => {});
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
    void get().loadBoard().catch(() => {});
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
    void get().loadBoard().catch(() => {});
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
    void get().loadBoard().catch(() => {});
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
    void get().loadBoard().catch(() => {});
    return ticket;
  },

  async saveRecurrence(id, patch) {
    const existing = id ? get().recurring.find((entry) => entry.id === id) : undefined;
    const server = existing?.serverId ?? boardServer(get().servers, get().projects, String(patch.projectId ?? ""));
    const body = await transport.request<{ recurrence: RawRecurrence }>(
      server,
      id ? `/recurring/${encodeURIComponent(id)}` : "/recurring",
      { method: id ? "PATCH" : "POST", body: patch },
    );
    const recurrence = { ...body.recurrence, serverId: server } as Recurrence;
    set((current) => ({ recurring: withRecurrence(current.recurring, recurrence) }));
    void get().loadBoard().catch(() => {});
    return recurrence;
  },

  async deleteRecurrence(id) {
    const recurrence = get().recurring.find((entry) => entry.id === id);
    if (!recurrence) return;
    await transport.request(recurrence.serverId, `/recurring/${encodeURIComponent(id)}`, { method: "DELETE" });
    set((current) => ({ recurring: current.recurring.filter((entry) => entry.id !== id) }));
    void get().loadBoard().catch(() => {});
  },

  async runRecurrence(id) {
    const recurrence = get().recurring.find((entry) => entry.id === id);
    if (!recurrence) throw new Error("That recurring ticket is gone.");
    const body = await transport.request<{ ticket: RawTicket }>(
      recurrence.serverId,
      `/recurring/${encodeURIComponent(id)}/run`,
      { method: "POST", body: {} },
    );
    const ticket = toTicket(body.ticket, recurrence.serverId);
    set((current) => ({ tickets: withTicket(current.tickets, ticket) }));
    void get().loadBoard().catch(() => {});
    return ticket;
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
    void get().loadBoard().catch(() => {});
    return agent;
  },

  async deleteAgent(id) {
    const agent = get().agents.find((entry) => entry.id === id);
    if (!agent) return;
    await transport.request(agent.serverId, `/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
    set((current) => ({ agents: current.agents.filter((entry) => entry.id !== id) }));
    void get().loadBoard().catch(() => {});
  },

  async openDm(agent) {
    const servers = availableAgentServers(get().servers);
    const available = new Set(servers.map((server) => server.id));
    const existing = agentConversation(agent.id, get().dms, get().servers);
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
    await get().loadBoard();
    return { ...body.project, serverId: project.serverId, workspaceIds: project.workspaceIds } as Project;
  },

  async setChatOptions(patch) {
    const detail = get().detail;
    if (!detail) return;
    // The server answers with the chat as it now stands, and retires the Claude
    // process so the next message starts under the new settings.
    const body = await transport.request<{ chat?: RawChatDetail }>(
      detail.serverId,
      `/chats/${encodeURIComponent(detail.id)}`,
      { method: "PATCH", body: patch },
    );
    const chat = body.chat;
    if (!chat) return;
    set((current) => ({
      detail:
        current.detail?.id === detail.id
          ? {
              ...current.detail,
              provider: chat.provider,
              model: chat.model,
              effort: chat.effort,
              permissionMode: chat.permissionMode,
            }
          : current.detail,
      chats: current.chats.map((entry) =>
        entry.id === detail.id ? { ...entry, provider: chat.provider, model: chat.model, effort: chat.effort } : entry,
      ),
    }));
  },

  async interrupt() {
    const detail = get().detail;
    if (!detail) return;
    await transport.request(detail.serverId, `/chats/${encodeURIComponent(detail.id)}/interrupt`, {
      method: "POST",
      body: {},
    });
  },
}));

/// A live frame for one chat. `entries` are the ones that changed; the scalar
/// fields are always sent whole, so `null` means cleared rather than unchanged.
interface ChatFrame {
  type?: string;
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
  permissionMode?: string;
  entries?: ConvEntry[];
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
    provider: raw.provider,
    agentId: raw.agentId,
    model: raw.model,
    effort: raw.effort,
    permissionMode: raw.permissionMode,
    state: raw.state ?? "idle",
    action: raw.action ?? undefined,
    entries: raw.entries ?? [],
    todos: raw.todos ?? [],
    approval: raw.approval ?? undefined,
    question: raw.question ?? undefined,
    live: raw.live,
    error: raw.error ?? undefined,
    context: raw.context ?? undefined,
    workingSince: raw.workingSince ?? undefined,
  };
}

function patchRow(chat: Chat, frame: ChatFrame): Chat {
  if (chat.id !== frame.chatId) return chat;
  return {
    ...chat,
    state: frame.state ?? chat.state,
    title: frame.title ?? chat.title,
    updatedAt: frame.updatedAt ?? chat.updatedAt,
    workingSince:
      frame.workingSince === undefined ? chat.workingSince : (frame.workingSince ?? undefined),
    ...(frame.unread === undefined ? {} : { unread: frame.unread }),
  };
}

function applyChatFrame(current: State, frame: ChatFrame): Partial<State> {
  // The row in the list is patched in place rather than re-sorted: a chat that
  // is streaming would otherwise walk up and down the sidebar on every frame.
  // A frame does not say which list its conversation is in, so both are asked.
  const chats = current.chats.map((chat) => patchRow(chat, frame));
  const dms = current.dms.map((chat) => patchRow(chat, frame));
  const detail =
    current.detail && current.detail.id === frame.chatId
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
      // A streaming entry keeps its place in the feed while its text grows.
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
    workingSince:
      frame.workingSince === undefined ? detail.workingSince : (frame.workingSince ?? undefined),
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
    agentId: raw.agentId,
    model: raw.model,
    effort: raw.effort,
    preview: raw.preview,
    updatedAt: raw.updatedAt ?? 0,
    workingSince: raw.workingSince ?? undefined,
    ...(raw.dm ? { dm: true } : {}),
    ...(raw.unread ? { unread: true } : {}),
    ...(raw.pinned ? { pinned: true } : {}),
  };
}

function toArchivedThread(raw: RawArchive, serverId: string): ArchivedThread {
  const entries = raw.conversation?.entries ?? [];
  const preview = [...entries]
    .reverse()
    .find((entry) => (entry.kind === "assistant" || entry.kind === "user") && entry.text?.trim())
    ?.text;
  return {
    id: raw.id,
    serverId,
    title: raw.conversation?.title?.trim() || raw.session,
    cwd: raw.cwd ?? "~",
    provider: raw.agent,
    model: raw.conversation?.model,
    preview,
    archivedAt: raw.archivedAt,
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
type RawRecurrence = Omit<Recurrence, "serverId">;

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

// The board and the recurring tab paint their lists in the order they are held
// in, so a row put back by hand is put back in that order — otherwise a card
// lands at the bottom of its column and jumps when the read behind it returns.
function withTicket(rows: Ticket[], row: Ticket): Ticket[] {
  return withRow(rows, row).sort(byRank);
}

function withRecurrence(rows: Recurrence[], row: Recurrence): Recurrence[] {
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

/// Needs-you first, then working, then most recently updated.
const RANK: Record<ChatState, number> = { needs_input: 0, working: 1, error: 2, idle: 3 };
function byAttention(a: Chat, b: Chat): number {
  return Number(b.pinned ?? false) - Number(a.pinned ?? false)
    || RANK[a.state] - RANK[b.state]
    || b.updatedAt - a.updatedAt;
}
