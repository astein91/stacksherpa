/**
 * Database Client (Turso / libSQL)
 *
 * Reads provider catalog from a shared Turso database.
 * All queries are async. Write methods are only available
 * when TURSO_WRITE_TOKEN is set (for scrapers/admin).
 */

import { createClient, type Client } from '@libsql/client';
import { SCHEMA, type ProviderRow, type PricingRow, type KnownIssueRow } from './schema.js';
import type { KnownProvider, KnownIssue, PricingModel } from '../types.js';

// Turso connection — defaults to shared read-only catalog
const TURSO_URL = process.env.TURSO_DATABASE_URL ?? 'libsql://api-broker-astein91.aws-us-west-2.turso.io';
const TURSO_READ_TOKEN = process.env.TURSO_AUTH_TOKEN ?? 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicm8iLCJpYXQiOjE3NzA5MTg3OTUsImlkIjoiYjA4YmZkNTUtZjhhNi00ODU5LThjNzMtYjg4NzIzMmI4YmYyIiwicmlkIjoiMWJjN2NhMTgtMDU1OC00NjI2LWJjY2YtOGVmMWIwZjQ1ZDAxIn0.aZ4gR9f0I9Qq8T_tkQp-uXwL-4LzUPGaGCDATirOFBBu9kHmuFs5cfXXJ162RzfX2Nrsn-HEAx_H8-uSSfiKBA';
const TURSO_WRITE_TOKEN = process.env.TURSO_WRITE_TOKEN;

let client: Client | null = null;

export function getClient(): Client {
  if (!client) {
    client = createClient({
      url: TURSO_URL,
      authToken: TURSO_READ_TOKEN || undefined,
    });
  }
  return client;
}

/**
 * Initialize the database schema (for local/embedded use or first-time Turso setup).
 * In production, schema is managed via Turso CLI.
 */
export async function ensureSchema(): Promise<void> {
  const db = getClient();
  // Split SCHEMA into individual statements and execute each
  const statements = SCHEMA
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    await db.execute(stmt);
  }
}

// ============================================
// Query Methods (for MCP server)
// ============================================

/**
 * Get all providers in a category
 */
export async function getProvidersByCategory(category: string): Promise<KnownProvider[]> {
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT * FROM providers WHERE category = ? AND status = 'active'`,
    args: [category],
  });

  return result.rows.map(row => rowToProvider(row as unknown as ProviderRow));
}

/**
 * Get a single provider by ID with all related data
 */
export async function getProviderById(id: string): Promise<KnownProvider | null> {
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT * FROM providers WHERE id = ?`,
    args: [id],
  });

  if (result.rows.length === 0) return null;
  const row = result.rows[0] as unknown as ProviderRow;
  const provider = rowToProvider(row);

  // Get latest pricing
  const pricingResult = await db.execute({
    sql: `SELECT * FROM latest_pricing WHERE provider_id = ?`,
    args: [id],
  });

  if (pricingResult.rows.length > 0) {
    provider.pricing = rowToPricing(pricingResult.rows[0] as unknown as PricingRow);
  }

  // Get known issues
  const issuesResult = await db.execute({
    sql: `SELECT * FROM active_issues WHERE provider_id = ?`,
    args: [id],
  });

  if (issuesResult.rows.length > 0) {
    provider.knownIssues = issuesResult.rows.map(r => rowToKnownIssue(r as unknown as KnownIssueRow));
  }

  // Get AI benchmarks if applicable
  if (row.category === 'ai') {
    const benchResult = await db.execute({
      sql: `SELECT * FROM latest_ai_benchmarks WHERE provider_id = ?`,
      args: [id],
    });

    if (benchResult.rows.length > 0) {
      provider.aiBenchmarks = rowToAiBenchmarks(benchResult.rows[0] as unknown as Record<string, unknown>);
    }
  }

  return provider;
}

/**
 * Search providers with filters
 */
export async function searchProviders(filters: {
  category?: string;
  compliance?: string[];
  scale?: string;
  hasFreeTier?: boolean;
  maxPricePerUnit?: number;
}): Promise<KnownProvider[]> {
  const db = getClient();

  let sql = `
    SELECT DISTINCT p.* FROM providers p
    LEFT JOIN latest_pricing pr ON p.id = pr.provider_id
    WHERE p.status = 'active'
  `;
  const args: (string | number)[] = [];

  if (filters.category) {
    sql += ` AND p.category = ?`;
    args.push(filters.category);
  }

  if (filters.compliance && filters.compliance.length > 0) {
    for (const c of filters.compliance) {
      sql += ` AND EXISTS (SELECT 1 FROM json_each(p.compliance) WHERE json_each.value = ?)`;
      args.push(c);
    }
  }

  if (filters.scale) {
    sql += ` AND EXISTS (SELECT 1 FROM json_each(p.best_for) WHERE json_each.value = ?)`;
    args.push(filters.scale);
  }

  if (filters.hasFreeTier) {
    sql += ` AND pr.free_tier_included IS NOT NULL`;
  }

  if (filters.maxPricePerUnit !== undefined) {
    sql += ` AND (pr.unit_price IS NULL OR pr.unit_price <= ?)`;
    args.push(filters.maxPricePerUnit);
  }

  const result = await db.execute({ sql, args });
  return result.rows.map(row => rowToProvider(row as unknown as ProviderRow));
}

