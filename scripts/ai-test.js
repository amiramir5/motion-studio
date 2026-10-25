import 'dotenv/config';
import { aiConfigured, getHealth, testConnection } from '../server/ai.js';

const health = await getHealth();
if (!health.configured) {
  console.log('No key configured.');
  console.log('Add GEMINI_API_KEY=... to .env, then run: npm run ai:test');
  process.exit(1);
}

console.log(`models ok: ${health.ok} (${health.latencyMs}ms)`);
if (!health.ok) console.log(`error: ${health.error}`);
console.log(`default model: ${health.defaultModel}`);
console.log(`models visible: ${health.modelCount}`);

const result = await testConnection('');
if (result.ok) {
  console.log(`live test: OK in ${result.latencyMs}ms · ${result.model} · reply "${result.reply}"`);
} else {
  console.log('live test: FAILED');
  process.exit(1);
}
