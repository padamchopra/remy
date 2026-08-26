import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// `tailnet.ts` imports config, which opens the database at import time, so the
// suite points that at a throwaway directory before the dynamic import below.
const stateDir = mkdtempSync(join(tmpdir(), "mc-tailnet-"));
process.env.MC_CONFIG_DIR = stateDir;

const STATUS = {
  BackendState: "Running",
  TailscaleIPs: ["100.98.93.47"],
  Self: { HostName: "Padam's Mac mini", DNSName: "padams-mac-mini.tail91cfc.ts.net.", OS: "macOS", UserID: 1 },
};

/// What the macOS app prints when it is asked for a status with no terminal
/// around: it decides it was double-clicked, fails to open a window, and says
/// so on stdout with an exit status of 0.
const GUI_PROSE = "The Tailscale GUI failed to start: The operation couldn't be completed. (Tailscale.CLIError error 3.)";

/// A stand-in for the macOS binary, which is the app and the command at once and
/// tells the two apart by whether `TERM` is set.
///
/// Node rather than a shell script, and that is the point: `/bin/sh` sets
/// `TERM=dumb` on its own when nothing else did, so a shell stub — like the
/// `/usr/local/bin/tailscale` shim, which is one — can never see the state this
/// is here to reproduce.
const binDir = mkdtempSync(join(tmpdir(), "mc-tailnet-bin-"));
const stub = join(binDir, "tailscale");
writeFileSync(
  stub,
  [
    `#!${process.execPath}`,
    `if (process.env.TERM === undefined) { process.stdout.write(${JSON.stringify(`${GUI_PROSE}\n`)}); process.exit(0); }`,
    `process.stdout.write(${JSON.stringify(JSON.stringify(STATUS))});`,
    "",
  ].join("\n"),
);
chmodSync(stub, 0o755);

// The daemon is started by Electron or by launchd, neither of which sets TERM.
delete process.env.TERM;
process.env.PATH = binDir;

// Imported after the overrides, so the module picks up this PATH and this TERM.
const tailnet = await import("./tailnet.js");

test("reads a status from the macOS binary with no terminal around it", async () => {
  // The bug this covers: run straight out of the app bundle with no TERM, the
  // binary answers with prose and exits 0, and Remy reported Tailscale as
  // absent on the machines that were running it.
  const self = await tailnet.tailnetSelf();
  assert.deepEqual(self, { state: "running", host: "padams-mac-mini.tail91cfc.ts.net" });
});

test("treats an answer that is not a status as no answer", () => {
  assert.deepEqual(tailnet.selfFromStatus(undefined), { state: "missing" });
});

test("separates Tailscale being absent from Tailscale being stopped", () => {
  assert.equal(tailnet.selfFromStatus({ BackendState: "Stopped", Self: { DNSName: "mini.ts.net." } }).state, "stopped");
  assert.equal(tailnet.selfFromStatus({ BackendState: "NeedsLogin" }).state, "stopped");
});

test("falls back to the tailnet address when MagicDNS gives no name", () => {
  const self = tailnet.selfFromStatus({
    BackendState: "Running",
    Self: { DNSName: "", TailscaleIPs: ["100.98.93.47"] },
  });
  assert.deepEqual(self, { state: "running", host: "100.98.93.47" });
});

test("lists only your own machines that could hold a repository", () => {
  const devices = tailnet.devicesFromStatus({
    Self: { UserID: 1 },
    Peer: {
      a: { DNSName: "mini.tail.ts.net.", OS: "macOS", UserID: 1, Online: true },
      b: { DNSName: "phone.tail.ts.net.", OS: "iOS", UserID: 1, Online: true },
      c: { DNSName: "theirs.tail.ts.net.", OS: "linux", UserID: 2, Online: true },
      d: { DNSName: "", HostName: "box", OS: "linux", UserID: 1, TailscaleIPs: ["100.1.2.3"] },
    },
  });
  assert.deepEqual(
    devices.map((device) => [device.name, device.host, device.online]),
    [
      ["box", "100.1.2.3", false],
      ["mini", "mini.tail.ts.net", true],
    ],
  );
});

test("recognises only the Serve rule that fronts this daemon", () => {
  const status = {
    Web: {
      "mini.tail.ts.net:443": {
        Handlers: {
          "/": { Proxy: "http://127.0.0.1:8420" },
        },
      },
    },
  };
  assert.deepEqual(tailnet.serveTargetFromStatus(status, 8420), { https: true });
  assert.equal(
    tailnet.serveTargetFromStatus(status, 5173),
    undefined,
    "a stale or unrelated proxy is not Remy's reachable endpoint",
  );
});

test("recognises the tailnet HTTP fallback for this daemon", () => {
  assert.deepEqual(
    tailnet.serveTargetFromStatus({
      Web: {
        "mini.tail.ts.net:8420": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:8420/" } },
        },
      },
    }, 8420),
    { https: false },
  );
});

test("matches a paired URL to its tailnet machine while Remy is down", () => {
  assert.equal(
    tailnet.sameTailnetHost("https://padams-mac-mini.tail91cfc.ts.net", "padams-mac-mini.tail91cfc.ts.net."),
    true,
  );
  assert.equal(
    tailnet.sameTailnetHost("https://another-machine.tail91cfc.ts.net", "padams-mac-mini.tail91cfc.ts.net"),
    false,
  );
});
