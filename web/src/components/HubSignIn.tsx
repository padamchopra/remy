import { HubPreviewSignIn } from "./HubPreviewSignIn";
import { useState } from "react";
import { ArrowUpRight, Building2 } from "lucide-react";
import remyMark from "@/assets/remy-mark.png";
import type { HubRuntime } from "@/lib/hub-session";
import { hubRequest } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldSeparator,
} from "@/components/ui/field";

export function HubSignIn({ runtime }: { runtime: HubRuntime }) {
  if (runtime.preview) return <HubPreviewSignIn password={runtime.auth.password} />;
  return <AccountSignIn runtime={runtime} />;
}

function AccountSignIn({ runtime }: { runtime: HubRuntime }) {
  const [email, setEmail] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<string>();
  const [useSso, setUseSso] = useState(false);
  const [createAccount, setCreateAccount] = useState(false);
  const busy = !!pending;
  const hasPassword = runtime.auth.password === true && !useSso;
  const creating = hasPassword && createAccount;
  const passwordMethod = creating ? "signup" : "password";
  const signIn = async (method: "magic-link" | "google" | "github" | "sso" | "password" | "signup") => {
    const enabled =
      method === "magic-link"
        ? runtime.auth.magicLink
        : method === "password" || method === "signup"
          ? hasPassword
          : runtime.auth[method];
    if (busy || !enabled) return;
    setPending(method);
    setMessage("");
    try {
      if (method === "password" || method === "signup") {
        await hubRequest(
          method === "signup" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email",
          "POST",
          {
            email,
            password: passwordValue,
            ...(method === "signup" ? { name: accountNameFromEmail(email) } : {}),
          },
        );
        await hubRequest("/api/sessions/web", "POST");
        window.location.reload();
        return;
      }
      const callback = new URL(window.location.href);
      callback.searchParams.set("signin", "complete");
      const callbackURL = callback.href;
      const input =
        method === "google" || method === "github"
          ? { provider: method, callbackURL }
          : { email, callbackURL };
      const result = await hubRequest<{ url?: string }>(
        `/api/auth/sign-in/${method === "google" || method === "github" ? "social" : method}`,
        "POST",
        input,
      );
      if (result.url) window.location.assign(result.url);
      else setMessage("Check your email for your sign-in link.");
    } catch (e) {
      setMessage(accountAuthMessage(e));
    } finally {
      setPending(undefined);
    }
  };
  const socialMethods = (["google", "github"] as const).filter(
    (method) => runtime.auth[method],
  );
  const hasEmailForm = useSso || runtime.auth.magicLink || hasPassword;
  return (
    <main className="h-svh overflow-y-auto bg-background text-foreground">
      <div className="flex min-h-full flex-col items-center px-6 pb-8 pt-8 sm:pb-10 sm:pt-16">
        <div className="flex shrink-0 items-center gap-2.5">
          <img src={remyMark} alt="" className="size-10 rounded-lg" />
          <span className="text-[22px] font-semibold tracking-[-0.04em]">
            Remy
          </span>
        </div>
        <section
          aria-labelledby="signin-title"
          className="flex w-full min-w-0 max-w-[380px] shrink-0 flex-col gap-7 pt-12 sm:pt-[91px]"
        >
          <header className="flex flex-col items-center gap-2.5 text-center">
            <h1
              id="signin-title"
              className="text-[32px] leading-10 font-semibold tracking-[-0.045em]"
            >
              {creating ? "Create your account" : "Sign in to Remy"}
            </h1>
            <p className="text-[15px] leading-[23px] text-muted-foreground">
              Your coding agents, within reach.
            </p>
          </header>
          {socialMethods.length > 0 && (
            <div className="flex gap-3">
              {socialMethods.map((method) => (
                <Button
                  key={method}
                  type="button"
                  variant="outline"
                  className="h-12 min-w-0 flex-1 gap-2.5 rounded-lg"
                  aria-label={`Continue with ${method === "google" ? "Google" : "GitHub"}`}
                  data-link
                  disabled={busy}
                  onClick={() => void signIn(method)}
                >
                  {pending === method ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <SignInProviderIcon provider={method} />
                  )}
                  {method === "google" ? "Google" : "GitHub"}
                </Button>
              ))}
            </div>
          )}
          {socialMethods.length > 0 && hasEmailForm && (
            <FieldSeparator>or continue with email</FieldSeparator>
          )}
          {hasEmailForm && (
            <form
              aria-label={creating ? "Create your account" : "Sign in with email"}
              onSubmit={(e) => {
                e.preventDefault();
                void signIn(useSso ? "sso" : hasPassword ? passwordMethod : "magic-link");
              }}
            >
              <FieldGroup className="gap-7">
                <Field className="gap-2.5" data-disabled={busy}>
                  <FieldLabel htmlFor="signin-email">
                    {useSso ? "Work email" : "Email"}
                  </FieldLabel>
                  <Input
                    id="signin-email"
                    className="h-12 rounded-lg px-3.5"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    aria-describedby={useSso || (!hasPassword && runtime.auth.magicLink) ? "signin-email-help" : undefined}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={busy}
                  />
                  {(useSso || (!hasPassword && runtime.auth.magicLink)) && (
                    <FieldDescription id="signin-email-help">
                      {useSso
                        ? "Use the email your organization uses for single sign-on."
                        : "We’ll send you a sign-in link."}
                    </FieldDescription>
                  )}
                </Field>
                {hasPassword && (
                  <Field className="gap-2.5" data-disabled={busy}>
                    <FieldLabel htmlFor="signin-password">Password</FieldLabel>
                    <Input
                      id="signin-password"
                      className="h-12 rounded-lg px-3.5"
                      type="password"
                      autoComplete={creating ? "new-password" : "current-password"}
                      minLength={creating ? 8 : undefined}
                      aria-describedby={creating ? "signin-password-help" : undefined}
                      value={passwordValue}
                      onChange={(e) => setPasswordValue(e.target.value)}
                      required
                      disabled={busy}
                    />
                    {creating && (
                      <FieldDescription id="signin-password-help">
                        Use at least 8 characters.
                      </FieldDescription>
                    )}
                  </Field>
                )}
                <Button
                  className="h-12 rounded-lg"
                  disabled={busy || !email.trim() || (hasPassword && !passwordValue)}
                  type="submit"
                >
                  {(pending === "sso" || pending === (hasPassword ? passwordMethod : "magic-link")) && (
                    <Spinner data-icon="inline-start" />
                  )}
                  {useSso
                    ? "Sign in with single sign-on"
                    : hasPassword
                      ? creating
                        ? "Create account"
                        : "Sign in"
                      : "Email sign-in link"}
                </Button>
                {hasPassword && runtime.auth.magicLink && !creating && (
                  <Button
                    className="h-12 rounded-lg"
                    disabled={busy || !email.trim()}
                    type="button"
                    variant="outline"
                    onClick={() => void signIn("magic-link")}
                  >
                    {pending === "magic-link" && <Spinner data-icon="inline-start" />}
                    Email sign-in link
                  </Button>
                )}
              </FieldGroup>
            </form>
          )}
          {hasPassword && (
            <Button
              type="button"
              variant="ghost"
              className="self-center"
              disabled={busy}
              onClick={() => {
                setCreateAccount(!createAccount);
                setMessage("");
              }}
            >
              {creating ? "Sign in instead" : "Create your account"}
            </Button>
          )}
          {runtime.auth.sso && (
            <Button
              type="button"
              variant="ghost"
              className="self-center"
              disabled={busy}
              aria-expanded={useSso}
              onClick={() => {
                setUseSso(!useSso);
                setCreateAccount(false);
                setMessage("");
              }}
            >
              <Building2 data-icon="inline-start" />
              {useSso
                ? "Use another sign-in method"
                : "Continue with single sign-on"}
            </Button>
          )}
          {message && (
            <p role="status" className="text-center text-sm">
              {message}
            </p>
          )}
          {busy && (
            <p
              role="status"
              className="text-center text-sm text-muted-foreground"
            >
              Connecting to your sign-in provider…
            </p>
          )}
          {!Object.values(runtime.auth).some(Boolean) ? (
            <p role="alert" className="text-center text-sm">
              Sign-in is unavailable; contact your Remy administrator.
            </p>
          ) : !hasPassword ? (
            <p className="text-center text-[13px] text-muted-foreground">
              You can sign in or create your account.
            </p>
          ) : null}
        </section>
        <footer className="mt-auto flex shrink-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-1 pt-16 text-[13px]">
          <span className="text-muted-foreground">Need help connecting?</span>
          <a
            className="inline-flex min-h-8 items-center gap-1 underline underline-offset-4"
            href="https://tryremy.dev/docs/#web"
            target="_blank"
            rel="noreferrer"
          >
            Read the setup guide{" "}
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </a>
        </footer>
      </div>
    </main>
  );
}

