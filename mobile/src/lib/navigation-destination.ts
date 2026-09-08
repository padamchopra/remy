export type PrimarySection = "inbox" | "threads" | "workspaces" | "board" | "prs" | "devices";

export type NavigationDestination =
  | { kind: "section"; section: PrimarySection }
  | { kind: "thread"; id: string; serverId?: string }
  | { kind: "agent"; id: string }
  | { kind: "workspace"; id: string; serverId?: string }
  | { kind: "ticket"; key: string }
  | { kind: "pull-request"; repository: string; number: number; serverId?: string }
  | { kind: "settings"; serverId?: string };

const sections = new Set<PrimarySection>(["inbox", "threads", "workspaces", "board", "prs", "devices"]);

function decoded(value: string | undefined): string {
  if (!value) return "";
  try { return decodeURIComponent(value).trim(); } catch { return value.trim(); }
}

export function navigationDestination(raw: string): NavigationDestination | undefined {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "remy:" && url.protocol !== "missioncontrol:") return undefined;
    const kind = url.hostname;
    const parts = url.pathname.split("/").filter(Boolean).map(decoded);
    const serverId = decoded(url.searchParams.get("server") ?? undefined) || undefined;
    if ((kind === "chat" || kind === "thread") && parts[0]) return { kind: "thread", id: parts[0], ...(serverId ? { serverId } : {}) };
    if (kind === "agent" && parts[0]) return { kind: "agent", id: parts[0] };
    if (kind === "workspace" && parts[0]) return { kind: "workspace", id: parts[0], ...(serverId ? { serverId } : {}) };
    if ((kind === "ticket" || kind === "task") && parts[0]) return { kind: "ticket", key: parts[0].toUpperCase() };
    if ((kind === "pull-request" || kind === "pr") && parts[0] && parts[1]) {
      const number = Number(parts[2] ?? parts[1]);
      const repository = parts[2] ? `${parts[0]}/${parts[1]}` : decoded(url.searchParams.get("repository") ?? undefined);
      if (repository.includes("/") && Number.isSafeInteger(number) && number > 0) return { kind: "pull-request", repository, number, ...(serverId ? { serverId } : {}) };
    }
    if (kind === "settings") return { kind: "settings", ...(parts[0] || serverId ? { serverId: parts[0] || serverId } : {}) };
    const askedSection = kind === "section" ? parts[0] : kind;
    const section = askedSection === "tasks" ? "board" : askedSection === "pull-requests" ? "prs" : askedSection;
    if (sections.has(section as PrimarySection)) return { kind: "section", section: section as PrimarySection };
  } catch {
    return undefined;
  }
  return undefined;
}

export function storedDestination(value: unknown): NavigationDestination | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (row.kind === "section" && typeof row.section === "string" && sections.has(row.section as PrimarySection)) return { kind: "section", section: row.section as PrimarySection };
  if (row.kind === "thread" && typeof row.id === "string" && row.id) return { kind: "thread", id: row.id, ...(typeof row.serverId === "string" ? { serverId: row.serverId } : {}) };
  if (row.kind === "agent" && typeof row.id === "string" && row.id) return { kind: "agent", id: row.id };
  if (row.kind === "workspace" && typeof row.id === "string" && row.id) return { kind: "workspace", id: row.id, ...(typeof row.serverId === "string" ? { serverId: row.serverId } : {}) };
  if (row.kind === "ticket" && typeof row.key === "string" && row.key) return { kind: "ticket", key: row.key };
  if (row.kind === "pull-request" && typeof row.repository === "string" && Number.isSafeInteger(row.number) && Number(row.number) > 0) return { kind: "pull-request", repository: row.repository, number: Number(row.number), ...(typeof row.serverId === "string" ? { serverId: row.serverId } : {}) };
  if (row.kind === "settings") return { kind: "settings", ...(typeof row.serverId === "string" ? { serverId: row.serverId } : {}) };
  return undefined;
}

export function notificationDestination(data: unknown): NavigationDestination | undefined {
  if (!data || typeof data !== "object") return undefined;
  const row = data as Record<string, unknown>;
  if (typeof row.organizationId === "string") return undefined;
  if (typeof row.click === "string") {
    const parsed = navigationDestination(row.click);
    if (parsed) return parsed;
  }
  const serverId = typeof row.serverId === "string" ? row.serverId : typeof row.deviceId === "string" ? row.deviceId : undefined;
  const threadId = typeof row.threadId === "string" ? row.threadId : typeof row.session === "string" ? row.session : undefined;
  if (threadId) return { kind: "thread", id: threadId, ...(serverId ? { serverId } : {}) };
  if (typeof row.ticketKey === "string") return { kind: "ticket", key: row.ticketKey };
  if (typeof row.repository === "string" && Number.isSafeInteger(row.number) && Number(row.number) > 0) return { kind: "pull-request", repository: row.repository, number: Number(row.number), ...(serverId ? { serverId } : {}) };
  return undefined;
}

export function hubNotificationUrl(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const row = data as Record<string, unknown>;
  if (typeof row.hubUrl !== "string" || typeof row.organizationId !== "string" || typeof row.computerId !== "string" || typeof row.threadId !== "string") return undefined;
  try {
    const url = new URL(row.hubUrl);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    url.pathname = "/"; url.search = "";
    url.hash = `/threads/${encodeURIComponent(row.threadId)}?${new URLSearchParams({ organization: row.organizationId, computer: row.computerId })}`;
    return url.toString();
  } catch { return undefined; }
}
