/**
 * Pattern Inference
 *
 * Computes patterns from decisions with decay weighting.
 * Patterns are soft-state: scored, evidence-linked, and recomputable.
 */

import { randomUUID } from 'crypto';
import type {
  UserDecision,
  ExperienceSummary,
  ScoredPattern,
  ComputedTaste,
} from './types.js';
import { loadAllDecisions, toExperienceSummary } from './decisions.js';

const DEFAULT_DECAY_HALF_LIFE_DAYS = 180; // 6 months
const CONFIDENCE_THRESHOLD = 0.2;
const CACHE_TTL_MS = 30_000; // 30 seconds

// Simple TTL cache for computed taste
let cachedTaste: ComputedTaste | null = null;
let cacheTimestamp = 0;

/**
 * Invalidate the pattern cache. Call after recording a decision.
 */
export function invalidatePatternCache(): void {
  cachedTaste = null;
  cacheTimestamp = 0;
}

interface PatternAccumulator {
  signal: string;
  evidence: Array<{ id: string; outcome: 'positive' | 'negative' | 'neutral'; date: string }>;
  rawScore: number;
}

/**
 * Detect signals from a decision (structured, not keyword-based)
 */
function detectSignals(decision: UserDecision): string[] {
  const signals: string[] = [];

  // Provider preference by category
  if (decision.outcome === 'positive') {
    signals.push(`prefers:${decision.api}:${decision.category}`);
    signals.push(`positive:${decision.category}`);
  }

  if (decision.outcome === 'negative') {
    signals.push(`dislikes:${decision.api}:${decision.category}`);
    signals.push(`negative:${decision.category}`);
  }

  // Context-based signals
  if (decision.context) {
    const lowerContext = decision.context.toLowerCase();

    if (lowerContext.includes('high volume') || lowerContext.includes('scale')) {
      signals.push('context:high-volume');
    }
    if (lowerContext.includes('startup') || lowerContext.includes('mvp')) {
      signals.push('context:early-stage');
    }
    if (lowerContext.includes('enterprise') || lowerContext.includes('compliance')) {
      signals.push('context:enterprise');
    }
    if (lowerContext.includes('migration') || lowerContext.includes('switching')) {
      signals.push('context:migration');
    }
  }

  return signals;
}

/**
 * Calculate decay weight based on age
 */
