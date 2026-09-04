import { CONTRACT_VERSION, type HubEnvironment, type HubHealth } from "@remy/contract";

export interface Env {
  DB: D1Database;
  ENVIRONMENT: HubEnvironment;
  RELEASE: string;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    const health: HubHealth = {
      contractVersion: CONTRACT_VERSION,
      environment: env.ENVIRONMENT,
      release: env.RELEASE,
    };
    return Response.json(health);
  }
  return Response.json({ error: "Not found" }, { status: 404 });
}

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>;
