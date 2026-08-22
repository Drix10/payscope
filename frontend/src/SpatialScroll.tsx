import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, animate, useReducedMotion } from 'framer-motion'
import { Section1Productivity } from './sections/Section1Productivity'
import { Section2 } from './sections/Section2'
import { Section3 } from './sections/Section3'
import { Section4 } from './sections/Section4'
import { useIsMobile } from './hooks/useIsMobile'

const SECTION_POSITIONS = [
  { x: 0, y: 0 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
]

export function SpatialScroll() {
  const [activeSection, setActiveSection] = useState(0)
  const isMobile = useIsMobile()
  const isPhone = useIsMobile(600)
  const prefersReducedMotion = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sectionRef = useRef(0)
  const isAnimating = useRef(false)
  const hasLooped = useRef(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const animationControls = useRef<Array<{ stop: () => void }>>([])

  const posFor = useCallback((idx: number) => {
    const pos = SECTION_POSITIONS[idx]
    return {
      tx: pos.x * (window.innerWidth * 0.74),
      ty: pos.y * (window.innerHeight * 0.82),
    }
  }, [])

  const animTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelAccum = useRef(0)
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastWheelDir = useRef<number | null>(null)
  const lastAdvanceAt = useRef(0)

  const goTo = useCallback((idx: number) => {
    if (isAnimating.current) return
    isAnimating.current = true
    if (sectionRef.current === 3 && idx === 0) hasLooped.current = true
    setActiveSection(idx)
    const { tx, ty } = posFor(idx)
    animationControls.current.forEach((control) => control.stop())
    animationControls.current = [
      animate(x, tx, { duration: prefersReducedMotion ? 0 : 0.75, ease: [0.16, 1, 0.3, 1] }),
      animate(y, ty, { duration: prefersReducedMotion ? 0 : 0.75, ease: [0.16, 1, 0.3, 1] }),
    ]
    sectionRef.current = idx
    if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current)
    animTimeoutRef.current = setTimeout(() => { isAnimating.current = false }, prefersReducedMotion ? 0 : 800)
  }, [x, y, posFor, prefersReducedMotion])

  useEffect(() => {
    return () => {
      if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current)
      if (wheelTimer.current) clearTimeout(wheelTimer.current)
      animationControls.current.forEach((control) => control.stop())
    }
  }, [])

  useEffect(() => {
    if (isMobile) return
    const handleWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, button, [contenteditable="true"], [data-scrollable="true"]')) return
      e.preventDefault()
      // Swallow the inertial momentum tail that outlives the animation lock.
      if (performance.now() - lastAdvanceAt.current < 400) {
        wheelAccum.current = 0
        return
      }
      let delta = e.deltaY
      if (e.deltaMode === 1) delta *= 16
      const dir = delta > 0 ? 1 : -1
      if (lastWheelDir.current !== null && lastWheelDir.current !== dir) wheelAccum.current = 0
      lastWheelDir.current = dir
      wheelAccum.current += delta
      if (wheelTimer.current) clearTimeout(wheelTimer.current)
      wheelTimer.current = setTimeout(() => { wheelAccum.current = 0; lastWheelDir.current = null }, 160)
      if (Math.abs(wheelAccum.current) < 60) return
      wheelAccum.current = 0
      if (isAnimating.current) return
      lastAdvanceAt.current = performance.now()
      if (!hasLooped.current && sectionRef.current === 0 && dir === -1) return
      goTo((sectionRef.current + dir + 4) % 4)
    }
    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [goTo, isMobile])

  useEffect(() => {
    const handleShowcaseNavigation = (event: Event) => {
      const index = (event as CustomEvent<number>).detail
      if (!Number.isInteger(index) || index < 0 || index > 3) return
      if (isMobile) {
        scrollContainerRef.current?.children[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        goTo(index)
      }
    }
    window.addEventListener('showcase-navigate', handleShowcaseNavigation)
    return () => window.removeEventListener('showcase-navigate', handleShowcaseNavigation)
  }, [goTo, isMobile])

  useEffect(() => {
    if (isMobile) return
    let timer: ReturnType<typeof setTimeout>
    const handleResize = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const { tx, ty } = posFor(sectionRef.current)
        x.set(tx)
        y.set(ty)
      }, 100)
    }
    window.addEventListener('resize', handleResize)
    return () => { window.removeEventListener('resize', handleResize); clearTimeout(timer) }
  }, [x, y, posFor, isMobile])

  useEffect(() => {
    if (isMobile) return
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]
      touchStart.current = { x: t.clientX, y: t.clientY }
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (!touchStart.current) return
      const t = e.changedTouches[0]
      const dx = touchStart.current.x - t.clientX
      const dy = touchStart.current.y - t.clientY
      touchStart.current = null
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      if (absDx < 50 && absDy < 50) return
      const dir = absDx >= absDy ? (dx > 0 ? 1 : -1) : (dy > 0 ? 1 : -1)
      if (!hasLooped.current && sectionRef.current === 0 && dir === -1) return
      goTo((sectionRef.current + dir + 4) % 4)
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => { window.removeEventListener('touchstart', onTouchStart); window.removeEventListener('touchend', onTouchEnd) }
  }, [isMobile, goTo])

  if (isMobile) {
    const isTablet = !isPhone
    const snapSlot: React.CSSProperties = {
      height: '100vh',
      boxSizing: 'border-box',
      scrollSnapAlign: 'start',
      scrollSnapStop: 'always',
      overflow: 'hidden',
      paddingBottom: isTablet ? '36px' : 0,
    }
    return (
        <div
          ref={scrollContainerRef}
          tabIndex={0}
          role="region"
           aria-label="PayScope product overview. Use the arrow keys to change sections."
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowRight' && event.key !== 'PageDown' && event.key !== 'ArrowUp' && event.key !== 'ArrowLeft' && event.key !== 'PageUp') return
            event.preventDefault()
            const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'PageDown' ? 1 : -1
            const nextIndex = Math.min(3, Math.max(0, sectionRef.current + direction))
            sectionRef.current = nextIndex
            setActiveSection(nextIndex)
            scrollContainerRef.current?.children[nextIndex]?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
          }}
          style={{ width: '100vw', height: '100dvh', overflowY: 'scroll', overscrollBehaviorY: 'contain', scrollSnapType: 'y mandatory', backgroundColor: '#0a0d15', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        >
        <div style={snapSlot}><Section1Productivity /></div>
        <div style={snapSlot}><Section2 /></div>
        <div style={snapSlot}><Section3 /></div>
         <div style={snapSlot}><Section4 onOpenDashboard={() => window.dispatchEvent(new CustomEvent('payscope-open-dashboard'))} /></div>
      </div>
    )
  }

  return (
    <div
      tabIndex={0}
      role="region"
       aria-label="PayScope product overview. Use the arrow keys to change sections."
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
          event.preventDefault()
          goTo((sectionRef.current + 1) % 4)
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
          event.preventDefault()
          if (!hasLooped.current && sectionRef.current === 0) return
          goTo((sectionRef.current + 3) % 4)
        }
      }}
      style={{ width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#040406' }}
    >
      <motion.div style={{ x, y, position: 'relative', width: '200vw', height: '200vh', willChange: 'transform', transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}>
        <div style={{ position: 'absolute', top: '0', left: '0', width: '100vw', height: '100vh' }}><Section1Productivity isInView={activeSection === 0} /></div>
        <div style={{ position: 'absolute', top: '0', left: '74vw', width: '100vw', height: '100vh' }}><Section2 isInView={activeSection === 1} /></div>
        <div style={{ position: 'absolute', top: '82vh', left: '74vw', width: '100vw', height: '100vh' }}><Section3 isInView={activeSection === 2} /></div>
         <div style={{ position: 'absolute', top: '82vh', left: '0', width: '100vw', height: '100vh' }}><Section4 onOpenDashboard={() => window.dispatchEvent(new CustomEvent('payscope-open-dashboard'))} isInView={activeSection === 3} /></div>
      </motion.div>
    </div>
  )
}
