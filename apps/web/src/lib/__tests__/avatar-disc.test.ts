import { describe, expect, it } from "vitest";

import {
  DISC_LEVELS,
  DISC_RESOLUTION,
  fieldFor,
  hashSeed,
  levelOf,
  resolutionForSize,
  sampleField,
  squareLattice,
} from "@/lib/avatar-disc";

const NAMES = [
  "research-analyst", "content-writer", "data-engineer", "seo-specialist",
  "customer-support", "legal-reviewer", "sales-outreach", "bug-triage",
  "docs-curator", "finance-ops", "recruiter", "translator",
  "qa-runner", "security-auditor", "product-manager", "brand-designer",
  "growth-marketer", "bookkeeper", "scheduler", "knowledge-curator",
  "slack-concierge", "email-triage", "meeting-notes", "invoice-parser",
];

/** Huella perceptual: el campo muestreado en la retícula canónica. */
function fingerprint(seed: string): number[] {
  const field = fieldFor(seed);
  return squareLattice(DISC_RESOLUTION).map((p) =>
    levelOf(sampleField(field, p.rad, p.th, 0), DISC_LEVELS),
  );
}

function distance(a: number[], b: number[]): number {
  const total = a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0);
  return total / (a.length * (DISC_LEVELS - 1));
}

describe("avatar-disc", () => {
  it("produce el mismo campo para la misma semilla", () => {
    expect(fieldFor("research-analyst")).toEqual(fieldFor("research-analyst"));
    expect(fieldFor("research-analyst")).not.toEqual(fieldFor("content-writer"));
  });

  it("mantiene la retícula dentro del disco", () => {
    for (const point of squareLattice(DISC_RESOLUTION)) {
      expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(1.02);
    }
  });

  it("cuantiza siempre a un nivel válido", () => {
    for (const v of [-5, -1, -0.3, 0, 0.3, 1, 5]) {
      const level = levelOf(v);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThan(DISC_LEVELS);
    }
  });

  it("reparte los brillos sin agolparlos en el centro", () => {
    const counts = new Array(DISC_LEVELS).fill(0);
    let total = 0;

    for (const name of NAMES) {
      for (const level of fingerprint(name)) {
        counts[level] += 1;
        total += 1;
      }
    }

    // Con contraste 2.1 los extremos suman 48,9%. Sin expandir se quedan en
    // 14,7%, que es exactamente el fallo que este test vigila.
    const extremes = (counts[0] + counts[DISC_LEVELS - 1]) / total;
    expect(extremes).toBeGreaterThan(0.35);
  });

  it("mantiene los agentes distinguibles entre sí", () => {
    const prints = NAMES.map(fingerprint);
    let min = Infinity;

    for (let i = 0; i < prints.length; i += 1) {
      for (let j = i + 1; j < prints.length; j += 1) {
        min = Math.min(min, distance(prints[i], prints[j]));
      }
    }

    // El valor real es 16,5%, entre "legal-reviewer" y "docs-curator".
    // El umbral está a la mitad para dejar margen sin volverse decorativo.
    expect(min).toBeGreaterThan(0.08);
  });

  it("baja de detalle en las superficies pequeñas", () => {
    expect(resolutionForSize(64)).toBe(DISC_RESOLUTION);
    expect(resolutionForSize(24)).toBe(8);
    // Nunca por debajo de ~1.8px por punto.
    for (const size of [16, 20, 24, 28, 32, 48, 96]) {
      expect(size / resolutionForSize(size)).toBeGreaterThan(1.8);
    }
  });

  it("produce exactamente 256 puntos en la resolución canónica", () => {
    // Valor cerrado del contrato: un disco de 18 tiene 256 puntos.
    expect(squareLattice(DISC_RESOLUTION)).toHaveLength(256);
  });

  it("hashea con FNV-1a de 32 bits", () => {
    // Vectores conocidos de FNV-1a. Cambiar el hash cambia el avatar de
    // todas las entidades existentes.
    expect(hashSeed("")).toBe(0x811c9dc5);
    expect(hashSeed("a")).toBe(0xe40c292c);
    expect(hashSeed("foobar")).toBe(0xbf9cf968);
    expect(hashSeed("foobar")).not.toBe(hashSeed("Foobar"));
  });

  it("satura los niveles fuera de rango", () => {
    // La expansión de contraste puede empujar v fuera de [-1, 1];
    // levelOf debe aplastar contra los extremos, nunca salirse.
    expect(levelOf(-2)).toBe(0);
    expect(levelOf(-1)).toBe(0);
    expect(levelOf(2)).toBe(DISC_LEVELS - 1);
    expect(levelOf(1)).toBe(DISC_LEVELS - 1);
  });

  it("cumple el reparto de brillos verificado (21/23/28/28)", () => {
    const counts = new Array(DISC_LEVELS).fill(0);
    let total = 0;

    for (const name of NAMES) {
      for (const level of fingerprint(name)) {
        counts[level] += 1;
        total += 1;
      }
    }

    // Medido sobre los 24 nombres: 20,6 / 22,8 / 28,3 / 28,3. Una
    // desviación de ±3 puntos por nivel delata un cambio del contrato.
    const expected = [0.21, 0.23, 0.28, 0.28];
    for (let level = 0; level < DISC_LEVELS; level += 1) {
      expect(counts[level] / total).toBeGreaterThan(expected[level] - 0.03);
      expect(counts[level] / total).toBeLessThan(expected[level] + 0.03);
    }
  });

  it("deja los brillos extremos en el 48,9% medido", () => {
    const counts = new Array(DISC_LEVELS).fill(0);
    let total = 0;

    for (const name of NAMES) {
      for (const level of fingerprint(name)) {
        counts[level] += 1;
        total += 1;
      }
    }

    // Con contraste 2.1 los extremos suman 48,9%. Sin expandir quedan en
    // 14,7% y con más contraste se disparan: el margen vigila ambos lados.
    const extremes = (counts[0] + counts[DISC_LEVELS - 1]) / total;
    expect(extremes).toBeGreaterThan(0.45);
    expect(extremes).toBeLessThan(0.53);
  });

  it("deja la distancia mínima entre agentes en el 16,5% medido", () => {
    const prints = NAMES.map(fingerprint);
    let min = Infinity;

    for (let i = 0; i < prints.length; i += 1) {
      for (let j = i + 1; j < prints.length; j += 1) {
        min = Math.min(min, distance(prints[i], prints[j]));
      }
    }

    // El valor real es 16,54% (entre "legal-reviewer" y "docs-curator").
    // Ventana estrecha: si baja, los discos se parecen demasiado; si sube,
    // alguien tocó el muestreo del campo.
    expect(min).toBeGreaterThan(0.16);
    expect(min).toBeLessThan(0.17);
  });

  it("anima el campo con el tiempo sin tocar el fotograma de identidad", () => {
    const field = fieldFor("research-analyst");
    const point = squareLattice(DISC_RESOLUTION)[0];

    const identity = sampleField(field, point.rad, point.th, 0);
    expect(sampleField(field, point.rad, point.th, 0)).toBe(identity);

    // Con t > 0 el campo se mueve (los w no son cero por construcción).
    let moved = false;
    for (const p of squareLattice(DISC_RESOLUTION)) {
      if (sampleField(field, p.rad, p.th, 1.7) !== sampleField(field, p.rad, p.th, 0)) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
  });
});
