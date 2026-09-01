# Remy — agent guide

Remy is a remote for [Claude Code](https://claude.com/claude-code) on your own machines. A daemon runs on the Mac that holds the repos; the Electron window, the browser, and the iOS app are views onto it. Nothing is copied to a cloud.

`README.md` is the product story. This file is how to work in the code.

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`; both stay in sync.

## Running it locally

Once: `npm run install:all` — server, web, desktop, mobile.

For a UI-only change, run `npm run dev:web`, and open `http://127.0.0.1:5173`. It uses the packaged Remy daemon and your real state. If someone asks for the desktop app by name, leave that dev server running and start `npm run dev` in a second terminal.

For a server change, run `npm run qa:web` instead. It builds the current checkout, starts its daemon and Vite on unused loopback ports, and prints the URL. Its database and sample workspace are temporary and removed when the command stops. Use `npm run qa:web -- --empty` when the empty state is what you need to inspect, or `npm run qa:web -- --check` for a non-interactive startup and proxy check.

The iPhone app is `cd mobile && npx expo run:ios`. It talks to the same daemon over Tailscale after you pair it from Settings → Devices.

Vite talks to the same daemon as the DMG (`127.0.0.1:8420`) and the same database (`~/.remy/remy.db`), so threads, workspaces, settings and the token are the real ones. If Remy.app is already running, Vite attaches to that daemon rather than starting a second one.

The page does not live-reload. Refresh it to see a change: editing Remy while watching Remy meant every save yanked the window out from under whatever was on screen.

**UI changes** — Remy.app can stay open; the page is your local `web/` either way.

**Server changes** — keep Remy.app open and use the isolated QA sidecar. Never stop the packaged daemon on port 8420 from a thread it is hosting. Stop only the `qa:web` command you started.

Skip `VITE_MC_FIXTURE=1`; that is fake data, not your real state.

## Layout

| Path | What it is |
|---|---|
| `web/` | The UI. React 19, Tailwind v4, [shadcn/ui](https://ui.shadcn.com) New York (Radix) in `web/src/components/ui`, Zustand store in `web/src/state`. |
| `server/` | The daemon. Node and TypeScript, binds `127.0.0.1` only, SQLite at `~/.remy/remy.db` through `node:sqlite`. Threads run on the Claude Agent SDK, Codex app-server, or Cursor ACP — see **Providers**. |
| `desktop/` | The Electron shell (`me.padamchopra.Remy`). Owns the window and the tokens, and ships the `web/` build plus the daemon in the DMG. |
| `mobile/` | The iPhone app (Expo / React Native). A remote for a Mac daemon — it cannot run standalone. |
| `deploy/` | Optional launchd login item, provider hooks, `tailscale serve`, pairing QR. |
| `.agents/skills/` | House rules. Read the one that covers what you are about to change. |

`web/vite.config.ts` does more than it looks: it spawns the local daemon when none is up, proxies `/api` to it, and injects the bearer token from `~/.remy/remy.db` on each request so the token never reaches the page.

## Skills

`.agents/skills` holds the conventions reviews are held to.

`.claude/skills` is a symlink to this directory so Claude and other agents discover the same skills. Add each skill only under `.agents/skills`; do not add per-skill Claude links.

- **`ui`** — layout and keyboard. Every control comes from a shadcn primitive; a custom `div` is the last resort.
- **`content`** — every user-facing string. Second person, present tense, one short sentence.
- **`product-design`** — ownership, settings placement, defaults, actors, and deletion behavior. Read it before shaping a capability or integration.
- **`distributed-state`** — complete read, write, live-update, and reconnect paths across devices and process boundaries.
- **`performance-diagnosis`** — measure request, payload, render, and freshness waits before choosing a fix.
- **`qa`** — after an interaction or server behavior change, drive the current code in the running app before calling it done.
- **`pr-author`** — every PR carries proportional reviewer evidence and reads in one screen; screenshots or recordings are required only for behavior a reviewer can exercise or judge in the running app.
- **`shadcn`** and **`migrate-radix-to-base`** — vendored from `shadcn/ui` and tracked in `skills-lock.json`. Do not hand-edit them.

## Terminology

The code and the person do not always use the same word. Where they differ, the
code's word is the one in types, tables and routes; the person's word is the one
in **every string anybody reads** — a label, a menu item, an empty state, an
error, a toast, a comment on a ticket. Getting this wrong is the most repeated
mistake in this repo, so check the table before naming anything.

| The code says | A person reads | Because |
|---|---|---|
| `project` | **workspace** | A project is the repository, keyed on its origin remote so two machines land on the same one. A workspace is one machine's folder holding it. Nobody adds a project — they add a folder, so that is the only word the UI uses. |
| `chat` | **thread** | A conversation with an agent. The API, the database and the code all still say chat. |
| a `chat` with `dm` | **the conversation with an agent** | One per agent, in Inbox. Code still says chat; nothing a person reads says DM. |
| `server`, `peer` | **device** | Another machine you paired with. |
| `keyPrefix` | **ticket slug** | The letters in front of a ticket key. |
| `recurrence` | **routine** | The legacy projection name remains internal; a routine belongs to an agent and sends it work on a cadence. |
| `assigneeAgentId` of `you` / `workspace` | **You** / **Workspace agent** | The two assignees that are not agent rows. |

Nothing a person reads says project, job, workflow, cron, daemon, projection,
fold, board log, lamport, event or DM. **Tasks** is the board section and a
**ticket** is its unit of work. Machine is
fine — the app says "this machine" — and so is worktree, which is a git word
anyone using worktrees already has.

## Checks

```sh
npm run typecheck    # web + desktop + mobile
npm test             # server: tsc, then node --test on dist/*.test.js; then the phone's contract rules
npm run qa:web -- --check  # current server + UI, temporary state, alternate ports
npm run shots        # Playwright PNGs of the window
npm run live-check   # assert the window is showing threads
npm run perf         # what each pane costs to open, and how much of it waits on another device
npm run pack:mac     # web + daemon + Electron DMG → desktop/release/
```

A server module opens its database at import time, so a test that touches state points `MC_CONFIG_DIR` (or `HOME`) at a `mkdtempSync` directory **before** the dynamic `await import(...)` of the module under test — see `server/src/chat-storage.test.ts`. A static import runs first and would open the real `~/.remy/remy.db`. `node:test` gives each file its own process, so the override cannot leak sideways.

## Conventions

- **Comments** explain why, not what, and use `///` on exported declarations. Match the density of the file you are in; the codebase is sparse.
- **No shell strings.** The server reaches `git`, `gh`, and `tmux` through `execFile` with an argument array. Never build a command line, and never interpolate a path or a branch name into one.
- **Loopback only.** The daemon binds `127.0.0.1` behind a bearer token; the way in from another device is `tailscale serve`. Do not widen the bind.
- **Config lives in the database** — the `kv` table in `~/.remy/remy.db`, read through `server/src/config.ts`. A new setting is a key on `Config`, a line in `publicSettings`, and a validated branch in `patchSettings`; the client reads and writes it at `/server/settings`. `~/.mission-control` is the legacy directory, honoured when `~/.remy` is absent.
- **Where the window is lives in the URL**, as a hash route parsed by `web/src/lib/route.ts`. Electron loads the build from `file://`, where a path a server never sees cannot survive a reload, so the hash is what both surfaces agree on.
- **Worktrees** Remy creates go in a `.remy` folder, inside the workspace or under the `worktreeRoot` setting, hidden by a rule in the repo's `.git/info/exclude` — per-clone and never committed, so no tracked `.gitignore` changes. Worktrees already checked out elsewhere are left where they are.
- **The words a person reads** are not always the words the code uses — see **Terminology** above, and check it before naming a label, an error or an empty state.
- **A provider and a model are one choice.** `server/src/providers.ts` is the only list of what a thread may run on; `config.ts`, `agents.ts` and `chat.ts` validate against it, `GET /server/providers` serves it with what the machine actually has installed, and every picker in the window is `web/src/components/ModelPicker.tsx`. Moving to another provider takes the model to that provider's default rather than keeping one it would refuse.
- **Threads are the product; nothing displaces them.** The sidebar's thread
  list is on screen in every section, and a thread is always one click away.
  A new section brings its own lists into the main pane — never by taking the
  sidebar over, and never behind a step that hides what is running. Anything
  that would make a thread harder to reach is the wrong shape, however good the
  new thing is.
- **A desktop thread is a focused work log beside a work surface.** Its transcript is a narrow, identity-light reading column; its tools open beside it by default on a wide screen, in a larger resizable pane with a quiet launcher when nothing is open. Inbox conversations keep their agent identity because the person is the point there.
- **Inbox is the agents.** Every agent has one conversation with you, made the
  first time you open it (`dmChatFor`), listed by `listDms` and never by
  `listChats` — a thread is work in a repository, and this is not. It opens in
  your home folder: work that needs a repository open in front of it is a thread
  the agent starts. The roster is a list inside the Inbox pane, for the reason
  above. Everything about an agent lives there too rather than in Settings,
  because an agent is somebody you talk to. A conversation belongs to its agent:
  deleting the agent deletes it, and `listDms` hides one whose agent is gone
  before the row is cleared. Picking a model for an agent picks it for its
  conversation (`syncAgentDm`) — a thread keeps the provider it was started on,
  but an inbox conversation *is* the agent.
- **An agent has two permission modes**, `auto` and `bypassPermissions`, and
  `PERMISSION_MODES` in `agents.ts` is the whole list. A thread you are sitting
  in front of can stop and ask; an agent works while you are not watching, so a
  mode that asks for every edit is a mode nobody can use. `auto` reaches the
  Claude SDK as `acceptEdits` — the SDK has no `auto`, and passing it through
  silently means asking for everything.
- **Remy has an agent of its own.** `remy-agent`, seeded by `seedRemyAgent`, and
  the only agent with `builtIn`. Its name, handle, role and instructions come
  from `remy-agent.ts` and are re-synced on every boot, so an upgrade can teach
  it something new; `updateAgent` refuses those fields from a client and
  `deleteAgent` refuses it altogether. What it thinks with is a choice, made in
  its settings in the inbox, and it follows the machine default until it is
  made.
- **Remy says one thing to a new install.** `announcements.ts` is an append-only
  list; a machine that has never run it is greeted and every other entry is
  marked said, so installing after ten releases is one message rather than ten.
  Every release after that lands one message when it lands. Never edit or remove
  a delivered entry's id — delivery is remembered by it.
- **A Remy tool says what it made.** `ok(text, artifact)` appends a
  `<remy-artifact>` marker that `takeArtifacts` lifts back off in
  `applyToolOutput`, so the feed draws a ticket, a thread or a workspace as a
  card that opens it. The marker rides inside the tool's own text because a
  transcript is the one thing all three providers write down the same way; add
  it on both `ticket-tools.ts` and `ticket-mcp.ts`, never on one.
- **A control that goes somewhere gets the hand.** `data-link` (with `a[href]`
  and `role="link"`) is what `index.css` gives `cursor: pointer`; a button that
  acts on what is already in front of you keeps the arrow. Mark navigation with
  the attribute rather than a `cursor-pointer` class.
- **The `remy` MCP is the agent's control surface.** Claude gets the in-process server in `server/src/ticket-tools.ts`; Codex and Cursor get the STDIO server in `server/src/ticket-mcp.ts`. Every tool exists on both paths. A normal thread may orchestrate only the operations allowlisted by `isRemyToolRoute`; add each new capability to the smallest explicit route and method set, derive its thread, device and actor from the capability where relevant, and test both an allowed route and a neighbouring forbidden one. STDIO providers receive the HMAC capability from `remyToolToken` through inherited environment variable names, never `config.token` or another daemon-wide credential. `create_routine` exists only in an agent's Inbox conversation; ordinary Remy threads and separately installed external MCP clients never receive it. "Work on REMY-1" is resolved and linked before the model sees the prompt; a key that does not exist in Remy's board is not invented.
- **Every provider keeps a live conversation.** A Claude thread holds one SDK query process across turns; a Codex thread holds one `codex app-server` JSON-RPC connection; a Cursor thread holds one `agent acp` connection through the official Agent Client Protocol SDK. They can stop mid-turn for approvals and questions, stream tool progress, interrupt the active turn, and resume their own provider transcript after a restart. Cursor models come from `agent --list-models`, and its current default comes from `agent about`; do not replace ACP with the older headless JSON stream. Never quietly grant what a person would have been asked about.
- **Workspace environments belong to the repository, not one clone.** Values are encrypted at rest per machine and sync only through the signed daemon-to-daemon environment channel. Management APIs return names and configured state, never values, and agent capabilities cannot call them. Providers do not inherit workspace values; `remy.run_with_environment` starts a separate command with the active environment and redacts exact values before its result reaches the provider or Remy's transcript. Do not add a value-listing tool or put these values in provider arguments, prompts, logs, diffs, commits, or commit messages. Exact redaction cannot recognise encoded or transformed forms, so keep that limitation visible anywhere the guarantee is described.
- **Pairing lives in the daemon**, in the `peers` table — not in any client, so one pairing serves the desktop app, the browser and the phone. A client reaches a paired machine through `/peers/:id/api/...` on its own daemon, which is the only side holding that machine's token. `GET /server/identity` is how a machine introduces itself; `tailscale serve` is the only way in, so the daemon's bind stays on `127.0.0.1`, and `PATCH /server/identity {exposed}` is the switch for it.
- **The iPhone app is a client of a Mac**, never a daemon of its own. It pairs with `remy://configure?url=&token=` from Settings → Devices and reaches every other machine through that Mac.
- **Two machines pair by asking, not by carrying a token.** `tailnet.ts` lists your devices from `tailscale status --json` and probes each for Remy — an un-tokened `/health` answers **401**, which is the positive signal. `pairing.ts` then runs the ask: one side shows a six-digit code, a person on the other compares it and allows. `/pair/request` and `/pair/status` are **the only unauthenticated routes** in the daemon, because a machine that has never paired holds no token; they disclose nothing but an opaque request id, change nothing without human approval, are capped and single-use, and are reachable only over your own tailnet. Do not add a third.
- **The board converges, it is not copied.** Peers exchange `board_log` events against a version vector (`versionVector`, `eventsSince`, `mergeRemote` in `board-log.ts`), then replay every `reprojectAll`. A merged event keeps the device and lamport it was written with — those two are its place in the order. One high-water mark per device, never a single cursor: a peer can merge a third machine's older event after you last pulled.
- **A routine belongs to an agent, not a ticket.** It is created conversationally when the person asks that agent for repeated work, then managed in that agent's settings. The machine on the create event owns the clock so paired machines do not trigger it twice; each trigger tries the current device preference order and sends the prompt to the first device that can run the agent. It writes no ticket and needs no workspace. The old `recurrences` projection remains only as compatible storage, and older recurring-ticket events stay inert rather than becoming routines.
- **Device administration and device preference are separate.** The detailed Devices list always keeps this machine first so its settings are easy to find. A compact **Preferred device order** field owns the order used when agent conversations, routines, or other work can run on any available device.
- **The workspace agent is not a row.** `workspace` is an assignee like `you` is: it means the workspace's own default model with no persona in front of it, so work can be handed off before anybody has written an agent. `assignedAgent` in `agents.ts` is what turns either into something that can run a turn; no agent may take the handle.
- **Notifications are addressed, not broadcast.** The machine that raises one decides where it goes: `notifySelf` for itself, a `notify` flag per peer. A forwarded notification is always shown by whoever receives it. When no window is open, `notifySelf` falls through to Apple Push for iPhones registered on that daemon (`~/.remy/apns.json`).
- **Commit subjects** are a sentence in the imperative with no prefix or scope tag: "Store chats in SQLite instead of a file each". PRs land squashed with the `(#n)` suffix.
- **Version** is `{major}.{minor}.{run}`, where the run number comes from CI. Do not bump `version` in `package.json` by hand.

## Prerequisites

Node 22.5+ for `node:sqlite`, `git`, `gh` authenticated for pull requests, at least one of Claude Code, Codex, or Cursor Agent, and `tmux` for the older session remote. Tailscale only if another device needs to reach the daemon. Xcode and an Apple Push key in `~/.remy/apns.json` for the iPhone app.
