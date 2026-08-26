import type { AnalyticsTab } from "@/components/AnalyticsSettings";
import type { SettingsTab } from "@/components/Settings";

/// Where the window is, written down so a reload lands back on it.
///
/// The routes live in the hash rather than the path. Electron loads the built
/// app from a `file://` URL, where a path a server never sees cannot survive a
/// reload; a hash is the same string in both places, so the browser and the
/// desktop window agree without either needing a rewrite rule.

export type Route =
  // Inbox is a list of agents and the conversation with one, so which agent is
  // open is part of where the window is. Addressed by handle, which is what
  // somebody types and what a mention already says.
  | { name: "inbox"; agent?: string }
  | { name: "threads"; threadId?: string }
  | { name: "workspaces"; workspaceId?: string }
  | { name: "board"; scope?: string }
  | { name: "ticket"; key: string }
  | { name: "prs" }
  | { name: "recurring"; scope?: string }
  | { name: "settings"; tab: SettingsTab; analyticsTab?: AnalyticsTab; deviceId?: string };

export interface AppLocation {
  route: Route;
}

const SETTINGS_TABS: SettingsTab[] = [
  "general",
  "version-control",
  "providers",
  "devices",
  "analytics",
];

/// The section a route belongs to, which is what the sidebar highlights.
export function sectionOf(route: Route): "inbox" | "chats" | "workspaces" | "prs" | "tasks" {
  if (route.name === "threads") return "chats";
  if (route.name === "settings") return "chats";
  // Tasks is one section with two tabs, and a ticket sits inside it the way a
  // thread sits inside Threads.
  if (route.name === "board" || route.name === "recurring" || route.name === "ticket") return "tasks";
  return route.name;
}

export function parseLocation(hash: string): AppLocation {
  const raw = hash.replace(/^#/, "");
  const [path, query = ""] = raw.split("?");
  const [head, tail] = path.replace(/^\/+/, "").split("/");
  const rest = tail ? decodeURIComponent(tail) : undefined;

  if (head === "inbox") return { route: { name: "inbox", ...(rest ? { agent: rest } : {}) } };
  if (head === "workspaces") return { route: { name: "workspaces", workspaceId: rest } };
  if (head === "pull-requests") return { route: { name: "prs" } };
  // Both halves of Tasks take the same segment: the key prefixes the view is
  // filtered to, comma joined — `#/board/REMY,ATLAS` — so a filtered view is a
  // link you can send someone, and switching tabs keeps the filter.
  if (head === "recurring") return { route: { name: "recurring", scope: rest } };
  if (head === "board") return { route: { name: "board", scope: rest } };
  // Tickets are addressed by key rather than id, so a link someone pastes reads
  // as the thing it opens.
  if (head === "tickets" && rest) return { route: { name: "ticket", key: rest } };
  if (head === "settings") {
    const tab = SETTINGS_TABS.includes(rest as SettingsTab) ? (rest as SettingsTab) : "general";
    const params = new URLSearchParams(query);
    const askedAnalyticsTab = params.get("tab");
    const analyticsTab: AnalyticsTab = askedAnalyticsTab === "usage" ? "usage" : "general";
    const deviceId = params.get("device") || undefined;
    return {
      route: {
        name: "settings",
        tab,
        ...(tab === "analytics" ? { analyticsTab } : {}),
        ...(tab === "providers" && deviceId ? { deviceId } : {}),
      },
    };
  }
  // Threads are the front door, so anything unrecognised lands there rather
  // than on a blank screen.
  return { route: { name: "threads", threadId: head === "threads" ? rest : undefined } };
}

export function formatLocation({ route }: AppLocation): string {
  const path =
    route.name === "threads"
      ? `/threads${route.threadId ? `/${encodeURIComponent(route.threadId)}` : ""}`
      : route.name === "workspaces"
        ? `/workspaces${route.workspaceId ? `/${encodeURIComponent(route.workspaceId)}` : ""}`
        : route.name === "board" || route.name === "recurring"
          ? `/${route.name}${route.scope ? `/${encodeURIComponent(route.scope)}` : ""}`
          : route.name === "ticket"
            ? `/tickets/${encodeURIComponent(route.key)}`
            : route.name === "settings"
              ? `/settings/${route.tab}${
                  route.tab === "analytics" && route.analyticsTab === "usage"
                    ? "?tab=usage"
                    : route.tab === "providers" && route.deviceId
                      ? `?device=${encodeURIComponent(route.deviceId)}`
                      : ""
                }`
              : route.name === "prs"
                ? "/pull-requests"
                : `/inbox${route.agent ? `/${encodeURIComponent(route.agent)}` : ""}`;
  return `#${path}`;
}
