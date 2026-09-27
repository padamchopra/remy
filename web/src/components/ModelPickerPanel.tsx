import { useContext, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, Check, CircleSlash, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { PopoverTitle } from "@/components/ui/popover-base";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs-base";
import { ProviderMark } from "@/components/ProviderMark";
import { displayModel, inheritedLabel, OFF, REMY_DEFAULT } from "@/components/ModelPicker";
import { ModelFavoritesContext } from "@/lib/model-favorites";
import { effortsFor, type ModelChoice, type Provider, type ProviderModel } from "@/lib/providers";
import { useStore } from "@/state/store";
import { cn } from "@/lib/utils";

const FAVORITES = "favorites";

/// A phone's keyboard would cover the list it opened to show, so touch starts
/// on the list and the search waits for a tap.
const touch = () => window.matchMedia("(pointer: coarse)").matches;

/// Matching provider model names, rather than cmdk's fuzzy default.
///
/// Fuzzy scored "Claude Sonnet" above "Codex Sol" for "sol" — the l came out of
/// Claude — and typing three letters of the model you want and highlighting a
/// different one is worse than matching less. A name that starts with what you
/// typed comes first, one that merely contains it comes after, nothing else
/// matches at all.
function match(value: string, search: string, keywords?: string[]): number {
  const query = search.trim().toLowerCase();
  if (!query) return 1;
  const fields = [value, ...(keywords ?? [])].map((entry) => entry.toLowerCase());
  if (fields.some((entry) => entry.startsWith(query))) return 2;
  return fields.some((entry) => entry.includes(query)) ? 1 : 0;
}

/// The model first, because the value is what a search is scored against and
/// a match at the front ranks first. The provider and the id follow, so a
/// search for "OpenRouter" finds its models and two providers' Defaults stay
/// apart.
/// The id beside a name only where the name alone would mislead: an alias
/// such as `sonnet`, which follows the newest release rather than naming one,
/// and two models that share a name.
function showsId(provider: Provider, model: ProviderModel): boolean {
  if (!model.value || model.value.toLowerCase() === model.label.toLowerCase()) return false;
  if (!/\d/.test(model.value)) return true;
  return provider.models.some((other) => other !== model && displayModel(other) === displayModel(model));
}

function itemValue(provider: Provider, model: ProviderModel): string {
  return `${displayModel(model)} ${provider.label} ${provider.id}:${model.value}`;
}

type Props = {
  providers: Provider[];
  value: ModelChoice;
  onPick: (choice: ModelChoice) => void;
  close: () => void;
  allowOff?: boolean;
  allowDefault?: boolean;
  defaultChoice?: ModelChoice;
  onlyProvider?: string;
};

/// What the picker's popover holds: a search across every provider, a rail of
/// provider tabs with Favorites first, and the effort step for a model that
/// has one. Fetched the first time a picker opens.
export default function ModelPickerPanel(props: Props) {
  const { providers, value, onPick, close } = props;
  const [pending, setPending] = useState<ModelChoice>();
  const [returnTo, setReturnTo] = useState<{ tab: string; query: string; highlight: string }>();

  const pick = (choice: ModelChoice) => {
    close();
    if (choice.provider === value.provider && choice.model === value.model && choice.effort === value.effort) return;
    onPick(choice);
  };

  const chooseModel = (provider: Provider, model: ProviderModel, from: { tab: string; query: string }) => {
    const choice: ModelChoice = {
      provider: provider.id,
      model: model.value,
      effort:
        provider.id === value.provider && model.value === value.model
          ? value.effort ?? ""
          : model.defaultEffort ?? "",
    };
    if (effortsFor(providers, choice).length === 0) return pick(choice);
    setReturnTo({ ...from, highlight: itemValue(provider, model) });
    setPending(choice);
  };

  if (pending) {
    return <EffortStep providers={providers} pending={pending} pick={pick} back={() => setPending(undefined)} />;
  }
  return <ModelStep {...props} pick={pick} chooseModel={chooseModel} returnTo={returnTo} />;
}

function ModelStep({
  providers,
  value,
  allowOff,
  allowDefault,
  defaultChoice,
  onlyProvider,
  pick,
  chooseModel,
  returnTo,
}: Props & {
  pick: (choice: ModelChoice) => void;
  chooseModel: (provider: Provider, model: ProviderModel, from: { tab: string; query: string }) => void;
  returnTo?: { tab: string; query: string; highlight: string };
}) {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const hostedFavorites = useContext(ModelFavoritesContext);
  const favorites = new Set(hostedFavorites?.values ?? settings?.favoriteModels ?? []);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const off = allowOff && value.model === OFF;
  const inherited = allowDefault && value.provider === REMY_DEFAULT;
  const current = inherited ? defaultChoice : off ? undefined : value;

  // Only what can run: a provider that is off or missing here stays out of the
  // rail, unless it holds the current choice, which has to stay visible.
  const shown = (onlyProvider ? providers.filter((provider) => provider.id === onlyProvider) : providers).filter(
    (provider) =>
      provider.id === value.provider ||
      (provider.available !== false && provider.enabled !== false && provider.models.length > 0),
  );
  const usable = (provider: Provider) => provider.available !== false && provider.enabled !== false;
  const favoriteModels = shown.flatMap((provider) =>
    usable(provider)
      ? provider.models.flatMap((model) =>
          model.value && favorites.has(`${provider.id}:${model.value}`) ? [{ provider, model }] : [],
        )
      : [],
  );
  const tabs = [
    ...(favoriteModels.length > 0 ? [{ id: FAVORITES, label: "Favorites" }] : []),
    ...shown.map((provider) => ({ id: provider.id, label: provider.label })),
  ];
  const opening = returnTo?.tab ?? (current && shown.some((provider) => provider.id === current.provider) ? current.provider : tabs[0]?.id ?? "");
  const [chosenTab, setTab] = useState(opening);
  // Unstarring the last favorite takes its tab away; land on the first one left.
  const tab = tabs.some((entry) => entry.id === chosenTab) ? chosenTab : tabs[0]?.id ?? "";
  const [query, setQuery] = useState(returnTo?.query ?? "");
  const searching = query.trim().length > 0;
  const rail = tabs.length > 1 && !searching;

  const selected = (provider: Provider, model: ProviderModel) =>
    !off && !inherited && provider.id === value.provider && model.value === (value.model ?? "");
  const chosen = shown.flatMap((provider) =>
    provider.models.filter((model) => selected(provider, model)).map((model) => ({ provider, model })),
  )[0];
  // Where the highlight lands in a tab: on the current choice when the tab
  // holds it, otherwise on its first model.
  const landing = (id: string): string => {
    const rows = id === FAVORITES ? favoriteModels : shown.filter((provider) => provider.id === id).flatMap((provider) => provider.models.map((model) => ({ provider, model })));
    const here = rows.find((entry) => chosen && entry.provider.id === chosen.provider.id && entry.model.value === chosen.model.value);
    const target = here ?? rows[0];
    return target ? itemValue(target.provider, target.model) : "";
  };
  const [active, setActive] = useState(
    () => returnTo?.highlight ?? (inherited ? "default inherited" : off ? "off none" : landing(tab)),
  );
  const changeTab = (next: string) => {
    setTab(next);
    setActive(landing(next));
  };

  useEffect(() => {
    if (!touch()) inputRef.current?.focus();
  }, []);

  const toggleFavorite = (provider: string, model: string) => {
    const key = `${provider}:${model}`;
    const next = favorites.has(key) ? [...favorites].filter((entry) => entry !== key) : [...favorites, key];
    setSavingFavorite(true);
    const save = hostedFavorites ? hostedFavorites.toggle(key, !favorites.has(key)) : saveSettings({ favoriteModels: next });
    void save.catch(() => toast.error("Couldn't update favorites")).finally(() => setSavingFavorite(false));
  };

  const star = (provider: Provider, model: ProviderModel) => {
    if (!model.value) return null;
    const starred = favorites.has(`${provider.id}:${model.value}`);
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={savingFavorite || (hostedFavorites !== null && !hostedFavorites.ready)}
        aria-label={`${starred ? "Remove" : "Add"} ${model.label} ${starred ? "from" : "to"} favorites`}
        className={cn(
          "text-muted-foreground opacity-60 hover:opacity-100",
          starred && "text-yellow-500 opacity-100",
        )}
        onClick={(event) => {
          event.stopPropagation();
          toggleFavorite(provider.id, model.value);
        }}
      >
        <Star className={cn(starred && "fill-current")} />
      </Button>
    );
  };

  const row = (provider: Provider, model: ProviderModel, detail?: string) => (
    <CommandItem
      title={model.value || undefined}
      key={`${detail ? "favorite:" : ""}${provider.id}:${model.value}`}
      value={itemValue(provider, model)}
      keywords={[model.value, provider.id].filter(Boolean)}
      disabled={!usable(provider)}
      onSelect={() => chooseModel(provider, model, { tab, query })}
    >
      <ProviderMark provider={provider.id} />
      <span className="min-w-0 truncate">{displayModel(model)}</span>
      {showsId(provider, model) ? <span className="min-w-0 shrink truncate font-mono text-xs text-muted-foreground">{model.value}</span> : null}
      {detail ? <span className="shrink-0 text-xs text-muted-foreground">{detail}</span> : null}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {star(provider, model)}
        {selected(provider, model) ? <Check /> : null}
      </span>
    </CommandItem>
  );

  const heading = (provider: Provider) =>
    provider.enabled === false
      ? `${provider.label} — turned off`
      : provider.available === false
        ? `${provider.label} — not installed here`
        : undefined;

  const models = searching ? (
    shown.map((provider) => (
      <CommandGroup key={provider.id} heading={heading(provider) ?? provider.label}>
        {provider.models.map((model) => row(provider, model))}
      </CommandGroup>
    ))
  ) : tab === FAVORITES ? (
    <CommandGroup>{favoriteModels.map(({ provider, model }) => row(provider, model, provider.label))}</CommandGroup>
  ) : (
    shown
      .filter((provider) => provider.id === tab)
      .map((provider) => (
        <CommandGroup key={provider.id} heading={heading(provider)}>
          {provider.models.map((model) => row(provider, model))}
        </CommandGroup>
      ))
  );

  // Default and Off are answers in every tab, so they sit above whichever
  // provider's models are showing.
  const pinned = (allowDefault || allowOff) && (
    <CommandGroup className="border-b">
      {allowDefault && (
        <CommandItem
          value="default inherited"
          keywords={[inheritedLabel(providers, defaultChoice), ...(defaultChoice ? [defaultChoice.provider, defaultChoice.model] : [])]}
          onSelect={() => pick({ provider: REMY_DEFAULT, model: "", effort: "" })}
        >
          <ProviderMark provider={defaultChoice?.provider ?? "claude"} />
          <span className="min-w-0 truncate">{inheritedLabel(providers, defaultChoice)}</span>
          {inherited ? <Check className="ml-auto" /> : null}
        </CommandItem>
      )}
      {allowOff && (
        <CommandItem value="off none" onSelect={() => pick({ provider: value.provider, model: OFF, effort: "" })}>
          <CircleSlash />
          <span>Off</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">Remy names nothing for you.</span>
          {off ? <Check className="ml-auto" /> : null}
        </CommandItem>
      )}
    </CommandGroup>
  );

  const searchLabel = onlyProvider ? `Search ${shown[0]?.label ?? "provider"} models` : "Search providers and models";

  const list = (
    <CommandList className="max-h-none min-h-0 flex-1 overscroll-contain">
      <CommandEmpty>
        {shown.some((provider) => provider.models.length > 0) ? "No model by that name." : "No models are available on this computer."}
      </CommandEmpty>
      {pinned}
      {models}
    </CommandList>
  );

  const focusTab = () => railRef.current?.querySelector<HTMLElement>("[data-active]")?.focus();

  // The rail sits left of the list: Left from an empty search steps onto it,
  // and Right, Enter, or typing steps back.
  const inputKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowLeft" && rail && !query) {
      event.preventDefault();
      focusTab();
    }
  };
  const railKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "Enter") {
      event.preventDefault();
      inputRef.current?.focus();
    } else if (event.key.length === 1 && event.key !== " " && !event.metaKey && !event.ctrlKey && !event.altKey) {
      inputRef.current?.focus();
    }
  };

  return (
    <Command
      filter={match}
      value={active}
      onValueChange={setActive}
      className="flex h-full flex-col bg-transparent [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:py-2"
    >
      <PopoverTitle className="sr-only">Choose a model</PopoverTitle>
      <CommandInput ref={inputRef} value={query} onValueChange={setQuery} onKeyDown={inputKeys} placeholder={searchLabel} aria-label={searchLabel} />
      {rail ? (
        <Tabs orientation="vertical" value={tab} onValueChange={(next) => changeTab(String(next))} className="min-h-0 flex-1 gap-0">
          <TabsList
            ref={railRef}
            activateOnFocus
            loopFocus
            aria-label="Providers"
            onKeyDown={railKeys}
            className="w-32 shrink-0 gap-0.5 overflow-y-auto border-r p-1 sm:w-36"
          >
            {tabs.map((entry) => (
              <TabsTrigger
                key={entry.id}
                value={entry.id}
                className="justify-start"
                // A clicked tab hands the keys back to the search, so Up and
                // Down move through the list it just showed.
                onClick={(event) => {
                  if (event.detail > 0 && !touch()) inputRef.current?.focus();
                }}
              >
                {entry.id === FAVORITES ? <Star className="text-yellow-500" /> : <ProviderMark provider={entry.id} />}
                <span className="min-w-0 truncate">{entry.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={tab} className="flex min-h-0 flex-col">
            {list}
          </TabsContent>
        </Tabs>
      ) : (
        list
      )}
    </Command>
  );
}

function EffortStep({
  providers,
  pending,
  pick,
  back,
}: {
  providers: Provider[];
  pending: ModelChoice;
  pick: (choice: ModelChoice) => void;
  back: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const provider = providers.find((entry) => entry.id === pending.provider);
  const model = provider?.models.find((entry) => entry.value === pending.model);
  const efforts = effortsFor(providers, pending);

  useEffect(() => {
    root.current?.focus();
  }, []);

  return (
    <Command
      ref={root}
      tabIndex={-1}
      defaultValue={pending.effort ? `effort ${pending.effort}` : "default effort"}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "Backspace") {
          event.preventDefault();
          back();
        }
      }}
      className="flex h-full flex-col bg-transparent outline-none [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:py-2"
    >
      <PopoverTitle className="sr-only">Choose effort</PopoverTitle>
      <CommandList className="max-h-none min-h-0 flex-1 overscroll-contain">
        <CommandGroup className="border-b">
          <CommandItem value="back to models" onSelect={back}>
            <ArrowLeft />
            <span>Back to models</span>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading={`${provider?.label ?? pending.provider} · ${model ? displayModel(model) : pending.model}`}>
          <CommandItem value="default effort" onSelect={() => pick({ ...pending, effort: "" })}>
            <span>Default</span>
            {model?.defaultEffort ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                Uses {efforts.find((entry) => entry.value === model.defaultEffort)?.label ?? model.defaultEffort}.
              </span>
            ) : null}
            {!pending.effort ? <Check className="ml-auto" /> : null}
          </CommandItem>
          {efforts.map((effort) => (
            <CommandItem
              key={effort.value}
              value={`effort ${effort.value}`}
              keywords={[effort.label]}
              onSelect={() => pick({ ...pending, effort: effort.value })}
            >
              <span>{effort.label}</span>
              {effort.detail ? <span className="min-w-0 truncate text-xs text-muted-foreground">{effort.detail}</span> : null}
              {pending.effort === effort.value ? <Check className="ml-auto" /> : null}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
