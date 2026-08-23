import { motion } from 'framer-motion'
import { useState, useEffect, useRef } from 'react'
import { AnimatedNetworkLines } from './AnimatedNetworkLines'
import { useIsMobile } from '../hooks/useIsMobile'
import { MobileShowcasePanel } from '../components/showcase/MobileShowcasePanel'
import { BlurFadeWords } from '../BlurFadeWords'
import { ArrowRight, BadgeCheck, Bot, CreditCard, Database, RefreshCw, Send, ShieldCheck, Webhook } from 'lucide-react'

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
      <MobileShowcasePanel eyebrow="04 / Autonomous execution" title="From incident to confirmed outcome." description="The agent plans the recovery, clears execution policy, dispatches the provider command, and reconciles the result automatically." accentClass="text-[#00ff87]">
        <div className="mt-7 grid grid-cols-3 gap-2">
          {[
            ['Signal', 'Verified'],
            ['Plan', 'AI-ready'],
            ['Dispatch', 'Live'],
            ['Receipt', 'Matched'],
            ['Reconcile', 'Running'],
            ['Outcome', 'Confirmed'],
          ].map(([label, state]) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5">
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#86f4bd]">{label}</p>
              <p className="mt-1 text-[11px] font-semibold text-white">{state}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-[#00ff87]/25 bg-[#00ff87]/[0.06] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#86f4bd]">Current execution</p>
          <p className="mt-2 text-sm font-semibold text-white">Recovery link dispatched</p>
          <p className="mt-1 text-xs leading-5 text-neutral-300">Razorpay receipt accepted · callback reconciliation in progress</p>
        </div>
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

      <div style={{ position: 'absolute', inset: '30px 48px 32px', zIndex: 20 }}>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }} transition={{ delay: 0.2, duration: 0.55 }}>
          <div className="inline-flex items-center gap-2.5 rounded-full border border-[#00ff87]/30 bg-[#00ff87]/10 px-4 py-1.5 backdrop-blur-xl shadow-[0_0_20px_rgba(0,255,135,0.16)]">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00ff87] opacity-70" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#00ff87]" /></span>
            <span className="font-mono text-xs font-bold tracking-widest text-[#86f4bd]">04 / 04</span>
            <span className="text-neutral-500">•</span>
            <span className="text-[11px] font-semibold text-neutral-200">What happens here</span>
          </div>
          <div className="mt-4 flex items-end justify-between gap-8">
            <div>
              <h1 style={{ fontFamily: 'var(--font-jakarta)', fontSize: '42px', fontWeight: 300, color: '#ffffff', margin: 0, lineHeight: 1.05 }}><BlurFadeWords text="How money gets recovered, step by step." baseDelay={0.35} isInView={isInView} /></h1>
              <p className="mt-2 text-[15px] font-light text-neutral-300">What it does: Checks the incident, picks a safe action, sends it, and confirms it worked — all logged.</p>
            </div>
            <div className="mb-1 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-right backdrop-blur-xl">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-500">Execution state</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-[#86f4bd]"><BadgeCheck className="h-3.5 w-3.5" /> Provider connected</p>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }} transition={{ delay: 0.5, duration: 0.55 }} className="relative mt-5 grid grid-cols-6 gap-2">
          <div className="absolute left-[7%] right-[7%] top-[19px] h-px bg-gradient-to-r from-[#00ff87]/20 via-[#00ff87]/65 to-[#00ff87]/20" />
          {[
            ['1. Signal', Database, 'Got event'],
            ['2. Plan', Bot, 'AI checks'],
            ['3. Safety', ShieldCheck, 'Rule passed'],
            ['4. Example', Send, 'Illustrative dispatch'],
            ['5. Proof', CreditCard, 'Payment seen'],
            ['6. Done', BadgeCheck, 'You see result'],
          ].map(([label, Icon, state], index) => {
            const StageIcon = Icon as typeof Database
            return <div key={label as string} className="relative z-10 rounded-xl border border-white/10 bg-[#101218]/90 px-2.5 py-2.5 text-center backdrop-blur-xl">
              <div className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full border ${index < 4 ? 'border-[#00ff87]/35 bg-[#00ff87]/10 text-[#86f4bd]' : 'border-white/15 bg-white/[0.05] text-neutral-200'}`}><StageIcon className="h-4 w-4" /></div>
              <p className="mt-1.5 text-[10px] font-bold text-white">{label as string}</p>
              <p className="mt-0.5 text-[9px] text-neutral-500">{state as string}</p>
            </div>
          })}
        </motion.div>

        <div className="mt-4 grid grid-cols-[1.14fr_.86fr] gap-4">
          <motion.div initial={{ opacity: 0, x: -18 }} animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -18 }} transition={{ delay: 0.72, duration: 0.55 }} className="relative overflow-hidden rounded-2xl border border-[#00ff87]/25 bg-[#090d0e]/90 p-5 shadow-[0_18px_45px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
            <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-[#00ff87]/[0.07] blur-3xl" />
            <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#86f4bd]">Illustrative example</p><p className="mt-1 text-lg font-semibold text-white">A payment reminder email could be prepared</p></div><span className="rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-1 text-[10px] font-bold text-neutral-300">Example</span></div>
            <div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5"><p className="text-[9px] uppercase tracking-wider text-neutral-500">How</p><p className="mt-1 text-xs font-semibold text-white">New link + email</p></div><div className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5"><p className="text-[9px] uppercase tracking-wider text-neutral-500">Amount</p><p className="mt-1 text-xs font-semibold text-white">₹1,250</p></div><div className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5"><p className="text-[9px] uppercase tracking-wider text-neutral-500">Proof ID</p><p className="mt-1 font-mono text-[10px] font-semibold text-[#86f4bd]">ps:8a2f…</p></div></div>
            <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3 text-[11px] text-neutral-400"><Webhook className="h-3.5 w-3.5 text-[#86f4bd]" /><span>How you know: A unique ID links the email to the later payment — no guesswork.</span></div>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 18 }} animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: 18 }} transition={{ delay: 0.84, duration: 0.55 }} className="rounded-2xl border border-white/10 bg-[#090a0f]/90 p-4 shadow-[0_18px_45px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
            <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-300">How we confirm it worked</p><p className="mt-1 text-sm font-semibold text-white">We wait for real proof, not assumptions.</p></div><RefreshCw className="h-4 w-4 text-sky-300" /></div>
            <div className="mt-3 space-y-2">
              {[['Provider response', 'Example receipt only', 'text-[#86f4bd]'], ['Customer paid?', 'Example awaiting proof', 'text-amber-200'], ['Result shown', 'Only after payment proof', 'text-neutral-300']].map(([label, value, accent]) => <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2"><span className="text-[10px] text-neutral-400">{label}</span><span className={`text-[10px] font-semibold ${accent}`}>{value}</span></div>)}
            </div>
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }} transition={{ delay: 0.98, duration: 0.5 }} className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-3 backdrop-blur-2xl">
          <div className="flex items-center gap-5"><div><p className="text-[10px] uppercase tracking-[0.15em] text-neutral-500">What this means for you</p><p className="mt-0.5 text-xs font-semibold text-white">You don’t do it — you see what was done and why.</p></div><div className="h-7 w-px bg-white/10" /><p className="text-[11px] text-neutral-400">Every step is saved in an audit trail you can inspect.</p></div>
          <button type="button" onClick={onOpenDashboard} className="flex shrink-0 items-center gap-2 rounded-xl bg-[#00ff87] px-4 py-2.5 text-xs font-bold text-black shadow-[0_0_20px_rgba(0,255,135,0.25)] hover:bg-[#00ff87]/90">Open Dashboard <ArrowRight className="h-3.5 w-3.5" /></button>
        </motion.div>
      </div>

      {/* Network Lines */}
      <div style={{ position: 'absolute', left: '35px', bottom: '-25px', width: '570px', height: '358px', zIndex: 10, pointerEvents: 'none', opacity: 0.24 }}>
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
