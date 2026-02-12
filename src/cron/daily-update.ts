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

import { upsertKnownIssue, getStaleProviders } from '../db/client.js';
import { getProviderIssues, providerRepos } from '../scrapers/sources/github-issues.js';
// import { scrapePricing } from '../scrapers/sources/pricing.js';
// import { scrapeArtificialAnalysis } from '../scrapers/sources/benchmarks.js';

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

  try {
    const staleProviders = await getStaleProviders(7);
    console.log(`  Found ${staleProviders.length} providers with stale pricing`);

    // TODO: Implement Firecrawl pricing scraping
    // For now, just report
    for (const provider of staleProviders.slice(0, 5)) {
      console.log(`    - ${provider.id}: last verified ${provider.last_verified ?? 'never'}`);
    }

    return {
      task: 'pricing',
      success: true,
      count: 0,  // TODO: actual count when implemented
      duration: Date.now() - start,
    };
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
    return {
      task: 'ai_benchmarks',
      success: true,
      count: 0,
      duration: 0,
    };
  }

  try {
    console.log('  Updating AI benchmarks (weekly)...');

    // TODO: Implement benchmark scraping
    // - LMArena
    // - Artificial Analysis

    return {
      task: 'ai_benchmarks',
      success: true,
      count: 0,
      duration: Date.now() - start,
    };
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
