import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] ?? new URL("../dist", import.meta.url).pathname);
const port = Number(process.env.PORT ?? process.argv[3] ?? 5180);
const appRoute = /^\/(?:app\/)?(?:threads|inbox|workspaces|board|tickets|pull-requests|settings)(?:\/|$)/;
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function fileFor(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
  const exact = join(root, clean);
  if (existsSync(exact) && statSync(exact).isFile()) return exact;
  const index = join(exact, "index.html");
  if (existsSync(index) && statSync(index).isFile()) return index;
  if (pathname === "/app" || pathname.startsWith("/app/") || appRoute.test(pathname)) return join(root, "app/index.html");
  return join(root, "index.html");
}

const server = createServer((request, response) => {
  try {
    const file = fileFor(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    response.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
    createReadStream(file).on("error", () => {
      if (!response.headersSent) response.writeHead(404);
      response.end("Not found");
    }).pipe(response);
  } catch {
    response.writeHead(400).end("Bad request");
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Serving ${root} on http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
