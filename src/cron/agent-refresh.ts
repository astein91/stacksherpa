#!/usr/bin/env tsx
/**
 * Agentic Provider Refresh Pipeline
 *
 * Uses Claude Haiku 4.5 to research, synthesize, and maintain provider data.
 * Replaces static knowledge.ts with a live LLM-powered pipeline.
 *
 * Run via: npm run cron:agent-refresh
 *
 * Modes:
 *   (default)              Refresh all approved providers
 *   --full                 Bootstrap new providers + refresh all
 *   --dry-run              Synthesize but don't write to Turso
 *   --provider <id>        Refresh a single provider
 *
 * Requires: ANTHROPIC_API_KEY, TURSO_WRITE_TOKEN
 * Optional: FIRECRAWL_API_KEY, GITHUB_TOKEN
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  getAllActiveProviders,
  getProviderById,
  upsertProvider,
  upsertKnownIssue,
  insertPricing,
  getProvidersWithPricingUrls,
  getProvidersWithGithubRepos,
} from '../db/client.js';
import { scrapePricing } from '../scrapers/sources/pricing.js';
import { getProviderIssues, providerRepos } from '../scrapers/sources/github-issues.js';
import type { KnownProvider } from '../types.js';
import { bootstrapAll } from './bootstrap-roster.js';

// ============================================
// Category Priority
// ============================================

/** Categories where data changes fast and descriptions need frequent refresh */
export const FAST_REFRESH_CATEGORIES = new Set([
  'ai', 'ai-orchestration', 'ai-audio', 'ai-video', 'ai-image',
]);

/** Truncation limit for website scraping — AI categories get more context */
const SCRAPE_LIMIT_DEFAULT = 4000;
const SCRAPE_LIMIT_FAST = 8000;

// ============================================
// Types
// ============================================

interface ScrapedContext {
  websiteMarkdown?: string;
  pricingData?: unknown;
  githubIssues?: { symptom: string; severity: string; url: string }[];
  existingRow: KnownProvider;
}

interface SynthesizedProfile {
  description?: string;
  website?: string;
  docsUrl?: string;
  pricingUrl?: string;
  strengths?: string[];
  weaknesses?: string[];
  bestFor?: string[];
  avoidIf?: string[];
  bestWhen?: string[];
  requires?: string[];
  alternatives?: string[];
  compliance?: string[];
  ecosystem?: string;
  selfHostable?: boolean;
  onPremOption?: boolean;
  subcategories?: string[];
}

interface ChangelogEntry {
  providerId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

interface RefreshResult {
  providerId: string;
  status: 'updated' | 'unchanged' | 'error';
  changes: ChangelogEntry[];
  error?: string;
  tokensUsed?: number;
}

interface RefreshOptions {
  full?: boolean;
  dryRun?: boolean;
  provider?: string;
  category?: string;
  highPriorityOnly?: boolean;
}

// ============================================
// Haiku Tool Schema
// ============================================

const PROVIDER_PROFILE_TOOL: Anthropic.Tool = {
  name: 'update_provider_profile',
  description: 'Update a provider profile with synthesized data from research.',
  input_schema: {
    type: 'object' as const,
    properties: {
      description: {
        type: 'string',
        description: 'Concise 1-3 sentence description of what this API/service does and why developers use it.',
      },
      website: {
        type: 'string',
        description: 'Primary website URL.',
      },
      docsUrl: {
        type: 'string',
        description: 'Developer documentation URL.',
      },
      pricingUrl: {
        type: 'string',
        description: 'Pricing page URL.',
      },
      strengths: {
        type: 'array',
        items: { type: 'string', enum: ['dx', 'reliability', 'cost', 'performance', 'support', 'security', 'customization'] },
        description: 'Top strengths of this provider. Pick 2-4 from the enum.',
      },
      weaknesses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific weaknesses or common complaints. Be concrete (e.g., "rate limits on free tier are restrictive", "no webhook retry").',
      },
      bestFor: {
        type: 'array',
        items: { type: 'string', enum: ['hobby', 'startup', 'growth', 'enterprise'] },
        description: 'Which scale segments this provider serves best.',
      },
      avoidIf: {
        type: 'array',
        items: { type: 'string' },
        description: 'Conditions where this provider is a poor fit (e.g., "need strict data residency in EU", "budget under $50/mo").',
      },
      bestWhen: {
        type: 'array',
        items: { type: 'string' },
        description: 'Conditions where this provider shines (e.g., "high volume transactional email", "need React SDK").',
      },
      requires: {
        type: 'array',
        items: { type: 'string' },
        description: 'Technical requirements (e.g., "API key", "webhook endpoint", "Node.js 18+").',
      },
      alternatives: {
        type: 'array',
        items: { type: 'string' },
        description: 'Provider IDs of direct competitors/alternatives (use lowercase slugs like "resend", "sendgrid").',
      },
      compliance: {
        type: 'array',
        items: { type: 'string' },
        description: 'Compliance certifications with evidence from docs/website (e.g., "SOC2", "HIPAA", "GDPR", "PCI-DSS", "ISO27001").',
      },
      ecosystem: {
        type: 'string',
        description: 'Primary ecosystem affinity if any (e.g., "vercel", "supabase", "firebase", "aws", "cloudflare").',
      },
      selfHostable: {
        type: 'boolean',
        description: 'Whether the service can be self-hosted.',
      },
      onPremOption: {
        type: 'boolean',
        description: 'Whether there is an on-premises deployment option.',
      },
      subcategories: {
        type: 'array',
        items: { type: 'string' },
        description: 'Subcategories within the main category (e.g., ["transactional", "marketing"] for email).',
      },
    },
    required: ['description', 'strengths', 'bestFor'],
  },
};

