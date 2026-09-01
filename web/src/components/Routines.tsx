import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { RoutineDialog } from "@/components/RoutineDialog";
import { apiError } from "@/lib/api-error";
import { routineSummary } from "@/lib/tickets";
import { useStore } from "@/state/store";
import type { Agent, Routine } from "@/state/types";

/// Every routine across every agent, so what is scheduled is in one place. The
/// agent still owns it: a row opens the conversation its runs land in.
export function Routines({ agents, onOpenAgent }: { agents: Agent[]; onOpenAgent: (handle: string) => void }) {
  const routines = useStore((state) => state.routines);
  const saveRoutine = useStore((state) => state.saveRoutine);
  const [editing, setEditing] = useState<Routine>();
  const [creatingFor, setCreatingFor] = useState<string>();

  const toggle = async (routine: Routine, enabled: boolean) => {
    try {
      await saveRoutine(routine.id, { enabled });
    } catch (error) {
      toast.error("Couldn't change that routine", { description: apiError(error) });
    }
  };

  const close = () => {
    setEditing(undefined);
    setCreatingFor(undefined);
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium">Routines</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={agents.length === 0}
          onClick={() => setCreatingFor(agents[0]?.id)}
        >
          <Plus />
          New routine
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {routines.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyTitle>No routines yet</EmptyTitle>
              <EmptyDescription>
                Write one to hand an agent work on a cadence, or ask the agent for it in its conversation.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-2 p-4">
            {routines.map((routine) => {
              const agent = agents.find((entry) => entry.id === routine.agentId);
              return (
                <Item
                  key={`${routine.serverId}:${routine.id}`}
                  variant="outline"
                  size="sm"
                  data-link
                  onClick={() => agent && onOpenAgent(agent.handle)}
                >
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full whitespace-normal break-words">
                      {routine.name}
                      {agent ? <span className="ml-2 font-normal text-muted-foreground">@{agent.handle}</span> : null}
                    </ItemTitle>
                    <ItemDescription className="text-xs">{routineSummary(routine)}</ItemDescription>
                    {routine.lastError ? (
                      <ItemDescription className="text-xs text-destructive">{routine.lastError}</ItemDescription>
                    ) : null}
                  </ItemContent>
                  <ItemActions className="ml-auto shrink-0" onClick={(event) => event.stopPropagation()}>
                    <Switch
                      checked={routine.enabled}
                      aria-label={`${routine.enabled ? "Pause" : "Resume"} ${routine.name}`}
                      onCheckedChange={(enabled) => void toggle(routine, enabled)}
                    />
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(routine)}>
                      Edit
                    </Button>
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
        )}
      </ScrollArea>
      <RoutineDialog
        routine={editing}
        {...(creatingFor ? { creatingFor } : {})}
        onOpenChange={(open) => !open && close()}
      />
    </main>
  );
}
