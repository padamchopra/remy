import { useSyncExternalStore } from "react";

/// A main thread's workbench: everything open for it, as tabs.
///
/// The transcript, each subthread, and each tool are tabs. Tabs live in
/// groups, a group shows one tab at a time, and the groups are arranged in a
/// split tree — so the same collection reads as a tab strip or as panes side
/// by side, and a tab can move between the two. A collection belongs to one
/// main thread: nothing in it comes from another thread, and a subthread is
/// in its parent's collection rather than owning one.
///
/// The workbench is this device's memory of how a thread was laid out, so it
/// lives in localStorage keyed by the parent thread; the URL keeps naming the
/// thread and the thread in focus, which is what the sidebar and a pasted
/// link need.

export type ToolKind = "terminal" | "browser" | "pull-request" | "activity" | "analytics" | "performance";

export type WorkbenchTab =
  | { kind: "thread"; threadId: string }
  | { kind: "terminal"; threadId: string }
  | { kind: "browser"; threadId: string; browserId: string }
  | { kind: "pull-request"; threadId: string; repository?: string; number?: number }
  | { kind: "activity"; threadId: string }
  | { kind: "analytics"; threadId: string }
  | { kind: "performance"; threadId: string };

export interface TabGroup {
  type: "group";
  id: string;
  tabs: WorkbenchTab[];
  active: string;
}

export interface WorkbenchSplit {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  first: WorkbenchNode;
  second: WorkbenchNode;
}

export type WorkbenchNode = TabGroup | WorkbenchSplit;

export interface Workbench {
  root: WorkbenchNode;
  /// The group whose active tab is the one you are in.
  focused: string;
}

export type Placement =
  /// Into the group you are in.
  | { at: "focused" }
  /// Into a named group.
  | { at: "group"; groupId: string }
  /// A new group beside the focused one, or beside a named one.
  | { at: "beside"; groupId?: string; direction?: "horizontal" | "vertical" }
  /// Where a tool goes when a thread opens it: another group if there is one,
  /// so the transcript stays where it was, otherwise a new group beside it.
  | { at: "tool"; threadId: string };

/// A thread tab is addressed by its thread, so `?focus=<threadId>` and the
/// sidebar's selection both name a tab without knowing about tabs.
export function tabId(tab: WorkbenchTab): string {
  if (tab.kind === "thread") return tab.threadId;
  if (tab.kind === "browser") return `browser:${tab.threadId}:${tab.browserId}`;
  return `${tab.kind}:${tab.threadId}`;
}

export function newWorkbench(parentId: string): Workbench {
  const group: TabGroup = { type: "group", id: newId(), tabs: [{ kind: "thread", threadId: parentId }], active: parentId };
  return { root: group, focused: group.id };
}

function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function groupsOf(node: WorkbenchNode): TabGroup[] {
  return node.type === "group" ? [node] : [...groupsOf(node.first), ...groupsOf(node.second)];
}

export function tabsOf(workbench: Workbench): WorkbenchTab[] {
  return groupsOf(workbench.root).flatMap((group) => group.tabs);
}

export function groupOf(workbench: Workbench, id: string): TabGroup | undefined {
  return groupsOf(workbench.root).find((group) => group.tabs.some((tab) => tabId(tab) === id));
}

export function findTab(workbench: Workbench, id: string): WorkbenchTab | undefined {
  return tabsOf(workbench).find((tab) => tabId(tab) === id);
}

export function focusedGroup(workbench: Workbench): TabGroup {
  const groups = groupsOf(workbench.root);
  return groups.find((group) => group.id === workbench.focused) ?? groups[0]!;
}

/// The thread you are in: the one behind the focused group's active tab.
export function focusedThreadId(workbench: Workbench): string | undefined {
  const group = focusedGroup(workbench);
  return group.tabs.find((tab) => tabId(tab) === group.active)?.threadId ?? group.tabs[0]?.threadId;
}

function boundedRatio(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(0.85, Math.max(0.15, number)) : 0.5;
}