// ============================================
// Context Gathering
// ============================================

async function scrapeWebsite(url: string, maxChars?: number): Promise<string | undefined> {
  if (!process.env.FIRECRAWL_API_KEY) return undefined;

  const limit = maxChars ?? SCRAPE_LIMIT_DEFAULT;

  try {
    const FirecrawlApp = (await import('@mendable/firecrawl-js')).default;
    const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

    const result = await firecrawl.scrapeUrl(url, {
      formats: ['markdown'],
    });

    if (result.success && result.markdown) {
      return result.markdown.slice(0, limit);
    }
  } catch (err) {
    console.error(`    Firecrawl failed for ${url}: ${err}`);
  }
  return undefined;
}

async function gatherContext(provider: KnownProvider): Promise<ScrapedContext> {
  const context: ScrapedContext = { existingRow: provider };

  // 1. Scrape website if available
  const scrapeLimit = FAST_REFRESH_CATEGORIES.has(provider.category) ? SCRAPE_LIMIT_FAST : SCRAPE_LIMIT_DEFAULT;
  if (provider.website) {
    console.log(`    Scraping website...`);
    context.websiteMarkdown = await scrapeWebsite(provider.website, scrapeLimit);
  }

  // 2. Fetch GitHub issues
  const repoMap = await getProvidersWithGithubRepos();
  const repoEntry = repoMap.find(r => r.id === provider.id);
  const repos = repoEntry ? [repoEntry.githubRepo] : providerRepos[provider.id!];

  if (repos) {
    console.log(`    Fetching GitHub issues...`);
    try {
      const issues = await getProviderIssues(provider.id!, { minReactions: 2, maxIssues: 10, repos });
      context.githubIssues = issues.map(i => ({
        symptom: i.symptom,
        severity: i.severity,
        url: i.githubIssue ?? '',
      }));

      // Also write issues directly to Turso (scrapers own this data)
      for (const issue of issues) {
        await upsertKnownIssue(provider.id!, issue);
      }
    } catch (err) {
      console.error(`    GitHub issues failed: ${err}`);
    }
  }

  // 3. Scrape pricing if we have a URL
  const pricingUrls = await getProvidersWithPricingUrls();
  const pricingEntry = pricingUrls.find(p => p.id === provider.id);

  if (pricingEntry || provider.pricingUrl) {
    console.log(`    Scraping pricing...`);
    try {
      const pricingResult = await scrapePricing(provider.id!, {
        pricingUrl: pricingEntry?.pricingUrl ?? provider.pricingUrl,
      });
      if (pricingResult.success && pricingResult.data) {
        context.pricingData = pricingResult.data.extracted;

        // Write pricing directly to Turso (scrapers own this data)
        await insertPricing(provider.id!, {
          type: pricingResult.data.extracted.type ?? 'usage',
          currency: 'USD',
          freeTier: pricingResult.data.extracted.freeTier,
          unitPricing: pricingResult.data.extracted.unitPricing,
          plans: pricingResult.data.extracted.plans,
          lastVerified: pricingResult.data.scrapedAt,
          source: pricingResult.data.source,
        });
      }
    } catch (err) {
      console.error(`    Pricing scrape failed: ${err}`);
    }
  }

  return context;
}

