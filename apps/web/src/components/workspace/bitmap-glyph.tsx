'use client'

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

export const BITMAP_GRID_COLS = 6
export const BITMAP_GRID_ROWS = 6

export type BitmapAnimationConfig = {
  intervalMs: number
  frames: boolean[][]
}

export function createFrame(
  cols: number,
  rows: number,
  activeDots: Array<[number, number]>,
): boolean[] {
  const frame = Array.from({ length: cols * rows }, () => false)
  for (const [x, y] of activeDots) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) continue
    frame[y * cols + x] = true
  }
  return frame
}

type BitmapGlyphProps = {
  frames: boolean[][]
  intervalMs: number
  className?: string
  dotGapPx?: number
  dotSizePx?: number
}

export function BitmapGlyph({
  frames,
  intervalMs,
  className,
  dotGapPx = 1,
  dotSizePx = 2,
}: BitmapGlyphProps) {
  const [frameIndex, setFrameIndex] = useState(0)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setPrefersReducedMotion(mediaQuery.matches)
    onChange()

    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (prefersReducedMotion || frames.length <= 1) return
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % frames.length)
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [frames.length, intervalMs, prefersReducedMotion])

  const frame = prefersReducedMotion
    ? frames[0]
    : frames[frameIndex % frames.length]

  return (
    <span
      className={cn('grid shrink-0', className)}
      style={{
        gridTemplateColumns: `repeat(${BITMAP_GRID_COLS}, ${dotSizePx}px)`,
        gridTemplateRows: `repeat(${BITMAP_GRID_ROWS}, ${dotSizePx}px)`,
        gap: `${dotGapPx}px`,
      }}
      aria-hidden="true"
    >
      {frame.map((isActive, index) => (
        <span
          key={index}
          style={{ width: `${dotSizePx}px`, height: `${dotSizePx}px` }}
          className={cn(
            'rounded-[0.5px] bg-current transition-opacity duration-100',
            isActive ? 'opacity-80' : 'opacity-[0.08]',
          )}
        />
      ))}
    </span>
  )
}
