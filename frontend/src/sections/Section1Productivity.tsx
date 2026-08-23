import { motion } from 'framer-motion'
import { useState, useEffect, useRef } from 'react'
import { AnimatedNetworkLines } from './AnimatedNetworkLines'
import { useIsMobile } from '../hooks/useIsMobile'
import { MobileShowcasePanel } from '../components/showcase/MobileShowcasePanel'
import { BlurFadeWords } from '../BlurFadeWords'
import { Sparkles, Cpu, CheckCircle2 } from 'lucide-react'


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
          transition={{ delay: baseDelay + i * 0.08, duration: 0.35, ease: 'easeOut' }}
          style={{ display: 'inline' }}
        >
          {word}{i < words.length - 1 ? ' ' : ''}
        </motion.span>
      ))}
    </>
  )
}

const MAGIC_BORDER_GREEN = 'conic-gradient(from 0deg, transparent 0%, transparent 35%, rgba(36,255,149,0.12) 42%, #24FF95 50%, rgba(36,255,149,0.12) 58%, transparent 65%, transparent 100%)'

function MagicBorder({ color, radius = '24px', reverse = false, duration = 5, initialAngle = 0, isInView = true }: { color: string; radius?: string; reverse?: boolean; duration?: number; initialAngle?: number; isInView?: boolean }) {
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

export function Section1Productivity({ isInView: propIsInView }: { isInView?: boolean } = {}) {
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
    return <MobileShowcasePanel eyebrow="01 — What happens first" title="We turn noisy payment events into clear incidents" description="PayScope checks every Razorpay webhook is real, removes duplicates, and groups related events — so you see one incident with evidence, not 50 confusing alerts." accentClass="text-[#24ff95]" />
  }

  const card = (
    <div
      className="landing-showcase-card"
      style={{
        position: 'relative',
        width: NATIVE_W,
        height: NATIVE_H,
        borderRadius: '24px',
        backgroundImage: 'url(https://qclay.design/lovable/glass-menu/s1-main-card-bg.png), linear-gradient(135deg, #09130f, #040406)',
        backgroundSize: '115%',
        backgroundPosition: 'center',
        overflow: 'hidden',
        boxShadow:
          '0 0 0 1px rgba(129,209,189,0.01), 0 40px 120px rgba(0,0,0,0.75), 0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
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
          objectPosition: 'center',
          pointerEvents: 'none',
          zIndex: 999,
          filter: 'drop-shadow(0 0 50px rgba(36, 255, 149, 0.75))',
        }}
      />

      {/* ── Text block ── */}
      <div
        style={{
          position: 'absolute',
          top: '40px',
          left: '65px',
          width: '480px',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10,
          visibility: isInView ? 'visible' : 'hidden',
        }}
      >
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{ position: 'relative', marginBottom: '20px' }}
        >
          <div className="inline-flex items-center gap-2.5 rounded-full border border-[#00ff87]/30 bg-[#00ff87]/10 px-4 py-1.5 backdrop-blur-xl shadow-[0_0_20px_rgba(0,255,135,0.2)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00ff87] opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#00ff87]"></span>
            </span>
            <span className="font-mono text-xs font-bold tracking-widest text-[#b8ffd9]">01 / 04</span>
            <span className="text-neutral-500">•</span>
            <span className="text-[11px] font-semibold text-neutral-300">How we verify</span>
          </div>
        </motion.div>

        <h1
          style={{
            fontFamily: 'var(--font-jakarta)',
            fontSize: '52px',
            fontWeight: 300,
            lineHeight: 1.08,
            letterSpacing: '-1.2px',
            color: '#ffffff',
            margin: 0,
            marginBottom: '8px',
          }}
        >
          <BlurFadeWords text="Every payment event is verified first." baseDelay={0.4} isInView={isInView} />
        </h1>

        <p
          style={{
            fontFamily: 'var(--font-jakarta)',
            fontSize: '28px',
            fontWeight: 300,
            lineHeight: 1.2,
            letterSpacing: '-0.5px',
            margin: 0,
            marginBottom: '16px',
          }}
        >
          <BlurFadeWords
            text="Real webhooks stay. Fake or duplicate ones are blocked."
            baseDelay={0.65}
            isInView={isInView}
            wordStyle={{
              background: 'linear-gradient(180deg, #9BFFCF 0%, #24FF95 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          />
        </p>

        <p
          style={{
            fontFamily: 'var(--font-jakarta)',
            fontSize: '17px',
            fontWeight: 300,
            lineHeight: 1.35,
            color: 'rgba(255,255,255,0.65)',
            margin: 0,
            maxWidth: '420px',
          }}
        >
           <BlurFadeWords text="How: We check Razorpay's signature and event ID." baseDelay={0.9} isInView={isInView} />
           <br />
           <BlurFadeWords text="What you get: One clean incident with amount and proof." baseDelay={1.15} isInView={isInView} />
        </p>
      </div>

      {/* ── Network Lines ── */}
      <div
        style={{
          position: 'absolute',
          left: '35px',
          bottom: '-25px',
          width: '570px',
          height: '358px',
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        <AnimatedNetworkLines isInView={isInView} color="#24FF95" />
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
        {/* Top Card: HMAC Signature Engine */}
        <div style={{ flex: 0.93, position: 'relative', overflow: 'hidden' }}>
          <motion.div
            initial={{ opacity: 0, x: -60, scale: 0.95 }}
            animate={isInView ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: -60, scale: 0.95 }}
            transition={isInView ? { type: 'spring', stiffness: 50, damping: 20, mass: 0.9 } : { duration: 0 }}
            style={{ willChange: 'transform, opacity' }}
            className="smoked-glass relative h-full w-full rounded-3xl p-6 flex flex-col justify-between border border-[#00ff87]/30 bg-[#090a0f]/90 shadow-2xl backdrop-blur-xl"
          >
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#00ff87] uppercase tracking-wider">
                  <Cpu className="h-3.5 w-3.5" /> How we check it's real
                </span>
                <span className="rounded-full border border-[#00ff87]/30 bg-[#00ff87]/10 px-2 py-0.5 text-[9px] font-bold text-[#00ff87]">
                  Verified v1.0
                </span>
              </div>
              <h3 className="text-xl font-bold text-white mb-1">Webhook → Trusted event</h3>
              <p className="text-xs text-neutral-300 leading-relaxed">
                We verify the Razorpay signature (like a password check) and ignore duplicates. Only real, new events become incidents you can act on.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
                <div className="text-[10px] text-neutral-400 font-mono">What we store</div>
                <div className="text-sm font-bold text-white">Why it happened</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
                <div className="text-[10px] text-neutral-400 font-mono">Why this matters</div>
                 <div className="text-sm font-bold text-[#00ff87]">No double counting</div>
              </div>
            </div>

            <MagicBorder color={MAGIC_BORDER_GREEN} radius="24px" isInView={isInView} />
          </motion.div>
        </div>

        {/* Bottom Card: MeshAPI Engine Execution */}
        <div style={{ flex: 1.07, overflow: 'hidden' }}>
          <motion.div
            initial={{ opacity: 0, x: 60, scale: 0.95 }}
            animate={isInView ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: 60, scale: 0.95 }}
            transition={isInView ? { type: 'spring', stiffness: 50, damping: 20, mass: 0.9, delay: 0.1 } : { duration: 0 }}
            style={{ willChange: 'transform, opacity' }}
            className="smoked-glass relative h-full w-full rounded-3xl p-6 flex flex-col justify-between border border-[#00ff87]/30 bg-[#090a0f]/90 shadow-2xl backdrop-blur-xl"
          >
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#00ff87] uppercase tracking-wider">
                  <Sparkles className="h-3.5 w-3.5" /> How we group events
                </span>
                 <span className="font-mono text-[10px] text-neutral-400">Payment · Order · Subscription</span>
              </div>
              <h3 className="text-lg font-bold text-white mb-2">One incident, not many alerts</h3>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] p-2 text-xs">
                  <span className="flex items-center gap-2 text-neutral-200">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#00ff87]" /> Payments from same order? One incident.
                  </span>
                  <span className="font-mono font-bold text-amber-400">Grouped</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] p-2 text-xs">
                  <span className="flex items-center gap-2 text-neutral-200">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#00ff87]" /> Different currencies? Never grouped.
                  </span>
                  <span className="font-mono text-sky-400">Safe</span>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
              <span className="text-[11px] text-neutral-400">How we match:</span>
              <span className="text-xs font-bold text-[#00ff87]">Same payment/order or 15-min window</span>
            </div>

            <MagicBorder color={MAGIC_BORDER_GREEN} radius="24px" reverse isInView={isInView} />
          </motion.div>
        </div>
      </div>

      <MagicBorder color={MAGIC_BORDER_GREEN} radius="24px" duration={10} initialAngle={180} isInView={isInView} />
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
