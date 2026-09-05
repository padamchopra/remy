import { applyProjectIdentity } from "~/lib/projects";
import type { Transport } from "~/lib/transport";
import { warmSnapshot, writeWarmCache } from "~/lib/warm-cache";
import { mergeEntryUpdates, uniqueEntries } from "~/lib/thread-entry-merge";
import type { State } from "~/state/store";
import type {
  ArchivedThread,
  Chat,
  ChatApproval,
  ChatDetail,
  ChatQuestionRequest,
  ChatState,
  ContextUsage,
  ConvEntry,
  ConvTodo,
  GitWorktree,
  Server,
  Workspace,
} from "~/state/types";

const CHAT_PAGE_TURNS = 12;
const DETAIL_CACHE_LIMIT = 12;
const POLL_CONNECTED_MS = 15_000;
const POLL_DISCONNECTED_MS = 4_000;
const WARM_WRITE_MS = 500;

type StatePatch = Partial<State> | ((state: State) => Partial<State>);

export interface ThreadRuntimeStore {
  getState(): State;
  setState(patch: StatePatch): void;
  subscribe(listener: () => void): () => void;
}

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

interface RawArchive {
  id: string;
  chatId?: string;
  session: string;
  archivedAt: number;
  cwd?: string | null;
  agent?: string;
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

interface ChatFrame {
  type?: string;
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

/// The proof runtime owns one complete thread path while the existing React
/// tree stays unchanged. Its maps are the source of truth; Zustand receives a
/// compatibility projection only so both paths render the same components.
export class ThreadRuntime {
  private readonly rows = new Map<string, Chat>();
  private readonly rowOrder: string[] = [];
  private readonly dms = new Map<string, Chat>();
  private readonly dmOrder: string[] = [];
  private readonly details = new Map<string, ChatDetail>();
  private readonly pendingDetails = new Map<string, Promise<ChatDetail>>();
  private readonly detailSubscriptions = new Map<string, () => void>();
  private readonly detailOwners = new Map<string, number>();
  private readonly pushPeerServers = new Set<string>();
  private pendingRefresh?: Promise<void>;
  private refreshRun = 0;
  private stopped = false;

  constructor(
    private readonly transport: Transport,
    private readonly store: ThreadRuntimeStore,
    initialDetails: ChatDetail[] = [],
  ) {
    const initial = store.getState();
    this.replaceAll(this.rows, this.rowOrder, initial.chats);
    this.replaceAll(this.dms, this.dmOrder, initial.dms);
    for (const detail of [...initialDetails, ...Object.values(initial.details)]) if (detail) this.cacheDetail(detail);
  }

  start(): () => void {
    this.stopped = false;
    void this.refresh().then(() => this.store.getState().loadPairRequests()).catch(() => {});

    const offPush = this.transport.subscribe((serverId, payload) => {
      this.applyFrame(serverId, payload as ChatFrame);
    }, ["sidebar", "board", "settings"]);
    const offStatus = this.transport.onStatus((serverId, online) => {
      this.store.setState((state) => ({
        connected: online || state.servers.some((server) => server.id !== serverId && server.online),
        servers: online ? setServerOnline(state.servers, serverId, true) : state.servers,
      }));
    });
    const stopWarmCache = this.keepWarmCache();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (this.stopped) return;
      await this.refresh().catch(() => {});
      await this.store.getState().loadPairRequests().catch(() => {});
      if (!this.stopped) {
        timer = setTimeout(
          () => void poll(),
          this.store.getState().connected ? POLL_CONNECTED_MS : POLL_DISCONNECTED_MS,
        );
      }
    };
    timer = setTimeout(() => void poll(), POLL_CONNECTED_MS);

    return () => {
      this.stopped = true;
      if (timer) clearTimeout(timer);
      stopWarmCache();
      for (const off of this.detailSubscriptions.values()) off();
      this.detailSubscriptions.clear();
      this.detailOwners.clear();
      offPush();
      offStatus();
    };
  }

  async refresh(): Promise<void> {
    if (this.pendingRefresh) return this.pendingRefresh;
    const pending = this.refreshOnce();
    this.pendingRefresh = pending;
    try {
      await pending;
    } finally {
      if (this.pendingRefresh === pending) this.pendingRefresh = undefined;
    }
  }

