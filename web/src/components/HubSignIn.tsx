import { useState } from "react";
import type { HubRuntime } from "@/lib/hub-session";
import { hubRequest } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
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
  const [busy, setBusy] = useState(false);
  const signIn = async (method: "magic-link" | "google" | "github" | "sso") => {
    setBusy(true);
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
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Remy</CardTitle>
          <CardDescription>
            Work with your organization from any computer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void signIn("magic-link");
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="signin-email">Email</FieldLabel>
                <Input
                  id="signin-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                {message && (
                  <FieldDescription role="status">{message}</FieldDescription>
                )}
              </Field>
              {runtime.auth.magicLink && (
                <Button disabled={busy || !email} type="submit">
                  Email sign-in link
                </Button>
              )}
              {runtime.auth.google && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void signIn("google")}
                >
                  Continue with Google
                </Button>
              )}
              {runtime.auth.github && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void signIn("github")}
                >
                  Continue with GitHub
                </Button>
              )}
              {runtime.auth.sso && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !email.includes("@")}
                  onClick={() => void signIn("sso")}
                >
                  Continue with single sign-on
                </Button>
              )}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
