"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignupPage() {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    event.currentTarget.reset();
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 organic-background" />

      <main className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <div className="space-y-8">
          {/* Header */}
          <div className="space-y-2 text-center">
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
              Create your workspace
            </h1>
            <p className="text-muted-foreground">
              Set up your enterprise Arche in minutes
            </p>
          </div>

          {/* Success state */}
          {submitted ? (
            <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-6 text-center">
              <p className="font-medium text-foreground">
                Request received
              </p>
              <p className="text-sm text-muted-foreground">
                We will contact you within 24 hours to set up your workspace.
              </p>
              <Button asChild variant="outline" className="mt-2">
                <Link href="/">Back to home</Link>
              </Button>
            </div>
          ) : (
            <>
              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Your name"
                    required
                    autoComplete="name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Work email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@company.com"
                    required
                    autoComplete="email"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company">Company</Label>
                  <Input
                    id="company"
                    name="company"
                    placeholder="Company name"
                    required
                    autoComplete="organization"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="team">Team size</Label>
                  <select
                    id="team"
                    name="team"
                    className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2"
                    required
                  >
                    <option value="">Select</option>
                    <option value="1-10">1-10 people</option>
                    <option value="11-50">11-50 people</option>
                    <option value="51-200">51-200 people</option>
                    <option value="200+">200+ people</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="slug">Workspace slug</Label>
                  <Input
                    id="slug"
                    name="slug"
                    placeholder="my-company"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Your subdomain will be my-company.arche.ai
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">
                    Processes to internalize{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <textarea
                    id="message"
                    name="message"
                    placeholder="Briefly describe the processes you want to automate"
                    rows={3}
                    className="flex w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2"
                  />
                </div>

                <Button type="submit" className="w-full">
                  Request access
                </Button>

                <p className="text-center text-xs text-muted-foreground">
                  We will contact you to set up your workspace.
                </p>
              </form>
            </>
          )}

          {/* Footer */}
          {!submitted && (
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-medium text-primary hover:underline"
              >
                Sign in
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