function mapGroups(node: WorkbenchNode, change: (group: TabGroup) => TabGroup): WorkbenchNode {
  if (node.type === "group") {
    return change(node);
  }
  const first = mapGroups(node.first, change);
  const second = mapGroups(node.second, change);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

function replaceGroup(node: WorkbenchNode, groupId: string, replacement: WorkbenchNode): WorkbenchNode {
  if (node.type === "group") return node.id === groupId ? replacement : node;
  return {
    ...node,
    first: replaceGroup(node.first, groupId, replacement),
    second: replaceGroup(node.second, groupId, replacement),
  };
}

/// Drops empty groups and the splits left holding one side.
function pruneEmpty(node: WorkbenchNode): WorkbenchNode | undefined {
  if (node.type === "group") return node.tabs.length === 0 ? undefined : node;
  const first = pruneEmpty(node.first);
  const second = pruneEmpty(node.second);
  if (!first) return second;
  if (!second) return first;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

function withFocus(workbench: Workbench, groupId: string): Workbench {
  return workbench.focused === groupId ? workbench : { ...workbench, focused: groupId };
}

export function focusGroup(workbench: Workbench, groupId: string): Workbench {
  return groupsOf(workbench.root).some((group) => group.id === groupId) ? withFocus(workbench, groupId) : workbench;
}

/// Brings a tab to the front of its group and focuses that group. Unchanged
/// input comes back as the same object, so callers can tell nothing happened.
export function activateTab(workbench: Workbench, id: string): Workbench {
  const group = groupOf(workbench, id);
  if (!group) return workbench;
  if (group.active === id && workbench.focused === group.id) return workbench;
  const root = mapGroups(workbench.root, (candidate) => candidate.id === group.id && candidate.active !== id
    ? { ...candidate, active: id }
    : candidate);
  return { root, focused: group.id };
}

/// Opens a tab where the placement says, or brings it to the front if it is
/// already open somewhere. A tab is open once per collection. With `reveal`
/// off the tab is added without being brought forward — an agent opening a
/// browser should not pull you off what you were reading.
export function openTab(
  workbench: Workbench,
  tab: WorkbenchTab,
  placement: Placement = { at: "focused" },
  reveal = true,
): Workbench {
  const id = tabId(tab);
  const existing = groupOf(workbench, id);
  if (existing) {
    // A pull request tab is one per thread, but which pull request it shows
    // can change: replace it in place and bring it forward.
    if (tab.kind === "pull-request") {
      const root = mapGroups(workbench.root, (group) => group.id === existing.id
        ? { ...group, tabs: group.tabs.map((entry) => tabId(entry) === id ? tab : entry), active: reveal ? id : group.active }
        : group);
      return { root, focused: reveal ? existing.id : workbench.focused };
    }
    return reveal ? activateTab(workbench, id) : workbench;
  }

  const groups = groupsOf(workbench.root);
  const focused = focusedGroup(workbench);

  if (placement.at === "beside" || (placement.at === "tool" && groups.length === 1)) {
    const base = placement.at === "beside" && placement.groupId
      ? groups.find((group) => group.id === placement.groupId) ?? focused
      : placement.at === "tool"
        ? groupOf(workbench, placement.threadId) ?? focused
        : focused;
    const group: TabGroup = { type: "group", id: newId(), tabs: [tab], active: id };
    const split: WorkbenchSplit = {
      type: "split",
      id: newId(),
      direction: placement.at === "beside" && placement.direction ? placement.direction : "horizontal",
      ratio: 0.5,
      first: base,
      second: group,
    };
    return { root: replaceGroup(workbench.root, base.id, split), focused: reveal ? group.id : workbench.focused };
  }

  let target: TabGroup = focused;
  if (placement.at === "group") {
    target = groups.find((group) => group.id === placement.groupId) ?? focused;
  } else if (placement.at === "tool") {
    // The next group along from the thread's own, wrapping, so the tool lands
    // beside the transcript rather than on top of it.
    const own = groupOf(workbench, placement.threadId) ?? focused;
    const index = groups.findIndex((group) => group.id === own.id);
    target = groups[(index + 1) % groups.length] ?? focused;
  }
  const root = mapGroups(workbench.root, (group) => group.id === target.id
    ? { ...group, tabs: [...group.tabs, tab], active: reveal ? id : group.active }
    : group);
  return { root, focused: reveal ? target.id : workbench.focused };
}

/// Closes a tab. A group left empty goes with it, and focus moves to the
/// group that took its place. Closing the last tab of the last group is
/// refused: a collection is never empty.
export function closeTab(workbench: Workbench, id: string): Workbench {
  const group = groupOf(workbench, id);
  if (!group) return workbench;
  if (tabsOf(workbench).length === 1) return workbench;
  const index = group.tabs.findIndex((tab) => tabId(tab) === id);
  const remaining = group.tabs.filter((tab) => tabId(tab) !== id);
  const nextActive = group.active === id
    ? tabId(remaining[Math.max(0, index - 1)] ?? remaining[0]!)
    : group.active;
  const root = pruneEmpty(mapGroups(workbench.root, (candidate) => candidate.id === group.id
    ? { ...candidate, tabs: remaining, active: remaining.length ? nextActive : candidate.active }
    : candidate));
  if (!root) return workbench;
  const groups = groupsOf(root);
  const focused = groups.some((candidate) => candidate.id === workbench.focused)
    ? workbench.focused
    : groups[Math.min(groups.length - 1, Math.max(0, groupsOf(workbench.root).findIndex((candidate) => candidate.id === group.id)))]!.id;
  return { root, focused };
}

/// Moves a tab out into a new group beside the one it is in. The tab that
/// was alone in its group has nowhere new to go, so nothing happens.
export function splitTab(workbench: Workbench, id: string, direction: "horizontal" | "vertical"): Workbench {
  const group = groupOf(workbench, id);
  if (!group || group.tabs.length < 2) return workbench;
  const tab = group.tabs.find((entry) => tabId(entry) === id)!;
  const without = closeTab(workbench, id);
  return openTab(without, tab, { at: "beside", groupId: group.id, direction });
}

/// Moves a tab into another group, at the end. Its old group goes if that
/// emptied it.
export function moveTab(workbench: Workbench, id: string, groupId: string): Workbench {
  const from = groupOf(workbench, id);
  const to = groupsOf(workbench.root).find((group) => group.id === groupId);
  if (!from || !to || from.id === to.id) return workbench;
  const tab = from.tabs.find((entry) => tabId(entry) === id)!;
  const moved = mapGroups(workbench.root, (group) => {
    if (group.id === from.id) {
      const remaining = group.tabs.filter((entry) => tabId(entry) !== id);
      const index = group.tabs.findIndex((entry) => tabId(entry) === id);
      return {
        ...group,
        tabs: remaining,
        active: group.active === id && remaining.length ? tabId(remaining[Math.max(0, index - 1)]!) : group.active,
      };
    }
    if (group.id === to.id) return { ...group, tabs: [...group.tabs, tab], active: id };
    return group;
  });
  const root = pruneEmpty(moved) ?? workbench.root;
  return { root, focused: to.id };
}

export function resizeSplit(workbench: Workbench, splitId: string, ratio: number): Workbench {
  const resize = (node: WorkbenchNode): WorkbenchNode => {
    if (node.type === "group") return node;
    const first = resize(node.first);
    const second = resize(node.second);
    const next = node.id === splitId ? boundedRatio(ratio) : node.ratio;
    return first === node.first && second === node.second && next === node.ratio ? node : { ...node, ratio: next, first, second };
  };
  const root = resize(workbench.root);
  return root === workbench.root ? workbench : { ...workbench, root };
}

/// Drops what no longer exists — a subthread that was deleted, a tool for it —
/// and makes sure the parent's transcript is somewhere. Unchanged input comes
/// back as the same object.
export function pruneWorkbench(workbench: Workbench, parentId: string, threadIds: Set<string>): Workbench {
  let changed = false;
  const root = pruneEmpty(mapGroups(workbench.root, (group) => {
    const tabs = group.tabs.filter((tab) => threadIds.has(tab.threadId));
    if (tabs.length === group.tabs.length) return group;
    changed = true;
    const active = tabs.some((tab) => tabId(tab) === group.active) ? group.active : tabId(tabs[0] ?? { kind: "thread", threadId: parentId });
    return { ...group, tabs, active };
  }));
  if (!root) return newWorkbench(parentId);
  let next: Workbench = changed ? { root, focused: workbench.focused } : workbench;
  if (!groupsOf(next.root).some((group) => group.id === next.focused)) {
    next = { ...next, focused: groupsOf(next.root)[0]!.id };
  }
  if (!findTab(next, parentId)) {
    next = openTab(next, { kind: "thread", threadId: parentId }, { at: "group", groupId: groupsOf(next.root)[0]!.id });
  }
  return next;
}

/// Every tab in one group, for a screen too narrow to show groups side by
/// side. The layout itself is left alone, so the panes come back with the
/// width.
export function flattenWorkbench(workbench: Workbench): TabGroup {
  const focused = focusedGroup(workbench);
  return { type: "group", id: "all", tabs: tabsOf(workbench), active: focused.active };
}

// --- Persistence -----------------------------------------------------------

const STORAGE_PREFIX = "remy.workbench:";
const cache = new Map<string, Workbench>();
const listeners = new Set<() => void>();

function parseTab(value: unknown): WorkbenchTab | undefined {
  if (!value || typeof value !== "object") return undefined;
  const tab = value as Record<string, unknown>;
  if (typeof tab.threadId !== "string" || !tab.threadId) return undefined;
  switch (tab.kind) {
    case "thread":
    case "terminal":
    case "activity":
    case "analytics":
    case "performance":
      return { kind: tab.kind, threadId: tab.threadId };
    case "browser":
      return typeof tab.browserId === "string" && tab.browserId
        ? { kind: "browser", threadId: tab.threadId, browserId: tab.browserId }
        : undefined;
    case "pull-request":
      return {
        kind: "pull-request",
        threadId: tab.threadId,
        ...(typeof tab.repository === "string" && typeof tab.number === "number"
          ? { repository: tab.repository, number: tab.number }
          : {}),
      };
    default:
      return undefined;
  }
}

function parseNode(value: unknown): WorkbenchNode | undefined {
  if (!value || typeof value !== "object") return undefined;
  const node = value as Record<string, unknown>;
  if (node.type === "group") {
    if (typeof node.id !== "string" || !Array.isArray(node.tabs)) return undefined;
    const tabs = node.tabs.map(parseTab).filter((tab): tab is WorkbenchTab => Boolean(tab));
    if (tabs.length === 0) return undefined;
    const active = tabs.some((tab) => tabId(tab) === node.active) ? String(node.active) : tabId(tabs[0]!);
    return { type: "group", id: node.id, tabs, active };
  }
  if (node.type !== "split" || typeof node.id !== "string" || (node.direction !== "horizontal" && node.direction !== "vertical")) {
    return undefined;
  }
  const first = parseNode(node.first);
  const second = parseNode(node.second);
  if (!first) return second;
  if (!second) return first;
  return { type: "split", id: node.id, direction: node.direction, ratio: boundedRatio(node.ratio), first, second };
}

export function parseWorkbench(value: unknown): Workbench | undefined {
  if (!value || typeof value !== "object") return undefined;
  const root = parseNode((value as Record<string, unknown>).root);
  if (!root) return undefined;
  const focused = (value as Record<string, unknown>).focused;
  const groups = groupsOf(root);
  return { root, focused: groups.some((group) => group.id === focused) ? String(focused) : groups[0]!.id };
}

export function readWorkbench(parentId: string): Workbench {
  const cached = cache.get(parentId);
  if (cached) return cached;
  let stored: Workbench | undefined;
  try {
    stored = parseWorkbench(JSON.parse(localStorage.getItem(STORAGE_PREFIX + parentId) ?? "null"));
  } catch {
    stored = undefined;
  }
  const workbench = stored ?? newWorkbench(parentId);
  cache.set(parentId, workbench);
  return workbench;
}

export function writeWorkbench(parentId: string, workbench: Workbench): void {
  if (cache.get(parentId) === workbench) return;
  cache.set(parentId, workbench);
  try {
    localStorage.setItem(STORAGE_PREFIX + parentId, JSON.stringify(workbench));
  } catch {
    // The window still has it for this session.
  }
  for (const listener of listeners) listener();
}

/// Reads a workbench and applies a change to it, wherever the caller is — the
/// sidebar's "Open beside parent" goes through here without the pane mounted.
export function updateWorkbench(parentId: string, change: (workbench: Workbench) => Workbench): Workbench {
  const next = change(readWorkbench(parentId));
  writeWorkbench(parentId, next);
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkbench(parentId: string): Workbench {
  return useSyncExternalStore(subscribe, () => readWorkbench(parentId), () => readWorkbench(parentId));
}
