import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { SettingsList, SettingsRow } from "./SettingsList";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./ui/menu-base";

export type NamedKey = { id: string; name: string; active?: boolean };
export type SecretField = { id: string; label: string; secret?: boolean; placeholder?: string };
export type KeyInput = { keyId?: string; name: string; values: Record<string, string> };

const small = "h-7 rounded-lg px-2.5 text-xs";

/// An account's saved keys for one integration: new work uses the active one.
/// Values never come back; replacing one asks for it again.
export function HubKeyList({ label, keys, fields, busy, readOnly, adding, setAdding, onSave, onRemove, onActivate }: {
  label: string;
  keys: NamedKey[];
  fields: SecretField[];
  busy: boolean;
  readOnly?: boolean;
  adding: boolean;
  setAdding: (adding: boolean) => void;
  onSave: (input: KeyInput) => Promise<void>;
  onRemove: (keyId: string) => Promise<void>;
  onActivate?: (keyId: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string>();
  if (!keys.length && !adding) return null;
  return <SettingsList label={`${label} keys`}>
    {keys.map(key => <SettingsRow
      key={key.id}
      title={<span className="flex min-w-0 items-center gap-2"><span className="min-w-0 break-words">{key.name}</span>{key.active && <span className="shrink-0 rounded-[5px] bg-success/15 px-1.5 py-0.5 text-[11px] leading-[14px] font-medium text-success">Active</span>}</span>}
      description={key.active ? "Used for new threads" : "Not in use"}
      below={editing === key.id && <KeyForm label={label} name={key.name} existing fields={fields} busy={busy} submit="Save key" onCancel={() => setEditing(undefined)} onSave={async input => { await onSave({ keyId: key.id, ...input }); setEditing(undefined); }} />}
    >
      {!readOnly && <>
        {onActivate && !key.active
          ? <Button size="sm" variant="outline" className={small} disabled={busy} onClick={() => void onActivate(key.id)}>Make active</Button>
          : <Button size="sm" variant="outline" className={small} disabled={busy} onClick={() => { setEditing(key.id); setAdding(false); }}>Replace</Button>}
        <Menu>
          <MenuTrigger render={<Button size="icon" variant="ghost" className="size-7 rounded-lg" aria-label={`More for ${key.name}`} disabled={busy} />}>
            <MoreHorizontal className="size-4" />
          </MenuTrigger>
          <MenuContent align="end">
            {onActivate && !key.active && <MenuItem onClick={() => { setEditing(key.id); setAdding(false); }}>Replace</MenuItem>}
            <MenuItem className="text-destructive data-highlighted:text-destructive" onClick={() => void onRemove(key.id)}>Remove</MenuItem>
          </MenuContent>
        </Menu>
      </>}
    </SettingsRow>)}
    {adding && !readOnly && <SettingsRow title={`Add ${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`} description="Name it so you can tell your keys apart." below={<KeyForm label={label} fields={fields} busy={busy} submit="Save key" name={keys.length ? "" : "Default"} onCancel={keys.length ? () => setAdding(false) : undefined} onSave={async input => { await onSave(input); setAdding(false); }} />} />}
  </SettingsList>;
}

export function KeyForm({ label, name: initialName = "", existing, fields, busy, submit, onCancel, onSave }: {
  label: string;
  name?: string;
  /// Renaming or replacing a saved key: its values may stay as they are.
  existing?: boolean;
  fields: SecretField[];
  busy: boolean;
  submit: string;
  onCancel?: () => void;
  onSave: (input: { name: string; values: Record<string, string> }) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [values, setValues] = useState<Record<string, string>>({});
  const ready = !!name.trim() && fields.every(field => existing || !!(values[field.id] ?? "").trim());
  return <form className="flex min-w-0 max-w-lg flex-col gap-3" onSubmit={event => { event.preventDefault(); if (ready) void onSave({ name: name.trim(), values }); }}>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">
        Name
        <Input aria-label={`${label} name`} autoComplete="off" value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} />
      </label>
      {fields.map(field => <label key={field.id} className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">
        {field.label}
        <Input aria-label={field.label} type={field.secret === false ? "text" : "password"} autoComplete="new-password" placeholder={field.placeholder} className="font-mono text-xs" value={values[field.id] ?? ""} disabled={busy} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))} />
      </label>)}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" disabled={busy || !ready}>{busy && <Spinner data-icon="inline-start" />}{submit}</Button>
      {onCancel && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>}
    </div>
  </form>;
}
