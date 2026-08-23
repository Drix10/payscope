import { motion } from 'framer-motion'
import { useState, useEffect, useRef } from 'react'
import { AnimatedNetworkLines } from './AnimatedNetworkLines'
import { useIsMobile } from '../hooks/useIsMobile'
import { MobileShowcasePanel } from '../components/showcase/MobileShowcasePanel'
import { BlurFadeWords } from '../BlurFadeWords'
import { Network, Layers, Sparkles, CheckCircle2, FileText, Database } from 'lucide-react'

function AnimatedWords({ text, baseDelay = 0, isInView }: {
  text: string
  baseDelay?: number
  isInView: boolean
}) {
  const words = text.split(' ')
  return (
    <>
      {words.map((word, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: isInView ? 1 : 0 }}
          transition={{ delay: baseDelay + i * 0.1, duration: 0.4, ease: 'easeOut' }}
          style={{ display: 'inline' }}
        >
          {word}{i < words.length - 1 ? ' ' : ''}
        </motion.span>
      ))}
    </>
  )
}

const MAGIC_BORDER_PURPLE = 'conic-gradient(from 0deg, transparent 0%, transparent 35%, rgba(144,106,255,0.12) 42%, #906AFF 50%, rgba(144,106,255,0.12) 58%, transparent 65%, transparent 100%)'

function MagicBorder({ color, radius = '24px', reverse = false, duration = 4, initialAngle = 0, isInView = true }: { color: string; radius?: string; reverse?: boolean; duration?: number; initialAngle?: number; isInView?: boolean }) {
  if (!isInView) return null
  const fromAngle = reverse ? -initialAngle : initialAngle
  const toAngle = fromAngle + (reverse ? -360 : 360)
  return (
    <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: radius, pointerEvents: 'none', overflow: 'hidden', zIndex: 60, padding: '2px', WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)', WebkitMaskComposite: 'xor', maskComposite: 'exclude' }}>
      <motion.div
        style={{ position: 'absolute', left: '50%', top: '50%', width: '250%', height: '250%', background: color, x: '-50%', y: '-50%', transformOrigin: 'center center', willChange: 'transform' }}
        animate={{ rotate: [fromAngle, toAngle] }}
        transition={{ repeat: Infinity, duration, ease: 'linear' }}
      />
    </div>
  )
}

const NATIVE_W = 1040
const NATIVE_H = 684

