import { create } from "zustand";
import { codeFor, type DeviceIconId } from "../lib/devices";
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
  Server,
  ServerSettings,
  Ticket,
  TicketActivity,
  TicketStatus,
  Workspace,
} from "./types";

interface RawChat {
  id: string;
  title: string;
  cwd: string;
  state?: ChatState;
  provider?: string;
  model?: string;
  preview?: string;
  updatedAt?: number;
  workingSince?: number | null;
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
  settings?: ServerSettings;
  agents: Agent[];
  projects: Project[];
  tickets: Ticket[];
  boardDevices: { deviceId: string; serverId: string }[];
  boardLoading: boolean;
  loading: boolean;
  error?: string;
  connected: boolean;
  pairRequests: PairRequest[];

  start(): () => void;
  refresh(): Promise<void>;
  loadSettings(): Promise<void>;
  loadBoard(): Promise<void>;
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
    model?: string;
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
  setChatOptions(patch: { model?: string | null; permissionMode?: string }): Promise<void>;
  archiveThread(id: string): Promise<void>;
  deleteThread(id: string): Promise<void>;
  createTicket(input: { projectId: string; title: string; body?: string; parentId?: string }): Promise<Ticket>;
  updateTicket(id: string, patch: Record<string, unknown>): Promise<void>;
  moveTicket(id: string, status: TicketStatus): Promise<void>;
  commentOnTicket(id: string, body: string): Promise<void>;
  ticketActivity(id: string): Promise<TicketActivity[]>;
  answerPair(id: string, decision: "approve" | "deny"): Promise<void>;
}

const POLL_CONNECTED_MS = 15_000;
const POLL_DISCONNECTED_MS = 4_000;

