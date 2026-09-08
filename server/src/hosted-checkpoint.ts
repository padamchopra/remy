process.env.MC_CONFIG_DIR ??= "/data/remy";
const { config } = await import("./config.js");
const response = await fetch(
  `http://127.0.0.1:${config.port}/server/hosted-checkpoint`,
  {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(30_000),
  },
);
if (!response.ok)
  throw new Error("Your computer could not prepare its checkpoint.");
export {};
