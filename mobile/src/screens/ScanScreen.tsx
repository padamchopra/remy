import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { color, type } from "../theme";
import { parsePairingLink } from "../lib/pairing";
import { Button } from "../components/Button";

export function ScanScreen({
  onCancel,
  onCode,
}: {
  onCancel: () => void;
  onCode: (raw: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [handled, setHandled] = useState(false);

  if (!permission) return <View style={styles.wrap} />;
  if (!permission.granted) {
    return (
      <View style={styles.wrap}>
        <Text style={type.title}>Camera access</Text>
        <Text style={[type.body, { color: color.mutedForeground }]}>
          Scan the pairing QR from Remy on your computer.
        </Text>
        <Button label="Allow camera" onPress={() => void requestPermission()} />
        <Button label="Cancel" variant="ghost" onPress={onCancel} />
      </View>
    );
  }

  return (
    <View style={styles.cameraWrap}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (handled) return;
          if (!parsePairingLink(data)) return;
          setHandled(true);
          onCode(data);
        }}
      />
      <View style={styles.top}>
        <Button label="Cancel" variant="ghost" onPress={onCancel} />
      </View>
      <Text style={styles.hint}>Point at the QR on the computer</Text>
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
  hint: {
    position: "absolute",
    bottom: 64,
    alignSelf: "center",
    color: "#fff",
    fontSize: 15,
  },
});
