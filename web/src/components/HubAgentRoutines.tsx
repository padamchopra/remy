import { useEffect, useState } from "react";
import type { BoardProjection } from "@remy/contract";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { watchHubResource } from "@/lib/hub-computers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
export function HubAgentRoutines({
  organizationId,
  agentId,
}: {
  organizationId: string;
  agentId: string;
}) {
  const base = hubThreadBase(organizationId),
    [routines, setRoutines] = useState<BoardProjection[]>([]),
    [error, setError] = useState("");
  useEffect(
    () =>
      watchHubResource<{ items: BoardProjection[] }>(
        `${base}/board/routines`,
        (v) =>
          setRoutines(
            (v?.items ?? []).filter((r) => r.fields.agentId === agentId),
          ),
        setError,
        `${base}/board/live`,
      ),
    [base, agentId],
  );
  const change = async (
    id: string,
    kind: string,
    payload: Record<string, unknown>,
  ) => {
    try {
      await hubRequest(`${base}/board/events`, "POST", {
        entity: "recurrence",
        entityId: id,
        kind,
        payload,
      });
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This routine could not be saved.",
      );
    }
  };
  return (
    <section className="flex flex-col gap-3" aria-label="Agent routines">
      <h3>Routines</h3>
      {!routines.length && (
        <p className="text-sm text-muted-foreground">
          Ask this agent when you want work repeated.
        </p>
      )}
      {routines.map((r) => (
        <form
          key={`${r.id}:${r.updatedAt}`}
          className="flex flex-wrap gap-3 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget),
              [hour, minute] = String(f.get("time")).split(":").map(Number);
            void change(r.id, "field", {
              name: String(f.get("name")),
              hour,
              minute,
              timeZone: String(f.get("zone")),
              cadence: String(f.get("cadence")),
            });
          }}
        >
          <Field className="basis-48 grow">
            <FieldLabel htmlFor={`routine-${r.id}`}>Routine name</FieldLabel>
            <Input
              id={`routine-${r.id}`}
              name="name"
              defaultValue={String(r.fields.name)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`time-${r.id}`}>Time</FieldLabel>
            <Input
              id={`time-${r.id}`}
              name="time"
              type="time"
              defaultValue={`${String(r.fields.hour).padStart(2, "0")}:${String(r.fields.minute).padStart(2, "0")}`}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`zone-${r.id}`}>Time zone</FieldLabel>
            <Input
              id={`zone-${r.id}`}
              name="zone"
              defaultValue={String(r.fields.timeZone ?? "UTC")}
            />
          </Field>
          <Field>
            <FieldLabel>Repeats</FieldLabel>
            <Select name="cadence" defaultValue={String(r.fields.cadence)}>
              <SelectTrigger aria-label={`Repeat ${r.fields.name}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  ["daily", "Daily"],
                  ["weekdays", "Weekdays"],
                  ["weekly", "Weekly"],
                  ["monthly", "Monthly"],
                ].map(([v, l]) => (
                  <SelectItem key={v} value={v!}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Save routine</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void change(r.id, "field", { enabled: !r.fields.enabled })
              }
            >
              {r.fields.enabled ? "Pause routine" : "Resume routine"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void change(r.id, "tombstone", {})}
            >
              Remove routine
            </Button>
          </div>
          {!!r.fields.lastError && (
            <p role="status">{String(r.fields.lastError)}</p>
          )}
        </form>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
