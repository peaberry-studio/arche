"use client";

import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TotpVerifyDialog } from "@/components/totp-verify-dialog";

type LoginResponse = {
  ok: boolean;
  requires2FA?: boolean;
  challengeToken?: string;
  user?: {
    id: string;
    email: string;
    slug: string;
    role: string;
  };
  error?: string;
};

const errorMessages: Record<string, string> = {
  invalid_request: "Enter email and password.",
  invalid_credentials: "Incorrect email or password.",
  network_error: "We couldn't reach the server.",
  unknown: "Something went wrong. Try again.",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    status: number;
    data?: LoginResponse;
  } | null>(null);
  const [challengeToken, setChallengeToken] = useState("");
  const [show2FA, setShow2FA] = useState(false);

  // Redirigir automáticamente al dashboard después de login exitoso
  useEffect(() => {
    if (result?.data?.ok && result.data.user?.slug) {
      const timeout = setTimeout(() => {
        router.push(`/u/${result.data!.user!.slug}`);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [result, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);

    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
        credentials: "include",
      });
      const data = (await response.json().catch(() => null)) as LoginResponse | null;

      if (data?.ok && data.requires2FA && data.challengeToken) {
        setChallengeToken(data.challengeToken);
        setShow2FA(true);
        return;
      }

      setResult({
        status: response.status,
        data: data ?? { ok: false, error: "unknown" },
      });
    } catch {
      setResult({ status: 0, data: { ok: false, error: "network_error" } });
    } finally {
      setBusy(false);
    }
  };

  const errorMessage =
    result && !result.data?.ok
      ? errorMessages[result.data?.error ?? "unknown"] ?? errorMessages.unknown
      : null;

  const dashboardPath = result?.data?.user?.slug
    ? `/u/${result.data.user.slug}`
    : null;

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 organic-background" />

      <main className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <div className="space-y-8">
          {/* Header */}
          <div className="space-y-2 text-center">
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="text-muted-foreground">
              Access your Arche workspace
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          {/* Result feedback */}
          {result && (
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              {result.data?.ok && result.data.user ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Signed in as{" "}
                    <span className="font-medium text-foreground">
                      {result.data.user.email}
                    </span>
                  </p>
                  {dashboardPath && (
                    <Button asChild className="w-full">
                      <Link href={dashboardPath}>Go to dashboard</Link>
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-destructive">{errorMessage}</p>
              )}
            </div>
          )}

          {/* Footer */}
          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="font-medium text-primary hover:underline"
            >
              Request access
            </Link>
          </p>
        </div>

        <TotpVerifyDialog
          open={show2FA}
          challengeToken={challengeToken}
          onSuccess={(user) => {
            setShow2FA(false);
            setResult({
              status: 200,
              data: { ok: true, user: { ...user, role: "" } },
            });
          }}
          onCancel={() => setShow2FA(false)}
        />
      </main>
    </div>
  );
}
