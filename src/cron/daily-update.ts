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
 */

import { upsertKnownIssue, getStaleProviders, insertPricing } from '../db/client.js';
import { getProviderIssues, providerRepos } from '../scrapers/sources/github-issues.js';
import { scrapePricing } from '../scrapers/sources/pricing.js';
import { scrapeLMArena, scrapeArtificialAnalysis, modelNameMap } from '../scrapers/sources/benchmarks.js';

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
    for (const providerId of Object.keys(providerRepos)) {
      console.log(`  Fetching issues for ${providerId}...`);

      try {
        const issues = await getProviderIssues(providerId, {
          minReactions: 2,
          maxIssues: 15,
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

    const staleProviders = await getStaleProviders(7);
    console.log(`  Found ${staleProviders.length} providers with stale pricing`);

    // Scrape up to 5 stale providers per run to stay within rate limits
    for (const provider of staleProviders.slice(0, 5)) {
      console.log(`    Scraping ${provider.id}...`);
      try {
        const result = await scrapePricing(provider.id);
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
