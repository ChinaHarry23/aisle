import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// The secret is generated in memory, never written into a file or printed.
const workflowPort = process.env.AISLE_WORKFLOW_PORT || '4171';
const env = { ...process.env, AISLE_WORKFLOW_PORT: workflowPort, AISLE_WORKFLOW_SECRET: process.env.AISLE_WORKFLOW_SECRET || randomBytes(32).toString('hex'), AISLE_WORKFLOW_URL: process.env.AISLE_WORKFLOW_URL || `http://127.0.0.1:${workflowPort}` };
const node = process.execPath;
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 5000).unref();
}
for (const args of [
  ['--env-file-if-exists=.env.local', '--import', './scripts/service-loader.mjs', '--experimental-strip-types', 'services/workflow/api.ts', '--serve'],
  ['--env-file-if-exists=.env.local', '--import', './scripts/service-loader.mjs', '--experimental-strip-types', 'services/workflow/worker.ts', '--work'],
  ['--env-file-if-exists=.env.local', '--import', './scripts/service-loader.mjs', '--experimental-strip-types', 'services/media/worker.ts', '--work'],
  ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', process.env.AISLE_WEB_PORT || '4003'],
]) {
  const child = spawn(node, args, { env, stdio: 'inherit' });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
