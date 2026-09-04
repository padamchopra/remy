// electron-builder wrapper: Developer ID when a certificate source is set, ad-hoc otherwise.
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const builder = join(desktop, "node_modules/.bin/electron-builder");
const signed = Boolean(process.env.CSC_LINK || process.env.CSC_KEYCHAIN);
// Zip is what electron-updater installs; the DMG is the first-run drag onto
// Applications. `--publish never` still writes latest-mac.yml from `publish`.
const args = ["--mac", "--publish", "never"];
if (!signed) args.push("--config.mac.identity=-");

const result = spawnSync(builder, args, { cwd: desktop, stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
