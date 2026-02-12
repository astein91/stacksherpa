/**
 * GitHub Issues Scraper
 *
 * Collects known issues, bugs, and problems from provider SDK repos
 * to populate the knownIssues field and improve routing decisions
 */

import type { KnownIssue } from '../../types.js';

// GitHub API base
const GITHUB_API = 'https://api.github.com';

// Map provider IDs to their GitHub repos (SDK repos primarily)
// NOTE: IDs must match the database provider IDs
export const providerRepos: Record<string, string[]> = {
  // AI/LLM (use DB IDs)
  'openai-gpt4o': ['openai/openai-node', 'openai/openai-python'],
  'anthropic-claude-sonnet': ['anthropics/anthropic-sdk-typescript', 'anthropics/anthropic-sdk-python'],
  'google-gemini-flash': ['google-gemini/generative-ai-js', 'google-gemini/generative-ai-python'],
  'vercel-ai-sdk': ['vercel/ai'],

  // Email
  'resend': ['resend/resend-node', 'resend/react-email'],
  'sendgrid': ['sendgrid/sendgrid-nodejs'],
  'postmark': ['ActiveCampaign/postmark.js'],

  // Payments
  'stripe': ['stripe/stripe-node', 'stripe/stripe-js'],
  'paddle': ['PaddleHQ/paddle-node-sdk'],

  // Auth
  'clerk': ['clerk/javascript'],
  'auth0': ['auth0/nextjs-auth0', 'auth0/node-auth0'],
  'supabase-auth': ['supabase/supabase-js', 'supabase/auth-js'],

  // Database
  'supabase': ['supabase/supabase-js'],
  'planetscale': ['planetscale/database-js'],
  'neon': ['neondatabase/serverless'],

  // Storage
  'uploadthing': ['pingdotgg/uploadthing'],
  'cloudflare-r2': ['cloudflare/workers-sdk'],

  // Analytics
  'posthog': ['PostHog/posthog-js'],
  'mixpanel': ['mixpanel/mixpanel-node'],

  // Monitoring
  'sentry': ['getsentry/sentry-javascript'],

  // Search
  'algolia': ['algolia/algoliasearch-client-javascript'],
  'typesense': ['typesense/typesense-js'],
  'meilisearch': ['meilisearch/meilisearch-js'],
};

// Labels that indicate bugs/issues (case insensitive)
const BUG_LABELS = ['bug', 'error', 'issue', 'problem', 'broken', 'regression', 'crash'];
const PLATFORM_LABELS = ['ios', 'android', 'react-native', 'nextjs', 'node', 'browser', 'edge'];

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  labels: { name: string }[];
  created_at: string;
  updated_at: string;
  reactions: {
    total_count: number;
    '+1': number;
  };
  comments: number;
}

interface GitHubSearchResult {
  total_count: number;
  items: GitHubIssue[];
}

async function githubFetch<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'api-broker',
  };

  // Use token if available (higher rate limits)
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(`${GITHUB_API}${path}`, { headers });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Get open issues from a repo, filtered by bug-like labels
 */
export async function getRepoIssues(
  repo: string,
  options: {
    state?: 'open' | 'closed' | 'all';
    labels?: string[];
    since?: string;
    perPage?: number;
  } = {}
): Promise<GitHubIssue[]> {
  const { state = 'open', labels = [], since, perPage = 100 } = options;

  const params = new URLSearchParams({
    state,
    per_page: String(perPage),
    sort: 'reactions-+1',  // Most upvoted first
    direction: 'desc',
  });

  if (labels.length > 0) {
    params.set('labels', labels.join(','));
  }

  if (since) {
    params.set('since', since);
  }

  return githubFetch<GitHubIssue[]>(`/repos/${repo}/issues?${params}`);
}

/**
 * Search for issues across repos with specific query
 */
export async function searchIssues(
  query: string,
  repos?: string[]
): Promise<GitHubSearchResult> {
  let q = query;

  if (repos && repos.length > 0) {
    const repoQuery = repos.map(r => `repo:${r}`).join(' ');
    q = `${query} ${repoQuery}`;
  }

  q += ' is:issue is:open';

  const params = new URLSearchParams({
    q,
    sort: 'reactions-+1',
    order: 'desc',
    per_page: '50',
  });

  return githubFetch<GitHubSearchResult>(`/search/issues?${params}`);
}

/**
 * Extract structured issue data for our KnownIssue format
 */
function parseIssueToKnownIssue(issue: GitHubIssue, repo: string): KnownIssue | null {
  // Skip issues with very low engagement (likely not widespread)
  const engagement = issue.reactions?.total_count ?? 0 + issue.comments;
  if (engagement < 2) return null;

  // Determine severity based on reactions and labels
  let severity: KnownIssue['severity'] = 'low';
  const reactions = issue.reactions?.['+1'] ?? 0;

  if (reactions >= 50 || issue.labels.some(l => l.name.toLowerCase().includes('critical'))) {
    severity = 'critical';
  } else if (reactions >= 20 || issue.labels.some(l => l.name.toLowerCase().includes('high'))) {
    severity = 'high';
  } else if (reactions >= 5) {
    severity = 'medium';
  }

  // Try to extract scope from labels or title
  const platformLabels = issue.labels
    .map(l => l.name.toLowerCase())
    .filter(name => PLATFORM_LABELS.some(p => name.includes(p)));

  const scope = platformLabels.length > 0
    ? platformLabels.join(', ')
    : extractScopeFromText(issue.title + ' ' + (issue.body ?? ''));

  // Try to extract workaround from body
  const workaround = extractWorkaround(issue.body);

  // Extract affected versions
  const affectedVersions = extractVersions(issue.title + ' ' + (issue.body ?? ''));

  return {
    id: `gh-${repo.replace('/', '-')}-${issue.number}`,
    symptom: issue.title,
    scope: scope || 'general',
    workaround,
    severity,
    affectedVersions,
    githubIssue: issue.html_url,
    reportedAt: issue.created_at,
    confidence: reactions >= 10 ? 'high' : reactions >= 3 ? 'medium' : 'low',
  };
}

