import { Children, Fragment, memo, useMemo, type MouseEvent, type ReactNode } from "react";
import { ChevronRight, Square, SquareCheckBig } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/// Someone the text may name, and where clicking their name goes.
export interface Mention {
  handle: string;
  label: string;
  onOpen?: () => void;
}

const COMPONENTS: Components = {
  p: ({ children }) => <p className="wrap-break-word whitespace-pre-wrap">{children}</p>,
  h1: ({ children }) => <h1 className="mt-2 text-base font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-2 text-base font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-1 text-sm font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-1 text-sm font-semibold first:mt-0">{children}</h4>,
  ul: ({ children, className }) => (
    <ul className={cn(
      "flex list-disc flex-col gap-1 pl-5",
      className,
      className?.includes("contains-task-list") && "list-none pl-0",
    )}>
      {children}
    </ul>
  ),
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-5">{children}</ol>,
  li: ({ children, className }) => <li className={cn("wrap-break-word", className)}>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="line-through opacity-70">{children}</del>,
  hr: () => <hr className="border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="underline underline-offset-2 hover:text-primary"
    >
      {children}
    </a>
  ),
  // Inline code is a pill. A fenced block is the same element inside `pre`,
  // which flattens the pill back out — that way a fence with no language is
  // styled like every other fence.
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-5 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[1em]">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted/40 px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
  input: ({ checked, type }) => type === "checkbox"
    ? checked
      ? <SquareCheckBig className="mr-2 inline-block size-3.5 align-[-0.125em] text-muted-foreground" />
      : <Square className="mr-2 inline-block size-3.5 align-[-0.125em] text-muted-foreground" />
    : null,
  details: ({ children, open }) => {
    const [summary, ...content] = Children.toArray(children);
    return (
      <Collapsible defaultOpen={open} className="group/details overflow-hidden rounded-lg border border-border">
        {summary}
        <CollapsibleContent className="border-t border-border px-3 py-3">
          <div className="flex flex-col gap-3">{content}</div>
        </CollapsibleContent>
      </Collapsible>
    );
  },
  summary: ({ children }) => (
    <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:[&_svg]:rotate-90">
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform" />
      <span className="min-w-0 wrap-break-word">{children}</span>
    </CollapsibleTrigger>
  ),
};

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
}

const DETAILS_OPEN = /^<details(\s+open)?\s*>\s*<summary>([\s\S]*?)<\/summary>\s*(?:<p>\s*)?$/i;
const DETAILS_CLOSE = /^(?:<\/p>\s*)?<\/details>\s*$/i;
const LINK_PARAGRAPH = /^<p>\s*<a\s+href="(https?:\/\/[^"\s]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/p>$/i;
const INLINE_LINK = /^<a\s+href="(https?:\/\/[^"\s]+)"[^>]*>([\s\S]*?)<\/a>$/i;

function htmlText(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'");
}

function safeInline(value: string): MarkdownNode[] {
  const link = value.trim().match(INLINE_LINK);
  if (!link) return [{ type: "text", value: htmlText(value.trim()) }];
  return [{
    type: "link",
    url: link[1],
    children: [{ type: "text", value: htmlText(link[2].replace(/<[^>]*>/g, "").trim()) }],
  }];
}

function remarkDetails() {
  return (tree: MarkdownNode) => {
    if (!tree.children) return;
    const output: MarkdownNode[] = [];
    const stack: MarkdownNode[][] = [output];
    for (const node of tree.children) {
      const opening = node.type === "html" && node.value?.match(DETAILS_OPEN);
      if (opening) {
        const details: MarkdownNode = {
          type: "details",
          data: {
            hName: "details",
            hProperties: opening[1] ? { open: true } : {},
          },
          children: [{
            type: "summary",
            data: { hName: "summary" },
            children: safeInline(opening[2]),
          }],
        };
        stack.at(-1)!.push(details);
        stack.push(details.children!);
        continue;
      }
      if (node.type === "html" && node.value && DETAILS_CLOSE.test(node.value) && stack.length > 1) {
        stack.pop();
        continue;
      }
      const linkParagraph = node.type === "html" && node.value?.match(LINK_PARAGRAPH);
      if (linkParagraph) {
        stack.at(-1)!.push({
          type: "paragraph",
          children: [{
            type: "link",
            url: linkParagraph[1],
            children: [{ type: "text", value: htmlText(linkParagraph[2].replace(/<[^>]*>/g, "").trim()) }],
          }],
        });
        continue;
      }
      stack.at(-1)!.push(node);
    }
    tree.children = output;
  };
}

/// `@handle` in a run of text, wrapped as a chip.
///
/// Done on the rendered children rather than on the source, so a handle inside
/// a code fence or a link stays the literal text it was written as.
function chip(text: string, mentions: Mention[], key: string): ReactNode {
  const pattern = new RegExp(`@(${mentions.map((m) => escape(m.handle)).join("|")})\\b`, "g");
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const mention = mentions.find((entry) => entry.handle === match[1])!;
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(
      <button
        key={`${key}-${match.index}`}
        type="button"
        disabled={!mention.onOpen}
        className="rounded bg-primary/15 px-1 font-medium text-primary disabled:cursor-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={mention.onOpen}
      >
        @{mention.label}
      </button>,
    );
    last = match.index + match[0].length;
  }
  if (last === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return <Fragment key={key}>{out}</Fragment>;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withMentions(mentions: Mention[]): Components {
  const decorate = (children: ReactNode): ReactNode =>
    Array.isArray(children)
      ? children.map((child, index) => (typeof child === "string" ? chip(child, mentions, String(index)) : child))
      : typeof children === "string"
        ? chip(children, mentions, "0")
        : children;
  return {
    ...COMPONENTS,
    p: ({ children }) => <p className="wrap-break-word whitespace-pre-wrap">{decorate(children)}</p>,
    li: ({ children, className }) => (
      <li className={cn("wrap-break-word", className)}>{decorate(children)}</li>
    ),
  };
}

function withLinkHandler(components: Components, onOpenLink?: (href: string) => void): Components {
  if (!onOpenLink) return components;
  return {
    ...components,
    a: ({ children, href }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="underline underline-offset-2 hover:text-primary"
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (!href || event.metaKey) return;
          event.preventDefault();
          onOpenLink(href);
        }}
      >
        {children}
      </a>
    ),
  };
}

/// Claude answers in markdown, so the feed renders it rather than showing the
/// `##` and backticks raw.
///
/// Every element is styled here because this project has no typography plugin,
/// and chat prose wants tighter sizes than article prose anyway. Arbitrary raw
/// HTML stays off; the exact `details` and `summary` shape GitHub emits becomes
/// a safe disclosure before the HTML node reaches React.
export const Markdown = memo(function Markdown({
  text,
  className,
  mentions,
  onOpenLink,
}: {
  text: string;
  className?: string;
  /// When given, `@handle` for anyone in this list renders as a chip that opens
  /// them. Everything else keeps the `@` it was typed with.
  mentions?: Mention[];
  /// A thread keeps ordinary clicks in its own work surface. Command-click is
  /// left to the anchor, which opens it outside Remy.
  onOpenLink?: (href: string) => void;
}) {
  const components = useMemo(
    () => withLinkHandler(mentions?.length ? withMentions(mentions) : COMPONENTS, onOpenLink),
    [mentions, onOpenLink],
  );
  return (
    <div className={cn("flex flex-col gap-3 text-sm leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkDetails]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
