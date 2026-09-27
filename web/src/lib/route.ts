import { isHostedRuntime } from "@/lib/hub-session";
import type { SettingsTab } from "@/lib/settings-sections";

/// Where the window is, written down so a reload lands back on it.
///
/// The web app uses normal paths and its server returns the app shell for a
/// direct route. An older `#/` link still parses and is rewritten to its path
/// once the hosted runtime is known. Outside it — the website's product preview,
/// or the moment before `/api/runtime` answers — routes stay in the hash, so the
/// page never navigates somewhere its server cannot answer.

export type Route = (
  // `focus` names the thread in front when the one the URL opens on has more
  // than one in its collection. How that collection is laid out is the
  // workbench's, kept on this device rather than in the address.
  | { name: "threads"; threadId?: string; focus?: string; organizationId?: string; computerId?: string }
  | { name: "workspaces"; workspaceId?: string }
  // A pull request is addressed by its repository and number, which is what
  // GitHub calls it and what someone pastes.
  // `view` is the tab in front: the summary, or the files it changes.
  | { name: "prs"; repository?: string; number?: number; view?: "files" }
  | { name: "settings"; tab: SettingsTab; organizationTab?: "general" | "members" | "teams" | "computers"; deviceId?: string; organizationId?: string }) & { organizationId?: string; ownerOrganizationId?: string };

export interface AppLocation {
  route: Route;
}

const RETIRED_SECTIONS = new Set(["inbox", "agents", "board", "tasks", "tickets", "recurring"]);

const SETTINGS_TABS: SettingsTab[] = [
  "organization",
  "general",
  "version-control",
  "providers",
  "devices",
  "environments", "members", "teams", "connections",
];

/// The section a route belongs to, which is what the sidebar highlights.
export function sectionOf(route: Route): "chats" | "workspaces" | "prs" {
  if (route.name === "threads" || route.name === "settings") return "chats";
  return route.name;
}

function pullRequestRoute(path: string): Route {
  let parts: string[];
  try {
    parts = path.replace(/^\/+/, "").split("/").map((part) => decodeURIComponent(part));
  } catch {
    return { name: "prs" };
  }
  const [, owner, name, number, view, extra] = parts;
  if (!owner || !name || extra !== undefined || !/^[1-9]\d{0,9}$/.test(number ?? "")) return { name: "prs" };
  if (view !== undefined && view !== "files") return { name: "prs" };
  return { name: "prs", repository: `${owner}/${name}`, number: Number(number), ...(view ? { view } : {}) };
}

function parseRoute(hash: string): AppLocation {
  const raw = hash.replace(/^#/, "");
  const [path, query = ""] = raw.split("?");
  // Hosted app-shell links keep `/app` on the pathname. Strip it so `/app/inbox`
  // parses the same as `/inbox`.
  const trimmed = path.replace(/^\/app(?=\/|$)/, "") || "/";
  const [head, tail] = trimmed.replace(/^\/+/, "").split("/");
  const rest = tail ? decodeURIComponent(tail) : undefined;

  // Inbox, Agents and Tasks are gone, so an older link opens the threads it was
  // always one click from.
  if (RETIRED_SECTIONS.has(head ?? "")) return { route: { name: "threads" } };
  if (head === "workspaces") return { route: { name: "workspaces", workspaceId: rest } };
  if (head === "pull-requests") return { route: pullRequestRoute(trimmed) };
  if (head === "settings") {
    const tab = SETTINGS_TABS.includes(rest as SettingsTab) ? (rest as SettingsTab) : "general";
    const params = new URLSearchParams(query);
    const deviceId = params.get("device") || undefined;
    return {
      route: {
        name: "settings",
        tab,
        ...(tab === "devices" && params.get("organization") ? { organizationId: params.get("organization")! } : {}),
        ...(tab === "organization" ? {organizationTab: params.get("section") === "members" ? "members" as const : params.get("section") === "teams" ? "teams" as const : params.get("section") === "computers" ? "computers" as const : "general" as const} : {}),
        ...((tab === "providers" || tab === "devices") && deviceId ? { deviceId } : {}),
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
        : route.name === "settings"
              ? `/settings/${route.tab}`
              : route.repository && route.number
                ? `/pull-requests/${route.repository.split("/").map(encodeURIComponent).join("/")}/${route.number}${route.view ? `/${route.view}` : ""}`
                : "/pull-requests";
  const params = new URLSearchParams();
  const threadId = route.name === "threads" ? route.threadId : undefined;
  if (route.name === "threads" && route.focus) params.set("focus", route.focus);
  if (route.name === "settings" && (route.tab === "providers" || route.tab === "devices") && route.deviceId) params.set("device", route.deviceId);
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

function pathInsideHostedBase(): string {
  return window.location.pathname.slice(hostedBasePath().length) || "/";
}

const RETIRED = /^\/*(?:app\/)?(?:inbox|agents|board|tasks|tickets|recurring)(?:\/|$)/;

function retiredFromPath(): string | undefined {
  const path = pathInsideHostedBase();
  if (RETIRED.test(path)) return `${path}${window.location.search}`;
}

function retiredFromHash(): string | undefined {
  const hash = window.location.hash.replace(/^#/, "");
  if (RETIRED.test(hash)) return hash;
}

export function currentLocation(): string {
  if (!isHostedRuntime()) return window.location.hash;
  if (window.location.hash.startsWith("#/")) return window.location.hash;
  return `${pathInsideHostedBase()}${window.location.search}`;
}

export function normalizeLocation(): AppLocation {
  const fromPath = retiredFromPath();
  const fromHash = retiredFromHash();
  const legacyHash = window.location.hash.startsWith("#/");
  const search = new URLSearchParams(window.location.search);
  const redundantAll = search.get("organization") === "all";
  const location = parseLocation(fromPath ?? fromHash ?? currentLocation());
  const hostedThread = isHostedRuntime() && location.route.name === "threads" && location.route.threadId
    && (search.has("computer") || search.has("owner") || search.has("organization") || legacyHash);
  // A retired path such as `/app/agents` must rewrite before `/api/runtime`
  // answers, or a load waiter sees the old address.
  if (fromPath || fromHash || (isHostedRuntime() && (legacyHash || redundantAll || hostedThread))) {
    const next = fromPath || isHostedRuntime() || hostedBasePath()
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
