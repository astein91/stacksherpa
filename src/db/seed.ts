#!/usr/bin/env tsx
/**
 * Seed Database (CLI) — Legacy local seed
 *
 * For Turso seeding, use: npm run seed:turso
 * This file is kept for backward compatibility but excluded from the main build.
 */

import { getClient, ensureSchema } from './client.js';

async function main() {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute('SELECT COUNT(*) as n FROM providers');
  console.log(`Database has ${result.rows[0].n} providers`);
}

main().catch(console.error);
