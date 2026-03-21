import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env file if it exists (simple parser, no dependency needed)
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// Resolve DB path relative to the project root (where package.json lives), not CWD
const projectRoot = resolve(new URL('..', import.meta.url).pathname);

export const config = {
  graphqlUrl:
    process.env.APTOS_GRAPHQL_URL ||
    'https://api.mainnet.aptoslabs.com/v1/graphql',
  apiKey: process.env.APTOS_API_KEY || '',
  dbPath: process.env.DB_PATH || resolve(projectRoot, 'aptos-tracker.db'),
  port: parseInt(process.env.PORT || '3000', 10),
  batchSize: 100,
  rateLimitMs: 200,
};
