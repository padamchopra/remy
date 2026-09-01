import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
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
import { MarkdownPathField } from "@/components/MarkdownPathField";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiError } from "@/lib/api-error";
import { CADENCE_LABEL, CADENCES, WEEKDAYS } from "@/lib/tickets";
import { useStore } from "@/state/store";
import type { Cadence, Routine } from "@/state/types";

/// Edits a routine, or writes a new one when `creatingFor` names the agent to
/// start from. One dialog, because agent settings and the Routines tab are two
/// ways to the same thing.
export function RoutineDialog({
  routine,
  creatingFor,
  onOpenChange,
}: {
  routine?: Routine;
  creatingFor?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const agents = useStore((state) => state.agents);
  const saveRoutine = useStore((state) => state.saveRoutine);
  const deleteRoutine = useStore((state) => state.deleteRoutine);
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [promptPath, setPromptPath] = useState("");
  const [fromFile, setFromFile] = useState(false);
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [everyMinutes, setEveryMinutes] = useState(15);
  const [weekday, setWeekday] = useState(1);
  const [day, setDay] = useState(1);
  const [time, setTime] = useState("09:00");
  const [saving, setSaving] = useState(false);
  const open = Boolean(routine) || Boolean(creatingFor);

  useEffect(() => {
    if (!open) return;
    setAgentId(routine?.agentId ?? creatingFor ?? "");
    setName(routine?.name ?? "");
    setPrompt(routine?.prompt ?? "");
    setPromptPath(routine?.promptPath ?? "");
    setFromFile(Boolean(routine?.promptPath));
    setCadence(routine?.cadence ?? "weekly");
    setEveryMinutes(routine?.everyMinutes ?? 15);
    setWeekday(routine?.weekday ?? 1);
    setDay(routine?.day ?? 1);
    setTime(`${String(routine?.hour ?? 9).padStart(2, "0")}:${String(routine?.minute ?? 0).padStart(2, "0")}`);
  }, [open, routine, creatingFor]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (fromFile && !promptPath.trim()) {
      toast.error("Couldn't save that routine", { description: "pick a markdown file" });
      return;
    }
    const [hour, minute] = time.split(":").map(Number);
    setSaving(true);
    try {
      await saveRoutine(routine?.id, {
        agentId,
        name,
        prompt: fromFile ? "" : prompt,
        promptPath: fromFile ? promptPath : "",
        cadence,
        everyMinutes,
        weekday,
        day,
        hour,
        minute,
      });
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* The fields scroll, not the dialog, so Save is never below the fold. */}
        <form className="flex max-h-[80vh] min-h-0 flex-col gap-5" onSubmit={save}>
          <DialogHeader>
            <DialogTitle>{routine ? "Edit routine" : "New routine"}</DialogTitle>
            <DialogDescription>Choose an agent, what it does, and how often.</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
          <Field>
            <FieldLabel htmlFor="routine-agent">Agent</FieldLabel>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger id="routine-agent"><SelectValue placeholder="Pick an agent" /></SelectTrigger>
              <SelectContent>
                {agents.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription className="text-xs">Each run lands in this agent's conversation.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="routine-name">Name</FieldLabel>
            <Input id="routine-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </Field>
          <Field>
            <FieldLabel htmlFor={fromFile ? "routine-path" : "routine-prompt"}>Instruction</FieldLabel>
            <Tabs value={fromFile ? "file" : "text"} onValueChange={(value) => setFromFile(value === "file")}>
              <TabsList>
                <TabsTrigger value="text">Write it</TabsTrigger>
                <TabsTrigger value="file">Use a file</TabsTrigger>
              </TabsList>
            </Tabs>
            {fromFile ? (
              <>
                <MarkdownPathField
                  id="routine-path"
                  value={promptPath}
                  placeholder="Pick a markdown file"
                  onChange={setPromptPath}
                />
                <FieldDescription className="text-xs">
                  On the machine that runs it, read on every run.
                </FieldDescription>
              </>
            ) : (
              <Textarea
                id="routine-prompt"
                className="min-h-32"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                required
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="routine-cadence">How often</FieldLabel>
              <Select value={cadence} onValueChange={(value) => setCadence(value as Cadence)}>
                <SelectTrigger id="routine-cadence"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CADENCES.map((option) => (
                    <SelectItem key={option} value={option}>{CADENCE_LABEL[option]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {cadence === "interval" ? (
              <Field>
                <FieldLabel htmlFor="routine-minutes">Minutes apart</FieldLabel>
                <Input
                  id="routine-minutes"
                  type="number"
                  min={5}
                  max={1440}
                  value={everyMinutes}
                  onChange={(event) => setEveryMinutes(Number(event.target.value))}
                  required
                />
                <FieldDescription className="text-xs">Five minutes is the shortest.</FieldDescription>
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="routine-time">Time</FieldLabel>
                <Input
                  id="routine-time"
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  required
                />
              </Field>
            )}
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
          </div>
          <DialogFooter className="shrink-0 pr-1 sm:justify-between">
            {routine ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" className="text-destructive hover:text-destructive">
                    <Trash2 />
                    Delete routine
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {routine.name}?</AlertDialogTitle>
                    <AlertDialogDescription>This routine will not run again.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => void remove()}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : <span />}
            <Button type="submit" disabled={saving || !agentId}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