  async openChat(id: string): Promise<void> {
    const state = this.store.getState();
    const chat = this.rows.get(id)
      ?? this.dms.get(id)
      ?? state.chats.find((entry) => entry.id === id)
      ?? state.dms.find((entry) => entry.id === id);
    if (!chat) return;
    if (!this.rows.has(id) && !chat.dm) {
      this.rows.set(id, chat);
      this.rowOrder.unshift(id);
    }
    const cached = this.details.get(detailKey(id, chat.serverId));
    const same = state.details[id]?.serverId === chat.serverId;
    this.detailOwners.set(id, (this.detailOwners.get(id) ?? 0) + 1);
    if (!this.detailSubscriptions.has(id)) {
      this.detailSubscriptions.set(id, this.transport.subscribe(() => {}, [`thread:${id}`]));
    }
    this.store.setState((current) => ({
      openIds: current.openIds.includes(id) ? current.openIds : [...current.openIds, id],
      detailLoading: { ...current.detailLoading, [id]: !same && !cached },
      ...(same ? {} : { details: { ...current.details, [id]: cached } }),
    }));

    try {
      const detail = await this.readDetail(id, chat.serverId);
      if (!this.store.getState().openIds.includes(id)) return;
      this.publishDetail(mergeDetailRefresh(this.store.getState().details[id], detail));
    } catch (error) {
      if (this.store.getState().openIds.includes(id)) {
        this.store.setState((current) => ({
          detailLoading: { ...current.detailLoading, [id]: false },
        }));
      }
      throw error;
    }
  }

  async loadEarlierEntries(id: string): Promise<void> {
    const current = this.store.getState();
    const detail = current.details[id];
    const before = detail?.history?.before;
    if (!detail || !detail.history?.hasEarlier || !before || current.historyLoading[id]) return;
    this.store.setState((state) => ({ historyLoading: { ...state.historyLoading, [id]: true } }));
    try {
      const raw = await this.transport.request<RawChatDetail>(
        detail.serverId,
        `/chats/${encodeURIComponent(id)}?turns=${CHAT_PAGE_TURNS}&before=${encodeURIComponent(before)}`,
      );
      const page = toDetail(raw, detail.serverId);
      const latest = this.store.getState().details[id];
      if (!latest || latest.serverId !== detail.serverId) return;
      const known = new Set(latest.entries.map((entry) => entry.id));
      this.publishDetail({
        ...latest,
        entries: [...page.entries.filter((entry) => !known.has(entry.id)), ...latest.entries],
        history: page.history,
      });
    } finally {
      this.store.setState((state) => ({ historyLoading: { ...state.historyLoading, [id]: false } }));
    }
  }

  closeChat(id: string): void {
    const owners = Math.max(0, (this.detailOwners.get(id) ?? 0) - 1);
    if (owners > 0) {
      this.detailOwners.set(id, owners);
      return;
    }
    this.detailOwners.delete(id);
    this.detailSubscriptions.get(id)?.();
    this.detailSubscriptions.delete(id);
    this.store.setState((current) => {
      const details = { ...current.details };
      const detailLoading = { ...current.detailLoading };
      const historyLoading = { ...current.historyLoading };
      delete details[id];
      delete detailLoading[id];
      delete historyLoading[id];
      return {
        openIds: current.openIds.filter((openId) => openId !== id),
        details,
        detailLoading,
        historyLoading,
      };
    });
  }

  async interrupt(id: string): Promise<void> {
    const chat = this.rows.get(id) ?? this.store.getState().details[id];
    if (!chat) throw new Error("This thread is no longer available.");
    await this.transport.request(chat.serverId, `/chats/${encodeURIComponent(id)}/interrupt`, {
      method: "POST",
      body: {},
    });
    await this.refresh();
  }

