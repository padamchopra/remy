import "blobatar/motion.css";

import { traits, type Animate } from "blobatar";
import {
  happy,
  love,
  mad,
  sad,
  scared,
  shy,
  sick,
  sleepy,
  smug,
  surprised,
  thinking,
  unsure,
  wink,
  type Expression,
} from "blobatar/expression";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Blobatar } from "@/components/ui/blobatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isTint, type TintId } from "@/lib/tints";
import { cn } from "@/lib/utils";
import type { Agent } from "@/state/types";

const AVATAR_PREFIX = "blobatar:";
const CONFIG_PREFIX = "v2:";

export const AGENT_AVATAR_SHAPES = [
  { value: "auto", label: "Auto" },
  { value: "round", label: "Round", trait: 0.11 },
  { value: "organic", label: "Organic", trait: 0.35 },
  { value: "boxy", label: "Boxy", trait: 0.54 },
  { value: "capsule", label: "Capsule", trait: 0.65 },
  { value: "nub", label: "Nub", trait: 0.745 },
  { value: "cloud", label: "Cloud", trait: 0.825 },
  { value: "droplet", label: "Droplet", trait: 0.887 },
  { value: "hexagon", label: "Hexagon", trait: 0.932 },
  { value: "sun", label: "Sun", trait: 0.965 },
  { value: "triangle", label: "Triangle", trait: 0.99 },
] as const;

export const AGENT_AVATAR_TONES = [
  { value: "auto", label: "Auto" },
  { value: "pastel", label: "Pastel", trait: 0.1 },
  { value: "pale", label: "Pale", trait: 0.28 },
  { value: "mid", label: "Mid", trait: 0.49 },
  { value: "deep", label: "Deep", trait: 0.71 },
  { value: "bright", label: "Bright", trait: 0.865 },
  { value: "ink", label: "Ink", trait: 0.965 },
] as const;

const EXPRESSIONS = {
  idle: undefined,
  happy,
  sad,
  mad,
  surprised,
  wink,
  sleepy,
  smug,
  unsure,
  scared,
  love,
  shy,
  sick,
  thinking,
} satisfies Record<string, Expression | undefined>;

export const AGENT_AVATAR_EXPRESSIONS = [
  { value: "idle", label: "Idle" },
  { value: "happy", label: "Happy" },
  { value: "sad", label: "Sad" },
  { value: "mad", label: "Mad" },
  { value: "surprised", label: "Surprised" },
  { value: "wink", label: "Wink" },
  { value: "sleepy", label: "Sleepy" },
  { value: "smug", label: "Smug" },
  { value: "unsure", label: "Unsure" },
  { value: "scared", label: "Scared" },
  { value: "love", label: "Love" },
  { value: "shy", label: "Shy" },
  { value: "sick", label: "Sick" },
  { value: "thinking", label: "Thinking" },
] as const;

export type AgentAvatarShape = (typeof AGENT_AVATAR_SHAPES)[number]["value"];
export type AgentAvatarTone = (typeof AGENT_AVATAR_TONES)[number]["value"];
export type AgentAvatarExpression = (typeof AGENT_AVATAR_EXPRESSIONS)[number]["value"];

export type AgentAvatarConfig = {
  seed: string;
  shape: AgentAvatarShape;
  hue: number;
  tone: AgentAvatarTone;
  expression: AgentAvatarExpression;
};

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

function agentHue(agent: Agent): number | undefined {
  return isTint(agent.tint) ? TINT_HUES[agent.tint] : undefined;
}

function oneOf<T extends string>(options: readonly { value: T }[], value: string | null): T | undefined {
  return options.find((option) => option.value === value)?.value;
}

function decodeSeed(value: string, fallback: string): string {
  try {
    return decodeURIComponent(value) || fallback;
  } catch {
    return fallback;
  }
}

export function agentAvatarConfig(agent: Agent): AgentAvatarConfig {
  const fallbackSeed = agent.avatar?.startsWith(AVATAR_PREFIX)
    ? agent.avatar.slice(AVATAR_PREFIX.length)
    : agent.avatar || agent.id;
  const fallbackHue = agentHue(agent) ?? Math.round(traits(fallbackSeed)("hue") * 359);
  if (!fallbackSeed.startsWith(CONFIG_PREFIX)) {
    return { seed: fallbackSeed, shape: "auto", hue: fallbackHue, tone: "auto", expression: "idle" };
  }

  const [encodedSeed, query = ""] = fallbackSeed.slice(CONFIG_PREFIX.length).split("?", 2);
  const params = new URLSearchParams(query);
  const hueValue = params.get("h");
  const hue = hueValue === null ? Number.NaN : Number(hueValue);
  return {
    seed: decodeSeed(encodedSeed, agent.id),
    shape: oneOf(AGENT_AVATAR_SHAPES, params.get("s")) ?? "auto",
    hue: Number.isFinite(hue) ? Math.min(359, Math.max(0, Math.round(hue))) : fallbackHue,
    tone: oneOf(AGENT_AVATAR_TONES, params.get("t")) ?? "auto",
    expression: oneOf(AGENT_AVATAR_EXPRESSIONS, params.get("e")) ?? "idle",
  };
}

export function encodeAgentAvatar(config: AgentAvatarConfig): string {
  const params = new URLSearchParams({
    s: config.shape,
    h: String(Math.round(config.hue)),
    t: config.tone,
    e: config.expression,
  });
  return `${AVATAR_PREFIX}${CONFIG_PREFIX}${encodeURIComponent(config.seed)}?${params}`;
}

export function AgentMark({
  agent,
  className,
  animate = "hover",
}: {
  agent: Agent;
  className?: string;
  animate?: Animate;
}) {
  const config = agentAvatarConfig(agent);
  const shapeOption = AGENT_AVATAR_SHAPES.find((option) => option.value === config.shape);
  const toneOption = AGENT_AVATAR_TONES.find((option) => option.value === config.tone);
  const shape = shapeOption && "trait" in shapeOption ? shapeOption.trait : undefined;
  const tone = toneOption && "trait" in toneOption ? toneOption.trait : undefined;
  return (
    <Blobatar
      name={agent.builtIn ? "remy" : config.seed}
      className={className}
      blobatar={agent.builtIn
        ? {
            traits: { shape: 0.745 },
            hue: 225,
            expression: smug,
            animate,
          }
        : {
            ...(shape === undefined ? {} : { traits: { shape } }),
            hue: config.hue,
            ...(tone === undefined ? {} : { tone }),
            expression: EXPRESSIONS[config.expression],
            animate,
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
