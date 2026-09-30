import type { ThreadMember } from "@remy/contract";
import { navigateLocation } from "@/lib/route";
import { PROVIDERS } from "@/lib/providers";
import { Button } from "./ui/button";

export function ThreadSender({ member, onOpen }: { member?: ThreadMember; onOpen?: (sender: NonNullable<ThreadMember["agent"]>) => void }) {
  const sender = member?.agent;
  if (!sender) return member?.label ?? "You";
  const label = `${PROVIDERS.find(p => p.id === sender.provider)?.label ?? sender.provider} [${sender.title}]`;
  return <Button data-link variant="link" size="sm" className="h-auto max-w-full min-w-0 justify-start p-0 text-xs text-muted-foreground" title={label} onClick={() => onOpen ? onOpen(sender) : navigateLocation({route:{name:"threads",organizationId:sender.organizationId,threadId:sender.threadId}})}><span className="truncate">{label}</span></Button>;
}
