import { Box, Cloud, Sparkles, type LucideIcon } from "lucide-react";
import type { SecretField } from "@/components/HubKeyList";

/// The cloud accounts a thread can run in, with what each one's key needs.
export type CloudProvider = {
  id: "fly-sprites" | "modal" | "cursor-cloud";
  name: string;
  /// Where you get its key.
  href: string;
  hrefLabel: string;
  keyLabel: string;
  fields: SecretField[];
  icon: LucideIcon;
  /// What a thread gets there, as one sentence.
  runs: string;
};

export const CLOUD_PROVIDERS: CloudProvider[] = [
  { id: "fly-sprites", name: "Fly.io Sprites", href: "https://sprites.dev", hrefLabel: "sprites.dev", keyLabel: "Sprites token", fields: [{ id: "token", label: "Token" }], icon: Cloud, runs: "Each thread gets a fresh sprite in your Fly.io account." },
  { id: "modal", name: "Modal", href: "https://modal.com/settings", hrefLabel: "Modal settings", keyLabel: "Modal token", fields: [{ id: "tokenId", label: "Token ID", secret: false, placeholder: "ak-…" }, { id: "tokenSecret", label: "Token secret", placeholder: "as-…" }], icon: Box, runs: "Each thread gets a fresh sandbox in your Modal account." },
  { id: "cursor-cloud", name: "Cursor Cloud", href: "https://cursor.com/dashboard", hrefLabel: "the Cursor dashboard", keyLabel: "Cursor API key", fields: [{ id: "token", label: "API key" }], icon: Sparkles, runs: "Cursor clones the workspace onto a computer it hosts." },
];

export const cloudProvider = (id: string) => CLOUD_PROVIDERS.find(provider => provider.id === id);

/// What `GET /hosted` says about an account's cloud connections.
export type CloudConnections = {
  connections?: string[];
  enabledProviders?: string[];
  providerKeys?: Record<string, { id: string; name: string; active?: boolean }[]>;
  available?: boolean;
};
