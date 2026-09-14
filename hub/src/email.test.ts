import assert from "node:assert/strict";
import test from "node:test";
import { emailAvailable, sendAccountEmail } from "./email.js";
import { authOptionsFor } from "./auth.js";
import { createRouteHandler, type Env } from "./worker.js";

const native = () => {
  const sent: EmailMessageBuilder[] = [];
  return { sent, EMAIL: { send: async (mail: EmailMessageBuilder) => { sent.push(mail); return { messageId: "delivered" }; } } as SendEmail, EMAIL_FROM: "no-reply@remy.example" };
};

test("native email delivery exposes passwordless signup without social providers", async () => {
  const mail = native();
  const response = await createRouteHandler()(new Request("https://app.remy.example/api/runtime"), { DB: {}, ...mail } as unknown as Env);
  const runtime = await response.json() as { auth: { magicLink: boolean; google: boolean; github: boolean } };
  assert.equal(runtime.auth.magicLink, true);
  assert.equal(runtime.auth.google, false);
  assert.equal(runtime.auth.github, false);
});

test("verification emails use the native binding and escape the action URL", async () => {
  const mail = native();
  const options = authOptionsFor({ DB: {} as D1Database, BETTER_AUTH_URL: "https://remy.example", ...mail }, "test-secret-with-at-least-thirty-two-characters");
  const url = 'https://remy.example/api/auth/verify-email?token=secret&callbackURL=%2F';
  await options.emailVerification!.sendVerificationEmail!({ user: { email: "new@example.test" }, url, token: "secret" } as never);
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, "new@example.test");
  assert.deepEqual(mail.sent[0].from, { name: "Remy", email: "no-reply@remy.example" });
  assert.ok(mail.sent[0].text?.includes(url));
  assert.ok(mail.sent[0].html?.includes("&amp;callbackURL="));
});


test("email availability requires a sender and retains queue compatibility", async () => {
  const mail = native();
  assert.equal(emailAvailable({ EMAIL: mail.EMAIL }), false);
  assert.equal(emailAvailable({ EMAIL_FROM: mail.EMAIL_FROM }), false);
  assert.equal(emailAvailable({}), false);
  const queued: unknown[] = [];
  const EMAILS = { send: async (message: unknown) => { queued.push(message); } } as unknown as Queue;
  assert.equal(emailAvailable({ EMAILS }), true);
  const message = { kind: "auth.magic-link" as const, recipient: "new@example.test", url: "https://remy.example/verify?token=sample" };
  await sendAccountEmail({ EMAILS }, message);
  assert.deepEqual(queued, [message]);
});

test("magic links describe signup, expiry and single use", async () => {
  const mail = native();
  await sendAccountEmail(mail, { kind: "auth.magic-link", recipient: "new@example.test", url: "https://remy.example/verify?token=sample" });
  assert.equal(mail.sent[0].subject, "Your Remy sign-in link");
  assert.match(mail.sent[0].text!, /sign in or create your account/);
  assert.match(mail.sent[0].text!, /5 minutes and works once/);
});

test("delivery failures reject without exposing provider details or falling back to duplicate mail", async () => {
  let queued = false;
  await assert.rejects(sendAccountEmail({ ...native(), EMAIL: { send: async () => { throw new Error("provider response containing a sign-in token"); } } as SendEmail, EMAILS: { send: async () => { queued = true; } } as unknown as Queue }, { kind: "auth.magic-link", recipient: "new@example.test", url: "https://remy.example/verify" }), { message: "Couldn’t send your email; try again." });
  assert.equal(queued, false);
});
