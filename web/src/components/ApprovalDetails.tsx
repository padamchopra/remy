import { Markdown } from "./Markdown";

export function ApprovalDetails({ title, reason, command, plan, onOpenLink }: {
  title: string;
  reason?: string;
  command?: string;
  plan?: string;
  onOpenLink?: (href: string) => void;
}) {
  return <div className="flex min-w-0 max-w-full flex-col gap-2">
    <Markdown text={title} onOpenLink={onOpenLink} />
    {reason && <Markdown text={reason} onOpenLink={onOpenLink} />}
    {command && <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs"><code>{command}</code></pre>}
    {plan && <Markdown text={plan} onOpenLink={onOpenLink} />}
  </div>;
}
