import type { ChatImageAttachment } from "../state/types";

export type ImageMimeType = ChatImageAttachment["mimeType"];

export function imageMimeType(mimeType?: string, name?: string | null): ImageMimeType | undefined {
  const normalized = mimeType?.toLowerCase().split(";", 1)[0];
  if (normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/gif" || normalized === "image/webp") {
    return normalized;
  }
  const extension = name?.toLowerCase().split(".").pop();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  return undefined;
}

export function extensionFor(mimeType: ImageMimeType): string {
  if (mimeType === "image/jpeg") return "jpg";
  return mimeType.slice("image/".length);
}
