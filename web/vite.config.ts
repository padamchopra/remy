import { hostedPreview } from "./hosted-preview";
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { fileURLToPath, URL } from "node:url";

const remyVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string })
  .version;

const preview = process.env.REMY_HOSTED_PREVIEW_URL ? hostedPreview(process.env.REMY_HOSTED_PREVIEW_URL) : undefined;

/// The isolated daemon `npm run qa:web` starts. The sidecar hands Vite its
/// temporary server's address and token; nothing here reads `~/.remy`.
function qaDaemonProxy(): Record<string, ProxyOptions> {
  const target = process.env.MC_SERVER_URL?.replace(/\/$/, "");
  if (!target) return {};
  const hub = process.env.VITE_REMY_HUB_URL;
  return {
    ...(hub ? Object.fromEntries(["/api/personal", "/api/organizations", "/api/device", "/api/auth", "/api/sessions", "/api/profile", "/api/invitations"].map((path) => [path, { target: hub, ws: true, changeOrigin: false }])) : {}),
    "/api": {
      target,
      changeOrigin: true,
      ws: true,
      rewrite: (path: string) => path.replace(/^\/api/, ""),
      configure(proxy) {
        const authorize = (proxyReq: { setHeader(name: string, value: string): void }) => {
          if (process.env.MC_TOKEN) proxyReq.setHeader("Authorization", `Bearer ${process.env.MC_TOKEN}`);
        };
        proxy.on("proxyReq", authorize);
        // A websocket upgrade is a different event, and the server checks the
        // same bearer header on it. Without this the notify socket is refused,
        // the page silently loses every live update, and a streaming turn only
        // appears when the poll next comes round.
        proxy.on("proxyReqWs", authorize);
      },
    },
  };
}

export default defineConfig(({ command }) => {
  if (command === "serve" && !preview && !process.env.MC_SERVER_URL) {
    throw new Error("Run `npm run dev:hosted` for the web app, or `npm run qa:web` for an isolated daemon.");
  }
  return {
    plugins: [react(), tailwindcss(), ...(preview ? [preview.plugin] : [])],
    define: {
      "import.meta.env.VITE_REMY_PROXY_DEVICE": JSON.stringify(hostname().replace(/\.local$/, "")),
      "import.meta.env.VITE_REMY_VERSION": JSON.stringify(remyVersion),
    },
    resolve: {
      alias: {
        "~": fileURLToPath(new URL("./src", import.meta.url)),
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    // The page never holds a credential, so Vite carries it: same-origin `/api`,
    // with the bearer header added to each proxied request.
    server: {
      port: 5174,
      strictPort: true,
      // The hosted backend allows the exact origin `http://127.0.0.1:5174`, and
      // Vite's default resolves to IPv6 loopback alone here. Still loopback:
      // this is never reachable from the network.
      host: "127.0.0.1",
      // No live reloading. Editing Remy in Remy meant the page yanked itself out
      // from under whatever was on screen on every save; reload it yourself when
      // you want to see a change.
      hmr: false,
      proxy: preview ? { "/api": preview.proxy } : qaDaemonProxy(),
    },
    // The hosted app is served under /app, so assets are referenced relatively
    // rather than from the server root.
    base: "./",
    build: { outDir: "dist", emptyOutDir: true },
  };
});
