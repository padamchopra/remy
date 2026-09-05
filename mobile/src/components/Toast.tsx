import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { color, type } from "../theme";

export interface ToastMessage {
  id: number;
  title: string;
  detail: string;
}

export function Toast({ message, onDismiss }: { message?: ToastMessage; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(onDismiss, 5_000);
    return () => clearTimeout(timeout);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={styles.toast}>
      <Text style={type.heading}>{message.title}</Text>
      <Text style={[type.caption, styles.detail]}>{message.detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    zIndex: 100,
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    backgroundColor: color.card,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  detail: { color: color.mutedForeground },
});
