// What the browser downloads before the window is usable, and what waits for a
// first open. Run it before and after moving a surface behind a dynamic import.
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOP_MODULES = positiveInteger(process.env.MC_BUNDLE_MODULES, 6);

const report = await measure();
writeFileSync(resolve(webRoot, "dist/bundle-report.json"), `${JSON.stringify(report, null, 2)}\n`);
print(report);

/// Builds once and folds rollup's own module accounting into a chunk report.
///
/// Sizes come off disk rather than out of `generateBundle`: Vite finishes a
/// chunk after that hook, so the in-memory code is not the file that ships.
async function measure() {
  /** @type {{ chunks: ReturnType<typeof describeChunk>[] }} */
  const collected = { chunks: [] };

  await build({
    root: webRoot,
    logLevel: "warn",
    plugins: [
      {
        name: "remy-bundle-report",
        generateBundle(_options, bundle) {
          for (const output of Object.values(bundle)) {
            if (output.type !== "chunk") continue;
            collected.chunks.push(describeChunk(output));
          }
        },
      },
    ],
  });

  for (const chunk of collected.chunks) {
    const shipped = readFileSync(resolve(webRoot, "dist", chunk.file));
    chunk.bytes = shipped.byteLength;
    chunk.gzip = gzipSync(shipped).byteLength;
  }

  const byName = new Map(collected.chunks.map((chunk) => [chunk.file, chunk]));
  const initial = initialChunks(collected.chunks, byName);
  for (const chunk of collected.chunks) chunk.initial = initial.has(chunk.file);

  collected.chunks.sort((a, b) => Number(b.initial) - Number(a.initial) || b.bytes - a.bytes);
  const sum = (only) => collected.chunks.filter(only).reduce(
    (totals, chunk) => ({ bytes: totals.bytes + chunk.bytes, gzip: totals.gzip + chunk.gzip }),
    { bytes: 0, gzip: 0 },
  );

  return {
    measuredAt: new Date().toISOString(),
    initial: sum((chunk) => chunk.initial),
    deferred: sum((chunk) => !chunk.initial),
    chunks: collected.chunks,
  };
}

function describeChunk(output) {
  const modules = Object.entries(output.modules)
    .map(([id, module]) => ({ id: shortModuleId(id), bytes: module.renderedLength }))
    .filter((module) => module.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);

  return {
    file: output.fileName,
    name: output.name,
    entry: output.isEntry,
    initial: false,
    bytes: 0,
    gzip: 0,
    imports: output.imports,
    dynamicImports: output.dynamicImports,
    modules: modules.slice(0, TOP_MODULES),
    moduleCount: modules.length,
  };
}

/// Everything an entry pulls in synchronously — the bytes a cold start pays for
/// no matter which surface the person opens. A dynamic import is not walked.
function initialChunks(chunks, byName) {
  const reached = new Set();
  const queue = chunks.filter((chunk) => chunk.entry).map((chunk) => chunk.file);
  while (queue.length > 0) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    for (const next of byName.get(file)?.imports ?? []) queue.push(next);
  }
  return reached;
}

function shortModuleId(id) {
  const relative = id.startsWith(webRoot) ? id.slice(webRoot.length + 1) : id;
  return relative.replace(/^.*\/node_modules\//, "node_modules/").replace(/\0/g, "");
}

function print(report) {
  console.log(`\nInitial JavaScript  ${kb(report.initial.bytes)}  (${kb(report.initial.gzip)} gzipped)`);
  console.log(`Deferred surfaces   ${kb(report.deferred.bytes)}  (${kb(report.deferred.gzip)} gzipped)\n`);

  for (const chunk of report.chunks) {
    console.log(
      `${chunk.initial ? "initial " : "on first use "}${chunk.name}`
      + `  ${kb(chunk.bytes)} (${kb(chunk.gzip)} gzipped, ${chunk.moduleCount} modules)`,
    );
    for (const module of chunk.modules) console.log(`    ${kb(module.bytes).padStart(10)}  ${module.id}`);
  }
  console.log("\nWrote dist/bundle-report.json");
}

/// Vite prints kB as a thousand bytes, so this report does too and the two
/// numbers can be compared without converting one of them.
function kb(bytes) {
  return `${(bytes / 1000).toFixed(2)} kB`;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
