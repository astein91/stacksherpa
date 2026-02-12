/**
 * Project Registry Management
 *
 * Handles auto-registration of projects and tracking of known project paths.
 * Projects are auto-registered on first tool use.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import type { ProjectRegistry, RegisteredProject } from './types.js';

const CONFIG_DIR = '.stacksherpa';
const REGISTRY_FILENAME = 'projects.json';
const SCHEMA_VERSION = '1.0.0';

export function getGlobalConfigDir(): string {
  return join(homedir(), CONFIG_DIR);
}

export function getRegistryPath(): string {
  return join(getGlobalConfigDir(), REGISTRY_FILENAME);
}

function createEmptyRegistry(): ProjectRegistry {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    projects: [],
  };
}

export async function loadRegistry(): Promise<ProjectRegistry> {
  const path = getRegistryPath();

  if (!existsSync(path)) {
    return createEmptyRegistry();
  }

  try {
    const content = await readFile(path, 'utf-8');
    const registry = JSON.parse(content) as ProjectRegistry;

    // Ensure schema version compatibility
    if (!registry.schemaVersion) {
      registry.schemaVersion = SCHEMA_VERSION;
    }

    return registry;
  } catch {
    return createEmptyRegistry();
  }
}

async function saveRegistry(registry: ProjectRegistry): Promise<void> {
  const path = getRegistryPath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  registry.updatedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(registry, null, 2), 'utf-8');
}

/**
 * Ensure a project is registered. Called on first tool use in a project.
 * Returns true if the project was newly registered, false if already existed.
 */
export async function ensureProjectRegistered(
  projectPath: string,
  projectName?: string
): Promise<{ registered: boolean; project: RegisteredProject }> {
  const registry = await loadRegistry();
  const normalizedPath = projectPath.replace(/\/$/, ''); // Remove trailing slash

  // Check if already registered
  const existing = registry.projects.find(p => p.path === normalizedPath);
  if (existing) {
    return { registered: false, project: existing };
  }

  // Auto-detect project name from directory or package.json
  const name = projectName ?? await detectProjectName(normalizedPath);

  const newProject: RegisteredProject = {
    path: normalizedPath,
    name,
    addedAt: new Date().toISOString(),
    shareToGlobalTaste: true, // Default opt-in
  };

  registry.projects.push(newProject);
  await saveRegistry(registry);

  return { registered: true, project: newProject };
}

/**
 * Detect project name from directory name or package.json
 */
async function detectProjectName(projectPath: string): Promise<string> {
  // Try package.json first
  const packageJsonPath = join(projectPath, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const content = await readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      if (pkg.name && typeof pkg.name === 'string') {
        return pkg.name;
      }
    } catch {
      // Fall through to directory name
    }
  }

  // Fall back to directory name
  return basename(projectPath);
}

/**
 * Get all registered projects that are active (exist and share taste)
 */
export async function getActiveProjects(): Promise<RegisteredProject[]> {
  const registry = await loadRegistry();

  return registry.projects.filter(p => {
    // Check if project directory still exists
    if (!existsSync(p.path)) {
      return false;
    }

    // Check if opted into global taste
    return p.shareToGlobalTaste;
  });
}

/**
 * Get all registered projects (including inactive/non-sharing)
 */
export async function getAllProjects(): Promise<RegisteredProject[]> {
  const registry = await loadRegistry();
  return registry.projects;
}

/**
 * Update a registered project's settings
 */
export async function updateProject(
  projectPath: string,
  updates: Partial<Pick<RegisteredProject, 'name' | 'shareToGlobalTaste'>>
): Promise<RegisteredProject | null> {
  const registry = await loadRegistry();
  const normalizedPath = projectPath.replace(/\/$/, '');

  const project = registry.projects.find(p => p.path === normalizedPath);
  if (!project) {
    return null;
  }

  if (updates.name !== undefined) {
    project.name = updates.name;
  }
  if (updates.shareToGlobalTaste !== undefined) {
    project.shareToGlobalTaste = updates.shareToGlobalTaste;
  }

  await saveRegistry(registry);
  return project;
}

/**
 * Remove a project from the registry
 */
export async function removeProject(projectPath: string): Promise<boolean> {
  const registry = await loadRegistry();
  const normalizedPath = projectPath.replace(/\/$/, '');

  const index = registry.projects.findIndex(p => p.path === normalizedPath);
  if (index === -1) {
    return false;
  }

  registry.projects.splice(index, 1);
  await saveRegistry(registry);
  return true;
}

/**
 * Prune stale projects that no longer exist on disk
 */
export async function pruneStaleProjects(): Promise<string[]> {
  const registry = await loadRegistry();
  const removed: string[] = [];

  registry.projects = registry.projects.filter(p => {
    if (!existsSync(p.path)) {
      removed.push(p.path);
      return false;
    }
    return true;
  });

  if (removed.length > 0) {
    await saveRegistry(registry);
  }

  return removed;
}

/**
 * Find a project by path
 */
export async function findProject(projectPath: string): Promise<RegisteredProject | null> {
  const registry = await loadRegistry();
  const normalizedPath = projectPath.replace(/\/$/, '');
  return registry.projects.find(p => p.path === normalizedPath) ?? null;
}
