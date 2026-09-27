import { Suspense, useEffect, useState } from "react";
import { Bot, ChevronDown, CircleDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroupButton, InputGroupText } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover-base";
import { Spinner } from "@/components/ui/spinner";
import { ProviderMark } from "@/components/ProviderMark";
import {
  effortLabel,
  modelLabel,
  resolvedModelLabel,
  PROVIDERS,
  type ModelChoice,
  type Provider,
  type ProviderModel,
} from "@/lib/providers";
import { useStore } from "@/state/store";
import { cn } from "@/lib/utils";
import { preloadable } from "@/lib/preloadable";

/// Picking what something thinks with.
///
/// Every place in Remy that chooses a model chooses the provider in the same
/// breath — a thread, an agent, the default for new threads, Remy's own small
/// jobs — so all of them use this one button and its popover, and get a
/// provider and a model back together. The popover opens beside the button,
/// with a tab per provider that can run, and searches all of them at once,
/// because "sonnet" is the word people have in mind rather than the provider it
/// belongs to.
///
/// `OFF` is a value only Remy's own jobs offer: a thread has to run on
/// something. `REMY_DEFAULT` is the opposite kind of answer — not a model but
/// the absence of one, for a caller that follows the machine rather than
/// choosing. It is stored as inheritance, so changing the machine's default
/// reaches everything holding it.
export const OFF = "off";
export const REMY_DEFAULT = "default";

function useProviders(override?: Provider[]): Provider[] {
  const providers = useStore((s) => s.providers);
  const loadProviders = useStore((s) => s.loadProviders);
  const locked = override !== undefined;

  useEffect(() => {
    if (locked) return;
    void loadProviders().catch(() => {
      // The machine says elsewhere that it is unreachable; the built-in
      // catalogue is enough to paint the picker.
    });
  }, [loadProviders, locked]);

  return override ?? providers ?? PROVIDERS;
}

/// A model's row name. The provider's default says what it uses today.
export function displayModel(model: ProviderModel): string {
  if (!model.value && model.resolvedLabel) return `${model.label} · ${model.resolvedLabel}`;
  return model.context ? `${model.label} (${model.context})` : model.label;
}

export function inheritedLabel(providers: Provider[], choice?: ModelChoice): string {
  return choice ? `Default - ${resolvedModelLabel(providers, choice)} · ${effortLabel(providers, choice)}` : "No default";
}

const { Surface: ModelPickerPanel, preload } = preloadable(() => import("./ModelPickerPanel"));
const loadPanel = () => void preload();

/// The one model picker: a button that opens its popover beside itself. The
/// popover's contents arrive on first hover, focus, or open, so a composer
/// draws its button without them.
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
  onlyProvider,
  disabled,
  title,
  id,
  className,
  catalogue,
  cataloguePending,
  pending,
}: {
  value: ModelChoice;
  onPick: (choice: ModelChoice) => void;
  variant?: "composer" | "field";
  allowOff?: boolean;
  allowDefault?: boolean;
  defaultChoice?: ModelChoice;
  onlyProvider?: string;
  /// Read-only, for a thread that is mid-turn. The value still shows.
  disabled?: boolean;
  title?: string;
  id?: string;
  className?: string;
  catalogue?: Provider[];
  /// Hosted access is still arriving; keep the current name instead of Unavailable.
  cataloguePending?: boolean;
  /// Showing the last value this device saw while the real one is read. The
  /// button keeps its shape and cannot be opened.
  pending?: boolean;
}) {
  const providers = useProviders(catalogue);
  const [open, setOpen] = useState(false);
  const inherited = allowDefault && value.provider === REMY_DEFAULT;
  const hasChoice = providers.some(p => p.id === value.provider);
  const label = catalogue && !cataloguePending && !hasChoice && !inherited && value.model !== OFF ? (value.provider ? `${value.model || value.provider} · Unavailable` : "Choose a model") : inherited
    ? inheritedLabel(providers, defaultChoice)
    : value.model === OFF ? "Off" : `${modelLabel(providers, value)}${providers.find(p => p.id === value.provider)?.efforts.length ? ` · ${effortLabel(providers, value)}` : ""}`;
  // Nothing saved has no provider behind it, so it wears no provider's mark.
  const mark = !hasChoice && !inherited ? <Bot className="size-4 shrink-0" /> : inherited
    ? defaultChoice ? <ProviderMark provider={defaultChoice.provider} /> : <CircleDashed className="size-4 shrink-0 text-muted-foreground" />
    : <ProviderMark provider={value.provider} />;

  if (disabled && variant === "composer") {
    return (
      <InputGroupText data-model-picker="" title={title} className="min-w-0 max-w-40 truncate">
        {mark}
        {label}
      </InputGroupText>
    );
  }

  const trigger =
    variant === "composer" ? (
      <InputGroupButton
        data-model-picker=""
        aria-label="Model"
        title={title}
        aria-busy={pending || undefined}
        className="min-w-0 shrink disabled:opacity-100 [@media(pointer:coarse)]:h-8"
        onPointerEnter={loadPanel}
        onFocus={loadPanel}
      >
        {mark}
        <span className="min-w-0 max-w-40 truncate">{label}</span>
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
        className={cn("w-72 shrink-0 justify-start font-normal", className)}
        onPointerEnter={loadPanel}
        onFocus={loadPanel}
      >
        {mark}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className="ml-auto opacity-50" />
      </Button>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} disabled={pending || disabled} />
      {/* One size for every tab, search, and the effort step, so switching
          never moves or flips the popover. */}
      <PopoverContent initialFocus={(type) => type !== "touch"} className="flex h-[min(26rem,var(--available-height))] w-[30rem] flex-col overflow-hidden">
        {open && (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Spinner className="text-muted-foreground" /></div>}>
            <ModelPickerPanel
              providers={providers}
              value={value}
              onPick={onPick}
              close={() => setOpen(false)}
              allowOff={allowOff}
              allowDefault={allowDefault}
              defaultChoice={defaultChoice}
              onlyProvider={onlyProvider}
            />
          </Suspense>
        )}
      </PopoverContent>
    </Popover>
  );
}

/// One provider, as the machine describes it — its name, its models, and
/// whether a thread on it can stop and ask. What a caller needs to name the
/// provider, and to say why a permission means something different here.
export function useProvider(id?: string): Provider | undefined {
  const providers = useProviders();
  return providers.find((entry) => entry.id === id);
}
