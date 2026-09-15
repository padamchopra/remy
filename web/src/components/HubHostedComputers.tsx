import { HubRouterConnection } from "./HubRouterConnection";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { HubCloudConnection } from "./HubCloudConnection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@/components/ui/select";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { useHubResource } from "@/lib/hub-organization";

export function HubHostedComputers({organizationId, admin}: {organizationId:string; admin:boolean}) {
  const base = `${hubThreadBase(organizationId)}/hosted`;
  const resource = useHubResource<{secretNames:string[]; routerConfigured?:boolean; enabledProviders?:string[]; available:boolean}>(organizationId,"/hosted");
  const [enabledProviders, setEnabledProviders] = useState<string[]>([]);
  const [routerConfigured,setRouterConfigured]=useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [keyName, setKeyName] = useState("ANTHROPIC_API_KEY");
  const [keyValue, setKeyValue] = useState("");
  const [keyEditing, setKeyEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [availability, setAvailability] = useState<boolean>();
  const loading = !resource.value;
  useEffect(() => { setNames(resource.value?.secretNames ?? []); setRouterConfigured(resource.value?.routerConfigured ?? false); setEnabledProviders(resource.value?.enabledProviders ?? []); }, [resource.value]);
  const save = async (input: unknown) => {
    setBusy(true); setError(""); setSaved(false);
    try {
      await hubRequest(base,"PUT",input);
      const next = await hubRequest<{secretNames:string[]}>(base);
      setNames(next.secretNames); setKeyValue(""); setKeyEditing(false); setSaved(true);
    } catch (e) {setError(e instanceof Error ? e.message : "Your model access could not be saved.");}
    finally {setBusy(false);}
  };
  return <section aria-label="Cloud settings" className="flex w-full max-w-2xl flex-col gap-8">
    <HubCloudConnection key={organizationId} organizationId={organizationId} admin={admin} onChange={setEnabledProviders} />
    {resource.error && <p role="alert">{resource.error}</p>}
    {resource.value && !(availability ?? resource.value.available) && <div className="flex items-center gap-3"><p className="text-sm text-muted-foreground">Cloud computers are temporarily unavailable.</p><Button variant="outline" onClick={async () => { try { const next = await hubRequest<{available:boolean}>(base); setAvailability(next.available); } catch { setError("Cloud availability could not be checked. Try again."); } }}>Check availability again</Button></div>}
    {admin && enabledProviders.length > 0 && (
          <section aria-label="Model access" className="space-y-4 border-t pt-6">
            <h2 className="text-sm font-medium">Model access</h2>
            <div className="divide-y">
              {[["ANTHROPIC_API_KEY", "Anthropic"], ["OPENAI_API_KEY", "OpenAI"]].map(([name, label]) => <div key={name} className="flex items-center gap-3 py-3">
                <KeyRound className="size-4 text-muted-foreground" /><span className="flex-1 text-sm">{label}</span><span className="text-xs text-muted-foreground">{names.includes(name) ? "Configured" : "Not configured"}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => { setKeyName(name); setKeyValue(""); setKeyEditing(true); }}>{names.includes(name) ? "Manage" : "Configure"}</Button>
              </div>)}
              <HubRouterConnection organizationId={organizationId} configured={routerConfigured} changed={async () => { const next=await hubRequest<{routerConfigured:boolean}>(base); setRouterConfigured(next.routerConfigured); }} />
            </div>
            {keyEditing &&
          <form
            className="flex flex-col gap-3 rounded-lg bg-muted/30 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ secret: { name: keyName, value: keyValue } });
            }}
          >
            <Field>
              <FieldLabel>Default model key</FieldLabel>
              <Select value={keyName} onValueChange={setKeyName}>
                <SelectTrigger aria-label="Default model key">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="ANTHROPIC_API_KEY">Anthropic</SelectItem>
                    <SelectItem value="OPENAI_API_KEY">OpenAI</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {names.includes(keyName)
                  ? "Your key is configured."
                  : "Add your API key to run hosted threads."}
              </FieldDescription>
            </Field>
            <Input
              aria-label="API key"
              type="password"
              autoComplete="off"
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              required
              maxLength={8192}
            />
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => { setKeyEditing(false); setKeyValue(""); }}>Cancel</Button>
              <Button type="submit" disabled={busy || !keyValue}>
                Save key
              </Button>
              {names.includes(keyName) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || loading}
                  onClick={() =>
                    void save({ secret: { name: keyName, value: null } })
                  }
                >
                  Remove key
                </Button>
              )}
            </div>
          </form>}
          </section>
    )}
    {saved && <p role="status">Your model access is saved.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
