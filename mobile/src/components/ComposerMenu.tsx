import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Check, ChevronDown, Search, type LucideIcon } from "lucide-react-native";
import { color, radius } from "../theme";

export function ComposerMenu({
  icon: Icon,
  label,
  value,
  onChange,
  options,
  style,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string; icon?: LucideIcon; detail?: string }[];
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  if (options.length <= 1) {
    return (
      <View style={[styles.trigger, style]}>
        <Icon size={14} color={color.mutedForeground} />
        <Text style={styles.triggerLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, style, pressed && styles.pressed]}
      >
        <Icon size={14} color={color.mutedForeground} />
        <Text style={styles.triggerLabel} numberOfLines={1}>
          {label}
        </Text>
        <ChevronDown size={14} color={color.mutedForeground} />
      </Pressable>
      <Popover open={open} onClose={() => setOpen(false)}>
        {options.map((option) => (
          <MenuItem
            key={option.value || option.label}
            icon={option.icon}
            label={option.label}
            detail={option.detail}
            selected={value === option.value}
            onPress={() => {
              onChange(option.value);
              setOpen(false);
            }}
          />
        ))}
      </Popover>
    </>
  );
}

export function Popover({
  open,
  onClose,
  search,
  children,
}: {
  open: boolean;
  onClose: () => void;
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  children: ReactNode;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.layer}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
          style={styles.center}
        >
          <View style={styles.card}>
            {search ? (
              <View style={styles.search}>
                <Search size={16} color={color.mutedForeground} />
                <TextInput
                  value={search.value}
                  onChangeText={search.onChange}
                  placeholder={search.placeholder}
                  placeholderTextColor={color.mutedForeground}
                  autoFocus
                  autoCorrect={false}
                  autoCapitalize="none"
                  clearButtonMode="while-editing"
                  style={styles.searchInput}
                />
              </View>
            ) : null}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              style={styles.list}
            >
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export function MenuItem({
  icon: Icon,
  leading,
  label,
  detail,
  selected,
  onPress,
}: {
  icon?: LucideIcon;
  leading?: ReactNode;
  label: string;
  detail?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
      {leading ?? (Icon ? <Icon size={16} color={color.mutedForeground} /> : null)}
      <Text style={styles.itemLabel} numberOfLines={1}>
        {label}
      </Text>
      {detail ? (
        <Text style={styles.itemDetail} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
      {selected ? <Check size={16} color={color.foreground} /> : <View style={styles.checkSlot} />}
    </Pressable>
  );
}

export function MenuSeparator() {
  return <View style={styles.rule} />;
}

export function MenuEmpty({ children }: { children: string }) {
  return <Text style={styles.empty}>{children}</Text>;
}

export function MenuLoading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={color.mutedForeground} />
    </View>
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
  triggerLabel: { color: color.mutedForeground, fontSize: 13, flexShrink: 1 },
  pressed: { backgroundColor: color.accent },
  layer: { flex: 1, backgroundColor: "rgba(0,0,0,0.32)" },
  center: { flex: 1, justifyContent: "center", paddingHorizontal: 28 },
  card: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 320,
    backgroundColor: color.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    borderRadius: radius.md,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 16,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: { flex: 1, color: color.foreground, fontSize: 15, paddingVertical: 8 },
  list: { maxHeight: 320, paddingVertical: 4 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 4,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: radius.sm,
    minHeight: 44,
  },
  itemLabel: { flex: 1, minWidth: 0, color: color.foreground, fontSize: 14 },
  itemDetail: { color: color.mutedForeground, fontSize: 12, maxWidth: 96 },
  checkSlot: { width: 16 },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.border,
    marginVertical: 4,
    marginHorizontal: 8,
  },
  empty: {
    color: color.mutedForeground,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 20,
    paddingHorizontal: 12,
  },
  loading: { paddingVertical: 24, alignItems: "center" },
});