// ============================================
// Haiku Synthesis
// ============================================

async function synthesizeWithHaiku(
  anthropic: Anthropic,
  provider: KnownProvider,
  scraped: ScrapedContext,
): Promise<{ profile: SynthesizedProfile; tokensUsed: number }> {
  const currentData = {
    id: provider.id,
    name: provider.name,
    category: provider.category,
    description: provider.description,
    website: provider.website,
    docsUrl: provider.docsUrl,
    pricingUrl: provider.pricingUrl,
    strengths: provider.strengths,
    weaknesses: provider.weaknesses,
    bestFor: provider.bestFor,
    avoidIf: provider.avoidIf,
    bestWhen: provider.bestWhen,
    requires: provider.requires,
    alternatives: provider.alternatives,
    compliance: provider.compliance,
    ecosystem: provider.ecosystem,
    selfHostable: provider.selfHostable,
    onPremOption: provider.onPremOption,
    subcategories: provider.subcategories,
  };

  let userContent = `## Current Provider Data (from database)\n\`\`\`json\n${JSON.stringify(currentData, null, 2)}\n\`\`\`\n`;

  if (scraped.websiteMarkdown) {
    userContent += `\n## Scraped Website Content\n${scraped.websiteMarkdown}\n`;
  }

  if (scraped.pricingData) {
    userContent += `\n## Scraped Pricing Data\n\`\`\`json\n${JSON.stringify(scraped.pricingData, null, 2)}\n\`\`\`\n`;
  }

  if (scraped.githubIssues && scraped.githubIssues.length > 0) {
    userContent += `\n## Recent GitHub Issues (${scraped.githubIssues.length} total)\n`;
    for (const issue of scraped.githubIssues.slice(0, 5)) {
      userContent += `- [${issue.severity}] ${issue.symptom}\n`;
    }
  }

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: `You are an API analyst maintaining a developer tool recommendation database. Given a provider's current database record and freshly scraped context, synthesize an updated profile.

CRITICAL: Base ALL information on the scraped context provided. Never fill in details from your training data — it may be outdated. Models get sunset, pricing changes, features evolve. If the scraped context doesn't mention something, leave it as-is rather than guessing.

Rules:
- Preserve accurate existing data — only update fields that are stale, missing, or contradicted by evidence.
- If a field already has good data and nothing contradicts it, keep it as-is.
- Be specific in weaknesses and avoidIf — generic statements are useless.
- For alternatives, use lowercase slug IDs (e.g., "resend", "sendgrid", "postmark").
- Only list compliance certs you can verify from the scraped evidence.
- Strengths must be from the enum: dx, reliability, cost, performance, support, security, customization.
- bestFor must be from: hobby, startup, growth, enterprise.
- Provider identity should be company/platform level, not individual models or versions.

SPECIAL RULES FOR "ai" CATEGORY PROVIDERS:
For providers in the "ai" category, descriptions MUST include specific, current model-level data from the scraped context:
- Flagship model names and versions (e.g., "GPT-5.2", "Claude Opus 4.6", "Gemini 3 Pro")
- Context window sizes (e.g., "1M tokens", "256k context")
- Per-token pricing (e.g., "$1.75/$14 per 1M input/output tokens")
- Benchmark rankings if available (e.g., "LMArena ELO ~1502", "#1 on Code Arena")
- Key capabilities (multimodal, reasoning, code gen, etc.)
This data changes rapidly and is the primary signal our recommendation engine uses for AI provider routing. A description that says "offers various LLM models" is useless — be specific about every current model found in the scraped data.`,
    messages: [{ role: 'user', content: userContent }],
    tools: [PROVIDER_PROFILE_TOOL],
    tool_choice: { type: 'tool', name: 'update_provider_profile' },
  });

  const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

  // Extract tool use result
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );

  if (!toolUse) {
    throw new Error('Haiku did not return tool_use response');
  }

  return { profile: toolUse.input as SynthesizedProfile, tokensUsed };
}

