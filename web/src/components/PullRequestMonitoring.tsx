import { useEffect, useMemo, useState } from "react";
import { CircleOff, MessageSquare, Radio } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiError } from "@/lib/api-error";
import { transport } from "@/lib/transport";

export interface PullRequestMonitoringPolicy {
  enabled: boolean;
  chatId: string | null;
  source: "pull-request";
  explicit: boolean;
}

/// A pull request is followed by one thread, or by nobody, so the menu is those
/// two answers and nothing else.
export function PullRequestMonitoringButton({
  serverId,
  repository,
  number,
  chatId,
}: {
  serverId: string;
  repository: string;
  number: number;
  chatId: string;
}) {
  const [policy, setPolicy] = useState<PullRequestMonitoringPolicy>();
  const query = useMemo(() => {
    const params = new URLSearchParams({ repository, number: String(number) });
    return `/pull-request-monitoring?${params}`;
  }, [number, repository]);

  useEffect(() => {
    let current = true;
    void transport.request<{ policy: PullRequestMonitoringPolicy }>(serverId, query)
      .then((response) => { if (current) setPolicy(response.policy); })
      .catch((error) => toast.error("Couldn't load pull request monitoring", { description: apiError(error) }));
    return () => { current = false; };
  }, [query, serverId]);

  const save = (next: { enabled: boolean; chatId: string | null }) => {
    setPolicy((current) => current ? { ...current, ...next, explicit: true } : current);
    void transport.request<{ policy: PullRequestMonitoringPolicy }>(serverId, query, { method: "PATCH", body: next })
      .then((response) => setPolicy(response.policy))
      .catch((error) => toast.error("Couldn't change pull request monitoring", { description: apiError(error) }));
  };
  // Keyed on the thread that holds it, so a pull request another thread is
  // already following does not read as this one's.
  const value = policy?.enabled && policy.chatId ? `thread:${policy.chatId}` : "off";
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
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) =>
            save(next === "off" ? { enabled: false, chatId: null } : { enabled: true, chatId })
          }
        >
          <DropdownMenuRadioItem value="off"><CircleOff /> Off</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value={`thread:${chatId}`}><MessageSquare /> In this thread</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
