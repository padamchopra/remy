import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function prepareSubmitConfig(config, appId) {
  if (!/^\d+$/.test(appId ?? "")) {
    throw new Error("ASC_APP_ID must be the numeric Apple ID from App Store Connect.");
  }

  return {
    ...config,
    submit: {
      ...config.submit,
      testflight: {
        ...config.submit?.testflight,
        ios: {
          ...config.submit?.testflight?.ios,
          ascAppId: appId,
        },
      },
    },
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = fileURLToPath(new URL("../eas.json", import.meta.url));
  const config = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, `${JSON.stringify(prepareSubmitConfig(config, process.env.ASC_APP_ID), null, 2)}\n`);
  console.log("Selected the App Store Connect app for this TestFlight submission.");
}
