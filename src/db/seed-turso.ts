#!/usr/bin/env tsx
/**
 * Seed Turso Database
 *
 * Connects to Turso with a write token and upserts all providers
 * from the knowledge base. Run this after updating knowledge.ts.
 *
 * Requires TURSO_WRITE_TOKEN env var (or TURSO_AUTH_TOKEN with write access).
 *
 * Usage:
 *   TURSO_WRITE_TOKEN=<token> npm run seed:turso
 */

import { createClient } from '@libsql/client';
import { SCHEMA } from './schema.js';
import { knowledgeBase } from '../knowledge.js';
import { providerRepos } from '../scrapers/sources/github-issues.js';
import type { KnownProvider } from '../types.js';

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

async function upsertProvider(provider: KnownProvider): Promise<void> {
  const id = provider.id ?? provider.name.toLowerCase().replace(/\s+/g, '-');

  // Derive pricing_url from pricing.source
  const pricingUrl = provider.pricing?.source ?? null;

  // Derive github_repo from providerRepos map (first repo as primary)
  const repos = providerRepos[id];
  const githubRepo = repos?.[0] ?? null;

  await client.execute({
    sql: `
      INSERT INTO providers (
        id, name, description, category, subcategories, status,
        website, docs_url, pricing_url, github_repo,
        package, package_alt_names,
        compliance, data_residency, self_hostable, on_prem_option,
        strengths, weaknesses, best_for,
        avoid_if, requires, best_when, alternatives,
        ecosystem, updated_at, last_verified
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, CURRENT_TIMESTAMP, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        category = excluded.category,
        subcategories = excluded.subcategories,
        status = excluded.status,
        website = excluded.website,
        docs_url = excluded.docs_url,
        pricing_url = COALESCE(excluded.pricing_url, providers.pricing_url),
        github_repo = COALESCE(excluded.github_repo, providers.github_repo),
        package = excluded.package,
        package_alt_names = excluded.package_alt_names,
        compliance = excluded.compliance,
        data_residency = excluded.data_residency,
        self_hostable = excluded.self_hostable,
        on_prem_option = excluded.on_prem_option,
        strengths = excluded.strengths,
        weaknesses = excluded.weaknesses,
        best_for = excluded.best_for,
        avoid_if = excluded.avoid_if,
        requires = excluded.requires,
        best_when = excluded.best_when,
        alternatives = excluded.alternatives,
        ecosystem = excluded.ecosystem,
        updated_at = CURRENT_TIMESTAMP,
        last_verified = excluded.last_verified
    `,
    args: [
      id,
      provider.name,
      provider.description ?? null,
      provider.category ?? 'unknown',
      JSON.stringify(provider.subcategories ?? []),
      provider.status ?? 'active',
      provider.website ?? null,
      provider.docsUrl ?? null,
      pricingUrl,
      githubRepo,
      provider.package ?? null,
      JSON.stringify(provider.packageAltNames ?? {}),
      JSON.stringify(provider.compliance ?? []),
      JSON.stringify(provider.dataResidency ?? []),
      provider.selfHostable ? 1 : 0,
      provider.onPremOption ? 1 : 0,
      JSON.stringify(provider.strengths ?? []),
      JSON.stringify(provider.weaknesses ?? []),
      JSON.stringify(provider.bestFor ?? provider.scale ?? []),
      JSON.stringify(provider.avoidIf ?? []),
      JSON.stringify(provider.requires ?? []),
      JSON.stringify(provider.bestWhen ?? []),
      JSON.stringify(provider.alternatives ?? []),
      provider.ecosystem ?? null,
      provider.lastVerified ?? null,
    ],
  });
}

async function seed() {
  await ensureSchema();

  let total = 0;
  let errors = 0;

  for (const [category, providers] of Object.entries(knowledgeBase)) {
    for (const provider of providers) {
      const enriched: KnownProvider = {
        ...provider,
        id: provider.id ?? provider.name.toLowerCase().replace(/\s+/g, '-'),
        category: provider.category ?? category,
        status: provider.status ?? 'active',
        lastVerified: provider.lastVerified ?? new Date().toISOString().split('T')[0],
        bestFor: provider.bestFor ?? provider.scale,
      };

      try {
        await upsertProvider(enriched);
        total++;
        process.stdout.write('.');
      } catch (err) {
        errors++;
        console.error(`\nFailed to upsert ${enriched.name}:`, err);
      }
    }
  }

  console.log(`\n\nSeeded ${total} providers (${errors} errors)`);

  // Verify
  const result = await client.execute('SELECT COUNT(*) as n FROM providers');
  console.log(`Total providers in database: ${result.rows[0].n}`);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
