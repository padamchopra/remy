import { useEffect, useState } from "react";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AGENT_AVATAR_EXPRESSIONS,
  AGENT_AVATAR_SHAPES,
  AGENT_AVATAR_TONES,
  AgentMark,
  agentAvatarConfig,
  encodeAgentAvatar,
  type AgentAvatarConfig,
  type AgentAvatarExpression,
  type AgentAvatarShape,
  type AgentAvatarTone,
} from "@/components/AgentAvatar";
import type { Agent } from "@/state/types";

export function AgentIconPicker({
  agent,
  onChange,
}: {
  agent: Agent;
  onChange: (avatar: string) => void;
}) {
  const [config, setConfig] = useState(() => agentAvatarConfig(agent));

  useEffect(() => {
    setConfig(agentAvatarConfig(agent));
  }, [agent.avatar, agent.id, agent.tint]);

  const save = (patch: Partial<AgentAvatarConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    onChange(encodeAgentAvatar(next));
  };

  const preview = { ...agent, avatar: encodeAgentAvatar(config) };

  return (
    <FieldSet>
      <FieldLegend>Icon</FieldLegend>
      <FieldDescription className="text-xs">The face this agent wears everywhere.</FieldDescription>

      <div data-slot="agent-avatar-preview" className="flex justify-center py-3">
        <AgentMark agent={preview} className="size-28" />
      </div>

      <FieldGroup className="gap-5">
        <Field>
          <FieldLabel htmlFor="agent-avatar-shape">Shape</FieldLabel>
          <Select
            value={config.shape}
            onValueChange={(shape) => save({ shape: shape as AgentAvatarShape })}
          >
            <SelectTrigger id="agent-avatar-shape" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {AGENT_AVATAR_SHAPES.map((shape) => (
                  <SelectItem key={shape.value} value={shape.value}>
                    {shape.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="agent-avatar-hue">Colour</FieldLabel>
            <span className="font-mono text-xs text-muted-foreground">{config.hue}°</span>
          </div>
          <Slider
            id="agent-avatar-hue"
            min={0}
            max={359}
            step={1}
            value={[config.hue]}
            onValueChange={([hue]) => setConfig((current) => ({ ...current, hue }))}
            onValueCommit={([hue]) => save({ hue })}
            aria-label="Hue"
          />
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            value={config.tone}
            onValueChange={(tone) => {
              if (tone) save({ tone: tone as AgentAvatarTone });
            }}
            aria-label="Tone"
            className="flex flex-wrap justify-start"
          >
            {AGENT_AVATAR_TONES.map((tone) => (
              <ToggleGroupItem key={tone.value} value={tone.value} aria-label={`${tone.label} tone`}>
                {tone.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-avatar-expression">Expression</FieldLabel>
          <Select
            value={config.expression}
            onValueChange={(expression) => save({ expression: expression as AgentAvatarExpression })}
          >
            <SelectTrigger id="agent-avatar-expression" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {AGENT_AVATAR_EXPRESSIONS.map((expression) => (
                  <SelectItem key={expression.value} value={expression.value}>
                    {expression.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}
