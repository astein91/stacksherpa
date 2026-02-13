/**
 * Profile Management
 *
 * Handles loading, merging, and updating project profiles.
 * Implements explicit merge policies for combining global defaults with local overrides.
 */

import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import type {
  ProjectProfile,
  GlobalDefaults,
  Constraints,
  Preferences,
  EffectiveProfile,
  MergeDetail,
  MergePolicy,
  PastDecision,
  Gap,
} from './types.js';
import { ensureProjectRegistered } from './projects.js';
import { migrateFromLegacyProfile } from './decisions.js';

const CONFIG_DIR = '.stacksherpa';
const PROFILE_FILENAME = 'profile.json';
const DEFAULTS_FILENAME = 'defaults.json';
const SCHEMA_VERSION = '1.0.0';


// ============================================
// Path helpers
// ============================================

export function getGlobalConfigDir(): string {
  return join(homedir(), CONFIG_DIR);
}

export function getGlobalDefaultsPath(): string {
  return join(getGlobalConfigDir(), DEFAULTS_FILENAME);
}

export function getLocalProfilePath(projectDir: string): string {
  return join(projectDir, CONFIG_DIR, PROFILE_FILENAME);
}

// ============================================
// File I/O
// ============================================

export async function loadGlobalDefaults(): Promise<GlobalDefaults | null> {
  const path = getGlobalDefaultsPath();

  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as GlobalDefaults;
  } catch {
    return null;
  }
}

export async function saveGlobalDefaults(defaults: GlobalDefaults): Promise<void> {
  const path = getGlobalDefaultsPath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  defaults.updatedAt = new Date().toISOString();
  const tmp = path + '.tmp';
  await writeFile(tmp, JSON.stringify(defaults, null, 2), 'utf-8');
  await rename(tmp, path);
}

export async function loadLocalProfile(projectDir: string): Promise<ProjectProfile | null> {
  const path = getLocalProfilePath(projectDir);

  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = await readFile(path, 'utf-8');
    const data = JSON.parse(content);

    // Check if this is a legacy profile format
    if (data.history && Array.isArray(data.history)) {
      // Migrate legacy history to decisions.json
      await migrateFromLegacyProfile(projectDir, data.history as PastDecision[]);
    }

    return data as ProjectProfile;
  } catch {
    return null;
  }
}

