import { MessageAvatar } from "./ui/message";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { AgentMark } from "./AgentAvatar";
import { ProviderMark } from "./ProviderMark";
import { cn } from "@/lib/utils";
import type { Agent } from "@/state/types";

/// `MessageAvatar` is the slot; `Avatar` is what goes in it, which is what
/// gives the mark its circle and keeps it from stretching.
export function ThreadMessageAvatar({
  provider,
  persona,
  lead,
}: {
  provider: string;
  persona?: Agent;
  lead: boolean;
}) {
  const claude = provider === "claude";
  return (
    <MessageAvatar className={cn("bg-transparent", !lead && "invisible")}>
      {/* An agent wears the mark it wears in the inbox, so a run of messages
          is recognised rather than read. Everywhere else it is the provider's
          own disc: its mark on a wash of its own colour, the way the
          workspace marks do. */}
      {persona ? (
        <AgentMark agent={persona} className="size-8" />
      ) : (
        <Avatar>
          <AvatarFallback className={claude ? "bg-claude/15" : "bg-foreground/10"}>
            <ProviderMark provider={provider} className="size-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </MessageAvatar>
  );
}

