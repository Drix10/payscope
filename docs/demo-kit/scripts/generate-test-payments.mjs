import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');

function loadEnv() {
    const result = {};
    if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf8').split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex > 0) {
                const key = trimmed.slice(0, eqIndex).trim();
                let val = trimmed.slice(eqIndex + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                result[key] = val;
            }
        }
    }
    return result;
}

function updateEnv(updates) {
    if (!fs.existsSync(envPath)) return;
    let content = fs.readFileSync(envPath, 'utf8');
    for (const [key, val] of Object.entries(updates)) {
        if (!val) continue;
        const regex = new RegExp(`^#?\\s*${key}=.*$`, 'm');
        if (regex.test(content)) {
            content = content.replace(regex, `${key}=${val}`);
        } else {
            content += `\n${key}=${val}`;
        }
    }
    fs.writeFileSync(envPath, content, 'utf8');
}

const env = loadEnv();
const keyId = env.PAYSCOPE_DEMO_RAZORPAY_KEY_ID || process.env.PAYSCOPE_DEMO_RAZORPAY_KEY_ID;
const keySecret = env.PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET || process.env.PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET;

async function createPaymentLink(amount = 125000) {
    const referenceId = `ps_${crypto.randomBytes(16).toString('hex')}`;
    const authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
    const res = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
        },
        body: JSON.stringify({
            amount,
            currency: 'INR',
            reference_id: referenceId,
            description: 'PayScope Autonomous Recovery Test Link',
            notify: { sms: false, email: false },
            reminder_enable: false,
        }),
    });
    const data = await res.json();
    return { data, referenceId };
}

async function fetchRecentPayments() {
    const authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
    const res = await fetch('https://api.razorpay.com/v1/payments?count=10', {
        method: 'GET',
        headers: { Authorization: authHeader },
    });
    return res.json();
}

async function main() {
    console.log('=== PayScope Real Razorpay Test Asset Generator ===\n');

    if (!keyId || !keySecret || !keyId.startsWith('rzp_test_')) {
        console.log('⚠️  PAYSCOPE_DEMO_RAZORPAY_KEY_ID and PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET must be set in docs/demo-kit/.env');
        console.log('    Add your Razorpay Test API keys (rzp_test_...) to generate real Payment Links and fetch payments.\n');
        return;
    }

    const envUpdates = {};

    try {
        console.log('1. Creating a real Razorpay Test Payment Link...');
        const { data: link, referenceId } = await createPaymentLink(125000);

        if (link && link.id) {
            console.log(`   ✔ Created Payment Link ID: ${link.id}`);
            console.log(`   ✔ Generated PayScope Reference: ${referenceId}`);
            console.log(`   👉 Payment Link Checkout URL: ${link.short_url || link.url}`);
            envUpdates.PAYSCOPE_DEMO_PAYMENT_LINK_REFERENCE = referenceId;
        } else {
            console.log('   ⚠️ Razorpay Payment Link creation response:', link);
        }
    } catch (err) {
        console.log('   ⚠️ Error creating Payment Link:', err.message);
    }

    try {
        console.log('\n2. Fetching recent test payments from Razorpay...');
        const paymentsData = await fetchRecentPayments();
        const payments = Array.isArray(paymentsData?.items) ? paymentsData.items : [];

        const failed = payments.find(p => p.status === 'failed');
        const captured = payments.find(p => p.status === 'captured');

        if (failed) {
            console.log(`   ✔ Found recent failed payment ID: ${failed.id}`);
            envUpdates.PAYSCOPE_DEMO_FAILED_PAYMENT_ID = failed.id;
        } else {
            console.log('   ℹ️  No recent failed payment found in Razorpay test account.');
        }

        if (captured) {
            console.log(`   ✔ Found recent captured payment ID: ${captured.id}`);
            envUpdates.PAYSCOPE_DEMO_CAPTURED_PAYMENT_ID = captured.id;
        } else {
            console.log('   ℹ️  No recent captured payment found in Razorpay test account.');
        }
    } catch (err) {
        console.log('   ⚠️ Error fetching payments:', err.message);
    }

    if (Object.keys(envUpdates).length > 0) {
        updateEnv(envUpdates);
        console.log('\n✔ Updated docs/demo-kit/.env with real Razorpay test IDs and PayScope reference.');
    }

    console.log('\nNext steps for demo recording:');
    console.log('1. Open the Payment Link Checkout URL printed above in your browser.');
    console.log('2. Complete a test payment (using Razorpay Test card / UPI details).');
    console.log('3. Run `npm run regen` again to auto-detect the captured payment ID and bind it to .env.');
    console.log('4. Launch Demo Operator Studio (`npm start`) to run signed webhooks and demonstrate real reconciliation!\n');
}

main().catch(err => {
    console.error('Generator error:', err);
});

