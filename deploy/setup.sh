#!/bin/bash
# One-shot setup for the server. Idempotent — safe to re-run after git pull.
#
#   git clone <repo> ~/Documents/Projects/remy   (or pull)
#   cd ~/remy && ./deploy/setup.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$REPO_DIR/server"
# shellcheck source=config-dir.sh
. "$(dirname "$0")/config-dir.sh"
PLIST_LABEL="com.example.remy"
LEGACY_PLIST_LABEL="com.example.missioncontrol"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

for bin in node npm tmux curl; do
  command -v "$bin" >/dev/null || { echo "missing dependency: $bin"; exit 1; }
done

echo "==> Building server"
cd "$SERVER_DIR"
npm install --no-fund --no-audit
npm run build

echo "==> Installing hook script"
mkdir -p "$MC_DIR"
cp "$SERVER_DIR/hooks/mc-hook.sh" "$MC_DIR/mc-hook.sh"
cp "$SERVER_DIR/scripts/store.mjs" "$MC_DIR/store.mjs"
chmod +x "$MC_DIR/mc-hook.sh"
export MC_HOOK="$MC_DIR/mc-hook.sh"

echo "==> Registering Claude Code hooks (every tmux Claude session reports)"
node - <<'EOF'
const fs = require("fs");
const path = require("path");
const settingsPath = path.join(process.env.HOME, ".claude", "settings.json");
const hookCmd = (event) => `${process.env.MC_HOOK} ${event}`;
const events = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop", "SessionEnd"];

const settings = fs.existsSync(settingsPath)
  ? JSON.parse(fs.readFileSync(settingsPath, "utf8"))
  : {};
settings.hooks = settings.hooks ?? {};
for (const event of events) {
  const groups = (settings.hooks[event] = settings.hooks[event] ?? []);
  const existing = groups.flatMap((g) => g.hooks ?? [])
    .find((h) => String(h.command ?? "").includes("mc-hook.sh"));
  if (existing) {
    // AskUserQuestion keeps this hook open while a remote client answers.
    if (event === "PreToolUse") existing.timeout = 3600;
  } else {
    const hook = { type: "command", command: hookCmd(event) };
    if (event === "PreToolUse") hook.timeout = 3600;
    groups.push({ hooks: [hook] });
    console.log(`   + ${event}`);
  }
}
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
EOF

if command -v codex >/dev/null; then
  echo "==> Registering Codex hooks (every tmux Codex session reports)"
  node - <<'EOF'
const fs = require("fs");
const path = require("path");
const hooksPath = path.join(process.env.HOME, ".codex", "hooks.json");
const hookCmd = (event) => `${process.env.MC_HOOK} ${event} codex`;
const events = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "SessionEnd"];

const config = fs.existsSync(hooksPath)
  ? JSON.parse(fs.readFileSync(hooksPath, "utf8"))
  : {};
config.hooks = config.hooks ?? {};
for (const event of events) {
  const groups = (config.hooks[event] = config.hooks[event] ?? []);
  const already = groups.some((group) =>
    (group.hooks ?? []).some((hook) =>
      String(hook.command ?? "").includes("mc-hook.sh") &&
      String(hook.command ?? "").includes("codex"),
    ),
  );
  if (!already) {
    groups.push({ hooks: [{ type: "command", command: hookCmd(event), timeout: 3 }] });
    console.log(`   + ${event}`);
  }
}
fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
fs.writeFileSync(hooksPath, JSON.stringify(config, null, 2) + "\n");
EOF
else
  echo "==> Codex CLI not found; skipping Codex hook registration"
fi

echo "==> Installing launchd service"
NODE_BIN="$(command -v node)"
mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s|__NODE__|$NODE_BIN|g" \
    -e "s|__SERVER_DIR__|$SERVER_DIR|g" \
    -e "s|__HOME__|$HOME|g" \
    -e "s|__CONFIG_DIR__|$MC_DIR|g" \
    "$REPO_DIR/deploy/$PLIST_LABEL.plist" > "$PLIST_PATH"
launchctl bootout "gui/$(id -u)/$LEGACY_PLIST_LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LEGACY_PLIST_LABEL.plist"
launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL"

sleep 2
STORE="$MC_DIR/store.mjs"
TOKEN="$(node "$STORE" get config token 2>/dev/null || echo "<server did not start — check $MC_DIR/server.log>")"
PORT="$(node "$STORE" get config port 2>/dev/null || echo 8420)"

if curl -s -m 3 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/health" | grep -q '"ok":true'; then
  HEALTH="healthy"
else
  HEALTH="NOT RESPONDING — check $MC_DIR/server.log"
fi

cat <<SUMMARY

============================================================
Remy server: $HEALTH
Listening on 127.0.0.1:$PORT only.

Connect this computer to your Remy account:
  remy login <key>
Create a key in Remy on the web, under Settings → Computers → Connected.

Turn off Claude Code remote control (remoteControlAtStartup: false) — Remy
replaces it.

Codex will ask you to review newly installed lifecycle hooks. In a Codex
session, run /hooks once and trust the Remy entries so live state,
conversation updates, and approval notifications can flow to the app.
============================================================
SUMMARY
