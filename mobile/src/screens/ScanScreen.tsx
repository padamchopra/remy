import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { color, type } from "../theme";
import { pairingError } from "../lib/api-error";
import { parsePairingLink } from "../lib/pairing";
import { Button } from "../components/Button";

export function ScanScreen({
  onCancel,
  onCode,
}: {
  onCancel: () => void;
  onCode: (raw: string) => Promise<void>;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const handling = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const accept = async (data: string) => {
    if (handling.current) return;
    if (!parsePairingLink(data)) {
      setError(
        "That is not a Remy pairing code; scan the code in Settings → Devices on your computer.",
      );
      return;
    }
    handling.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await onCode(data);
    } catch (caught) {
      setError(pairingError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!permission) return <View style={styles.wrap} />;
  if (!permission.granted) {
    return (
      <View style={styles.wrap}>
        <Text style={type.title}>Camera access</Text>
        <Text style={[type.body, { color: color.mutedForeground }]}>
          Scan the pairing QR from Remy on your computer.
        </Text>
        <Button
          label={permission.canAskAgain ? "Allow camera" : "Open Settings"}
          onPress={() =>
            void (permission.canAskAgain
              ? requestPermission()
              : Linking.openSettings())
          }
        />
        <Button
          label="Cancel"
          variant="ghost"
          disabled={busy}
          onPress={onCancel}
        />
      </View>
    );
  }

  return (
    <View style={styles.cameraWrap}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onMountError={() =>
          setError(
            "Your camera could not start; go back and paste the pairing link.",
          )
        }
        onBarcodeScanned={
          busy || handling.current ? undefined : ({ data }) => void accept(data)
        }
      />
      <View style={styles.top}>
        <Button
          label="Cancel"
          variant="ghost"
          disabled={busy}
          onPress={onCancel}
        />
      </View>
      <View style={styles.feedback}>
        {busy ? <ActivityIndicator color="#fff" /> : null}
        <Text accessibilityLiveRegion="polite" style={styles.hint}>
          {busy
            ? "Connecting to your computer…"
            : (error ?? "Point at the QR on your computer.")}
        </Text>
        {!busy && error && handling.current ? (
          <Button
            label="Scan again"
            onPress={() => {
              handling.current = false;
              setError(undefined);
            }}
          />
        ) : null}
        {!busy ? (
          <Button
            label="Use pairing link"
            variant="outline"
            onPress={onCancel}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: color.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  cameraWrap: { flex: 1, backgroundColor: "#000" },
  top: { position: "absolute", top: 56, left: 12 },
  feedback: {
    position: "absolute",
    bottom: 48,
    left: 16,
    right: 16,
    gap: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#000c",
  },
  hint: { color: "#fff", fontSize: 15, textAlign: "center" },
});
