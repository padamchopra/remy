import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-linear-"));
const { connectLinearAccount, disconnectLinearAccount, linearView, localLinearAccess, setLinearLink } = await import("./linear-accounts.js");

const verify = async (token: string) => ({ id: token.endsWith("other") ? "ws-other" : "ws-studio", label: token.endsWith("other") ? "Other" : "Studio" });

test("a second Linear key adds a row and the thread waits for both the link and the sign-in", async () => {
  const first = await connectLinearAccount("secret-studio", undefined, verify);
  const second = await connectLinearAccount("secret-other", undefined, verify);
  assert.equal(second.accounts.length, 2);
  assert.equal(first.accounts.length, 1);
  assert.equal(JSON.stringify(linearView()).includes("secret-"), false);
  assert.deepEqual(localLinearAccess(), { kind: "off" });
  setLinearLink(second.accounts.find((row) => row.externalId === "ws-studio")!.id);
  const ready = localLinearAccess();
  assert.equal(ready.kind, "ready");
  if (ready.kind !== "ready") return;
  assert.equal(ready.token, "secret-studio");
  assert.equal(ready.url, "https://mcp.linear.app/mcp");
  disconnectLinearAccount(second.accounts.find((row) => row.externalId === "ws-studio")!.id);
  assert.equal(linearView().link, null);
  assert.equal(linearView().accounts.length, 1);
  assert.deepEqual(localLinearAccess(), { kind: "off" });
});
