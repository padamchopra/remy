import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { ArrowLeft, Box, ChevronDown, Gauge } from "lucide-react-native";
import { color, radius } from "../theme";
import {
  effortLabel,
  effortsFor,
  modelLabel,
  offeredProviders,
  providerOf,
  type ModelChoice,
  type Provider,
  type ProviderModel,
} from "../lib/providers";
import { MenuEmpty, MenuItem, MenuSeparator, Popover } from "./ComposerMenu";

/// Picking what a thread thinks with.
///
/// A provider and a model are one choice, and the reasoning effort belongs to
/// that exact pair — so this is one control that hands all three back at once
/// rather than three that can disagree. Picking a model asks for its effort
/// next when the pair offers any, which is the same two steps the window uses.
export function ModelPicker({
  providers,
  value,
  onPick,
  /// Keeps a running thread on the provider that owns its transcript.
  onlyProvider,
  /// Said in place of the effort step on a Mac too old to accept one.
  effortUnavailable,
  style,
}: {
  providers: Provider[];
  value: ModelChoice;
  onPick: (choice: ModelChoice) => void;
  onlyProvider?: string;
  effortUnavailable?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<ModelChoice>();
  const shown = onlyProvider
    ? providers.filter((provider) => provider.id === onlyProvider)
    : offeredProviders(providers);

  const close = () => {
    setOpen(false);
    setPending(undefined);
  };

  const pick = (choice: ModelChoice) => {
    close();
    if (
      choice.provider === value.provider
      && choice.model === value.model
      && (choice.effort ?? "") === (value.effort ?? "")
    ) return;
    onPick(choice);
  };

  const chooseModel = (provider: Provider, model: ProviderModel) => {
    const choice: ModelChoice = {
      provider: provider.id,
      model: model.value,
      // Keeping the same pair keeps the effort you set on it; moving to another
      // takes that model's own default.
      effort: provider.id === value.provider && model.value === value.model
        ? value.effort ?? ""
        : model.defaultEffort ?? "",
    };
    if (effortUnavailable || effortsFor(providers, choice).length === 0) pick({ ...choice, effort: "" });
    else setPending(choice);
  };

  const effortStep = pending
    ? { choice: pending, efforts: effortsFor(providers, pending) }
    : undefined;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityLabel="Pick a model"
        style={({ pressed }) => [styles.trigger, style, pressed && styles.pressed]}
      >
        <Box size={14} color={color.mutedForeground} />
        <Text style={styles.label} numberOfLines={1}>
          {modelLabel(providers, value)}
        </Text>
        <ChevronDown size={14} color={color.mutedForeground} />
      </Pressable>

      <Popover open={open} onClose={close}>
        {effortStep ? (
          <>
            <MenuItem icon={ArrowLeft} label="Back to models" onPress={() => setPending(undefined)} />
            <MenuSeparator />
            <Text style={styles.heading}>
              {`${providerOf(providers, effortStep.choice.provider)?.label ?? effortStep.choice.provider} · ${modelLabel(providers, effortStep.choice)}`}
            </Text>
            <MenuItem
              icon={Gauge}
              label="Default"
              selected={!effortStep.choice.effort}
              onPress={() => pick({ ...effortStep.choice, effort: "" })}
            />
            {effortStep.efforts.map((effort) => (
              <MenuItem
                key={effort.value}
                icon={Gauge}
                label={effort.label}
                selected={effortStep.choice.effort === effort.value}
                onPress={() => pick({ ...effortStep.choice, effort: effort.value })}
              />
            ))}
          </>
        ) : shown.length === 0 ? (
          // Only reachable when this thread runs on a provider the catalogue in
          // hand has never heard of — a newer Mac that has not answered yet.
          <MenuEmpty>This Mac hasn't said what this thread can run on.</MenuEmpty>
        ) : (
          shown.map((provider, index) => (
            <View key={provider.id}>
              {index > 0 ? <MenuSeparator /> : null}
              <Text style={styles.heading}>
                {provider.available === false
                  ? `${provider.label} — not installed here`
                  : provider.enabled === false
                    ? `${provider.label} — turned off`
                    : provider.label}
              </Text>
              {provider.models.map((model) => (
                <MenuItem
                  key={`${provider.id}:${model.value}`}
                  icon={Box}
                  label={model.context ? `${model.label} (${model.context})` : model.label}
                  detail={
                    provider.id === value.provider && model.value === value.model
                      ? effortLabel(providers, value)
                      : undefined
                  }
                  selected={provider.id === value.provider && model.value === value.model}
                  onPress={() => chooseModel(provider, model)}
                />
              ))}
            </View>
          ))
        )}
        {!effortStep && effortUnavailable ? (
          <Text style={styles.note}>Reasoning effort needs a newer Remy on this Mac.</Text>
        ) : null}
      </Popover>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.sm,
    minWidth: 0,
    flexShrink: 1,
  },
  label: { color: color.mutedForeground, fontSize: 13, flexShrink: 1 },
  pressed: { backgroundColor: color.accent },
  note: {
    color: color.mutedForeground,
    fontSize: 12,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  heading: {
    color: color.mutedForeground,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
});
