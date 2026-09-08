import { useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View, type KeyboardEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, space } from "../theme";

/// The shell owns the top inset; composers own the home indicator and keyboard.
export function ComposerLayout({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const frame = useRef<View>(null);
  const [offset, setOffset] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible);

  useEffect(() => {
    const update = (visible: boolean) => (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardVisible(visible);
    };
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", update(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", update(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  return (
    <View ref={frame} collapsable={false} style={styles.fill}
      onLayout={() => frame.current?.measureInWindow((_x, y) => setOffset(y))}>
      <KeyboardAvoidingView style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={offset}>
        <View style={[styles.fill, { paddingBottom: keyboardVisible ? space.sm : insets.bottom + space.sm }]}>
          {children}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0, backgroundColor: color.background },
});
