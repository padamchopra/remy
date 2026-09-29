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
  export const message = (text, images) => renderToStaticMarkup(<Markdown text={text} images={images}/>);
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
test("a bare attachment line plays as the video GitHub draws, from the reader's signed copy", () => {
  const url = "https://github.com/user-attachments/assets/ec5bb8b1-74da-43c6-9729-3f936a0c1282";
  const signed = "https://private-user-images.githubusercontent.com/1/661394753-ec5bb8b1-74da-43c6-9729-3f936a0c1282.mp4?jwt=clip&v=1";
  const html = message(`**Recording**\n\n${url}\n\n## Summary`, {[url]: signed});
  assert.match(html, /<video[^>]*src="https:\/\/private-user-images\.githubusercontent\.com\/1\/661394753-ec5bb8b1-74da-43c6-9729-3f936a0c1282\.mp4\?jwt=clip&amp;v=1"[^>]*controls/);
  assert.doesNotMatch(html, /<p[^>]*><video/);
  assert.match(message(url), new RegExp(`<video[^>]*src="${url}"`));
});
test("an attachment inside a sentence, or a named link to one, stays a link", () => {
  const url = "https://github.com/user-attachments/assets/ec5bb8b1-74da-43c6-9729-3f936a0c1282";
  for (const text of [`See ${url} for the run.`, `[Recording](${url})`, "https://example.com/clip.mp4"])
    assert.doesNotMatch(message(text), /<video/);
});
test("a bare attachment that GitHub signed as an image stays an image", () => {
  const url = "https://github.com/user-attachments/assets/5c22357b-a164-4e88-9294-4c12eee8542d";
  const html = message(url, {[url]: "https://private-user-images.githubusercontent.com/1/659476008-5C22357B-a164-4e88-9294-4c12eee8542d.png?jwt=signed"});
  assert.match(html, /<img/);
  assert.doesNotMatch(html, /<video/);
});
