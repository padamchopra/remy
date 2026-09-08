import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { fileURLToPath, URL } from "node:url";
import { ensureLocalServer, isLoopback, readHomeConfig, readLocalTarget, stopSpawnedServer } from "./local-server";

const remyVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string })
  .version;

const local = readLocalTarget();
const deviceName = isLoopback(local.url)
  ? hostname().replace(/\.local$/, "")
  : (() => {
      try {
        return new URL(local.url).hostname;
      } catch {
        return hostname().replace(/\.local$/, "");
      }
    })();

/// Vite is the app in the browser preview. If this process is up, the local
/// daemon should be too — otherwise Devices looks like a pairing problem.
function ensureRemyServer(): Plugin {
  return {
    name: "ensure-remy-server",
    apply: "serve",
    async configureServer(vite) {
      if (process.env.VITE_REMY_HUB_MODE === "1") { vite.middlewares.use("/api/runtime", (_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ mode: "hub", auth: { magicLink: true, google: true, github: true, sso: true } })); }); return; }
      await ensureLocalServer(fileURLToPath(new URL("../server", import.meta.url)), local);
      vite.httpServer?.once("close", () => stopSpawnedServer());
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ensureRemyServer()],
  define: {
    "import.meta.env.VITE_REMY_PROXY_DEVICE": JSON.stringify(deviceName),
    "import.meta.env.VITE_REMY_VERSION": JSON.stringify(remyVersion),
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // In a plain browser the UI has no Electron main process to proxy through, so
  // Vite plays that role: same-origin `/api`, with the bearer header injected
  // on each request from remy.db so a just-spawned server is usable
  // without restarting Vite. The token never reaches the page.
  server: {
    port: 5173,
    strictPort: true,
    // Bind the address the docs actually give people. Vite's default resolves
    // to IPv6 loopback alone here, so `http://127.0.0.1:5173` refused the
    // connection and the browser showed its own error page. Still loopback:
    // this is never reachable from the network.
    host: "127.0.0.1",
    // No live reloading. Editing Remy in Remy meant the page yanked itself out
    // from under whatever was on screen on every save; reload it yourself when
    // you want to see a change.
    hmr: false,
    proxy: {
      ...(process.env.VITE_REMY_HUB_URL ? Object.fromEntries(["/api/organizations", "/api/device", "/api/auth", "/api/sessions", "/api/profile", "/api/invitations"].map((path) => [path, { target: process.env.VITE_REMY_HUB_URL, ws: true, changeOrigin: false }])) : {}),
      "/api": {
        target: local.url,
        changeOrigin: true,
        ws: true,
        rewrite: (path: string) => path.replace(/^\/api/, ""),
        configure(proxy) {
          const authorize = (proxyReq: { setHeader(name: string, value: string): void }) => {
            const token = process.env.MC_TOKEN || readHomeConfig()?.token;
            if (token) proxyReq.setHeader("Authorization", `Bearer ${token}`);
          };
          proxy.on("proxyReq", authorize);
          // A websocket upgrade is a different event, and the server checks the
          // same bearer header on it. Without this the notify socket is refused,
          // the page silently loses every live update, and a streaming turn only
          // appears when the poll next comes round.
          proxy.on("proxyReqWs", authorize);
        },
      },
    },
  },
  // Electron loads the build off disk with a file:// URL, so assets must be
  // referenced relatively rather than from the server root.
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
