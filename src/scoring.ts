/**
 * Provider Scoring
 *
 * Scores providers against a project's effective profile,
 * user experiences, and inferred patterns.
 */

import type {
  KnownProvider,
  EffectiveProfile,
  ExperienceSummary,
  ScoredPattern,
} from './types.js';

export interface EcosystemContext {
  usedEcosystems: Set<string>;
}

export function scoreProvider(
  provider: KnownProvider,
  effective: EffectiveProfile,
  experiences: ExperienceSummary[],
  patterns: ScoredPattern[],
  ecosystemCtx?: EcosystemContext
): number {
  let score = 0;

  // Compliance match (hard requirement)
  const requiredCompliance = effective.constraints?.compliance ?? [];
  if (requiredCompliance.length > 0) {
    const providerCompliance = provider.compliance ?? [];
    const hasAll = requiredCompliance.every(c =>
      providerCompliance.some(pc => pc.toLowerCase() === c.toLowerCase())
    );
    if (!hasAll) return -1; // Disqualified
    score += 20;
  }

  // Scale match
  const projectScale = effective.project?.scale;
  const scaleFit = provider.bestFor ?? provider.scale ?? [];
  if (projectScale && scaleFit.includes(projectScale)) {
    score += 15;
  }

  // Strengths alignment with priorities
  const priorities = effective.preferences?.prioritize ?? [];
  for (let i = 0; i < priorities.length; i++) {
    if (provider.strengths?.includes(priorities[i])) {
      score += (priorities.length - i) * 5;
    }
  }

  // Free tier preference for small projects
  const hasFreeTier = provider.pricing?.freeTier !== undefined || provider.hasFreeTier;
  if (['hobby', 'startup'].includes(projectScale ?? '') && hasFreeTier) {
    score += 10;
  }

  // Ecosystem affinity: boost if project already uses same ecosystem
  if (ecosystemCtx && provider.ecosystem) {
    if (ecosystemCtx.usedEcosystems.has(provider.ecosystem)) {
      score += 20;
    }
  }

  // Experience-based adjustments
  const providerExperiences = experiences.filter(
    e => e.api.toLowerCase() === provider.name.toLowerCase()
  );
  for (const exp of providerExperiences) {
    if (exp.outcome === 'positive') score += 8;
    if (exp.outcome === 'negative') score -= 12;
  }

  // Pattern-based adjustments
  const providerPatterns = patterns.filter(
    p => p.signal.toLowerCase().includes(provider.name.toLowerCase())
  );
  for (const pattern of providerPatterns) {
    if (pattern.signal.startsWith('prefers:')) {
      score += pattern.confidence * 10;
    }
    if (pattern.signal.startsWith('dislikes:')) {
      score -= pattern.confidence * 15;
    }
  }

  // Penalize stale data
  if (provider.lastVerified) {
    const daysSinceVerified = Math.floor(
      (Date.now() - new Date(provider.lastVerified).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceVerified > 90) score -= 5;
  }

  // Penalize critical issues
  const issues = provider.knownIssues ?? [];
  const criticalIssues = issues.filter(i => i.severity === 'critical' && !i.resolvedAt);
  if (criticalIssues.length > 0) score -= 10;

  return score;
}
