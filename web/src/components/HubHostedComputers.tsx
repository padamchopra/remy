import { HubCodexAccount } from "./HubCodexAccount";
import { usePersonalHub } from "@/lib/hub-scope";
import { useEffect, useState } from "react";
import {
  hostedSettingsSchema,
  type HostedComputerState,
  type HostedSettings,
} from "@remy/contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { useHubResource, type HubWorkspace } from "@/lib/hub-organization";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Modal Sandbox USD rates checked 2026-09-10: https://modal.com/pricing.
const hourlyCompute = (cpu: number, memoryMiB: number) =>
  ((cpu * 0.00003942 + (memoryMiB / 1024) * 0.00000667) * 3600).toFixed(2);

const sizes = [
  {
    id: "light",
    label: "Light",
    cpu: 0.5,
    memoryMiB: 1024,
    description: "Small edits and occasional tasks.",
  },
  {
    id: "standard",
    label: "Standard",
    cpu: 1,
    memoryMiB: 2048,
    description: "Recommended for everyday coding and tests.",
  },
  {
    id: "heavy",
    label: "Heavy",
    cpu: 4,
    memoryMiB: 8192,
    description: "More room for large builds and demanding tasks.",
  },
] as const;

type Response = {
  settings: HostedSettings;
  secretNames: string[];
  available: boolean;
};
export function HubHostedComputers({
  organizationId,
  admin,
}: {
  organizationId: string;
  admin: boolean;
}) {
  const isPersonal = usePersonalHub();
  const workspaces = useHubResource<{ workspaces: HubWorkspace[] }>(
    organizationId,
    "/workspaces",
  );
  const [workspace, setWorkspace] = useState("");
  const [customize, setCustomize] = useState(false);
  const [customSize, setCustomSize] = useState(false);
  const [settings, setSettings] = useState<HostedSettings>(
    hostedSettingsSchema.parse({}),
  );
  const [available, setAvailable] = useState(false),
    [names, setNames] = useState<string[]>([]),
    [state, setState] = useState<HostedComputerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [watching, setWatching] = useState(false),
    [saved, setSaved] = useState(false);
  const [keyName, setKeyName] = useState("ANTHROPIC_API_KEY"),
    [keyValue, setKeyValue] = useState("");
  const base = `${hubThreadBase(organizationId)}/hosted`,
    path = workspace ? `${base}/${workspace}/settings` : base;
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setSaved(false);
    setState(null);
    setWatching(false);
    void hubRequest<Response>(path)
      .then(async (data) => {
        if (!current) return;
        setSettings(data.settings);
        setCustomize(false);
        setCustomSize(false);
        setNames(data.secretNames);
        setAvailable(data.available);
        if (workspace) {
          const result = await hubRequest<{
            state: HostedComputerState | null;
          }>(`${base}/${workspace}`);
          if (!current) return;
          setState(result.state);

        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [path, base, workspace]);
  useEffect(() => {
    if (!workspace || !watching) return;
    let stopped = false;
    const timer = setInterval(() => {
      void hubRequest<{ state: HostedComputerState | null }>(
        `${base}/${workspace}`,
      )
        .then(({ state }) => {
          if (stopped) return;
          setState(state);
          if (state && ["ready", "failed", "asleep"].includes(state.phase))
            setWatching(false);
        })
        .catch((e) => {
          if (!stopped) {
            setError(e.message);
            setWatching(false);
          }
        });
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [watching, workspace, base]);
  const save = async (input: unknown) => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await hubRequest(path, "PUT", input);
      setSaved(true);
      const data = await hubRequest<Response>(path);
      setSettings(data.settings);
      setNames(data.secretNames);
      setKeyValue("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your settings could not save.",
      );
    } finally {
      setBusy(false);
    }
  };
  const size = sizes.find(
    (size) =>
      size.cpu === settings.cpu && size.memoryMiB === settings.memoryMiB,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cloud execution</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel>Settings for</FieldLabel>
          <Select
            value={workspace || "organization"}
            onValueChange={(v) => setWorkspace(v === "organization" ? "" : v)}
          >
            <SelectTrigger aria-label="Hosted workspace">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="organization">
                  {isPersonal ? "Personal defaults" : "Organization defaults"}
                </SelectItem>
                {workspaces.value?.workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            Each workspace inherits your defaults until you change them.
          </FieldDescription>
        </Field>
        {!available && (
          <p role="status">
            Your hub needs a configured hosted computer provider.
          </p>
        )}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ settings });
          }}
        >
          <FieldGroup>
            <Field orientation="horizontal" className="sm:col-span-2">
              <Switch
                id="hosted-enabled"
                checked={settings.enabled}
                disabled={!admin || busy || loading}
                onCheckedChange={(enabled) =>
                  setSettings({ ...settings, enabled })
                }
              />
              <FieldLabel htmlFor="hosted-enabled">
                Allow hosted computers
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel>Provider</FieldLabel>
              <Select
                value={settings.provider}
                disabled={!admin || busy || loading}
                onValueChange={(provider) =>
                  setSettings({
                    ...settings,
                    provider: provider as HostedSettings["provider"],
                  })
                }
              >
                <SelectTrigger aria-label="Hosted provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="fly-sprites">Fly Sprites</SelectItem>
                    <SelectItem value="modal">Modal</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Computer size</FieldLabel>
              {settings.provider === "fly-sprites" ? (
                <FieldDescription>
                  Fly Sprites manages your resources automatically.
                </FieldDescription>
              ) : (
                <>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    aria-label="Computer size"
                    className="grid w-full max-w-sm grid-cols-4 items-stretch"
                    value={customSize ? "custom" : (size?.id ?? "custom")}
                    disabled={!admin || busy || loading}
                    onValueChange={(id) => {
                      if (!id) return;
                      if (id === "custom") {
                        setCustomize(true);
                        setCustomSize(true);
                        return;
                      }
                      setCustomSize(false);
                      const next = sizes.find((size) => size.id === id);
                      if (next)
                        setSettings({
                          ...settings,
                          cpu: next.cpu,
                          memoryMiB: next.memoryMiB,
                        });
                    }}
                  >
                    {sizes.map((size) => (
                      <ToggleGroupItem key={size.id} value={size.id} aria-label={size.label} className="h-auto flex-col gap-1 px-1 py-2">
                        <span>{size.label}</span>
                        <span className="text-xs font-normal">~${hourlyCompute(size.cpu, size.memoryMiB)}/hr</span>
                      </ToggleGroupItem>
                    ))}
                    <ToggleGroupItem value="custom" className="h-auto">Custom</ToggleGroupItem>
                  </ToggleGroup>
                  <FieldDescription>
                    {size?.description ?? "Your custom resource allocation."}{" "}
                    {settings.cpu} CPU cores · {settings.memoryMiB / 1024} GiB memory.
                  </FieldDescription>
                  <FieldDescription role="status">
                    About ${hourlyCompute(settings.cpu, settings.memoryMiB)} USD per running hour at your selected resources, including warm idle time.
                  </FieldDescription>
                  <FieldDescription>
                    Extra usage and region surcharges cost more; storage and model charges are separate, before credits and taxes.{" "}
                    <a href="https://modal.com/pricing" target="_blank" rel="noreferrer" className="underline underline-offset-4">Modal pricing</a>
                  </FieldDescription>
                </>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="cloud-concurrency">Concurrent cloud computers</FieldLabel>
              <Input id="cloud-concurrency" type="number" min={1} max={100} value={settings.maxComputers} disabled={!admin || busy || loading} onChange={e=>setSettings({...settings,maxComputers:Number(e.target.value)})} />
              <FieldDescription>Each task gets a separate computer; idle computers sleep and keep their work for later.</FieldDescription>
            </Field>
            <Collapsible open={customize} onOpenChange={setCustomize}>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="outline">
                  Customize
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4">
                <FieldGroup>
                  {settings.provider === "modal" && (
                    <>
                      <Field>
                        <FieldLabel htmlFor="hosted-region">Region</FieldLabel>
                        <Input
                          id="hosted-region"
                          value={settings.region}
                          placeholder="Provider default"
                          disabled={!admin || busy || loading}
                          onChange={(e) =>
                            setSettings({ ...settings, region: e.target.value })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="hosted-cpu">CPU cores</FieldLabel>
                        <Input
                          id="hosted-cpu"
                          type="number"
                          min={0.25}
                          max={16}
                          step={0.25}
                          value={settings.cpu}
                          disabled={!admin || busy || loading}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              cpu: Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="hosted-memory">
                          Memory (MiB)
                        </FieldLabel>
                        <Input
                          id="hosted-memory"
                          type="number"
                          min={512}
                          max={32768}
                          value={settings.memoryMiB}
                          disabled={!admin || busy || loading}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              memoryMiB: Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                    </>
                  )}
                  <Field>
                    <FieldLabel htmlFor="hosted-idle">
                      Stay warm after work (minutes)
                    </FieldLabel>
                    <Input
                      id="hosted-idle"
                      type="number"
                      min={10}
                      max={15}
                      value={settings.idleMinutes}
                      disabled={!admin || busy || loading}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          idleMinutes: Number(e.target.value),
                        })
                      }
                    />
                    <FieldDescription>
                      You pay for this time even when no thread is running.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </CollapsibleContent>
            </Collapsible>
          </FieldGroup>
          {admin && (
            <div className="flex items-end gap-2">
              <Button disabled={busy || loading} type="submit">
                Save hosted settings
              </Button>
              {workspace && (
                <Button
                  disabled={busy || loading}
                  type="button"
                  variant="outline"
                  onClick={() => void save({ settings: null })}
                >
                  Use defaults
                </Button>
              )}
            </div>
          )}
        </form>
        {workspace && (
          <>
            <p role="status">
              {state
                ? {
                    allocating: "Starting your computer…",
                    restoring: "Restoring your computer…",
                    ready: "Your computer is ready.",
                    checkpointing: "Saving your computer…",
                    asleep: "Your computer is asleep.",
                    failed: state.error ?? "Your computer could not start.",
                  }[state.phase]
                : "Computers start automatically when you start tasks."}
            </p>
            <Button
              className="self-start"
              disabled={!available || !settings.enabled || busy || watching}
              onClick={async () => {
                setError("");
                try {
                  await hubRequest(`${base}/${workspace}/prewarm`, "POST");
                  setWatching(true);
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "This computer could not start.",
                  );
                }
              }}
            >
              Prepare Codex connection
            </Button>
            {state && (
              <p className="text-sm text-muted-foreground">
                Active: {Math.round(state.usage.activeMs / 60000)} min · Warm
                idle: {Math.round(state.usage.warmIdleMs / 60000)} min ·
                Snapshot storage:{" "}
                {(state.usage.snapshotByteMs / 3_600_000 / 1024 ** 3).toFixed(
                  3,
                )}{" "}
                GiB-hours
              </p>
            )}
            {state && (
              <p className="text-xs text-muted-foreground">
                Allocation: {state.timing.allocationMs ?? "—"} ms · Restore:{" "}
                {state.timing.restoreMs ?? "—"} ms · Ready:{" "}
                {state.timing.readyMs ?? "—"} ms · Warm request:{" "}
                {state.timing.warmRequestMs ?? "—"} ms · First response:{" "}
                {state.timing.firstResponseMs ?? "—"} ms
              </p>
            )}
          </>
        )}
        {admin && workspace && <HubCodexAccount key={`${organizationId}:${workspace}`} organizationId={organizationId} workspaceId={workspace} ready={state?.phase === "ready"} />}
        {admin && !workspace && (
          <form
            className="flex flex-col gap-3 border-t pt-4"
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
          </form>
        )}
        {saved && <p role="status">Your settings are saved.</p>}
        {error && <p role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
