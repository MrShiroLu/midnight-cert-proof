import { useEffect, useRef } from 'react'

const SPACING = 28
const DOT_RADIUS = 1.4
const REPEL_RADIUS = 110
const REPEL_STRENGTH = 34
const SPRING = 0.08
const FRICTION = 0.82

type Dot = {
  homeX: number
  homeY: number
  x: number
  y: number
  vx: number
  vy: number
}

export function InteractiveDotGrid({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    let dots: Dot[] = []
    let width = 0
    let height = 0
    let mouseX = -9999
    let mouseY = -9999

    function buildGrid() {
      const rect = canvas!.getBoundingClientRect()
      width = rect.width
      height = rect.height
      const dpr = window.devicePixelRatio || 1
      canvas!.width = width * dpr
      canvas!.height = height * dpr
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)

      dots = []
      for (let y = SPACING / 2; y < height; y += SPACING) {
        for (let x = SPACING / 2; x < width; x += SPACING) {
          dots.push({ homeX: x, homeY: y, x, y, vx: 0, vy: 0 })
        }
      }
    }

    function onMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect()
      mouseX = e.clientX - rect.left
      mouseY = e.clientY - rect.top
    }

    function onLeave() {
      mouseX = -9999
      mouseY = -9999
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height)
      ctx!.fillStyle = 'rgba(255, 255, 255, 0.35)'

      const fadeStart = height * 0.55

      for (const dot of dots) {
        const dx = dot.x - mouseX
        const dy = dot.y - mouseY
        const dist = Math.hypot(dx, dy)

        if (dist < REPEL_RADIUS) {
          const force = (1 - dist / REPEL_RADIUS) * REPEL_STRENGTH
          const angle = Math.atan2(dy, dx)
          dot.vx += Math.cos(angle) * force * 0.05
          dot.vy += Math.sin(angle) * force * 0.05
        }

        dot.vx += (dot.homeX - dot.x) * SPRING
        dot.vy += (dot.homeY - dot.y) * SPRING
        dot.vx *= FRICTION
        dot.vy *= FRICTION
        dot.x += dot.vx
        dot.y += dot.vy

        const fade = dot.homeY < fadeStart ? 1 : Math.max(0, 1 - (dot.homeY - fadeStart) / (height - fadeStart))
        if (fade <= 0) continue

        ctx!.globalAlpha = fade
        ctx!.beginPath()
        ctx!.arc(dot.x, dot.y, DOT_RADIUS, 0, Math.PI * 2)
        ctx!.fill()
      }
      ctx!.globalAlpha = 1
    }

    let raf = 0
    function loop() {
      draw()
      raf = requestAnimationFrame(loop)
    }

    buildGrid()
    const resizeObserver = new ResizeObserver(buildGrid)
    resizeObserver.observe(canvas)

    if (reduceMotion) {
      draw()
    } else {
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerleave', onLeave)
      raf = requestAnimationFrame(loop)
    }

    return () => {
      cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} />
}
