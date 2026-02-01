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
              Crea tu workspace
            </h1>
            <p className="text-muted-foreground">
              Configura tu Arche corporativo en minutos
            </p>
          </div>

          {/* Success state */}
          {submitted ? (
            <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-6 text-center">
              <p className="font-medium text-foreground">
                Solicitud recibida
              </p>
              <p className="text-sm text-muted-foreground">
                Te contactaremos en menos de 24 horas para configurar tu workspace.
              </p>
              <Button asChild variant="outline" className="mt-2">
                <Link href="/">Volver al inicio</Link>
              </Button>
            </div>
          ) : (
            <>
              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="name">Nombre</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Tu nombre"
                    required
                    autoComplete="name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email de trabajo</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="tu@empresa.com"
                    required
                    autoComplete="email"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company">Empresa</Label>
                  <Input
                    id="company"
                    name="company"
                    placeholder="Nombre de la empresa"
                    required
                    autoComplete="organization"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="team">Tamaño del equipo</Label>
                  <select
                    id="team"
                    name="team"
                    className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2"
                    required
                  >
                    <option value="">Selecciona</option>
                    <option value="1-10">1-10 personas</option>
                    <option value="11-50">11-50 personas</option>
                    <option value="51-200">51-200 personas</option>
                    <option value="200+">200+ personas</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="slug">Slug del workspace</Label>
                  <Input
                    id="slug"
                    name="slug"
                    placeholder="mi-empresa"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Tu subdominio será mi-empresa.arche.ai
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">
                    Procesos a interiorizar{" "}
                    <span className="font-normal text-muted-foreground">(opcional)</span>
                  </Label>
                  <textarea
                    id="message"
                    name="message"
                    placeholder="Describe brevemente qué procesos quieres automatizar"
                    rows={3}
                    className="flex w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2"
                  />
                </div>

                <Button type="submit" className="w-full">
                  Solicitar acceso
                </Button>

                <p className="text-center text-xs text-muted-foreground">
                  Te contactaremos para configurar tu workspace.
                </p>
              </form>
            </>
          )}

          {/* Footer */}
          {!submitted && (
            <p className="text-center text-sm text-muted-foreground">
              ¿Ya tienes cuenta?{" "}
              <Link
                href="/login"
                className="font-medium text-primary hover:underline"
              >
                Entrar
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