export async function saveLocalProfile(
  projectDir: string,
  profile: ProjectProfile
): Promise<void> {
  const path = getLocalProfilePath(projectDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  profile.updatedAt = new Date().toISOString();
  const tmp = path + '.tmp';
  await writeFile(tmp, JSON.stringify(profile, null, 2), 'utf-8');
  await rename(tmp, path);
}

// ============================================
// Merge Logic
// ============================================

/**
 * Apply merge policy for a single field
 */
function applyMergePolicy<T>(
  globalValue: T | undefined,
  localValue: T | undefined,
  policy: MergePolicy
): T | undefined {
  // If only one value exists, use it
  if (localValue === undefined) return globalValue;
  if (globalValue === undefined) return localValue;

  switch (policy) {
    case 'override':
      return localValue;

    case 'union':
      if (Array.isArray(globalValue) && Array.isArray(localValue)) {
        // Deduplicate union
        return [...new Set([...globalValue, ...localValue])] as T;
      }
      return localValue;

    case 'min':
      if (typeof globalValue === 'number' && typeof localValue === 'number') {
        return Math.min(globalValue, localValue) as T;
      }
      return localValue;

    case 'max':
      if (typeof globalValue === 'number' && typeof localValue === 'number') {
        return Math.max(globalValue, localValue) as T;
      }
      return localValue;

    default:
      return localValue;
  }
}

/**
 * Merge constraints using defined policies
 */
function mergeConstraints(
  global: Constraints | undefined,
  local: Constraints | undefined
): { merged: Constraints; details: MergeDetail[] } {
  const merged: Constraints = {};
  const details: MergeDetail[] = [];

  const fields: Array<{
    key: keyof Constraints;
    policy: MergePolicy;
    nested?: string;
  }> = [
    { key: 'compliance', policy: 'union' },
    { key: 'dataResidency', policy: 'union' },
    { key: 'mustHaveFeatures', policy: 'union' },
    { key: 'dealbreakers', policy: 'union' },
    { key: 'requiredSdkLanguages', policy: 'union' },
    { key: 'selfHosted', policy: 'override' },
    { key: 'vendorLockInTolerance', policy: 'override' },
  ];

  for (const { key, policy } of fields) {
    const globalVal = global?.[key];
    const localVal = local?.[key];
    const effectiveVal = applyMergePolicy(globalVal, localVal, policy);

    if (effectiveVal !== undefined) {
      (merged as Record<string, unknown>)[key] = effectiveVal;
    }

    if (globalVal !== undefined || localVal !== undefined) {
      details.push({
        field: `constraints.${key}`,
        policy,
        globalValue: globalVal,
        localValue: localVal,
        effectiveValue: effectiveVal,
      });
    }
  }

  // Handle nested budgetCeiling
  if (global?.budgetCeiling || local?.budgetCeiling) {
    merged.budgetCeiling = {};

    const monthlyGlobal = global?.budgetCeiling?.monthly;
    const monthlyLocal = local?.budgetCeiling?.monthly;
    const monthlyEffective = applyMergePolicy(monthlyGlobal, monthlyLocal, 'min');

    if (monthlyEffective !== undefined) {
      merged.budgetCeiling.monthly = monthlyEffective;
      details.push({
        field: 'constraints.budgetCeiling.monthly',
        policy: 'min',
        globalValue: monthlyGlobal,
        localValue: monthlyLocal,
        effectiveValue: monthlyEffective,
      });
    }

    const perRequestGlobal = global?.budgetCeiling?.perRequest;
    const perRequestLocal = local?.budgetCeiling?.perRequest;
    const perRequestEffective = applyMergePolicy(perRequestGlobal, perRequestLocal, 'min');

    if (perRequestEffective !== undefined) {
      merged.budgetCeiling.perRequest = perRequestEffective;
      details.push({
        field: 'constraints.budgetCeiling.perRequest',
        policy: 'min',
        globalValue: perRequestGlobal,
        localValue: perRequestLocal,
        effectiveValue: perRequestEffective,
      });
    }
  }

  return { merged, details };
}

/**
 * Merge preferences using defined policies
 */
function mergePreferences(
  global: Preferences | undefined,
  local: Preferences | undefined
): { merged: Preferences; details: MergeDetail[] } {
  const merged: Preferences = {};
  const details: MergeDetail[] = [];

  const fields: Array<{ key: keyof Preferences; policy: MergePolicy }> = [
    { key: 'prioritize', policy: 'override' },
    { key: 'riskTolerance', policy: 'override' },
    { key: 'avoidProviders', policy: 'union' },
    { key: 'preferredProviders', policy: 'override' },
  ];

  for (const { key, policy } of fields) {
    const globalVal = global?.[key];
    const localVal = local?.[key];
    const effectiveVal = applyMergePolicy(globalVal, localVal, policy);

    if (effectiveVal !== undefined) {
      (merged as Record<string, unknown>)[key] = effectiveVal;
    }

    if (globalVal !== undefined || localVal !== undefined) {
      details.push({
        field: `preferences.${key}`,
        policy,
        globalValue: globalVal,
        localValue: localVal,
        effectiveValue: effectiveVal,
      });
    }
  }

  return { merged, details };
}

/**
 * Load and merge profiles to get effective profile
 */
export async function loadEffectiveProfile(projectDir: string): Promise<{
  effective: EffectiveProfile;
  globalDefaults: GlobalDefaults | null;
  localProfile: ProjectProfile | null;
  mergeDetails: MergeDetail[];
}> {
  // Auto-register project on first access
  const projectName = basename(projectDir);
  await ensureProjectRegistered(projectDir, projectName);

  const globalDefaults = await loadGlobalDefaults();
  const localProfile = await loadLocalProfile(projectDir);

  const { merged: constraints, details: constraintDetails } = mergeConstraints(
    globalDefaults?.constraints,
    localProfile?.constraints
  );

  const { merged: preferences, details: preferenceDetails } = mergePreferences(
    globalDefaults?.preferences,
    localProfile?.preferences
  );

  return {
    effective: {
      project: localProfile?.project,
      constraints,
      preferences,
    },
    globalDefaults,
    localProfile,
    mergeDetails: [...constraintDetails, ...preferenceDetails],
  };
}

// ============================================
// Profile Updates (surgical)
// ============================================

interface AppliedOp {
  op: 'set' | 'append' | 'remove';
  path: string;
  value: unknown;
  previousValue?: unknown;
}

/**
 * Get nested value from object by dot-path
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set nested value in object by dot-path
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Delete nested value from object by dot-path
 */
function deleteNestedValue(obj: Record<string, unknown>, path: string): boolean {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || typeof current[part] !== 'object') {
      return false;
    }
    current = current[part] as Record<string, unknown>;
  }

  const finalKey = parts[parts.length - 1];
  if (finalKey in current) {
    delete current[finalKey];
    return true;
  }
  return false;
}

