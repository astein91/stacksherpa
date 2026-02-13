#!/usr/bin/env tsx
/**
 * Review Pending Providers CLI
 *
 * List, approve, and reject providers discovered by the bootstrap agent.
 *
 * Usage:
 *   npm run cron:review -- --list                      List all pending providers
 *   npm run cron:review -- --list --category jobs      List pending in a category
 *   npm run cron:review -- --approve id1 id2 id3      Approve specific providers
 *   npm run cron:review -- --reject id1 id2           Reject specific providers
 *   npm run cron:review -- --approve-category jobs    Approve all pending in a category
 *   npm run cron:review -- --log                      View recent discovery log
 *   npm run cron:review -- --log --run-id <id>        View log for a specific run
 *
 * Requires: TURSO_WRITE_TOKEN (for approve/reject), TURSO_AUTH_TOKEN (for reads)
 */

import {
  getProvidersByReviewStatus,
  bulkUpdateReviewStatus,
  getDiscoveryLog,
} from '../db/client.js';

function usage(): void {
  console.log(`
Usage:
  --list                        List all pending providers
  --list --category <cat>       List pending in a specific category
  --approve <id1> [id2] ...     Approve specific provider IDs
  --reject <id1> [id2] ...      Reject specific provider IDs
  --approve-category <cat>      Approve all pending in a category
  --log                         View recent discovery log entries
  --log --run-id <id>           View log for a specific run
  --log --category <cat>        View log for a specific category
  --help                        Show this help
`.trim());
}

async function listPending(category?: string): Promise<void> {
  const providers = await getProvidersByReviewStatus('pending');
  const filtered = category
    ? providers.filter(p => p.category === category)
    : providers;

  if (filtered.length === 0) {
    console.log(category
      ? `No pending providers in "${category}" category.`
      : 'No pending providers.');
    return;
  }

  console.log(`\n=== Pending Providers (${filtered.length}) ===\n`);

  // Group by category
  const grouped = new Map<string, typeof filtered>();
  for (const p of filtered) {
    const cat = p.category ?? 'unknown';
    const list = grouped.get(cat) ?? [];
    list.push(p);
    grouped.set(cat, list);
  }

  for (const [cat, providers] of [...grouped.entries()].sort()) {
    console.log(`  ${cat} (${providers.length}):`);
    for (const p of providers) {
      const desc = p.description?.slice(0, 70) ?? 'no description';
      console.log(`    ${p.id}  —  ${p.name}  —  ${desc}`);
    }
    console.log();
  }
}

async function approveProviders(ids: string[]): Promise<void> {
  const runId = `review-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`;
  const updates = ids.map(id => ({ id, status: 'approved' as const }));

  await bulkUpdateReviewStatus(updates, runId);
  console.log(`Approved ${ids.length} provider(s): ${ids.join(', ')}`);
}

async function rejectProviders(ids: string[]): Promise<void> {
  const runId = `review-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`;
  const updates = ids.map(id => ({ id, status: 'rejected' as const }));

  await bulkUpdateReviewStatus(updates, runId);
  console.log(`Rejected ${ids.length} provider(s): ${ids.join(', ')}`);
}

async function approveCategoryProviders(category: string): Promise<void> {
  const providers = await getProvidersByReviewStatus('pending');
  const inCategory = providers.filter(p => p.category === category);

  if (inCategory.length === 0) {
    console.log(`No pending providers in "${category}" category.`);
    return;
  }

  const ids = inCategory.map(p => p.id!);
  await approveProviders(ids);
}

async function showLog(filters: { runId?: string; category?: string }): Promise<void> {
  const entries = await getDiscoveryLog({
    runId: filters.runId,
    category: filters.category,
    limit: 50,
  });

  if (entries.length === 0) {
    console.log('No discovery log entries found.');
    return;
  }

  console.log(`\n=== Discovery Log (${entries.length} entries) ===\n`);
  console.log('  DATE                 ACTION       CATEGORY          PROVIDER             REASON');
  console.log('  ' + '-'.repeat(95));

  for (const e of entries) {
    const date = e.created_at.slice(0, 19).padEnd(20);
    const action = e.action.padEnd(12);
    const category = e.category.padEnd(18);
    const name = e.provider_name.slice(0, 20).padEnd(20);
    const reason = (e.reason ?? '').slice(0, 40);
    console.log(`  ${date} ${action} ${category} ${name} ${reason}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    usage();
    return;
  }

  // Parse --category flag (used by multiple commands)
  const catIdx = args.indexOf('--category');
  const category = catIdx !== -1 ? args[catIdx + 1] : undefined;

  // Parse --run-id flag
  const runIdx = args.indexOf('--run-id');
  const runId = runIdx !== -1 ? args[runIdx + 1] : undefined;

  if (args.includes('--list')) {
    await listPending(category);
    return;
  }

  if (args.includes('--log')) {
    await showLog({ runId, category });
    return;
  }

  if (args.includes('--approve-category')) {
    const acIdx = args.indexOf('--approve-category');
    const cat = args[acIdx + 1];
    if (!cat) {
      console.error('Error: --approve-category requires a category name');
      process.exit(1);
    }
    await approveCategoryProviders(cat);
    return;
  }

  if (args.includes('--approve')) {
    const approveIdx = args.indexOf('--approve');
    const ids = args.slice(approveIdx + 1).filter(a => !a.startsWith('--'));
    if (ids.length === 0) {
      console.error('Error: --approve requires at least one provider ID');
      process.exit(1);
    }
    await approveProviders(ids);
    return;
  }

  if (args.includes('--reject')) {
    const rejectIdx = args.indexOf('--reject');
    const ids = args.slice(rejectIdx + 1).filter(a => !a.startsWith('--'));
    if (ids.length === 0) {
      console.error('Error: --reject requires at least one provider ID');
      process.exit(1);
    }
    await rejectProviders(ids);
    return;
  }

  console.error('Unknown command. Use --help for usage.');
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
