import { useCallback, useEffect, useMemo, useState } from "react";
import { Radio, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { AgentMark } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiError } from "@/lib/api-error";
import { transport } from "@/lib/transport";
import { useStore } from "@/state/store";
import type { Agent } from "@/state/types";

export interface PullRequestMonitoringPolicy {
  enabled: boolean;
  agentId: string | null;
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
  repository,
  number,
  compact = false,
  onPolicyChange,
}: {
  serverId: string;
  workspaceId: string;
  repository?: string;
  number?: number;
  compact?: boolean;
  onPolicyChange?: (policy: PullRequestMonitoringPolicy) => void;
}) {
  const allAgents = useStore((state) => state.agents);
  const loadBoard = useStore((state) => state.loadBoard);
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  const [policy, setPolicy] = useState<PullRequestMonitoringPolicy>();
  const query = useMemo(() => {
    const params = new URLSearchParams({ workspaceId });
    if (repository && number) {
      params.set("repository", repository);
      params.set("number", String(number));
    }
    return `/pull-request-monitoring?${params}`;
  }, [number, repository, workspaceId]);

  useEffect(() => { void loadBoard().catch(() => {}); }, [loadBoard]);
  useEffect(() => {
    let current = true;
    void transport.request<{ policy: PullRequestMonitoringPolicy }>(serverId, query)
      .then((response) => {
        if (!current) return;
        setPolicy(response.policy);
        onPolicyChange?.(response.policy);
      })
      .catch((error) => toast.error("Couldn't load pull request monitoring", { description: apiError(error) }));
    return () => { current = false; };
  }, [onPolicyChange, query, serverId]);

  const save = (next: { enabled: boolean; agentId: string | null }) => {
    setPolicy((current) => current ? { ...current, ...next, explicit: true, source: repository ? "pull-request" : "workspace" } : current);
    void transport.request<{ policy: PullRequestMonitoringPolicy }>(serverId, query, { method: "PATCH", body: next })
      .then((response) => { setPolicy(response.policy); onPolicyChange?.(response.policy); })
      .catch((error) => toast.error("Couldn't change pull request monitoring", { description: apiError(error) }));
  };
  const reset = () => {
    void transport.request<{ policy: PullRequestMonitoringPolicy }>(serverId, query, { method: "DELETE" })
      .then((response) => { setPolicy(response.policy); onPolicyChange?.(response.policy); })
      .catch((error) => toast.error("Couldn't restore the default", { description: apiError(error) }));
  };

  if (!policy) return <p className="text-xs text-muted-foreground">Reading monitoring settings…</p>;
  const inheritedFrom = repository ? "workspace or Remy default" : "Remy default";
  return (
    <div className={compact ? "flex flex-col gap-3" : "flex flex-col gap-4"}>
      <PullRequestMonitoringFields
        id={repository ? `pull-request-${number}` : `workspace-${workspaceId}`}
        enabled={policy.enabled}
        agentId={policy.agentId}
        agents={agents}
        description={policy.explicit ? "This choice overrides the inherited default." : `Using the ${inheritedFrom}.`}
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
}: {
  serverId: string;
  workspaceId: string;
  repository: string;
  number: number;
}) {
  const [enabled, setEnabled] = useState(false);
  const handlePolicyChange = useCallback((policy: PullRequestMonitoringPolicy) => setEnabled(policy.enabled), []);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Monitor this pull request">
          <Radio className={enabled ? "text-success-foreground" : undefined} /> {enabled ? "Monitoring" : "Monitor"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="mb-4">
          <p className="text-sm font-medium">Monitor this pull request</p>
          <p className="mt-1 text-xs text-muted-foreground">Choose whether Remy watches it and which agent handles it.</p>
        </div>
        <ScopedPullRequestMonitoring
          serverId={serverId}
          workspaceId={workspaceId}
          repository={repository}
          number={number}
          compact
          onPolicyChange={handlePolicyChange}
        />
      </PopoverContent>
    </Popover>
  );
}
