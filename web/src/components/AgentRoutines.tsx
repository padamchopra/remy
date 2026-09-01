import { useState } from "react";
import { Pencil, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { RoutineDialog } from "@/components/RoutineDialog";
import { Switch } from "@/components/ui/switch";
import { apiError } from "@/lib/api-error";
import { routineSummary } from "@/lib/tickets";
import { useStore } from "@/state/store";
import type { Agent, Routine } from "@/state/types";

export function AgentRoutines({ agent }: { agent: Agent }) {
  const routines = useStore((state) => state.routines).filter((routine) => routine.agentId === agent.id);
  const saveRoutine = useStore((state) => state.saveRoutine);
  const runRoutine = useStore((state) => state.runRoutine);
  const [editing, setEditing] = useState<Routine>();

  const toggle = async (routine: Routine, enabled: boolean) => {
    try {
      await saveRoutine(routine.id, { enabled });
    } catch (error) {
      toast.error("Couldn't change that routine", { description: apiError(error) });
    }
  };

  const run = async (routine: Routine) => {
    try {
      await runRoutine(routine.id);
      toast.success(`Started ${routine.name}.`);
    } catch (error) {
      toast.error("Couldn't run that routine", { description: apiError(error) });
    }
  };

  return (
    <Field>
      <FieldLabel>Routines</FieldLabel>
      <FieldDescription className="text-xs">
        Ask {agent.name} in Inbox to create work that repeats.
      </FieldDescription>
      {routines.length === 0 ? (
        <Item variant="outline" size="sm">
          <ItemContent>
            <ItemTitle>No routines yet</ItemTitle>
            <ItemDescription className="text-xs">Ask {agent.name} to repeat something on a cadence.</ItemDescription>
          </ItemContent>
        </Item>
      ) : (
        <ItemGroup className="gap-2">
          {routines.map((routine) => (
            <Item key={routine.id} variant="outline" size="sm">
              <ItemContent className="min-w-0">
                <ItemTitle className="truncate">{routine.name}</ItemTitle>
                <ItemDescription className="text-xs">{routineSummary(routine)}</ItemDescription>
                {routine.lastError ? (
                  <ItemDescription className="text-xs text-destructive">{routine.lastError}</ItemDescription>
                ) : null}
              </ItemContent>
              <ItemActions className="ml-auto">
                <Switch
                  checked={routine.enabled}
                  aria-label={`${routine.enabled ? "Pause" : "Resume"} ${routine.name}`}
                  onCheckedChange={(enabled) => void toggle(routine, enabled)}
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => void run(routine)}>
                  <Play />
                  Run
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(routine)}>
                  <Pencil />
                  Edit
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
      <RoutineDialog routine={editing} onOpenChange={(open) => !open && setEditing(undefined)} />
    </Field>
  );
}
