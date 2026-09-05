import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StatusBar, StyleSheet, View } from "react-native";
import { DarkTheme, NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Linking from "expo-linking";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { color } from "./src/theme";
import { pairingError } from "./src/lib/api-error";
import { hostLabel, parsePairingLink, threadIdFromLink } from "./src/lib/pairing";
import { hydrateAppearance } from "./src/lib/devices";
import { loadPairings, originOf, removePairing, savePairings, upsertPairing, type Pairing } from "./src/lib/session";
import { transport } from "./src/lib/transport";
import { listenForNotificationTap, registerPush } from "./src/notifications";
import { useStore } from "./src/state/store";
import type { RootStackParamList } from "./src/navigation";
import { PairRequestModal } from "./src/components/PairRequest";
import { PairedShell } from "./src/components/PairedShell";
import { Toast, type ToastMessage } from "./src/components/Toast";
import { AgentScreen } from "./src/screens/AgentScreen";
import { PairScreen } from "./src/screens/PairScreen";
import { RoutineScreen } from "./src/screens/RoutineScreen";
import { ScanScreen } from "./src/screens/ScanScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const navRef = createNavigationContainerRef<RootStackParamList>();
const openThreadFromOutside: { current: (id: string) => void } = { current: () => {} };
const NAV_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: color.background,
    card: color.card,
    text: color.foreground,
    border: color.border,
    primary: color.primary,
  },
};

