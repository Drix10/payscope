import { useState } from 'react'
import { Bot, Plus, Shield, Trash2 } from 'lucide-react'
import { AutoPolicy, ActionType } from '../../types/paymentOps'

const money = (paise: number | null) => {
  if (paise === null || !Number.isFinite(paise)) return 'No cap'
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100) } catch { return `₹${(paise / 100).toFixed(0)}` }
}

export function PolicyPanel({ policies, onToggle, onDelete, onCreate, busy }: {
  policies: AutoPolicy[]
  onToggle: (p: AutoPolicy) => void
  onDelete: (id: string) => void
  onCreate: (draft: Partial<AutoPolicy> & { name: string; action: ActionType }) => void
  busy: boolean
}) {
  const [formError, setFormError] = useState<string | null>(null)
  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setFormError(null)
    const form = e.currentTarget
    const fd = new FormData(form)
    const name = String(fd.get('name') || '').trim()
    const action = String(fd.get('action') || 'monitor') as ActionType
    let minConfidence = Number(fd.get('minConfidence') || 0.8)
    if (!Number.isFinite(minConfidence)) minConfidence = 0.8
    minConfidence = Math.min(1, Math.max(0, minConfidence))
    const maxAmountRaw = String(fd.get('maxAmount') || '').trim()
    let maxAmountPaise: number | null = null
    if (maxAmountRaw) {
      const rupees = Number(maxAmountRaw)
      if (!Number.isFinite(rupees) || rupees < 0 || rupees > 1_000_000) { setFormError('Max amount must be a number between 0 and 10,00,000.'); return }
      const paise = Math.round(rupees * 100)
      if (!Number.isSafeInteger(paise) || paise < 0) { setFormError('Max amount is too large.'); return }
      maxAmountPaise = paise
    }
    const incidentTypes = (fd.getAll('incidentTypes') as string[]) as AutoPolicy['incidentTypes']
    const severities = (fd.getAll('severities') as string[]) as AutoPolicy['severities']
    if (!name) { setFormError('Policy name is required.'); return }
    if (!action) { setFormError('Action is required.'); return }
    if (action === 'dismiss' && (maxAmountPaise === null || maxAmountPaise > 100_000 || severities.includes('critical') || severities.includes('high') || severities.length === 0)) {
      setFormError('Auto-dismiss is only allowed for low/medium severities with a cap ≤ ₹1000.')
      return
    }
    onCreate({ name, action, minConfidence, maxAmountPaise, incidentTypes, severities, enabled: true })
    form.reset()
  }

  return <section className="rounded-2xl border border-white/[.09] bg-[#090a0f]/80 p-4">
    <div className="flex items-start gap-2.5">
      <div className="rounded-xl border border-[#00ff87]/25 bg-[#00ff87]/10 p-2 text-[#00ff87]"><Bot className="h-4 w-4" /></div>
      <div className="flex-1">
        <h2 className="text-xs font-bold text-white">Autonomy policies</h2>
        <p className="mt-0.5 text-[10px] leading-relaxed text-neutral-400">Admin sets thresholds once. Agent auto-executes only when confidence, severity and amount are within bounds. Nothing contacts Razorpay beyond what the policy allows.</p>
      </div>
      <span className="rounded-full border border-white/10 bg-white/[.04] px-2 py-1 text-[9px] font-semibold text-neutral-300">{policies.filter(p=>p.enabled).length}/{policies.length} active</span>
    </div>

    <div className="mt-4 space-y-2">
      {policies.length === 0 && <p className="rounded-xl border border-dashed border-white/10 p-3 text-[10px] text-neutral-500">No policies yet. Create one below.</p>}
      {policies.map(p => <div key={p.policyId} className={`rounded-xl border p-3 ${p.enabled ? 'border-[#00ff87]/20 bg-[#00ff87]/[0.04]' : 'border-white/[.08] bg-black/15 opacity-80'}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold text-white">{p.name}</p>
            <p className="mt-0.5 text-[10px] text-neutral-400">{p.incidentTypes.length ? p.incidentTypes.join(', ') : 'all types'} · {p.severities.length ? p.severities.join(', ') : 'all severities'} · ≥{Math.round(p.minConfidence*100)}% · {money(p.maxAmountPaise)} · <span className="text-[#b8ffd9]">{p.action}</span></p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => onToggle(p)} disabled={busy} className={`rounded-lg border px-2 py-1 text-[9px] font-bold ${p.enabled ? 'border-[#00ff87]/30 bg-[#00ff87] text-black' : 'border-white/10 bg-white/5 text-neutral-300'} disabled:opacity-50`}>{p.enabled ? 'On' : 'Off'}</button>
            <button type="button" onClick={() => onDelete(p.policyId)} disabled={busy} aria-label="Delete policy" className="rounded-lg border border-white/10 p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white disabled:opacity-50"><Trash2 className="h-3 w-3" /></button>
          </div>
        </div>
        {p.action==='escalate' && p.requireHumanForEscalate && <p className="mt-1 flex items-center gap-1 text-[9px] text-amber-200"><Shield className="h-3 w-3" />Escalations require human — policy will not auto-execute.</p>}
      </div>)}
    </div>

    <form onSubmit={handleCreate} className="mt-4 rounded-xl border border-white/[.08] bg-black/15 p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-bold text-white"><Plus className="h-3 w-3" />New policy</p>
      <input name="name" placeholder="Policy name" required maxLength={120} className="mt-2 w-full rounded-lg border border-white/10 bg-black/25 px-2.5 py-1.5 text-[11px] text-white placeholder:text-neutral-500" />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[10px] text-neutral-400">Action<select name="action" defaultValue="monitor" className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] text-white"><option value="monitor">monitor</option><option value="prepare_follow_up">prepare_follow_up</option><option value="review_payment_method">review_payment_method</option><option value="escalate">escalate</option><option value="dismiss">dismiss (capped ≤₹1000, low/med only)</option></select></label>
        <label className="text-[10px] text-neutral-400">Min confidence<input name="minConfidence" type="number" min={0} max={1} step={0.05} defaultValue={0.8} className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] text-white" /></label>
      </div>
      <label className="mt-2 block text-[10px] text-neutral-400">Max amount (₹, empty = no cap)<input name="maxAmount" type="number" min={0} max={1000000} placeholder="e.g. 1000" className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] text-white" /></label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <fieldset className="rounded-lg border border-white/10 p-2"><legend className="px-1 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Incident types (empty=all)</legend>{['payment_failure','refund_failure','payment_dispute','subscription_risk'].map(t=> <label key={t} className="mt-1 flex items-center gap-1.5 text-[10px] text-neutral-300"><input type="checkbox" name="incidentTypes" value={t} defaultChecked={t==='payment_failure'} className="h-3 w-3" />{t}</label>)}</fieldset>
        <fieldset className="rounded-lg border border-white/10 p-2"><legend className="px-1 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Severities (empty=all)</legend>{['low','medium','high','critical'].map(s=> <label key={s} className="mt-1 flex items-center gap-1.5 text-[10px] text-neutral-300"><input type="checkbox" name="severities" value={s} defaultChecked={s==='low' || s==='medium'} className="h-3 w-3" />{s}</label>)}</fieldset>
      </div>
      {formError && <p role="alert" className="mt-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-2.5 py-1.5 text-[10px] text-rose-200">{formError}</p>}
      <button type="submit" disabled={busy} className="mt-3 w-full rounded-lg bg-[#00ff87] px-3 py-1.5 text-[11px] font-bold text-black hover:bg-[#b8ffd9] disabled:opacity-50">Create policy</button>
    </form>
    <p className="mt-2 text-[9px] leading-relaxed text-neutral-500">Agent only auto-executes after an investigation. If confidence/amount/severity fail, incident stays for human. <code className="rounded bg-white/10 px-1">agent:policy/&lt;id&gt;</code> appears in audit trail for every auto-action.</p>
  </section>
}
