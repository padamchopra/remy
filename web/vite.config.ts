import { hostedPreview } from "./hosted-preview";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { fileURLToPath, URL } from "node:url";

const remyVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string })
  .version;

const localHub = process.env.REMY_LOCAL_HUB_URL;
if (localHub && new URL(localHub).hostname !== "127.0.0.1") throw new Error("The local hub must bind to 127.0.0.1.");
const localSession = process.env.REMY_LOCAL_PREVIEW_SESSION ? JSON.parse(process.env.REMY_LOCAL_PREVIEW_SESSION) : undefined;
if (localSession && !localHub) throw new Error("A local session requires a local hub.");
const preview = localHub && localSession ? hostedPreview(localHub,undefined,localSession) : process.env.REMY_HOSTED_PREVIEW_URL ? hostedPreview(process.env.REMY_HOSTED_PREVIEW_URL) : undefined;

export default defineConfig(({ command }) => {
  if (command === "serve" && !preview && !localHub) {
    throw new Error("Run `npm run dev:hosted` for the web app.");
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
    // proxied through the approved hosted session.
    server: {
      port: 5174,
      strictPort: true,
      // The hosted backend allows the exact origin `http://127.0.0.1:5174`, and
      // Vite's default resolves to IPv6 loopback alone here. Still loopback:
      // this is never reachable from the network.
      host: "127.0.0.1",
      fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.wrangler/**"] },
      // No live reloading. Editing Remy in Remy meant the page yanked itself out
      // from under whatever was on screen on every save; reload it yourself when
      // you want to see a change.
      hmr: false,
      proxy: localHub ? { "/api": preview?.proxy ?? {target:localHub,ws:true}, "/__dev": {target:localHub} } : preview ? { "/api": preview.proxy } : {},
    },
    // The hosted app is served under /app, so assets are referenced relatively
    // rather than from the server root.
    base: "./",
    build: { outDir: "dist", emptyOutDir: true },
  };
});
