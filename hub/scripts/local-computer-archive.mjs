import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, cp, rm, access, rename, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
const exec = promisify(execFile);

/// Reuse the release's Linux dependencies and overlay this checkout's built
/// computer and contract. No local settings or credentials enter the archive.
export async function localComputerArchive(root, state, baseUrl) {
  const cache = join(state, "archive");
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const base = join(cache, `${createHash("sha256").update(baseUrl).digest("hex")}.tar.gz`);
  try { await access(base); } catch {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) throw new Error("The Linux computer dependencies could not download.");
    await pipeline(Readable.fromWeb(response.body), createWriteStream(`${base}.download`, { mode: 0o600 }));
    await rename(`${base}.download`, base);
  }
  const unpacked = join(cache, "computer");
  await rm(unpacked, { recursive: true, force: true });
  await mkdir(unpacked, { recursive: true, mode: 0o700 });
  await exec("tar", ["-xzf", base, "-C", unpacked]);
  const computer = join(unpacked, "opt/remy");
  for (const folder of ["server/dist", "contract/dist"]) {
    await rm(join(computer, folder), { recursive: true, force: true });
    await cp(join(root, folder), join(computer, folder), { recursive: true });
  }
  for (const folder of ["server", "contract"]) for (const file of ["package.json", "package-lock.json"]) {
    await cp(join(root,folder,file),join(computer,folder,file));
  }
  const contract = JSON.parse(await readFile(join(computer,"contract/package.json"),"utf8"));
  contract.exports["."].default = "./dist/index.js";
  await writeFile(join(computer,"contract/package.json"),JSON.stringify(contract));
  const hash = createHash("sha256");
  for (const folder of ["server", "contract"]) hash.update(await readFile(join(computer,folder,"package-lock.json")));
  await writeFile(join(computer,".development-lock"),hash.digest("hex"));
  const archive = join(cache, "computer.tar.gz");
  await exec("tar", ["-czf", archive, "-C", unpacked, "opt", "usr"], { timeout: 120000 });
  await rm(unpacked, { recursive: true, force: true });
  return archive;
}
