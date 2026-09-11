import { useState } from "react";
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
} from "@/components/ui/field";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export function HubSignIn({ runtime }: { runtime: HubRuntime }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<string>();
  const [useSso, setUseSso] = useState(false);
  const busy = !!pending;
  const signIn = async (method: "magic-link" | "google" | "github" | "sso") => {
    if (busy || !runtime.auth[method === "magic-link" ? "magicLink" : method])
      return;
    setPending(method);
    setMessage("");
    try {
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
      setMessage(apiError(e));
    } finally {
      setPending(undefined);
    }
  };
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Remy</CardTitle>
          <CardDescription>
            Continue to create your account or sign in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">
            Run coding threads on your Mac or a configured cloud computer.
          </p>
          <FieldGroup>
            {(["google", "github"] as const)
              .filter((method) => runtime.auth[method])
              .map((method) => (
                <Button
                  key={method}
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void signIn(method)}
                >
                  {pending === method && <Spinner data-icon="inline-start" />}
                  Continue with {method === "google" ? "Google" : "GitHub"}
                </Button>
              ))}
            {runtime.auth.sso && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                aria-expanded={useSso}
                onClick={() => {
                  setUseSso(!useSso);
                  setMessage("");
                }}
              >
                {useSso
                  ? "Use another sign-in method"
                  : "Continue with single sign-on"}
              </Button>
            )}
          </FieldGroup>
          {(useSso || runtime.auth.magicLink) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void signIn(useSso ? "sso" : "magic-link");
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="signin-email">
                    {useSso ? "Work email" : "Email"}
                  </FieldLabel>
                  <Input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={busy}
                  />
                  {useSso && (
                    <FieldDescription>
                      Use the email your organization uses for single sign-on.
                    </FieldDescription>
                  )}
                </Field>
                <Button disabled={busy || !email.trim()} type="submit">
                  {(pending === "sso" || pending === "magic-link") && (
                    <Spinner data-icon="inline-start" />
                  )}
                  {useSso
                    ? "Sign in with single sign-on"
                    : "Email sign-in link"}
                </Button>
              </FieldGroup>
            </form>
          )}
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          {busy && (
            <p role="status" className="text-sm text-muted-foreground">
              Connecting to your sign-in provider…
            </p>
          )}
          {!Object.values(runtime.auth).some(Boolean) && (
            <p role="alert">
              Sign-in is unavailable; contact your Remy administrator.
            </p>
          )}
          <Button asChild variant="link">
            <a
              href="https://tryremy.dev/docs/#web"
              target="_blank"
              rel="noreferrer"
            >
              Read the setup guide
            </a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
