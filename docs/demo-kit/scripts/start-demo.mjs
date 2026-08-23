import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...await loadEnv(path.join(projectRoot, '.env')), ...process.env };
const pauseMs = env.PAYSCOPE_DEMO_PAUSE_MS ?? '4000';
const stages = [
    ['preflight', 'scripts/demo-preflight.mjs', []],
    ['demo sequence', 'scripts/run-demo.mjs', ['--pause-ms', pauseMs]],
    ['verification', 'scripts/verify-demo.mjs', []],
];

if (env.PAYSCOPE_DEMO_RAZORPAY_ENVIRONMENT !== 'test') {
    throw new Error('Standalone demo-kit refuses to start unless PAYSCOPE_DEMO_RAZORPAY_ENVIRONMENT=test');
}
console.log('PayScope demo-kit: local runner -> deployed API -> production projections');
for (const [name, script, args] of stages) {
    console.log(`\n[demo-kit] ${name}`);
    const exitCode = await run(path.join(projectRoot, script), args, env);
    if (exitCode !== 0) throw new Error(`${name} failed with exit code ${exitCode}`);
}
console.log('\n[demo-kit] complete: open the deployed frontend and show the resulting incident ledger.');

async function loadEnv(filePath) {
    let source;
    try { source = await readFile(filePath, 'utf8'); }
    catch (error) {
        if (error.code === 'ENOENT') throw new Error('docs/demo-kit/.env is missing; copy .env.example to .env and fill the demo values');
        throw error;
    }
    const values = {};
    for (const line of source.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
        if (!match || match[2].trimStart().startsWith('#')) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        values[match[1]] = value;
    }
    return values;
}

function run(script, args, childEnv) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, ...args], { cwd: projectRoot, env: childEnv, stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', code => resolve(code ?? 1));
    });
}
