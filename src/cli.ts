#!/usr/bin/env node
/**
 * stacksherpa CLI
 *
 * Commander.js entry point wrapping the same business logic as the MCP server.
 * Output is JSON to stdout (for Claude to parse). Use --pretty for human-readable output.
 *
 * For backward compatibility, pass --mcp or set STACKSHERPA_MODE=mcp to start the MCP server.
 */

import { Command } from 'commander';
import { basename } from 'path';

// Database
import {
  getProvidersByCategoryEnriched,
  getProviderById,
  getCategories,
} from './db/client.js';

// Profile management
import {
  loadEffectiveProfile,
  updateProjectProfile,
  summarizeProfile,
  detectGaps,
} from './profile.js';

// Decision & taste
import {
  recordDecision as recordLocalDecision,
  getDecisionsByCategory,
  getDecisionsByApi,
  getAllExperienceSummaries,
  getDecision,
  updateDecision,
} from './decisions.js';

// Projects
import {
  getAllProjects,
  removeProject,
  updateProject,
  pruneStaleProjects,
  ensureProjectRegistered,
} from './projects.js';

// Types
import type { Gap } from './types.js';
import { categoryAliases } from './categories.js';

const projectDir = process.env.API_BROKER_PROJECT_DIR ?? process.cwd();

function normalizeCategory(category: string): string {
  const lower = category.toLowerCase().trim();
  return categoryAliases[lower] ?? lower;
}

function output(data: unknown, pretty: boolean): void {
  process.stdout.write(JSON.stringify(data, null, pretty ? 2 : 0) + '\n');
}

// ============================================
// MCP backward compat check
// ============================================

