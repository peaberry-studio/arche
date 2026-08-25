const TAU = Math.PI * 2;

/** Resolución canónica: puntos de diámetro del disco. */
export const DISC_RESOLUTION = 18;

/** Niveles de brillo del punto, del apagado al encendido. */
export const DISC_LEVELS = 4;

/**
 * Expansión de contraste aplicada antes de cuantizar.
 *
 * El campo es una suma de cosenos, así que sus valores tienden a una
 * gaussiana centrada. Sin expandir, el reparto de brillos es 7/36/49/7 -- el
 * 85% de los puntos en los dos niveles centrales -- y los discos salen
 * lavados y parecidos entre sí. Con 2.1 el reparto queda en 21/23/28/28 y la
 * distancia mínima entre agentes sube del 9,6% al 16,5%.
 */
export const DISC_CONTRAST = 2.1;

/** Opacidad de cada nivel de brillo. */
export const DISC_ALPHAS = [0.06, 0.28, 0.55, 0.86] as const;

export type AvatarKind = "agent" | "human";

export type DiscField = {
  m1: number; m2: number; m4: number;
  freq: number; twist: number;
  phi1: number; phi2: number; psi: number;
  a1: number; a2: number; a3: number; a4: number;
  falloff: number; bias: number;
  w1: number; w3: number; w4: number;
  norm: number;
};

export type LatticePoint = {
  /** Posición en un disco de radio 1 centrado en el origen. */
  x: number;
  y: number;
  /** Radio normalizado 0..1 y ángulo en radianes. */
  rad: number;
  th: number;
  /** Diámetro del punto, en las mismas unidades que x/y. */
  size: number;
};

/** FNV-1a de 32 bits. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: flujo determinista de números a partir del hash. */
function rngFrom(seedInt: number): () => number {
  let a = seedInt >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deriva el campo de una identidad.
 *
 * IMPORTANTE: el orden de las llamadas a r() es parte del contrato. Reordenar
 * dos líneas cambia el avatar de todas las entidades existentes. Si alguna vez
 * hay que tocar esto, es un cambio con migración visual, no un refactor.
 */
export function fieldFor(seed: string): DiscField {
  const r = rngFrom(hashSeed(seed));

  // Órdenes angulares enteros: de ahí sale la simetría rotacional sin
  // necesidad de imponerla.
  const m1 = 2 + Math.floor(r() * 7);
  const m2 = 1 + Math.floor(r() * 5);
  const m4 = 1 + Math.floor(r() * 6);

  const freq = 1.2 + r() * 3.4;          // anillos por unidad de radio
  const twist = (r() * 2 - 1) * 4.5;     // sentido y fuerza de la espiral

  const phi1 = r() * TAU;
  const phi2 = r() * TAU;
  const psi = r() * TAU;

  // Reparto de energía entre los cuatro términos.
  const a1 = 0.35 + r() * 0.75;
  const a2 = r() * 0.65;
  const a3 = 0.2 + r() * 0.8;
  const a4 = r() * 0.8;

  // La energía cae hacia el borde: el disco tiene centro, no es un tapiz
  // recortado en redondo.
  const falloff = 0.25 + r() * 0.85;
  const bias = -0.35 + r() * 0.7;

  // Velocidades de animación con signo: unos giran a derechas y otros no.
  const w1 = (r() < 0.5 ? -1 : 1) * (0.15 + r() * 0.5);
  const w3 = (r() < 0.5 ? -1 : 1) * (0.3 + r() * 0.9);
  const w4 = (r() < 0.5 ? -1 : 1) * (0.2 + r() * 0.6);

  return {
    m1, m2, m4, freq, twist, phi1, phi2, psi,
    a1, a2, a3, a4, falloff, bias, w1, w3, w4,
    norm: a1 + a2 + a3 + a4 || 1,
  };
}

/**
 * Evalúa el campo en un punto.
 *
 *   v(r, θ) = A1·cos(m1·θ + φ1)        armónico angular  -> pétalos
 *           + A2·cos(m2·θ + φ2)        segundo armónico  -> rompe la simetría
 *           + A3·cos(2π·f·r + ψ)       término radial    -> anillos
 *           + A4·cos(m4·θ + k·r·2π)    término acoplado  -> espiral
 *
 * `t` es el tiempo en segundos; con t = 0 se obtiene el fotograma de
 * identidad, que es el que se dibuja en reposo.
 */
export function sampleField(f: DiscField, rad: number, th: number, t: number): number {
  let v =
    f.a1 * Math.cos(f.m1 * th + f.phi1 + t * f.w1) +
    f.a2 * Math.cos(f.m2 * th + f.phi2 - t * f.w1 * 0.6) +
    f.a3 * Math.cos(TAU * f.freq * rad + f.psi + t * f.w3) +
    f.a4 * Math.cos(f.m4 * th + f.twist * rad * TAU + t * f.w4);

  v = v / f.norm;                        // -1..1
  v *= 1 - f.falloff * rad * rad;        // caída hacia el borde
  return v + f.bias;
}

/** Cuantiza el valor del campo a un nivel de brillo. */
export function levelOf(
  v: number,
  levels: number = DISC_LEVELS,
  gain: number = DISC_CONTRAST,
): number {
  let n = (v + 1) / 2;
  n = (n - 0.5) * gain + 0.5;
  if (n < 0) n = 0;
  else if (n > 1) n = 1;
  const l = Math.floor(n * levels);
  return l >= levels ? levels - 1 : l;
}

const latticeCache = new Map<number, readonly LatticePoint[]>();

/**
 * Retícula cuadrada de n×n recortada al círculo. Los puntos fuera del disco
 * sencillamente no existen: no son puntos apagados.
 */
export function squareLattice(n: number): readonly LatticePoint[] {
  const cached = latticeCache.get(n);
  if (cached) return cached;

  const step = 2 / n;
  const size = step * 0.78;              // el hueco entre puntos es el 22%
  const points: LatticePoint[] = [];

  for (let gy = 0; gy < n; gy += 1) {
    for (let gx = 0; gx < n; gx += 1) {
      const x = -1 + step * (gx + 0.5);
      const y = -1 + step * (gy + 0.5);
      const rad = Math.sqrt(x * x + y * y);
      if (rad > 1.02) continue;
      points.push({ x, y, rad: Math.min(rad, 1), th: Math.atan2(y, x), size });
    }
  }

  latticeCache.set(n, points);
  return points;
}

/**
 * Nivel de detalle. 18 puntos es la resolución canónica, pero por debajo de
 * ~1.8px por punto el campo se vuelve papilla, así que las superficies
 * pequeñas bajan de detalle. La identidad no cambia: es el mismo campo
 * muestreado más grueso.
 */
export function resolutionForSize(px: number): number {
  if (px >= 44) return DISC_RESOLUTION;
  if (px >= 32) return 14;
  if (px >= 26) return 12;
  return 8;
}
