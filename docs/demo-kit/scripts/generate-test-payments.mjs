import fs from 'node:fs';
import path from 'node:path';
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

async function createOrder(amount = 125000, notes = {}) {
    const authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
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
    let orderId = null;
    if (keyId && keySecret && keyId.startsWith('rzp_test_')) {
        try {
            console.log('Creating test orders via Razorpay Test API...');
            const order = await createOrder(125000, { demo: 'payscope' });
            if (order?.id) {
                orderId = order.id;
            }
        } catch {
            // Ignore API network errors and proceed with valid test payload IDs
        }
    }

    console.log('\nDemo Test-order preparation complete.\n');
    if (orderId) {
        console.log('Razorpay API verification order:', orderId);
    }
    console.log('This script does not manufacture payment IDs or PayScope references. Enter a real failed/captured Test payment and a reference from an actual PayScope-created Payment Link before demonstrating reconciliation.');
}

main();
