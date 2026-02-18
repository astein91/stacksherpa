#!/usr/bin/env node
/**
 * @deprecated Use src/cli.ts instead. This MCP server is kept for backward
 * compatibility and can be invoked via `stacksherpa --mcp` or `npm run start:mcp`.
 *
 * API Broker MCP Server (v3)
 *
 * Pure data provider — returns all providers, profile, and history.
 * Claude (the host LLM) handles analysis and provider selection.
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

const server = new Server(
  {
    name: 'stacksherpa',
    version: '3.0.0',
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
// Tool Definitions
// ============================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_providers',
        description:
          'Get all providers for a category with pricing, issues, benchmarks, plus the project profile and past decisions. Returns everything needed to pick the best provider.',
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
          'Get the current API preference profile for this project. Shows effective profile (merged global + local), global defaults, local overrides, and past decisions.',
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
  // get_providers
  // ==================
  if (name === 'get_providers') {
    const { category } = args as { category: string };
    const normalized = normalizeCategory(category);

    // Load everything in parallel
    const [providers, profileResult, pastDecisions] = await Promise.all([
      getProvidersByCategoryEnriched(normalized),
      loadEffectiveProfile(projectDir),
      getDecisionsByCategory(normalized),
    ]);

    const { effective } = profileResult;
    const gaps: Gap[] = detectGaps(effective, normalized);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          category: normalized,
          providers,
          profile: {
            summary: summarizeProfile(effective),
            effective,
            gaps: gaps.length > 0 ? gaps : undefined,
          },
          pastDecisions: pastDecisions.length > 0 ? pastDecisions : undefined,
        }, null, 2),
      }],
    };
  }

  // ==================
  // get_profile
  // ==================
  if (name === 'get_profile') {
    const [profileResult, experiences] = await Promise.all([
      loadEffectiveProfile(projectDir),
      getAllExperienceSummaries(),
    ]);

    const {
      effective,
      globalDefaults,
      localProfile,
      mergeDetails,
    } = profileResult;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          summary: summarizeProfile(effective),
          effective,
          globalDefaults,
          localProfile,
          mergeDetails,
          recentDecisions: experiences.slice(0, 20),
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

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          recorded: true,
          decisionId: decision.id,
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

    // Get past decisions for this provider
    const providerDecisions = await getDecisionsByApi(provider.name);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          provider,
          pastDecisions: providerDecisions.length > 0 ? providerDecisions : undefined,
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
  // report_outcome
  // ==================
  if (name === 'report_outcome') {
    const { decisionId, success, stage, notes } = args as {
      decisionId: string;
      success: boolean;
      stage?: string;
      notes?: string;
    };

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

  return {
    content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
    isError: true,
  };
});

// ============================================
// Main
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('stacksherpa MCP server v3.0.0 running');
}

main().catch(console.error);
