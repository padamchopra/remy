import {linearFor} from "./linear-routes.js";
import { githubFor } from "./github-routes.js";
import {
  ConnectionError,
  verifyConnectionSignature,
  type ConnectionProvider,
} from "./connections.js";
import type { Env } from "./worker.js";

export function connectionProviders(env: Env): ConnectionProvider[] {
  return [
    {
      id: "github",
      receive: async delivery => { await githubFor(env).receive(delivery,async(org,user,workspace,agent,prompt)=>{const response=await env.COORDINATOR.get(env.COORDINATOR.idFromName(`organization:${org}`)).fetch(new Request("https://internal/github/start",{method:"POST",headers:{"x-organization-id":org,"x-user-id":user,"content-type":"application/json"},body:JSON.stringify({workspace,agent,prompt})}));if(!response.ok)throw Error("This agent is unavailable.");return await response.json() as {threadId:string;computerId:string};}); },
      name: "GitHub",
      subjects: ["member"],
      clientId: env.GITHUB_CONNECTION_CLIENT_ID,
      clientSecret: env.GITHUB_CONNECTION_CLIENT_SECRET
        ? () => env.GITHUB_CONNECTION_CLIENT_SECRET!.get()
        : undefined,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET
        ? () => env.GITHUB_WEBHOOK_SECRET!.get()
        : undefined,
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scope: "",
      identity: async (token, send) => {
        const response = await send("https://api.github.com/user", {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "user-agent": "Remy",
          },
          signal: AbortSignal.timeout(20_000),
          redirect: "manual",
        });
        if (!response.ok)
          throw new ConnectionError(
            "Your GitHub identity could not be verified.",
            409,
          );
        const user = (await response.json()) as { id: number; login: string };
        if (!user.id || !user.login)
          throw new ConnectionError(
            "Your GitHub identity could not be verified.",
            409,
          );
        return { id: String(user.id), label: user.login };
      },
      verifyWebhook: async (request, raw, secret) => {
        if (
          !(await verifyConnectionSignature(
            raw,
            (request.headers.get("x-hub-signature-256") ?? "").replace(
              /^sha256=/,
              "",
            ),
            secret,
          ))
        )
          throw new ConnectionError("This update could not be verified.", 401);
        return {
          id: request.headers.get("x-github-delivery") ?? "",
          event: request.headers.get("x-github-event") ?? "",
        };
      },
    },
    {
      id: "linear",
      receive: delivery=>linearFor(env).receive(delivery),
      name: "Linear",
      subjects: ["organization"],
      clientId: env.LINEAR_CLIENT_ID,
      clientSecret: env.LINEAR_CLIENT_SECRET
        ? () => env.LINEAR_CLIENT_SECRET!.get()
        : undefined,
      webhookSecret: env.LINEAR_WEBHOOK_SECRET
        ? () => env.LINEAR_WEBHOOK_SECRET!.get()
        : undefined,
      authorizeUrl: "https://linear.app/oauth/authorize",
      tokenUrl: "https://api.linear.app/oauth/token",
      scope: "read,write",
      authorizeParameters: { actor: "app", prompt: "consent" },
      identity: async (token, send) => {
        const response = await send("https://api.linear.app/graphql", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            query: "query { organization { id name } viewer { id } }",
          }),
          signal: AbortSignal.timeout(20_000),
          redirect: "manual",
        });
        if (!response.ok)
          throw new ConnectionError(
            "Your Linear account could not be verified.",
            409,
          );
        const value = (await response.json()) as {
          data?: {
            organization?: { id: string; name: string };
            viewer?: { id: string };
          };
          errors?: unknown[];
        };
        if (value.errors || !value.data?.organization?.id)
          throw new ConnectionError(
            "Your Linear account could not be verified.",
            409,
          );
        return {
          id: value.data.organization.id,
          label: value.data.organization.name,
          userId: value.data.viewer?.id,
        };
      },
      verifyWebhook: async (request, raw, secret, now) => {
        if (
          !(await verifyConnectionSignature(
            raw,
            request.headers.get("linear-signature") ?? "",
            secret,
          ))
        )
          throw new ConnectionError("This update could not be verified.", 401);
        const value = JSON.parse(raw) as {
          webhookTimestamp?: number;
          type?: string;
        };
        if (
          !value.webhookTimestamp ||
          Math.abs(now - value.webhookTimestamp) > 60_000
        )
          throw new ConnectionError("This update expired.", 401);
        return {
          id: request.headers.get("linear-delivery") ?? "",
          event: value.type ?? "",
        };
      },
    },
  ];
}
