import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreProvider, type EcosystemContext } from './scoring.js';
import type {
  KnownProvider,
  EffectiveProfile,
  ExperienceSummary,
  ScoredPattern,
} from './types.js';

// ============================================
// Helpers
// ============================================

function makeProvider(overrides: Partial<KnownProvider> = {}): KnownProvider {
  return {
    name: 'TestProvider',
    compliance: [],
    bestFor: ['startup'],
    strengths: ['dx', 'reliability'],
    hasFreeTier: true,
    lastVerified: new Date().toISOString().split('T')[0],
    ...overrides,
  };
}

function makeProfile(overrides: Partial<EffectiveProfile> = {}): EffectiveProfile {
  return {
    project: { name: 'test', scale: 'startup' },
    constraints: {},
    preferences: { prioritize: ['dx', 'reliability'] },
    ...overrides,
  };
}

const NO_EXPERIENCES: ExperienceSummary[] = [];
const NO_PATTERNS: ScoredPattern[] = [];

// ============================================
// scoreProvider
// ============================================

describe('scoreProvider', () => {
  it('returns a positive score for a matching provider', () => {
    const score = scoreProvider(
      makeProvider(),
      makeProfile(),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    assert.ok(score > 0, `Expected positive score, got ${score}`);
  });

  it('disqualifies provider missing required compliance', () => {
    const score = scoreProvider(
      makeProvider({ compliance: ['GDPR'] }),
      makeProfile({ constraints: { compliance: ['SOC2', 'HIPAA'] } }),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    assert.equal(score, -1);
  });

  it('gives compliance bonus when all requirements are met', () => {
    const withCompliance = scoreProvider(
      makeProvider({ compliance: ['SOC2', 'HIPAA'] }),
      makeProfile({ constraints: { compliance: ['SOC2'] } }),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    const without = scoreProvider(
      makeProvider({ compliance: ['SOC2', 'HIPAA'] }),
      makeProfile({ constraints: {} }),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    assert.ok(withCompliance > without, 'Compliance match should boost score');
  });

  it('compliance matching is case-insensitive', () => {
    const score = scoreProvider(
      makeProvider({ compliance: ['soc2'] }),
      makeProfile({ constraints: { compliance: ['SOC2'] } }),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    assert.ok(score > 0, 'Case-insensitive compliance should not disqualify');
  });

  it('gives scale match bonus', () => {
    const matching = scoreProvider(
      makeProvider({ bestFor: ['startup'] }),
      makeProfile({ project: { name: 'test', scale: 'startup' } }),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    const notMatching = scoreProvider(
      makeProvider({ bestFor: ['enterprise'] }),
      makeProfile({ project: { name: 'test', scale: 'startup' } }),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    assert.ok(matching > notMatching, 'Scale match should increase score');
  });

  it('aligns strengths with priorities, weighted by position', () => {
    // Provider strong on dx, profile prioritizes dx first
    const dxFirst = scoreProvider(
      makeProvider({ strengths: ['dx'] }),
      makeProfile({ preferences: { prioritize: ['dx', 'reliability', 'cost'] } }),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    // Provider strong on dx, profile prioritizes dx last
    const dxLast = scoreProvider(
      makeProvider({ strengths: ['dx'] }),
      makeProfile({ preferences: { prioritize: ['cost', 'reliability', 'dx'] } }),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    assert.ok(dxFirst > dxLast, 'Higher priority position should give more points');
  });

  it('gives free tier bonus for small projects', () => {
    const withFree = scoreProvider(
      makeProvider({ hasFreeTier: true }),
      makeProfile({ project: { name: 'test', scale: 'startup' } }),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    const withoutFree = scoreProvider(
      makeProvider({ hasFreeTier: false }),
      makeProfile({ project: { name: 'test', scale: 'startup' } }),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    assert.ok(withFree > withoutFree, 'Free tier should boost score for startups');
  });

  it('does not give free tier bonus for enterprise', () => {
    const withFree = scoreProvider(
      makeProvider({ hasFreeTier: true, bestFor: ['enterprise'] }),
      makeProfile({ project: { name: 'test', scale: 'enterprise' } }),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    const withoutFree = scoreProvider(
      makeProvider({ hasFreeTier: false, bestFor: ['enterprise'] }),
      makeProfile({ project: { name: 'test', scale: 'enterprise' } }),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    assert.equal(withFree, withoutFree, 'Free tier should not affect enterprise score');
  });

  it('boosts score for ecosystem affinity', () => {
    const ecosystemCtx: EcosystemContext = {
      usedEcosystems: new Set(['supabase']),
    };
    const withEcosystem = scoreProvider(
      makeProvider({ ecosystem: 'supabase' }),
      makeProfile(),
      NO_EXPERIENCES,
      NO_PATTERNS,
      ecosystemCtx
    );
    const withoutEcosystem = scoreProvider(
      makeProvider({ ecosystem: 'firebase' }),
      makeProfile(),
      NO_EXPERIENCES,
      NO_PATTERNS,
      ecosystemCtx
    );
    assert.ok(
      withEcosystem > withoutEcosystem,
      'Ecosystem match should boost score'
    );
  });

  it('positive experience boosts score', () => {
    const experiences: ExperienceSummary[] = [{
      id: '1',
      project: 'test',
      api: 'TestProvider',
      category: 'email',
      outcome: 'positive',
      date: new Date().toISOString(),
    }];
    const withExp = scoreProvider(
      makeProvider(),
      makeProfile(),
      experiences,
      NO_PATTERNS
    );
    const without = scoreProvider(
      makeProvider(),
      makeProfile(),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    assert.ok(withExp > without, 'Positive experience should boost score');
  });

  it('negative experience reduces score', () => {
    const experiences: ExperienceSummary[] = [{
      id: '1',
      project: 'test',
      api: 'TestProvider',
      category: 'email',
      outcome: 'negative',
      date: new Date().toISOString(),
    }];
    const withNeg = scoreProvider(
      makeProvider(),
      makeProfile(),
      experiences,
      NO_PATTERNS
    );
    const without = scoreProvider(
      makeProvider(),
      makeProfile(),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    assert.ok(withNeg < without, 'Negative experience should reduce score');
  });

  it('negative experience weighs more than positive', () => {
    const pos: ExperienceSummary[] = [{
      id: '1', project: 'test', api: 'TestProvider',
      category: 'email', outcome: 'positive', date: new Date().toISOString(),
    }];
    const neg: ExperienceSummary[] = [{
      id: '2', project: 'test', api: 'TestProvider',
      category: 'email', outcome: 'negative', date: new Date().toISOString(),
    }];
    const posDelta = scoreProvider(makeProvider(), makeProfile(), pos, NO_PATTERNS) -
                     scoreProvider(makeProvider(), makeProfile(), NO_EXPERIENCES, NO_PATTERNS);
    const negDelta = scoreProvider(makeProvider(), makeProfile(), neg, NO_PATTERNS) -
                     scoreProvider(makeProvider(), makeProfile(), NO_EXPERIENCES, NO_PATTERNS);
    assert.ok(
      Math.abs(negDelta) > Math.abs(posDelta),
      'Negative experience should have larger magnitude than positive'
    );
  });

  it('penalizes providers with critical unresolved issues', () => {
    const withIssues = scoreProvider(
      makeProvider({
        knownIssues: [{
          id: 'issue-1',
          symptom: 'SDK crashes',
          scope: 'Node 20',
          severity: 'critical',
          reportedAt: new Date().toISOString(),
          confidence: 'high',
        }],
      }),
      makeProfile(),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    const without = scoreProvider(
      makeProvider(),
      makeProfile(),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    assert.ok(withIssues < without, 'Critical issues should reduce score');
  });

  it('does not penalize resolved critical issues', () => {
    const withResolved = scoreProvider(
      makeProvider({
        knownIssues: [{
          id: 'issue-1',
          symptom: 'SDK crashes',
          scope: 'Node 20',
          severity: 'critical',
          reportedAt: '2024-01-01',
          resolvedAt: '2024-01-15',
          confidence: 'high',
        }],
      }),
      makeProfile(),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    const without = scoreProvider(
      makeProvider(),
      makeProfile(),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    assert.equal(withResolved, without, 'Resolved issues should not affect score');
  });

  it('penalizes stale provider data', () => {
    const staleDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const freshDate = new Date().toISOString().split('T')[0];
    const stale = scoreProvider(
      makeProvider({ lastVerified: staleDate }),
      makeProfile(),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    const fresh = scoreProvider(
      makeProvider({ lastVerified: freshDate }),
      makeProfile(),
      NO_EXPERIENCES,
      NO_PATTERNS
    );
    assert.ok(stale < fresh, 'Stale data should reduce score');
  });

  it('applies pattern-based prefers boost', () => {
    const patterns: ScoredPattern[] = [{
      id: '1',
      signal: 'prefers:TestProvider:email',
      confidence: 0.8,
      evidenceIds: ['e1'],
      firstObserved: '2024-01-01',
      lastReinforced: '2024-06-01',
    }];
    const with_ = scoreProvider(makeProvider(), makeProfile(), NO_EXPERIENCES, patterns);
    const without = scoreProvider(makeProvider(), makeProfile(), NO_EXPERIENCES, NO_PATTERNS);
    assert.ok(with_ > without, 'prefers pattern should boost score');
  });

  it('applies pattern-based dislikes penalty', () => {
    const patterns: ScoredPattern[] = [{
      id: '1',
      signal: 'dislikes:TestProvider:email',
      confidence: 0.8,
      evidenceIds: ['e1'],
      firstObserved: '2024-01-01',
      lastReinforced: '2024-06-01',
    }];
    const with_ = scoreProvider(makeProvider(), makeProfile(), NO_EXPERIENCES, patterns);
    const without = scoreProvider(makeProvider(), makeProfile(), NO_EXPERIENCES, NO_PATTERNS);
    assert.ok(with_ < without, 'dislikes pattern should reduce score');
  });
});
