import type { Chat, Server, Workspace } from "./types";

/// Development fixture.
///
/// The desktop app is judged on how it renders a *populated* window, and a
/// machine with nothing connected shows empty columns no matter how good the
/// design is. This exists so the layout can be reviewed against real-shaped
/// content before a server is attached. It is only reachable when
/// `VITE_MC_FIXTURE=1`, never in a packaged build.
export const fixtureServers: Server[] = [
  { id: "studio", name: "Studio", url: "http://studio:8787", code: "STU", online: true, icon: "monitor" },
  { id: "laptop", name: "Laptop", url: "http://laptop:8787", code: "LAP", online: true, icon: "laptop" },
];

export const fixtureChats: Chat[] = [
  {
    id: "c1",
    serverId: "studio",
    title: "Port the chat tab",
    cwd: "~/code/remy",
    state: "idle",
    model: "opus",
    preview: "Both PRs are open and the stack is linked.",
    createdAt: Date.now() - 4_800_000,
    updatedAt: Date.now() - 600_000,
  },
  {
    id: "c2",
    serverId: "studio",
    title: "SQLite migration notes",
    cwd: "~/code/remy/server",
    state: "needs_input",
    model: "sonnet",
    preview: "Approve running the migration against the live database?",
    createdAt: Date.now() - 3_600_000,
    updatedAt: Date.now() - 120_000,
  },
  {
    id: "c3",
    serverId: "studio",
    title: "Guest tabs review",
    cwd: "~/code/phere",
    state: "working",
    model: "opus",
    preview: "Editing GuestTabsViewModel.kt",
    createdAt: Date.now() - 1_200_000,
    updatedAt: Date.now() - 4_000,
  },
  {
    id: "c4",
    serverId: "laptop",
    title: "Jupiter gacha",
    cwd: "~/code/jupiter-mobile",
    state: "working",
    model: "sonnet",
    preview: "Updating the pull animation timing.",
    createdAt: Date.now() - 300_000,
    updatedAt: Date.now() - 12_000,
  },
];

export const fixtureWorkspaces: Workspace[] = [
  {
    id: "w1",
    serverId: "studio",
    name: "remy",
    path: "~/code/remy",
    origin: "github.com/padamchopra/remy",
    worktrees: [{ path: "~/code/remy", branch: "main", isMain: true, dirty: false }],
  },
  {
    id: "w2",
    serverId: "laptop",
    name: "jupiter-mobile",
    path: "~/code/jupiter-mobile",
    origin: "github.com/padamchopra/jupiter-mobile",
    worktrees: [{ path: "~/code/jupiter-mobile", branch: "main", isMain: true, dirty: false }],
  },
];
