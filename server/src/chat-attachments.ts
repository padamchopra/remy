import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./paths.js";
import type { ChatImageAttachment } from "./transcript.js";

export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_IMAGES = 8;

const IMAGE_TYPES = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

type ImageMimeType = keyof typeof IMAGE_TYPES;

const root = join(configDir, "attachments");

function imageType(value: unknown): ImageMimeType {
  const mimeType = typeof value === "string" ? value.toLowerCase().split(";", 1)[0].trim() : "";
  if (!(mimeType in IMAGE_TYPES)) throw new Error("use a PNG, JPEG, GIF, or WebP image");
  return mimeType as ImageMimeType;
}

function safeName(value: unknown): string {
  const base = (String(value ?? "image").split(/[\\/]/).pop() ?? "image").trim();
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
  return cleaned || "image";
}

function hasImageSignature(data: Buffer, mimeType: ImageMimeType): boolean {
  if (mimeType === "image/png") {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === "image/jpeg") return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mimeType === "image/gif") return data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString("ascii"));
  return data.length >= 12
    && data.subarray(0, 4).toString("ascii") === "RIFF"
    && data.subarray(8, 12).toString("ascii") === "WEBP";
}

function chatDirectory(chatId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(chatId)) throw new Error("that thread cannot receive images");
  return join(root, chatId);
}

function attachmentPath(chatId: string, id: string, mimeType: ImageMimeType): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("that image is not available");
  return join(chatDirectory(chatId), `${id}.${IMAGE_TYPES[mimeType]}`);
}

export function saveChatImage(chatId: string, name: unknown, mime: unknown, data: Buffer): ChatImageAttachment {
  const mimeType = imageType(mime);
  if (data.length === 0) throw new Error("that image is empty");
  if (data.length > MAX_CHAT_IMAGE_BYTES) throw new Error("that image is larger than 10 MB");
  if (!hasImageSignature(data, mimeType)) throw new Error("that file does not match its image type");
  const id = randomUUID();
  const directory = chatDirectory(chatId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(attachmentPath(chatId, id, mimeType), data, { flag: "wx" });
  return { id, name: safeName(name), mimeType, sizeBytes: data.length };
}

export function validateChatImages(chatId: string, value: unknown): ChatImageAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("images must be a list");
  if (value.length > MAX_CHAT_IMAGES) throw new Error("you can attach up to 8 images");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("that image is not available");
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : "";
    const mimeType = imageType(raw.mimeType);
    const path = attachmentPath(chatId, id, mimeType);
    let sizeBytes = 0;
    try {
      sizeBytes = statSync(path).size;
    } catch {
      throw new Error("that image is not available");
    }
    if (sizeBytes <= 0 || sizeBytes > MAX_CHAT_IMAGE_BYTES) throw new Error("that image is not available");
    return { id, name: safeName(raw.name), mimeType, sizeBytes };
  });
}

export function readChatImage(chatId: string, attachment: ChatImageAttachment): {
  base64: string;
  dataUrl: string;
} {
  const mimeType = imageType(attachment.mimeType);
  const data = readFileSync(attachmentPath(chatId, attachment.id, mimeType));
  const base64 = data.toString("base64");
  return { base64, dataUrl: `data:${mimeType};base64,${base64}` };
}