export function Section2({ isInView: propIsInView }: { isInView?: boolean } = {}) {
  const sectionRef = useRef<HTMLElement>(null)
  const [internalIsInView, setInternalIsInView] = useState(true)
  const isMobile = useIsMobile()
  const [scale, setScale] = useState(1)

  const isInView = propIsInView ?? internalIsInView

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      setScale(w > 1024 ? Math.min(1, w / 1440, h / 900) : Math.max(0.28, (w - 24) / NATIVE_W))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    let wasVisible = false
    const enterRatio = isMobile ? 0.2 : 0.35
    const exitRatio = isMobile ? 0.05 : 0.1
    const obs = new IntersectionObserver(
      ([entry]) => {
        const ratio = entry.intersectionRatio
        if (entry.isIntersecting && ratio >= enterRatio && !wasVisible) {
          wasVisible = true
          setInternalIsInView(true)
        } else if (!entry.isIntersecting || ratio < exitRatio) {
          wasVisible = false
          setInternalIsInView(false)
        }
      },
      { threshold: [exitRatio, enterRatio] }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [isMobile])

  if (isMobile) {
    return <MobileShowcasePanel eyebrow="02 — Smart Correlation" title="No Noise. Just Clear Incidents." description="Instead of 50 confusing alert emails, PayScope links scattered Razorpay events into a single unified incident timeline." accentClass="text-[#906aff]" />
  }

  const card = (
    <div
      className="landing-showcase-card"
      style={{
        position: 'relative',
        width: NATIVE_W,
        height: NATIVE_H,
        borderRadius: '24px',
        backgroundImage: 'url(https://qclay.design/lovable/glass-menu/s2-card-bg.png), linear-gradient(135deg, #0d0b18, #040406)',
        backgroundSize: '115%',
        backgroundPosition: 'center',
        overflow: 'hidden',
        boxShadow:
          '0 0 0 1px rgba(144,106,255,0.01), 0 40px 120px rgba(0,0,0,0.75), 0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      <img
        src="https://qclay.design/lovable/glass-menu/card-light-overlay.png"
        alt=""
        onError={(event) => { event.currentTarget.style.display = 'none' }}
        style={{
          position: 'absolute',
          top: 0, left: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          pointerEvents: 'none',
          zIndex: 999,
          filter: 'drop-shadow(0 0 50px rgba(144, 106, 255, 0.75))',
        }}
      />

      {/* ── Text block ── */}
      <div style={{ position: 'absolute', top: '40px', left: '65px', width: '480px', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{ position: 'relative', marginBottom: '20px' }}
        >
          <div className="inline-flex items-center gap-2.5 rounded-full border border-[#906AFF]/30 bg-[#906AFF]/10 px-4 py-1.5 backdrop-blur-xl shadow-[0_0_20px_rgba(144,106,255,0.2)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#906AFF] opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#906AFF]"></span>
            </span>
            <span className="font-mono text-xs font-bold tracking-widest text-[#D4C4FF]">02 / 04</span>
            <span className="text-neutral-500">•</span>
            <span className="text-[11px] font-semibold text-neutral-300">Smart Event Correlation</span>
          </div>
        </motion.div>

        <h1 style={{ fontFamily: 'var(--font-jakarta)', fontSize: '48px', fontWeight: 300, color: '#ffffff', margin: 0, marginBottom: '8px' }}>
          <BlurFadeWords text="No Noise. Just Clear Incidents." baseDelay={0.5} isInView={isInView} />
        </h1>
        <p style={{ fontFamily: 'var(--font-jakarta)', fontSize: '24px', fontWeight: 300, margin: 0, marginBottom: '16px' }}>
          <BlurFadeWords
            text="Links scattered payment signals into one unified timeline."
            baseDelay={0.8}
            isInView={isInView}
            wordStyle={{
              background: 'linear-gradient(180deg, #D4C4FF 0%, #906AFF 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          />
        </p>
        <p style={{ fontFamily: 'var(--font-jakarta)', fontSize: '15px', fontWeight: 300, color: 'rgba(255,255,255,0.68)', margin: 0, maxWidth: '420px', lineHeight: 1.45 }}>
           <BlurFadeWords text="Smart Association: Groups retries by Order ID, Customer ID, or 15-min window." baseDelay={1.1} isInView={isInView} />
           <br />
           <BlurFadeWords text="Clear Prioritization: Categorizes risk (Critical, High, Medium) so you focus on what matters." baseDelay={1.45} isInView={isInView} />
        </p>
      </div>

      {/* ── Diagram block ── */}
      <div style={{ position: 'absolute', left: '35px', bottom: '-25px', width: '570px', height: '358px', zIndex: 10, pointerEvents: 'none' }}>
        <AnimatedNetworkLines isInView={isInView} color="#906AFF" />
      </div>

      {/* ── Right Half Snappy Lightweight Cards ── */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: '-1%',
          width: '50%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '24px 28px 24px 73px',
          boxSizing: 'border-box',
          perspective: '1000px',
          zIndex: 15,
        }}
      >
        {/* Top Card: Context Compiler */}
        <div style={{ flex: 0.93, position: 'relative', overflow: 'hidden' }}>
          <motion.div
            initial={{ opacity: 0, x: -60, scale: 0.95 }}
            animate={isInView ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: -60, scale: 0.95 }}
            transition={isInView ? { type: 'spring', stiffness: 50, damping: 20, mass: 0.9 } : { duration: 0 }}
            style={{ willChange: 'transform, opacity' }}
            className="smoked-glass relative h-full w-full rounded-3xl p-6 flex flex-col justify-between border border-[#906AFF]/30 bg-[#090a0f]/90 shadow-2xl backdrop-blur-xl"
          >
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#D4C4FF] uppercase tracking-wider">
                  <Network className="h-3.5 w-3.5 text-[#906AFF]" /> Intelligent Signal Correlation
                </span>
                <span className="rounded-full border border-[#906AFF]/30 bg-[#906AFF]/10 px-2 py-0.5 text-[9px] font-bold text-[#D4C4FF]">
                  Multi-Signal
                </span>
              </div>
              <p className="text-sm font-semibold text-white">Order & Customer Linkage Engine</p>
              <p className="mt-1 text-xs leading-5 text-neutral-400">
                Automatically links initial payment drops, customer retries, and gateway timeouts into a single coherent incident.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/40 p-3 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-neutral-400">Correlation Logic</span>
                <span className="font-mono text-[#D4C4FF]">Order ID + Temporal Window</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-neutral-400">Safety Guard</span>
                <span className="font-mono text-neutral-300">Strict Currency Boundaries</span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Bottom Card: Incident Timeline */}
        <div style={{ flex: 1.07, position: 'relative', overflow: 'hidden' }}>
          <motion.div
            initial={{ opacity: 0, x: -60, scale: 0.95 }}
            animate={isInView ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: -60, scale: 0.95 }}
            transition={isInView ? { type: 'spring', stiffness: 50, damping: 20, mass: 0.9, delay: 0.15 } : { duration: 0 }}
            style={{ willChange: 'transform, opacity' }}
            className="smoked-glass relative h-full w-full rounded-3xl p-6 flex flex-col justify-between border border-white/10 bg-[#090a0f]/90 shadow-2xl backdrop-blur-xl"
          >
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-300 uppercase tracking-wider">
                  <Layers className="h-3.5 w-3.5 text-[#906AFF]" /> Unified Incident Timeline
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-bold text-neutral-400">
                  Live Status
                </span>
              </div>
              <p className="text-sm font-semibold text-white">One Consolidated Dashboard View</p>
              <p className="mt-1 text-xs leading-5 text-neutral-400">
                Merchants see the exact story of what happened, verified event count, and live at-risk financial amounts.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-xs">
                <span className="text-neutral-400">Incident Priority</span>
                <span className="font-bold text-amber-300">MEDIUM PRIORITY</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[#906AFF]/20 bg-[#906AFF]/[0.05] p-2.5 text-xs">
                <span className="text-neutral-300">Linked Event History</span>
                <span className="font-semibold text-[#D4C4FF]">3 Verified Signals</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )

  return (
    <section
      ref={sectionRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100vh',
        minHeight: '680px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: '#040406',
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          transition: 'transform 0.1s ease-out',
          willChange: 'transform',
        }}
      >
        {card}
      </div>
    </section>
  )
}
