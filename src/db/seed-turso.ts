#!/usr/bin/env tsx
/**
 * Seed Turso Database — Schema Only
 *
 * Ensures the Turso database schema is up to date.
 * Provider data is now populated by the agent-refresh pipeline
 * (npm run cron:agent-refresh -- --full).
 *
 * Usage:
 *   TURSO_WRITE_TOKEN=<token> npm run seed:turso
 */

import { createClient } from '@libsql/client';
import { SCHEMA } from './schema.js';

const TURSO_URL = process.env.TURSO_DATABASE_URL ?? 'libsql://api-broker-astein91.aws-us-west-2.turso.io';
const TURSO_TOKEN = process.env.TURSO_WRITE_TOKEN ?? process.env.TURSO_AUTH_TOKEN;

if (!TURSO_TOKEN) {
  console.error('Error: TURSO_WRITE_TOKEN or TURSO_AUTH_TOKEN is required');
  process.exit(1);
}

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
});

async function ensureSchema() {
  const statements = SCHEMA
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    await client.execute(stmt);
  }
  console.log('Schema ensured');
}

async function seed() {
  await ensureSchema();

  // Verify current state
  const result = await client.execute('SELECT COUNT(*) as n FROM providers');
  console.log(`Total providers in database: ${result.rows[0].n}`);
  console.log('\nTo populate/refresh provider data, run:');
  console.log('  npm run cron:agent-refresh -- --full');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