/**
 * Update project profile with surgical operations
 */
export async function updateProjectProfile(
  projectDir: string,
  operations: {
    set?: Record<string, unknown>;
    append?: Record<string, unknown>;
    remove?: Record<string, unknown>;
  }
): Promise<{
  success: boolean;
  updatedProfile: ProjectProfile;
  appliedOps: AppliedOp[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const appliedOps: AppliedOp[] = [];

  // Load or create profile
  let profile = await loadLocalProfile(projectDir);
  const now = new Date().toISOString();

  if (!profile) {
    profile = {
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      project: { name: basename(projectDir) },
      shareToGlobalTaste: true,
    };
  }

  const profileObj = profile as unknown as Record<string, unknown>;

  // Apply SET operations
  if (operations.set) {
    for (const [path, value] of Object.entries(operations.set)) {
      const previousValue = getNestedValue(profileObj, path);
      setNestedValue(profileObj, path, value);
      appliedOps.push({ op: 'set', path, value, previousValue });
    }
  }

  // Apply APPEND operations
  if (operations.append) {
    for (const [path, value] of Object.entries(operations.append)) {
      const current = getNestedValue(profileObj, path);

      if (current === undefined) {
        // Initialize as array and push
        const newArray = Array.isArray(value) ? value : [value];
        setNestedValue(profileObj, path, newArray);
        appliedOps.push({ op: 'append', path, value, previousValue: undefined });
        warnings.push(`Initialized ${path} as new array`);
      } else if (Array.isArray(current)) {
        // Append to existing array
        const toAppend = Array.isArray(value) ? value : [value];
        const newArray = [...current, ...toAppend];
        setNestedValue(profileObj, path, newArray);
        appliedOps.push({ op: 'append', path, value, previousValue: current });
      } else {
        warnings.push(`Cannot append to non-array at ${path}`);
      }
    }
  }

  // Apply REMOVE operations
  if (operations.remove) {
    for (const [path, value] of Object.entries(operations.remove)) {
      const current = getNestedValue(profileObj, path);

      if (value === true) {
        // Delete the key entirely
        const deleted = deleteNestedValue(profileObj, path);
        if (deleted) {
          appliedOps.push({ op: 'remove', path, value: true, previousValue: current });
        } else {
          warnings.push(`Path ${path} not found for removal`);
        }
      } else if (Array.isArray(current)) {
        // Remove value from array
        const toRemove = Array.isArray(value) ? value : [value];
        const newArray = current.filter(item => !toRemove.includes(item));
        setNestedValue(profileObj, path, newArray);
        appliedOps.push({ op: 'remove', path, value, previousValue: current });
      } else {
        warnings.push(`Cannot remove from non-array at ${path}`);
      }
    }
  }

  // Save updated profile
  await saveLocalProfile(projectDir, profile);

  // Update registry if shareToGlobalTaste changed
  if (operations.set?.['shareToGlobalTaste'] !== undefined) {
    const { updateProject } = await import('./projects.js');
    await updateProject(projectDir, {
      shareToGlobalTaste: operations.set['shareToGlobalTaste'] as boolean,
    });
  }

  return {
    success: true,
    updatedProfile: profile,
    appliedOps,
    warnings,
  };
}

// ============================================
// Gap Detection
// ============================================

interface CategoryGapConfig {
  requiredFields: Array<{
    path: string;
    question: string;
    options?: string[];
    relevance: string;
    impact: 'high' | 'medium' | 'low';
  }>;
}

const CATEGORY_GAPS: Record<string, CategoryGapConfig> = {
  email: {
    requiredFields: [
      {
        path: 'constraints.compliance',
        question: 'Does this project have compliance requirements (SOC2, HIPAA, GDPR)?',
        options: ['SOC2', 'HIPAA', 'GDPR', 'None'],
        relevance: 'Affects which email providers are viable for regulated industries',
        impact: 'high',
      },
      {
        path: 'project.regions',
        question: 'Which regions will your users be in?',
        options: ['us', 'eu', 'apac', 'global'],
        relevance: 'Email deliverability varies by region',
        impact: 'medium',
      },
    ],
  },
  payments: {
    requiredFields: [
      {
        path: 'constraints.compliance',
        question: 'Does this project require PCI-DSS compliance?',
        options: ['PCI-DSS', 'SOC2', 'None'],
        relevance: 'Payment processing has strict compliance requirements',
        impact: 'high',
      },
      {
        path: 'project.regions',
        question: 'Which regions will you accept payments from?',
        options: ['us', 'eu', 'global'],
        relevance: 'Payment provider availability varies by region',
        impact: 'high',
      },
    ],
  },
  auth: {
    requiredFields: [
      {
        path: 'constraints.selfHosted',
        question: 'Do you need self-hosted authentication?',
        options: ['Yes', 'No'],
        relevance: 'Determines whether cloud-only providers are viable',
        impact: 'high',
      },
      {
        path: 'constraints.compliance',
        question: 'Any compliance requirements for auth (SOC2, HIPAA)?',
        options: ['SOC2', 'HIPAA', 'None'],
        relevance: 'Auth providers have different compliance certifications',
        impact: 'medium',
      },
    ],
  },
  ai: {
    requiredFields: [
      {
        path: 'constraints.budgetCeiling.monthly',
        question: 'What\'s your monthly budget for AI API costs?',
        relevance: 'AI APIs have significant cost differences',
        impact: 'high',
      },
      {
        path: 'project.scale',
        question: 'What scale is this project?',
        options: ['hobby', 'startup', 'growth', 'enterprise'],
        relevance: 'Affects rate limits and pricing tiers',
        impact: 'medium',
      },
    ],
  },
  storage: {
    requiredFields: [
      {
        path: 'constraints.dataResidency',
        question: 'Any data residency requirements?',
        options: ['us', 'eu', 'apac', 'None'],
        relevance: 'Storage providers have different regional availability',
        impact: 'high',
      },
    ],
  },
};

/**
 * Detect gaps in profile for a specific category
 */
export function detectGaps(
  effective: EffectiveProfile,
  category: string
): Gap[] {
  const gaps: Gap[] = [];
  const config = CATEGORY_GAPS[category.toLowerCase()];

  if (!config) {
    // Generic gaps for unknown categories
    if (!effective.project?.scale) {
      gaps.push({
        field: 'project.scale',
        question: 'What scale is this project?',
        options: ['hobby', 'startup', 'growth', 'enterprise'],
        relevance: 'Affects pricing and feature recommendations',
        impact: 'medium',
      });
    }
    return gaps;
  }

  for (const field of config.requiredFields) {
    const value = getNestedValue(effective as unknown as Record<string, unknown>, field.path);

    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      gaps.push({
        field: field.path,
        question: field.question,
        options: field.options,
        relevance: field.relevance,
        impact: field.impact,
      });
    }
  }

  return gaps;
}

