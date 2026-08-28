import { useEffect, useMemo, useState } from "react";
import { CircleOff, MessageSquare, Radio, RotateCcw, UserRound } from "lucide-react";
import { toast } from "sonner";
import { AgentMark } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiError } from "@/lib/api-error";
import { transport } from "@/lib/transport";
import { useStore } from "@/state/store";
import type { Agent } from "@/state/types";

export interface PullRequestMonitoringPolicy {
  enabled: boolean;
  agentId: string | null;
  chatId: string | null;
  source: "default" | "workspace" | "pull-request";
  explicit: boolean;
}

export function PullRequestMonitoringFields({
  id,
  enabled,
  agentId,
  agents,
  description,
  onChange,
}: {
  id: string;
  enabled: boolean;
  agentId: string | null;
  agents: Agent[];
  description: string;
  onChange: (policy: { enabled: boolean; agentId: string | null }) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field orientation="horizontal" className="items-center">
        <FieldContent>
          <FieldLabel htmlFor={`${id}-enabled`}>Monitor pull requests</FieldLabel>
          <FieldDescription className="text-xs">{description}</FieldDescription>
        </FieldContent>
        <Switch
          id={`${id}-enabled`}
          checked={enabled}
          onCheckedChange={(next) => onChange({ enabled: next, agentId })}
        />
      </Field>
      <Field orientation="horizontal" className="items-center">
        <FieldLabel htmlFor={`${id}-agent`}>Handled by</FieldLabel>
        <Select value={agentId ?? ""} onValueChange={(value) => onChange({ enabled, agentId: value })}>
          <SelectTrigger id={`${id}-agent`} size="sm" className="w-52 shrink-0">
            <SelectValue placeholder="Choose agent" />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  <AgentMark agent={agent} className="size-5" />
                  {agent.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

export function ScopedPullRequestMonitoring({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const allAgents = useStore((state) => state.agents);
  const loadBoard = useStore((state) => state.loadBoard);
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  const [policy, setPolicy] = useState<PullRequestMonitoringPolicy>();
  const query = `/pull-request-monitoring?${new URLSearchParams({ workspaceId })}`;

  useEffect(() => { void loadBoard().catch(() => {}); }, [loadBoard]);
  useEffect(() => {
    let current = true;
    void transport.request<{ policy: PullRequestMonitoringPolicy }>(serverId, query)
      .then((response) => {
        if (!current) return;
        setPolicy(response.policy);
      })
      .catch((error) => toast.error("Couldn't load pull request monitoring", { description: apiError(error) }));
    return () => { current = false; };
  }, [query, serverId]);

  const save = (next: { enabled: boolean; agentId: string | null }) => {
    setPolicy((current) => current ? { ...current, ...next, chatId: null, explicit: true, source: "workspace" } : current);
    void transport.request<{ policy: PullRequestMonitoringPolicy }>(serverId, query, { method: "PATCH", body: next })
      .then((response) => setPolicy(response.policy))
      .catch((error) => toast.error("Couldn't change pull request monitoring", { description: apiError(error) }));
  };
  const reset = () => {
    void transport.request<{ policy: PullRequestMonitoringPolicy }>(serverId, query, { method: "DELETE" })
      .then((response) => setPolicy(response.policy))
      .catch((error) => toast.error("Couldn't restore the default", { description: apiError(error) }));
  };

  if (!policy) return <p className="text-xs text-muted-foreground">Reading monitoring settings…</p>;
  return (
    <div className="flex flex-col gap-4">
      <PullRequestMonitoringFields
        id={`workspace-${workspaceId}`}
        enabled={policy.enabled}
        agentId={policy.agentId}
        agents={agents}
        description={policy.explicit ? "This choice overrides the inherited default." : "Using the Remy default."}
        onChange={save}
      />
      {policy.explicit && (
        <Button variant="ghost" size="sm" className="self-end" onClick={reset}>
          <RotateCcw /> Use default
        </Button>
      )}
    </div>
  );
}

export function PullRequestMonitoringButton({
  serverId,
  workspaceId,
  repository,
  number,
  chatId,
}: {
  serverId: string;
  workspaceId: string;
  repository: string;
  number: number;
  chatId: string;
}) {
  const allAgents = useStore((state) => state.agents);
  const loadBoard = useStore((state) => state.loadBoard);
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  const [policy, setPolicy] = useState<PullRequestMonitoringPolicy>();
  const query = useMemo(() => {
    const params = new URLSearchParams({ workspaceId, repository, number: String(number) });
    return `/pull-request-monitoring?${params}`;
  }, [number, repository, workspaceId]);

  useEffect(() => { void loadBoard().catch(() => {}); }, [loadBoard]);
  useEffect(() => {
    let current = true;
    void transport.request<{ policy: PullRequestMonitoringPolicy }>(serverId, query)
      .then((response) => { if (current) setPolicy(response.policy); })
      .catch((error) => toast.error("Couldn't load pull request monitoring", { description: apiError(error) }));
    return () => { current = false; };
  }, [query, serverId]);

  const save = (next: { enabled: boolean; agentId: string | null; chatId: string | null }) => {
    setPolicy((current) => current ? { ...current, ...next, explicit: true, source: "pull-request" } : current);
    void transport.request<{ policy: PullRequestMonitoringPolicy }>(serverId, query, { method: "PATCH", body: next })
      .then((response) => setPolicy(response.policy))
      .catch((error) => toast.error("Couldn't change pull request monitoring", { description: apiError(error) }));
  };
  const reset = () => {
    void transport.request<{ policy: PullRequestMonitoringPolicy }>(serverId, query, { method: "DELETE" })
      .then((response) => setPolicy(response.policy))
      .catch((error) => toast.error("Couldn't restore the workspace default", { description: apiError(error) }));
  };
  const value = !policy?.enabled
    ? "off"
    : policy.chatId
      ? `thread:${policy.chatId}`
      : policy.agentId
        ? `agent:${policy.agentId}`
        : "off";

  const choose = (next: string) => {
    if (next === "off") save({ enabled: false, agentId: null, chatId: null });
    if (next === `thread:${chatId}`) save({ enabled: true, agentId: null, chatId });
    if (next.startsWith("agent:")) save({ enabled: true, agentId: next.slice("agent:".length), chatId: null });
  };
  const label = policy?.enabled ? "Monitoring this pull request" : "Monitor this pull request";

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant={policy?.enabled ? "secondary" : "ghost"} size="icon-sm" aria-label={label}>
              <Radio />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Monitor pull request</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={choose}>
          <DropdownMenuRadioItem value="off"><CircleOff /> Off</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value={`thread:${chatId}`}><MessageSquare /> In this thread</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>With an agent</DropdownMenuLabel>
          {agents.map((agent) => (
            <DropdownMenuRadioItem key={agent.id} value={`agent:${agent.id}`}>
              <AgentMark agent={agent} className="size-5" />
              {agent.name}
            </DropdownMenuRadioItem>
          ))}
          {agents.length === 0 && (
            <DropdownMenuRadioItem value="no-agent" disabled><UserRound /> No agents available</DropdownMenuRadioItem>
          )}
        </DropdownMenuRadioGroup>
        {policy?.explicit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={reset}><RotateCcw /> Use workspace default</DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
