import type { Route } from "@/lib/route";

export interface AppTab {
  id: string;
  route: Route;
}

export interface AppTabs {
  tabs: AppTab[];
  focused: string;
  split?: { direction: "horizontal" | "vertical"; first: string; second: string };
}

const storageKey = "remy.app-tabs:v1";

function id(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function newAppTabs(route: Route): AppTabs {
  const first = id();
  return { tabs: [{ id: first, route }], focused: first };
}

export function readAppTabs(route: Route): AppTabs {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as AppTabs | null;
    if (!value || !Array.isArray(value.tabs) || !value.tabs.length ||
      !value.tabs.every((tab) => typeof tab.id === "string" && tab.route &&
        ["threads", "prs", "workspaces", "settings"].includes(tab.route.name)) ||
      new Set(value.tabs.map((tab) => tab.id)).size !== value.tabs.length) return newAppTabs(route);
    const focused = value.tabs.find((tab) => tab.id === value.focused) ?? value.tabs[0]!;
    const candidate = value.split;
    const split = candidate && candidate.first !== candidate.second &&
      value.tabs.some((tab) => tab.id === candidate.first) &&
      value.tabs.some((tab) => tab.id === candidate.second) &&
      (candidate.direction === "horizontal" || candidate.direction === "vertical")
      ? candidate : undefined;
    return { tabs: value.tabs, focused: focused.id, ...(split ? { split } : {}) };
  } catch {
    return newAppTabs(route);
  }
}

export function saveAppTabs(value: AppTabs): void {
  try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Keep the current window usable. */ }
}

export function navigateAppTab(value: AppTabs, route: Route): AppTabs {
  return { ...value, tabs: value.tabs.map((tab) => tab.id === value.focused ? { ...tab, route } : tab) };
}

export function addAppTab(value: AppTabs, route: Route): AppTabs {
  const next = id();
  return { ...value, tabs: [...value.tabs, { id: next, route }], focused: next,
    ...(value.split ? { split: { ...value.split, [value.split.first === value.focused ? "first" : "second"]: next } } : {}) };
}

export function focusAppTab(value: AppTabs, tabId: string): AppTabs {
  if (!value.tabs.some((tab) => tab.id === tabId)) return value;
  if (!value.split || value.split.first === tabId || value.split.second === tabId) return { ...value, focused: tabId };
  const side = value.split.first === value.focused ? "first" : "second";
  return { ...value, focused: tabId, split: { ...value.split, [side]: tabId } };
}

export function splitAppTab(value: AppTabs, direction: "horizontal" | "vertical", route: Route): AppTabs {
  if (value.split) return { ...value, split: { ...value.split, direction } };
  const index = value.tabs.findIndex((tab) => tab.id === value.focused);
  const existing = value.tabs.length > 1 ? value.tabs[(index + 1) % value.tabs.length] : undefined;
  const next = existing?.id ?? id();
  return { tabs: existing ? value.tabs : [...value.tabs, { id: next, route }], focused: next,
    split: { direction, first: value.focused, second: next } };
}

export function openAppTabBeside(value: AppTabs, sourceId: string, route: Route): AppTabs {
  if (!value.tabs.some((tab) => tab.id === sourceId)) return value;
  const existing = value.tabs.find((tab) => JSON.stringify(tab.route) === JSON.stringify(route) && tab.id !== sourceId);
  const next = existing?.id ?? id();
  return {
    tabs: existing ? value.tabs : [...value.tabs, { id: next, route }],
    focused: next,
    split: { direction: "horizontal", first: sourceId, second: next },
  };
}

export function closeAppTab(value: AppTabs, tabId: string): AppTabs {
  if (value.tabs.length === 1) return value;
  const index = value.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return value;
  const tabs = value.tabs.filter((tab) => tab.id !== tabId);
  const split = value.split && (value.split.first === tabId || value.split.second === tabId) ? undefined : value.split;
  const focused = value.focused === tabId ? tabs[Math.min(index, tabs.length - 1)]!.id : value.focused;
  return { tabs, focused, ...(split ? { split } : {}) };
}
