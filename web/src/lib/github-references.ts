/// GitHub turns `#123`, `owner/repo#123`, `@login` and a commit hash into links
/// when it renders a description. The markdown here is the raw text, so the
/// same references are linked before it draws.

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

// One pass so a reference is matched once, left to right. Each alternative
// needs a boundary before it, so `a#1`, `x@y.com` and a hash inside a longer
// word stay text.
const REFERENCE = /(^|[^\w/@#.-])(?:(?<repo>[A-Za-z0-9][\w.-]*\/[\w.-]+)?#(?<number>[1-9]\d{0,9})\b|@(?<login>[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?![\w-]|\.\w)|(?<sha>\b[0-9a-f]{7,40})\b)/g;

function hasDigitAndLetter(value: string) {
  return /\d/.test(value) && /[a-f]/.test(value);
}

export function githubReferenceNodes(value: string, repository: string): MarkdownNode[] | undefined {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(REFERENCE)) {
    const groups = match.groups ?? {};
    const lead = match[1] ?? "";
    const start = match.index! + lead.length;
    const text = match[0].slice(lead.length);
    let url: string | undefined;
    if (groups.number) url = `https://github.com/${groups.repo ?? repository}/issues/${groups.number}`;
    else if (groups.login) url = `https://github.com/${groups.login}`;
    // A hash is only a commit when it looks like one: a run of hex that is
    // all digits is a number, and all letters is a word.
    else if (groups.sha && hasDigitAndLetter(groups.sha)) url = `https://github.com/${repository}/commit/${groups.sha}`;
    if (!url) continue;
    if (start > cursor) nodes.push({ type: "text", value: value.slice(cursor, start) });
    nodes.push({ type: "link", url, children: [{ type: "text", value: groups.sha ? text.slice(0, 7) : text }] });
    cursor = start + text.length;
  }
  if (!nodes.length) return undefined;
  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes;
}

/// A remark plugin. Text already inside a link stays as written; code is its
/// own node, never text, so a hash in a code span is not linked.
export function remarkGitHubReferences(options: { repository?: string }) {
  const repository = options?.repository;
  return (tree: MarkdownNode) => {
    if (!repository) return;
    const visit = (node: MarkdownNode) => {
      if (!node.children || node.type === "link" || node.type === "linkReference") return;
      node.children = node.children.flatMap((child) => {
        if (child.type === "text" && child.value) return githubReferenceNodes(child.value, repository) ?? [child];
        visit(child);
        return [child];
      });
    };
    visit(tree);
  };
}
