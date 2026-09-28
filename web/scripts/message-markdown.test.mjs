import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const outfile = `${root}node_modules/.cache/message-markdown.test.mjs`;
await build({absWorkingDir: root, stdin: {resolveDir: root, loader: "tsx", contents: `
  import {renderToStaticMarkup} from "react-dom/server";
  import {Markdown} from "./src/components/Markdown";
  import {ApprovalDetails} from "./src/components/ApprovalDetails";
  export const message = text => renderToStaticMarkup(<Markdown text={text}/>);
  export const approval = props => renderToStaticMarkup(<ApprovalDetails {...props}/>);
`}, bundle: true, outfile, jsx: "automatic", platform: "node", format: "esm", packages: "external", logLevel: "silent"});
const {message, approval} = await import(pathToFileURL(outfile));
test("messages render headings, lists, links, tables and fenced commands", () => {
  const html = message("## Result\n\n- **Done** with `git`\n\n[Details](https://example.com)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```sh\ngit status\n```");
  for(const tag of ["h2", "li", "strong", "a", "table", "pre", "code"]) assert.match(html, new RegExp(`<${tag}[ >]`));
});
test("approval prose renders Markdown but command text remains literal", () => {
  const html = approval({title: "**Read files**", reason: "Inspect the `android` folder.\n\n- No changes", command: "echo '**literal** <script>unsafe</script>'"});
  assert.match(html, /<strong[^>]*>Read files<\/strong>/);
  assert.match(html, /<li/);
  assert.match(html, /\*\*literal\*\*/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|<strong[^>]*>literal/);
});
test("unsafe links and scripts in messages are not executable", () => {
  const html = message("[bad](javascript:alert%281%29)\n\n<script>alert(1)</script>");
  assert.doesNotMatch(html, /href="javascript:|<script>/);
});
