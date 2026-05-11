import type { Config } from 'vega-embed'

export type VisualizationTheme = {
  background: string
  card: string
  muted: string
  border: string
  foreground: string
  mutedForeground: string
  chartPalette: string[]
  fontFamily: string
  isDark: boolean
}

const FALLBACK: VisualizationTheme = {
  background: 'hsl(36, 28%, 91%)',
  card: 'hsl(38, 24%, 93%)',
  muted: 'hsl(30, 14%, 87%)',
  border: 'hsl(30, 12%, 78%)',
  foreground: 'hsl(20, 15%, 12%)',
  mutedForeground: 'hsl(20, 12%, 38%)',
  chartPalette: [
    'hsl(17.02, 87.76%, 51.96%)',
    'hsl(12, 55%, 48%)',
    'hsl(40, 48%, 48%)',
    'hsl(18, 48%, 38%)',
    'hsl(32, 52%, 56%)',
  ],
  fontFamily: 'system-ui, -apple-system, sans-serif',
  isDark: false,
}

function toHsl(rawHslComponents: string): string | null {
  // CSS custom properties store HSL as space-separated components: "17.02 87.76% 51.96%".
  // Mermaid's khroma color library only parses the comma-separated form, so we normalize.
  const parts = rawHslComponents.split(/\s+/)
  if (parts.length !== 3) return null
  return `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})`
}

export function resolveVisualizationTheme(): VisualizationTheme {
  if (typeof document === 'undefined') return FALLBACK

  const root = document.documentElement
  const style = getComputedStyle(root)
  const readHsl = (name: string, fallback: string) => {
    const raw = style.getPropertyValue(name).trim()
    if (!raw) return fallback
    return toHsl(raw) ?? fallback
  }
  const readFont = (name: string, fallback: string) => {
    const raw = style.getPropertyValue(name).trim()
    return raw || fallback
  }

  return {
    background: readHsl('--background', FALLBACK.background),
    card: readHsl('--card', FALLBACK.card),
    muted: readHsl('--muted', FALLBACK.muted),
    border: readHsl('--border', FALLBACK.border),
    foreground: readHsl('--foreground', FALLBACK.foreground),
    mutedForeground: readHsl('--muted-foreground', FALLBACK.mutedForeground),
    chartPalette: [
      readHsl('--chart-1', FALLBACK.chartPalette[0]),
      readHsl('--chart-2', FALLBACK.chartPalette[1]),
      readHsl('--chart-3', FALLBACK.chartPalette[2]),
      readHsl('--chart-4', FALLBACK.chartPalette[3]),
      readHsl('--chart-5', FALLBACK.chartPalette[4]),
    ],
    fontFamily: readFont('--font-sans', FALLBACK.fontFamily),
    isDark: root.classList.contains('dark'),
  }
}

export function buildVegaConfig(theme: VisualizationTheme): Config {
  return {
    background: 'transparent',
    padding: 4,
    font: theme.fontFamily,
    arc: { fill: theme.chartPalette[0] },
    area: { fill: theme.chartPalette[0], stroke: theme.chartPalette[0] },
    bar: { fill: theme.chartPalette[0], cornerRadiusEnd: 2 },
    line: { stroke: theme.chartPalette[0], strokeWidth: 2 },
    point: { fill: theme.chartPalette[0], stroke: theme.chartPalette[0], size: 60 },
    range: {
      category: theme.chartPalette,
      ordinal: theme.chartPalette,
      heatmap: theme.chartPalette,
      ramp: theme.chartPalette,
    },
    axis: {
      labelColor: theme.mutedForeground,
      labelFont: theme.fontFamily,
      labelFontSize: 11,
      titleColor: theme.foreground,
      titleFont: theme.fontFamily,
      titleFontSize: 12,
      titleFontWeight: 'normal',
      titlePadding: 8,
      domainColor: theme.border,
      tickColor: theme.border,
      gridColor: theme.border,
      gridOpacity: 0.5,
    },
    legend: {
      labelColor: theme.mutedForeground,
      labelFont: theme.fontFamily,
      labelFontSize: 11,
      titleColor: theme.foreground,
      titleFont: theme.fontFamily,
      titleFontSize: 12,
      titleFontWeight: 'normal',
      symbolType: 'square',
    },
    title: {
      color: theme.foreground,
      font: theme.fontFamily,
      fontSize: 13,
      fontWeight: 'normal',
      anchor: 'start',
    },
    view: { stroke: 'transparent' },
  }
}

export function buildMermaidThemeVariables(theme: VisualizationTheme) {
  // mermaid's `base` theme derives some colors and trusts certain explicit overrides
  // (nodeBkg / nodeTextColor / lineColor). Setting them explicitly avoids khroma
  // miscomputing contrast and ending up with text that matches the node fill.
  return {
    darkMode: theme.isDark,
    fontFamily: theme.fontFamily,
    background: 'transparent',
    primaryColor: theme.card,
    primaryTextColor: theme.foreground,
    primaryBorderColor: theme.border,
    secondaryColor: theme.muted,
    secondaryTextColor: theme.foreground,
    secondaryBorderColor: theme.border,
    tertiaryColor: theme.muted,
    tertiaryTextColor: theme.foreground,
    tertiaryBorderColor: theme.border,
    lineColor: theme.mutedForeground,
    textColor: theme.foreground,
    mainBkg: theme.card,
    nodeBkg: theme.card,
    nodeBorder: theme.border,
    nodeTextColor: theme.foreground,
    clusterBkg: theme.muted,
    clusterBorder: theme.border,
    titleColor: theme.foreground,
    edgeLabelBackground: theme.background,
    labelTextColor: theme.foreground,
  }
}
