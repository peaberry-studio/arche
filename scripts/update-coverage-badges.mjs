import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const badgeSpecs = [
  {
    label: 'web coverage',
    outputPath: path.join(repoRoot, '.github', 'badges', 'web-coverage.svg'),
    summaryPath: path.join(repoRoot, 'apps', 'web', 'coverage', 'all', 'coverage-summary.json'),
  },
  {
    label: 'web unit',
    outputPath: path.join(repoRoot, '.github', 'badges', 'web-unit-coverage.svg'),
    summaryPath: path.join(repoRoot, 'apps', 'web', 'coverage', 'unit', 'coverage-summary.json'),
  },
  {
    label: 'web integration',
    outputPath: path.join(repoRoot, '.github', 'badges', 'web-integration-coverage.svg'),
    summaryPath: path.join(repoRoot, 'apps', 'web', 'coverage', 'integration', 'coverage-summary.json'),
  },
]

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function getBadgeColor(percentage) {
  if (percentage >= 80) {
    return '#4c1'
  }

  if (percentage >= 60) {
    return '#dfb317'
  }

  return '#e05d44'
}

function renderBadge(label, value, color) {
  const labelWidth = Math.max(50, label.length * 7 + 10)
  const valueWidth = Math.max(46, value.length * 7 + 10)
  const totalWidth = labelWidth + valueWidth
  const labelX = Math.round(labelWidth / 2)
  const valueX = labelWidth + Math.round(valueWidth / 2)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(value)}">
  <title>${escapeXml(label)}: ${escapeXml(value)}</title>
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".7"/>
    <stop offset=".1" stop-color="#aaa" stop-opacity=".1"/>
    <stop offset=".9" stop-opacity=".3"/>
    <stop offset="1" stop-opacity=".5"/>
  </linearGradient>
  <mask id="round">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#round)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#smooth)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelX}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${labelX}" y="14">${escapeXml(label)}</text>
    <text x="${valueX}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(value)}</text>
    <text x="${valueX}" y="14">${escapeXml(value)}</text>
  </g>
</svg>`
}

async function getBadgeData(summaryPath) {
  try {
    const rawSummary = await readFile(summaryPath, 'utf8')
    const summary = JSON.parse(rawSummary)
    const percentage = Number(summary?.total?.lines?.pct)

    if (!Number.isFinite(percentage)) {
      throw new Error(`Invalid coverage percentage in ${summaryPath}`)
    }

    return {
      color: getBadgeColor(percentage),
      value: `${percentage.toFixed(1)}%`,
    }
  } catch {
    return {
      color: '#9f9f9f',
      value: 'not-run',
    }
  }
}

async function main() {
  for (const badgeSpec of badgeSpecs) {
    const outputDir = path.dirname(badgeSpec.outputPath)
    await mkdir(outputDir, { recursive: true })

    const badgeData = await getBadgeData(badgeSpec.summaryPath)
    const badgeSvg = renderBadge(badgeSpec.label, badgeData.value, badgeData.color)
    await writeFile(badgeSpec.outputPath, badgeSvg, 'utf8')
  }
}

await main()
