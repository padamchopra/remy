import type { AnalyticsTab } from "@/components/AnalyticsSettings";
import { isHostedRuntime } from "@/lib/hub-session";
import type { SettingsTab } from "@/lib/settings-sections";

/// Where the window is, written down so a reload lands back on it.
///
/// Electron keeps routes in the hash because it loads the build from `file://`.
/// The hosted app uses normal paths and its server returns the app shell for a
/// direct route, so browser URLs stay clean without weakening desktop reloads.

export type Route = (
  // `focus` names the thread in front when the one the URL opens on has more
  // than one in its collection. How that collection is laid out is the
  // workbench's, kept on this device rather than in the address.
  | { name: "threads"; threadId?: string; focus?: string; organizationId?: string; computerId?: string }
  | { name: "workspaces"; workspaceId?: string }
  | { name: "board"; scope?: string }
  | { name: "ticket"; key: string }
  | { name: "prs" }
  | { name: "settings"; tab: SettingsTab; organizationTab?: "general" | "members" | "teams" | "computers"; analyticsTab?: AnalyticsTab; deviceId?: string; agent?: string; organizationId?: string }) & { organizationId?: string; ownerOrganizationId?: string };

export interface AppLocation {
  route: Route;
}

const SETTINGS_TABS: SettingsTab[] = [
  "organization",
  "general",
  "agents",
  "version-control",
  "providers",
  "devices",
  "environments", "analytics", "members", "teams", "routing", "connections",
];

/// The section a route belongs to, which is what the sidebar highlights.
export function sectionOf(route: Route): "chats" | "workspaces" | "prs" | "tasks" {
  if (route.name === "threads" || route.name === "settings") return "chats";
  if (route.name === "board" || route.name === "ticket") return "tasks";
  return route.name;
}

function parseRoute(hash: string): AppLocation {
  const raw = hash.replace(/^#/, "");
  const [path, query = ""] = raw.split("?");
  const [head, tail] = path.replace(/^\/+/, "").split("/");
  const rest = tail ? decodeURIComponent(tail) : undefined;

  // Older Inbox links open Agents in Settings. The handle or id in the path
  // is the same agent query Settings already uses.
  if (head === "inbox") {
    return {
      route: {
        name: "settings",
        tab: "agents",
        ...(rest ? { agent: rest } : {}),
      },
    };
  }
  if (head === "workspaces") return { route: { name: "workspaces", workspaceId: rest } };
  if (head === "pull-requests") return { route: { name: "prs" } };
  // Older links to recurring tickets land on the board now that routines live
  // with agents instead of Tasks.
  if (head === "recurring") return { route: { name: "board", scope: rest } };
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
    const agent = params.get("agent") || undefined;
    return {
      route: {
        name: "settings",
        tab,
        ...(tab === "devices" && params.get("organization") ? { organizationId: params.get("organization")! } : {}),
        ...(tab === "organization" ? {organizationTab: params.get("section") === "members" ? "members" as const : params.get("section") === "teams" ? "teams" as const : params.get("section") === "computers" ? "computers" as const : "general" as const} : {}),
        ...(tab === "analytics" ? { analyticsTab } : {}),
        ...((tab === "providers" || tab === "devices") && deviceId ? { deviceId } : {}),
        ...(tab === "agents" && agent ? { agent } : {}),
      },
    };
  }
  // Threads are the front door, so anything unrecognised lands there rather
  // than on a blank screen.
  const params = new URLSearchParams(query);
  const focus = params.get("focus") || undefined;
  return {
    route: {
      name: "threads",
      threadId: head === "threads" ? rest : undefined,
      ...(focus ? { focus } : {}),
      ...(params.get("organization") ? { organizationId: params.get("organization")! } : {}),
      ...(params.get("computer") ? { computerId: params.get("computer")! } : {}),
    },
  };
}

