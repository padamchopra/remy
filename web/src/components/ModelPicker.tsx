import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronDown, CircleSlash, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { InputGroupButton, InputGroupText } from "@/components/ui/input-group";
import { ProviderMark } from "@/components/ProviderMark";
import {
  effortLabel,
  effortsFor,
  modelLabel,
  resolvedModelLabel,
  PROVIDERS,
  type ModelChoice,
  type Provider,
  type ProviderModel,
} from "@/lib/providers";
import { useStore } from "@/state/store";
import { cn } from "@/lib/utils";

/// Picking what something thinks with.
///
/// Every place in Remy that chooses a model chooses the provider in the same
/// breath — a thread, an agent, the default for new threads, Remy's own small
/// jobs — so all of them open this one dialog and get a provider and a model
/// back together. The dialog is searchable, because "sonnet" is the word people
/// have in mind rather than the provider it belongs to.
///
/// `OFF` is a value only Remy's own jobs offer: a thread has to run on
/// something. `REMY_DEFAULT` is the opposite kind of answer — not a model but
/// the absence of one, for a caller that follows the machine rather than
/// choosing. It is stored as inheritance, so changing the machine's default
/// reaches everything holding it.
export const OFF = "off";
export const REMY_DEFAULT = "default";

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

function useProviders(): Provider[] {
  const providers = useStore((s) => s.providers);
  const loadProviders = useStore((s) => s.loadProviders);

  useEffect(() => {
    void loadProviders().catch(() => {
      // The machine says elsewhere that it is unreachable; the built-in
      // catalogue is enough to paint the picker.
    });
  }, [loadProviders]);

  return providers ?? PROVIDERS;
}

function displayModel(model: ProviderModel): string {
  return model.context ? `${model.label} (${model.context})` : model.label;
}

function inheritedLabel(providers: Provider[], choice?: ModelChoice): string {
  return choice ? `Default - ${resolvedModelLabel(providers, choice)} · ${effortLabel(providers, choice)}` : "Default";
}

