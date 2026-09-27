import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    loader: "tsx",
    contents: `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import ReactMarkdown from "react-markdown";
      import remarkGfm from "remark-gfm";
      import { githubHtmlPlugins } from "./src/lib/markdown-html.ts";
      export const render = (text) => renderToStaticMarkup(
        createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: githubHtmlPlugins }, text),
      );
    `,
  },
  bundle: true,
  outfile: resolve(root, "node_modules/.cache/markdown-html.test.mjs"),
  external: ["react", "react-dom", "react/jsx-runtime"],
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { render } = await import(pathToFileURL(resolve(root, "node_modules/.cache/markdown-html.test.mjs")).href);

test("renders the HTML footer Cursor adds to a pull request instead of showing its tags", () => {
  const html = render([
    "Design decisions a reviewer might question",
    "",
    '<div><a href="https://cursor.com/agents/bc-1?cursor_ref=pr_footer"><picture>'
      + '<source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/open-in-web-dark.png">'
      + '<source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/open-in-web-light.png">'
      + '<img alt="Open in Web" width="114" height="28" src="https://cursor.com/assets/images/open-in-web-dark.png">'
      + "</picture></a>&nbsp;</div>",
  ].join("\n"));
  assert.doesNotMatch(html, /&lt;/);
  assert.match(html, /<a href="https:\/\/cursor\.com\/agents\/bc-1\?cursor_ref=pr_footer">/);
  assert.match(html, /<source media="\(prefers-color-scheme: dark\)" srcSet="https:\/\/cursor\.com\/assets\/images\/open-in-web-dark\.png"\/?>/i);
  assert.match(html, /<img[^>]*alt="Open in Web"/);
});

test("keeps markdown inside a details block, as GitHub does", () => {
  const html = render("<details><summary>How the captures were produced</summary>\n\n- **Bold** step\n\n</details>");
  assert.match(html, /<details><summary>How the captures were produced<\/summary>/);
  assert.match(html, /<li><strong>Bold<\/strong> step<\/li>/);
});

test("drops what GitHub's sanitizer drops", () => {
  const html = render('<p onclick="steal()" style="color:red">hi</p><script>alert(1)</script><iframe src="https://evil.test"></iframe><a href="javascript:alert(1)">x</a><img src="data:image/png;base64,AAAA">');
  assert.doesNotMatch(html, /onclick|style=|<script|alert\(1\)<\/script>|<iframe|javascript:|data:image/);
  assert.match(html, /<p>hi<\/p>/);
});
