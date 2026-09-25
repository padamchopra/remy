import assert from "node:assert/strict";
import test from "node:test";
import { stripMarkdownHtmlComments } from "../src/lib/markdown-html-comments.ts";

test("strips GitHub and Cursor HTML comment markers without leaving the tags", () => {
  const text = `<!-- CURSOR_AGENT_PR_BODY_BEGIN -->
## What

A description.

\`\`\`
code
\`\`\`

<details>
<summary>Notes</summary>
Body
</details>
<!-- CURSOR_AGENT_PR_BODY_END -->`;
  const stripped = stripMarkdownHtmlComments(text);
  assert.equal(stripped.includes("CURSOR_AGENT"), false);
  assert.equal(stripped.includes("<!--"), false);
  assert.match(stripped, /^## What/m);
  assert.match(stripped, /<details>/);
});

test("collapses the blank lines a pair of markers leaves behind", () => {
  assert.equal(stripMarkdownHtmlComments("Hello\n<!-- hide -->\n\n\nWorld"), "Hello\n\nWorld");
});