  private async refreshOnce(): Promise<void> {
    const run = ++this.refreshRun;
    const state = this.store.getState();
    this.store.setState({ catalogLoading: true, ...(state.servers.length === 0 ? { loading: true } : {}) });

    let servers: Server[];
    try {
      servers = await this.transport.servers();
    } catch (error) {
      if (run === this.refreshRun) this.store.setState({ catalogLoading: false });
      throw error;
    }
    if (servers.length === 0) {
      this.rows.clear();
      this.rowOrder.length = 0;
      this.dms.clear();
      this.dmOrder.length = 0;
      this.store.setState({
        servers: [], chats: [], archived: [], dms: [], workspaces: [],
        loading: false, catalogLoading: false, error: undefined,
      });
      return;
    }

    const known = new Set(servers.map((server) => server.id));
    this.removeUnknown(this.rows, this.rowOrder, known);
    this.removeUnknown(this.dms, this.dmOrder, known);
    this.store.setState((current) => ({
      servers: mergeDiscoveredServers(current.servers, servers),
      chats: this.ordered(this.rows, this.rowOrder),
      dms: this.ordered(this.dms, this.dmOrder),
      archived: current.archived.filter((entry) => known.has(entry.serverId)),
      workspaces: current.workspaces.filter((entry) => known.has(entry.serverId)),
    }));

    const failures = new Map<string, string>();
    await Promise.all(servers.map(async (server) => {
      try {
        const [listed, archives, workspaces] = await Promise.all([
          this.transport.request<{ chats?: RawChat[]; dms?: RawChat[] }>(server.id, "/chats"),
          this.transport.request<{ archives?: RawArchive[] }>(server.id, "/archives")
            .then((answer) => answer.archives ?? []).catch(() => []),
          this.transport.request<{ workspaces?: RawWorkspace[] }>(server.id, "/workspaces")
            .then((answer) => answer.workspaces ?? []).catch(() => undefined),
        ]);
        this.replaceServer(this.rows, this.rowOrder, server.id, (listed.chats ?? []).map((raw) => toChat(raw, server.id)));
        this.replaceServer(this.dms, this.dmOrder, server.id, (listed.dms ?? []).map((raw) => toChat(raw, server.id)));
        this.store.setState((current) => {
          const nextWorkspaces = workspaces === undefined
            ? current.workspaces
            : [
                ...current.workspaces.filter((workspace) => workspace.serverId !== server.id),
                ...workspaces.map((raw) => toWorkspace(raw, server.id)),
              ];
          return {
            loading: false,
            servers: setServerOnline(current.servers, server.id, true),
            chats: this.ordered(this.rows, this.rowOrder).sort(byNewest),
            dms: this.ordered(this.dms, this.dmOrder),
            archived: [
              ...current.archived.filter((entry) => entry.serverId !== server.id),
              ...archives.map((raw) => toArchivedThread(raw, server.id)),
            ].sort((left, right) => right.archivedAt - left.archivedAt),
            workspaces: applyProjectIdentity(nextWorkspaces, current.projects),
          };
        });
      } catch (error) {
        failures.set(server.id, `${server.name}: ${error instanceof Error ? error.message : String(error)}`);
        this.store.setState((current) => ({ servers: setServerOnline(current.servers, server.id, false) }));
      }
    }));

    this.store.setState((current) => ({
      loading: false,
      catalogLoading: run === this.refreshRun ? false : current.catalogLoading,
      error: failures.size === servers.length ? [...failures.values()].join("; ") : undefined,
      connected: current.servers.some((server) => server.online),
    }));
  }

  private applyFrame(serverId: string, frame: ChatFrame): void {
    if (frame.type === "hello") {
      this.pushPeerServers.add(serverId);
      for (const peerId of frame.peerStreams ?? []) this.pushPeerServers.add(peerId);
      if (frame.reset) this.refreshTopics(serverId, frame.topics);
      return;
    }
    if (frame.type === "reset") {
      this.refreshTopics(serverId, frame.topics);
      return;
    }
    if (frame.type === "peer-disconnected") {
      this.pushPeerServers.delete(serverId);
      return;
    }
    if (frame.type === "peer-reset") {
      this.pushPeerServers.add(serverId);
      this.refreshTopics(serverId, frame.topics?.length
        ? frame.topics
        : this.store.getState().openIds.map((id) => `thread:${id}`));
      return;
    }
    if (frame.type === "chats" || frame.type === "peers") {
      void this.refresh();
      return;
    }
    if (frame.type === "board") {
      void this.store.getState().loadBoard({ fresh: true });
      return;
    }
    if (frame.type === "settings") {
      void this.store.getState().loadSettings();
      return;
    }
    if (frame.type === "pair-requests") {
      void this.store.getState().loadPairRequests({ fresh: true });
      return;
    }
    if (frame.type !== "chat" || !frame.chatId) return;

    const row = this.rows.get(frame.chatId);
    if (row?.serverId === serverId) this.rows.set(row.id, patchRow(row, frame));
    const dm = this.dms.get(frame.chatId);
    if (dm?.serverId === serverId) this.dms.set(dm.id, patchRow(dm, frame));
    const state = this.store.getState();
    const detail = state.details[frame.chatId];
    this.store.setState({
      chats: this.ordered(this.rows, this.rowOrder),
      dms: this.ordered(this.dms, this.dmOrder),
      ...(detail?.serverId === serverId
        ? { details: { ...state.details, [detail.id]: this.cacheDetail(mergeDetail(detail, frame)) } }
        : {}),
    });
  }

