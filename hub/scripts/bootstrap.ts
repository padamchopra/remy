import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

type Database = { name: string; uuid: string };
type BootstrapCommands = {
  list: () => Promise<Database[]>;
  create: (name: string) => Promise<void>;
};

const names = ["remy-hub-staging", "remy-hub-production"] as const;

export async function bootstrapDatabases(commands: BootstrapCommands): Promise<Record<(typeof names)[number], string>> {
  let databases = await commands.list();
  for (const name of names) {
    if (!databases.some((database) => database.name === name)) await commands.create(name);
  }
  databases = await commands.list();
  const entries = names.map((name) => {
    const database = databases.find((candidate) => candidate.name === name);
    if (!database) throw new Error(`Cloudflare did not return ${name} after creation`);
    return [name, database.uuid] as const;
  });
  if (entries[0][1] === entries[1][1]) throw new Error("Staging and production must use different D1 databases");
  return Object.fromEntries(entries) as Record<(typeof names)[number], string>;
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  const hubRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const wrangler = join(hubRoot, "node_modules/.bin/wrangler");
  const execute = promisify(execFile);
  const commands: BootstrapCommands = {
    list: async () => {
      const { stdout } = await execute(wrangler, ["d1", "list", "--json"], { cwd: hubRoot });
      return JSON.parse(stdout) as Database[];
    },
    create: async (name) => {
      await execute(wrangler, ["d1", "create", name, "--location", "enam"], { cwd: hubRoot });
    },
  };
  const databases = await bootstrapDatabases(commands);
  process.stdout.write(
    `${JSON.stringify(
      {
        cloudflareBuild: {
          production: { secrets: ["BETTER_AUTH_SECRET"], variables: [] },
          staging: { secrets: ["BETTER_AUTH_SECRET"], variables: [] },
        },
        wrangler: {
          production: { database_id: databases["remy-hub-production"], database_name: "remy-hub-production" },
          staging: { database_id: databases["remy-hub-staging"], database_name: "remy-hub-staging" },
        },
      },
      null,
      2,
    )}\n`,
  );
}
