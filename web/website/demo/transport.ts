import type { Transport } from "../../src/lib/transport";
import { PROVIDERS } from "@/lib/providers";

const unavailable = () => Promise.reject(new Error("This action is available in the installed app."));

/// This module replaces the live transport only in the website build.
export const transport: Transport = {
  kind: "proxy",
  servers: async () => [],
  async request<T>(_serverId: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    if ((!init?.method || init.method === "GET") && path === "/server/providers") {
      return { providers: PROVIDERS.map((provider) => ({ ...provider, installed: true })) } as T;
    }
    if ((!init?.method || init.method === "GET") && /\/browsers$/.test(path)) return { browsers: [] } as T;
    return unavailable();
  },
  upload: unavailable,
  subscribe: () => () => {},
  onStatus: () => () => {},
  addServer: unavailable,
  removeServer: unavailable,
  updateServer: unavailable,
};
export const nativeBrowserSurface = { available: false, present: async () => false, openExternal: unavailable };
export const hubTransport = { request: unavailable };
