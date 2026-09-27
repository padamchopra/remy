import { createServer } from "node:http";

// A stand-in for auth.openai.com's device-code and token endpoints, shaped like the
// Codex CLI uses them (openai/codex codex-rs/login). Tests and the disposable QA hub
// point CHATGPT_AUTH_ISSUER here; nothing ever reaches OpenAI.
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload) => `${encode({ alg: "none" })}.${encode(payload)}.fake`;

export async function startFakeOpenAIAuth({ accessTtlSeconds = 3600, refreshDelayMs = 0 } = {}) {
  let sequence = 0;
  const devices = new Map();
  const refreshTokens = new Map();
  const calls = { usercode: 0, poll: 0, exchange: 0, refresh: 0 };
  const state = { accessTtlSeconds, refreshDelayMs };
  const issue = (who) => {
    sequence += 1;
    const refresh = `fake-refresh-${sequence}`;
    refreshTokens.set(refresh, who);
    return {
      id_token: jwt({ email: who.email, "https://api.openai.com/auth": { chatgpt_account_id: who.accountId } }),
      access_token: jwt({ exp: Math.floor(Date.now() / 1000) + state.accessTtlSeconds, account: who.accountId, n: sequence }),
      refresh_token: refresh,
    };
  };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const send = (status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value ?? {})); };
    if (req.method !== "POST") return send(405);
    if (req.url === "/api/accounts/deviceauth/usercode") {
      calls.usercode += 1;
      if (JSON.parse(raw).client_id !== CLIENT_ID) return send(400, { error: "invalid_client" });
      const id = `fake-device-${devices.size + 1}`;
      devices.set(id, { userCode: "DEMO-0000", approved: undefined });
      return send(200, { device_auth_id: id, user_code: "DEMO-0000", interval: "1" });
    }
    if (req.url === "/api/accounts/deviceauth/token") {
      calls.poll += 1;
      const input = JSON.parse(raw);
      const device = devices.get(input.device_auth_id);
      if (!device || device.userCode !== input.user_code) return send(400, { error: "invalid_request" });
      if (!device.approved) return send(403, { error: "authorization_pending" });
      device.code = `fake-code-${input.device_auth_id}`;
      return send(200, { authorization_code: device.code, code_challenge: "fake-challenge", code_verifier: `fake-verifier-${input.device_auth_id}` });
    }
    if (req.url === "/oauth/token") {
      if (req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) {
        calls.exchange += 1;
        const form = new URLSearchParams(raw);
        const device = [...devices.entries()].find(([, value]) => value.code === form.get("code"));
        if (form.get("grant_type") !== "authorization_code" || form.get("client_id") !== CLIENT_ID || !device || form.get("code_verifier") !== `fake-verifier-${device[0]}` || !form.get("redirect_uri")?.endsWith("/deviceauth/callback")) return send(400, { error: "invalid_grant" });
        device[1].code = undefined;
        return send(200, issue(device[1].approved));
      }
      calls.refresh += 1;
      const input = JSON.parse(raw);
      if (input.grant_type !== "refresh_token" || input.client_id !== CLIENT_ID) return send(400, { error: "invalid_request" });
      const who = refreshTokens.get(input.refresh_token);
      if (!who) return send(401, { error: { code: "refresh_token_reused" } });
      refreshTokens.delete(input.refresh_token);
      if (state.refreshDelayMs) await new Promise((resolve) => setTimeout(resolve, state.refreshDelayMs));
      return send(200, issue(who));
    }
    send(404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    state,
    /// Approves the newest code that nobody has approved yet, as this ChatGPT account.
    approve(who) {
      const waiting = [...devices.values()].reverse().find((device) => !device.approved);
      if (!waiting) throw new Error("No sign-in is waiting.");
      waiting.approved = who;
    },
    revokeAll() { refreshTokens.clear(); },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
