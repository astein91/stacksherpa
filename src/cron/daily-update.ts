#!/usr/bin/env tsx
/**
 * Daily Update Cron Job
 *
 * Run via: npm run cron:daily
 * Or via GitHub Actions on a schedule
 *
 * Requires TURSO_WRITE_TOKEN env var for database writes.
 *
 * Updates:
 * 1. GitHub issues (known bugs) — every run
 * 2. Pricing (stale providers) — up to 3/run
 * 3. API discovery — 1st and 15th only
 * 4. Metadata refresh — up to 2/run
 * 5. Agent provider refresh — daily for high-priority categories (ai, ai-*), full on Mondays
 * 6. Bootstrap discovery — 1st of month
 */

import {
  upsertKnownIssue,
  getStaleProviders,
  insertPricing,
  getProvidersWithPricingUrls,
  getProvidersWithGithubRepos,
  getAllActiveProviders,
} from '../db/client.js';
import { getProviderIssues, providerRepos } from '../scrapers/sources/github-issues.js';
import { scrapePricing } from '../scrapers/sources/pricing.js';
import { discoverAndInsertAll } from '../scrapers/sources/discovery.js';
import { refreshStaleProviderMetadata } from '../scrapers/sources/metadata-refresh.js';
import { runAgentRefresh } from './agent-refresh.js';
import { bootstrapAll } from './bootstrap-roster.js';

interface UpdateResult {
  task: string;
  success: boolean;
  count?: number;
  error?: string;
  duration: number;
}

async function updateGitHubIssues(): Promise<UpdateResult> {
  const start = Date.now();
  let totalIssues = 0;

  try {
    // Build provider -> repos map: start with Turso data, merge hardcoded fallbacks
    const tursoRepos = await getProvidersWithGithubRepos();
    const repoMap = new Map<string, string[]>();

    // Turso repos (single repo per provider from DB)
    for (const { id, githubRepo } of tursoRepos) {
      repoMap.set(id, [githubRepo]);
    }

    // Merge hardcoded repos for any providers not yet in Turso
    for (const [id, repos] of Object.entries(providerRepos)) {
      if (!repoMap.has(id)) {
        repoMap.set(id, repos);
      }
    }

    for (const [providerId, repos] of repoMap) {
      console.log(`  Fetching issues for ${providerId}...`);

      try {
        const issues = await getProviderIssues(providerId, {
          minReactions: 2,
          maxIssues: 15,
          repos,
        });

        for (const issue of issues) {
          await upsertKnownIssue(providerId, issue);
          totalIssues++;
        }

        console.log(`    Found ${issues.length} issues`);

        // Rate limit
        await sleep(1000);
      } catch (err) {
        console.error(`    Failed: ${err}`);
      }
    }

    return {
      task: 'github_issues',
      success: true,
      count: totalIssues,
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      task: 'github_issues',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - start,
    };
  }
}

async function updateStalePricing(): Promise<UpdateResult> {
  const start = Date.now();
  let updated = 0;

  try {
    if (!process.env.FIRECRAWL_API_KEY) {
      console.log('  Skipping: FIRECRAWL_API_KEY not set');
      return { task: 'pricing', success: true, count: 0, duration: Date.now() - start };
    }

    // Build pricing URL map from Turso
    const tursoPricingUrls = await getProvidersWithPricingUrls();
    const pricingUrlMap = new Map(tursoPricingUrls.map(p => [p.id, p.pricingUrl]));

    const staleProviders = await getStaleProviders(7);
    console.log(`  Found ${staleProviders.length} providers with stale pricing`);

    // Scrape up to 3 stale providers per run to stay within free tier
    for (const provider of staleProviders.slice(0, 3)) {
      console.log(`    Scraping ${provider.id}...`);
      try {
        const pricingUrl = pricingUrlMap.get(provider.id);
        const result = await scrapePricing(provider.id, { pricingUrl });
        if (result.success && result.data) {
          await insertPricing(provider.id, {
            type: result.data.extracted.type ?? 'usage',
            currency: 'USD',
            freeTier: result.data.extracted.freeTier,
            unitPricing: result.data.extracted.unitPricing,
            plans: result.data.extracted.plans,
            lastVerified: result.data.scrapedAt,
            source: result.data.source,
          });
          updated++;
          console.log(`      Updated (confidence: ${result.data.confidence})`);
        } else {
          console.log(`      Failed: ${result.error}`);
        }
        await sleep(2000);
      } catch (err) {
        console.error(`      Error: ${err}`);
      }
    }

    return { task: 'pricing', success: true, count: updated, duration: Date.now() - start };
  } catch (error) {
    return {
      task: 'pricing',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - start,
    };
  }
}

async function runDiscovery(): Promise<UpdateResult> {
  const start = Date.now();

  // Only run on 1st and 15th of the month (biweekly)
  const dayOfMonth = new Date().getDate();
  if (dayOfMonth !== 1 && dayOfMonth !== 15) {
    console.log('  Skipping: only runs on 1st and 15th');
    return { task: 'discovery', success: true, count: 0, duration: 0 };
  }

  if (!process.env.EXA_API_KEY) {
    console.log('  Skipping: EXA_API_KEY not set');
    return { task: 'discovery', success: true, count: 0, duration: Date.now() - start };
  }

  try {
    console.log('  Running discovery across all categories...');
    const results = await discoverAndInsertAll();
    let total = 0;
    for (const count of results.values()) total += count;
    return { task: 'discovery', success: true, count: total, duration: Date.now() - start };
  } catch (error) {
    return {
      task: 'discovery',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - start,
    };
  }
}