  private refreshTopics(serverId: string, topics: string[] = []): void {
    if (topics.includes("sidebar")) void this.refresh();
    if (topics.includes("board")) void this.store.getState().loadBoard({ fresh: true });
    if (topics.includes("settings")) void this.store.getState().loadSettings();
    for (const topic of topics) {
      if (!topic.startsWith("thread:")) continue;
      const id = topic.slice("thread:".length);
      const detail = this.store.getState().details[id];
      if (!detail || detail.serverId !== serverId || !this.store.getState().openIds.includes(id)) continue;
      void this.readDetail(id, serverId).then((fresh) => this.publishDetail(
        mergeDetailRefresh(this.store.getState().details[id], fresh),
      )).catch(() => {});
    }
  }

  private readDetail(id: string, serverId: string): Promise<ChatDetail> {
    const key = detailKey(id, serverId);
    const existing = this.pendingDetails.get(key);
    if (existing) return existing;
    const pending = this.transport.request<RawChatDetail>(
      serverId,
      `/chats/${encodeURIComponent(id)}?turns=${CHAT_PAGE_TURNS}`,
    ).then((raw) => this.cacheDetail(toDetail(raw, serverId))).finally(() => {
      if (this.pendingDetails.get(key) === pending) this.pendingDetails.delete(key);
    });
    this.pendingDetails.set(key, pending);
    return pending;
  }

  private publishDetail(detail: ChatDetail): void {
    this.cacheDetail(detail);
    this.store.setState((current) => ({
      details: { ...current.details, [detail.id]: detail },
      detailLoading: { ...current.detailLoading, [detail.id]: false },
    }));
  }

  private cacheDetail(detail: ChatDetail): ChatDetail {
    const key = detailKey(detail.id, detail.serverId);
    this.details.delete(key);
    this.details.set(key, detail);
    while (this.details.size > DETAIL_CACHE_LIMIT) {
      const oldest = this.details.keys().next().value;
      if (oldest === undefined) break;
      this.details.delete(oldest);
    }
    return detail;
  }

  private keepWarmCache(): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastWrite = 0;
    const save = () => {
      timer = undefined;
      const state = this.store.getState();
      if (state.servers.length === 0) return;
      lastWrite = Date.now();
      writeWarmCache(warmSnapshot(state, [...this.details.values()].reverse()));
    };
    const flush = () => {
      if (!timer) return;
      clearTimeout(timer);
      save();
    };
    const off = this.store.subscribe(() => {
      if (timer) return;
      const due = WARM_WRITE_MS - (Date.now() - lastWrite);
      if (due <= 0) save();
      else timer = setTimeout(save, due);
    });
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
      off();
      flush();
    };
  }

  private replaceAll(target: Map<string, Chat>, order: string[], rows: Chat[]): void {
    target.clear();
    order.length = 0;
    for (const row of rows) {
      target.set(row.id, row);
      order.push(row.id);
    }
  }

  private replaceServer(target: Map<string, Chat>, order: string[], serverId: string, incoming: Chat[]): void {
    const previous = new Map([...target.values()].filter((row) => row.serverId === serverId).map((row) => [row.id, row]));
    const retained = order.filter((id) => target.get(id)?.serverId !== serverId);
    for (const [id, row] of target) if (row.serverId === serverId) target.delete(id);
    for (const row of incoming) {
      const existing = previous.get(row.id);
      target.set(row.id, existing && sameChat(existing, row) ? existing : row);
    }
    order.splice(0, order.length, ...retained, ...incoming.map((row) => row.id));
  }

  private removeUnknown(target: Map<string, Chat>, order: string[], known: Set<string>): void {
    for (const [id, row] of target) if (!known.has(row.serverId)) target.delete(id);
    const kept = order.filter((id) => target.has(id));
    order.splice(0, order.length, ...kept);
  }

  private ordered(target: Map<string, Chat>, order: string[]): Chat[] {
    return order.flatMap((id) => {
      const row = target.get(id);
      return row ? [row] : [];
    });
  }
}

