import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { providers } from "./providers.js";
import type {
  ComputerRuntime,
  ProvisionComputerInput,
} from "../../src/computer-runtime.js";
const configured = process.env.REMY_RUNTIME_TOKEN;
if (!configured || configured.length < 32)
  throw new Error(
    "Set a runtime management credential with at least 32 characters.",
  );
const expected = createHash("sha256").update(`Bearer ${configured}`).digest();
const adapters = providers();
createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  if (
    !timingSafeEqual(
      createHash("sha256")
        .update(req.headers.authorization ?? "")
        .digest(),
      expected,
    )
  ) {
    res.writeHead(401).end('{"error":"Unauthorized"}');
    return;
  }
  const match =
    /^\/v1\/(modal|fly-sprites)\/(provision|start|stop|checkpoint|destroy|prune)$/.exec(
      req.url ?? "",
    );
  if (req.method !== "POST" || !match) {
    res.writeHead(404).end("{}");
    return;
  }
  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 96_000) {
        res.writeHead(413).end("{}");
        return;
      }
    }
    const body = JSON.parse(raw) as ProvisionComputerInput & {
      runtime: ComputerRuntime;
      input: ProvisionComputerInput;
    };
    const input = match[2] === "provision" ? body : body.input;
    const id = input?.computerId ?? body.runtime?.id;
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id))
      throw new Error("Invalid computer.");
    const adapter = adapters[match[1] as keyof typeof adapters];
    let result;
    switch (match[2]) {
      case "provision":
        result = await adapter.provision(body);
        break;
      case "start":
        result = await adapter.start(body.runtime, body.input);
        break;
      case "checkpoint":
        result = await adapter.checkpoint(body.runtime);
        break;
      case "stop":
        await adapter.stop(body.runtime);
        result = body.runtime;
        break;
      case "prune":
        await adapter.prune(body.runtime);
        result = body.runtime;
        break;
      case "destroy":
        await adapter.destroy(body.runtime);
        result = body.runtime;
        break;
    }
    res.end(JSON.stringify(result));
  } catch {
    res.writeHead(502).end('{"error":"Hosted computer operation failed."}');
  }
}).listen(
  Number(process.env.PORT ?? 8788),
  process.env.REMY_RUNTIME_BIND ?? "127.0.0.1",
);
