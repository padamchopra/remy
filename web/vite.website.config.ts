import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const web = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(web, "src");
const website = path.join(web, "website");

/// The website never bundles a transport that can reach a real computer.
function demoTransport(): Plugin {
  return {
    name: "website-demo-transport",
    enforce: "pre",
    resolveId(id, importer) {
      if (id === path.join(source, "lib/transport") || id === path.join(source, "lib/transport.ts") || /^[@~]\/lib\/transport$/.test(id)
        || (importer && id.startsWith(".") && path.resolve(path.dirname(importer), id) === path.join(source, "lib/transport"))) {
        return path.join(website, "demo/transport.ts");
      }
    },
    generateBundle() {
      if ([...this.getModuleIds()].some((id) => id === path.join(source, "lib/transport.ts"))) {
        this.error("The website must not include the live Remy transport.");
      }
    },
  };
}

export default defineConfig({
  root: website,
  plugins: [demoTransport(), react(), tailwindcss()],
  resolve: { alias: { "@": source, "~": source } },
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
  build: {
    outDir: path.join(web, "dist-website"),
    emptyOutDir: true,
    rollupOptions: { input: {
      home: path.join(website, "index.html"),
      docs: path.join(website, "docs/index.html"),
      changelog: path.join(website, "changelog/index.html"),
      demo: path.join(website, "demo/index.html"),
    } },
  },
});