// ============================================
// Profile Summary (for display)
// ============================================

export function summarizeProfile(effective: EffectiveProfile): string {
  const parts: string[] = [];

  if (effective.project) {
    const p = effective.project;
    if (p.name) parts.push(`Project: ${p.name}`);
    if (p.stack) {
      const stack = [p.stack.language, p.stack.framework, p.stack.hosting]
        .filter(Boolean)
        .join('/');
      if (stack) parts.push(`Stack: ${stack}`);
    }
    if (p.scale) parts.push(`Scale: ${p.scale}`);
    if (p.regions?.length) parts.push(`Regions: ${p.regions.join(', ')}`);
  }

  const c = effective.constraints;
  if (c.compliance?.length) parts.push(`Compliance: ${c.compliance.join(', ')}`);
  if (c.budgetCeiling?.monthly) parts.push(`Budget: $${c.budgetCeiling.monthly}/mo max`);
  if (c.selfHosted !== undefined) parts.push(`Self-hosted: ${c.selfHosted ? 'required' : 'not required'}`);
  if (c.mustHaveFeatures?.length) parts.push(`Required features: ${c.mustHaveFeatures.join(', ')}`);
  if (c.dealbreakers?.length) parts.push(`Dealbreakers: ${c.dealbreakers.join(', ')}`);

  const pr = effective.preferences;
  if (pr.prioritize?.length) parts.push(`Priorities: ${pr.prioritize.join(' > ')}`);
  if (pr.riskTolerance) parts.push(`Risk tolerance: ${pr.riskTolerance}`);
  if (pr.avoidProviders?.length) parts.push(`Avoid: ${pr.avoidProviders.join(', ')}`);

  return parts.length ? parts.join('\n') : 'No profile configured';
}

