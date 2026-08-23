import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function versionForTestFlightRun(runNumber) {
  if (!/^[1-9]\d*$/.test(runNumber ?? "")) {
    throw new Error("TESTFLIGHT_RUN_NUMBER must be a positive integer.");
  }

  return `0.1.${runNumber}`;
}

export function withTestFlightVersion(appConfig, runNumber) {
  if (!appConfig?.expo || typeof appConfig.expo !== "object") {
    throw new Error("app.json must contain an expo configuration.");
  }

  return {
    ...appConfig,
    expo: {
      ...appConfig.expo,
      version: versionForTestFlightRun(runNumber),
    },
  };
}

async function main() {
  const appConfigUrl = new URL("../app.json", import.meta.url);
  const appConfig = JSON.parse(await readFile(appConfigUrl, "utf8"));
  const stamped = withTestFlightVersion(
    appConfig,
    process.env.TESTFLIGHT_RUN_NUMBER,
  );

  await writeFile(appConfigUrl, `${JSON.stringify(stamped, null, 2)}\n`);
  console.log(`TestFlight version: ${stamped.expo.version}`);
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
