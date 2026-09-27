# Remy

Remy runs [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex), and [Cursor](https://cursor.com/docs/cli/acp) threads on your own machines or on a cloud computer, and you follow them all from [Remy on the web](https://app.tryremy.dev). Pick a workspace, say what you want done, and the work runs on the computer that holds the repo — while you watch from a browser tab anywhere.

<img src="docs/images/threads.png" alt="Remy showing four threads across two machines, with a composer for a new one" width="100%" />

## Wait, where does my code go?

On a computer you connect, it stays there. The `remy` CLI runs a daemon on that machine; your repos are never uploaded or cloned to a server, and they reach no API but the provider you picked for the thread — the same call Claude Code, Codex, or Cursor already makes when you run it in a terminal. The daemon listens on `127.0.0.1` and nothing else, and connects out to your Remy account.

Remy on the web keeps your account, your organizations, and a bounded copy of each thread's recent turns so you can follow it live and read it while the computer is offline. A hosted computer is the other choice: it runs your repository in the cloud.

## Try it

You need a Mac or Linux machine that can stay awake, with Node 22.5+ (for `node:sqlite`) and at least one provider installed: [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex), or [Cursor Agent](https://cursor.com/docs/cli/installation). Those are what actually run your threads, so Remy is only as capable as the copy sitting next to it.

**Install the CLI.** A machine you reach over SSH has nowhere to open an approval page, so it signs in with a key instead. Install the `remy` command, then create a connection key in Remy on the web under **Settings → Computers → Connected**:

```sh
npm i -g @padamchopra/remy
remy login remy_…   # the command that page gives you
remy start          # keeps this computer available
```

`npx @padamchopra/remy` runs the same command without a global install. `remy update` (or `remy update --yes`) installs the latest published CLI. `remy status` says what it is connected to and `remy logout` disconnects it. Remy still listens on `127.0.0.1`; you reach it from Remy on the web.

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

Settings → Environments lets you define reusable values and assign one environment to several workspaces. Threads inherit the selected values on the computer that runs them, including local computers and optional hosted computers. Values are encrypted at rest and management screens return names only. Providers and their commands can read assigned values. Remy redacts exact values from supported output paths, but encoded or transformed values are not recognised; this is not a boundary against a hostile command.

Connect Linear in Settings → Connections and a thread can read and update your issues through Linear's own tools, signed in as you.

**Pull requests** sit beside your threads. Open one from the thread that wrote it, read its checks, files and activity, comment on GitHub, and send what needs work to the thread on its branch.

## Add your other machines

Run `remy login` and `remy start` on each one. They all appear under **Settings → Computers** in the same account, and each thread runs on the computer that holds its workspace. Share a computer with an organization there when other people should be able to start threads on it.

## Some notes

This is early, and built for one person's setup first. Expect rough edges.

- **Remy on the web is the only window.** The Mac app and the iPhone app are off `main`, and so is the browser window that talked straight to one computer's daemon. Open Remy in your phone's browser instead.
- **Stay awake** prevents *idle* sleep. Closing a MacBook lid is a different thing and can still sleep the machine.
- **Repos on an external drive** need Full Disk Access for Remy, in System Settings → Privacy & Security.
- **Running a 1M context window?** Transcripts do not record the window size, so set `contextLimit` if the meter looks wrong.

## Going further

- **[AGENTS.md](AGENTS.md)** — how the code is laid out and how to work in it.
- **[RELEASING.md](RELEASING.md)** — what a release publishes, and what decides one.
- **[SECURITY.md](SECURITY.md)** — the security posture, and how to report something.
- **`deploy/setup.sh`** — run the daemon as a login item, so it keeps working after you close the terminal.
