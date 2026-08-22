import { Activity, ArrowRight, Bot, Database, Network, ShieldCheck, Sparkles, Workflow } from 'lucide-react'

type ShowcaseProps = { onOpenDashboard: () => void }

const sections = [
  {
    eyebrow: 'PAYMENT OPERATIONS, REBUILT',
    title: 'See the signal.\nKeep the control.',
    body: 'PayScope turns verified Test Mode payment events into reviewable incidents, with evidence, bounded AI, and a human approval gate.',
    icon: Sparkles,
    accent: 'mint',
    labels: ['Signed events', 'Tenant scoped', 'No financial execution'],
  },
  {
    eyebrow: 'ONE DURABLE PIPELINE',
    title: 'Every failure gets\na defensible trail.',
    body: 'Webhook receipt, enrichment, correlation, investigation, policy, and proposal are recorded as a trace—not a black-box dashboard guess.',
    icon: Network,
    accent: 'violet',
    labels: ['HMAC intake', 'Structured output', 'Append-only audit'],
  },
  {
    eyebrow: 'AGENTIC, WITH BOUNDARIES',
    title: 'Agents explain.\nPolicy decides.',
    body: 'The Supervisor, Risk Analyst, and Recovery Planner only receive bounded data. Deterministic rules stop fraud, disputes, unsafe outreach, and silent automation.',
    icon: Workflow,
    accent: 'blue',
    labels: ['Read-only tools', 'Human-review floor', 'Simulation only'],
  },
] as const

function ProductNavbar({ onOpenDashboard }: ShowcaseProps) {
  return <header className="fixed left-1/2 top-5 z-40 flex -translate-x-1/2 items-center">
    <div className="smoked-glass hairline-border flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-full px-3 py-2 shadow-2xl backdrop-blur-xl sm:gap-3 sm:px-5">
      <div className="flex shrink-0 items-center gap-2 border-r border-white/10 pr-2 sm:pr-3"><span className="rounded-full border border-[#00ff87]/30 bg-[#00ff87]/10 p-1 text-[#00ff87]"><Activity className="h-3.5 w-3.5" /></span><span className="text-xs font-bold tracking-tight text-white">PayScope</span><span className="hidden rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-200 sm:inline">Test</span></div>
      <span className="hidden text-[10px] font-semibold tracking-wide text-neutral-500 sm:block">Evidence-first operations</span>
      <button type="button" onClick={onOpenDashboard} className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-[#00ff87] px-3 py-1.5 text-[11px] font-bold text-black transition hover:bg-[#74ffb7] focus-visible:outline-none"><ShieldCheck className="h-3.5 w-3.5" /> Open dashboard</button>
    </div>
  </header>
}

function GridArt({ accent }: { accent: 'mint' | 'violet' | 'blue' | 'white' }) {
  const colors = { mint: '#00ff87', violet: '#906aff', blue: '#4c6dff', white: '#ffffff' }
  return <div aria-hidden="true" className="absolute inset-0 overflow-hidden"><div className="bg-obsidian-grid absolute inset-0 opacity-60" /><div className="absolute left-[15%] top-[20%] h-[32rem] w-[32rem] rounded-full blur-[110px]" style={{ background: colors[accent], opacity: .12 }} /><div className="absolute bottom-[12%] right-[12%] h-72 w-72 rounded-full blur-[100px]" style={{ background: colors[accent], opacity: .08 }} /><div className="absolute inset-x-[9%] top-1/2 h-px" style={{ background: `linear-gradient(90deg, transparent, ${colors[accent]}70, transparent)` }} /></div>
}

function SignalCanvas({ labels, accent }: { labels: readonly string[]; accent: 'mint' | 'violet' | 'blue' | 'white' }) {
  const colors = { mint: '#00ff87', violet: '#906aff', blue: '#4c6dff', white: '#ffffff' }
  const color = colors[accent]
  return <div className="relative mx-auto w-full max-w-[580px] rounded-[28px] border border-white/10 bg-[#090a0f]/80 p-3 shadow-2xl backdrop-blur-xl sm:p-5">
    <div className="absolute inset-0 rounded-[28px] opacity-60" style={{ background: `linear-gradient(125deg, ${color}24, transparent 35%, transparent 70%, ${color}14)` }} />
    <div className="relative min-h-[255px] overflow-hidden rounded-[20px] border border-white/[.08] bg-black/40 p-4 sm:min-h-[330px] sm:p-6">
      <div className="flex items-center justify-between"><span className="rounded-full border border-white/10 bg-white/[.04] px-2 py-1 text-[9px] font-bold uppercase tracking-[.15em] text-neutral-400">Live signal map</span><span className="h-2 w-2 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 18px ${color}` }} /></div>
      <div className="absolute left-[13%] right-[13%] top-[47%] h-px bg-white/[.12]" /><div className="absolute left-1/2 top-[20%] h-[55%] w-px bg-white/[.1]" />
      {labels.map((label, index) => <div key={label} className="absolute rounded-xl border border-white/[.1] bg-[#0b0d14]/95 px-3 py-2 text-[10px] font-semibold text-neutral-200 shadow-xl" style={{ left: index === 1 ? '56%' : index === 2 ? '30%' : '8%', top: index === 0 ? '31%' : index === 1 ? '58%' : '69%', borderColor: `${color}55` }}>{label}<span className="mt-1 block text-[9px] font-normal text-neutral-500">verified & bounded</span></div>)}
      <div className="absolute left-[46%] top-[42%] flex h-12 w-12 items-center justify-center rounded-2xl border bg-black" style={{ borderColor: `${color}80`, boxShadow: `0 0 35px ${color}33` }}><Bot className="h-5 w-5" style={{ color }} /></div>
    </div>
  </div>
}

function StorySection({ eyebrow, title, body, labels, accent, icon: Icon, index }: typeof sections[number] & { index: number }) {
  return <section id={`section-${index + 1}`} className="relative flex min-h-dvh snap-start items-center overflow-hidden bg-[#040406] px-5 py-28 text-white sm:px-8 lg:px-14">
    <GridArt accent={accent} />
    <div className={`relative mx-auto grid w-full max-w-[1320px] items-center gap-12 ${index % 2 ? 'lg:grid-cols-[1.05fr_.95fr]' : 'lg:grid-cols-[.95fr_1.05fr]'}`}>
      <div className={index % 2 ? 'lg:order-2' : ''}><div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/[.12] bg-white/[.04] px-3 py-1.5 text-[10px] font-bold tracking-[.15em] text-neutral-300"><Icon className="h-3.5 w-3.5" style={{ color: accent === 'mint' ? '#00ff87' : accent === 'violet' ? '#906aff' : '#4c6dff' }} /> {eyebrow}</div><h1 className="whitespace-pre-line text-4xl font-bold leading-[.98] tracking-[-.06em] sm:text-6xl lg:text-7xl">{title}</h1><p className="mt-6 max-w-xl text-base leading-7 text-neutral-400 sm:text-lg">{body}</p><div className="mt-8 flex flex-wrap gap-2">{labels.map(label => <span key={label} className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-[11px] font-semibold text-neutral-300">{label}</span>)}</div></div>
      <div className={index % 2 ? 'lg:order-1' : ''}><SignalCanvas labels={labels} accent={accent} /></div>
    </div>
  </section>
}

