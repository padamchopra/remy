# Remy — agent guide

Remy runs [Claude Code](https://claude.com/claude-code), Codex, and Cursor threads on your computers or on hosted cloud computers, and you follow them from one place:

- **The web app** at `app.tryremy.dev` is the only client. It is `web/`, served with its API by the hub under `hub/`, which holds accounts, organizations, and computer registrations. Organizations are optional.
- **The daemon and the `remy` CLI** (`server/`) are how a computer joins it. `remy login` signs a Mac or Linux machine into an account and `remy start` keeps its daemon connected to the hub (`server/src/hub-computer.ts`); the daemon runs threads in the repositories on that machine.

On a computer you connect, repositories and provider sessions stay on that computer. The daemon binds `127.0.0.1` and connects out to the hub, which keeps a bounded mirror of thread snapshots for live delivery and offline reading (`hub/docs/threads.md`). A hosted computer runs its repository in the cloud.

The Electron desktop app, the iPhone app, and the web UI's local mode — a browser window that talked straight to one daemon's `/api` — are all off `main`. Electron lives on the long-lived `padam/desktop-electron-9236` branch and the Expo app on `padam/mobile-expo-b423`; do not reintroduce `desktop/`, `mobile/`, an Electron bridge in `web/`, a DMG, an Expo build, or a browser shell against a daemon here. `main` is the web app, the hub, the daemon, and the CLI.

`README.md` is the product story. This file is how to work in the code.

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`; both stay in sync.

## Running it locally

Once: `npm run install:all` — contract, hub, server, web.

For full-stack iteration, `npm run dev:local` runs this checkout's web app on 5175, hub on 5184, and a separate computer on 8421. It requires the one-time approved development identity and production bridge deployment described in `hub/docs/local-development.md`. Production retains account connections; mutable threads and execution stay local. Never substitute `--isolated` for verification of real account reuse. Keep the existing hosted preview and computer untouched. Restart for backend changes and refresh for frontend changes.

For UI iteration against the deployed hub, `npm run dev:hosted` serves this checkout's `web/` at `http://127.0.0.1:5174` against your live hosted account. Open `127.0.0.1`, not `localhost`: the backend's origin allowlist names that exact address, and the preview redirects `localhost` there. Both development modes use the web app through a hub. There is no browser shell against a daemon: `dev:mac-browser`, `dev:web` and `qa:web` are gone. Never substitute the production website or sample QA state for a requested local hosted preview with live data.

Hosted preview sign-in uses **Sign in with Remy → Approve in Remy → Finish signing in** when you are at the keyboard. Agent-driven hosted QA signs in with the production email and password from `REMY_QA_EMAIL` and `REMY_QA_PASSWORD` on `dev:hosted` and `app.tryremy.dev`. Create that password on `app.tryremy.dev` with **Create your account**; there is no reset form. Fixture data and captured-mail hub sessions are not a substitute when testing hosted start, organizations, computers, or providers. If either secret is missing, fail with `set REMY_QA_EMAIL and REMY_QA_PASSWORD`. The production page is only the approval handoff for the device-code path; return to `http://127.0.0.1:5174` to use the changed UI. Its actions affect the live account. Preview credentials stay in the local Vite process and are forgotten when it stops. The configured preview port is part of the backend's exact origin allowlist; do not rewrite Origin headers or turn off origin checks. `hub/docs/web.md` documents authentication and backend selection.

Verify the opened shell, not only a responding port: it shows account sign-in or personal/organization navigation. Keep the requested preview running for the user.

The page does not live-reload. Refresh it to see a change: editing Remy while watching Remy meant every save yanked the window out from under whatever was on screen.

**Daemon and hub changes** — run the current `server/dist` as a computer attached to a disposable hub that serves the current web app:

```sh
npm run build --prefix server
npm run build --prefix web && npm run build:website --prefix web && node web/scripts/assemble-hub.mjs
QA_HUB_WEB=1 QA_COMPUTER_POLICY=1 node hub/scripts/qa-threads.mjs
```

It prints `QA_SESSION` (a session file with test-only tokens; never upload it), `QA_HUB` (the hub URL, which also serves the app) and `QA_ROUTE`. Drive the app at `QA_HUB` with a scenario such as `QA_SESSION=<file> QA_WEB_URL=<hub URL> node web/scripts/qa-hub-threads.mjs`. The hub is real Workers, D1, R2, authentication and computer sockets on loopback; only the language-model provider, email and the QA secret store are fixtures. Its computer strips inherited `REMY_*` and `MC_*` values and keeps its state in a temporary directory, so it never touches the daemon on `127.0.0.1:8420` or `~/.remy/remy.db`. Stop the command to remove that state. `hub/docs/web.md` has the other scenarios. `assemble-hub.mjs` rewrites `web/dist` into the deployed layout, with the app under `app/`; the hub needs it.

Test pull requests, reviews and the review agent on this local QA hub against a real sandbox repository: put `QA_GITHUB_REPOSITORY` and `QA_GITHUB_TOKEN` (and optionally `QA_GITHUB_REVIEWER_TOKEN` and `QA_LINEAR_TOKEN`) in the git-ignored `hub/.qa.env`. The workspace becomes a clone of the sandbox, Ada and Grace get those tokens as their GitHub connections, and a test pull request is opened when none is open. The fixture model drives the review agent's real tools; `QA_REAL_PROVIDERS=1` swaps in this Mac's signed-in providers, which agent-driven QA does not use. `QA_ENV_FILE=0` ignores the file for fixture-only scenarios. `hub/docs/web.md` (**Real GitHub, Linear and models**) has the scopes and what each variable does.

Leave the daemon on port 8420 running. Never stop it from a thread it is hosting.

Skip `VITE_MC_FIXTURE=1`; that is fake data, not your real state.

## Layout

| Path | What it is |
|---|---|
| `web/` | The web app. React 19, Tailwind v4, [shadcn/ui](https://ui.shadcn.com) in `web/src/components/ui` (still largely New York / Radix; **new work and redesigns use Base UI**), Zustand store in `web/src/state`. |
| `hub/` | The hosted backend on Cloudflare Workers: accounts, organizations, computer registrations and the thread relay. `hub/docs/` describes each path. |
| `server/` | The daemon and the `remy` CLI, which connect a computer to the hub. Node and TypeScript, binds `127.0.0.1` only, SQLite at `~/.remy/remy.db` through `node:sqlite`. Threads run on the Claude Agent SDK, Codex app-server, or Cursor ACP — see **Providers**. |
| `deploy/` | Optional launchd login item and provider hooks. |
| `.agents/skills/` | House rules. Read the one that covers what you are about to change. |

`web/vite.config.ts` serves `dev:hosted`, which uses `web/hosted-preview.ts` to proxy its approved hosted session. The credential never reaches the page. The website's product preview (`web/website/demo`) draws the shared thread components from `web/src/state/store.ts` with sample state and swaps `web/src/lib/transport.ts` for its own demo transport.

## Skills

`.agents/skills` holds the conventions reviews are held to. When the user highlights one that belongs there, capture it in the same change — see **`skill-capture`**.

`.claude/skills` is a symlink to this directory so Claude and other agents discover the same skills. Add each skill only under `.agents/skills`; do not add per-skill Claude links.

- **`ui`** — layout and keyboard. Every control comes from a shadcn primitive; a custom `div` is the last resort. New surfaces and redesigns use Base UI, not Radix.
- **`content`** — every user-facing string. Second person, present tense, one short sentence.
- **`product-design`** — ownership, settings placement, defaults, actors, and deletion behavior. Read it before shaping a capability or integration.
- **`distributed-state`** — complete read, write, live-update, and reconnect paths across devices and process boundaries.
- **`performance-diagnosis`** — measure request, payload, render, and freshness waits before choosing a fix.
- **`mockups`** — the Paper file: the `System` page owns colour, the `Sidebar` page owns the app chrome, and a feature page clones it rather than redrawing it.
- **`qa`** — after an interaction or server behavior change, drive the current code in the running app before calling it done.
- **`pr-author`** — every PR carries proportional reviewer evidence and reads in one screen; screenshots or recordings are required only for behavior a reviewer can exercise or judge in the running app.
- **`skill-capture`** — when the user highlights a durable convention, write it into `.agents/skills/` in the same change.
- **`shadcn`** and **`migrate-radix-to-base`** — vendored from `shadcn/ui` and tracked in `skills-lock.json`. Do not hand-edit them.

**Base UI for new work:** New UI surfaces and redesigns use Base UI (`@base-ui/react` / shadcn base style). Do not add new Radix-based primitives or redesign existing ones onto Radix. Migrating an existing Radix surface is a redesign — use Base UI and follow `.agents/skills/migrate-radix-to-base`. Existing Radix/shadcn New York surfaces may remain until they are redesigned.

## Terminology

The code and the person do not always use the same word. Where they differ, the
code's word is the one in types, tables and routes; the person's word is the one
in **every string anybody reads** — a label, a menu item, an empty state, an
error, a toast, a pull request comment. Getting this wrong is the most repeated
mistake in this repo, so check the table before naming anything.

| The code says | A person reads | Because |
|---|---|---|
| `project` | **workspace** | A project is the repository, keyed on its origin remote so two machines land on the same one. A workspace is one machine's folder holding it. Nobody adds a project — they add a folder, so that is the only word the UI uses. |
| `chat` | **thread** | A conversation you have in a workspace. The API, the database and the code all still say chat. |
| `server`, `device`, `runner` | **computer** | A machine running Remy or a hosted computer that can run threads. |

Nothing a person reads says project, job, workflow, cron, daemon, projection,
runner, fold, board log, lamport or event. Agents, routines, routing and Tasks (the
board and its tickets) were removed from the product, so nothing anybody reads
mentions those either. The one exception is **review agent**: the thread
that reviews a pull request is called the review agent in everything a person
reads about it (Review with agent, Review agent, Send to review agent), because
that is the name the person asked for. It is a thread with a pull request
attached, not a return of Agents: no roster, no persona, no settings of its own
beyond your review rules. Linear stays: a thread reaches it through each person's
own Linear account. Machine is
fine — the app says "this machine" — and so is worktree, which is a git word
anyone using worktrees already has.

## Keeping the website current

Assess website impact for every feature, behavior change, removal, and fix. Update affected public content in the same change, or record a brief reason in the PR when no website update is needed. This is a review convention, not an automated check.

| What changes | What to update |
|---|---|
| A major, broadly useful capability changes why someone chooses Remy | Consider the homepage's feature showcase or gallery; update relevant guides and release notes. |
| A smaller user-visible feature, improvement, or meaningful fix | Add a concise changelog entry and update affected documentation; do not add a homepage showcase by default. |
| Installation, connecting a computer, supported providers or platforms, availability, pricing, or security behavior | Correct every affected claim, download link, setup guide, FAQ, and screenshot, including on the homepage regardless of change size. |
| Refactoring, tests, tooling, or dependency maintenance with no user-visible effect | No public website entry is needed. |

The website lives in `web/website/`; build it with `npm run build:website`. Production serves the website at `tryremy.dev` and the app at `app.tryremy.dev`. The hub deployment uses `npm --prefix web run build:hub` to package both; verify the public home page and its Open Remy destination after deploying, not just `/health`. Product previews import the app’s components and styles with sample state through the website-only transport. Keep those imports shared; do not replace them with screenshots or copied product markup. Update sample scenarios when the behavior they demonstrate changes, and run `node web/scripts/website-check.mjs` and `node web/scripts/website-performance.mjs` against the built site. Feature selection must update the mounted preview’s sample state without reloading its document; preserve the startup handshake and verify first and repeat switches.

The homepage is a curated product story, not a release feed. Promote a capability only when it enables a distinct, important use case, benefits a broad audience, and can be demonstrated clearly. Prefer refreshing an existing section over adding another. A small addition to an existing capability usually belongs in its guide or release notes.

The changelog is one supporting surface; keep feature guides, setup documentation, FAQs, and download information accurate too. Describe the user benefit, group related changes, and link to details rather than reproducing commits. Keep unreleased work explicitly unreleased; use real release versions and dates only when confirmed. Never advertise planned or gated capabilities as generally available.

Check removals and changed defaults for stale promises. Screenshots and demos must match the behavior they illustrate and use safe sample content. Keep what a connected computer does and what a hosted computer does distinct, and keep organizations described as optional. Verify links and review affected desktop and phone layouts before shipping website changes. Test real touch gestures through the page, including over embedded previews; `scrollTo` and viewport resizing alone do not prove that a phone can scroll. Keep the app’s viewport and scroll-lock rules inside the demo, and let the marketing document own page scrolling.

## Checks

```sh
npm run typecheck    # contract + hub + web
npm test             # contract; server: tsc, then node --test on dist/*.test.js
npm test --prefix hub
npm run shots        # Playwright PNGs of dev:hosted, or MC_URL=<another URL>
npm run live-check   # assert that page is showing threads
npm run bundle       # what a cold start downloads, and what waits for a first open
npm run build        # the web app
QA_HUB_WEB=1 QA_COMPUTER_POLICY=1 node hub/scripts/qa-threads.mjs  # current daemon + web app on a disposable hub
```

`.github/workflows/web.yml` is the Web job: it builds with `build:hub`, serves `web/dist` with `web/scripts/serve-hub.mjs`, and runs `hosted-runtime-check.mjs` (and its `QA_*_ONLY` variants), `workspaces-load-check.mjs`, `pull-request-tile-check.mjs`, `hub-website-check.mjs`, the website checks, and a list of `node --test` files. On another port, set `WEBSITE_URL` and `WEBSITE_APP_PREFIX=/app`.

A server module opens its database at import time, so a test that touches state points `MC_CONFIG_DIR` (or `HOME`) at a `mkdtempSync` directory **before** the dynamic `await import(...)` of the module under test — see `server/src/chat-storage.test.ts`. A static import runs first and would open the real `~/.remy/remy.db`. `node:test` gives each file its own process, so the override cannot leak sideways.

## Conventions

- **A highlighted house rule lands in a skill in the same change.** When the user points at something that can be added to an existing skill under `.agents/skills/`, or that needs a new skill file, write it down before the change is done. `skill-capture` is when to edit versus create; do not defer it, and do not add a skill for a one-off bug.
- **Comments** explain why, not what, and use `///` on exported declarations. Match the density of the file you are in; the codebase is sparse.
- **No shell strings.** The server reaches `git`, `gh`, and `tmux` through `execFile` with an argument array. Never build a command line, and never interpolate a path or a branch name into one.
- **Loopback only.** The daemon binds `127.0.0.1` behind a bearer token and reaches the hub over its own outbound connection. Do not widen the bind.
- **Config lives in the database** — the `kv` table in `~/.remy/remy.db`, read through `server/src/config.ts`. A new setting is a key on `Config`, a line in `publicSettings`, and a validated branch in `patchSettings`; the daemon serves it at `/server/settings`. `~/.mission-control` is the legacy directory, honoured when `~/.remy` is absent.
- **Where the window is lives in the URL**, parsed and formatted by `web/src/lib/route.ts`. The web app uses clean paths with a server-side app-shell fallback, and an older `#/` link is rewritten to its path. The website's product preview, which has no hosted runtime, keeps routes in the hash. Shared navigation goes through `navigateLocation` so each surface uses its valid form. All is the default account view and adds no query parameter; a narrower account writes `organization` explicitly. A hosted thread is `/threads/<id>` only.
- **Worktrees** Remy creates go in a `.remy` folder, inside the workspace or under the `worktreeRoot` setting, hidden by a rule in the repo's `.git/info/exclude` — per-clone and never committed, so no tracked `.gitignore` changes. Worktrees already checked out elsewhere are left where they are.
- **The words a person reads** are not always the words the code uses — see **Terminology** above, and check it before naming a label, an error or an empty state.
- **Base UI for new work.** New UI surfaces and redesigns use Base UI (`@base-ui/react` / shadcn base style). Do not add new Radix-based primitives or redesign existing ones onto Radix. Migrating an existing Radix surface is a redesign — use Base UI and follow `.agents/skills/migrate-radix-to-base`. Existing Radix/shadcn New York surfaces may remain until they are redesigned.
- **A provider and a model are one choice.** `server/src/providers.ts` is the only list of what a thread may run on; `config.ts` and `chat.ts` validate against it, `GET /server/providers` serves it with what the machine actually has installed, and every model picker in the window is `ModelPickerButton` from `web/src/components/ModelPicker.tsx` — one popover beside its button, with a tab per provider that can run — never a second model list. Moving to another provider takes the model to that provider's default rather than keeping one it would refuse.
- **Threads are the product; nothing displaces them.** The sidebar's thread
  list is on screen in every section, and a thread is always one click away.
  A new section brings its own lists into the main pane — never by taking the
  sidebar over, and never behind a step that hides what is running. Anything
  that would make a thread harder to reach is the wrong shape, however good the
  new thing is.
- **A closed work surface is not downloaded.** The browser, the terminal, a
  pull request and its diff, the insight tools, and every section outside
  threads reach the window on first open, through `lazy` and the `Deferred`
  wrapper in `web/src/components/Deferred.tsx`. Opening one latches it: it stays
  mounted from then on, so hiding its pane never takes a running browser,
  terminal, or half-written review with it, and the second open waits for
  nothing. A placeholder fills the box the surface will fill, so nothing moves
  when the code lands. Keep a lazy module's light parts — a header button, the
  hook holding its state, a label helper — out of it, or the import that draws
  the button drags the surface back into the first load. `npm run bundle` says
  what is in the first load.
- **A desktop thread is a workbench of tabs.** Everything open for a main thread — its transcript, each subthread, each tool — is a tab in that thread's collection (`web/src/lib/thread-workbench.ts`), shown as a strip or as panes side by side, and never mixed with another main thread's. A tool opened from the transcript lands beside it; a tab stays mounted behind the one in front, so a terminal keeps its shell. The layout is remembered per thread on this device, and the URL names only the thread in front. The transcript stays a narrow, identity-light reading column.
- **A person starts every thread.** There is no roster of personas, no
  conversation outside a workspace, and no schedule that sends work on its own.
  A thread is work in a repository, started by someone, running on a provider.
  Do not reintroduce Agents, Routines, Routing or an Inbox as product surfaces.
- **A Remy tool says what it made.** `ok(text, artifact)` appends a
  `<remy-artifact>` marker that `takeArtifacts` lifts back off in
  `applyToolOutput`, so the feed draws a thread or a workspace as a card that
  opens it. The marker rides inside the tool's own text because a
  transcript is the one thing all three providers write down the same way; add
  it on both `ticket-tools.ts` and `ticket-mcp.ts`, never on one.
- **A control that goes somewhere gets the hand.** `data-link` (with `a[href]`
  and `role="link"`) is what `index.css` gives `cursor: pointer`; a button that
  acts on what is already in front of you keeps the arrow. Mark navigation with
  the attribute rather than a `cursor-pointer` class.
- **The `remy` MCP is a thread's control surface.** Claude gets the in-process server in `server/src/ticket-tools.ts`; Codex and Cursor get the STDIO server in `server/src/ticket-mcp.ts`. Every tool exists on both paths. A thread may orchestrate only the operations allowlisted by `isRemyToolRoute`; add each new capability to the smallest explicit route and method set, derive its thread, device and actor from the capability where relevant, and test both an allowed route and a neighbouring forbidden one. STDIO providers receive the HMAC capability from `remyToolToken` through inherited environment variable names, never `config.token` or another daemon-wide credential. The files keep their `ticket-` names because installed provider configs point at `dist/ticket-mcp.js`; Remy has no ticket tools. Linear issues are Linear's: a thread reads them through Linear's hosted MCP with the person's own token (`linear-session.ts`), not through a Remy tool.
- **Every provider keeps a live conversation.** A Claude thread holds one SDK query process across turns; a Codex thread holds one `codex app-server` JSON-RPC connection; a Cursor thread holds one `agent acp` connection through the official Agent Client Protocol SDK. Hosted Cursor Cloud threads use the Cursor SDK cloud VM instead of ACP. They can stop mid-turn for approvals and questions, stream tool progress, interrupt the active turn, and resume their own provider transcript after a restart. Cursor models come from `agent --list-models`, and its current default comes from `agent about`; do not replace ACP with the older headless JSON stream. Never quietly grant what a person would have been asked about.
- **A workspace has one environment.** It is a list of values on the workspace's page — no named environments, no assignments, no Settings section. Each value is a variable (readable) or a secret (write-only: no browser ever gets it back), and Workspace or Personal. Workspace values reach every thread in that workspace whoever starts it, and anyone who can use the workspace sees, adds and removes them. Personal values belong to their creator alone and reach every thread that person starts, in any workspace and organization, on any computer; they are stored per person, never listed to or delivered for anyone else. A Workspace value wins over a Personal one with the same key. The hub sends each thread its merged environment with every start and message (`hubEnvironment` in `dispatchComputer`); computers keep no copy of their own. Cloud and model-access keys on Computers follow the same rule: values are encrypted at rest and management APIs return names and configured state, never values; the `remy` MCP cannot manage them. An account can keep multiple named Fly.io, OpenRouter, and other integration keys; execution uses the active key. Restart a provider session when its environment changes. Keep values out of arguments, prompts, logs and snapshots. Exact output redaction cannot recognise encoded or transformed values and cannot prevent a provider or command from reading its inherited environment; keep that limitation visible anywhere the guarantee is described.
- **A computer talks only to the hub.** Daemons do not pair, sync with or proxy to each other, and nothing serves a daemon on the tailnet; the daemon has no `/peers`, `/pair/*`, `/server/identity`, `/tailnet` or `/push/*` routes and no Apple Push. `board_log` holds only this computer's project events, which workspaces and environments fold from, and its `deviceId` is the computer id on the hub. Shape multi-computer work on hub computers, organizations and grants.
- **Which computer a thread runs on is a choice, not a rule.** The person picks it in the composer, or Remy takes the one they last used for that workspace; `chooseComputer` in `hub/src/computer-choice.ts` is that decision. There is nothing to configure, so do not add a rules table, a resolver endpoint, or a settings section for it.
- **Notifications are addressed, not broadcast.** A computer sends a thread's notification to the hub, which derives its recipients from the thread's owner and participants and checks their access again before delivery (`hub/docs/computers.md`).
- **Commit subjects** are a sentence in the imperative with no prefix or scope tag: "Store chats in SQLite instead of a file each". PRs land squashed with the `(#n)` suffix.
- **Version** is `{major}.{minor}.{run}`, where the run number comes from CI. Do not bump `version` in `package.json` by hand.

## Prerequisites

Node 22.5+ for `node:sqlite`, `git`, `gh` authenticated for pull requests, at least one of Claude Code, Codex, or Cursor Agent, and `tmux` for the older session remote.
