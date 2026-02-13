import { createClient, type Client } from "@libsql/client";

const TURSO_URL =
  process.env.TURSO_DATABASE_URL ?? "libsql://api-broker-astein91.aws-us-west-2.turso.io";
const TURSO_TOKEN =
  process.env.TURSO_AUTH_TOKEN ?? "";

let client: Client | null = null;

function getClient(): Client {
  if (!client) {
    client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  }
  return client;
}

// ---- helpers ----

function parseJson<T>(val: unknown): T | undefined {
  if (val === null || val === undefined) return undefined;
  try {
    return JSON.parse(String(val));
  } catch {
    return undefined;
  }
}

function str(val: unknown): string | undefined {
  if (val === null || val === undefined) return undefined;
  return String(val);
}

// ---- types ----

export interface CategoryRow {
  category: string;
  count: number;
}

export interface ProviderSummary {
  id: string;
  name: string;
  description?: string;
  compliance: string[];
  bestFor: string[];
  strengths: string[];
  ecosystem?: string;
  freeTier?: string;
  website?: string;
}

export interface ProviderDetail {
  id: string;
  name: string;
  description?: string;
  category: string;
  website?: string;
  docsUrl?: string;
  pricingUrl?: string;
  githubRepo?: string;
  package?: string;
  compliance: string[];
  dataResidency: string[];
  selfHostable: boolean;
  onPremOption: boolean;
  strengths: string[];
  weaknesses: string[];
  bestFor: string[];
  avoidIf: string[];
  requires: string[];
  bestWhen: string[];
  alternatives: string[];
  ecosystem?: string;
  lastVerified?: string;
  pricing?: {
    type: string;
    currency: string;
    freeTier?: { included: string; limitations?: string[] };
    unitPricing?: {
      unit: string;
      price: number;
      volumeDiscounts?: { threshold: number; pricePerUnit: number }[];
    };
    plans?: { name: string; priceMonthly?: number; priceYearly?: number; includes: string }[];
    source?: string;
  };
  knownIssues: {
    id: string;
    symptom: string;
    scope: string;
    workaround?: string;
    severity: string;
    githubIssue?: string;
  }[];
  aiBenchmarks?: {
    lmArena?: { elo: number; rank?: number; category?: string };
    artificialAnalysis?: {
      qualityIndex?: number;
      speedIndex?: number;
      pricePerMToken?: number;
      tokensPerSecond?: number;
      ttft?: number;
    };
    contextWindow?: { maxTokens: number; effectiveTokens?: number };
    capabilities?: Record<string, boolean>;
    benchmarks?: { name: string; score: number; maxScore?: number }[];
  };
}

// ---- queries ----

export async function getCategories(): Promise<CategoryRow[]> {
  const db = getClient();
  const result = await db.execute(`
    SELECT category, COUNT(*) as count
    FROM providers
    WHERE status = 'active' AND review_status = 'approved'
    GROUP BY category
    ORDER BY count DESC
  `);
  return result.rows.map((r) => ({
    category: r.category as string,
    count: Number(r.count),
  }));
}

export async function getProvidersByCategory(
  category: string
): Promise<ProviderSummary[]> {
  const db = getClient();

  const providers = await db.execute({
    sql: `SELECT * FROM providers WHERE category = ? AND status = 'active' AND review_status = 'approved' ORDER BY name`,
    args: [category],
  });

  if (providers.rows.length === 0) return [];

  const ids = providers.rows.map((r) => r.id as string);
  const placeholders = ids.map(() => "?").join(", ");

  const pricing = await db.execute({
    sql: `SELECT provider_id, free_tier_included FROM latest_pricing WHERE provider_id IN (${placeholders})`,
    args: ids,
  });

  const freeByProvider = new Map<string, string>();
  for (const r of pricing.rows) {
    if (r.free_tier_included) {
      freeByProvider.set(r.provider_id as string, r.free_tier_included as string);
    }
  }

  return providers.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: str(r.description),
    compliance: parseJson<string[]>(r.compliance) ?? [],
    bestFor: parseJson<string[]>(r.best_for) ?? [],
    strengths: parseJson<string[]>(r.strengths) ?? [],
    ecosystem: str(r.ecosystem),
    freeTier: freeByProvider.get(r.id as string),
    website: str(r.website),
  }));
}

