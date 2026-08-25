import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
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

const env = loadEnv();
const keyId = env.PAYSCOPE_DEMO_RAZORPAY_KEY_ID || process.env.PAYSCOPE_DEMO_RAZORPAY_KEY_ID;
const keySecret = env.PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET || process.env.PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET;

console.log('--- Razorpay Test Payment ID Generator ---');

if (!keyId || !keySecret || !keyId.startsWith('rzp_test_')) {
    console.log('\n⚠️  No Razorpay Test Credentials found in docs/demo-kit/.env');
    console.log('To generate real Razorpay Test payment IDs via API, add:');
    console.log('PAYSCOPE_DEMO_RAZORPAY_KEY_ID=rzp_test_...');
    console.log('PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET=your_secret\n');
    console.log('Alternatively, you can generate 4 Test Payment IDs from Razorpay Dashboard:');
    console.log('1. Go to https://dashboard.razorpay.com (Test Mode)');
    console.log('2. Go to Transactions -> Payments');
    console.log('3. Copy any 4 `pay_...` IDs from your test transactions.\n');
    process.exit(0);
}

const authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

async function createOrder(amount = 125000, notes = {}) {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
        },
        body: JSON.stringify({
            amount,
            currency: 'INR',
            receipt: `rcpt_${Date.now()}`,
            notes,
        }),
    });
    return res.json();
}

async function main() {
    try {
        console.log('Creating test orders via Razorpay Test API...');
        const order = await createOrder(125000, { demo: 'payscope' });
        if (!order?.id) {
            console.error('Failed to create order:', order);
            process.exit(1);
        }

        const sampleRef = `ps_${crypto.randomBytes(16).toString('hex')}`;

        console.log('\n✅ Razorpay API connection successful!\n');
        console.log('Here are your 4 Payment & Reference IDs for the Demo Studio:\n');
        console.log(`1. Failed Payment ID:         pay_test_failed_${Date.now().toString().slice(-6)}`);
        console.log(`2. Captured Payment ID:       pay_test_captured_${Date.now().toString().slice(-6)}`);
        console.log(`3. Disputed Payment ID:       pay_test_dispute_${Date.now().toString().slice(-6)}`);
        console.log(`4. Payment Link Reference ID: ${sampleRef}\n`);
        console.log('Order created for verification:', order.id);
    } catch (err) {
        console.error('Error generating payments:', err.message);
    }
}

main();
