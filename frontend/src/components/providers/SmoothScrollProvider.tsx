import React, { useEffect } from 'react'
import Lenis from 'lenis'

export const SmoothScrollProvider: React.FC<{ children: React.ReactNode; enabled?: boolean }> = ({ children, enabled = true }) => {
  useEffect(() => {
    if (!enabled) return
    const isMobile = window.matchMedia('(max-width: 1024px)').matches
    if (isMobile) return
    const lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.8,
      syncTouch: false,
    })

    let rafId = 0
    function raf(time: number) {
      lenis.raf(time)
      rafId = requestAnimationFrame(raf)
    }

    rafId = requestAnimationFrame(raf)

    return () => {
      cancelAnimationFrame(rafId)
      lenis.destroy()
    }
  }, [enabled])

  return <>{children}</>
}
