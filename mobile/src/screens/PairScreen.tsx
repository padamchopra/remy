import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Camera, Link2 } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { color, space, type } from "../theme";
import { pairingError } from "../lib/api-error";
import { hostLabel, parsePairingLink } from "../lib/pairing";
import { originOf, type Pairing } from "../lib/session";
import { transport } from "../lib/transport";
import { Button } from "../components/Button";

export function PairScreen({
  onPaired,
  onScan,
  onCancel,
}: {
  onPaired: (pairing: Pairing) => void | Promise<void>;
  onScan: () => void;
  onCancel?: () => void;
}) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const pair = async (raw: string) => {
    const parsed = parsePairingLink(raw);
    if (!parsed) {
      setError("That is not a Remy pairing link.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const pairing: Pairing = { url: originOf(parsed.url), token: parsed.token, name: hostLabel(parsed.url) };
      const probed = await transport.probe(pairing);
      await onPaired({ ...pairing, name: probed.name, ...(probed.deviceId ? { deviceId: probed.deviceId } : {}) });
    } catch (caught) {
      setError(pairingError(caught));
    } finally {
      setBusy(false);
    }
  };

  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setLink(text);
    await pair(text || link);
  };

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.body}>
        {onCancel ? null : <Text style={type.title}>Pair with a Mac</Text>}
        <Text style={[type.body, styles.detail]}>
          Remy on your phone is a remote for the Macs that hold your repos.
        </Text>

        <Pressable onPress={onScan} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <Camera size={18} color={color.foreground} />
          <View style={styles.cardText}>
            <Text style={type.heading}>Scan the pairing QR</Text>
            <Text style={type.caption}>Settings → Devices on the Mac, then copy the link as a QR.</Text>
          </View>
        </Pressable>

        <View style={styles.or}>
          <View style={styles.rule} />
          <Text style={type.caption}>or paste the link</Text>
          <View style={styles.rule} />
        </View>

        <TextInput
          value={link}
          onChangeText={setLink}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="remy://configure?url=…"
          placeholderTextColor={color.mutedForeground}
          style={styles.input}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.row}>
          {onCancel ? <Button label="Cancel" variant="ghost" disabled={busy} onPress={onCancel} /> : null}
          <Button label="Paste link" variant="outline" disabled={busy} onPress={() => void paste()} />
          <Button
            label="Pair"
            busy={busy}
            disabled={!link.trim()}
            onPress={() => void pair(link)}
          />
        </View>
        <View style={styles.hint}>
          <Link2 size={14} color={color.mutedForeground} />
          <Text style={type.caption}>Each Mac has to be reachable on your tailnet.</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background, justifyContent: "center" },
  body: { padding: 24, gap: 14 },
  detail: { color: color.mutedForeground },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.card,
  },
  pressed: { backgroundColor: color.accent },
  cardText: { flex: 1, gap: 4 },
  or: { flexDirection: "row", alignItems: "center", gap: space.sm },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.border },
  input: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: color.foreground,
    fontSize: 14,
    fontFamily: "Menlo",
  },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" },
  error: { color: color.destructive, fontSize: 13 },
  hint: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
});
