import { useState } from 'react'
import { CreditCard, Loader2 } from 'lucide-react'
import { paymentOpsApi, paymentOpsPath, getApiErrorMessage } from '../../api'

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, handler: (response: Record<string, unknown>) => void) => void }
  }
}

export function CheckoutButton({ onSuccess }: { onSuccess?: () => void }) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const handlePay = async () => {
    if (typeof window.Razorpay === 'undefined') {
      setMessage('Razorpay checkout.js not loaded. Check your connection and refresh.')
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const orderRes = await paymentOpsApi.post(paymentOpsPath('/api/create-order'), {
        amount: 50000,
        currency: 'INR',
        receipt: `payscope_test_${Date.now()}`,
      })
      if (!orderRes.data?.success) throw new Error('Order creation failed')
      const data = orderRes.data.data as { order_id?: string; amount?: number; currency?: string }
      if (!data.order_id || !data.amount || !data.currency) throw new Error('Invalid order response from server')
      const { order_id, amount, currency } = data

      const keyId = (import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined)?.trim() || ''
      if (!keyId) throw new Error('VITE_RAZORPAY_KEY_ID is not set in frontend env')

      let verifyLoading = false
      const options = {
        key: keyId,
        amount,
        currency,
        name: 'PayScope Test Payment',
        description: 'Test the Razorpay → PayScope webhook flow',
        order_id,
        handler: async (response: Record<string, unknown>) => {
          if (verifyLoading) return
          verifyLoading = true
          setMessage('Verifying payment…')
          try {
            const verifyRes = await paymentOpsApi.post(paymentOpsPath('/api/verify-payment'), {
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature,
            })
            if (verifyRes.data?.success) {
              setMessage('Payment verified ✓ — incident will appear below when webhook delivers (check Razorpay dashboard if using ngrok).')
              onSuccess?.()
              // Poll for new incident after webhook (Razorpay webhooks are async)
              setTimeout(() => onSuccess?.(), 2000)
            } else {
              setMessage('Payment succeeded but verification failed.')
            }
          } catch (err) {
            setMessage(getApiErrorMessage(err, 'Verification failed.'))
          } finally {
            verifyLoading = false
          }
        },
        modal: {
          ondismiss: () => setMessage('Payment cancelled by user.'),
        },
        theme: { color: '#00ff87' },
      }

      const rzp = new window.Razorpay(options)
      rzp.on('payment.failed', (resp: Record<string, unknown>) => {
        const err = (resp.error as Record<string, unknown> | undefined)?.description as string | undefined
        setMessage(err ? `Payment failed: ${err}` : 'Payment failed — incident will show as payment.failed if webhook delivered.')
        onSuccess?.()
      })
      rzp.open()
    } catch (err) {
      setMessage(getApiErrorMessage(err, 'Unable to start checkout. Check backend Razorpay keys and VITE_RAZORPAY_KEY_ID.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-white/[.08] bg-white/[.025] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-white">Test the webhook flow</p>
          <p className="mt-1 text-[10px] leading-relaxed text-neutral-400">Creates a real Razorpay order (₹500) → pay in the modal → PayScope ingests the webhook as an incident.</p>
        </div>
        <span className="hidden rounded-full border border-[#00ff87]/20 bg-[#00ff87]/10 px-2 py-1 text-[9px] font-bold text-[#00ff87] sm:inline">Standard Checkout</span>
      </div>
      <button
        type="button"
        onClick={() => void handlePay()}
        disabled={loading}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#00ff87] px-4 py-2.5 text-xs font-bold text-black hover:bg-[#00ff87]/90 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        {loading ? 'Creating order…' : 'Pay ₹500 — Test Checkout'}
      </button>
      {message && <p className="mt-2 text-center text-[10px] leading-relaxed text-neutral-300">{message}</p>}
      <p className="mt-2 text-center text-[9px] text-neutral-500">Uses <code className="rounded bg-white/10 px-1">rzp_test_TSXueffluCURvO</code> — Razorpay test cards only.</p>
    </div>
  )
}
