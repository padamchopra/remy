type DevelopmentComputer = {computerId: string; organizationId: string; ownership: string; ownerUserId: string | null};
type DevelopmentBridge = {
  allowedComputerIds?: string | undefined;
  authenticate: (request: Request, organizationId: string) => Promise<DevelopmentComputer | undefined>;
  bootstrap: (userId: string) => Promise<unknown>;
  threadAccess?: (userId: string, organizationId: string, workspaceId: string) => Promise<unknown>;
};

/// Development access belongs to an explicitly enabled personal computer,
/// never to a browser session or a computer shared by an organization.
export async function developmentBridge(request: Request, bridge: DevelopmentBridge): Promise<Response | undefined> {
  const match = /^\/api\/development\/([^/]+)\/(bootstrap|thread-access)$/.exec(new URL(request.url).pathname);
  if (!match) return;
  const reply = (status: number, value: unknown) => Response.json(value, {status, headers:{"cache-control":"no-store"}});
  const allowed = new Set((bridge.allowedComputerIds ?? "").split(",").map(id => id.trim()).filter(Boolean));
  if (!allowed.size) return reply(404, {error:"Local development access is not enabled."});
  if (request.method !== "POST") return reply(405, {error:"Use a development computer to connect."});
  if (request.headers.has("origin") || request.headers.has("sec-fetch-site")) return reply(403, {error:"Use a development computer to connect."});
  let organizationId: string;
  try { organizationId = decodeURIComponent(match[1]!); }
  catch { return reply(400, {error:"Choose a valid account."}); }
  const computer = await bridge.authenticate(request, organizationId);
  if (!computer || !allowed.has(computer.computerId) || computer.organizationId !== organizationId || computer.ownership !== "personal" || !computer.ownerUserId)
    return reply(403, {error:"This computer cannot use local development access."});
  if (match[2] === "bootstrap") return reply(200, await bridge.bootstrap(computer.ownerUserId));
  if (!bridge.threadAccess) return reply(404, {error:"Local thread access is unavailable."});
  const reader = request.body?.getReader();
  if (!reader) return reply(400, {error:"Choose a workspace."});
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 4096) { await reader.cancel(); return reply(413, {error:"Send a shorter request."}); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset);offset += chunk.byteLength;}
  let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return reply(400, {error:"Choose a workspace."}); }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["organizationId", "workspaceId"].includes(key)) ||
      !("organizationId" in input) || typeof input.organizationId !== "string" || !input.organizationId || input.organizationId.length > 200 ||
      !("workspaceId" in input) || typeof input.workspaceId !== "string" || !input.workspaceId || input.workspaceId.length > 200)
    return reply(400, {error:"Choose a workspace."});
  try { return reply(200, await bridge.threadAccess(computer.ownerUserId, input.organizationId, input.workspaceId)); }
  catch (error) {
    const status = error && typeof error === "object" && "status" in error && (error.status === 403 || error.status === 404) ? error.status : 503;
    return reply(status,{error:"Your workspace connection is unavailable. Check your access and try again."});
  }
}
