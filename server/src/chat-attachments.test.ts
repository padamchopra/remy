import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const stateDir = mkdtempSync(join(tmpdir(), "remy-chat-images-"));
process.env.MC_CONFIG_DIR = stateDir;

const attachments = await import("./chat-attachments.js");
const chatId = "11111111-1111-4111-8111-111111111111";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

test("an uploaded image becomes an opaque thread-owned attachment", () => {
  const saved = attachments.saveChatImage(chatId, "screen shot.png", "image/png", png);
  assert.match(saved.id, /^[0-9a-f-]{36}$/i);
  assert.equal(saved.name, "screen shot.png");
  assert.equal(saved.mimeType, "image/png");
  assert.equal(saved.sizeBytes, png.length);

  const [validated] = attachments.validateChatImages(chatId, [saved]);
  assert.deepEqual(validated, saved);
  assert.equal(attachments.readChatImage(chatId, saved).base64, png.toString("base64"));
});

test("an attachment id cannot cross into another thread", () => {
  const saved = attachments.saveChatImage(chatId, "screen.png", "image/png", png);
  assert.throws(
    () => attachments.validateChatImages("22222222-2222-4222-8222-222222222222", [saved]),
    /not available/,
  );
});

test("the upload validates image bytes instead of trusting the header", () => {
  assert.throws(
    () => attachments.saveChatImage(chatId, "not-really.png", "image/png", Buffer.from("not an image")),
    /does not match/,
  );
  assert.throws(
    () => attachments.saveChatImage(chatId, "image.svg", "image/svg+xml", Buffer.from("<svg/>")),
    /PNG, JPEG, GIF, or WebP/,
  );
});
