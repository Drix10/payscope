import { motion } from 'framer-motion'
import { useState, useEffect, useRef } from 'react'
import { AnimatedNetworkLines } from './AnimatedNetworkLines'
import { useIsMobile } from '../hooks/useIsMobile'
import { MobileShowcasePanel } from '../components/showcase/MobileShowcasePanel'
import { BlurFadeWords } from '../BlurFadeWords'
import { Workflow, ShieldCheck, Sparkles, CheckCircle2, GitFork, Eye } from 'lucide-react'

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

const MAGIC_BORDER_BLUE = 'conic-gradient(from 0deg, transparent 0%, transparent 35%, rgba(76,109,255,0.12) 42%, #4C6DFF 50%, rgba(76,109,255,0.12) 58%, transparent 65%, transparent 100%)'

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

export function Section3({ isInView: propIsInView }: { isInView?: boolean } = {}) {
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
    return <MobileShowcasePanel eyebrow="03 — How we decide what happened" title="Evidence first, guess second" description="How: AI looks at only the last 12 facts, checks what is missing, and explains why. It never invents amounts or contacts a customer without a clear rule." accentClass="text-[#4c6dff]" />
  }

  const card = (
    <div
      className="landing-showcase-card"
      style={{
        position: 'relative',
        width: NATIVE_W,
        height: NATIVE_H,
        borderRadius: '24px',
        backgroundImage: 'url(https://qclay.design/lovable/glass-menu/s3-card-bg.png), linear-gradient(135deg, #10100a, #040406)',
        backgroundSize: '115%',
        backgroundPosition: 'center',
        overflow: 'hidden',
        boxShadow:
          '0 0 0 1px rgba(76,109,255,0.01), 0 40px 120px rgba(0,0,0,0.75), 0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      <img
        src="https://qclay.design/lovable/glass-menu/s3-card-light-overlay.png"
        alt=""
        referrerPolicy="no-referrer"
        onError={(event) => { event.currentTarget.style.display = 'none' }}
        style={{
          position: 'absolute',
          top: 0, left: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          pointerEvents: 'none',
          zIndex: 999,
          filter: 'drop-shadow(0 0 50px rgba(76, 109, 255, 0.75))',
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
          <div className="inline-flex items-center gap-2.5 rounded-full border border-[#4C6DFF]/30 bg-[#4C6DFF]/10 px-4 py-1.5 backdrop-blur-xl shadow-[0_0_20px_rgba(76,109,255,0.2)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4C6DFF] opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#4C6DFF]"></span>
            </span>
            <span className="font-mono text-xs font-bold tracking-widest text-[#A8C4FF]">03 / 04</span>
            <span className="text-neutral-500">•</span>
            <span className="text-[11px] font-semibold text-neutral-300">How AI helps</span>
          </div>
        </motion.div>

        <h1 style={{ fontFamily: 'var(--font-jakarta)', fontSize: '52px', fontWeight: 300, color: '#ffffff', margin: 0, marginBottom: '8px' }}>
          <BlurFadeWords text="How we find the cause." baseDelay={0.5} isInView={isInView} />
        </h1>
        <p style={{ fontFamily: 'var(--font-jakarta)', fontSize: '28px', fontWeight: 300, margin: 0, marginBottom: '16px' }}>
          <BlurFadeWords
             text="We use only verified facts — at most 12."
            baseDelay={0.8}
            isInView={isInView}
            wordStyle={{
              background: 'linear-gradient(180deg, #A8C4FF 0%, #4C6DFF 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          />
        </p>
        <p style={{ fontFamily: 'var(--font-jakarta)', fontSize: '17px', fontWeight: 300, color: 'rgba(255,255,255,0.65)', margin: 0, maxWidth: '400px' }}>
          <BlurFadeWords text="How: Rules check amount, history, and downtime first." baseDelay={1.1} isInView={isInView} />
          <br />
          <BlurFadeWords text="What you get: A clear cause + what is still missing." baseDelay={1.45} isInView={isInView} />
        </p>
      </div>

      {/* ── Diagram block ── */}
      <div style={{ position: 'absolute', left: '35px', bottom: '-25px', width: '570px', height: '358px', zIndex: 10, pointerEvents: 'none' }}>
        <AnimatedNetworkLines isInView={isInView} color="#4C6DFF" />
      </div>

      {/* ── Right Half Snappy Lightweight Cards (Matching Section 1) ── */}
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
        {/* Top Card: Deterministic Execution Plan */}
        <div style={{ flex: 0.93, position: 'relative', overflow: 'hidden' }}>
          <motion.div
            initial={{ opacity: 0, x: -60, scale: 0.95 }}
            animate={isInView ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: -60, scale: 0.95 }}
            transition={isInView ? { type: 'spring', stiffness: 50, damping: 20, mass: 0.9 } : { duration: 0 }}
            style={{ willChange: 'transform, opacity' }}
            className="smoked-glass relative h-full w-full rounded-3xl p-6 flex flex-col justify-between border border-[#4C6DFF]/30 bg-[#090a0f]/90 shadow-2xl backdrop-blur-xl"
          >
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#4C6DFF] uppercase tracking-wider">
                  <Workflow className="h-3.5 w-3.5" /> How the check works
                </span>
                <span className="rounded-full border border-[#4C6DFF]/30 bg-[#4C6DFF]/10 px-2 py-0.5 text-[9px] font-bold text-[#A8C4FF]">
                  Verified Plan v2.0
                </span>
              </div>
              <h3 className="text-xl font-bold text-white mb-1">Step 1: Rules check the facts</h3>
              <p className="text-xs text-neutral-300 leading-relaxed">
                We calculate how much is at risk, what is already recovered, and how risky this case is. The AI only explains the facts — it cannot change the rules.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
                <div className="text-[10px] text-neutral-400 font-mono">What AI sees</div>
                <div className="text-sm font-bold text-white">At most 12 facts</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
                <div className="text-[10px] text-neutral-400 font-mono">What AI cannot do</div>
                <div className="text-sm font-bold text-[#4C6DFF]">Invent data</div>
              </div>
            </div>

            <MagicBorder color={MAGIC_BORDER_BLUE} radius="24px" isInView={isInView} />
          </motion.div>
        </div>

        {/* Bottom Card: Interactive Disambiguation System */}
        <div style={{ flex: 1.07, overflow: 'hidden' }}>
          <motion.div
            initial={{ opacity: 0, x: 60, scale: 0.95 }}
            animate={isInView ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: 60, scale: 0.95 }}
            transition={isInView ? { type: 'spring', stiffness: 50, damping: 20, mass: 0.9, delay: 0.1 } : { duration: 0 }}
            style={{ willChange: 'transform, opacity' }}
            className="smoked-glass relative h-full w-full rounded-3xl p-6 flex flex-col justify-between border border-[#4C6DFF]/30 bg-[#090a0f]/90 shadow-2xl backdrop-blur-xl"
          >
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#4C6DFF] uppercase tracking-wider">
                  <ShieldCheck className="h-3.5 w-3.5" /> How we stay safe
                </span>
                <span className="font-mono text-[10px] text-neutral-400">Policy-Enforced</span>
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Step 2: What the user sees</h3>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] p-2 text-xs">
                  <span className="flex items-center gap-2 text-neutral-200">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#4C6DFF]" /> If not enough proof? No action.
                  </span>
                  <span className="font-mono font-bold text-emerald-400">Safe stop</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] p-2 text-xs">
                  <span className="flex items-center gap-2 text-neutral-200">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#4C6DFF]" /> If proof is good? Suggest recovery link.
                  </span>
                  <span className="font-mono text-sky-300">You review</span>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
              <span className="text-[11px] text-neutral-400">What you get:</span>
              <span className="text-xs font-bold text-[#4C6DFF]">Clear reason + next step</span>
            </div>

            <MagicBorder color={MAGIC_BORDER_BLUE} radius="24px" reverse isInView={isInView} />
          </motion.div>
        </div>
      </div>

      <MagicBorder color={MAGIC_BORDER_BLUE} radius="24px" duration={10} initialAngle={0} isInView={isInView} />
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
