export interface FleetPairing {
  url: string;
  token: string;
  name?: string;
  deviceId?: string;
}

export interface DiscoveredPeer {
  id: string;
  name: string;
  url: string;
}

export interface PeerIdentity {
  deviceId?: string;
  name?: string;
  url?: string;
  token?: string;
}

export function pairingServerId(pairing: Pick<FleetPairing, "url" | "deviceId">): string {
  return pairing.deviceId?.trim() || `direct:${pairing.url.replace(/\/+$/, "")}`;
}

export function upsertFleetPairing<T extends FleetPairing>(list: T[], next: T): T[] {
  const origin = next.url.replace(/\/+$/, "");
  const deviceId = next.deviceId?.trim();
  return [
    ...list.filter((entry) =>
      entry.url.replace(/\/+$/, "") !== origin
      && (!deviceId || entry.deviceId?.trim() !== deviceId)),
    { ...next, url: origin },
  ];
}

/// A relayed identity becomes a direct phone pairing only when the computer
/// vouches for the same stable id the gateway advertised.
export function directPairingForPeer(peer: DiscoveredPeer, identity: PeerIdentity): FleetPairing | undefined {
  const deviceId = identity.deviceId?.trim();
  const token = identity.token?.trim();
  const url = (identity.url?.trim() || peer.url.trim()).replace(/\/+$/, "");
  if (!deviceId || deviceId !== peer.id || !token || !url) return undefined;
  return {
    deviceId,
    token,
    url,
    name: identity.name?.trim() || peer.name,
  };
}
