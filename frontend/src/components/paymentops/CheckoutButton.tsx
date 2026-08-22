import { useEffect, useRef, useState } from 'react'
import { CreditCard, Loader2 } from 'lucide-react'
import { paymentOpsApi, paymentOpsPath, getApiErrorMessage } from '../../api'

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, handler: (response: Record<string, unknown>) => void) => void }
  }
}

type CheckoutState = 'idle' | 'creating' | 'verifying' | 'success' | 'failed'
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export function CheckoutButton({ onSuccess }: { onSuccess?: () => void }) {
  const [state, setState] = useState<CheckoutState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const mounted = useRef(true)
  const busy = useRef(false)
  const verifyBusy = useRef(false)
  const pollTimer = useRef<number | null>(null)
  const orderController = useRef<AbortController | null>(null)
  const verifyController = useRef<AbortController | null>(null)

  useEffect(() => () => {
    mounted.current = false
    orderController.current?.abort()
    verifyController.current?.abort()
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
  }, [])

  const update = (nextState: CheckoutState, nextMessage: string | null) => {
    if (!mounted.current) return
    setState(nextState)
    setMessage(nextMessage)
  }

  const finish = (nextState: CheckoutState, nextMessage: string | null) => {
    busy.current = false
    verifyBusy.current = false
    orderController.current = null
    verifyController.current = null
    update(nextState, nextMessage)
  }

  const handlePay = async () => {
    if (busy.current) return
    if (!window.Razorpay) { update('failed', 'Razorpay Checkout is not loaded. Refresh the page and try again.'); return }
    const keyId = (import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined)?.trim() || ''
    if (!/^rzp_test_[A-Za-z0-9]+$/.test(keyId)) { update('failed', 'A valid Razorpay Test Mode key is not configured.'); return }

    busy.current = true
    update('creating', null)
    const controller = new AbortController()
    orderController.current = controller
    try {
      const orderRes = await paymentOpsApi.post(paymentOpsPath('/api/create-order'), { amount: 50000, currency: 'INR', receipt: `payscope_test_${(globalThis.crypto?.randomUUID?.() ?? String(Date.now()))}` }, { signal: controller.signal })
      const data = orderRes.data?.data as Record<string, unknown> | undefined
      if (orderRes.data?.success !== true || !data || !isText(data.order_id) || !Number.isSafeInteger(data.amount) || Number(data.amount) < 100 || data.currency !== 'INR') throw new Error('The server returned an invalid Razorpay order.')
      const { order_id: orderId, amount, currency } = data
      update('creating', 'Opening secure Razorpay checkout…')

      const settle = (nextState: CheckoutState, nextMessage: string | null) => finish(nextState, nextMessage)
      const options: Record<string, unknown> = {
        key: keyId,
        amount,
        currency,
        name: 'PayScope Test Payment',
        description: 'Test the Razorpay → PayScope webhook flow',
        order_id: orderId,
        handler: async (response: Record<string, unknown>) => {
          if (verifyBusy.current) return
          if (!isText(response.razorpay_payment_id) || !isText(response.razorpay_order_id) || !isText(response.razorpay_signature)) { settle('failed', 'Razorpay returned an incomplete payment response.'); return }
          verifyBusy.current = true
          update('verifying', 'Verifying payment…')
          const verify = new AbortController()
          verifyController.current = verify
          try {
            const verifyRes = await paymentOpsApi.post(paymentOpsPath('/api/verify-payment'), { razorpay_payment_id: response.razorpay_payment_id, razorpay_order_id: response.razorpay_order_id, razorpay_signature: response.razorpay_signature }, { signal: verify.signal })
            if (verifyRes.data?.success !== true) throw new Error('Payment verification failed.')
            settle('success', 'Payment verified. The incident will appear after Razorpay delivers the webhook.')
            onSuccess?.()
            pollTimer.current = window.setTimeout(() => { pollTimer.current = null; if (mounted.current) onSuccess?.() }, 2_000)
          } catch (error) {
            if (!verify.signal.aborted) settle('failed', getApiErrorMessage(error, 'Payment verification failed.'))
          }
        },
        modal: { ondismiss: () => { if (busy.current && !verifyBusy.current) settle('failed', 'Payment cancelled by user.') } },
        theme: { color: '#00ff87' },
      }
      const razorpay = new window.Razorpay(options)
      razorpay.on('payment.failed', (response: Record<string, unknown>) => { const error = response.error as Record<string, unknown> | undefined; settle('failed', isText(error?.description) ? `Payment failed: ${error.description}` : 'Payment failed. The incident will appear if Razorpay delivers the webhook.') })
      razorpay.open()
    } catch (error) {
      if (!controller.signal.aborted) finish('failed', getApiErrorMessage(error, 'Unable to start checkout. Check the backend Razorpay configuration.'))
    }
  }

  const busyState = state === 'creating' || state === 'verifying'
  return <div className="rounded-2xl border border-white/[.08] bg-white/[.025] p-4">
    <div className="flex items-center justify-between"><div><p className="text-xs font-bold text-white">Test the webhook flow</p><p className="mt-1 text-[10px] leading-relaxed text-neutral-400">Creates a Razorpay Test Mode order, then waits for the verified webhook signal.</p></div><span className="hidden rounded-full border border-[#00ff87]/20 bg-[#00ff87]/10 px-2 py-1 text-[9px] font-bold text-[#00ff87] sm:inline">Test Mode</span></div>
    <button type="button" onClick={() => void handlePay()} disabled={busyState} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#00ff87] px-4 py-2.5 text-xs font-bold text-black transition-colors hover:bg-[#00ff87]/90 disabled:cursor-not-allowed disabled:opacity-50"><span>{busyState ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}</span>{state === 'creating' ? 'Opening checkout…' : state === 'verifying' ? 'Verifying payment…' : 'Pay ₹500 — Test Checkout'}</button>
    {message && <p role="status" aria-live="polite" className={`mt-2 text-center text-[10px] leading-relaxed ${state === 'failed' ? 'text-rose-200' : state === 'success' ? 'text-[#b8ffd9]' : 'text-neutral-300'}`}>{message}</p>}
    <p className="mt-2 text-center text-[9px] text-neutral-500">Uses Razorpay Test Mode keys and test cards only.</p>
  </div>
}