/**
 * Get active issues for a provider
 */
export async function getActiveIssues(providerId: string): Promise<KnownIssue[]> {
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT * FROM active_issues WHERE provider_id = ?`,
    args: [providerId],
  });

  return result.rows.map(r => rowToKnownIssue(r as unknown as KnownIssueRow));
}

/**
 * Get all categories with provider counts
 */
export async function getCategories(): Promise<{ category: string; count: number }[]> {
  const db = getClient();

  const result = await db.execute(`
    SELECT category, COUNT(*) as count
    FROM providers
    WHERE status = 'active'
    GROUP BY category
    ORDER BY count DESC
  `);

  return result.rows.map(r => ({
    category: r.category as string,
    count: Number(r.count),
  }));
}

/**
 * Get a map of provider name (lowercase) -> ecosystem for all providers that have one.
 * Used for ecosystem affinity scoring without loading all providers.
 */
export async function getProviderEcosystems(): Promise<Map<string, string>> {
  const db = getClient();

  const result = await db.execute(`
    SELECT LOWER(name) as name, ecosystem
    FROM providers
    WHERE ecosystem IS NOT NULL AND ecosystem != '' AND status = 'active'
  `);

  return new Map(result.rows.map(r => [r.name as string, r.ecosystem as string]));
}

/**
 * Get providers needing updates (stale data)
 */
export async function getStaleProviders(daysSinceUpdate: number = 30): Promise<ProviderRow[]> {
  const db = getClient();
  const cutoff = new Date(Date.now() - daysSinceUpdate * 24 * 60 * 60 * 1000).toISOString();

  const result = await db.execute({
    sql: `
      SELECT * FROM providers
      WHERE last_verified < ? OR last_verified IS NULL
      ORDER BY last_verified ASC NULLS FIRST
    `,
    args: [cutoff],
  });

  return result.rows as unknown as ProviderRow[];
}

// ============================================
// Write Methods (for scrapers/admin — requires TURSO_WRITE_TOKEN)
// ============================================

function getWriteClient(): Client {
  if (!TURSO_WRITE_TOKEN) {
    throw new Error('TURSO_WRITE_TOKEN is required for write operations');
  }
  return createClient({
    url: TURSO_URL,
    authToken: TURSO_WRITE_TOKEN,
  });
}

/**
 * Upsert a provider (requires write token)
 */
export async function upsertProvider(provider: KnownProvider): Promise<void> {
  const db = getWriteClient();

  await db.execute({
    sql: `
      INSERT INTO providers (
        id, name, description, category, subcategories, status,
        website, docs_url, package, package_alt_names,
        compliance, data_residency, self_hostable, on_prem_option,
        strengths, weaknesses, best_for,
        avoid_if, requires, best_when, alternatives,
        ecosystem, updated_at, last_verified
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
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
      provider.id ?? provider.name.toLowerCase().replace(/\s+/g, '-'),
      provider.name,
      provider.description ?? null,
      provider.category ?? 'unknown',
      JSON.stringify(provider.subcategories ?? []),
      provider.status ?? 'active',
      provider.website ?? null,
      provider.docsUrl ?? null,
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

/**
 * Insert pricing data (append-only for history, requires write token)
 */
export async function insertPricing(providerId: string, pricing: PricingModel): Promise<void> {
  const db = getWriteClient();

  await db.execute({
    sql: `
      INSERT INTO pricing (
        provider_id, pricing_type, currency,
        free_tier_included, free_tier_limitations,
        unit, unit_price, volume_discounts,
        plans, source_url, scraped_at, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      providerId,
      pricing.type,
      pricing.currency,
      pricing.freeTier?.included ?? null,
      JSON.stringify(pricing.freeTier?.limitations ?? []),
      pricing.unitPricing?.unit ?? null,
      pricing.unitPricing?.price ?? null,
      JSON.stringify(pricing.unitPricing?.volumeDiscounts ?? []),
      JSON.stringify(pricing.plans ?? []),
      pricing.source ?? null,
      pricing.lastVerified,
      'medium',
    ],
  });
}

/**
 * Upsert a known issue (requires write token)
 */
export async function upsertKnownIssue(providerId: string, issue: KnownIssue): Promise<void> {
  const db = getWriteClient();

  await db.execute({
    sql: `
      INSERT INTO known_issues (
        id, provider_id, symptom, scope, workaround, severity,
        affected_versions, github_issue_url,
        reported_at, resolved_at, confidence, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        symptom = excluded.symptom,
        scope = excluded.scope,
        workaround = excluded.workaround,
        severity = excluded.severity,
        affected_versions = excluded.affected_versions,
        resolved_at = excluded.resolved_at,
        confidence = excluded.confidence,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      issue.id,
      providerId,
      issue.symptom,
      issue.scope ?? null,
      issue.workaround ?? null,
      issue.severity,
      issue.affectedVersions ?? null,
      issue.githubIssue ?? null,
      issue.reportedAt ?? null,
      issue.resolvedAt ?? null,
      issue.confidence,
    ],
  });
}

// ============================================
// Row to Type Converters
// ============================================

function parseJson<T>(json: string | null | undefined): T | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function str(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

function num(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  return Number(val);
}

function rowToProvider(row: ProviderRow): KnownProvider {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    category: row.category,
    subcategories: parseJson(row.subcategories),
    status: row.status as KnownProvider['status'],
    website: row.website ?? undefined,
    docsUrl: row.docs_url ?? undefined,
    package: row.package ?? undefined,
    packageAltNames: parseJson(row.package_alt_names),
    compliance: parseJson(row.compliance),
    dataResidency: parseJson(row.data_residency),
    selfHostable: row.self_hostable === 1,
    onPremOption: row.on_prem_option === 1,
    strengths: parseJson(row.strengths),
    weaknesses: parseJson(row.weaknesses),
    bestFor: parseJson(row.best_for),
    avoidIf: parseJson(row.avoid_if),
    requires: parseJson(row.requires),
    bestWhen: parseJson(row.best_when),
    alternatives: parseJson(row.alternatives),
    ecosystem: row.ecosystem ?? undefined,
    lastVerified: row.last_verified ?? undefined,
  };
}

function rowToPricing(row: PricingRow): PricingModel {
  return {
    type: (row.pricing_type as PricingModel['type']) ?? 'usage',
    currency: row.currency as 'USD',
    freeTier: row.free_tier_included ? {
      included: row.free_tier_included,
      limitations: parseJson(row.free_tier_limitations),
    } : undefined,
    unitPricing: row.unit ? {
      unit: row.unit,
      price: row.unit_price ?? 0,
      volumeDiscounts: parseJson(row.volume_discounts),
    } : undefined,
    plans: parseJson(row.plans),
    lastVerified: row.scraped_at,
    source: row.source_url ?? undefined,
  };
}

function rowToKnownIssue(row: KnownIssueRow): KnownIssue {
  return {
    id: row.id,
    symptom: row.symptom,
    scope: row.scope ?? '',
    workaround: row.workaround ?? undefined,
    severity: row.severity as KnownIssue['severity'],
    affectedVersions: row.affected_versions ?? undefined,
    githubIssue: row.github_issue_url ?? undefined,
    reportedAt: row.reported_at ?? '',
    resolvedAt: row.resolved_at ?? undefined,
    confidence: row.confidence as KnownIssue['confidence'],
  };
}

function rowToAiBenchmarks(row: Record<string, unknown>): KnownProvider['aiBenchmarks'] {
  return {
    lmArena: row.lmarena_elo ? {
      elo: Number(row.lmarena_elo),
      rank: num(row.lmarena_rank) ?? undefined,
      category: str(row.lmarena_category) ?? undefined,
      measuredAt: str(row.measured_at) ?? '',
    } : undefined,
    artificialAnalysis: row.aa_quality_index ? {
      qualityIndex: Number(row.aa_quality_index),
      speedIndex: num(row.aa_speed_index) ?? undefined,
      pricePerMToken: num(row.aa_price_per_m_token) ?? undefined,
      tokensPerSecond: num(row.aa_tokens_per_second) ?? undefined,
      ttft: num(row.aa_ttft_ms) ?? undefined,
      measuredAt: str(row.measured_at) ?? '',
    } : undefined,
    contextWindow: row.context_max_tokens ? {
      maxTokens: Number(row.context_max_tokens),
      effectiveTokens: num(row.context_effective_tokens) ?? undefined,
    } : undefined,
    capabilities: parseJson(str(row.capabilities)),
    benchmarks: parseJson(str(row.benchmarks)),
  };
}