function calculateDecayWeight(date: string, halfLifeDays: number): number {
  const ageMs = Date.now() - new Date(date).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Compute patterns from all decisions
 */
export async function computePatterns(
  decayHalfLifeDays = DEFAULT_DECAY_HALF_LIFE_DAYS
): Promise<ComputedTaste> {
  // Return cached result if still fresh
  if (cachedTaste && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedTaste;
  }

  const allDecisions = await loadAllDecisions();

  const signalMap = new Map<string, PatternAccumulator>();

  for (const { decision } of allDecisions) {
    const decayWeight = calculateDecayWeight(decision.date, decayHalfLifeDays);
    const signals = detectSignals(decision);

    for (const signal of signals) {
      const existing = signalMap.get(signal) ?? {
        signal,
        evidence: [],
        rawScore: 0,
      };

      existing.evidence.push({
        id: decision.id,
        outcome: decision.outcome,
        date: decision.date,
      });

      // Score contribution: positive adds, negative subtracts (smaller), neutral ignored
      const scoreContribution =
        decision.outcome === 'positive' ? 1 :
        decision.outcome === 'negative' ? -0.5 :
        0;

      existing.rawScore += decayWeight * scoreContribution;
      signalMap.set(signal, existing);
    }
  }

  // Convert to scored patterns
  const patterns: ScoredPattern[] = [];

  for (const [signal, accumulator] of signalMap.entries()) {
    // Normalize confidence to 0-1 range
    // Use evidence count as denominator for reasonable scaling
    const maxPossibleScore = accumulator.evidence.length;
    const confidence = Math.min(1, Math.max(0, accumulator.rawScore / Math.max(maxPossibleScore, 3)));

    if (confidence < CONFIDENCE_THRESHOLD) {
      continue; // Skip low-confidence patterns
    }

    // Sort evidence by date
    const sortedEvidence = [...accumulator.evidence].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    patterns.push({
      id: randomUUID(),
      signal,
      confidence,
      evidenceIds: sortedEvidence.map(e => e.id),
      firstObserved: sortedEvidence[0].date,
      lastReinforced: sortedEvidence[sortedEvidence.length - 1].date,
    });
  }

  // Sort by confidence (highest first)
  patterns.sort((a, b) => b.confidence - a.confidence);

  // Build experience summaries
  const experiences = allDecisions.map(({ decision, projectName }) =>
    toExperienceSummary(decision, projectName)
  );

  const result: ComputedTaste = {
    experiences,
    patterns,
    computedAt: new Date().toISOString(),
  };

  cachedTaste = result;
  cacheTimestamp = Date.now();

  return result;
}

/**
 * Get patterns relevant to a specific category
 */
export function filterPatternsForCategory(
  patterns: ScoredPattern[],
  category: string
): ScoredPattern[] {
  const lowerCategory = category.toLowerCase();

  return patterns.filter(p => {
    // Match category-specific patterns
    if (p.signal.includes(`:${lowerCategory}`)) {
      return true;
    }
    // Also include general context patterns
    if (p.signal.startsWith('context:')) {
      return true;
    }
    return false;
  });
}

/**
 * Get patterns relevant to a specific provider
 */
export function filterPatternsForProvider(
  patterns: ScoredPattern[],
  provider: string
): ScoredPattern[] {
  const lowerProvider = provider.toLowerCase();

  return patterns.filter(p =>
    p.signal.toLowerCase().includes(lowerProvider)
  );
}

/**
 * Get experiences relevant to a specific category
 */
export function filterExperiencesForCategory(
  experiences: ExperienceSummary[],
  category: string
): ExperienceSummary[] {
  const lowerCategory = category.toLowerCase();

  return experiences.filter(e =>
    e.category.toLowerCase() === lowerCategory
  );
}

/**
 * Get experiences relevant to a specific provider
 */
export function filterExperiencesForProvider(
  experiences: ExperienceSummary[],
  provider: string
): ExperienceSummary[] {
  const lowerProvider = provider.toLowerCase();

  return experiences.filter(e =>
    e.api.toLowerCase() === lowerProvider
  );
}

/**
 * Parse a pattern signal to extract its components
 */
export function parseSignal(signal: string): {
  type: 'prefers' | 'dislikes' | 'positive' | 'negative' | 'context' | 'unknown';
  provider?: string;
  category?: string;
  context?: string;
} {
  const parts = signal.split(':');

  if (parts[0] === 'prefers' && parts.length === 3) {
    return { type: 'prefers', provider: parts[1], category: parts[2] };
  }

  if (parts[0] === 'dislikes' && parts.length === 3) {
    return { type: 'dislikes', provider: parts[1], category: parts[2] };
  }

  if (parts[0] === 'positive' && parts.length === 2) {
    return { type: 'positive', category: parts[1] };
  }

  if (parts[0] === 'negative' && parts.length === 2) {
    return { type: 'negative', category: parts[1] };
  }

  if (parts[0] === 'context' && parts.length === 2) {
    return { type: 'context', context: parts[1] };
  }

  return { type: 'unknown' };
}

/**
 * Convert patterns to human-readable descriptions
 */
export function describePattern(pattern: ScoredPattern): string {
  const parsed = parseSignal(pattern.signal);
  const confidence = Math.round(pattern.confidence * 100);

  switch (parsed.type) {
    case 'prefers':
      return `Prefers ${parsed.provider} for ${parsed.category} (${confidence}% confident)`;
    case 'dislikes':
      return `Had issues with ${parsed.provider} for ${parsed.category} (${confidence}% confident)`;
    case 'positive':
      return `Generally positive experiences with ${parsed.category} APIs (${confidence}% confident)`;
    case 'negative':
      return `Generally challenging experiences with ${parsed.category} APIs (${confidence}% confident)`;
    case 'context':
      return `Frequently works in ${parsed.context} contexts (${confidence}% confident)`;
    default:
      return `Pattern: ${pattern.signal} (${confidence}% confident)`;
  }
}
