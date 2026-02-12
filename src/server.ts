#!/usr/bin/env node
/**
 * API Broker MCP Server (v2)
 *
 * Features:
 * - Profile-aware recommendations with confidence + gaps
 * - Global taste computed from decisions across projects
 * - Surgical profile updates with audit trail
 * - Auto-registration of projects
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { basename } from 'path';

// Database
import {
  getProvidersByCategory,
  getProviderById,
  getCategories,
  getProviderEcosystems,
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
  getAllExperienceSummaries,
  getDecision,
  updateDecision,
} from './decisions.js';

// Patterns
import {
  computePatterns,
  filterPatternsForCategory,
  filterExperiencesForCategory,
  describePattern,
  invalidatePatternCache,
} from './patterns.js';

// Projects
import {
  getAllProjects,
  removeProject,
  updateProject,
  pruneStaleProjects,
  ensureProjectRegistered,
} from './projects.js';

// Scoring
import { scoreProvider, type EcosystemContext } from './scoring.js';

// Types
import type {
  KnownProvider,
  EffectiveProfile,
  Gap,
  ExperienceSummary,
  ScoredPattern,
} from './types.js';
import { categoryAliases } from './knowledge.js';
import { randomUUID } from 'crypto';

const server = new Server(
  {
    name: 'stacksherpa',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const projectDir = process.env.API_BROKER_PROJECT_DIR ?? process.cwd();

function normalizeCategory(category: string): string {
  const lower = category.toLowerCase().trim();
  return categoryAliases[lower] ?? lower;
}

// ============================================
// Recommendation
// ============================================

interface RecommendResult {
  provider: string;
  package?: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  alternatives?: Array<{ provider: string; tradeoff: string }>;
  gaps?: Gap[];
  context?: {
    relevantExperiences: ExperienceSummary[];
    appliedPatterns: Array<{ signal: string; confidence: number }>;
  };
  decisionId?: string;
  catalogVersion: string;
}

async function recommend(category: string): Promise<RecommendResult> {
  const normalized = normalizeCategory(category);

  // Load effective profile
  const { effective } = await loadEffectiveProfile(projectDir);

  // Load taste (computed from all projects)
  const taste = await computePatterns();
  const categoryExperiences = filterExperiencesForCategory(taste.experiences, normalized);
  const categoryPatterns = filterPatternsForCategory(taste.patterns, normalized);

  // Get providers from database
  const providers = await getProvidersByCategory(normalized);

  if (!providers || providers.length === 0) {
    return {
      provider: 'unknown',
      confidence: 'low',
      reason: `No providers found for "${category}". Research needed.`,
      catalogVersion: '0.0.0',
    };
  }

  // Build ecosystem context from ALL positive experiences (not just this category)
  const providerEcosystems = await getProviderEcosystems();
  const usedEcosystems = new Set<string>();

  for (const exp of taste.experiences) {
    if (exp.outcome === 'positive') {
      const ecosystem = providerEcosystems.get(exp.api.toLowerCase());
      if (ecosystem) {
        usedEcosystems.add(ecosystem);
      }
    }
  }

  const ecosystemCtx: EcosystemContext = { usedEcosystems };

  // Build avoid list from preferences + negative experiences
  const avoidList = [
    ...(effective.preferences?.avoidProviders ?? []),
  ].map(s => s.toLowerCase());

  // Score and rank providers
  const scored = providers
    .filter(p => !avoidList.includes(p.name.toLowerCase()))
    .map(p => ({
      provider: p,
      score: scoreProvider(p, effective, categoryExperiences, categoryPatterns, ecosystemCtx),
    }))
    .filter(p => p.score >= 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      provider: 'none',
      confidence: 'low',
      reason: 'All providers filtered out by constraints.',
      catalogVersion: '0.0.0',
    };
  }

  const top = scored[0];

  // Build alternatives with tradeoffs
  const alternatives = scored.slice(1, 4).map(s => {
    const tradeoffs: string[] = [];
    if (s.provider.pricing?.freeTier && !top.provider.pricing?.freeTier) {
      tradeoffs.push('has free tier');
    }
    if (s.provider.strengths?.includes('dx') && !top.provider.strengths?.includes('dx')) {
      tradeoffs.push('better DX');
    }
    if (s.provider.selfHostable && !top.provider.selfHostable) {
      tradeoffs.push('self-hostable');
    }
    return {
      provider: s.provider.name,
      tradeoff: tradeoffs.length > 0 ? tradeoffs.join(', ') : 'lower score',
    };
  });

  // Build reason
  const reasons: string[] = [];
  if (effective.project?.scale) {
    reasons.push(`Best match for ${effective.project.scale} scale`);
  }
  if (top.provider.strengths?.length) {
    reasons.push(`Strong on ${top.provider.strengths.slice(0, 2).join(', ')}`);
  }

  // Add ecosystem affinity context
  if (top.provider.ecosystem && usedEcosystems.has(top.provider.ecosystem)) {
    reasons.push(`Same ecosystem as other services you're using (${top.provider.ecosystem})`);
  }

  // Add experience-based context
  const positiveExps = categoryExperiences.filter(
    e => e.api.toLowerCase() === top.provider.name.toLowerCase() && e.outcome === 'positive'
  );
  const negativeExps = categoryExperiences.filter(
    e => e.api.toLowerCase() !== top.provider.name.toLowerCase() && e.outcome === 'negative'
  );
  if (positiveExps.length > 0) {
    reasons.push(`You had good experiences with this before`);
  }
  if (negativeExps.length > 0) {
    reasons.push(`Avoiding ${negativeExps.map(e => e.api).join(', ')} based on past issues`);
  }

  // Calculate confidence
  const gaps = detectGaps(effective, normalized);
  const highImpactGaps = gaps.filter(g => g.impact === 'high');
  const confidence: 'high' | 'medium' | 'low' =
    top.score >= 30 && highImpactGaps.length === 0 ? 'high' :
    top.score >= 15 && highImpactGaps.length <= 1 ? 'medium' :
    'low';

  const decisionId = randomUUID();

  return {
    provider: top.provider.name,
    package: top.provider.package,
    confidence,
    reason: reasons.join('. ') + '.',
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    gaps: gaps.length > 0 ? gaps : undefined,
    context: {
      relevantExperiences: categoryExperiences.slice(0, 5),
      appliedPatterns: categoryPatterns.slice(0, 5).map(p => ({
        signal: p.signal,
        confidence: p.confidence,
      })),
    },
    decisionId,
    catalogVersion: '2.0.0',
  };
}

// ============================================
// Tool Definitions
// ============================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'recommend',
        description:
          'Get an instant API recommendation for a category. Returns the best provider based on project profile, constraints, and cross-project taste history. Includes confidence level and gaps that would improve the recommendation.',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'The API category (e.g., "email", "payments", "auth", "sms", "storage", "database", "analytics", "search", "monitoring", "ai", "push")',
            },
          },
          required: ['category'],
        },
      },
      {
        name: 'get_profile',
        description:
          'Get the current API preference profile for this project. Shows effective profile (merged global + local), global defaults, local overrides, computed taste from all projects, and merge details.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'update_project_profile',
        description:
          'Update the project profile with surgical operations. Supports set (overwrite), append (add to array), and remove (delete from array or delete key). Returns audit trail of changes.',
        inputSchema: {
          type: 'object',
          properties: {
            set: {
              type: 'object',
              description: 'Dot-path keys to set (e.g., {"constraints.compliance": ["SOC2"]})',
            },
            append: {
              type: 'object',
              description: 'Dot-path keys to append to arrays (e.g., {"preferences.avoidProviders": "SendGrid"})',
            },
            remove: {
              type: 'object',
              description: 'Dot-path keys to remove from arrays or delete entirely (use true to delete key)',
            },
          },
        },
      },
      {
        name: 'record_decision',
        description:
          'Record an API selection decision. Writes to local project history and contributes to global taste for future recommendations.',
        inputSchema: {
          type: 'object',
          properties: {
            api: {
              type: 'string',
              description: 'The API/provider chosen (e.g., "Resend", "Stripe")',
            },
            category: {
              type: 'string',
              description: 'The category (e.g., "email", "payments")',
            },
            outcome: {
              type: 'string',
              enum: ['positive', 'negative', 'neutral'],
              description: 'How the integration went',
            },
            context: {
              type: 'string',
              description: 'Context for the decision (e.g., "high volume", "billing portal")',
            },
            notes: {
              type: 'string',
              description: 'Additional notes about the experience',
            },
            notesPrivate: {
              type: 'boolean',
              description: 'If true, notes will not be shared to global taste',
            },
          },
          required: ['api', 'category', 'outcome'],
        },
      },
      {
        name: 'get_provider',
        description:
          'Get detailed information about a specific provider, including pricing, known issues, and benchmarks.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Provider ID (e.g., "openai", "stripe", "clerk")',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'list_categories',
        description:
          'List all available API categories with provider counts.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'manage_projects',
        description:
          'Manage the project registry. List all registered projects, update settings, or remove stale entries.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'update', 'remove', 'prune'],
              description: 'Action to perform',
            },
            path: {
              type: 'string',
              description: 'Project path (for update/remove)',
            },
            updates: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                shareToGlobalTaste: { type: 'boolean' },
              },
              description: 'Updates to apply (for update action)',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'get_search_strategy',
        description:
          'Get search queries and focus areas for researching an API need. Tailored to the project profile.',
        inputSchema: {
          type: 'object',
          properties: {
            need: {
              type: 'string',
              description: 'The API capability needed (e.g., "transactional email", "payment gateway")',
            },
          },
          required: ['need'],
        },
      },
      {
        name: 'report_outcome',
        description:
          'Report the outcome of using a recommended API. Updates the local decision record.',
        inputSchema: {
          type: 'object',
          properties: {
            decisionId: {
              type: 'string',
              description: 'The decision ID from the recommendation',
            },
            success: {
              type: 'boolean',
              description: 'Whether the integration succeeded',
            },
            stage: {
              type: 'string',
              enum: ['setup', 'build', 'runtime', 'quota', 'auth', 'platform'],
              description: 'Where the failure occurred (if failed)',
            },
            notes: {
              type: 'string',
              description: 'Additional notes about the experience',
            },
          },
          required: ['decisionId', 'success'],
        },
      },
    ],
  };
});

// ============================================
// Tool Handlers
// ============================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ==================
  // recommend
  // ==================
  if (name === 'recommend') {
    const { category } = args as { category: string };
    const result = await recommend(category);

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }

  // ==================
  // get_profile
  // ==================
  if (name === 'get_profile') {
    const {
      effective,
      globalDefaults,
      localProfile,
      mergeDetails,
    } = await loadEffectiveProfile(projectDir);

    // Get taste summary
    const taste = await computePatterns();
    const tasteSummary = {
      experienceCount: taste.experiences.length,
      recentExperiences: taste.experiences.slice(0, 10),
      topPatterns: taste.patterns
        .filter(p => p.confidence > 0.3)
        .slice(0, 10)
        .map(p => ({
          ...p,
          description: describePattern(p),
        })),
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          summary: summarizeProfile(effective),
          effective,
          globalDefaults,
          localProfile,
          mergeDetails,
          taste: tasteSummary,
          projectDir,
        }, null, 2),
      }],
    };
  }

  // ==================
  // update_project_profile
  // ==================
  if (name === 'update_project_profile') {
    const { set, append, remove } = args as {
      set?: Record<string, unknown>;
      append?: Record<string, unknown>;
      remove?: Record<string, unknown>;
    };

    const result = await updateProjectProfile(projectDir, { set, append, remove });

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }

  // ==================
  // record_decision
  // ==================
  if (name === 'record_decision') {
    const { api, category, outcome, context, notes, notesPrivate } = args as {
      api: string;
      category: string;
      outcome: 'positive' | 'negative' | 'neutral';
      context?: string;
      notes?: string;
      notesPrivate?: boolean;
    };

    // Ensure project is registered
    await ensureProjectRegistered(projectDir, basename(projectDir));

    // Record locally (canonical)
    const decision = await recordLocalDecision(projectDir, {
      api,
      category: normalizeCategory(category),
      outcome,
      context,
      notes,
      notesPrivate,
    });

    // Invalidate cache and recompute patterns to show any new inferences
    invalidatePatternCache();
    const taste = await computePatterns();
    const newPatterns = taste.patterns
      .filter(p =>
        p.signal.toLowerCase().includes(api.toLowerCase()) ||
        p.signal.includes(`:${category.toLowerCase()}`)
      )
      .slice(0, 3);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          recorded: true,
          decisionId: decision.id,
          addedToProject: true,
          newPatterns: newPatterns.map(p => ({
            signal: p.signal,
            confidence: p.confidence,
            description: describePattern(p),
          })),
        }, null, 2),
      }],
    };
  }

  // ==================
  // get_provider
  // ==================
  if (name === 'get_provider') {
    const { id } = args as { id: string };
    const provider = await getProviderById(id);

    if (!provider) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Provider not found: ${id}` }) }],
      };
    }

    // Also get any experiences with this provider
    const taste = await computePatterns();
    const providerExperiences = taste.experiences.filter(
      e => e.api.toLowerCase() === provider.name.toLowerCase()
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          provider,
          userExperiences: providerExperiences,
        }, null, 2),
      }],
    };
  }

  // ==================
  // list_categories
  // ==================
  if (name === 'list_categories') {
    const categories = await getCategories();

    return {
      content: [{ type: 'text', text: JSON.stringify(categories, null, 2) }],
    };
  }

  // ==================
  // manage_projects
  // ==================
  if (name === 'manage_projects') {
    const { action, path, updates } = args as {
      action: 'list' | 'update' | 'remove' | 'prune';
      path?: string;
      updates?: { name?: string; shareToGlobalTaste?: boolean };
    };

    if (action === 'list') {
      const projects = await getAllProjects();
      return {
        content: [{ type: 'text', text: JSON.stringify({ projects }, null, 2) }],
      };
    }

    if (action === 'update' && path && updates) {
      const updated = await updateProject(path, updates);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: updated !== null,
            project: updated,
          }, null, 2),
        }],
      };
    }

    if (action === 'remove' && path) {
      const removed = await removeProject(path);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: removed }, null, 2),
        }],
      };
    }

    if (action === 'prune') {
      const pruned = await pruneStaleProjects();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            pruned,
            count: pruned.length,
          }, null, 2),
        }],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Invalid action or missing parameters' }) }],
    };
  }

  // ==================
  // get_search_strategy
  // ==================
  if (name === 'get_search_strategy') {
    const { need } = args as { need: string };
    const { effective } = await loadEffectiveProfile(projectDir);
    const summary = summarizeProfile(effective);

    // Build tailored search queries
    const queries: string[] = [];
    const focusAreas: string[] = [];

    // Base query
    queries.push(`best ${need} API ${new Date().getFullYear()}`);

    // Compliance-specific
    if (effective.constraints?.compliance?.length) {
      for (const comp of effective.constraints.compliance) {
        queries.push(`${need} API ${comp} compliant`);
      }
      focusAreas.push('Verify compliance certifications');
    }

    // Scale-specific
    if (effective.project?.scale) {
      queries.push(`${need} API for ${effective.project.scale}`);
      if (effective.project.scale === 'enterprise') {
        focusAreas.push('Check SLAs and support tiers');
      }
    }

    // Stack-specific
    if (effective.project?.stack?.language) {
      queries.push(`${need} ${effective.project.stack.language} SDK`);
      focusAreas.push(`Verify ${effective.project.stack.language} SDK quality`);
    }

    // Region-specific
    if (effective.project?.regions?.length) {
      focusAreas.push(`Check availability in: ${effective.project.regions.join(', ')}`);
    }

    // Self-hosted
    if (effective.constraints?.selfHosted) {
      queries.push(`${need} self-hosted open source`);
      focusAreas.push('Evaluate self-hosting complexity');
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          need,
          profileSummary: summary,
          queries,
          focusAreas,
          instructions: 'Run these searches and focus on the listed areas based on the project profile.',
        }, null, 2),
      }],
    };
  }

  // ==================
  // report_outcome
  // ==================
  if (name === 'report_outcome') {
    const { decisionId, success, stage, notes } = args as {
      decisionId: string;
      success: boolean;
      stage?: string;
      notes?: string;
    };

    // Update the local decision record with outcome info
    try {
      const decision = await getDecision(projectDir, decisionId);
      if (decision) {
        const outcomeNote = [
          notes,
          `outcome: ${success ? 'success' : 'failure'}`,
          stage ? `stage: ${stage}` : null,
        ].filter(Boolean).join('; ');

        await updateDecision(projectDir, decisionId, {
          outcome: success ? 'positive' : 'negative',
          notes: outcomeNote,
        });
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ recorded: true }) }],
      };
    } catch {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to record outcome' }) }],
      };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

// ============================================
// Main
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('stacksherpa MCP server v2.0.0 running');
}

main().catch(console.error);