async function refreshStaleMetadata(): Promise<UpdateResult> {
  const start = Date.now();

  if (!process.env.FIRECRAWL_API_KEY) {
    console.log('  Skipping: FIRECRAWL_API_KEY not set');
    return { task: 'metadata_refresh', success: true, count: 0, duration: Date.now() - start };
  }

  try {
    // Get providers with last_verified older than 30 days
    const stale = await getStaleProviders(30);
    const withWebsites = stale
      .filter(p => p.website)
      .map(p => ({ id: p.id, website: p.website! }));

    if (withWebsites.length === 0) {
      console.log('  No stale providers with websites to refresh');
      return { task: 'metadata_refresh', success: true, count: 0, duration: Date.now() - start };
    }

    console.log(`  Found ${withWebsites.length} stale providers, refreshing up to 2...`);
    const results = await refreshStaleProviderMetadata(withWebsites, 2);
    const updated = results.filter(r => r.fieldsUpdated.length > 0).length;

    return { task: 'metadata_refresh', success: true, count: updated, duration: Date.now() - start };
  } catch (error) {
    return {
      task: 'metadata_refresh',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - start,
    };
  }
}

async function runAgentProviderRefresh(): Promise<UpdateResult> {
  const start = Date.now();
  const today = new Date().getDay();
  const isMonday = today === 1;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('  Skipping: ANTHROPIC_API_KEY not set');
    return { task: 'agent_refresh', success: true, count: 0, duration: Date.now() - start };
  }

  try {
    // Mondays: full refresh of all providers
    // Other days: only refresh high-priority categories (ai, ai-orchestration, ai-audio, ai-video, ai-image)
    const highPriorityOnly = !isMonday;
    if (highPriorityOnly) {
      console.log('  Running high-priority categories only (full refresh on Mondays)');
    }
    const refreshResults = await runAgentRefresh({ full: false, dryRun: false, highPriorityOnly });
    const updated = refreshResults.filter(r => r.status === 'updated').length;
    return { task: 'agent_refresh', success: true, count: updated, duration: Date.now() - start };
  } catch (error) {
    return {
      task: 'agent_refresh',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - start,
    };
  }
}

async function runBootstrapDiscovery(): Promise<UpdateResult> {
  const start = Date.now();

  // Only run on 1st of the month (monthly)
  const dayOfMonth = new Date().getDate();
  if (dayOfMonth !== 1) {
    console.log('  Skipping: only runs on 1st of month');
    return { task: 'bootstrap', success: true, count: 0, duration: 0 };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('  Skipping: ANTHROPIC_API_KEY not set');
    return { task: 'bootstrap', success: true, count: 0, duration: Date.now() - start };
  }

  if (!process.env.EXA_API_KEY) {
    console.log('  Skipping: EXA_API_KEY not set');
    return { task: 'bootstrap', success: true, count: 0, duration: Date.now() - start };
  }

  try {
    console.log('  Running bootstrap discovery (monthly)...');
    const results = await bootstrapAll({ dryRun: false });
    const totalRegistered = results.reduce((s, r) => s + r.registered, 0);
    return { task: 'bootstrap', success: true, count: totalRegistered, duration: Date.now() - start };
  } catch (error) {
    return {
      task: 'bootstrap',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - start,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  // Verify write token is available
  if (!process.env.TURSO_WRITE_TOKEN) {
    console.error('Error: TURSO_WRITE_TOKEN is required for daily updates');
    process.exit(1);
  }

  console.log('=== stacksherpa Daily Update ===');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const results: UpdateResult[] = [];

  // 1. Update GitHub issues
  console.log('1. Updating GitHub issues...');
  results.push(await updateGitHubIssues());

  // 2. Update stale pricing
  console.log('\n2. Checking stale pricing...');
  results.push(await updateStalePricing());

  // 3. Discover new APIs (biweekly)
  console.log('\n3. API discovery...');
  results.push(await runDiscovery());

  // 4. Refresh stale metadata (daily)
  console.log('\n4. Metadata refresh...');
  results.push(await refreshStaleMetadata());

  // 5. Agent-powered provider refresh (weekly, Mondays)
  console.log('\n5. Agent provider refresh...');
  results.push(await runAgentProviderRefresh());

  // 6. Bootstrap discovery (monthly, 1st of month)
  console.log('\n6. Bootstrap discovery...');
  results.push(await runBootstrapDiscovery());

  // Summary
  console.log('\n=== Summary ===');
  for (const result of results) {
    const status = result.success ? 'OK' : 'FAIL';
    const count = result.count !== undefined ? ` (${result.count} items)` : '';
    const duration = `${(result.duration / 1000).toFixed(1)}s`;
    console.log(`${status} ${result.task}${count} - ${duration}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }

  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.log(`\n${failed.length} task(s) failed`);
    process.exit(1);
  }

  console.log('\nAll tasks completed');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
