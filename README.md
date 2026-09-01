# Remy

Remy is a remote for [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex), and [Cursor](https://cursor.com/docs/cli/acp) on your own machines. Point it at a folder, say what you want done, and the agent runs on the Mac that actually holds the repo — while you watch from the desktop app, a browser tab, or the iPhone app on the couch.

<img src="docs/images/threads.png" alt="Remy showing four threads across two machines, with a composer for a new one" width="100%" />

## Wait, where does my code go?

Nowhere. That is the whole point.

Remy is a daemon on your machine plus a window onto it. Your repos are never uploaded, never cloned to a server, never sent through anybody's API but the one you picked the thread to run on — the same call Claude Code, Codex, or Cursor already makes when you run it in a terminal. The daemon listens on `127.0.0.1` and nothing else. When you want to reach it from another device, that goes over [Tailscale](https://tailscale.com), which is your own private network, not the public internet.

There is no account, no sign-up, and no hosted anything. If this repo disappeared tomorrow your copy would keep working.

## Try it

You need a Mac that can stay awake, with at least one provider installed: [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex), or [Cursor Agent](https://cursor.com/docs/cli/installation). Those are what actually run your threads, so Remy is only as capable as the copy sitting next to it.

**Install the app.** Grab the newest DMG from [Releases](https://github.com/padamchopra/remy/releases) and drag it to Applications. It is signed and notarized, so it just opens. The DMG carries both the window and the daemon — opening Remy starts everything, quitting it stops everything, and it brings its own Node.

**Or run it from source** (Node 22.5+, for `node:sqlite`):

```sh
git clone https://github.com/padamchopra/remy
cd remy
npm run install:all
npm run dev:web
```

Then open `http://127.0.0.1:5173`. That is the real app against your real folders, not a demo.

> [!NOTE]
> The page does not live-reload — refresh it after a change. Editing Remy while watching Remy meant every save yanked the window out from under whatever was on screen.

## What you actually do with it

Start a thread in a workspace, pick a model and how much the agent may do unasked, and send. A folder with git worktrees lets you branch on send rather than beforehand. Threads that stop to ask you something say so in the sidebar, so a machine working on four things at once has one queue instead of four windows.

Workspace settings can hold named environments that sync across your paired devices. Values are encrypted on each machine and stay out of Claude, Codex, and Cursor themselves; an agent can run a separate, approval-gated command with the active environment, and Remy removes exact values from its output, changed text files, staged diffs, and commit messages before the agent continues. Encoded or transformed values cannot be recognised, so this is protection against accidental disclosure rather than a boundary against a hostile command.

`⌘K` gets you anywhere, and tells you which threads need you.

<img src="docs/images/palette.png" alt="The command palette listing threads that need you and threads still working" width="100%" />

**Inbox** is your agents. Each one is a conversation you can pick up: ask Remy's own agent to write a ticket, add a workspace, or start a thread somewhere, and it does it while you watch. Write more agents there, each with its own instructions and its own model. Ask an agent to do something routinely and it keeps that routine in its settings, running each time on the first available device in your preferred order — every fifteen minutes, or once a week, whichever the work wants. Give an agent directives and every task it runs starts knowing how you build and test.

**Tasks** is for planning rather than chatting: a board of tickets, agents with their own instructions, and a handoff from one to the next. Agents sign their commits, so `git log` says which one wrote what. A ticket can be yours, an agent's, or the workspace's own model — an assignee you get without writing an agent first.

<img src="docs/images/tasks-board.png" alt="The Tasks board, tickets in columns with an assignee on each card" width="100%" />

## Add your other machines

Remy is built for more than one machine. A desktop that holds the big repos, a laptop you carry, both on your tailnet.

On each machine, open **Settings → Devices** and turn on **Reachable from your other machines**. That runs `tailscale serve`, which is what lets anything reach the daemon at all — it binds loopback on its own.

Then, on either machine, look under **On your tailnet**. Remy already knows your devices and has checked which of them are running it, so you pick one and press **Pair**. Both machines show a six-digit code; if they match, press **Allow** on the other one. Nothing is shared until you do.

From then on the two share a planning board — tickets and agents converge on both without either being in charge. Threads stay put, on the machine holding the repo.

If a machine is somewhere Tailscale is not, **Pair with a link instead** takes a `remy://configure?…` link you copy from the other side.

## On the iPhone

The same remote, in your pocket. Pair it from **Settings → Devices**.

<p>
<img src="docs/images/phone-pair.png" alt="Pairing the iPhone app with a Mac" width="280" />
<img src="docs/images/phone-threads.png" alt="The iPhone app with its sidebar open on a new thread" width="280" />
</p>

## Where notifications go

Every device card has a **Notifications** switch, and it means: when a thread on *this* machine needs you, tell *that* device. Turn on the ones you want. Turn off the machine you never sit at.

When a window is open, notifications are banners. When none is, they go to your iPhone through Apple Push. Pair the iPhone app from **Settings → Devices**, and put your APNs key in `~/.remy/apns.json` (see `deploy/apns.json.example`).

## Some notes

This is early, and built for one person's setup first. Expect rough edges.

- **macOS only** for now. The daemon is Node and would likely run elsewhere; nobody has tried.
- **The iOS app** in `mobile/` is a React Native remote. It cannot run threads on its own — pair it with a Mac from Settings → Devices.
- **Stay awake** prevents *idle* sleep. Closing a MacBook lid is a different thing and can still sleep the machine.
- **Repos on an external drive** need Full Disk Access for Remy, in System Settings → Privacy & Security.
- **Running a 1M context window?** Transcripts do not record the window size, so set `contextLimit` if the meter looks wrong.

## Going further

- **[AGENTS.md](AGENTS.md)** — how the code is laid out and how to work in it.
- **[RELEASING.md](RELEASING.md)** — signing and notarizing a Mac build.
- **[SECURITY.md](SECURITY.md)** — the security posture, and how to report something.
- **`deploy/setup.sh`** — run the daemon as a login item, so it keeps working after you quit the app.
