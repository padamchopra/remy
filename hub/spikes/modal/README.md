# Modal computer spike

This H1 spike measures a disposable Modal Sandbox as a Remy computer. It installs the Remy daemon plus Claude Code and Codex, makes a deterministic edit inside the sandbox, snapshots its filesystem, restores it, and verifies the edit survived.

The script terminates every sandbox and deletes every filesystem snapshot it creates.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python spike.py
```

## Result

Measured on 4 September 2026 with Modal Python SDK 1.2.6 and the V2 Sandbox backend:

- Cached sandbox creation: 1.883 seconds.
- Filesystem snapshot: 1.016 seconds.
- Restore through the first successful file read: 4.128 seconds.
- Remy daemon health: 401, the expected unauthenticated response that proves it is listening.
- Node 22.23.2, Claude Code 2.1.260, and Codex CLI 0.153.2 ran inside the sandbox.
- `/opt/remy/modal-proof.txt` survived the snapshot and contained `edited inside Modal`.

The uncached first run took 88.155 seconds to build and create the computer. Its snapshot took 1.479 seconds and restore through the first read took 3.472 seconds.

This proves the Linux runtime, daemon, agent binaries, filesystem persistence, and restore path. It does not prove an agent-authored edit: no Anthropic or OpenAI credential was sent to Modal. It also does not meet the sub-second restore target.
