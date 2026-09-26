# Remy

Remy is a remote for [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex), and [Cursor](https://cursor.com/docs/cli/acp) on your own machines. Point it at a folder, say what you want done, and the work runs on the machine that actually holds the repo — while you watch from a browser tab anywhere.

<img src="docs/images/threads.png" alt="Remy showing four threads across two machines, with a composer for a new one" width="100%" />

## Wait, where does my code go?

Nowhere. That is the whole point.

Remy is a daemon on your machine plus a page onto it. Your repos are never uploaded, never cloned to a server, never sent through anybody's API but the one you picked the thread to run on — the same call Claude Code, Codex, or Cursor already makes when you run it in a terminal. The daemon listens on `127.0.0.1` and nothing else. When you want to reach it from another device, that goes over [Tailscale](https://tailscale.com), which is your own private network, not the public internet.

There is no account, no sign-up, and no hosted anything. If this repo disappeared tomorrow your copy would keep working.

## Try it

You need a Mac or Linux machine that can stay awake, with Node 22.5+ (for `node:sqlite`) and at least one provider installed: [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex), or [Cursor Agent](https://cursor.com/docs/cli/installation). Those are what actually run your threads, so Remy is only as capable as the copy sitting next to it.

**Install the CLI.** A machine you reach over SSH has nowhere to open an approval page, so it signs in with a key instead. Install the `remy` command, then create a connection key in Remy on the web under **Settings → Computers → Connected**:

```sh
npm i -g @padamchopra/remy
remy login remy_…   # the command that page gives you
remy start          # keeps this computer available
```

`npx @padamchopra/remy` runs the same command without a global install. `remy update` (or `remy update --yes`) installs the latest published CLI. `remy status` says what it is connected to and `remy logout` disconnects it. Remy still listens on `127.0.0.1`, and another device reaches it over your tailnet.

**Or run the web app from source**, against your Remy account:

```sh
git clone https://github.com/padamchopra/remy
cd remy
npm run install:all
npm run dev:hosted
```

Then open `http://127.0.0.1:5174` and sign in. That is this checkout's web app against your live account and computers, not a demo.

> [!NOTE]
> The page does not live-reload — refresh it after a change. Editing Remy while watching Remy meant every save yanked the window out from under whatever was on screen.

## What you actually do with it

Start a thread in a workspace, pick a model and how much it may do unasked, and send. A folder with git worktrees lets you branch on send rather than beforehand. Threads that stop to ask you something say so in the sidebar, so a machine working on four things at once has one queue instead of four windows.

A thread runs on the computer you pick, or on the one you last used for that workspace — there is nothing to configure.

Settings → Environments lets you define reusable values and assign one environment to several workspaces. Tasks inherit the selected values on their execution computer, including local computers and optional hosted task computers. Values are encrypted at rest and management screens return names only. Providers and their commands can read assigned values. Remy redacts exact values from supported output paths, but encoded or transformed values are not recognised; this is not a boundary against a hostile command.

`⌘K` gets you anywhere, and tells you which threads need you.

<img src="docs/images/palette.png" alt="The command palette listing threads that need you and threads still working" width="100%" />

**Tasks** is for planning rather than chatting: a board of tickets, each one a piece of work you can start a thread on. A ticket follows the thread working on it, so the board moves without you dragging cards.

<img src="docs/images/tasks-board.png" alt="The Tasks board, tickets in columns" width="100%" />

**Pull requests** are the other side of that. Open one from the thread that wrote it, read its checks and comments beside the conversation, and have Remy follow it in that thread — or in no thread at all.

## Add your other machines

Remy is built for more than one machine. A desktop that holds the big repos, a laptop you carry, both on your tailnet.

On each machine, open **Settings → Devices** and turn on **Reachable from your other machines**. That runs `tailscale serve`, which is what lets anything reach the daemon at all — it binds loopback on its own.

Then, on either machine, look under **On your tailnet**. Remy already knows your devices and has checked which of them are running it, so you pick one and press **Pair**. Both machines show a six-digit code; if they match, press **Allow** on the other one. Nothing is shared until you do.

From then on the two share a planning board — tickets converge on both without either being in charge. Threads stay put, on the machine holding the repo.

If a machine is somewhere Tailscale is not, **Pair with a link instead** takes a `remy://configure?…` link you copy from the other side.

## Where notifications go

Every device card has a **Notifications** switch, and it means: when a thread on *this* machine needs you, tell *that* device. Turn on the ones you want. Turn off the machine you never sit at.

When a window is open, notifications are banners. When none is, they go to the paired computers that asked for them.

## Some notes

This is early, and built for one person's setup first. Expect rough edges.

- **The Mac app is off `main`.** Remy is the web app plus the CLI; the Electron window lives on the long-lived `padam/desktop-electron-9236` branch until that work comes back.
- **The iOS app** in `mobile/` is a React Native remote. It cannot run threads on its own — pair it with a computer running Remy from Settings → Devices.
- **Stay awake** prevents *idle* sleep. Closing a MacBook lid is a different thing and can still sleep the machine.
- **Repos on an external drive** need Full Disk Access for Remy, in System Settings → Privacy & Security.
- **Running a 1M context window?** Transcripts do not record the window size, so set `contextLimit` if the meter looks wrong.

## Going further

- **[AGENTS.md](AGENTS.md)** — how the code is laid out and how to work in it.
- **[RELEASING.md](RELEASING.md)** — what a release publishes, and what decides one.
- **[SECURITY.md](SECURITY.md)** — the security posture, and how to report something.
- **`deploy/setup.sh`** — run the daemon as a login item, so it keeps working after you close the terminal.