// ============================================
// Diff & Update
// ============================================

function diffAndUpdate(
  existing: KnownProvider,
  synthesized: SynthesizedProfile,
): ChangelogEntry[] {
  const changes: ChangelogEntry[] = [];

  const fields: (keyof SynthesizedProfile)[] = [
    'description', 'website', 'docsUrl', 'pricingUrl',
    'strengths', 'weaknesses', 'bestFor', 'avoidIf', 'bestWhen',
    'requires', 'alternatives', 'compliance', 'ecosystem',
    'selfHostable', 'onPremOption', 'subcategories',
  ];

  for (const field of fields) {
    const newVal = synthesized[field];
    if (newVal === undefined || newVal === null) continue;

    const oldVal = existing[field as keyof KnownProvider];

    // Compare serialized values for arrays/objects
    const oldSerialized = JSON.stringify(oldVal ?? null);
    const newSerialized = JSON.stringify(newVal);

    if (oldSerialized !== newSerialized) {
      changes.push({
        providerId: existing.id!,
        field,
        oldValue: oldVal ?? null,
        newValue: newVal,
      });
    }
  }

  return changes;
}

function mergeProfile(existing: KnownProvider, synthesized: SynthesizedProfile): KnownProvider {
  return {
    ...existing,
    description: synthesized.description ?? existing.description,
    website: synthesized.website ?? existing.website,
    docsUrl: synthesized.docsUrl ?? existing.docsUrl,
    pricingUrl: synthesized.pricingUrl ?? existing.pricingUrl,
    strengths: (synthesized.strengths as KnownProvider['strengths']) ?? existing.strengths,
    weaknesses: synthesized.weaknesses ?? existing.weaknesses,
    bestFor: (synthesized.bestFor as KnownProvider['bestFor']) ?? existing.bestFor,
    avoidIf: synthesized.avoidIf ?? existing.avoidIf,
    bestWhen: synthesized.bestWhen ?? existing.bestWhen,
    requires: synthesized.requires ?? existing.requires,
    alternatives: synthesized.alternatives ?? existing.alternatives,
    compliance: synthesized.compliance ?? existing.compliance,
    ecosystem: synthesized.ecosystem ?? existing.ecosystem,
    selfHostable: synthesized.selfHostable ?? existing.selfHostable,
    onPremOption: synthesized.onPremOption ?? existing.onPremOption,
    subcategories: synthesized.subcategories ?? existing.subcategories,
    lastVerified: new Date().toISOString().split('T')[0],
  };
}

// ============================================
// Single Provider Refresh
// ============================================

async function refreshProvider(
  anthropic: Anthropic,
  provider: KnownProvider,
  dryRun: boolean,
): Promise<RefreshResult> {
  const result: RefreshResult = {
    providerId: provider.id!,
    status: 'unchanged',
    changes: [],
  };

  try {
    console.log(`  [${provider.id}] Gathering context...`);
    const scraped = await gatherContext(provider);

    console.log(`  [${provider.id}] Calling Haiku...`);
    const { profile, tokensUsed } = await synthesizeWithHaiku(anthropic, provider, scraped);
    result.tokensUsed = tokensUsed;

    // Diff
    const changes = diffAndUpdate(provider, profile);
    result.changes = changes;

    if (changes.length === 0) {
      console.log(`  [${provider.id}] No changes needed`);
      result.status = 'unchanged';
      return result;
    }

    // Log changes
    console.log(`  [${provider.id}] ${changes.length} field(s) changed:`);
    for (const change of changes) {
      const oldStr = JSON.stringify(change.oldValue)?.slice(0, 60) ?? 'null';
      const newStr = JSON.stringify(change.newValue)?.slice(0, 60) ?? 'null';
      console.log(`    ${change.field}: ${oldStr} -> ${newStr}`);
    }

    // Write to Turso (unless dry-run)
    if (!dryRun) {
      const merged = mergeProfile(provider, profile);
      await upsertProvider(merged);
      console.log(`  [${provider.id}] Written to Turso`);
    } else {
      console.log(`  [${provider.id}] Dry run — skipping write`);
    }

    result.status = 'updated';
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`  [${provider.id}] Error: ${msg}`);
    result.status = 'error';
    result.error = msg;
    return result;
  }
}

