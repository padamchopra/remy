import { useEffect, useState } from "react";
import { Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiError } from "@/lib/api-error";
import { cadenceSummary, WEEKDAYS, whenNext } from "@/lib/tickets";
import { useStore } from "@/state/store";
import type { Agent, Cadence, Routine } from "@/state/types";

const CADENCES: { value: Cadence; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

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
                <ItemDescription className="text-xs">
                  {cadenceSummary(routine)}{routine.enabled ? ` · due ${whenNext(routine.nextRunAt)}` : " · paused"}
                </ItemDescription>
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

function RoutineDialog({ routine, onOpenChange }: { routine?: Routine; onOpenChange: (open: boolean) => void }) {
  const saveRoutine = useStore((state) => state.saveRoutine);
  const deleteRoutine = useStore((state) => state.deleteRoutine);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [weekday, setWeekday] = useState(1);
  const [day, setDay] = useState(1);
  const [time, setTime] = useState("09:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!routine) return;
    setName(routine.name);
    setPrompt(routine.prompt);
    setCadence(routine.cadence);
    setWeekday(routine.weekday ?? 1);
    setDay(routine.day ?? 1);
    setTime(`${String(routine.hour).padStart(2, "0")}:${String(routine.minute).padStart(2, "0")}`);
  }, [routine]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!routine) return;
    const [hour, minute] = time.split(":").map(Number);
    setSaving(true);
    try {
      await saveRoutine(routine.id, { name, prompt, cadence, weekday, day, hour, minute });
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't save that routine", { description: apiError(error) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!routine) return;
    try {
      await deleteRoutine(routine.id);
      onOpenChange(false);
      toast.success(`Deleted ${routine.name}.`);
    } catch (error) {
      toast.error("Couldn't delete that routine", { description: apiError(error) });
    }
  };

  return (
    <Dialog open={Boolean(routine)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form className="flex flex-col gap-5" onSubmit={save}>
          <DialogHeader>
            <DialogTitle>Edit routine</DialogTitle>
            <DialogDescription>Change what this agent does and when it starts.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="routine-name">Name</FieldLabel>
            <Input id="routine-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="routine-prompt">Instruction</FieldLabel>
            <Textarea
              id="routine-prompt"
              rows={7}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="routine-cadence">How often</FieldLabel>
              <Select value={cadence} onValueChange={(value) => setCadence(value as Cadence)}>
                <SelectTrigger id="routine-cadence"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CADENCES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="routine-time">Time</FieldLabel>
              <Input id="routine-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
            </Field>
            {cadence === "weekly" && (
              <Field>
                <FieldLabel htmlFor="routine-weekday">Day of the week</FieldLabel>
                <Select value={String(weekday)} onValueChange={(value) => setWeekday(Number(value))}>
                  <SelectTrigger id="routine-weekday"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((label, index) => <SelectItem key={label} value={String(index)}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {cadence === "monthly" && (
              <Field>
                <FieldLabel htmlFor="routine-day">Day of the month</FieldLabel>
                <Select value={String(day)} onValueChange={(value) => setDay(Number(value))}>
                  <SelectTrigger id="routine-day"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 28 }, (_, index) => index + 1).map((value) => (
                      <SelectItem key={value} value={String(value)}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
          <DialogFooter className="sm:justify-between">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" className="text-destructive hover:text-destructive">
                  <Trash2 />
                  Delete routine
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {routine?.name}?</AlertDialogTitle>
                  <AlertDialogDescription>This routine will not run again.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void remove()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