export const useStore = create<State>((set, get) => ({
  servers: [],
  chats: [],
  dms: [],
  workspaces: [],
  agents: [],
  projects: [],
  tickets: [],
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

    const offPush = transport.subscribe((_serverId, payload) => {
      const frame = payload as ChatFrame;
      if (frame.type === "chats") {
        void get().refresh();
        return;
      }
      if (frame.type === "board") {
        void get().loadBoard();
        return;
      }
      if (frame.type === "peers") {
        void get().refresh();
        return;
      }
      if (frame.type === "pair-requests") {
        void get().loadPairRequests();
        return;
      }
      if (frame.type === "chat" && frame.chatId) set((current) => applyChatFrame(current, frame));
    });

    const offStatus = transport.onStatus((serverId, pushUp) => {
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
    if (get().servers.length === 0) set({ loading: true });
    const servers = await transport.servers();
    if (servers.length === 0) {
      set({ servers: [], chats: [], dms: [], workspaces: [], loading: false, error: undefined, connected: false });
      return;
    }

    const failures: string[] = [];
    const results = await Promise.all(
      servers.map(async (server) => {
        try {
          let chats: { chats?: RawChat[]; dms?: RawChat[] };
          try {
            chats = await transport.request<{ chats?: RawChat[]; dms?: RawChat[] }>(server.id, "/chats");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!/\b404\b/.test(message)) throw error;
            chats = { chats: [] };
          }
          let workspaces: Workspace[] = [];
          try {
            const listed = await transport.request<{ workspaces?: RawWorkspace[] }>(server.id, "/workspaces");
            workspaces = (listed.workspaces ?? []).map((raw) => toWorkspace(raw, server.id));
          } catch {
            workspaces = get().workspaces.filter((workspace) => workspace.serverId === server.id);
          }
          return {
            server: { ...server, online: server.cloud ? server.online : true },
            chats: (chats.chats ?? []).map((raw) => toChat(raw, server.id)),
            dms: (chats.dms ?? []).map((raw) => toChat(raw, server.id)),
            workspaces,
          };
        } catch (error) {
          failures.push(`${server.name}: ${error instanceof Error ? error.message : String(error)}`);
          return {
            server: { ...server, online: false },
            chats: [] as Chat[],
            dms: [] as Chat[],
            workspaces: get().workspaces.filter((workspace) => workspace.serverId === server.id),
          };
        }
      }),
    );

    set({
      servers: results.map((r) => r.server),
      chats: results.flatMap((r) => r.chats).sort(byAttention),
      dms: results.flatMap((r) => r.dms),
      workspaces: results.flatMap((r) => r.workspaces),
      loading: false,
      error: failures.length === servers.length ? failures.join("; ") : undefined,
      connected: results.some((r) => r.server.online),
    });
  },

  async loadSettings() {
    const server = homeServer(get().servers);
    if (!server) return;
    set({ settings: await transport.request<ServerSettings>(server.id, "/server/settings") });
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

  async loadBoard() {
    const servers = get().servers.length ? get().servers : await transport.servers();
    if (servers.length === 0) {
      set({ agents: [], projects: [], tickets: [], boardDevices: [], boardLoading: false });
      return;
    }
    if (get().tickets.length === 0) set({ boardLoading: true });
    const results = await Promise.all(
      servers.map(async (server) => {
        try {
          const board = await transport.request<{
            deviceId?: string;
            agents?: RawAgent[];
            projects?: RawProject[];
            tickets?: RawTicket[];
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
          };
        } catch {
          return { devices: [], agents: [] as Agent[], projects: [] as Project[], tickets: [] as Ticket[] };
        }
      }),
    );
    const dedupe = <T extends { id: string }>(rows: T[]): T[] => [...new Map(rows.map((row) => [row.id, row])).values()];
    set({
      agents: dedupe(results.flatMap((r) => r.agents)),
      projects: dedupe(results.flatMap((r) => r.projects)),
      tickets: dedupe(results.flatMap((r) => r.tickets)).sort((a, b) => a.rank.localeCompare(b.rank)),
      boardDevices: results.flatMap((r) => r.devices),
      boardLoading: false,
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
    await get().loadBoard();
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
    await get().refresh();
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
    await get().refresh();
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
        ...(input.model ? { model: input.model } : {}),
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
      await get().refresh();
      const failed = error instanceof Error ? error : new Error(String(error));
      (failed as Error & { chatId?: string }).chatId = id;
      throw failed;
    }
    await get().refresh();
    return { id, serverId: server.id };
  },

  async openChat(id) {
    // Both lists: an inbox conversation opens the same way a thread does.
    const chat = get().chats.find((entry) => entry.id === id)
      ?? get().dms.find((entry) => entry.id === id);
    if (!chat) return;
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
    set({ openId: undefined, detail: undefined, detailLoading: false });
  },

  async openDm(agent) {
    const existing = get().dms.find((chat) => chat.agentId === agent.id && chat.serverId === agent.serverId);
    if (existing) return existing;
    const body = await transport.request<{ chat: RawChat }>(
      agent.serverId,
      `/agents/${encodeURIComponent(agent.id)}/dm`,
      { method: "POST" },
    );
    const chat = toChat(body.chat, agent.serverId);
    set((current) => ({ dms: [chat, ...current.dms.filter((entry) => entry.id !== chat.id)] }));
    return chat;
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
    set((current) => ({
      detail:
        current.detail?.id === detail.id
          ? { ...current.detail, model: chat.model, permissionMode: chat.permissionMode }
          : current.detail,
      chats: current.chats.map((entry) => (entry.id === detail.id ? { ...entry, model: chat.model } : entry)),
    }));
  },

  async archiveThread(id) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) return;
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}/archive`, { method: "POST", body: {} });
    await get().refresh();
  },

  async deleteThread(id) {
    const chat = get().chats.find((entry) => entry.id === id);
    if (!chat) return;
    await transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
    await get().refresh();
    await get().loadBoard().catch(() => {});
  },

  async updateTicket(id, patch) {
    const ticket = get().tickets.find((entry) => entry.id === id);
    if (!ticket) return;
    await transport.request(ticket.serverId, `/tickets/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
    await get().loadBoard();
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
      await get().loadBoard();
    }
  },

  async commentOnTicket(id, body) {
    const ticket = get().tickets.find((entry) => entry.id === id);
    if (!ticket) return;
    await transport.request(ticket.serverId, `/tickets/${encodeURIComponent(id)}/comment`, {
      method: "POST",
      body: { body },
    });
    await get().loadBoard();
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
    model: raw.model,
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
    ...(frame.unread === undefined ? {} : { unread: frame.unread }),
  };
}

function applyChatFrame(current: State, frame: ChatFrame): Partial<State> {
  // A frame does not say which list its conversation is in, so both are asked.
  const chats = current.chats.map((chat) => patchRow(chat, frame));
  const dms = current.dms.map((chat) => patchRow(chat, frame));
  const detail =
    current.detail && current.detail.id === frame.chatId ? mergeDetail(current.detail, frame) : current.detail;
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
    preview: raw.preview,
    updatedAt: raw.updatedAt ?? 0,
    workingSince: raw.workingSince ?? undefined,
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

const RANK: Record<ChatState, number> = { needs_input: 0, working: 1, error: 2, idle: 3 };
function byAttention(a: Chat, b: Chat): number {
  return RANK[a.state] - RANK[b.state] || b.updatedAt - a.updatedAt;
}

type RawAgent = Omit<Agent, "serverId">;
type RawProject = Omit<Project, "serverId" | "workspaceIds"> & { workspaceIds?: string[] };
type RawTicket = Omit<Ticket, "serverId" | "threads"> & { threads?: Ticket["threads"] };
