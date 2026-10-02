import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, cp, rm, rename, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const exec = promisify(execFile);

/// Ship this checkout's compiled code and manifests. The cloud computer keeps
/// its Linux runtime; no local settings or credentials enter the archive.
export async function localComputerArchive(root, state) {
  const cache = join(state, "archive");
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const unpacked = join(cache, "computer");
  await rm(unpacked, { recursive: true, force: true });
  const computer = join(unpacked, "opt/remy");
  await mkdir(computer, { recursive: true, mode: 0o755 });
  for (const folder of ["server/dist", "contract/dist"]) {
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
  await exec("tar", ["-czf", `${archive}.next`, "-C", unpacked, "opt"], { timeout: 120000 });
  await rename(`${archive}.next`,archive);
  await rm(unpacked, { recursive: true, force: true });
  return archive;
}
