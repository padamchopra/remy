import { execFileSync } from "node:child_process";

export function configureHostedGit(path: string, helper: string, remote: string) {
  for (const args of [
    ["--replace-all", "credential.helper", ""],
    ["--add", "credential.helper", helper],
    ["credential.useHttpPath", "true"],
    ["remote.origin.url", remote],
  ]) execFileSync("git", ["-C", path, "config", "--local", ...args], { stdio: "ignore" });
}
