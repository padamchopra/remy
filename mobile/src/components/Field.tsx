import { type ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { color, radius, space, type } from "../theme";

/// A labelled row in a settings screen. The label names the setting and the
/// description adds what the label cannot say — never a second reading of it.
export function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={type.callout}>{label}</Text>
      {description ? <Text style={type.caption}>{description}</Text> : null}
      {children}
    </View>
  );
}

/// Text that saves when you leave it, because saving a paragraph on every
/// keystroke is a write per character.
export function TextField({
  label,
  description,
  value,
  placeholder,
  lines = 1,
  mono,
  onCommit,
}: {
  label: string;
  description?: string;
  value: string;
  placeholder?: string;
  lines?: number;
  mono?: boolean;
  onCommit: (next: string) => void;
}) {
  return (
    <Field label={label} description={description}>
      <TextInput
        defaultValue={value}
        placeholder={placeholder}
        placeholderTextColor={color.mutedForeground}
        accessibilityLabel={label}
        multiline={lines > 1}
        autoCapitalize={mono ? "none" : "sentences"}
        autoCorrect={!mono}
        textAlignVertical={lines > 1 ? "top" : "center"}
        onEndEditing={(event) => {
          const next = event.nativeEvent.text;
          if (next !== value) onCommit(next);
        }}
        style={[styles.input, mono && styles.mono, lines > 1 && { minHeight: 22 * lines }]}
      />
    </Field>
  );
}

export function SwitchField({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchText}>
        <Text style={type.callout}>{label}</Text>
        {description ? <Text style={type.caption}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: color.primary, false: color.input }}
      />
    </View>
  );
}

/// A short set of mutually exclusive answers, laid out rather than hidden in a
/// menu — a permission mode is a decision worth seeing all of at once.
export function ChoiceField<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: T;
  options: readonly { value: T; label: string; detail?: string }[];
  onChange: (next: T) => void;
}) {
  const chosen = options.find((option) => option.value === value);
  return (
    <Field label={label} description={description ?? chosen?.detail}>
      <View style={styles.chips}>
        {options.map((option) => {
          const on = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipLabel, on && { color: color.primaryForeground }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  input: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.card,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: color.foreground,
    fontSize: 15,
  },
  mono: { fontFamily: "Menlo", fontSize: 13 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  switchText: { flex: 1, minWidth: 0, gap: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: color.card,
  },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipLabel: { fontSize: 13, color: color.foreground },
  section: { gap: space.md, paddingTop: space.sm },
  sectionTitle: {
    color: color.mutedForeground,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
});
