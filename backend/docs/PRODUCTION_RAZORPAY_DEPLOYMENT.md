# PayScope — Razorpay Test Mode deployment (Vercel single repo)

This repo is **single** (`backend/` + `frontend/`). Deploy `frontend/` on **Vercel**; deploy `backend/` as Vercel serverless functions or a standalone Node service behind HTTPS. Legacy Intent Canvas repos are separate.

```env
PORT=25655
NODE_ENV=production
REQUIRE_API_AUTH=true
API_ACCESS_TOKEN=<long-random-token>
CORS_ORIGINS=https://payscope.vercel.app
PAYMENT_OPS_PUBLIC_URL=https://payscope-api.vercel.app

RAZORPAY_ENVIRONMENT=test
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=<test-mode-secret>
RAZORPAY_WEBHOOK_SECRET=<32-plus-random-characters>

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
```

If using a standalone VM, bind Node to `127.0.0.1:25655` and expose Nginx on 80/443. On Vercel, set the env vars in the project dashboard.

## Razorpay configuration

1. In Razorpay Dashboard, switch to **Test Mode**.
2. Add `https://payscope-api.vercel.app/webhooks/razorpay` under **Accounts & Settings → Webhooks**.
3. Set a unique webhook secret and store it only in `RAZORPAY_WEBHOOK_SECRET`.
4. Enable the project event set: payment failed/authorized/captured, order paid, refund created/failed, dispute created, and the selected subscription events.
5. Send a Test Mode transaction and confirm the PayScope dashboard receives a verified event.

Razorpay requires public webhook URLs and separate Test and Live Mode configuration. Do not put live keys on this test deployment.

## Launch blockers for live traffic

- Apply both Supabase migrations and verify backup/restore.
- Replace the browser access-token gate with real user authentication and tenant scoping.
- Add queue-backed webhook processing and cross-instance replay protection.
- Configure alerts for webhook signature failure, provider failure, import failure, and database failure.
- Perform a live-mode webhook verification with separate live keys and a rollback plan.
- Keep the operator approval boundary until a compliant, auditable external-action workflow exists.
