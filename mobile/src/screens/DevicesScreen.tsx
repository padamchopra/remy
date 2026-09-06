import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, CircleAlert, Laptop, RefreshCw } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { formatPairCode, hostLabel } from "../lib/pairing";
import { apiError, isMissingRoute } from "../lib/api-error";
import { useStore } from "../state/store";
import type { PairAttempt, Server, TailnetDevice } from "../state/types";
import type { DeviceIconId } from "../lib/devices";
import type { TintId } from "../lib/tints";
import { Button } from "../components/Button";
import { DeviceMark } from "../components/DeviceMark";
import { DeviceIconSheet } from "../components/DeviceIconSheet";
import { EditableName } from "../components/EditableName";
import { DeviceSettingsScreen } from "./DeviceSettingsScreen";

export function DevicesScreen({
  onPairAnother,
  onUnpair,
}: {
  onPairAnother: () => void;
  onUnpair: (url: string) => void;
}) {
  const servers = useStore((s) => s.servers);
  const updateServer = useStore((s) => s.updateServer);
  const discoverDevices = useStore((s) => s.discoverDevices);
  const startPairing = useStore((s) => s.startPairing);
  const pairingAttempt = useStore((s) => s.pairingAttempt);
  const refresh = useStore((s) => s.refresh);
  const [picking, setPicking] = useState<Server>();
  const [settingsId, setSettingsId] = useState<string>();
  const [discovered, setDiscovered] = useState<TailnetDevice[]>();
  const [attempt, setAttempt] = useState<PairAttempt>();
  const [error, setError] = useState<string>();
  const home = servers.find((server) => server.home && server.online && !server.cloud)
    ?? servers.find((server) => server.online && !server.cloud);
  const selected = settingsId ? servers.find((server) => server.id === settingsId) : undefined;

  const load = async (force = false) => {
    if (!home) {
      setDiscovered([]);
      return;
    }
    setError(undefined);
    try {
      setDiscovered(await discoverDevices(home.id, force));
    } catch (caught) {
      setDiscovered([]);
      setError(`Couldn't look for computers: ${apiError(caught)}`);
    }
  };

  useEffect(() => { void load(); }, [home?.id]);

  useEffect(() => {
    if (!home || !attempt || attempt.state !== "waiting") return;
    const timer = setInterval(() => {
      void pairingAttempt(home.id, attempt.id).then((next) => {
        setAttempt(next);
        if (next.state === "approved") {
          void refresh();
          void load(true);
        }
      }).catch(() => {});
    }, 1_500);
    return () => clearInterval(timer);
  }, [home?.id, attempt?.id, attempt?.state, pairingAttempt, refresh]);

  if (selected) return <DeviceSettingsScreen server={selected} onBack={() => setSettingsId(undefined)} />;

  const unpair = (server: Server) => {
    Alert.alert(`Unpair ${server.name}?`, "This phone stops talking to it until you pair again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Unpair", style: "destructive", onPress: () => onUnpair(server.url) },
    ]);
  };

  const ask = (device: TailnetDevice) => {
    if (!home || !device.url) return;
    Alert.alert(`Pair ${device.name}?`, `Remy on ${home.name} will ask ${device.name}. Nothing is shared until you confirm the same code there.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Ask to pair",
        onPress: () => void startPairing(home.id, device)
          .then(setAttempt)
          .catch((caught) => setError(isMissingRoute(caught)
            ? `${device.name} needs a newer Remy before it can pair this way.`
            : `Couldn't ask ${device.name} to pair: ${apiError(caught)}`)),
      },
    ]);
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Text style={type.heading}>Paired computers</Text>
      {servers.filter((server) => !server.cloud).map((server) => (
        <View key={server.id} style={styles.card}>
          <DeviceMark server={server} onPress={() => setPicking(server)} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <EditableName value={server.name} label="computer name" onCommit={(name) => void updateServer(server.id, { name })} />
            <Text style={type.caption} numberOfLines={1}>{`${server.online ? "Available" : "Unavailable"} · ${hostLabel(server.url)}`}</Text>
          </View>
          <Button label="Settings" variant="ghost" onPress={() => setSettingsId(server.id)} style={styles.small} />
          {server.home ? <Button label="Unpair" variant="ghost" onPress={() => unpair(server)} style={styles.small} /> : null}
        </View>
      ))}

      <View style={styles.sectionHead}>
        <Text style={type.heading}>On your tailnet</Text>
        <Pressable onPress={() => void load(true)} accessibilityLabel="Look again" style={styles.refresh}>
          <RefreshCw size={16} color={color.mutedForeground} />
          <Text style={type.caption}>Look again</Text>
        </Pressable>
      </View>

      {attempt?.state === "waiting" ? (
        <View style={styles.attempt}>
          <Text style={type.callout}>{`Waiting for ${attempt.name}`}</Text>
          <Text style={styles.code}>{formatPairCode(attempt.code)}</Text>
          <Text style={type.caption}>{`Allow it on ${attempt.name} if it shows this code.`}</Text>
        </View>
      ) : attempt && attempt.state !== "approved" ? (
        <View style={styles.attempt}>
          <CircleAlert size={18} color={color.destructive} />
          <Text style={type.callout}>{attempt.state === "denied" ? `${attempt.name} denied that request.` : attempt.error ?? `Pairing ${attempt.state}.`}</Text>
          <Button label="Try again" variant="outline" onPress={() => setAttempt(undefined)} />
        </View>
      ) : attempt?.state === "approved" ? (
        <View style={styles.attempt}><Check size={18} color={color.primary} /><Text style={type.callout}>{`Paired ${attempt.name}.`}</Text></View>
      ) : null}

      {discovered === undefined ? <Text style={type.caption}>Looking for your computers…</Text> : discovered.length === 0 ? (
        <Text style={styles.empty}>{home ? "No other computers are visible on your tailnet." : "Connect a paired computer to discover another one."}</Text>
      ) : discovered.map((device) => (
        <View key={device.host} style={styles.discovery}>
          <Laptop size={18} color={color.mutedForeground} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={type.callout}>{device.name}</Text>
            <Text style={type.caption}>
              {device.paired ? "Already paired"
                : device.remy ? "Remy is ready to pair"
                  : device.online ? "Remy isn't answering here"
                    : "Asleep or offline"}
            </Text>
          </View>
          {device.remy && !device.paired ? <Button label="Pair" onPress={() => ask(device)} style={styles.small} /> : null}
        </View>
      ))}

      <View style={{ gap: 6 }}>
        <Button label="Pair with a link or QR" variant="outline" onPress={onPairAnother} />
        <Text style={type.caption}>Use this when discovery cannot see the intended computer.</Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {picking ? (
        <DeviceIconSheet
          open
          icon={picking.icon}
          tint={picking.tint}
          onClose={() => setPicking(undefined)}
          onChange={(patch: { icon?: DeviceIconId; tint?: TintId }) => {
            void updateServer(picking.id, patch);
            setPicking((current) => (current ? { ...current, ...patch } : current));
          }}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.md, paddingBottom: 40 },
  card: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: color.card, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: 10 },
  small: { minHeight: 32, paddingHorizontal: 8 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.md },
  refresh: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36 },
  attempt: { alignItems: "center", gap: 6, borderWidth: 1, borderColor: color.border, backgroundColor: color.card, borderRadius: radius.lg, padding: space.md },
  code: { ...type.title, fontFamily: "Menlo", letterSpacing: 4 },
  discovery: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: 11 },
  empty: { ...type.caption, textAlign: "center", padding: space.xl, borderWidth: 1, borderStyle: "dashed", borderColor: color.border, borderRadius: radius.lg },
  error: { color: color.destructive, fontSize: 13 },
});
