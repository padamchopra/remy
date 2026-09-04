import json
import os
import time

import modal
import modal.experimental


APP_NAME = "remy-wrk-2-modal-spike"
REPOSITORY = "https://github.com/padamchopra/remy.git"
BRANCH = "apollo/wrk-2"

os.environ["MODAL_SANDBOX_V2"] = "1"


def run(sandbox: modal.Sandbox, *command: str) -> str:
    process = sandbox.exec(*command, timeout=180)
    stdout = process.stdout.read()
    stderr = process.stderr.read()
    process.wait()
    if process.returncode != 0:
        raise RuntimeError(f"{' '.join(command)} failed ({process.returncode}): {stderr}")
    return stdout.strip()


image = (
    modal.Image.from_registry("node:22-bookworm-slim")
    .apt_install("curl", "g++", "git", "make", "procps", "python3")
    .run_commands(
        f"git clone --depth 1 --branch {BRANCH} {REPOSITORY} /opt/remy",
        "cd /opt/remy/server && npm ci && npm run build",
        "npm install --global @anthropic-ai/claude-code @openai/codex",
    )
)

app = modal.App.lookup(APP_NAME, create_if_missing=True)
sandbox = None
restored = None
snapshot_id = None

try:
    create_started = time.perf_counter()
    with modal.enable_output():
        sandbox = modal.Sandbox.create(app=app, image=image, timeout=900, cpu=1.0, memory=1024)
    create_seconds = time.perf_counter() - create_started

    versions = {
        "node": run(sandbox, "node", "--version"),
        "claude": run(sandbox, "claude", "--version"),
        "codex": run(sandbox, "codex", "--version"),
    }
    run(
        sandbox,
        "bash",
        "-lc",
        "mkdir -p /tmp/remy-config && MC_CONFIG_DIR=/tmp/remy-config node /opt/remy/server/dist/index.js >/tmp/remy.log 2>&1 &",
    )
    health_status = ""
    for _ in range(30):
        health_status = run(
            sandbox,
            "bash",
            "-lc",
            "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8420/health || true",
        )
        if health_status in {"200", "401"}:
            break
        time.sleep(0.1)
    if health_status not in {"200", "401"}:
        raise RuntimeError(f"Remy health check returned {health_status}: {run(sandbox, 'cat', '/tmp/remy.log')}")

    run(sandbox, "git", "-C", "/opt/remy", "config", "user.email", "spike@remy.local")
    run(sandbox, "git", "-C", "/opt/remy", "config", "user.name", "Remy spike")
    run(sandbox, "bash", "-lc", "printf 'edited inside Modal\\n' > /opt/remy/modal-proof.txt")
    edit_diff = run(sandbox, "git", "-C", "/opt/remy", "status", "--short", "modal-proof.txt")

    snapshot_started = time.perf_counter()
    snapshot = sandbox.snapshot_filesystem(timeout=120)
    snapshot_seconds = time.perf_counter() - snapshot_started
    snapshot_id = snapshot.object_id
    sandbox.terminate()
    sandbox = None

    restore_started = time.perf_counter()
    with modal.enable_output():
        restored = modal.Sandbox.create(app=app, image=snapshot, timeout=300, cpu=1.0, memory=1024)
    restored_text = run(restored, "cat", "/opt/remy/modal-proof.txt")
    restore_seconds = time.perf_counter() - restore_started

    print(
        json.dumps(
            {
                "createSeconds": round(create_seconds, 3),
                "snapshotSeconds": round(snapshot_seconds, 3),
                "restoreAndReadSeconds": round(restore_seconds, 3),
                "snapshotId": snapshot_id,
                "healthStatus": int(health_status),
                "versions": versions,
                "restoredText": restored_text,
                "editDiff": edit_diff,
            },
            indent=2,
        )
    )
finally:
    if sandbox is not None:
        sandbox.terminate()
    if restored is not None:
        restored.terminate()
    if snapshot_id is not None:
        modal.experimental.image_delete(snapshot_id)
