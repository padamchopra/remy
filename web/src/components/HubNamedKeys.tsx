import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";

export type NamedKey = { id: string; name: string; active?: boolean };

type SecretField = { id: string; label: string; name?: string; secret?: boolean };

export function HubNamedKeys({
  label,
  keys,
  fields,
  busy,
  onSave,
  onRemove,
  onActivate,
}: {
  label: string;
  keys: NamedKey[];
  fields: SecretField[];
  busy: boolean;
  onSave: (input: { keyId?: string; name: string; values: Record<string, string> }) => Promise<void>;
  onRemove: (keyId: string) => Promise<void>;
  onActivate?: (keyId: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(keys.length === 0);
  const [editing, setEditing] = useState<string>();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {keys.length > 0 && (
        <ItemGroup className="min-w-0 gap-2">
          {keys.map((key) => (
            <Item key={key.id} variant="outline" className="min-w-0 flex-col items-stretch">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <ItemContent className="min-w-0 grow basis-[8rem]">
                  <ItemTitle className="w-full whitespace-normal break-words">{key.name}</ItemTitle>
                  <ItemDescription>{key.active ? "Used for new work." : "Saved."}</ItemDescription>
                </ItemContent>
                <ItemActions className="min-w-0 shrink flex-wrap">
                  {onActivate && !key.active && (
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void onActivate(key.id)}>
                      Use this key
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setEditing(key.id); setAdding(false); }}>
                    Update key
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void onRemove(key.id)}>
                    Remove
                  </Button>
                </ItemActions>
              </div>
              {editing === key.id && (
                <KeyForm
                  label={label}
                  name={key.name}
                  fields={fields}
                  busy={busy}
                  submit="Update key"
                  onCancel={() => setEditing(undefined)}
                  onSave={async (input) => {
                    await onSave({ keyId: key.id, ...input });
                    setEditing(undefined);
                  }}
                />
              )}
            </Item>
          ))}
        </ItemGroup>
      )}
      {adding ? (
        <KeyForm
          label={label}
          fields={fields}
          busy={busy}
          submit="Save key"
          onCancel={keys.length > 0 ? () => setAdding(false) : undefined}
          onSave={async (input) => {
            await onSave(input);
            setAdding(false);
          }}
        />
      ) : (
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={busy} onClick={() => { setAdding(true); setEditing(undefined); }}>
          Add key
        </Button>
      )}
    </div>
  );
}

function KeyForm({
  label,
  name: initialName = "",
  fields,
  busy,
  submit,
  onCancel,
  onSave,
}: {
  label: string;
  name?: string;
  fields: SecretField[];
  busy: boolean;
  submit: string;
  onCancel?: () => void;
  onSave: (input: { name: string; values: Record<string, string> }) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Field>
        <FieldLabel htmlFor={`${label}-key-name`}>Name</FieldLabel>
        <Input
          id={`${label}-key-name`}
          aria-label={`${label} key name`}
          autoComplete="off"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          required
        />
        <FieldDescription>So you can tell this key apart.</FieldDescription>
      </Field>
      {fields.map((field) => (
        <Field key={field.id}>
          <FieldLabel htmlFor={`${label}-${field.id}`}>{field.label}</FieldLabel>
          <Input
            id={`${label}-${field.id}`}
            aria-label={field.name ?? field.label}
            type={field.secret === false ? "text" : "password"}
            autoComplete="new-password"
            value={values[field.id] ?? ""}
            onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
            disabled={busy}
            required={!initialName}
          />
        </Field>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || !name.trim() || (!initialName && fields.some((field) => !values[field.id]?.trim()))}
          onClick={() => void onSave({ name: name.trim(), values })}
        >
          {busy && <Spinner data-icon="inline-start" />}
          {submit}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
