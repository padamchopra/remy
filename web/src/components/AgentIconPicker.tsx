import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AgentMark, agentAvatarSeed, encodeAgentAvatar } from "@/components/AgentAvatar";
import type { Agent } from "@/state/types";

export function AgentIconPicker({
  agent,
  onChange,
}: {
  agent: Agent;
  onChange: (avatar: string) => void;
}) {
  const [page, setPage] = useState(0);
  const selected = agentAvatarSeed(agent);
  const alternatives = Array.from({ length: 6 }, (_, index) => `${agent.id}:${page}:${index}`);
  const options = [selected, ...alternatives.filter((seed) => seed !== selected)].slice(0, 6);

  return (
    <div className="flex flex-col items-start gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        value={selected}
        onValueChange={(seed) => {
          if (seed) onChange(encodeAgentAvatar(seed));
        }}
        aria-label="Agent icon"
        className="flex flex-wrap justify-start"
      >
        {options.map((seed, index) => (
          <ToggleGroupItem
            key={seed}
            value={seed}
            aria-label={seed === selected ? "Current icon" : `Icon option ${index + 1}`}
            className="size-12 p-1"
          >
            <AgentMark agent={{ ...agent, avatar: encodeAgentAvatar(seed) }} className="size-10" />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button type="button" variant="ghost" size="sm" onClick={() => setPage((current) => current + 1)}>
        <RefreshCw data-icon="inline-start" />
        More icons
      </Button>
    </div>
  );
}
