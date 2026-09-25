# Security model & review

Remy drives Claude Code (and leftover tmux sessions) on a personal machine that
may hold sensitive source and credentials, so the server is treated as
security-relevant even though it's only meant to be reachable by its owner.

## Threat model

- **Reachability:** the server binds to `127.0.0.1` only. The single path in
  from outside is `tailscale serve` (not funnel) — tailnet devices only,
  TLS-terminated, never the LAN or public internet.
- **Authentication:** a 256-bit random bearer token (`~/.remy/remy.db`,
  `chmod 600`), compared with `timingSafeEqual`, required on every request and
  on the WebSocket upgrade. Header only — never a query parameter — so it can't
  leak into request logs. Vite injects that header in the
  browser preview; the page never sees the token.
- **No arbitrary execution:** there is no "run this command" endpoint. Git,
  `gh`, and `tmux` are invoked with `execFile`/`spawn` and argv arrays — never
  a shell — so input is never interpreted as a command. Agent SDK chats spawn
  Claude through the SDK; they do not take a shell string from the client.
  The authenticated server-update endpoint is deliberately narrow: it starts
  the repository-owned `deploy/update-server.sh`, which only fast-forward pulls
  the current branch, runs `npm ci`/the server build, writes status to
  `~/.remy`, and restarts Remy's fixed launchd label.

## Input handling

- **Chats** are created against a saved workspace path or `~` on that machine.
  The cwd is expanded server-side; the client does not pass a shell. Model and
  permission mode are taken from a fixed set. Git checkout on send names a
  branch and either the primary checkout or a new linked worktree of a saved
  repository — not an arbitrary path.
- **Session names** (tmux remote) must match `^[A-Za-z0-9_][A-Za-z0-9._-]*$`
  (≤128 chars). The leading-char rule means a name can never be read as a tmux
  flag (`-…`) or a path segment (`.`/`..`/leading dot). Names are always passed
  as the value of `tmux -t`, never as a bare argument.
- **Keys** are a fixed whitelist (Enter, Escape, arrows, Ctrl-C, …) plus single
  alphanumerics; anything else is rejected.
- **Text** into a tmux pane is delivered through a per-call
  `load-buffer`/`paste-buffer` (via stdin, bracketed-paste), never as an argv,
  so it can't inject tmux commands.
- **Scroll actions** are validated against a fixed set; line counts are clamped.
- **Uploads** save under `$TMPDIR/remy-uploads/<session>/`; filenames
  are reduced to their basename, stripped to `[A-Za-z0-9._-]` with leading dots
  removed (no traversal), and capped at 64 MB. `$TMPDIR` is auto-purged by macOS.
- **Bodies** are size-capped (256 KB JSON, 64 MB upload).
- **Server updates** are bearer-token protected like every other endpoint and
  cannot accept a repository, branch, package command, or arbitrary script path
  from the client. The script's detailed output remains local in
  `~/.remy/update.log`.
- **Workspace worktrees** are discovered directly from `git worktree list` for
  a saved repository. A close request must name one of those current linked
  worktrees; the primary checkout is never removable. Git is invoked with argv
  arrays, and clean close refuses dirty worktrees before stopping only tmux
  sessions whose current directory is inside the selected checkout. Force close
  is an explicit destructive action and preserves the branch while discarding
  uncommitted files.
- **Stay awake** runs `caffeinate -i` (prevent idle sleep) when the setting is
  Always, or While working and a chat is `working` / `needs_input`. It does not
  prevent lid-close sleep. The process is local to the daemon; there is no
  client-supplied command.
- **Errors** return a generic message; details are logged server-side only.

## Residual risks (accepted)

- **No rate limiting.** Acceptable for a single-user, tailnet-only, token-gated
  service.
- **The agent can act in the checkout.** Inherent to running Claude Code on
  your own machine — permission mode (Ask / Auto / Accept edits / Plan /
  Bypass) is the same tradeoff as the CLI.
- **Terminal input reaches the pane's program.** Inherent to the leftover tmux
  remote — you are typing into your own shell.
- **Notification text transits Apple Push** when no window is open. Kept terse (thread + short reason). The APNs key lives in `~/.remy/apns.json` on the Mac that sends the push.
