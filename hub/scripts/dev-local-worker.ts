import worker, { HubCoordinator as Coordinator } from "../src/worker.js";
import type { Env } from "../src/worker.js";

type LocalEnv = Env & { LOCAL_AUTH_SECRET: string };
const bind = (env: LocalEnv): Env => ({
  ...env,
  AUTH_SECRET: { get: async () => env.LOCAL_AUTH_SECRET } as SecretsStoreSecret,
  EMAIL_FROM: "local@remy.test",
  EMAIL: { send: async (mail: EmailMessageBuilder) => {
    await env.DB.prepare("INSERT INTO local_emails (recipient,subject,body) VALUES (?,?,?)")
      .bind(typeof mail.to === "string" ? mail.to : JSON.stringify(mail.to), mail.subject, mail.text ?? "").run();
    return { messageId: crypto.randomUUID() };
  } } as SendEmail,
});

export class HubCoordinator extends Coordinator {
  constructor(ctx: DurableObjectState, env: LocalEnv) { super(ctx, bind(env)); }
}

export default {
  ...worker,
  async fetch(request: Request, env: LocalEnv) {
    const url = new URL(request.url);
    if (url.pathname === "/__dev/mail") {
      if (request.method !== "GET" || url.hostname !== "127.0.0.1" ||
          request.headers.get("sec-fetch-site") === "cross-site" ||
          (request.headers.has("origin") && request.headers.get("origin") !== url.origin))
        return new Response("Forbidden", {status:403});
      const { results } = await env.DB.prepare("SELECT recipient,subject,body FROM local_emails ORDER BY id DESC LIMIT 20").all();
      const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
      return new Response(`<h1>Local email</h1><p>Development only. These messages are not sent.</p>${results.map(mail => `<article><h2>${escape(mail.subject)}</h2><p>${escape(mail.recipient)}</p><pre>${escape(mail.body)}</pre></article>`).join("")}`, {
        headers: {"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; frame-ancestors 'none'"},
      });
    }
    return worker.fetch(request, bind(env));
  },
};
