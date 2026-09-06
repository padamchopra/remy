import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps, type ViewStyle } from "react-native";
import { color, radius, space } from "../theme";

export function Button({
  label,
  variant = "primary",
  disabled,
  busy,
  style,
  ...rest
}: PressableProps & {
  label: string;
  variant?: "primary" | "outline" | "ghost" | "danger";
  busy?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      {...rest}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" && styles.primary,
        variant === "outline" && styles.outline,
        variant === "ghost" && styles.ghost,
        variant === "danger" && styles.danger,
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === "primary" ? color.primaryForeground : color.foreground} />
      ) : (
        <Text
          style={[
            styles.label,
            variant === "primary" && { color: color.primaryForeground },
            variant === "danger" && { color: color.destructive },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: space.sm,
  },
  primary: { backgroundColor: color.primary },
  outline: { borderWidth: 1, borderColor: color.border, backgroundColor: color.card },
  ghost: { backgroundColor: "transparent" },
  danger: { backgroundColor: "rgba(248,113,113,0.12)" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  label: { fontSize: 15, fontWeight: "600", color: color.foreground },
});
