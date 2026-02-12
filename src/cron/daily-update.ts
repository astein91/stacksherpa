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
 * 1. GitHub issues (known bugs)
 * 2. Pricing (for stale providers)
 * 3. AI benchmarks (weekly)
 * 4. API discovery (weekly, Wednesdays)
 * 5. Metadata refresh (daily, up to 3 providers)
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
import { scrapeLMArena, scrapeArtificialAnalysis, modelNameMap } from '../scrapers/sources/benchmarks.js';
import { discoverAndInsertAll } from '../scrapers/sources/discovery.js';
import { refreshStaleProviderMetadata } from '../scrapers/sources/metadata-refresh.js';

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

    // Scrape up to 5 stale providers per run to stay within rate limits
    for (const provider of staleProviders.slice(0, 5)) {
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

async function updateAiBenchmarks(): Promise<UpdateResult> {
  const start = Date.now();

  // Only run on Mondays (weekly)
  const today = new Date().getDay();
  if (today !== 1) {
    console.log('  Skipping: only runs on Mondays');
    return { task: 'ai_benchmarks', success: true, count: 0, duration: 0 };
  }

  if (!process.env.FIRECRAWL_API_KEY) {
    console.log('  Skipping: FIRECRAWL_API_KEY not set');
    return { task: 'ai_benchmarks', success: true, count: 0, duration: Date.now() - start };
  }

  let collected = 0;

  try {
    console.log('  Updating AI benchmarks (weekly)...');

    // 1. LMArena leaderboard
    console.log('    Scraping LMArena leaderboard...');
    const lmResult = await scrapeLMArena();
    if (lmResult.success && lmResult.data) {
      console.log(`    Got ${lmResult.data.length} entries from LMArena`);
      collected += lmResult.data.length;
    } else {
      console.log(`    LMArena failed: ${lmResult.error}`);
    }

    await sleep(2000);

    // 2. Artificial Analysis per model
    for (const modelId of Object.keys(modelNameMap)) {
      console.log(`    Scraping Artificial Analysis for ${modelId}...`);
      const aaResult = await scrapeArtificialAnalysis(modelId);
      if (aaResult.success && aaResult.data) {
        console.log(`      Got ${aaResult.data.benchmarks.length} metrics`);
        collected++;
      } else {
        console.log(`      Failed: ${aaResult.error}`);
      }
      await sleep(2000);
    }

    return { task: 'ai_benchmarks', success: true, count: collected, duration: Date.now() - start };
  } catch (error) {
    return {
      task: 'ai_benchmarks',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - start,
    };
  }
}

async function runDiscovery(): Promise<UpdateResult> {
  const start = Date.now();

  // Only run on Wednesdays (weekly)
  const today = new Date().getDay();
  if (today !== 3) {
    console.log('  Skipping: only runs on Wednesdays');
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

    console.log(`  Found ${withWebsites.length} stale providers, refreshing up to 3...`);
    const results = await refreshStaleProviderMetadata(withWebsites, 3);
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

  // 3. Update AI benchmarks (weekly)
  console.log('\n3. AI benchmarks...');
  results.push(await updateAiBenchmarks());

  // 4. Discover new APIs (weekly, Wednesdays)
  console.log('\n4. API discovery...');
  results.push(await runDiscovery());

  // 5. Refresh stale metadata (daily)
  console.log('\n5. Metadata refresh...');
  results.push(await refreshStaleMetadata());

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
