import { motion } from 'framer-motion'
import { useState, useEffect, useRef } from 'react'
import { AnimatedNetworkLines } from './AnimatedNetworkLines'
import { useIsMobile } from '../hooks/useIsMobile'
import { MobileShowcasePanel } from '../components/showcase/MobileShowcasePanel'
import { BlurFadeWords } from '../BlurFadeWords'
import { Sparkles, Play, Database, ArrowRight, ShieldCheck, Bot } from 'lucide-react'

const MAGIC_BORDER_WHITE = 'conic-gradient(from 0deg, transparent 0%, transparent 35%, rgba(255,255,255,0.12) 42%, #ffffff 50%, rgba(255,255,255,0.12) 58%, transparent 65%, transparent 100%)'

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

interface Section4Props {
  isInView?: boolean;
  onOpenDashboard?: () => void;
}

export function Section4({
  isInView: propIsInView,
  onOpenDashboard,
}: Section4Props) {
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
    return (
       <MobileShowcasePanel eyebrow="04 / AI Activity Dashboard" title="One dashboard. Full visibility." description="Browse incidents and inspect the evidence, policy decision, and bounded action record the AI created automatically." accentClass="text-[#00ff87]">
         <button type="button" onClick={onOpenDashboard} className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-[#00ff87] px-4 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(0,255,135,0.25)] hover:bg-[#00ff87]/90">
           Open the PayScope Dashboard <ArrowRight className="h-4 w-4" />
         </button>
       </MobileShowcasePanel>
    )
  }

  const card = (
      <div
        className="landing-showcase-card"
      style={{
        position: 'relative',
        width: NATIVE_W,
        height: NATIVE_H,
        borderRadius: '24px',
        backgroundImage: 'url(https://qclay.design/lovable/glass-menu/s4-card-bg.png), linear-gradient(135deg, #0c1518, #040406)',
        backgroundSize: '115%',
        backgroundPosition: 'center',
        overflow: 'hidden',
        boxShadow:
          '0 0 0 1px rgba(255,255,255,0.01), 0 40px 120px rgba(0,0,0,0.75), 0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      <img
        src="https://qclay.design/lovable/glass-menu/card-light-overlay.png"
        alt=""
        referrerPolicy="no-referrer"
        onError={(event) => { event.currentTarget.style.display = 'none' }}
        style={{
          position: 'absolute',
          top: 0, left: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          pointerEvents: 'none',
          zIndex: 1,
          filter: 'drop-shadow(0 0 50px rgba(255, 255, 255, 0.75))',
        }}
      />

      {/* Main Section Header */}
      <div style={{ position: 'absolute', top: '35px', left: '55px', right: '55px', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{ position: 'relative', marginBottom: '12px' }}
        >
          <div className="inline-flex items-center gap-2.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 backdrop-blur-xl shadow-[0_0_20px_rgba(255,183,3,0.2)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400"></span>
            </span>
            <span className="font-mono text-xs font-bold tracking-widest text-amber-300">04 / 04</span>
            <span className="text-neutral-500">•</span>
            <span className="text-[11px] font-semibold text-neutral-300">Autonomous action records</span>
          </div>
        </motion.div>

        <h1 style={{ fontFamily: 'var(--font-jakarta)', fontSize: '46px', fontWeight: 300, color: '#ffffff', margin: 0, marginBottom: '6px' }}>
          <BlurFadeWords text="Autonomous. Fully Traceable." baseDelay={0.4} isInView={isInView} />
        </h1>

        <p style={{ fontFamily: 'var(--font-jakarta)', fontSize: '17px', fontWeight: 300, color: 'rgba(255,255,255,0.7)', margin: 0, marginBottom: '18px' }}>
           <BlurFadeWords text="Set stopping rules once — the agent investigates, applies policy, and records every permitted bounded action automatically." baseDelay={0.7} isInView={isInView} />
        </p>

        {/* User Guidance Step Pills */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 15 }}
          transition={{ delay: 0.9, duration: 0.5 }}
          className="mb-5 grid grid-cols-3 gap-3"
        >
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur-md">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#00ff87]">
              <Database className="h-3.5 w-3.5" /> 1. Verified Incidents
            </div>
            <p className="mt-1 text-[11px] text-neutral-400">
               Correlated Razorpay signals with evidence and amount-at-risk.
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur-md">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-400">
              <Bot className="h-3.5 w-3.5" /> 2. Bounded Investigation
            </div>
            <p className="mt-1 text-[11px] text-neutral-400">
              Rules + optional model explain evidence without inventing facts.
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur-md">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                <ShieldCheck className="h-3.5 w-3.5" /> 3. Automatic Simulation
             </div>
             <p className="mt-1 text-[11px] text-neutral-400">
                The worker records every policy-permitted action as a simulation; no customer message is sent.
             </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
          transition={{ delay: 1.1, duration: 0.6 }}
          className="relative z-30 flex items-center justify-between gap-5 rounded-2xl border border-[#00ff87]/30 bg-[#090a0f]/90 p-5 shadow-2xl backdrop-blur-2xl"
        >
          <div>
            <p className="text-xs font-bold text-[#00ff87]">One dashboard. One clear flow.</p>
            <p className="mt-1 text-[11px] text-neutral-400">Review incidents, inspect investigations, and approve decisions — all in one place.</p>
          </div>
          <button type="button" onClick={onOpenDashboard} className="flex shrink-0 items-center gap-2 rounded-xl bg-[#00ff87] px-4 py-2.5 text-xs font-bold text-black shadow-[0_0_20px_rgba(0,255,135,0.25)] hover:bg-[#00ff87]/90">
            Open Dashboard <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      </div>

      {/* Network Lines */}
      <div style={{ position: 'absolute', left: '35px', bottom: '-25px', width: '570px', height: '358px', zIndex: 10, pointerEvents: 'none' }}>
        <AnimatedNetworkLines isInView={isInView} color="#ffffff" />
      </div>

      <MagicBorder color={MAGIC_BORDER_WHITE} radius="24px" duration={10} initialAngle={90} isInView={isInView} />
    </div>
  )

  return (
    <section
      ref={sectionRef}
      style={{
        width: '100vw',
        height: isMobile ? 'auto' : '100vh',
        ...(isMobile ? { minHeight: '100svh', backgroundColor: '#040406', overflow: 'hidden' } : {}),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        contain: 'layout style paint',
      }}
    >
      <div style={{ position: 'relative', flexShrink: 0, width: NATIVE_W * scale, height: NATIVE_H * scale }}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: NATIVE_W, height: NATIVE_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          {card}
        </div>
      </div>
    </section>
  )
}
