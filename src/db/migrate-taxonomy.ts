#!/usr/bin/env tsx
/**
 * One-time taxonomy migration: 35 → 28 categories
 *
 * Run: tsx src/db/migrate-taxonomy.ts
 * Requires: TURSO_WRITE_TOKEN
 *
 * Renames, merges, absorbs, and deprecates categories in the providers table.
 */

import { createClient } from '@libsql/client';

const TURSO_URL = process.env.TURSO_DATABASE_URL ?? process.env.TURSO_URL ?? 'libsql://api-broker-astein91.aws-us-west-2.turso.io';
const TURSO_TOKEN = process.env.TURSO_WRITE_TOKEN ?? process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error('Error: TURSO_DATABASE_URL and TURSO_WRITE_TOKEN are required');
  process.exit(1);
}

const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

const MIGRATIONS = [
  // Rename: cache-kv → cache
  `UPDATE providers SET category = 'cache' WHERE category = 'cache-kv'`,

  // Merge: financial-data + trading → finance
  `UPDATE providers SET category = 'finance' WHERE category IN ('financial-data', 'trading')`,

  // Absorb into ai
  `UPDATE providers SET category = 'ai' WHERE category IN ('ai-orchestration', 'ai-memory', 'document-processing')`,

  // Absorb into monitoring
  `UPDATE providers SET category = 'monitoring' WHERE category = 'audit-logging'`,

  // Absorb into media
  `UPDATE providers SET category = 'media' WHERE category = 'video'`,

  // Deprecate dropped categories
  `UPDATE providers SET status = 'deprecated' WHERE category IN (
    'prediction-markets', 'secrets', 'rate-limiting',
    'webhooks', 'api-gateway', 'integrations', 'scheduling'
  )`,
];

async function migrate() {
  console.log('=== Taxonomy Migration: 35 → 28 categories ===\n');

  for (const sql of MIGRATIONS) {
    const label = sql.slice(0, 80).replace(/\s+/g, ' ');
    try {
      const result = await client.execute(sql);
      console.log(`[OK] ${label}... (${result.rowsAffected} rows)`);
    } catch (err) {
      console.error(`[FAIL] ${label}...`, err);
    }
  }

  // Verify
  console.log('\n=== Verification ===');
  const counts = await client.execute(
    `SELECT category, COUNT(*) as count FROM providers WHERE status != 'deprecated' GROUP BY category ORDER BY count DESC`,
  );

  for (const row of counts.rows) {
    console.log(`  ${row.category}: ${row.count}`);
  }

  console.log('\nDone.');
}

migrate().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