function accountNameFromEmail(email: string) {
  return email.trim().split("@")[0]?.trim() || "Remy";
}

function accountAuthMessage(error: unknown) {
  const text = apiError(error);
  if (/already exists/i.test(text)) {
    return "An account with this email already exists. Sign in instead.";
  }
  if (/password.{0,24}(short|least)/i.test(text) || /at least \d+ character/i.test(text)) {
    return "Use a password with at least 8 characters.";
  }
  return text;
}

function SignInProviderIcon({ provider }: { provider: "google" | "github" }) {
  return (
    <svg
      aria-hidden="true"
      data-icon="inline-start"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      {provider === "google" ? (
        <>
          <path
            fill="#4285F4"
            d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.61 4.61 0 0 1-2 3.03v2.52h3.24c1.9-1.75 2.98-4.33 2.98-7.38z"
          />
          <path
            fill="#34A853"
            d="M12 22c2.7 0 4.96-.9 6.61-2.39l-3.24-2.52c-.9.6-2.05.97-3.37.97-2.61 0-4.83-1.76-5.63-4.12H3.02v2.59A10 10 0 0 0 12 22z"
          />
          <path
            fill="#FBBC05"
            d="M6.37 13.94A6 6 0 0 1 6.05 12c0-.67.11-1.33.32-1.94V7.47H3.02A10 10 0 0 0 2 12c0 1.61.39 3.14 1.02 4.53z"
          />
          <path
            fill="#EA4335"
            d="M12 5.94c1.47 0 2.79.5 3.82 1.49l2.86-2.86A9.58 9.58 0 0 0 12 2a10 10 0 0 0-8.98 5.47l3.35 2.59C7.17 7.7 9.39 5.94 12 5.94z"
          />
        </>
      ) : (
        <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.03-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.94.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.57 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .94-.3 3.1 1.15A10.8 10.8 0 0 1 12 6.16c.96 0 1.92.13 2.82.38 2.15-1.46 3.1-1.15 3.1-1.15.61 1.55.23 2.7.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.33-2.64 5.29-5.15 5.56.41.35.77 1.03.77 2.08v3.1c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75z" />
      )}
    </svg>
  );
}
