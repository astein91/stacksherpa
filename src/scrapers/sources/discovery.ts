/**
 * New API Discovery using Exa
 *
 * Finds new players in each API category through semantic search
 */

import Exa from 'exa-js';
import type { DiscoveredAPI, DiscoveryConfig } from '../types.js';

const exa = new Exa(process.env.EXA_API_KEY);

// Discovery configurations per category
export const discoveryConfigs: DiscoveryConfig[] = [
  {
    category: 'email',
    queries: [
      'new transactional email API startup 2024 2025',
      'alternative to SendGrid Resend email API',
      'developer email service launched',
    ],
    excludeDomains: ['sendgrid.com', 'resend.com', 'postmark.com', 'mailgun.com'],
  },
  {
    category: 'payments',
    queries: [
      'new payment processing API startup 2024 2025',
      'Stripe alternative payment API developer',
      'payment gateway API launched',
    ],
    excludeDomains: ['stripe.com', 'paddle.com', 'lemonsqueezy.com'],
  },
  {
    category: 'auth',
    queries: [
      'new authentication API startup 2024 2025',
      'Clerk Auth0 alternative developer',
      'identity authentication service launched',
    ],
    excludeDomains: ['clerk.com', 'auth0.com', 'supabase.com'],
  },
  {
    category: 'ai',
    queries: [
      'new LLM API provider 2024 2025',
      'OpenAI Anthropic alternative API',
      'AI inference API startup launched',
      'new foundation model API',
    ],
    excludeDomains: ['openai.com', 'anthropic.com', 'google.com'],
  },
  {
    category: 'database',
    queries: [
      'new serverless database API 2024 2025',
      'Supabase Neon alternative database',
      'database as a service developer API launched',
    ],
    excludeDomains: ['supabase.com', 'planetscale.com', 'neon.tech'],
  },
  {
    category: 'storage',
    queries: [
      'new object storage API 2024 2025',
      'S3 compatible storage API startup',
      'file upload API developer service',
    ],
    excludeDomains: ['cloudflare.com', 'aws.amazon.com', 'uploadthing.com'],
  },
  {
    category: 'search',
    queries: [
      'new search API startup 2024 2025',
      'Algolia alternative search API',
      'vector search API developer',
    ],
    excludeDomains: ['algolia.com', 'typesense.org', 'meilisearch.com'],
  },
  {
    category: 'analytics',
    queries: [
      'new product analytics API 2024 2025',
      'PostHog Mixpanel alternative',
      'analytics API developer startup',
    ],
    excludeDomains: ['posthog.com', 'mixpanel.com', 'amplitude.com'],
  },
  {
    category: 'monitoring',
    queries: [
      'new error monitoring API 2024 2025',
      'Sentry alternative error tracking',
      'observability API developer startup',
    ],
    excludeDomains: ['sentry.io', 'datadoghq.com'],
  },
  {
    category: 'sms',
    queries: [
      'new SMS API startup 2024 2025',
      'Twilio alternative SMS messaging',
      'communication API developer launched',
    ],
    excludeDomains: ['twilio.com', 'messagebird.com', 'vonage.com'],
  },
];

export async function discoverNewAPIs(
  category: string,
  options: { maxResults?: number; daysBack?: number } = {}
): Promise<DiscoveredAPI[]> {
  const { maxResults = 10, daysBack = 90 } = options;

  const config = discoveryConfigs.find(c => c.category === category);
  if (!config) {
    throw new Error(`No discovery config for category: ${category}`);
  }

  const discovered: DiscoveredAPI[] = [];
  const seenUrls = new Set<string>();

  for (const query of config.queries) {
    try {
      const results = await exa.searchAndContents(query, {
        type: 'auto',
        numResults: maxResults,
        text: true,
        highlights: true,
        startPublishedDate: new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString(),
        excludeDomains: config.excludeDomains,
      });

      for (const result of results.results) {
        // Dedupe by domain
        const domain = new URL(result.url).hostname;
        if (seenUrls.has(domain)) continue;
        seenUrls.add(domain);

        discovered.push({
          name: extractName(result.title, result.text),
          description: result.highlights?.[0] ?? result.text?.slice(0, 200) ?? '',
          website: result.url,
          category,
          discoveredAt: new Date().toISOString(),
          source: 'exa_search',
          sourceUrl: result.url,
          signals: {
            // Could enrich with Product Hunt, HN, GitHub later
          },
          needsReview: true,
        });
      }
    } catch (error) {
      console.error(`Discovery failed for query "${query}":`, error);
    }
  }

  return discovered;
}

export async function discoverAllCategories(): Promise<Map<string, DiscoveredAPI[]>> {
  const results = new Map<string, DiscoveredAPI[]>();

  // Run discoveries in parallel (with some rate limiting)
  const categories = discoveryConfigs.map(c => c.category);

  for (const category of categories) {
    try {
      const discovered = await discoverNewAPIs(category);
      results.set(category, discovered);

      // Rate limit: wait 1s between categories
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Failed to discover for ${category}:`, error);
      results.set(category, []);
    }
  }

  return results;
}

// Helper to extract API name from title/content
function extractName(title: string, text?: string | null): string {
  // Try to find a product name pattern
  // Often appears as "ProductName - tagline" or "ProductName: description"
  const titleMatch = title.match(/^([A-Z][a-zA-Z0-9]+)/);
  if (titleMatch) {
    return titleMatch[1];
  }
  return title.split(/[-:|]/)[0].trim();
}

// Search for specific API info (used when populating a new provider)
export async function researchProvider(
  name: string,
  website: string
): Promise<{
  pricing?: string;
  docs?: string;
  github?: string;
  features?: string[];
}> {
  const results: {
    pricing?: string;
    docs?: string;
    github?: string;
    features?: string[];
  } = {};

  // Find pricing page
  try {
    const pricingSearch = await exa.search(`site:${new URL(website).hostname} pricing`, {
      type: 'keyword',
      numResults: 1,
    });
    if (pricingSearch.results[0]) {
      results.pricing = pricingSearch.results[0].url;
    }
  } catch (e) {
    // Ignore
  }

  // Find docs
  try {
    const docsSearch = await exa.search(`site:${new URL(website).hostname} documentation API`, {
      type: 'keyword',
      numResults: 1,
    });
    if (docsSearch.results[0]) {
      results.docs = docsSearch.results[0].url;
    }
  } catch (e) {
    // Ignore
  }

  // Find GitHub
  try {
    const githubSearch = await exa.search(`${name} github SDK`, {
      type: 'keyword',
      numResults: 3,
      includeDomains: ['github.com'],
    });
    const officialRepo = githubSearch.results.find(r =>
      r.url.includes(name.toLowerCase()) || r.title.toLowerCase().includes('official')
    );
    if (officialRepo) {
      results.github = officialRepo.url;
    }
  } catch (e) {
    // Ignore
  }

  return results;
}
