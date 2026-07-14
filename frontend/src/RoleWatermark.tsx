import { useLayoutEffect, useState } from 'react'

const FONT = (px: number) => `900 ${px}px "Instrument Sans Variable", sans-serif`

let measureCtx: CanvasRenderingContext2D | null = null

function getMeasureCtx() {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  return measureCtx!
}

// Every word this watermark can show, so sizing accounts for all of them —
// otherwise a narrower word (e.g. "ISSUER") gets scaled up more than a wider
// one (e.g. "HOLDER") to fill the same width, making it look inconsistently
// larger when switching tabs.
const ROLE_WORDS = ['Holder', 'Issuer']

export function RoleWatermark({ word, top }: { word: string; top: number }) {
  const [fontSize, setFontSize] = useState(0)
  const [nudge, setNudge] = useState(0)

  useLayoutEffect(() => {
    let cancelled = false

    async function measure() {
      // Canvas measureText falls back to a system font until the webfont has
      // actually finished loading, which produces a wrong (and inconsistent
      // between words) size on first paint. Wait for it before measuring.
      await Promise.all(
        ROLE_WORDS.map((w) => document.fonts.load(FONT(100), w.toUpperCase())),
      )
      await document.fonts.ready
      if (cancelled) return

      const ctx = getMeasureCtx()
      const REF = 100
      ctx.font = FONT(REF)
      const availableWidth = window.innerWidth
      const availableHeight = window.innerHeight - top
      const fontSizeForWidth = Math.min(
        ...ROLE_WORDS.map((w) => {
          const widthAtRef = ctx.measureText(w.toUpperCase()).width
          return (availableWidth / widthAtRef) * REF
        }),
      )
      const fontSizeForHeight = availableHeight * 0.95
      const finalSize = Math.max(
        0,
        Math.min(fontSizeForWidth, fontSizeForHeight),
      )

      // A line-box at line-height:1 still reserves the font's descent below
      // the glyphs' actual ink, leaving a visible gap before the viewport
      // edge. Measure that gap at the final size and push the text down by
      // exactly that amount so the ink itself touches the bottom.
      ctx.font = FONT(finalSize)
      const metrics = ctx.measureText(word.toUpperCase())
      const gap =
        (metrics.fontBoundingBoxDescent ?? 0) -
        (metrics.actualBoundingBoxDescent ?? 0)

      setFontSize(finalSize)
      setNudge(gap)
    }

    measure()
    window.addEventListener('resize', measure)
    return () => {
      cancelled = true
      window.removeEventListener('resize', measure)
    }
  }, [word, top])

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-0 flex select-none items-end justify-center overflow-hidden whitespace-nowrap text-center font-black uppercase leading-none text-white/[0.06]"
      style={{ top }}
    >
      <span style={{ fontSize, transform: `translateY(${nudge}px)` }}>
        {word}
      </span>
    </div>
  )
}