if (process.argv.includes('--mcp') || process.env.STACKSHERPA_MODE === 'mcp') {
  import('./server.js');
} else {
  const program = new Command();

  program
    .name('stacksherpa')
    .description('Intelligent API recommendation engine')
    .version('1.0.2')
    .option('--pretty', 'Pretty-print JSON output');

  // ==================
  // providers <category>
  // ==================
  program
    .command('providers <category>')
    .description('Get all providers for a category with profile and decisions')
    .action(async (category: string) => {
      const pretty = program.opts().pretty ?? false;
      const normalized = normalizeCategory(category);

      const [providers, profileResult, pastDecisions] = await Promise.all([
        getProvidersByCategoryEnriched(normalized),
        loadEffectiveProfile(projectDir),
        getDecisionsByCategory(normalized),
      ]);

      const { effective } = profileResult;
      const gaps: Gap[] = detectGaps(effective, normalized);

      output({
        category: normalized,
        providers,
        profile: {
          summary: summarizeProfile(effective),
          effective,
          gaps: gaps.length > 0 ? gaps : undefined,
        },
        pastDecisions: pastDecisions.length > 0 ? pastDecisions : undefined,
      }, pretty);
    });

  // ==================
  // provider <id>
  // ==================
  program
    .command('provider <id>')
    .description('Get detailed information about a specific provider')
    .action(async (id: string) => {
      const pretty = program.opts().pretty ?? false;
      const provider = await getProviderById(id);

      if (!provider) {
        output({ error: `Provider not found: ${id}` }, pretty);
        process.exit(1);
      }

      const providerDecisions = await getDecisionsByApi(provider.name);

      output({
        provider,
        pastDecisions: providerDecisions.length > 0 ? providerDecisions : undefined,
      }, pretty);
    });

  // ==================
  // categories
  // ==================
  program
    .command('categories')
    .description('List all available API categories with provider counts')
    .action(async () => {
      const pretty = program.opts().pretty ?? false;
      const categories = await getCategories();
      output(categories, pretty);
    });

  // ==================
  // profile
  // ==================
  program
    .command('profile')
    .description('Show or update the project profile')
    .option('--set <json>', 'Set dot-path keys (JSON object)')
    .option('--append <json>', 'Append to arrays (JSON object)')
    .option('--remove <json>', 'Remove from arrays or delete keys (JSON object)')
    .action(async (opts: { set?: string; append?: string; remove?: string }) => {
      const pretty = program.opts().pretty ?? false;

      // If any mutation flags are provided, update the profile
      if (opts.set || opts.append || opts.remove) {
        const set = opts.set ? JSON.parse(opts.set) : undefined;
        const append = opts.append ? JSON.parse(opts.append) : undefined;
        const remove = opts.remove ? JSON.parse(opts.remove) : undefined;

        const result = await updateProjectProfile(projectDir, { set, append, remove });
        output(result, pretty);
        return;
      }

      // Otherwise, show the profile
      const [profileResult, experiences] = await Promise.all([
        loadEffectiveProfile(projectDir),
        getAllExperienceSummaries(),
      ]);

      const { effective, globalDefaults, localProfile, mergeDetails } = profileResult;

      output({
        summary: summarizeProfile(effective),
        effective,
        globalDefaults,
        localProfile,
        mergeDetails,
        recentDecisions: experiences.slice(0, 20),
        projectDir,
      }, pretty);
    });

  // ==================
  // decide
  // ==================
  program
    .command('decide')
    .description('Record an API selection decision')
    .requiredOption('--api <name>', 'The API/provider chosen (e.g., "Resend")')
    .requiredOption('--category <cat>', 'The category (e.g., "email")')
    .requiredOption('--outcome <outcome>', 'How the integration went (positive|negative|neutral)')
    .option('--context <ctx>', 'Context for the decision')
    .option('--notes <notes>', 'Additional notes')
    .option('--notes-private', 'Keep notes private from global taste')
    .action(async (opts: {
      api: string;
      category: string;
      outcome: string;
      context?: string;
      notes?: string;
      notesPrivate?: boolean;
    }) => {
      const pretty = program.opts().pretty ?? false;

      await ensureProjectRegistered(projectDir, basename(projectDir));

      const decision = await recordLocalDecision(projectDir, {
        api: opts.api,
        category: normalizeCategory(opts.category),
        outcome: opts.outcome as 'positive' | 'negative' | 'neutral',
        context: opts.context,
        notes: opts.notes,
        notesPrivate: opts.notesPrivate,
      });

      output({ recorded: true, decisionId: decision.id }, pretty);
    });

  // ==================
  // report
  // ==================
  program
    .command('report')
    .description('Report the outcome of using a recommended API')
    .requiredOption('--id <decisionId>', 'The decision ID')
    .option('--success', 'Integration succeeded')
    .option('--failure', 'Integration failed')
    .option('--stage <stage>', 'Where the failure occurred (setup|build|runtime|quota|auth|platform)')
    .option('--notes <notes>', 'Additional notes')
    .action(async (opts: {
      id: string;
      success?: boolean;
      failure?: boolean;
      stage?: string;
      notes?: string;
    }) => {
      const pretty = program.opts().pretty ?? false;
      const success = opts.success === true || opts.failure !== true;

      try {
        const decision = await getDecision(projectDir, opts.id);
        if (decision) {
          const outcomeNote = [
            opts.notes,
            `outcome: ${success ? 'success' : 'failure'}`,
            opts.stage ? `stage: ${opts.stage}` : null,
          ].filter(Boolean).join('; ');

          await updateDecision(projectDir, opts.id, {
            outcome: success ? 'positive' : 'negative',
            notes: outcomeNote,
          });
        }

        output({ recorded: true }, pretty);
      } catch {
        output({ error: 'Failed to record outcome' }, pretty);
        process.exit(1);
      }
    });

  // ==================
  // projects
  // ==================
  program
    .command('projects <action>')
    .description('Manage the project registry (list|update|remove|prune)')
    .option('--path <path>', 'Project path (for update/remove)')
    .option('--name <name>', 'Project name (for update)')
    .option('--share', 'Share to global taste (for update)')
    .option('--no-share', 'Don\'t share to global taste (for update)')
    .action(async (action: string, opts: {
      path?: string;
      name?: string;
      share?: boolean;
    }) => {
      const pretty = program.opts().pretty ?? false;

      if (action === 'list') {
        const projects = await getAllProjects();
        output({ projects }, pretty);
        return;
      }

      if (action === 'update' && opts.path) {
        const updates: { name?: string; shareToGlobalTaste?: boolean } = {};
        if (opts.name) updates.name = opts.name;
        if (opts.share !== undefined) updates.shareToGlobalTaste = opts.share;

        const updated = await updateProject(opts.path, updates);
        output({ success: updated !== null, project: updated }, pretty);
        return;
      }

      if (action === 'remove' && opts.path) {
        const removed = await removeProject(opts.path);
        output({ success: removed }, pretty);
        return;
      }

      if (action === 'prune') {
        const pruned = await pruneStaleProjects();
        output({ pruned, count: pruned.length }, pretty);
        return;
      }

      output({ error: 'Invalid action or missing parameters' }, pretty);
      process.exit(1);
    });

  program.parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
