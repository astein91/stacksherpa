/**
 * Decision Management
 *
 * Handles recording and loading decisions for a project.
 * Local decisions.json is the canonical source of truth.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import type {
  UserDecision,
  ProjectDecisions,
  ExperienceSummary,
  PastDecision,
} from './types.js';
import { getActiveProjects } from './projects.js';

const CONFIG_DIR = '.stacksherpa';
const DECISIONS_FILENAME = 'decisions.json';
const SCHEMA_VERSION = '1.0.0';
const TOOL_VERSION = '1.0.0';

export function getDecisionsPath(projectDir: string): string {
  return join(projectDir, CONFIG_DIR, DECISIONS_FILENAME);
}

function createEmptyDecisions(): ProjectDecisions {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    decisions: [],
  };
}

/**
 * Load decisions for a specific project
 */
export async function loadProjectDecisions(projectDir: string): Promise<ProjectDecisions> {
  const path = getDecisionsPath(projectDir);

  if (!existsSync(path)) {
    return createEmptyDecisions();
  }

  try {
    const content = await readFile(path, 'utf-8');
    const data = JSON.parse(content) as ProjectDecisions;

    // Ensure schema version
    if (!data.schemaVersion) {
      data.schemaVersion = SCHEMA_VERSION;
    }

    return data;
  } catch {
    return createEmptyDecisions();
  }
}

/**
 * Save decisions for a project
 */
async function saveProjectDecisions(
  projectDir: string,
  decisions: ProjectDecisions
): Promise<void> {
  const path = getDecisionsPath(projectDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  decisions.updatedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(decisions, null, 2), 'utf-8');
}

/**
 * Record a new decision
 */
export async function recordDecision(
  projectDir: string,
  input: {
    api: string;
    category: string;
    outcome: 'positive' | 'negative' | 'neutral';
    context?: string;
    notes?: string;
    notesPrivate?: boolean;
  }
): Promise<UserDecision> {
  const decisions = await loadProjectDecisions(projectDir);

  const decision: UserDecision = {
    id: randomUUID(),
    api: input.api,
    category: input.category,
    outcome: input.outcome,
    context: input.context,
    notes: input.notes,
    notesPrivate: input.notesPrivate ?? false,
    date: new Date().toISOString(),
    recordedBy: 'agent',
    toolVersion: TOOL_VERSION,
  };

  decisions.decisions.push(decision);
  await saveProjectDecisions(projectDir, decisions);

  return decision;
}

/**
 * Get a specific decision by ID
 */
export async function getDecision(
  projectDir: string,
  decisionId: string
): Promise<UserDecision | null> {
  const decisions = await loadProjectDecisions(projectDir);
  return decisions.decisions.find(d => d.id === decisionId) ?? null;
}

/**
 * Update an existing decision
 */
export async function updateDecision(
  projectDir: string,
  decisionId: string,
  updates: Partial<Pick<UserDecision, 'outcome' | 'context' | 'notes' | 'notesPrivate'>>
): Promise<UserDecision | null> {
  const decisions = await loadProjectDecisions(projectDir);
  const decision = decisions.decisions.find(d => d.id === decisionId);

  if (!decision) {
    return null;
  }

  if (updates.outcome !== undefined) decision.outcome = updates.outcome;
  if (updates.context !== undefined) decision.context = updates.context;
  if (updates.notes !== undefined) decision.notes = updates.notes;
  if (updates.notesPrivate !== undefined) decision.notesPrivate = updates.notesPrivate;

  await saveProjectDecisions(projectDir, decisions);
  return decision;
}

/**
 * Convert a UserDecision to an ExperienceSummary for global taste
 */
export function toExperienceSummary(
  decision: UserDecision,
  projectName: string
): ExperienceSummary {
  return {
    id: decision.id,
    project: projectName,
    api: decision.api,
    category: decision.category,
    outcome: decision.outcome,
    context: decision.context,
    // Truncate and sanitize notes if not private
    noteSummary: decision.notesPrivate
      ? undefined
      : truncateNotes(decision.notes),
    date: decision.date,
  };
}

