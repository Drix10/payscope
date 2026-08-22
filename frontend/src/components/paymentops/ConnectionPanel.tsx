import { Check, Copy, Database, KeyRound, LucideIcon, Radio, RefreshCw, ServerCog } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ConnectionStatus } from '../../types/paymentOps'

export function ConnectionPanel({ connection, importing, historyProgress, onImport }: { connection: ConnectionStatus | null; importing: boolean; historyProgress: { days: number; nextSkip: number } | null; onImport: (days: number, skip?: number) => void }) {
  const [copied, setCopied] = useState(false)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const copiedTimer = useRef<number | null>(null)
  useEffect(() => () => { if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current) }, [])
  const copy = async () => {
    if (!connection?.webhookUrl) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(connection.webhookUrl)
      } else {
        const el = document.createElement('textarea')
        el.value = connection.webhookUrl
        el.setAttribute('readonly', '')
        el.style.position = 'absolute'
        el.style.left = '-9999px'
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      setCopied(true)
      setCopyMessage('Webhook URL copied')
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => { setCopied(false); setCopyMessage(null); copiedTimer.current = null }, 1_600)
    } catch {
      setCopied(false)
      setCopyMessage('Copy failed — select and copy manually')
    }
  }
  const continuation = historyProgress?.days === 30 ? historyProgress : null
  return <section className="rounded-2xl border border-sky-300/20 bg-gradient-to-br from-sky-300/[.08] via-[#090a0f] to-[#00ff87]/[.05] p-4"><div className="flex items-start gap-2.5"><div className="rounded-xl border border-sky-300/25 bg-sky-300/10 p-2 text-sky-100"><Radio className="h-4 w-4" /></div><div><p className="text-xs font-bold text-white">Razorpay connection</p><p className="mt-0.5 text-[11px] leading-relaxed text-neutral-400">The dashboard only displays verified server-side payment signals.</p></div></div><div className="mt-3 grid grid-cols-3 gap-1.5"><Status ready={Boolean(connection?.webhookSecretConfigured)} label="Webhook signature" icon={KeyRound} /><Status ready={Boolean(connection?.historyImportAvailable)} label="History import" icon={ServerCog} /><Status ready={Boolean(connection?.databaseConfigured)} label="Durable storage" icon={Database} /></div><div className="mt-3"><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-neutral-400">Webhook endpoint</p><div className="flex gap-2"><button type="button" onClick={copy} title="Copy Razorpay webhook endpoint" disabled={!connection?.webhookUrl} className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-black/25 px-2.5 py-2 text-left font-mono text-[10px] text-neutral-300 disabled:opacity-50">{connection?.webhookUrl || 'Set PAYMENT_OPS_PUBLIC_URL on the server'}</button><button type="button" onClick={copy} aria-label="Copy webhook endpoint" disabled={!connection?.webhookUrl} className="rounded-xl border border-sky-300/25 bg-sky-300/10 px-2.5 text-sky-100 disabled:opacity-50">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</button></div>{copyMessage && <p role="status" aria-live="polite" className="mt-1.5 text-[10px] text-sky-100">{copyMessage}</p>}</div><p className="mt-2 rounded-xl border border-white/[.08] bg-black/15 px-2.5 py-2 text-[10px] leading-relaxed text-neutral-400">Configure this endpoint in Razorpay <strong className="text-neutral-200">Test Mode</strong> and save its signing secret as <code className="rounded bg-white/10 px-1 text-sky-100">RAZORPAY_WEBHOOK_SECRET</code> on the server.</p><div className="mt-3"><button type="button" onClick={() => onImport(30, continuation?.nextSkip)} disabled={!connection?.historyImportAvailable || importing} className="w-full rounded-xl border border-[#00ff87]/30 bg-[#00ff87]/10 px-3 py-2 text-[11px] font-bold text-[#b8ffd9] hover:bg-[#00ff87]/20 disabled:cursor-not-allowed disabled:opacity-50">{importing ? <><RefreshCw className="mr-1 inline h-3.5 w-3.5 animate-spin" />Importing</> : continuation ? 'Continue 30-day import' : 'Import last 30 days'}</button></div></section>
}

function Status({ ready, label, icon: Icon }: { ready: boolean; label: string; icon: LucideIcon }) { return <div className={`rounded-xl border p-2 text-center ${ready ? 'border-[#00ff87]/20 bg-[#00ff87]/[.07] text-[#b8ffd9]' : 'border-white/[.08] bg-black/15 text-neutral-500'}`}><Icon className="mx-auto h-3.5 w-3.5" /><p className="mt-1 text-[9px] font-semibold leading-tight">{label}</p><p className="mt-0.5 text-[9px] opacity-75">{ready ? 'Ready' : 'Needs setup'}</p></div> }
