export type AccountEmail = {
  kind: "auth.magic-link" | "auth.verify-email" | "auth.change-email" | "organization.invite";
  recipient: string;
  url: string;
};

export type EmailDelivery = {
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
  EMAILS?: Queue<AccountEmail>;
};

export function emailAvailable(env: EmailDelivery): boolean {
  return !!((env.EMAIL && env.EMAIL_FROM) || env.EMAILS);
}

const copy = {
  "auth.magic-link": { subject: "Your Remy sign-in link", action: "Continue to Remy", detail: "Use this link to sign in or create your account.", expiry: "This link expires in 5 minutes and works once." },
  "auth.verify-email": { subject: "Verify your email for Remy", action: "Verify email", detail: "Confirm this email address for your Remy account.", expiry: "" },
  "auth.change-email": { subject: "Confirm your new email for Remy", action: "Confirm email", detail: "Confirm the new email address for your Remy account.", expiry: "" },
  "organization.invite": { subject: "You’re invited to Remy", action: "Review invitation", detail: "Sign in to review your invitation before joining.", expiry: "" },
} satisfies Record<AccountEmail["kind"], { subject: string; action: string; detail: string; expiry: string }>;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export async function sendAccountEmail(env: EmailDelivery, mail: AccountEmail): Promise<void> {
  if (env.EMAIL && env.EMAIL_FROM) {
    const message = copy[mail.kind];
    try {
      await env.EMAIL.send({
        from: { name: "Remy", email: env.EMAIL_FROM },
        to: mail.recipient,
        subject: message.subject,
        text: [message.detail, mail.url, message.expiry, "If you didn’t request this email, you can ignore it."].filter(Boolean).join("\n\n"),
        html: `<h1>${message.subject}</h1><p>${message.detail}</p><p><a href="${escapeHtml(mail.url)}">${message.action}</a></p>${message.expiry ? `<p>${message.expiry}</p>` : ""}<p>If you didn’t request this email, you can ignore it.</p>`,
      });
    } catch {
      throw new Error("Couldn’t send your email; try again.");
    }
    return;
  }
  if (env.EMAILS) {
    await env.EMAILS.send(mail);
    return;
  }
  throw new Error("Email delivery is not configured");
}
