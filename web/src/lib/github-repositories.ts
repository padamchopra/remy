/// The last repository listing per account, so reopening the picker paints
/// rows immediately instead of waiting out a fresh GitHub round trip. The
/// listing is always read again behind what is painted.
export type GitHubRepository = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  private: boolean;
  pushedAt: string | null;
};

type Listing = { repositories: GitHubRepository[]; nextPage: number | null; connection: string };

/// Enough for the accounts one person moves between in a sitting. The oldest
/// entry is dropped rather than letting a long session keep every listing it
/// has ever seen.
const LIMIT = 4;
const listings = new Map<string, Listing>();

/// A cached listing for this account, if the connection it was read with is
/// still the connection in front of us. A listing read with another GitHub
/// account is not this account's answer, so it is dropped rather than shown.
export function cachedRepositories(key: string, connection: string): Listing | undefined {
  const listing = listings.get(key);
  if (!listing) return undefined;
  if (connection && listing.connection && listing.connection !== connection) {
    listings.delete(key);
    return undefined;
  }
  // Re-inserting keeps the accounts in use at the young end of the map.
  listings.delete(key);
  listings.set(key, listing);
  return listing;
}

export function rememberRepositories(key: string, listing: Listing) {
  listings.delete(key);
  listings.set(key, listing);
  while (listings.size > LIMIT) listings.delete(listings.keys().next().value!);
}

/// Called when a token or a reconnect makes the previous answer wrong.
export function forgetRepositories(key: string) {
  listings.delete(key);
}
