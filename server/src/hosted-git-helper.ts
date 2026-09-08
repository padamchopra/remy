#!/usr/bin/env node
import { getKv } from "./db.js";
import { connectionAuthorization } from "./hub-computer.js";

if (process.argv[2] === "get") {
  try {
    let raw = "";
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (raw.length > 8192) throw Error();
    }
    const fields = Object.fromEntries(
      raw
        .trim()
        .split("\n")
        .map((line) => {
          const i = line.indexOf("=");
          return [line.slice(0, i), line.slice(i + 1)];
        }),
    );
    const registration = getKv<{
      hubUrl: string;
      organizationId: string;
      computerId: string;
    }>("hubComputerRegistration");
    const key = getKv<string>("hubComputerPrivateKey"),
      workspace = getKv<string>("hostedWorkspaceId");
    if (!registration || !key || !workspace) throw Error();
    const hub = new URL(registration.hubUrl),
      path = `api/organizations/${encodeURIComponent(registration.organizationId)}/git/${encodeURIComponent(workspace)}`;
    if (
      fields.protocol !== hub.protocol.slice(0, -1) ||
      fields.host !== hub.host ||
      fields.path?.replace(/\/$/, "") !== path
    )
      throw Error();
    const response = await fetch(new URL(`/${path}/token`, hub), {
      method: "POST",
      headers: {
        authorization: connectionAuthorization(
          registration.organizationId,
          registration.computerId,
          key,
        ),
        "content-type": "application/json",
      },
      body: JSON.stringify({ write: process.env.REMY_GIT_READ_ONLY !== "1" }),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error();
    const value = (await response.json()) as { token: string };
    process.stdout.write(`username=remy\npassword=${value.token}\n\n`);
  } catch {
    process.exitCode = 1;
  }
}
