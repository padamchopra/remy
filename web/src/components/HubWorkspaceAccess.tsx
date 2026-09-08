import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldSet,
  FieldLegend,
  FieldLabel,
} from "@/components/ui/field";
import type { HubPeople } from "@/lib/hub-organization";
export type WorkspaceAccess = { userIds: string[]; teamIds: string[] };
export function HubWorkspaceAccess({
  people,
  value,
  onChange,
}: {
  people: HubPeople;
  value: WorkspaceAccess;
  onChange: (value: WorkspaceAccess) => void;
}) {
  const toggle = (key: keyof WorkspaceAccess, id: string, checked: boolean) =>
    onChange({
      ...value,
      [key]: checked ? [...value[key], id] : value[key].filter((v) => v !== id),
    });
  return (
    <>
      {(["userIds", "teamIds"] as const).map((key) => (
        <FieldSet key={key}>
          <FieldLegend>{key === "userIds" ? "Members" : "Teams"}</FieldLegend>
          {(key === "userIds"
            ? people.members.map((m) => ({ id: m.userId, name: m.name }))
            : people.teams
          ).map((item) => (
            <Field orientation="horizontal" key={item.id}>
              <Checkbox
                id={`${key}-${item.id}`}
                checked={value[key].includes(item.id)}
                onCheckedChange={(v) => toggle(key, item.id, v === true)}
              />
              <FieldLabel htmlFor={`${key}-${item.id}`}>{item.name}</FieldLabel>
            </Field>
          ))}
        </FieldSet>
      ))}
    </>
  );
}
