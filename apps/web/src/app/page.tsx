"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const features = [
  {
    title: "Se adapta a tu empresa",
    description:
      "Aprende tu contexto, lenguaje y prioridades. Los procesos internos se interiorizan automáticamente.",
  },
  {
    title: "Subagentes especializados",
    description:
      "Ventas, soporte, operaciones, finanzas. Cada área recibe un agente entrenado con sus procesos.",
  },
  {
    title: "Especialización compartida",
    description:
      "Cada ajuste se replica a todo el equipo. El conocimiento se distribuye sin fricción.",
  },
  {
    title: "Multiproveedor sin lock-in",
    description:
      "AWS, GCP, Azure u on-premise. Despliega donde quieras con un clic.",
  },
];

const capabilities = [
  "Multiusuario con roles",
  "Conectores MCP",
  "One-click deployment",
  "Auditoría completa",
];

const words = ["aprende", "se adapta", "evoluciona", "conecta"];

export default function Home() {
  const [wordIndex, setWordIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [scrollY, setScrollY] = useState(0);
  const secondarySectionRef = useRef<HTMLDivElement>(null);
  const [secondaryVisible, setSecondaryVisible] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible(false);
      setTimeout(() => {
        setWordIndex((prev) => (prev + 1) % words.length);
        setIsVisible(true);
      }, 300);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setSecondaryVisible(true);
          }
        });
      },
      { threshold: 0.2 }
    );

    if (secondarySectionRef.current) {
      observer.observe(secondarySectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden">
      <main className="relative">
        {/* Hero with full background image */}
        <section className="relative min-h-screen flex items-end justify-center overflow-hidden pb-32">
          {/* Background Image */}
          <div className="absolute inset-0">
            <Image
              src="/landing-background.jpeg"
              alt="La conexión entre humanidad y tecnología"
              fill
              className="object-cover"
              priority
              quality={90}
              style={{ objectPosition: 'center 30%' }}
            />
            {/* Gradient overlay - starts from top with subtle tint, solid before image edge */}
            <div 
              className="absolute inset-0"
              style={{
                background: `linear-gradient(to bottom,
                  rgba(120, 53, 15, 0.05) 0%,
                  rgba(120, 53, 15, 0.1) 15%,
                  rgba(120, 53, 15, 0.2) 30%,
                  rgba(120, 53, 15, 0.35) 45%,
                  rgba(120, 53, 15, 0.55) 55%,
                  rgba(120, 53, 15, 0.75) 65%,
                  rgba(120, 53, 15, 0.9) 75%,
                  #78350f 85%,
                  #78350f 100%
                )`
              }}
            />
          </div>

          {/* Logo top center with beta badge */}
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-3">
            <p className="font-[family-name:var(--font-display)] text-5xl sm:text-6xl lg:text-7xl font-black text-amber-800 tracking-normal">
              Archē
            </p>
            <Badge className="bg-amber-800/80 text-amber-100 border-amber-700/50">
              BETA
            </Badge>
          </div>

          {/* Content */}
          <div className="relative z-10 mx-auto max-w-5xl px-6 text-center">

            <h1 className="font-[family-name:var(--font-display)] text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl xl:text-8xl">
              <span className="text-amber-50 drop-shadow-[0_2px_10px_rgba(0,0,0,0.3)]">La IA que</span>{" "}
              <span
                className={`inline-block text-orange-200 transition-all duration-300 drop-shadow-[0_0_30px_rgba(251,146,60,0.5)] ${
                  isVisible
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 -translate-y-2"
                }`}
              >
                {words[wordIndex]}
              </span>
              <br />
              <span className="text-amber-50 drop-shadow-[0_2px_10px_rgba(0,0,0,0.3)]">con tu empresa</span>
            </h1>

            <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
              <Button asChild size="lg" className="text-lg px-8 py-6 bg-primary text-primary-foreground hover:bg-primary/90">
                <Link href="/signup">Solicitar acceso</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="text-lg px-8 py-6 bg-white/10 border-white/30 text-white hover:bg-white/20 backdrop-blur-sm"
              >
                <Link href="/login">Entrar</Link>
              </Button>
            </div>

          </div>

          {/* Scroll indicator - positioned at bottom of section */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 animate-bounce">
            <div className="flex flex-col items-center gap-2 text-orange-100/70">
              <span className="text-sm">Descubre más</span>
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                />
              </svg>
            </div>
          </div>
        </section>

        {/* Secondary Hero Section - Warm amber background, animated on scroll */}
        <section
          ref={secondarySectionRef}
          className="relative min-h-screen flex items-center justify-center py-32"
          style={{
            background: `linear-gradient(to bottom,
              #78350f 0%,
              #92400e 20%,
              #b45309 40%,
              #d97706 60%,
              #f59e0b 80%,
              #fbbf24 100%
            )`
          }}
        >
          <div className="mx-auto max-w-6xl px-6 text-center">
            <div
              className={`transition-all duration-1000 ease-out ${
                secondaryVisible
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-16"
              }`}
            >
              <h2 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-orange-50 sm:text-5xl lg:text-6xl xl:text-7xl">
                Donde la{" "}
                <span className="text-orange-200">sabiduría ancestral</span>
                <br />
                se encuentra con la{" "}
                <span className="text-orange-200">inteligencia del mañana</span>
              </h2>
            </div>

          </div>
        </section>

        {/* Transition: from yellow to white */}
        <div 
          className="h-64 sm:h-80 lg:h-96"
          style={{
            background: `linear-gradient(to bottom,
              #fbbf24 0%,
              #fcd34d 15%,
              #fde68a 30%,
              #fef3c7 50%,
              #fefce8 70%,
              #ffffff 100%
            )`
          }}
        />

        {/* Value Proposition Section - Main Claims - White background */}
        <section className="relative pt-16 pb-32 bg-white">
          <div className="mx-auto max-w-5xl px-6 text-center">
            <p className="text-sm font-medium text-primary uppercase tracking-wider mb-6">
              Qué es Arche
            </p>
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl leading-tight">
              Arche interioriza tus procesos, crea subagentes especializados
              por área y comparte el conocimiento entre todo tu equipo.
            </h2>

            {/* Main Claims */}
            <div className="mt-20 grid gap-8 sm:grid-cols-3">
              <div className="space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <svg className="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="font-[family-name:var(--font-display)] text-xl font-semibold text-gray-900">
                  Procesos interiorizados
                </h3>
                <p className="text-gray-600">
                  Aprende tu contexto, lenguaje y prioridades de forma automática.
                </p>
              </div>

              <div className="space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <svg className="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <h3 className="font-[family-name:var(--font-display)] text-xl font-semibold text-gray-900">
                  Especialización compartida
                </h3>
                <p className="text-gray-600">
                  Cada ajuste se replica a todo el equipo sin fricción.
                </p>
              </div>

              <div className="space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <svg className="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="font-[family-name:var(--font-display)] text-xl font-semibold text-gray-900">
                  Sin vendor lock-in
                </h3>
                <p className="text-gray-600">
                  AWS, GCP, Azure u on-premise. Despliega donde quieras.
                </p>
              </div>
            </div>

            <div className="mt-16">
              <Button asChild size="lg" className="text-lg px-10 py-7">
                <Link href="/signup">Comienza tu transformación</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Automagicamente Section */}
        <section className="bg-white py-24 lg:py-32">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <p className="text-xl sm:text-2xl text-gray-600 mb-4">
              Simplemente funciona.
            </p>
            <h2 className="font-[family-name:var(--font-display)] text-5xl sm:text-6xl lg:text-7xl font-bold text-primary">
              Automágicamente.
            </h2>
          </div>
        </section>

        {/* Features - White background continues */}
        <section className="bg-white py-20 lg:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mb-12 max-w-2xl">
              <p className="text-sm font-medium text-primary">Capacidades</p>
              <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
                IA corporativa sin fricción
              </h2>
              <p className="mt-4 text-gray-600">
                Donde la inteligencia artificial se encuentra con el conocimiento
                humano de tu empresa.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              {features.map((feature, i) => (
                <div
                  key={feature.title}
                  className="group relative rounded-2xl border border-gray-200 bg-gray-50 p-6 transition-all hover:border-primary/30 hover:bg-primary/5"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">
                    {i + 1}
                  </div>
                  <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-gray-900">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works - Slight gray for contrast */}
        <section className="bg-gray-50 border-y border-gray-200">
          <div className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
            <div className="mb-12 text-center">
              <p className="text-sm font-medium text-primary">Cómo funciona</p>
              <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
                Tres pasos para empezar
              </h2>
            </div>

            <div className="grid gap-8 sm:grid-cols-3">
              {[
                {
                  step: "01",
                  title: "Conecta tus sistemas",
                  description:
                    "Integra CRM, tickets, docs y data interna con conectores MCP.",
                },
                {
                  step: "02",
                  title: "Entrena y especializa",
                  description:
                    "El agente aprende tus procesos y crea subagentes por área.",
                },
                {
                  step: "03",
                  title: "Despliega en un clic",
                  description:
                    "Multiproveedor con aislamiento, auditoría y control total.",
                },
              ].map((item) => (
                <div key={item.step} className="text-center sm:text-left">
                  <div className="inline-block font-[family-name:var(--font-display)] text-5xl font-bold text-primary/20">
                    {item.step}
                  </div>
                  <h3 className="mt-4 font-[family-name:var(--font-display)] text-lg font-semibold text-gray-900">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-white py-20 lg:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-white p-8 lg:p-12">
              {/* Decorative elements */}
              <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-20 -left-20 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />

              <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-4 max-w-xl">
                  <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
                    Convierte tu IA en el Arche de tu empresa
                  </h2>
                  <p className="text-gray-600">
                    Haz que tus procesos se interioricen automáticamente y comparte
                    la especialización entre todos los equipos.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild size="lg">
                    <Link href="/signup">Solicitar acceso</Link>
                  </Button>
                  <Button asChild variant="outline" size="lg">
                    <Link href="/login">Entrar</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200">
          <div className="mx-auto max-w-6xl px-6 py-8">
            <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
              <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-gray-900">
                Arche
              </p>
              <p className="text-sm text-gray-500">
                IA corporativa que aprende y se especializa.
              </p>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
