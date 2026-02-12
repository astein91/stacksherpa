/**
 * Freshness Check Job
 *
 * Identifies stale data that needs updating
 */

import type { FreshnessCheck } from '../types.js';
import type { KnownProvider } from '../../types.js';
import { knowledgeBase } from '../../knowledge.js';

// Freshness thresholds (in days)
const THRESHOLDS = {
  pricing: { fresh: 7, stale: 30 },
  benchmarks: { fresh: 14, stale: 60 },
  latency: { fresh: 7, stale: 30 },
  reliability: { fresh: 1, stale: 7 },
  general: { fresh: 30, stale: 90 },
};

function daysSince(dateStr: string | undefined): number {
  if (!dateStr) return Infinity;
  const date = new Date(dateStr);
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function getStatus(
  days: number,
  threshold: { fresh: number; stale: number }
): 'fresh' | 'stale' | 'critical' {
  if (days <= threshold.fresh) return 'fresh';
  if (days <= threshold.stale) return 'stale';
  return 'critical';
}

export function checkProviderFreshness(provider: KnownProvider): FreshnessCheck[] {
  const checks: FreshnessCheck[] = [];
  const providerId = provider.id ?? provider.name.toLowerCase().replace(/\s+/g, '-');

  // Overall lastVerified
  const overallDays = daysSince(provider.lastVerified);
  checks.push({
    providerId,
    field: 'lastVerified',
    lastVerified: provider.lastVerified ?? 'never',
    daysSinceVerified: overallDays,
    status: getStatus(overallDays, THRESHOLDS.general),
    suggestedAction: overallDays > THRESHOLDS.general.stale
      ? 'Full provider review needed'
      : undefined,
  });

  // Pricing freshness
  if (provider.pricing?.lastVerified) {
    const pricingDays = daysSince(provider.pricing.lastVerified);
    checks.push({
      providerId,
      field: 'pricing',
      lastVerified: provider.pricing.lastVerified,
      daysSinceVerified: pricingDays,
      status: getStatus(pricingDays, THRESHOLDS.pricing),
      suggestedAction: pricingDays > THRESHOLDS.pricing.stale
        ? 'Re-scrape pricing page'
        : undefined,
    });
  } else if (provider.pricing) {
    checks.push({
      providerId,
      field: 'pricing',
      lastVerified: 'never',
      daysSinceVerified: Infinity,
      status: 'critical',
      suggestedAction: 'Add lastVerified to pricing data',
    });
  }

  // Latency freshness
  if (provider.latency?.measuredAt) {
    const latencyDays = daysSince(provider.latency.measuredAt);
    checks.push({
      providerId,
      field: 'latency',
      lastVerified: provider.latency.measuredAt,
      daysSinceVerified: latencyDays,
      status: getStatus(latencyDays, THRESHOLDS.latency),
      suggestedAction: latencyDays > THRESHOLDS.latency.stale
        ? 'Re-measure latency metrics'
        : undefined,
    });
  }

  // AI Benchmarks freshness
  if (provider.aiBenchmarks) {
    const benchmarkDates = [
      provider.aiBenchmarks.lmArena?.measuredAt,
      provider.aiBenchmarks.artificialAnalysis?.measuredAt,
      ...(provider.aiBenchmarks.benchmarks?.map(b => b.measuredAt) ?? []),
    ].filter(Boolean);

    if (benchmarkDates.length > 0) {
      const oldestDate = benchmarkDates.sort()[0];
      const benchmarkDays = daysSince(oldestDate);
      checks.push({
        providerId,
        field: 'aiBenchmarks',
        lastVerified: oldestDate!,
        daysSinceVerified: benchmarkDays,
        status: getStatus(benchmarkDays, THRESHOLDS.benchmarks),
        suggestedAction: benchmarkDays > THRESHOLDS.benchmarks.stale
          ? 'Update AI benchmark scores'
          : undefined,
      });
    }
  }

  // Reliability freshness
  if (provider.reliability?.measuredAt) {
    const reliabilityDays = daysSince(provider.reliability.measuredAt);
    checks.push({
      providerId,
      field: 'reliability',
      lastVerified: provider.reliability.measuredAt,
      daysSinceVerified: reliabilityDays,
      status: getStatus(reliabilityDays, THRESHOLDS.reliability),
      suggestedAction: reliabilityDays > THRESHOLDS.reliability.stale
        ? 'Check status page for updates'
        : undefined,
    });
  }

  return checks;
}

export function checkAllFreshness(): {
  fresh: FreshnessCheck[];
  stale: FreshnessCheck[];
  critical: FreshnessCheck[];
  summary: {
    total: number;
    fresh: number;
    stale: number;
    critical: number;
  };
} {
  const allChecks: FreshnessCheck[] = [];

  for (const [category, providers] of Object.entries(knowledgeBase)) {
    for (const provider of providers) {
      const checks = checkProviderFreshness(provider);
      allChecks.push(...checks);
    }
  }

  const fresh = allChecks.filter(c => c.status === 'fresh');
  const stale = allChecks.filter(c => c.status === 'stale');
  const critical = allChecks.filter(c => c.status === 'critical');

  return {
    fresh,
    stale,
    critical,
    summary: {
      total: allChecks.length,
      fresh: fresh.length,
      stale: stale.length,
      critical: critical.length,
    },
  };
}

// Get providers that need immediate attention
export function getUpdateQueue(): {
  providerId: string;
  fields: string[];
  priority: 'high' | 'medium' | 'low';
}[] {
  const { stale, critical } = checkAllFreshness();

  // Group by provider
  const byProvider = new Map<string, FreshnessCheck[]>();
  for (const check of [...critical, ...stale]) {
    const existing = byProvider.get(check.providerId) ?? [];
    existing.push(check);
    byProvider.set(check.providerId, existing);
  }

  // Create queue
  const queue: {
    providerId: string;
    fields: string[];
    priority: 'high' | 'medium' | 'low';
  }[] = [];

  for (const [providerId, checks] of byProvider) {
    const hasCritical = checks.some(c => c.status === 'critical');
    const criticalCount = checks.filter(c => c.status === 'critical').length;

    queue.push({
      providerId,
      fields: checks.map(c => c.field),
      priority: hasCritical
        ? criticalCount > 2
          ? 'high'
          : 'medium'
        : 'low',
    });
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  queue.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return queue;
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkAllFreshness();
  console.log('\n=== Freshness Report ===\n');
  console.log(`Total checks: ${result.summary.total}`);
  console.log(`Fresh: ${result.summary.fresh}`);
  console.log(`Stale: ${result.summary.stale}`);
  console.log(`Critical: ${result.summary.critical}`);

  if (result.critical.length > 0) {
    console.log('\n🚨 Critical (needs immediate update):');
    for (const check of result.critical) {
      console.log(`  - ${check.providerId}.${check.field}: ${check.suggestedAction}`);
    }
  }

  if (result.stale.length > 0) {
    console.log('\n⚠️  Stale (should update soon):');
    for (const check of result.stale.slice(0, 10)) {
      console.log(`  - ${check.providerId}.${check.field}: ${check.daysSinceVerified} days old`);
    }
    if (result.stale.length > 10) {
      console.log(`  ... and ${result.stale.length - 10} more`);
    }
  }

  const queue = getUpdateQueue();
  if (queue.length > 0) {
    console.log('\n📋 Update Queue:');
    for (const item of queue.slice(0, 5)) {
      console.log(`  [${item.priority}] ${item.providerId}: ${item.fields.join(', ')}`);
    }
  }
}