export async function getProviderDetail(
  providerId: string
): Promise<ProviderDetail | null> {
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT * FROM providers WHERE id = ? AND status = 'active' AND review_status = 'approved'`,
    args: [providerId],
  });

  if (result.rows.length === 0) return null;
  const r = result.rows[0];

  const detail: ProviderDetail = {
    id: r.id as string,
    name: r.name as string,
    description: str(r.description),
    category: r.category as string,
    website: str(r.website),
    docsUrl: str(r.docs_url),
    pricingUrl: str(r.pricing_url),
    githubRepo: str(r.github_repo),
    package: str(r.package),
    compliance: parseJson<string[]>(r.compliance) ?? [],
    dataResidency: parseJson<string[]>(r.data_residency) ?? [],
    selfHostable: r.self_hostable === 1,
    onPremOption: r.on_prem_option === 1,
    strengths: parseJson<string[]>(r.strengths) ?? [],
    weaknesses: parseJson<string[]>(r.weaknesses) ?? [],
    bestFor: parseJson<string[]>(r.best_for) ?? [],
    avoidIf: parseJson<string[]>(r.avoid_if) ?? [],
    requires: parseJson<string[]>(r.requires) ?? [],
    bestWhen: parseJson<string[]>(r.best_when) ?? [],
    alternatives: parseJson<string[]>(r.alternatives) ?? [],
    ecosystem: str(r.ecosystem),
    lastVerified: str(r.last_verified),
    knownIssues: [],
  };

  // pricing
  const pricingResult = await db.execute({
    sql: `SELECT * FROM latest_pricing WHERE provider_id = ?`,
    args: [providerId],
  });

  if (pricingResult.rows.length > 0) {
    const p = pricingResult.rows[0];
    detail.pricing = {
      type: (p.pricing_type as string) ?? "usage",
      currency: (p.currency as string) ?? "USD",
      freeTier: p.free_tier_included
        ? {
            included: p.free_tier_included as string,
            limitations: parseJson<string[]>(p.free_tier_limitations),
          }
        : undefined,
      unitPricing: p.unit
        ? {
            unit: p.unit as string,
            price: Number(p.unit_price ?? 0),
            volumeDiscounts: parseJson(p.volume_discounts),
          }
        : undefined,
      plans: parseJson(p.plans),
      source: str(p.source_url),
    };
  }

  // known issues
  const issuesResult = await db.execute({
    sql: `SELECT * FROM active_issues WHERE provider_id = ?`,
    args: [providerId],
  });

  detail.knownIssues = issuesResult.rows.map((i) => ({
    id: i.id as string,
    symptom: i.symptom as string,
    scope: (i.scope as string) ?? "",
    workaround: str(i.workaround),
    severity: (i.severity as string) ?? "low",
    githubIssue: str(i.github_issue_url),
  }));

  // AI benchmarks
  if (r.category === "ai") {
    const benchResult = await db.execute({
      sql: `SELECT * FROM latest_ai_benchmarks WHERE provider_id = ?`,
      args: [providerId],
    });

    if (benchResult.rows.length > 0) {
      const b = benchResult.rows[0];
      detail.aiBenchmarks = {
        lmArena: b.lmarena_elo
          ? {
              elo: Number(b.lmarena_elo),
              rank: b.lmarena_rank ? Number(b.lmarena_rank) : undefined,
              category: str(b.lmarena_category),
            }
          : undefined,
        artificialAnalysis: b.aa_quality_index
          ? {
              qualityIndex: Number(b.aa_quality_index),
              speedIndex: b.aa_speed_index ? Number(b.aa_speed_index) : undefined,
              pricePerMToken: b.aa_price_per_m_token ? Number(b.aa_price_per_m_token) : undefined,
              tokensPerSecond: b.aa_tokens_per_second ? Number(b.aa_tokens_per_second) : undefined,
              ttft: b.aa_ttft_ms ? Number(b.aa_ttft_ms) : undefined,
            }
          : undefined,
        contextWindow: b.context_max_tokens
          ? {
              maxTokens: Number(b.context_max_tokens),
              effectiveTokens: b.context_effective_tokens
                ? Number(b.context_effective_tokens)
                : undefined,
            }
          : undefined,
        capabilities: parseJson(b.capabilities),
        benchmarks: parseJson(b.benchmarks),
      };
    }
  }

  return detail;
}

export async function getAllProviderSlugs(): Promise<
  { category: string; provider: string }[]
> {
  const db = getClient();
  const result = await db.execute(`
    SELECT id, category FROM providers
    WHERE status = 'active' AND review_status = 'approved'
  `);
  return result.rows.map((r) => ({
    category: r.category as string,
    provider: r.id as string,
  }));
}
