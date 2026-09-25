import { MessageAvatar } from "./ui/message";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { ProviderMark } from "./ProviderMark";
import { cn } from "@/lib/utils";

/// `MessageAvatar` is the slot; `Avatar` is what goes in it, which is what
/// gives the mark its circle and keeps it from stretching.
export function ThreadMessageAvatar({
  provider,
  lead,
}: {
  provider: string;
  lead: boolean;
}) {
  const claude = provider === "claude";
  return (
    <MessageAvatar className={cn("bg-transparent", !lead && "invisible")}>
      {/* The provider's own disc: its mark on a wash of its own colour, the way
          the workspace marks do. */}
      <Avatar>
        <AvatarFallback className={claude ? "bg-claude/15" : "bg-foreground/10"}>
          <ProviderMark provider={provider} className="size-4" />
        </AvatarFallback>
      </Avatar>
    </MessageAvatar>
  );
}
