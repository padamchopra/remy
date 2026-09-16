const presets = new Set(["cobalt-cyclops", "coral-sprout", "lavender-jelly", "mint-crescent", "tangerine-sunburst", "turquoise-cloud"]);
export function validProfileImage(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.startsWith("preset:")) return presets.has(value.slice(7));
  if (value.startsWith("data:")) return value.length <= 100_000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
  if (value.length > 2048 || !URL.canParse(value)) return false;
  return ["https:", "http:"].includes(new URL(value).protocol);
}