export function formatPathLocation({ route }: AppLocation): string {
  const path =
    route.name === "threads"
      ? `/threads${route.threadId ? `/${encodeURIComponent(route.threadId)}` : ""}`
      : route.name === "workspaces"
        ? `/workspaces${route.workspaceId ? `/${encodeURIComponent(route.workspaceId)}` : ""}`
        : route.name === "board"
          ? `/board${route.scope ? `/${encodeURIComponent(route.scope)}` : ""}`
          : route.name === "ticket"
            ? `/tickets/${encodeURIComponent(route.key)}`
          : route.name === "settings"
              ? `/settings/${route.tab}`
              : "/pull-requests";
  const params = new URLSearchParams();
  const threadId = route.name === "threads" ? route.threadId : undefined;
  if (route.name === "threads" && route.focus) params.set("focus", route.focus);
  if (route.name === "settings" && route.tab === "analytics" && route.analyticsTab === "usage") params.set("tab", "usage");
  if (route.name === "settings" && (route.tab === "providers" || route.tab === "devices") && route.deviceId) params.set("device", route.deviceId);
  if (route.name === "settings" && route.tab === "agents" && route.agent) params.set("agent", route.agent);
  if (route.organizationId && route.organizationId !== "all" && !threadId) params.set("organization", route.organizationId);
  if (route.name === "settings" && route.tab === "organization" && route.organizationTab) params.set("section", route.organizationTab);
  if (route.ownerOrganizationId && !threadId) params.set("owner", route.ownerOrganizationId);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function formatLocation(location: AppLocation): string {
  return `#${formatPathLocation(location)}`;
}

export function parseLocation(hash: string): AppLocation {
  const result = parseRoute(hash);
  const params = new URLSearchParams(hash.split("?")[1] ?? "");
  const owner = params.get("owner");
  const org = params.get("organization") ?? (owner ? "all" : null);
  return org ? { route: { ...result.route, organizationId: org, ...(owner ? {ownerOrganizationId:owner} : {}) } } : result;
}

export const LOCATION_CHANGE_EVENT = "remy:location-change";

function hostedBasePath(): string {
  return window.location.pathname === "/app" || window.location.pathname.startsWith("/app/") ? "/app" : "";
}

export function currentLocation(): string {
  if (!isHostedRuntime()) return window.location.hash;
  if (window.location.hash.startsWith("#/")) return window.location.hash;
  const base = hostedBasePath();
  const path = window.location.pathname.slice(base.length) || "/";
  return `${path}${window.location.search}`;
}

export function normalizeLocation(): AppLocation {
  const legacyHash = window.location.hash.startsWith("#/");
  const search = new URLSearchParams(window.location.search);
  const redundantAll = search.get("organization") === "all";
  const location = parseLocation(currentLocation());
  const hostedThread = isHostedRuntime() && location.route.name === "threads" && location.route.threadId
    && (search.has("computer") || search.has("owner") || search.has("organization") || legacyHash);
  const leftoverInbox = /(?:^|\/)inbox(?:\/|$)/.test(
    isHostedRuntime()
      ? window.location.pathname.slice(hostedBasePath().length) || "/"
      : window.location.hash.replace(/^#/, ""),
  );
  if (leftoverInbox || (isHostedRuntime() && (legacyHash || redundantAll || hostedThread))) {
    const next = isHostedRuntime()
      ? `${hostedBasePath()}${formatPathLocation(location)}`
      : formatLocation(location);
    window.history.replaceState(null, "", next);
  }
  return location;
}

export function formatBrowserLocation(location: AppLocation): string {
  return isHostedRuntime() ? `${hostedBasePath()}${formatPathLocation(location)}` : formatLocation(location);
}

export function navigateLocation(location: AppLocation, replace = false): void {
  if (!isHostedRuntime()) {
    const hash = formatLocation(location);
    if (hash === window.location.hash) return;
    if (replace) {
      window.history.replaceState(null, "", hash);
      window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
    } else {
      window.location.hash = hash;
    }
    return;
  }
  const path = formatBrowserLocation(location);
  if (`${window.location.pathname}${window.location.search}` === path && !window.location.hash) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", path);
  window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
}

export function listenToLocationChanges(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  window.addEventListener(LOCATION_CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener(LOCATION_CHANGE_EVENT, listener);
  };
}
