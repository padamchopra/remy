#!/usr/bin/env node
/// Read or write Remy's sqlite store. Used by deploy scripts and the agent hook
/// so they never open a JSON file.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

function configDir() {
  if (process.env.MC_CONFIG_DIR) return process.env.MC_CONFIG_DIR;
  const here = dirname(fileURLToPath(import.meta.url));
  if (existsSync(join(here, "remy.db"))) return here;
  const remy = join(homedir(), ".remy");
  const legacy = join(homedir(), ".mission-control");
  return existsSync(join(remy, "remy.db")) || !existsSync(join(legacy, "remy.db")) ? remy : legacy;
}

const file = join(configDir(), "remy.db");
if (!existsSync(file)) process.exit(1);

const db = new DatabaseSync(file);
const [command, key, fieldOrValue] = process.argv.slice(2);

if (command === "get") {
  const row = db.prepare("select value from kv where key = ?").get(key);
  if (!row || typeof row.value !== "string") process.exit(1);
  const parsed = JSON.parse(row.value);
  process.stdout.write(fieldOrValue === undefined ? JSON.stringify(parsed) : String(parsed[fieldOrValue] ?? ""));
} else if (command === "set") {
  db.prepare("insert or replace into kv (key, value) values (?, ?)").run(key, fieldOrValue);
} else if (command === "set-update") {
  db.prepare("insert or replace into kv (key, value) values (?, ?)").run(
    "update_status",
    JSON.stringify({ state: key, message: fieldOrValue ?? "", updatedAt: Date.now() }),
  );
} else {
  process.exit(2);
}