function detailKey(id: string, serverId: string): string {
  return `${serverId}:${id}`;
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

function toDetail(raw: RawChatDetail, serverId: string): ChatDetail {
  return {
    ...toChat(raw, serverId),
    permissionMode: raw.permissionMode,
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
    action: raw.action ?? undefined,
    live: raw.live,
    error: raw.error ?? undefined,
    context: raw.context ?? undefined,
  };
}

function mergeDetailRefresh(current: ChatDetail | undefined, fresh: ChatDetail): ChatDetail {
  if (!current || current.serverId !== fresh.serverId || fresh.entries.length === 0) return fresh;
  const first = fresh.entries[0];
  if (!first) return fresh;
  const overlap = current.entries.findIndex((entry) => entry.id === first.id);
  if (overlap < 0) return fresh;
  return {
    ...fresh,
    entries: uniqueEntries([...current.entries.slice(0, overlap), ...fresh.entries]),
    history: overlap > 0 ? current.history : fresh.history,
  };
}

function patchRow(chat: Chat, frame: ChatFrame): Chat {
  const next: Chat = {
    ...chat,
    state: frame.state ?? chat.state,
    title: frame.title ?? chat.title,
    updatedAt: frame.updatedAt ?? chat.updatedAt,
    workingSince: frame.workingSince === undefined ? chat.workingSince : frame.workingSince ?? undefined,
    ...(frame.unread === undefined ? {} : { unread: frame.unread }),
  };
  return sameChat(chat, next) ? chat : next;
}

function mergeDetail(detail: ChatDetail, frame: ChatFrame): ChatDetail {
  let entries = detail.entries;
  if (frame.removed?.length) {
    const removed = new Set(frame.removed);
    entries = entries.filter((entry) => !removed.has(entry.id));
  }
  if (frame.entries?.length) {
    entries = mergeEntryUpdates(entries, frame.entries, detail.id, detail.serverId);
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
    workingSince: frame.workingSince === undefined ? detail.workingSince : frame.workingSince ?? undefined,
  };
}

function setServerOnline(servers: Server[], id: string, online: boolean): Server[] {
  const index = servers.findIndex((server) => server.id === id);
  const server = servers[index];
  if (!server || server.online === online) return servers;
  const next = servers.slice();
  next[index] = { ...server, online };
  return next;
}

function mergeDiscoveredServers(current: Server[], incoming: Server[]): Server[] {
  const previous = new Map(current.map((server) => [server.id, server]));
  return incoming.map((server) => {
    const existing = previous.get(server.id);
    return existing && !server.cloud ? { ...server, online: existing.online } : server;
  });
}

function sameChat(left: Chat, right: Chat): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)] as (keyof Chat)[]);
  for (const key of keys) if (left[key] !== right[key]) return false;
  return true;
}

function byNewest(left: Chat, right: Chat): number {
  return Number(right.pinned ?? false) - Number(left.pinned ?? false)
    || (right.createdAt ?? right.updatedAt) - (left.createdAt ?? left.updatedAt);
}

function toArchivedThread(raw: RawArchive, serverId: string): ArchivedThread {
  const entries = raw.conversation?.entries ?? [];
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
    preview: [...entries].reverse().find((entry) =>
      (entry.kind === "assistant" || entry.kind === "user") && entry.text?.trim())?.text,
    archivedAt: raw.archivedAt,
    entries,
    todos: raw.conversation?.todos ?? [],
    context: raw.conversation?.context,
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