function FinalSection({ onOpenDashboard }: ShowcaseProps) {
  return <section id="section-4" className="relative flex min-h-dvh snap-start items-center overflow-hidden bg-[#040406] px-5 py-28 text-white sm:px-8 lg:px-14"><GridArt accent="white" /><div className="relative mx-auto grid w-full max-w-[1320px] items-center gap-12 lg:grid-cols-[.95fr_1.05fr]"><div><div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/[.12] bg-white/[.04] px-3 py-1.5 text-[10px] font-bold tracking-[.15em] text-neutral-300"><Database className="h-3.5 w-3.5 text-white" /> READY WHEN YOU ARE</div><h1 className="text-4xl font-bold leading-[.98] tracking-[-.06em] sm:text-6xl lg:text-7xl">From payment signal<br />to accountable action.</h1><p className="mt-6 max-w-xl text-base leading-7 text-neutral-400 sm:text-lg">Enter the dashboard to inspect the durable pipeline, evaluate an incident, approve only a simulated proposal, and verify the audit chain.</p><button type="button" onClick={onOpenDashboard} className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-black transition hover:bg-neutral-200"><ShieldCheck className="h-4 w-4" /> Explore the dashboard <ArrowRight className="h-4 w-4" /></button></div><SignalCanvas accent="white" labels={['Test Mode only', 'Proposal approval', 'Verified audit']} /></div></section>
}

export function Showcase({ onOpenDashboard }: ShowcaseProps) {
  return <main className="min-h-screen snap-y snap-mandatory overflow-y-auto bg-[#040406] text-white"><ProductNavbar onOpenDashboard={onOpenDashboard} />{sections.map((section, index) => <StorySection key={section.eyebrow} {...section} index={index} />)}<FinalSection onOpenDashboard={onOpenDashboard} /></main>
}