function PairedApp({
  onCommit,
  onPairError,
  onUnpair,
}: {
  onCommit: (pairing: Pairing) => Promise<void>;
  onPairError: (error: unknown) => void;
  onUnpair: (url: string) => void;
}) {
  const start = useStore((s) => s.start);
  const loadSettings = useStore((s) => s.loadSettings);
  const loadProviders = useStore((s) => s.loadProviders);
  const loadBoard = useStore((s) => s.loadBoard);
  const anyOnline = useStore((s) => s.servers.some((server) => server.online));

  useEffect(() => start(), [start]);

  // A Mac on a current build resyncs itself when its live stream opens. This is
  // for one whose stream never does — an older build, or a tunnel that will not
  // hold a socket — so its defaults and its catalogue still arrive.
  useEffect(() => {
    if (!anyOnline) return;
    void loadSettings().catch(() => {});
    void loadProviders().catch(() => {});
    void loadBoard().catch(() => {});
    void registerPush().catch(() => {});
  }, [anyOnline, loadSettings, loadProviders, loadBoard]);

  useEffect(() => listenForNotificationTap((id) => openThreadFromOutside.current(id)), []);

  return (
    <>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: color.background },
          headerTintColor: color.foreground,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: color.background },
        }}
      >
        <Stack.Screen name="Home" options={{ headerShown: false }}>
          {() => (
            <PairedShell
              openThreadRef={openThreadFromOutside}
              onPairAnother={() => navRef.isReady() && navRef.navigate("Pair")}
              onOpenAgent={(agentId) => navRef.isReady() && navRef.navigate("Agent", { agentId })}
              onUnpair={onUnpair}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Agent" options={{ title: "Agent" }}>
          {({ navigation, route }) => (
            <AgentScreen
              agentId={route.params.agentId}
              onOpenRoutine={(routineId) => navigation.navigate("Routine", { routineId })}
              onDeleted={() => navigation.navigate("Home")}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Routine" options={{ title: "Routine" }}>
          {({ navigation, route }) => (
            <RoutineScreen routineId={route.params.routineId} onDone={() => navigation.goBack()} />
          )}
        </Stack.Screen>
        <Stack.Screen name="Pair" options={{ title: "Pair another Mac" }}>
          {({ navigation }) => (
            <PairScreen
              onPaired={async (pairing) => {
                await onCommit(pairing);
                navigation.navigate("Home");
              }}
              onScan={() => navigation.navigate("Scan")}
              onCancel={() => navigation.goBack()}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Scan" options={{ headerShown: false, title: "Scan" }}>
          {({ navigation }) => (
            <ScanScreen
              onCancel={() => navigation.goBack()}
              onCode={(raw) => {
                void (async () => {
                  const parsed = parsePairingLink(raw);
                  if (!parsed) return;
                  try {
                    const pairing: Pairing = {
                      url: originOf(parsed.url),
                      token: parsed.token,
                      name: hostLabel(parsed.url),
                    };
                    const probed = await transport.probe(pairing);
                    await onCommit({
                      ...pairing,
                      name: probed.name,
                      ...(probed.deviceId ? { deviceId: probed.deviceId } : {}),
                    });
                    navigation.navigate("Home");
                  } catch (error) {
                    navigation.goBack();
                    onPairError(error);
                  }
                })();
              }}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
      <PairRequestModal />
    </>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [scan, setScan] = useState(false);
  const [toast, setToast] = useState<ToastMessage>();
  const pairingsRef = useRef<Pairing[]>([]);
  pairingsRef.current = pairings;

  const dismissToast = useCallback(() => setToast(undefined), []);
  const showPairError = useCallback((error: unknown) => {
    setToast({
      id: Date.now(),
      title: "Couldn't pair with that Mac",
      detail: pairingError(error),
    });
  }, []);

  useEffect(() => {
    void Promise.all([loadPairings(), hydrateAppearance()]).then(([loaded]) => {
      if (loaded.length) transport.setPairings(loaded);
      pairingsRef.current = loaded;
      setPairings(loaded);
      setReady(true);
    });
  }, []);

  const commit = async (pairing: Pairing) => {
    const wasPaired = pairingsRef.current.length > 0;
    const next = upsertPairing(pairingsRef.current, pairing);
    pairingsRef.current = next;
    await savePairings(next);
    transport.setPairings(next);
    setPairings(next);
    if (wasPaired) {
      await useStore.getState().refresh();
      void registerPush().catch(() => {});
    }
  };

  const forget = (url: string) => {
    const next = removePairing(pairingsRef.current, url);
    pairingsRef.current = next;
    void savePairings(next);
    transport.setPairings(next);
    setPairings(next);
    if (next.length) void useStore.getState().refresh();
  };

  const applyLink = async (raw: string) => {
    const parsed = parsePairingLink(raw);
    if (parsed) {
      const pairing: Pairing = { url: originOf(parsed.url), token: parsed.token, name: hostLabel(parsed.url) };
      try {
        const probed = await transport.probe(pairing);
        await commit({
          ...pairing,
          name: probed.name,
          ...(probed.deviceId ? { deviceId: probed.deviceId } : {}),
        });
      } catch (error) {
        setScan(false);
        showPairError(error);
        return;
      }
      setScan(false);
      return;
    }
    const threadId = threadIdFromLink(raw);
    if (threadId) openThreadFromOutside.current(threadId);
  };

  useEffect(() => {
    const sub = Linking.addEventListener("url", ({ url }) => {
      void applyLink(url);
    });
    void Linking.getInitialURL().then((url) => {
      if (url) void applyLink(url);
    });
    return () => sub.remove();
  }, [showPairError]);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={color.foreground} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.root} edges={pairings.length > 0 ? ["left", "right"] : ["top", "left", "right"]}>
          {pairings.length > 0 ? (
            <NavigationContainer ref={navRef} theme={NAV_THEME}>
              <PairedApp onCommit={commit} onPairError={showPairError} onUnpair={forget} />
            </NavigationContainer>
          ) : scan ? (
            <ScanScreen
              onCancel={() => setScan(false)}
              onCode={(raw) => void applyLink(raw)}
            />
          ) : (
            <PairScreen onPaired={(pairing) => void commit(pairing)} onScan={() => setScan(true)} />
          )}
          <Toast message={toast} onDismiss={dismissToast} />
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  boot: { flex: 1, backgroundColor: color.background, alignItems: "center", justifyContent: "center" },
});
