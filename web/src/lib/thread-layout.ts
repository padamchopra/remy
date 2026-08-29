export type ThreadLayoutNode =
  | { type: "thread"; threadId: string }
  | {
      type: "split";
      id: string;
      direction: "horizontal" | "vertical";
      ratio: number;
      first: ThreadLayoutNode;
      second: ThreadLayoutNode;
    };

interface LeafBox {
  threadId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function threadLeaf(threadId: string): ThreadLayoutNode {
  return { type: "thread", threadId };
}

export function threadIds(node: ThreadLayoutNode): string[] {
  return node.type === "thread"
    ? [node.threadId]
    : [...threadIds(node.first), ...threadIds(node.second)];
}

function boundedRatio(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(0.8, Math.max(0.2, number)) : 0.5;
}

function parseNode(value: unknown): ThreadLayoutNode | undefined {
  if (!value || typeof value !== "object") return undefined;
  const node = value as Record<string, unknown>;
  if (node.type === "thread" && typeof node.threadId === "string" && node.threadId) {
    return threadLeaf(node.threadId);
  }
  if (
    node.type !== "split"
    || typeof node.id !== "string"
    || (node.direction !== "horizontal" && node.direction !== "vertical")
  ) return undefined;
  const first = parseNode(node.first);
  const second = parseNode(node.second);
  if (!first || !second) return undefined;
  return {
    type: "split",
    id: node.id,
    direction: node.direction,
    ratio: boundedRatio(node.ratio),
    first,
    second,
  };
}

export function encodeThreadLayout(node: ThreadLayoutNode): string {
  return JSON.stringify(node);
}

export function decodeThreadLayout(value: string | undefined): ThreadLayoutNode | undefined {
  if (!value) return undefined;
  try {
    return parseNode(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function boxes(
  node: ThreadLayoutNode,
  rect: Omit<LeafBox, "threadId">,
  output: LeafBox[],
): void {
  if (node.type === "thread") {
    output.push({ threadId: node.threadId, ...rect });
    return;
  }
  const ratio = boundedRatio(node.ratio);
  if (node.direction === "horizontal") {
    const firstWidth = rect.width * ratio;
    boxes(node.first, { ...rect, width: firstWidth }, output);
    boxes(node.second, {
      x: rect.x + firstWidth,
      y: rect.y,
      width: rect.width - firstWidth,
      height: rect.height,
    }, output);
  } else {
    const firstHeight = rect.height * ratio;
    boxes(node.first, { ...rect, height: firstHeight }, output);
    boxes(node.second, {
      x: rect.x,
      y: rect.y + firstHeight,
      width: rect.width,
      height: rect.height - firstHeight,
    }, output);
  }
}

function replaceLeaf(
  node: ThreadLayoutNode,
  threadId: string,
  replacement: ThreadLayoutNode,
): ThreadLayoutNode {
  if (node.type === "thread") return node.threadId === threadId ? replacement : node;
  return {
    ...node,
    first: replaceLeaf(node.first, threadId, replacement),
    second: replaceLeaf(node.second, threadId, replacement),
  };
}

/// Splits the largest rendered pane along its longer axis. Equal-area panes
/// prefer the rightmost, then the lower one, which keeps additions spatially
/// predictable without encoding special cases for pane counts.
export function addThreadPane(
  node: ThreadLayoutNode,
  threadId: string,
  width: number,
  height: number,
): ThreadLayoutNode {
  if (threadIds(node).includes(threadId)) return node;
  const rendered: LeafBox[] = [];
  boxes(node, { x: 0, y: 0, width: Math.max(1, width), height: Math.max(1, height) }, rendered);
  rendered.sort((a, b) => {
    const area = (b.width * b.height) - (a.width * a.height);
    if (Math.abs(area) > 0.5) return area;
    if (a.x !== b.x) return b.x - a.x;
    return b.y - a.y;
  });
  const target = rendered[0];
  if (!target) return node;
  return replaceLeaf(node, target.threadId, {
    type: "split",
    id: crypto.randomUUID(),
    direction: target.width >= target.height ? "horizontal" : "vertical",
    ratio: 0.5,
    first: threadLeaf(target.threadId),
    second: threadLeaf(threadId),
  });
}

export function removeThreadPane(node: ThreadLayoutNode, threadId: string): ThreadLayoutNode | undefined {
  if (node.type === "thread") return node.threadId === threadId ? undefined : node;
  const first = removeThreadPane(node.first, threadId);
  const second = removeThreadPane(node.second, threadId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

export function resizeThreadSplit(
  node: ThreadLayoutNode,
  splitId: string,
  ratio: number,
): ThreadLayoutNode {
  if (node.type === "thread") return node;
  return {
    ...node,
    ratio: node.id === splitId ? boundedRatio(ratio) : node.ratio,
    first: resizeThreadSplit(node.first, splitId, ratio),
    second: resizeThreadSplit(node.second, splitId, ratio),
  };
}
