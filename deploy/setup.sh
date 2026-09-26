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

# The macOS Tailscale GUI app doesn't put its CLI on PATH — find it.
TAILSCALE="$(command -v tailscale || true)"
for candidate in /Applications/Tailscale.app/Contents/MacOS/Tailscale "$HOME/Applications/Tailscale.app/Contents/MacOS/Tailscale"; do
  [ -n "$TAILSCALE" ] && break
  [ -x "$candidate" ] && TAILSCALE="$candidate"
done
[ -n "$TAILSCALE" ] || { echo "Tailscale not found — install it and sign in first."; exit 1; }

if [ "${REMY_SKIP_QR:-${MISSION_CONTROL_SKIP_QR:-0}}" != "1" ] && ! command -v qrencode >/dev/null; then
  echo "==> Installing qrencode (for pairing QR)"
  brew install qrencode
fi

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
TS_HOST="$("$TAILSCALE" status --json 2>/dev/null | node -p 'try { JSON.parse(require("fs").readFileSync(0,"utf8")).Self.DNSName.replace(/\.$/,"") } catch { "<tailscale hostname>" }' 2>/dev/null || echo "<tailscale hostname>")"

if curl -s -m 3 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/health" | grep -q '"ok":true'; then
  HEALTH="healthy"
else
  HEALTH="NOT RESPONDING — check $MC_DIR/server.log"
fi

# The node server is bound to 127.0.0.1 only. `tailscale serve` (NOT funnel) is
# the sole path in from outside — tailnet devices only, TLS-terminated. Prefer
# HTTPS; fall back to tailnet-HTTP if the tailnet hasn't enabled HTTPS certs
# (still WireGuard-encrypted and tailnet-only, just no TLS-on-top).
echo "==> Exposing over the tailnet with tailscale serve"
"$TAILSCALE" serve reset >/dev/null 2>&1 || true
if "$TAILSCALE" serve --bg --https=443 "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
  APP_URL="https://$TS_HOST"
  SERVE_NOTE="HTTPS (TLS, tailnet-only)"
elif "$TAILSCALE" serve --bg --http="$PORT" "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
  APP_URL="http://$TS_HOST:$PORT"
  SERVE_NOTE="tailnet HTTP (WireGuard-encrypted, tailnet-only). Enable HTTPS certs in the Tailscale admin console for TLS, then re-run."
else
  APP_URL="http://$TS_HOST:$PORT"
  SERVE_NOTE="tailscale serve FAILED — the app cannot reach the server until this is fixed (see: tailscale serve status)."
fi

# Persist the pairing values so deploy/show-pairing.sh can reprint the QR later.
node "$STORE" set-pairing "$APP_URL" "$TOKEN"

PAIR_LINK="remy://configure?url=$APP_URL&token=$TOKEN"

cat <<SUMMARY

============================================================
Remy server: $HEALTH
Tailnet exposure:        $SERVE_NOTE

Pair another device: open Remy on it and scan this:
============================================================
SUMMARY

if [ "${REMY_SKIP_QR:-${MISSION_CONTROL_SKIP_QR:-0}}" != "1" ]; then
  qrencode -t ANSIUTF8 -m 2 "$PAIR_LINK"
fi

cat <<SUMMARY
============================================================
Or enter manually:
  Server URL : $APP_URL
  Token      : $TOKEN

Or copy this link and paste it on the other device:
  $PAIR_LINK

Reprint this QR anytime:  ./deploy/show-pairing.sh

Turn off Claude Code remote control (remoteControlAtStartup: false) — Remy
replaces it.

Codex will ask you to review newly installed lifecycle hooks. In a Codex
session, run /hooks once and trust the Remy entries so live state,
conversation updates, and approval notifications can flow to the app.
============================================================
SUMMARY