/**
 * Truncate notes to a reasonable summary length
 */
function truncateNotes(notes?: string, maxLength = 100): string | undefined {
  if (!notes) return undefined;
  if (notes.length <= maxLength) return notes;
  return notes.slice(0, maxLength - 3) + '...';
}

/**
 * Load all decisions from all active projects
 * This is used to compute global taste
 */
export async function loadAllDecisions(): Promise<Array<{
  decision: UserDecision;
  projectName: string;
  projectPath: string;
}>> {
  const activeProjects = await getActiveProjects();
  const allDecisions: Array<{
    decision: UserDecision;
    projectName: string;
    projectPath: string;
  }> = [];

  for (const project of activeProjects) {
    try {
      const projectDecisions = await loadProjectDecisions(project.path);
      for (const decision of projectDecisions.decisions) {
        allDecisions.push({
          decision,
          projectName: project.name,
          projectPath: project.path,
        });
      }
    } catch {
      // Skip projects with invalid decisions files
      continue;
    }
  }

  // Sort by date (newest first)
  allDecisions.sort((a, b) => b.decision.date.localeCompare(a.decision.date));

  return allDecisions;
}

/**
 * Get all experience summaries from all active projects
 */
export async function getAllExperienceSummaries(): Promise<ExperienceSummary[]> {
  const allDecisions = await loadAllDecisions();

  return allDecisions.map(({ decision, projectName }) =>
    toExperienceSummary(decision, projectName)
  );
}

/**
 * Get decisions for a specific category across all projects
 */
export async function getDecisionsByCategory(
  category: string
): Promise<ExperienceSummary[]> {
  const allDecisions = await loadAllDecisions();
  const lowerCategory = category.toLowerCase();

  return allDecisions
    .filter(({ decision }) => decision.category.toLowerCase() === lowerCategory)
    .map(({ decision, projectName }) => toExperienceSummary(decision, projectName));
}

/**
 * Get decisions for a specific API across all projects
 */
export async function getDecisionsByApi(api: string): Promise<ExperienceSummary[]> {
  const allDecisions = await loadAllDecisions();
  const lowerApi = api.toLowerCase();

  return allDecisions
    .filter(({ decision }) => decision.api.toLowerCase() === lowerApi)
    .map(({ decision, projectName }) => toExperienceSummary(decision, projectName));
}

// ============================================
// Migration from legacy format
// ============================================

/**
 * Migrate legacy PastDecision entries to new UserDecision format
 */
export function migrateLegacyDecision(legacy: PastDecision): UserDecision {
  return {
    id: randomUUID(),
    api: legacy.api,
    category: legacy.category,
    outcome: legacy.outcome,
    notes: legacy.notes,
    notesPrivate: false,
    date: legacy.date.includes('T') ? legacy.date : `${legacy.date}T00:00:00.000Z`,
    recordedBy: 'user',
    toolVersion: 'migration-1.0',
  };
}

/**
 * Migrate legacy history from profile to decisions.json
 */
export async function migrateFromLegacyProfile(
  projectDir: string,
  legacyHistory: PastDecision[]
): Promise<number> {
  if (!legacyHistory || legacyHistory.length === 0) {
    return 0;
  }

  const decisions = await loadProjectDecisions(projectDir);

  // Check for already migrated (by matching api + category + date)
  const existingKeys = new Set(
    decisions.decisions.map(d => `${d.api}:${d.category}:${d.date.split('T')[0]}`)
  );

  let migrated = 0;
  for (const legacy of legacyHistory) {
    const key = `${legacy.api}:${legacy.category}:${legacy.date.split('T')[0]}`;
    if (!existingKeys.has(key)) {
      decisions.decisions.push(migrateLegacyDecision(legacy));
      migrated++;
    }
  }

  if (migrated > 0) {
    await saveProjectDecisions(projectDir, decisions);
  }

  return migrated;
}
