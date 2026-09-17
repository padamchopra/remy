import { execFile, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { CONTRACT_VERSION, parseHubHealth, type HubEnvironment } from "@remy/contract";

type RunCommand = (file: string, args: string[]) => Promise<void>;

type DeployOptions = {
  environment: HubEnvironment;
  release: string;
  hubUrl: string;
  run?: RunCommand;
  fetchHealth?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
};

const hubRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const wrangler = join(hubRoot, "node_modules/.bin/wrangler");
const execute = promisify(execFile);
const healthAttempts = 12;
const healthRetryMilliseconds = 5_000;
const hubUrls: Record<HubEnvironment, string> = {
  production: "https://tryremy.dev",
  staging: "https://remy-hub-staging.jb-padamchopra.workers.dev",
};

export function deploymentHubUrl(environment: HubEnvironment): string {
  return hubUrls[environment];
}

const runCommand: RunCommand = (file, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: hubRoot, stdio: ["pipe", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${file} exited with status ${code ?? "unknown"}`));
    });
    child.stdin.end();
  });

export async function deployHub(options: DeployOptions): Promise<void> {
  const run = options.run ?? runCommand;
  await run("npm", ["--prefix", "../web", "run", "build:hub"]);
  await run(wrangler, ["d1", "migrations", "apply", "DB", "--remote", "--env", options.environment]);
  await run(wrangler, [
    "deploy",
    "--env",
    options.environment,
    "--var",
    `RELEASE:${options.release}`,
    "--var",
    `BETTER_AUTH_URL:${options.hubUrl}`,
  ]);

  const fetchHealth = options.fetchHealth ?? fetch;
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastFailure = "Hub smoke check did not reach the deployed release";
  for (let attempt = 0; attempt < healthAttempts; attempt++) {
    let response: Response | undefined;
    try {
      response = await fetchHealth(new URL("/health", options.hubUrl), { cache: "no-store" });
    } catch (error) {
      lastFailure = `Hub smoke check failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (response) {
      if (!response.ok) {
        lastFailure = `Hub smoke check returned ${response.status}`;
      } else {
        const health = parseHubHealth(await response.json());
        if (health.environment !== options.environment) throw new Error("Hub smoke check reached the wrong environment");
        if (health.contractVersion !== CONTRACT_VERSION) throw new Error("Hub smoke check reached an incompatible contract");
        if (health.release === options.release) {
          lastFailure = "";
          break;
        }
        lastFailure = "Hub smoke check reached the wrong release";
      }
    }
    if (attempt < healthAttempts - 1) await wait(healthRetryMilliseconds);
  }
  if (lastFailure) throw new Error(lastFailure);
  if (options.environment === "production") {
    const runtimeResponse = await fetchHealth(new URL("/api/runtime", options.hubUrl));
    if (!runtimeResponse.ok) throw new Error("Production sign-in configuration is unavailable");
    const runtime = await runtimeResponse.json() as { auth?: { magicLink?: boolean } };
    if (runtime.auth?.magicLink !== true) throw new Error("Production email signup is unavailable");
  }
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  const environment = process.argv[2];
  if (environment !== "staging" && environment !== "production") {
    throw new Error("Pass staging or production as the deployment environment");
  }
  const release = process.env.RELEASE ?? (await execute("git", ["rev-parse", "HEAD"], { cwd: hubRoot })).stdout.trim();
  const hubUrl = deploymentHubUrl(environment);
  if (!release) throw new Error("The release is required");
  await deployHub({ environment, hubUrl, release });
}