/**
 * Extract scope hints from issue text
 */
function extractScopeFromText(text: string): string {
  const patterns = [
    /\b(iOS|Android|React Native|Next\.?js|Node\.?js|Browser|Edge|Vercel|Cloudflare)\b/gi,
    /\b(v?\d+\.\d+(?:\.\d+)?)\b/,  // Version numbers
    /\b(ESM|CommonJS|TypeScript|JavaScript)\b/gi,
  ];

  const matches: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      matches.push(match[0]);
    }
  }

  return matches.slice(0, 3).join(', ');
}

/**
 * Try to find workaround in issue body
 */
function extractWorkaround(body: string | null): string | undefined {
  if (!body) return undefined;

  // Look for common workaround patterns
  const patterns = [
    /workaround[:\s]+([^\n]+)/i,
    /temporary fix[:\s]+([^\n]+)/i,
    /solution[:\s]+([^\n]+)/i,
    /fixed by[:\s]+([^\n]+)/i,
    /try[:\s]+`([^`]+)`/i,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) {
      return match[1].trim().slice(0, 200);
    }
  }

  return undefined;
}

/**
 * Extract version numbers from text
 */
function extractVersions(text: string): string | undefined {
  const versionPattern = /\b(v?\d+\.\d+(?:\.\d+)?(?:-[a-z]+\.\d+)?)\b/gi;
  const matches = text.match(versionPattern);

  if (matches && matches.length > 0) {
    // Dedupe and return first few
    const unique = [...new Set(matches)];
    return unique.slice(0, 3).join(', ');
  }

  return undefined;
}

/**
 * Get all known issues for a provider
 */
export async function getProviderIssues(
  providerId: string,
  options: {
    minReactions?: number;
    maxIssues?: number;
    since?: string;  // ISO date
    repos?: string[];  // Override repos from Turso
  } = {}
): Promise<KnownIssue[]> {
  const { minReactions = 2, maxIssues = 20, since } = options;

  // Use provided repos (from Turso), fall back to hardcoded map
  const repos = options.repos ?? providerRepos[providerId];
  if (!repos || repos.length === 0) {
    console.warn(`No repos configured for provider: ${providerId}`);
    return [];
  }

  const allIssues: KnownIssue[] = [];

  for (const repo of repos) {
    try {
      // Get issues labeled as bugs
      const bugIssues = await getRepoIssues(repo, {
        state: 'open',
        labels: ['bug'],
        since,
        perPage: 50,
      });

      // Also search for error-related issues
      const searchResult = await searchIssues('error OR crash OR broken', [repo]);

      // Combine and dedupe
      const combined = new Map<number, GitHubIssue>();
      for (const issue of [...bugIssues, ...searchResult.items]) {
        if (!combined.has(issue.number)) {
          combined.set(issue.number, issue);
        }
      }

      // Parse to KnownIssue format
      for (const issue of combined.values()) {
        const parsed = parseIssueToKnownIssue(issue, repo);
        if (parsed && (issue.reactions?.['+1'] ?? 0) >= minReactions) {
          allIssues.push(parsed);
        }
      }

      // Rate limit between repos
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Failed to fetch issues for ${repo}:`, error);
    }
  }

  // Sort by severity and reactions, take top N
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  allIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return allIssues.slice(0, maxIssues);
}

/**
 * Update known issues for all providers
 */
export async function updateAllProviderIssues(): Promise<Map<string, KnownIssue[]>> {
  const results = new Map<string, KnownIssue[]>();

  for (const providerId of Object.keys(providerRepos)) {
    console.log(`Fetching issues for ${providerId}...`);

    try {
      const issues = await getProviderIssues(providerId);
      results.set(providerId, issues);
      console.log(`  Found ${issues.length} notable issues`);
    } catch (error) {
      console.error(`  Failed: ${error}`);
      results.set(providerId, []);
    }

    // Rate limit between providers
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}`) {
  const providerId = process.argv[2];

  if (providerId) {
    console.log(`\nFetching issues for ${providerId}...\n`);
    const issues = await getProviderIssues(providerId);

    for (const issue of issues) {
      console.log(`[${issue.severity.toUpperCase()}] ${issue.symptom}`);
      console.log(`  Scope: ${issue.scope}`);
      if (issue.workaround) console.log(`  Workaround: ${issue.workaround}`);
      console.log(`  ${issue.githubIssue}\n`);
    }
  } else {
    console.log('Usage: tsx github-issues.ts <provider-id>');
    console.log('Available providers:', Object.keys(providerRepos).join(', '));
  }
}
