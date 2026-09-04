import { CONTRACT_VERSION, type HubEnvironment, type HubHealth } from "@remy/contract";

export interface Env {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  DB: D1Database;
  ENVIRONMENT: HubEnvironment;
  RELEASE: string;
}

type RequestOutcome = {
  event: "request.outcome";
  environment: HubEnvironment;
  release: string;
  requestId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  outcome: "success" | "error";
};

type HandlerDependencies = {
  log: (event: RequestOutcome) => void;
  now: () => number;
  requestId: () => string;
  route: (request: Request, env: Env) => Promise<Response>;
};

async function routeRequest(request: Request, env: Env): Promise<Response> {
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

function requestIdFor(request: Request, generate: () => string): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && supplied.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(supplied) ? supplied : generate();
}

export function createHandler(overrides: Partial<HandlerDependencies> = {}) {
  const dependencies: HandlerDependencies = {
    log: (event) => console.log(JSON.stringify(event)),
    now: () => performance.now(),
    requestId: () => crypto.randomUUID(),
    route: routeRequest,
    ...overrides,
  };

  return async (request: Request, env: Env): Promise<Response> => {
    const startedAt = dependencies.now();
    const requestId = requestIdFor(request, dependencies.requestId);
    const route = new URL(request.url).pathname;
    let response: Response;
    let outcome: RequestOutcome["outcome"] = "success";
    try {
      response = await dependencies.route(request, env);
    } catch {
      outcome = "error";
      response = Response.json({ error: "Internal server error" }, { status: 500 });
    }

    const headers = new Headers(response.headers);
    headers.set("x-request-id", requestId);
    const correlatedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    dependencies.log({
      event: "request.outcome",
      environment: env.ENVIRONMENT,
      release: env.RELEASE,
      requestId,
      method: request.method,
      route,
      status: correlatedResponse.status,
      durationMs: Math.max(0, dependencies.now() - startedAt),
      outcome,
    });
    return correlatedResponse;
  };
}

export const handleRequest = createHandler();

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>;