/// The dialog on its own, for a caller that already has a trigger.
export function ModelPicker({
  open,
  onOpenChange,
  value,
  onPick,
  allowOff,
  allowDefault,
  defaultChoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ModelChoice;
  onPick: (choice: ModelChoice) => void;
  /// Offers declining the job altogether, for Remy's own model.
  allowOff?: boolean;
  /// Offers following the machine's thread default, for an agent or workspace.
  allowDefault?: boolean;
  defaultChoice?: ModelChoice;
}) {
  const providers = useProviders();
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const off = allowOff && value.model === OFF;
  const inherited = allowDefault && value.provider === REMY_DEFAULT;
  const favorites = new Set(settings?.favoriteModels ?? []);
  const [pending, setPending] = useState<ModelChoice>();

  const changeOpen = (next: boolean) => {
    if (!next) setPending(undefined);
    onOpenChange(next);
  };

  const toggleFavorite = (provider: string, model: string) => {
    const key = `${provider}:${model}`;
    const next = favorites.has(key)
      ? [...favorites].filter((entry) => entry !== key)
      : [...favorites, key];
    void saveSettings({ favoriteModels: next }).catch(() => toast.error("Couldn't update favorites"));
  };

  const favoriteModels = providers.flatMap((provider) =>
    provider.models.flatMap((model) =>
      model.value && favorites.has(`${provider.id}:${model.value}`) ? [{ provider, model }] : [],
    ),
  );

  const pick = (choice: ModelChoice) => {
    setPending(undefined);
    onOpenChange(false);
    if (choice.provider === value.provider && choice.model === value.model && choice.effort === value.effort) return;
    onPick(choice);
  };

  const chooseModel = (provider: Provider, model: ProviderModel) => {
    const choice: ModelChoice = {
      provider: provider.id,
      model: model.value,
      effort:
        provider.id === value.provider && model.value === value.model
          ? value.effort ?? ""
          : model.defaultEffort ?? "",
    };
    if (effortsFor(providers, choice).length === 0) pick(choice);
    else setPending(choice);
  };

  if (pending) {
    const provider = providers.find((entry) => entry.id === pending.provider);
    const model = provider?.models.find((entry) => entry.value === pending.model);
    const efforts = effortsFor(providers, pending);
    return (
      <CommandDialog
        open={open}
        onOpenChange={changeOpen}
        title="Pick effort"
        description="Choose how much reasoning this model uses."
        showCloseButton={false}
        className="top-[12%] translate-y-0 sm:max-w-[520px]"
      >
        <CommandList className="max-h-[440px]">
          <CommandGroup>
            <CommandItem value="back to models" onSelect={() => setPending(undefined)}>
              <ArrowLeft />
              <span>Back to models</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={`${provider?.label ?? pending.provider} · ${model ? displayModel(model) : pending.model}`}>
            <CommandItem value="default effort" onSelect={() => pick({ ...pending, effort: "" })}>
              <span>Default</span>
              {model?.defaultEffort ? (
                <span className="text-xs text-muted-foreground">
                  Uses {efforts.find((entry) => entry.value === model.defaultEffort)?.label ?? model.defaultEffort}.
                </span>
              ) : null}
              {!pending.effort ? <Check className="ml-auto" /> : null}
            </CommandItem>
            {efforts.map((effort) => (
              <CommandItem
                key={effort.value}
                value={`${effort.label} ${effort.value}`}
                onSelect={() => pick({ ...pending, effort: effort.value })}
              >
                <span>{effort.label}</span>
                {effort.detail ? <span className="text-xs text-muted-foreground">{effort.detail}</span> : null}
                {pending.effort === effort.value ? <Check className="ml-auto" /> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    );
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={changeOpen}
      title="Pick a model"
      description="Search providers and models"
      filter={match}
      showCloseButton={false}
      className="top-[12%] translate-y-0 sm:max-w-[520px]"
    >
      <CommandInput placeholder="Search providers and models" />
      {/* A stable viewport for both short built-in catalogues and Cursor's live,
          searchable model list. */}
      <CommandList className="max-h-[440px]">
        <CommandEmpty>No model by that name.</CommandEmpty>
        {allowDefault && (
          <CommandGroup>
            <CommandItem
              value={`${inheritedLabel(providers, defaultChoice)} inherited`}
              keywords={defaultChoice ? [defaultChoice.provider, defaultChoice.model] : undefined}
              onSelect={() => pick({ provider: REMY_DEFAULT, model: "", effort: "" })}
            >
              <ProviderMark provider={defaultChoice?.provider ?? "claude"} />
              <span>{inheritedLabel(providers, defaultChoice)}</span>
              {inherited ? <Check className="ml-auto" /> : null}
            </CommandItem>
          </CommandGroup>
        )}
        {favoriteModels.length > 0 && (
          <CommandGroup heading="Favorites">
            {favoriteModels.map(({ provider, model }) => (
              <CommandItem
                key={`favorite:${provider.id}:${model.value}`}
                value={`${model.label} ${provider.label} favorite`}
                keywords={[model.value, provider.id]}
                disabled={provider.available === false || provider.enabled === false}
                onSelect={() => chooseModel(provider, model)}
              >
                <ProviderMark provider={provider.id} />
                <span className="min-w-0 truncate">{displayModel(model)}</span>
                <span className="text-xs text-muted-foreground">{provider.label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${model.label} from favorites`}
                  className="ml-auto text-yellow-500"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFavorite(provider.id, model.value);
                  }}
                >
                  <Star className="fill-current" />
                </Button>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {providers.map((provider) => {
          const disabled = provider.enabled === false;
          const missing = provider.available === false;
          return (
            <CommandGroup
              key={provider.id}
              heading={disabled ? `${provider.label} — turned off` : missing ? `${provider.label} — not installed here` : provider.label}
            >
              {provider.models.map((model) => (
                <CommandItem
                  key={`${provider.id}:${model.value}`}
                  // The model first, because the value is what a search is
                  // scored against and cmdk rewards a match at the front:
                  // "Claude Sonnet" scored above "Codex Sol" for "sol", on the
                  // l in Claude. The provider is still in it — both of them
                  // have a Default, and a value has to be its own.
                  value={`${model.label} ${provider.label}`}
                  keywords={[model.value, provider.id].filter(Boolean)}
                  disabled={disabled || missing}
                  onSelect={() => chooseModel(provider, model)}
                >
                  <ProviderMark provider={provider.id} />
                  <span className="min-w-0 truncate">{displayModel(model)}</span>
                  {model.value && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${favorites.has(`${provider.id}:${model.value}`) ? "Remove" : "Add"} ${model.label} ${favorites.has(`${provider.id}:${model.value}`) ? "from" : "to"} favorites`}
                      className={cn(
                        "ml-auto text-muted-foreground opacity-60 hover:opacity-100",
                        favorites.has(`${provider.id}:${model.value}`) && "text-yellow-500 opacity-100",
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleFavorite(provider.id, model.value);
                      }}
                    >
                      <Star className={cn(favorites.has(`${provider.id}:${model.value}`) && "fill-current")} />
                    </Button>
                  )}
                  {!off && !inherited && provider.id === value.provider && model.value === (value.model ?? "") ? (
                    <Check />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
        {allowOff && (
          <CommandGroup heading="Or not at all">
            <CommandItem value="off none" onSelect={() => pick({ provider: value.provider, model: OFF, effort: "" })}>
              <CircleSlash />
              <span>Off</span>
              <span className="text-xs text-muted-foreground">Remy names nothing for you.</span>
              {off ? <Check className="ml-auto" /> : null}
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

/// The picker with its own button, which is how most places want it.
///
/// `variant` is only which button it wears: `composer` sits on a thread's
/// toolbar beside the other `InputGroup` controls, `field` in a settings row
/// beside the menus it replaced.
export function ModelPickerButton({
  value,
  onPick,
  variant = "field",
  allowOff,
  allowDefault,
  defaultChoice,
  disabled,
  title,
  id,
  className,
}: {
  value: ModelChoice;
  onPick: (choice: ModelChoice) => void;
  variant?: "composer" | "field";
  allowOff?: boolean;
  allowDefault?: boolean;
  defaultChoice?: ModelChoice;
  /// Read-only, for a thread that is mid-turn. The value still shows.
  disabled?: boolean;
  title?: string;
  id?: string;
  className?: string;
}) {
  const providers = useProviders();
  const [open, setOpen] = useState(false);
  const inherited = allowDefault && value.provider === REMY_DEFAULT;
  const label = inherited
    ? inheritedLabel(providers, defaultChoice)
    : value.model === OFF ? "Off" : `${modelLabel(providers, value)} · ${effortLabel(providers, value)}`;
  const mark = inherited
    ? <ProviderMark provider={defaultChoice?.provider ?? "claude"} />
    : <ProviderMark provider={value.provider} />;

  if (disabled && variant === "composer") {
    return (
      <InputGroupText data-model-picker="" title={title} className="max-w-40 truncate">
        {mark}
        {label}
      </InputGroupText>
    );
  }

  return (
    <>
      {variant === "composer" ? (
        <InputGroupButton data-model-picker="" aria-label="Model" title={title} onClick={() => setOpen(true)}>
          {mark}
          <span className="max-w-40 truncate">{label}</span>
          <ChevronDown />
        </InputGroupButton>
      ) : (
        <Button
          data-model-picker=""
          id={id}
          type="button"
          variant="outline"
          size="sm"
          title={title}
          disabled={disabled}
          className={cn("w-72 shrink-0 justify-start font-normal", className)}
          onClick={() => setOpen(true)}
        >
          {mark}
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="ml-auto opacity-50" />
        </Button>
      )}
      <ModelPicker
        open={open}
        onOpenChange={setOpen}
        value={value}
        onPick={onPick}
        allowOff={allowOff}
        allowDefault={allowDefault}
        defaultChoice={defaultChoice}
      />
    </>
  );
}

/// One provider, as the machine describes it — its name, its models, and
/// whether a thread on it can stop and ask. What a caller needs to name the
/// provider, and to say why a permission means something different here.
export function useProvider(id?: string): Provider | undefined {
  const providers = useProviders();
  return providers.find((entry) => entry.id === id);
}
