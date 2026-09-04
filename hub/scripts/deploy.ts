import { execFile, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { CONTRACT_VERSION, parseHubHealth, type HubEnvironment } from "@remy/contract";

type RunCommand = (file: string, args: string[], input?: string) => Promise<void>;

type DeployOptions = {
  environment: HubEnvironment;
  release: string;
  hubUrl: string;
  authSecret: string;
  run?: RunCommand;
  fetchHealth?: typeof fetch;
};

const hubRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const wrangler = join(hubRoot, "node_modules/.bin/wrangler");
const execute = promisify(execFile);
const hubUrls: Record<HubEnvironment, string> = {
  production: "https://remy-prod.jb-padamchopra.workers.dev",
  staging: "https://remy-hub-staging.jb-padamchopra.workers.dev",
};

export function deploymentHubUrl(environment: HubEnvironment): string {
  return hubUrls[environment];
}

const runCommand: RunCommand = (file, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: hubRoot, stdio: ["pipe", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${file} exited with status ${code ?? "unknown"}`));
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });

export async function deployHub(options: DeployOptions): Promise<void> {
  const run = options.run ?? runCommand;
  await run(wrangler, ["d1", "migrations", "apply", "DB", "--remote", "--env", options.environment]);
  await run(wrangler, ["secret", "put", "BETTER_AUTH_SECRET", "--env", options.environment], options.authSecret);
  await run(wrangler, [
    "deploy",
    "--env",
    options.environment,
    "--var",
    `RELEASE:${options.release}`,
    "--var",
    `BETTER_AUTH_URL:${options.hubUrl}`,
  ]);

  const response = await (options.fetchHealth ?? fetch)(new URL("/health", options.hubUrl));
  if (!response.ok) throw new Error(`Hub smoke check returned ${response.status}`);
  const health = parseHubHealth(await response.json());
  if (health.environment !== options.environment) throw new Error("Hub smoke check reached the wrong environment");
  if (health.release !== options.release) throw new Error("Hub smoke check reached the wrong release");
  if (health.contractVersion !== CONTRACT_VERSION) throw new Error("Hub smoke check reached an incompatible contract");
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  const environment = process.argv[2];
  if (environment !== "staging" && environment !== "production") {
    throw new Error("Pass staging or production as the deployment environment");
  }
  const release = process.env.RELEASE ?? (await execute("git", ["rev-parse", "HEAD"], { cwd: hubRoot })).stdout.trim();
  const hubUrl = deploymentHubUrl(environment);
  const authSecret = process.env.BETTER_AUTH_SECRET;
  if (!release || !authSecret) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }
  await deployHub({ authSecret, environment, hubUrl, release });
}
