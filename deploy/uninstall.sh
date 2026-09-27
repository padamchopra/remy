#!/bin/bash
# Reverses deploy/setup.sh: stops the server, removes the LaunchAgent, the
# ~/.remy (or ~/.mission-control) directory, the Claude Code and Codex hook
# entries, and any tailscale serve rule an older setup.sh added. Leaves
# dependency tools (node, tmux) and this repo checkout in place.
set -euo pipefail

# shellcheck source=config-dir.sh
. "$(dirname "$0")/config-dir.sh"
PLIST_LABEL="com.example.remy"
LEGACY_PLIST_LABEL="com.example.missioncontrol"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

echo "==> Stopping and removing launchd service"
launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/$LEGACY_PLIST_LABEL" 2>/dev/null || true
rm -f "$PLIST_PATH" "$HOME/Library/LaunchAgents/$LEGACY_PLIST_LABEL.plist"

echo "==> Removing any tailscale serve rule from an older setup"
TAILSCALE="$(command -v tailscale || true)"
for candidate in /Applications/Tailscale.app/Contents/MacOS/Tailscale "$HOME/Applications/Tailscale.app/Contents/MacOS/Tailscale"; do
  [ -n "$TAILSCALE" ] && break
  [ -x "$candidate" ] && TAILSCALE="$candidate"
done
if [ -n "$TAILSCALE" ]; then
  # Older setup.sh versions owned the whole serve config (they ran `serve
  # reset` before adding their rule), so resetting here clears only that.
  "$TAILSCALE" serve reset 2>/dev/null || true
fi

echo "==> Removing Claude Code hook entries"
node - <<'EOF' || echo "    couldn't update ~/.claude/settings.json — remove the mc-hook.sh entries manually"
const fs = require("fs");
const path = require("path");
const settingsPath = path.join(process.env.HOME, ".claude", "settings.json");
if (!fs.existsSync(settingsPath)) process.exit(0);
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
  const kept = groups.filter(
    (g) => !(g.hooks ?? []).some((h) => String(h.command ?? "").includes("mc-hook.sh")),
  );
  if (kept.length !== groups.length) console.log(`   - ${event}`);
  if (kept.length === 0) delete settings.hooks[event];
  else settings.hooks[event] = kept;
}
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
EOF

echo "==> Removing Codex hook entries"
node - <<'EOF' || echo "    couldn't update ~/.codex/hooks.json — remove the mc-hook.sh entries manually"
const fs = require("fs");
const path = require("path");
const hooksPath = path.join(process.env.HOME, ".codex", "hooks.json");
if (!fs.existsSync(hooksPath)) process.exit(0);
const config = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
for (const [event, groups] of Object.entries(config.hooks ?? {})) {
  const kept = groups.filter(
    (group) => !(group.hooks ?? []).some((hook) => String(hook.command ?? "").includes("mc-hook.sh")),
  );
  if (kept.length !== groups.length) console.log(`   - ${event}`);
  if (kept.length === 0) delete config.hooks[event];
  else config.hooks[event] = kept;
}
fs.writeFileSync(hooksPath, JSON.stringify(config, null, 2) + "\n");
EOF

echo "==> Removing $HOME/.remy and $HOME/.mission-control (config, token, hook script, uploads, logs)"
rm -rf "$HOME/.remy" "$HOME/.mission-control"

cat <<SUMMARY

Remy has been removed from this machine. Left in place:
  - this repo checkout (delete it yourself if you're done with it)
  - dependency tools (node, tmux)
  - any tmux sessions that are still running
Remove this computer from your account in Remy on the web, under Settings → Computers.
SUMMARY
