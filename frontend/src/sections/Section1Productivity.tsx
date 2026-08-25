import { motion } from 'framer-motion'
import { useState, useEffect, useRef } from 'react'
import { AnimatedNetworkLines } from './AnimatedNetworkLines'
import { useIsMobile } from '../hooks/useIsMobile'
import { MobileShowcasePanel } from '../components/showcase/MobileShowcasePanel'
import { BlurFadeWords } from '../BlurFadeWords'
import { Sparkles, Cpu, CheckCircle2, ShieldCheck, Zap } from 'lucide-react'

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
    return <MobileShowcasePanel eyebrow="01 — Autonomous Revenue Recovery" title="Never Lose Revenue to Failed Payments" description="PayScope automatically detects, investigates, and recovers failed Razorpay payments using AI — with zero manual effort." accentClass="text-[#24ff95]" />
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
          zIndex: 1,
          filter: 'drop-shadow(0 0 50px rgba(36, 255, 149, 0.75))',
        }}
      />

      {/* ── Text block ── */}
      <div
        style={{
          position: 'absolute',
          top: '36px',
          left: '48px',
          width: '445px',
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
          style={{ position: 'relative', marginBottom: '18px' }}
        >
          <div className="inline-flex items-center gap-2.5 rounded-full border border-[#00ff87]/30 bg-[#00ff87]/10 px-4 py-1.5 backdrop-blur-xl shadow-[0_0_20px_rgba(0,255,135,0.2)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00ff87] opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#00ff87]"></span>
            </span>
            <span className="font-mono text-xs font-bold tracking-widest text-[#b8ffd9]">01 / 04</span>
            <span className="text-neutral-500">•</span>
            <span className="text-[11px] font-semibold text-neutral-300">Autonomous Revenue Recovery</span>
          </div>
        </motion.div>

        <h1
          style={{
            fontFamily: 'var(--font-jakarta)',
            fontSize: '44px',
            fontWeight: 300,
            lineHeight: 1.08,
            letterSpacing: '-1.2px',
            color: '#ffffff',
            margin: 0,
            marginBottom: '8px',
          }}
        >
          <BlurFadeWords text="Never Lose Revenue to Failed Payments" baseDelay={0.4} isInView={isInView} />
        </h1>

        <p
          style={{
            fontFamily: 'var(--font-jakarta)',
            fontSize: '22px',
            fontWeight: 300,
            lineHeight: 1.25,
            letterSpacing: '-0.5px',
            margin: 0,
            marginBottom: '14px',
          }}
        >
          <BlurFadeWords
            text="Automatically detects, investigates, and recovers lost Razorpay sales."
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
            fontSize: '14px',
            fontWeight: 300,
            lineHeight: 1.45,
            color: 'rgba(255,255,255,0.68)',
            margin: 0,
            maxWidth: '420px',
          }}
        >
          <BlurFadeWords text="Instant Protection: Every webhook is verified for authenticity before processing." baseDelay={0.9} isInView={isInView} />
          <br />
          <BlurFadeWords text="Zero Manual Work: Turns noisy payment errors into clean, self-recovering incidents." baseDelay={1.15} isInView={isInView} />
        </p>
      </div>

      {/* ── Network Lines ── */}
      <div
        style={{
          position: 'absolute',
          left: '25px',
          bottom: '-25px',
          width: '540px',
          height: '358px',
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        <AnimatedNetworkLines isInView={isInView} color="#24FF95" />
      </div>

      {/* ── Right Half Cards Container ── */}
      <div
        style={{
          position: 'absolute',
          top: '32px',
          bottom: '32px',
          left: '518px',
          right: '48px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          boxSizing: 'border-box',
          perspective: '1000px',
          zIndex: 15,
        }}
      >
        {/* Top Card: Cryptographic Verification */}
        <div style={{ flex: 1, position: 'relative' }}>
          <motion.div
            initial={{ opacity: 0, x: 30, scale: 0.96 }}
            animate={isInView ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: 30, scale: 0.96 }}
            transition={isInView ? { type: 'spring', stiffness: 50, damping: 20, mass: 0.9 } : { duration: 0 }}
            style={{ willChange: 'transform, opacity' }}
            className="smoked-glass relative h-full w-full rounded-2xl p-5 flex flex-col justify-between border border-[#00ff87]/30 bg-[#090a0f]/90 shadow-2xl backdrop-blur-xl"
          >
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#00ff87] uppercase tracking-wider">
                  <Zap className="h-3.5 w-3.5 shrink-0" /> Instant Webhook Verification
                </span>
                <span className="shrink-0 rounded-full border border-[#00ff87]/30 bg-[#00ff87]/10 px-2 py-0.5 text-[9px] font-bold text-[#b8ffd9]">
                  HMAC SHA-256
                </span>
              </div>
              <p className="text-sm font-semibold text-white">Cryptographic Security Guarantee</p>
              <p className="mt-1 text-xs leading-5 text-neutral-400">
                Verifies secret Razorpay HMAC signatures instantly. Blocks fake webhooks and duplicate retries before they touch your database.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/40 p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400">Razorpay Signature</span>
                <span className="font-mono font-bold text-[#00ff87]">VERIFIED (200 OK)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400">Duplicate Protection</span>
                <span className="font-mono text-neutral-300">Durable Lease Lock</span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Bottom Card: At-Risk Money */}
        <div style={{ flex: 1, position: 'relative' }}>
          <motion.div
            initial={{ opacity: 0, x: 30, scale: 0.96 }}
            animate={isInView ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: 30, scale: 0.96 }}
            transition={isInView ? { type: 'spring', stiffness: 50, damping: 20, mass: 0.9, delay: 0.15 } : { duration: 0 }}
            style={{ willChange: 'transform, opacity' }}
            className="smoked-glass relative h-full w-full rounded-2xl p-5 flex flex-col justify-between border border-white/10 bg-[#090a0f]/90 shadow-2xl backdrop-blur-xl"
          >
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-300 uppercase tracking-wider">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#00ff87]" /> Real-Time Merchant Visibility
                </span>
                <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-bold text-neutral-400">
                  Live Feed
                </span>
              </div>
              <p className="text-sm font-semibold text-white">Full Financial Control</p>
              <p className="mt-1 text-xs leading-5 text-neutral-400">
                Calculates exact money at risk and groups all related customer failure attempts into a clean, actionable record.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-xs">
                <span className="text-neutral-400">Deduplicated Webhooks</span>
                <span className="font-bold text-white">100% Grouped</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[#00ff87]/20 bg-[#00ff87]/[0.05] p-2.5 text-xs">
                <span className="text-neutral-300">Total Money Protected</span>
                <span className="font-semibold text-[#00ff87]">₹1,250</span>
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
        width: '100vw',
        height: isMobile ? 'auto' : '100vh',
        ...(isMobile ? { minHeight: '100svh', backgroundColor: '#040406', overflow: 'hidden' } : {}),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        contain: 'layout style paint',
      }}
    >
      <div style={{
        position: 'relative',
        flexShrink: 0,
        width: NATIVE_W * scale,
        height: NATIVE_H * scale,
      }}>
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: NATIVE_W,
          height: NATIVE_H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}>
          {card}
        </div>
      </div>
    </section>
  )
}
