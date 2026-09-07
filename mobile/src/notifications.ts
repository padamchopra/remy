import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { transport } from "./lib/transport";
import { notificationDestination, type NavigationDestination } from "./lib/navigation-destination";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/// Registers this phone for Apple Push on every Mac it is paired with. The
/// native device token goes to each daemon; Expo's own push service is never
/// involved, so nothing leaves your tailnet besides Apple's APNs servers.

export async function registerPush(): Promise<void> {
  if (Platform.OS !== "ios") return;
  if (transport.pairings().length === 0) return;
  const existing = await Notifications.getPermissionsAsync();
  const next =
    existing.status === "granted" ? existing : await Notifications.requestPermissionsAsync();
  if (next.status !== "granted") return;
  const token = await Notifications.getDevicePushTokenAsync();
  const servers = await transport.servers();
  const homes = servers.filter((server) => server.home && server.online);
  await Promise.all(
    homes.map((home) =>
      transport
        .request(home.id, "/push/register", {
          method: "POST",
          body: { token: token.data, name: Device.deviceName ?? "iPhone" },
        })
        .catch(() => {}),
    ),
  );
}

export function listenForNotificationTap(onDestination: (destination: NavigationDestination) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const destination = notificationDestination(response.notification.request.content.data);
    if (destination) onDestination(destination);
  });
  return () => sub.remove();
}
