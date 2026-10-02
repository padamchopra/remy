import { z } from "zod";
import { HostedSettingsStore } from "./hosted-settings.js";
import { personalSpace } from "./personal-space.js";
import { githubFor } from "./github-routes.js";
import { proxyGit, githubRepository } from "./hosted-git.js";
import { D1OrganizationStore } from "./organization-store.js";
import { OrganizationService } from "./organizations.js";
import type { Env } from "./worker.js";

const scope = z.string().min(1).max(200);
const secretsInput = z.object({ organizationId: scope }).strict();
const chatgptInput = z.object({ operation: z.enum(["status", "tokens"]), rejected: z.string().regex(/^[0-9a-f]{64}$/).optional() }).strict();
const githubInput = z.union([
  z.object({ organizationId: scope, method: z.literal("GET").default("GET"), path: z.string().max(2048).regex(/^\/(?:user(?:\/repos)?|search\/issues|repos\/[\w.-]+\/[\w.-]+(?:\/[^?#]*)?)(?:\?[^#]*)?$/) }).strict(),
  z.object({ organizationId: scope, method: z.literal("POST"), path: z.literal("/graphql"), input: z.object({
    query: z.string().max(24000).refine(query => /^\s*query\b/.test(query) && !/\bmutation\b/.test(query)),
    variables: z.record(z.string(), z.unknown()).optional(),
  }).strict() }).strict(),
]);
const permittedSecret = (name: string) => /^(?:cloud:|named-cloud:|access:|named-access:|model:)/.test(name) || ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "RAMP_ROUTER_API_KEY", "OPENROUTER_API_KEY"].includes(name);

/// Only approved development computers use this connection. Refresh tokens
/// and GitHub credentials stay on production; execution keys remain in memory.
export async function developmentConnection(request: Request, userId: string, operation: string, env: Env): Promise<Response> {
  const reply = (status: number, value: unknown) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
  try {
    if (operation.startsWith("git/")) {
      const url = new URL(request.url);
      const org = url.searchParams.get("organizationId") ?? "";
      const workspaceId = url.searchParams.get("workspaceId") ?? "";
      const workspace = await new OrganizationService(new D1OrganizationStore(env.DB)).workspace(org, userId, workspaceId);
      const repository = githubRepository(workspace.origin);
      const suffix = operation.slice(4);
      if (!repository || (suffix === "info/refs" && url.searchParams.get("service") !== "git-upload-pack")) return reply(403, { error: "This repository is unavailable." });
      const headers = new Headers();
      for (const name of ["git-protocol", "content-encoding"]) if (request.headers.has(name)) headers.set(name, request.headers.get(name)!);
      const forwarded = new Request(`https://internal/${suffix}${suffix === "info/refs" ? "?service=git-upload-pack" : ""}`, {
        method: suffix === "info/refs" ? "GET" : "POST", headers,
        ...(suffix === "info/refs" ? {} : { body: request.body }),
      });
      return proxyGit(forwarded, { organizationId: org, computerId: "development", workspaceId, repository, branches: [], write: false, expiresAt: Date.now() + 300000 }, suffix, () => githubFor(env).workspaceGitToken(org, userId, workspaceId));
    }
    const reader = request.body?.getReader();
    let raw = "";
    if (reader) try {
      const decoder = new TextDecoder();
      let bytes = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 32768) { await reader.cancel(); return reply(413, { error: "Send a shorter request." }); }
        raw += decoder.decode(part.value, { stream: true });
      }
      raw += decoder.decode();
    } finally { reader.releaseLock(); }
    const input: unknown = JSON.parse(raw);
    if (operation === "secrets") {
      const { organizationId } = secretsInput.parse(input);
      const personal = await personalSpace(env.DB, userId);
      if (organizationId !== personal.id) {
        await new OrganizationService(new D1OrganizationStore(env.DB)).workspaces(organizationId, userId);
        return reply(200, {});
      }
      const values = await new HostedSettingsStore(env.DB, () => env.AUTH_SECRET.get()).secrets(personal.id);
      return reply(200, Object.fromEntries(Object.entries(values).filter(([name]) => permittedSecret(name))));
    }
    if (operation === "chatgpt") {
      const input = chatgptInput.parse(JSON.parse(raw));
      return env.COORDINATOR.get(env.COORDINATOR.idFromName(`chatgpt:${userId}`)).fetch(new Request(`https://internal/chatgpt-account/${input.operation}`, {
        method: "POST", headers: { "x-chatgpt-user": userId, "content-type": "application/json" },
        body: JSON.stringify(input.rejected ? { reason: "development", rejected: input.rejected } : {}),
      }));
    }
    if (operation === "github") {
      const github = githubInput.parse(input);
      return reply(200, await githubFor(env).api(github.organizationId, userId, github.path, github.method, "input" in github ? github.input : undefined));
    }
    return reply(404, { error: "This development connection is unavailable." });
  } catch (error) {
    const status = error instanceof z.ZodError || error instanceof SyntaxError ? 400
      : error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 503;
    return reply(status, { error: "Your production connection is unavailable. Check your access and try again." });
  }
}
