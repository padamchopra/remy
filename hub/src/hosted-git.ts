import { createPrivateKey, sign } from "node:crypto";

export type GitGrant = {
  organizationId: string;
  computerId: string;
  workspaceId: string;
  repository: string;
  branches: string[];
  write: boolean;
  expiresAt: number;
};
const encode = (value: string | Uint8Array) =>
  Buffer.from(value).toString("base64url");
export function githubRepository(origin: string): string | undefined {
  const match =
    /^(?:https:\/\/|git@)?github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(
      origin,
    );
  return match?.[1]?.toLowerCase();
}
export class GitCapabilities {
  constructor(
    private readonly secret: () => Promise<string>,
    private readonly now = Date.now,
  ) {}
  private async key() {
    return crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(await this.secret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  async issue(input: Omit<GitGrant, "expiresAt">) {
    const grant = { ...input, expiresAt: this.now() + 300_000 };
    const payload = encode(JSON.stringify(grant));
    return {
      token: `${payload}.${encode(new Uint8Array(await crypto.subtle.sign("HMAC", await this.key(), new TextEncoder().encode(payload))))}`,
      expiresAt: grant.expiresAt,
    };
  }
  async read(token: string): Promise<GitGrant | undefined> {
    try {
      const parts = token.split(".");
      if (parts.length !== 2 || token.length > 8000) return;
      if (
        !(await crypto.subtle.verify(
          "HMAC",
          await this.key(),
          Buffer.from(parts[1]!, "base64url"),
          new TextEncoder().encode(parts[0]),
        ))
      )
        return;
      const value = JSON.parse(
        Buffer.from(parts[0]!, "base64url").toString(),
      ) as GitGrant;
      if (
        value.expiresAt <= this.now() ||
        value.expiresAt > this.now() + 300_000
      )
        return;
      return value;
    } catch {
      return;
    }
  }
}
export function validatePush(bytes: Uint8Array, branches: string[]): boolean {
  let offset = 0,
    commands = 0;
  const decode = new TextDecoder("utf-8", { fatal: true });
  try {
    while (offset + 4 <= bytes.length) {
      const lengthText = decode.decode(bytes.subarray(offset, offset + 4));
      if (!/^[0-9a-f]{4}$/i.test(lengthText)) return false;
      const length = parseInt(lengthText, 16);
      offset += 4;
      if (length === 0) return commands > 0;
      if (length < 4 || length > 65520 || offset + length - 4 > bytes.length)
        return false;
      let line = decode.decode(bytes.subarray(offset, offset + length - 4));
      offset += length - 4;
      if (line.startsWith("shallow ")) {
        if (commands || !/^shallow [0-9a-f]{40}\n?$/.test(line)) return false;
        continue;
      }
      if (commands === 0) line = line.split("\0")[0]!;
      const match =
        /^([0-9a-f]{40}) ([0-9a-f]{40}) (refs\/heads\/[^\s\0]+)\n?$/.exec(line);
      if (
        !match ||
        !branches.includes(match[3]!.slice(11)) ||
        /^0+$/.test(match[2]!)
      )
        return false;
      commands++;
    }
  } catch {}
  return false;
}
export class GithubInstallation {
  constructor(
    private readonly appId: string,
    private readonly privateKey: () => Promise<string>,
    private readonly send: typeof fetch = fetch,
  ) {}
  async token(
    installation: number,
    repository: string,
    write: boolean,
  ): Promise<string> {
    const at = Math.floor(Date.now() / 1000);
    const unsigned = `${encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${encode(JSON.stringify({ iat: at - 60, exp: at + 540, iss: this.appId }))}`;
    const jwt = `${unsigned}.${encode(sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(await this.privateKey())))}`;
    const response = await this.send(
      `https://api.github.com/app/installations/${installation}/access_tokens`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${jwt}`,
          accept: "application/vnd.github+json",
          "user-agent": "Remy",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repositories: [repository.split("/")[1]],
          permissions: { contents: write ? "write" : "read" },
        }),
        redirect: "error",
      },
    );
    if (!response.ok) throw Error("GitHub access is unavailable.");
    const value = (await response.json()) as { token?: string };
    if (!value.token) throw Error("GitHub access is unavailable.");
    return value.token;
  }
}
export async function proxyGit(
  request: Request,
  grant: GitGrant,
  suffix: string,
  installationToken: () => Promise<string>,
  send: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const service = url.searchParams.get("service");
  const write = suffix === "git-receive-pack" || service === "git-receive-pack";
  const valid =
    (request.method === "GET" &&
      suffix === "info/refs" &&
      ["git-upload-pack", "git-receive-pack"].includes(service ?? "") &&
      [...url.searchParams.keys()].every((k) => k === "service")) ||
    (request.method === "POST" &&
      ["git-upload-pack", "git-receive-pack"].includes(suffix) &&
      !url.search);
  if (!valid || (write && !grant.write))
    return new Response(null, { status: 403 });
  if (request.headers.has("content-encoding"))
    return new Response(null, { status: 415 });
  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 50_000_000) {
            await reader.cancel();
            return new Response(null, { status: 413 });
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    body = bytes.buffer;
    if (write && !validatePush(bytes, grant.branches))
      return new Response(null, { status: 403 });
  }
  if (grant.expiresAt <= Date.now()) return new Response(null, { status: 401 });
  const token = await installationToken();
  if (grant.expiresAt <= Date.now()) return new Response(null, {status:401});
  const upstream = await send(
    `https://github.com/${grant.repository}.git/${suffix}${url.search}`,
    {
      method: request.method,
      headers: {
        authorization: `Basic ${btoa(`x-access-token:${token}`)}`,
        "user-agent": "Remy",
        "content-type": `application/x-${write ? "git-receive-pack" : "git-upload-pack"}-request`,
        ...(request.headers.get("git-protocol")
          ? { "git-protocol": request.headers.get("git-protocol")! }
          : {}),
      },
      ...(body ? {body} : {}),
      redirect: "manual",
    },
  );
  if (!upstream.ok)
    return new Response("GitHub access is unavailable.", { status: 502 });
  return new Response(upstream.body, {
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}
