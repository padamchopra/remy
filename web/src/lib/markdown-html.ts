import type { Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";

/// GitHub's own allowlist, which `hast-util-sanitize` ships as its default,
/// plus the `media` and `type` a `<picture>` source needs to pick its light or
/// dark image the way github.com does.
export const GITHUB_HTML_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    source: [...(defaultSchema.attributes?.source ?? []), "media", "type"],
  },
};

/// Raw HTML in text written on GitHub, rendered as GitHub renders it: parsed,
/// then reduced to the elements and attributes GitHub keeps. Loaded only for
/// text that has HTML in it, so the parser stays out of the first load.
export const githubHtmlPlugins: NonNullable<Options["rehypePlugins"]> = [rehypeRaw, [rehypeSanitize, GITHUB_HTML_SCHEMA]];