// ============================================
// Main Entry
// ============================================

export async function runAgentRefresh(options: RefreshOptions = {}): Promise<RefreshResult[]> {
  const { full = false, dryRun = false, provider: singleProvider, category, highPriorityOnly = false } = options;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('Skipping agent refresh: ANTHROPIC_API_KEY not set');
    return [];
  }

  const anthropic = new Anthropic();

  // Bootstrap new providers first if --full
  if (full) {
    console.log('\n=== Bootstrap: Discovering new providers ===');
    await bootstrapAll({ dryRun });
    console.log('=== Bootstrap complete ===\n');
  }

  // Get providers to refresh
  let providers: KnownProvider[];

  if (singleProvider) {
    const p = await getProviderById(singleProvider);
    if (!p) {
      console.error(`Provider not found: ${singleProvider}`);
      return [];
    }
    providers = [p];
  } else {
    providers = await getAllActiveProviders();

    // Filter by category if specified
    if (category) {
      providers = providers.filter(p => p.category === category);
    }

    // Filter to high-priority categories only (for non-Monday daily runs)
    if (highPriorityOnly) {
      providers = providers.filter(p => FAST_REFRESH_CATEGORIES.has(p.category));
    }
  }

  if (providers.length === 0) {
    console.log('No providers to refresh (after filters).');
    return [];
  }

  const mode = highPriorityOnly ? 'high-priority only' : category ? `category: ${category}` : 'all';
  console.log(`\n=== Agent Refresh: ${providers.length} provider(s) [${mode}] ===`);
  if (dryRun) console.log('(DRY RUN — no writes)\n');

  const results = await processInBatches(providers, 5, async (provider) => {
    console.log(`\nRefreshing ${provider.name} (${provider.id})...`);
    return refreshProvider(anthropic, provider, dryRun);
  });

  const totalTokens = results.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);

  // Summary
  const updated = results.filter(r => r.status === 'updated').length;
  const unchanged = results.filter(r => r.status === 'unchanged').length;
  const errors = results.filter(r => r.status === 'error').length;
  const totalChanges = results.reduce((sum, r) => sum + r.changes.length, 0);

  console.log('\n=== Refresh Summary ===');
  console.log(`Providers: ${providers.length} total, ${updated} updated, ${unchanged} unchanged, ${errors} errors`);
  console.log(`Changes: ${totalChanges} fields updated`);
  console.log(`Tokens: ${totalTokens.toLocaleString()} (~$${(totalTokens * 0.00000125).toFixed(4)})`);

  if (errors > 0) {
    console.log('\nErrors:');
    for (const r of results.filter(r => r.status === 'error')) {
      console.log(`  ${r.providerId}: ${r.error}`);
    }
  }

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
  delayMs = 500,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < items.length) await sleep(delayMs);
  }
  return results;
}

// ============================================
// CLI
// ============================================

const args = process.argv.slice(2);
const isFull = args.includes('--full');
const isDryRun = args.includes('--dry-run');
const isHighPriority = args.includes('--high-priority');
const providerIdx = args.indexOf('--provider');
const singleProvider = providerIdx !== -1 ? args[providerIdx + 1] : undefined;
const catIdx = args.indexOf('--category');
const singleCategory = catIdx !== -1 ? args[catIdx + 1] : undefined;

if (!process.env.TURSO_WRITE_TOKEN && !isDryRun) {
  console.error('Error: TURSO_WRITE_TOKEN is required (or use --dry-run)');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY is required');
  process.exit(1);
}

console.log('=== stacksherpa Agent Refresh ===');
console.log(`Started at: ${new Date().toISOString()}`);
const modeLabel = isFull ? 'full' : singleProvider ? `single (${singleProvider})` : singleCategory ? `category (${singleCategory})` : isHighPriority ? 'high-priority categories' : 'refresh-all';
console.log(`Mode: ${modeLabel}`);
if (isDryRun) console.log('DRY RUN enabled');

runAgentRefresh({
  full: isFull,
  dryRun: isDryRun,
  provider: singleProvider,
  category: singleCategory,
  highPriorityOnly: isHighPriority,
})
  .then(results => {
    const errors = results.filter(r => r.status === 'error');
    if (errors.length > 0) process.exit(1);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
