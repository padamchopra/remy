import "blobatar/motion.css";

import { smug } from "blobatar/expression";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Blobatar } from "@/components/ui/blobatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isTint, type TintId } from "@/lib/tints";
import { cn } from "@/lib/utils";
import type { Agent } from "@/state/types";

const AVATAR_PREFIX = "blobatar:";

const TINT_HUES: Partial<Record<TintId, number>> = {
  red: 0,
  orange: 30,
  amber: 45,
  green: 140,
  teal: 175,
  blue: 225,
  violet: 275,
  pink: 330,
};

export function agentAvatarSeed(agent: Agent): string {
  if (agent.builtIn) return "remy";
  if (agent.avatar?.startsWith(AVATAR_PREFIX)) return agent.avatar.slice(AVATAR_PREFIX.length);
  return agent.avatar || agent.id;
}

export function encodeAgentAvatar(seed: string): string {
  return `${AVATAR_PREFIX}${seed}`;
}

function agentHue(agent: Agent): number | undefined {
  return isTint(agent.tint) ? TINT_HUES[agent.tint] : undefined;
}

export function AgentMark({ agent, className }: { agent: Agent; className?: string }) {
  return (
    <Blobatar
      name={agentAvatarSeed(agent)}
      className={className}
      blobatar={agent.builtIn
        ? {
            traits: { shape: 0.745 },
            hue: 225,
            expression: smug,
            animate: "hover",
          }
        : {
            hue: agentHue(agent),
            animate: "hover",
          }}
    />
  );
}

export function AgentAvatar({
  agent,
  size = "sm",
  className,
}: {
  agent?: Agent;
  size?: "sm" | "md";
  className?: string;
}) {
  const name = agent?.name ?? "Nobody assigned";
  const avatarClass = cn(size === "md" ? "size-6" : "size-5", className);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {agent ? (
          <AgentMark agent={agent} className={avatarClass} />
        ) : (
          <Avatar className={avatarClass} aria-label={name}>
            <AvatarFallback className="border border-dashed border-border bg-transparent text-muted-foreground">
              {"\u2013"}
            </AvatarFallback>
          </Avatar>
        )}
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}
