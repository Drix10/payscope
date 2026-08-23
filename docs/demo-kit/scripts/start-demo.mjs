import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiServerScript = path.join(projectRoot, 'scripts', 'ui-server.mjs');

console.log('Launching PayScope Demo Operator Studio UI...');
const child = spawn(process.execPath, [uiServerScript], { cwd: projectRoot, env: process.env, stdio: 'inherit' });
child.on('error', err => {
    console.error('Failed to start UI server:', err);
    process.exit(1);
});
