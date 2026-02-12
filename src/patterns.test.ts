import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterPatternsForCategory,
  filterExperiencesForCategory,
  parseSignal,
  describePattern,
  invalidatePatternCache,
} from './patterns.js';
import type { ScoredPattern, ExperienceSummary } from './types.js';

// ============================================
// parseSignal
// ============================================

describe('parseSignal', () => {
  it('parses prefers signal', () => {
    const result = parseSignal('prefers:Resend:email');
    assert.deepEqual(result, {
      type: 'prefers',
      provider: 'Resend',
      category: 'email',
    });
  });

  it('parses dislikes signal', () => {
    const result = parseSignal('dislikes:SendGrid:email');
    assert.deepEqual(result, {
      type: 'dislikes',
      provider: 'SendGrid',
      category: 'email',
    });
  });

  it('parses positive category signal', () => {
    const result = parseSignal('positive:payments');
    assert.deepEqual(result, {
      type: 'positive',
      category: 'payments',
    });
  });

  it('parses negative category signal', () => {
    const result = parseSignal('negative:auth');
    assert.deepEqual(result, {
      type: 'negative',
      category: 'auth',
    });
  });

  it('parses context signal', () => {
    const result = parseSignal('context:high-volume');
    assert.deepEqual(result, {
      type: 'context',
      context: 'high-volume',
    });
  });

  it('returns unknown for unrecognized signals', () => {
    const result = parseSignal('something:weird:extra:parts');
    assert.equal(result.type, 'unknown');
  });
});

// ============================================
// filterPatternsForCategory
// ============================================

describe('filterPatternsForCategory', () => {
  const patterns: ScoredPattern[] = [
    {
      id: '1', signal: 'prefers:Resend:email', confidence: 0.8,
      evidenceIds: ['e1'], firstObserved: '2024-01-01', lastReinforced: '2024-06-01',
    },
    {
      id: '2', signal: 'prefers:Stripe:payments', confidence: 0.9,
      evidenceIds: ['e2'], firstObserved: '2024-01-01', lastReinforced: '2024-06-01',
    },
    {
      id: '3', signal: 'context:high-volume', confidence: 0.5,
      evidenceIds: ['e3'], firstObserved: '2024-01-01', lastReinforced: '2024-06-01',
    },
    {
      id: '4', signal: 'positive:email', confidence: 0.6,
      evidenceIds: ['e4'], firstObserved: '2024-01-01', lastReinforced: '2024-06-01',
    },
  ];

  it('returns patterns matching the category', () => {
    const result = filterPatternsForCategory(patterns, 'email');
    const signals = result.map(p => p.signal);
    assert.ok(signals.includes('prefers:Resend:email'));
    assert.ok(signals.includes('positive:email'));
  });

  it('includes context patterns for any category', () => {
    const result = filterPatternsForCategory(patterns, 'email');
    const signals = result.map(p => p.signal);
    assert.ok(signals.includes('context:high-volume'));
  });

  it('excludes patterns from other categories', () => {
    const result = filterPatternsForCategory(patterns, 'email');
    const signals = result.map(p => p.signal);
    assert.ok(!signals.includes('prefers:Stripe:payments'));
  });
});

// ============================================
// filterExperiencesForCategory
// ============================================

describe('filterExperiencesForCategory', () => {
  const experiences: ExperienceSummary[] = [
    { id: '1', project: 'test', api: 'Resend', category: 'email', outcome: 'positive', date: '2024-01-01' },
    { id: '2', project: 'test', api: 'Stripe', category: 'payments', outcome: 'positive', date: '2024-01-01' },
    { id: '3', project: 'test', api: 'SendGrid', category: 'Email', outcome: 'negative', date: '2024-01-01' },
  ];

  it('returns experiences for the given category', () => {
    const result = filterExperiencesForCategory(experiences, 'email');
    assert.equal(result.length, 2);
  });

  it('is case-insensitive', () => {
    const result = filterExperiencesForCategory(experiences, 'EMAIL');
    assert.equal(result.length, 2);
  });

  it('returns empty for unknown category', () => {
    const result = filterExperiencesForCategory(experiences, 'sms');
    assert.equal(result.length, 0);
  });
});

// ============================================
// describePattern
// ============================================

describe('describePattern', () => {
  it('describes a prefers pattern', () => {
    const desc = describePattern({
      id: '1', signal: 'prefers:Resend:email', confidence: 0.8,
      evidenceIds: ['e1'], firstObserved: '2024-01-01', lastReinforced: '2024-06-01',
    });
    assert.ok(desc.includes('Resend'));
    assert.ok(desc.includes('email'));
    assert.ok(desc.includes('80%'));
  });

  it('describes a dislikes pattern', () => {
    const desc = describePattern({
      id: '1', signal: 'dislikes:SendGrid:email', confidence: 0.6,
      evidenceIds: ['e1'], firstObserved: '2024-01-01', lastReinforced: '2024-06-01',
    });
    assert.ok(desc.includes('SendGrid'));
    assert.ok(desc.includes('issues'));
  });

  it('describes a context pattern', () => {
    const desc = describePattern({
      id: '1', signal: 'context:high-volume', confidence: 0.5,
      evidenceIds: ['e1'], firstObserved: '2024-01-01', lastReinforced: '2024-06-01',
    });
    assert.ok(desc.includes('high-volume'));
  });
});
