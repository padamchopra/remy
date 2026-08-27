import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

function signature(payload: string): string {
  return createHmac("sha256", config.token).update(`remy-tool:${payload}`).digest("base64url");
}

/// Mints a thread-scoped capability for the Remy operations exposed to coding
/// agents. The agent never receives Remy's full bearer token.
export function remyToolToken(chatId: string): string {
  const payload = Buffer.from(chatId).toString("base64url");
  return `remy.${payload}.${signature(payload)}`;
}

/// Returns the thread named by a valid Remy capability.
export function remyToolChatId(authorization: string | undefined): string | undefined {
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const match = /^remy\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) return undefined;
  const expected = Buffer.from(signature(match[1]));
  const received = Buffer.from(match[2]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return undefined;
  try {
    const chatId = Buffer.from(match[1], "base64url").toString("utf8");
    return chatId && chatId.length <= 200 ? chatId : undefined;
  } catch {
    return undefined;
  }
}

/// Remy capabilities expose orchestration but cannot change settings, pairing,
/// notifications, checkouts, files, or destructive workspace/thread routes.
export function isRemyToolRoute(method: string | undefined, pathname: string): boolean {
  if (method === "GET" && pathname === "/board") return true;
  if (method === "GET" && pathname === "/agents") return true;
  if ((method === "GET" || method === "POST") && /^\/agents\/[^/]+\/memories$/.test(pathname)) return true;
  if ((method === "PATCH" || method === "DELETE") && /^\/agents\/[^/]+\/memories\/[^/]+$/.test(pathname)) return true;
  if ((method === "GET" || method === "POST") && pathname === "/workspaces") return true;
  if ((method === "GET" || method === "POST") && pathname === "/chats") return true;
  if (method === "POST" && pathname === "/routines") return true;
  if (method === "POST" && pathname === "/runtime/environment-command") return true;
  if (method === "GET" && /^\/chats\/[^/]+$/.test(pathname)) return true;
  if (method === "POST" && /^\/chats\/[^/]+\/(message|stop)$/.test(pathname)) return true;
  if ((method === "GET" || method === "POST") && /^\/chats\/[^/]+\/browser(?:\/[^/]+)?$/.test(pathname)) return true;
  if (method === "POST" && pathname === "/tickets") return true;
  if (!/^\/tickets\/[^/]+(?:\/[^/]+)?$/.test(pathname)) return false;
  if (method === "GET" && /\/activity$/.test(pathname)) return true;
  if (method === "PATCH" && /^\/tickets\/[^/]+$/.test(pathname)) return true;
  return method === "POST" && /\/(status|comment|threads|handoff)$/.test(pathname);
}
