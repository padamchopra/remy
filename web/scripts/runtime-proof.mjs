import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url);
const temporary = mkdtempSync(join(tmpdir(), "remy-runtime-proof-"));
const current = join(temporary, "current");
const shared = join(temporary, "shared");

try {
  execFileSync("npm", ["run", "typecheck"], { cwd: root, stdio: "inherit" });
  execFileSync("npx", ["vite", "build", "--outDir", current], { cwd: root, stdio: "inherit" });
  execFileSync("npx", ["vite", "build", "--outDir", shared], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, VITE_THREAD_RUNTIME: "shared" },
  });

  const entryBytes = (directory) => {
    const file = readdirSync(join(directory, "assets")).find((name) => name.startsWith("index-") && name.endsWith(".js"));
    return file ? statSync(join(directory, "assets", file)).size : 0;
  };
  const sourceLines = readFileSync(new URL("../src/client-runtime/thread-runtime.ts", import.meta.url), "utf8")
    .split("\n").length;
  execFileSync(process.execPath, ["scripts/perf.mjs"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      MC_PERF_ONLY: "runtime-proof",
      MC_RUNTIME_CURRENT_URL: pathToFileURL(join(current, "index.html")).href,
      MC_RUNTIME_SHARED_URL: pathToFileURL(join(shared, "index.html")).href,
      MC_RUNTIME_SOURCE_LINES: String(sourceLines),
      MC_RUNTIME_CURRENT_BUNDLE_BYTES: String(entryBytes(current)),
      MC_RUNTIME_SHARED_BUNDLE_BYTES: String(entryBytes(shared)),
    },
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
