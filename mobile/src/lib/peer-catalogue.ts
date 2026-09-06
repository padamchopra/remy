export interface RememberedPeer {
  id: string;
  name: string;
  url: string;
  icon?: string;
  tint?: string;
  notify?: boolean;
}

export type PeerCatalogues = Record<string, RememberedPeer[]>;

function rememberedPeer(raw: unknown): RememberedPeer | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const peer = raw as Record<string, unknown>;
  const id = typeof peer.id === "string" ? peer.id.trim() : "";
  const name = typeof peer.name === "string" ? peer.name.trim() : "";
  const url = typeof peer.url === "string" ? peer.url.trim().replace(/\/+$/, "") : "";
  if (!id || !name || !url) return undefined;
  return {
    id,
    name,
    url,
    ...(typeof peer.icon === "string" && peer.icon ? { icon: peer.icon } : {}),
    ...(typeof peer.tint === "string" && peer.tint ? { tint: peer.tint } : {}),
    ...(typeof peer.notify === "boolean" ? { notify: peer.notify } : {}),
  };
}

export function parsePeerCatalogues(raw: string | null | undefined): PeerCatalogues {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const catalogues: PeerCatalogues = {};
    for (const [origin, peers] of Object.entries(parsed as Record<string, unknown>)) {
      if (!origin.trim() || !Array.isArray(peers)) continue;
      const remembered = peers
        .map(rememberedPeer)
        .filter((peer): peer is RememberedPeer => Boolean(peer));
      if (remembered.length > 0) catalogues[origin.replace(/\/+$/, "")] = remembered;
    }
    return catalogues;
  } catch {
    return {};
  }
}

export function serializePeerCatalogues(catalogues: PeerCatalogues): string {
  return JSON.stringify(catalogues);
}

export function retainPeerCatalogues(
  catalogues: PeerCatalogues,
  origins: ReadonlySet<string>,
): { catalogues: PeerCatalogues; changed: boolean } {
  const kept = Object.fromEntries(Object.entries(catalogues).filter(([origin]) => origins.has(origin)));
  return {
    catalogues: kept,
    changed: Object.keys(kept).length !== Object.keys(catalogues).length,
  };
}

/// Replaces one direct Mac's remembered roster. Volatile reachability and
/// last-seen fields are intentionally omitted so routine refreshes do not turn
/// into keychain writes.
export function rememberPeerCatalogue(
  catalogues: PeerCatalogues,
  origin: string,
  peers: readonly RememberedPeer[],
): { catalogues: PeerCatalogues; changed: boolean } {
  const key = origin.replace(/\/+$/, "");
  const remembered = peers
    .map(rememberedPeer)
    .filter((peer): peer is RememberedPeer => Boolean(peer));
  const previous = catalogues[key] ?? [];
  if (JSON.stringify(previous) === JSON.stringify(remembered)) return { catalogues, changed: false };
  const next = { ...catalogues };
  if (remembered.length > 0) next[key] = remembered;
  else delete next[key];
  return { catalogues: next, changed: true };
}
