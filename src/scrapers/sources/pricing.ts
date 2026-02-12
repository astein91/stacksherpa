/**
 * Pricing Data Extraction using Firecrawl
 *
 * Scrapes and extracts structured pricing from provider websites
 */

import FirecrawlApp from '@mendable/firecrawl-js';
import type { ScrapedPricing, ScrapeResult } from '../types.js';

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

// Known pricing page URLs per provider
export const pricingUrls: Record<string, string> = {
  // AI/LLM
  'openai': 'https://openai.com/api/pricing',
  'anthropic': 'https://www.anthropic.com/pricing',
  'google-ai': 'https://ai.google.dev/pricing',

  // Email
  'resend': 'https://resend.com/pricing',
  'sendgrid': 'https://sendgrid.com/en-us/pricing',
  'postmark': 'https://postmarkapp.com/pricing',

  // Payments
  'stripe': 'https://stripe.com/pricing',
  'paddle': 'https://www.paddle.com/pricing',

  // Auth
  'clerk': 'https://clerk.com/pricing',
  'auth0': 'https://auth0.com/pricing',

  // Database
  'supabase': 'https://supabase.com/pricing',
  'planetscale': 'https://planetscale.com/pricing',
  'neon': 'https://neon.tech/pricing',

  // Storage
  'cloudflare-r2': 'https://developers.cloudflare.com/r2/pricing/',
  'uploadthing': 'https://uploadthing.com/pricing',

  // Analytics
  'posthog': 'https://posthog.com/pricing',
  'mixpanel': 'https://mixpanel.com/pricing',

  // Monitoring
  'sentry': 'https://sentry.io/pricing/',

  // Search
  'algolia': 'https://www.algolia.com/pricing/',
  'typesense': 'https://typesense.org/pricing/',
};

// JSON Schema for LLM extraction
const pricingSchema = {
  type: 'object',
  properties: {
    pricingModel: {
      type: 'string',
      enum: ['usage', 'seat', 'flat', 'tiered', 'freemium'],
      description: 'The primary pricing model',
    },
    currency: {
      type: 'string',
      description: 'Currency code (usually USD)',
    },
    freeTier: {
      type: 'object',
      properties: {
        included: {
          type: 'string',
          description: 'What is included in free tier (e.g., "100 emails/day", "10K API calls/month")',
        },
        limitations: {
          type: 'array',
          items: { type: 'string' },
          description: 'Limitations of free tier',
        },
      },
    },
    unitPricing: {
      type: 'object',
      properties: {
        unit: {
          type: 'string',
          description: 'The unit of pricing (e.g., "1M tokens", "1K emails", "MAU")',
        },
        price: {
          type: 'number',
          description: 'Price per unit in the specified currency',
        },
      },
    },
    plans: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          priceMonthly: { type: 'number' },
          priceYearly: { type: 'number' },
          includes: { type: 'string' },
        },
      },
    },
  },
};

// AI-specific pricing schema (more detailed for models)
const aiPricingSchema = {
  type: 'object',
  properties: {
    models: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Model name (e.g., "gpt-4o", "claude-3-sonnet")',
          },
          inputPricePerMillion: {
            type: 'number',
            description: 'Price per 1M input tokens in USD',
          },
          outputPricePerMillion: {
            type: 'number',
            description: 'Price per 1M output tokens in USD',
          },
          contextWindow: {
            type: 'number',
            description: 'Maximum context window in tokens',
          },
          notes: {
            type: 'string',
            description: 'Any special notes (batch pricing, cached pricing, etc.)',
          },
        },
      },
    },
    freeTier: {
      type: 'object',
      properties: {
        included: { type: 'string' },
        limitations: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

export async function scrapePricing(
  providerId: string,
  options?: { pricingUrl?: string }
): Promise<ScrapeResult<ScrapedPricing>> {
  const startTime = Date.now();
  const url = options?.pricingUrl ?? pricingUrls[providerId];

  if (!url) {
    return {
      success: false,
      error: `No pricing URL configured for provider: ${providerId}`,
      duration: Date.now() - startTime,
      source: 'firecrawl',
      scrapedAt: new Date().toISOString(),
    };
  }

  try {
    // Determine which schema to use
    const isAI = ['openai', 'anthropic', 'google-ai'].includes(providerId);
    const schema = isAI ? aiPricingSchema : pricingSchema;

    const result = await firecrawl.scrapeUrl(url, {
      formats: ['extract', 'markdown'],
      extract: { schema },
    });

    if (!result.success) {
      return {
        success: false,
        error: 'Firecrawl scrape failed',
        duration: Date.now() - startTime,
        source: url,
        scrapedAt: new Date().toISOString(),
      };
    }

    // Transform extracted data to our format
    const extracted = transformPricingData(result.extract, isAI);

    return {
      success: true,
      data: {
        source: url,
        scrapedAt: new Date().toISOString(),
        raw: result.extract,
        extracted,
        confidence: assessConfidence(result.extract),
      },
      duration: Date.now() - startTime,
      source: url,
      scrapedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
      source: url,
      scrapedAt: new Date().toISOString(),
    };
  }
}

function transformPricingData(raw: any, isAI: boolean): ScrapedPricing['extracted'] {
  if (isAI && raw.models) {
    // For AI providers, take the flagship model pricing
    const flagship = raw.models[0];
    return {
      type: 'usage',
      currency: 'USD',
      freeTier: raw.freeTier,
      unitPricing: flagship ? {
        unit: '1M tokens',
        price: flagship.inputPricePerMillion,
      } : undefined,
    };
  }

  return {
    type: raw.pricingModel ?? 'usage',
    currency: raw.currency ?? 'USD',
    freeTier: raw.freeTier,
    unitPricing: raw.unitPricing,
    plans: raw.plans,
  };
}

function assessConfidence(extracted: any): 'high' | 'medium' | 'low' {
  // Simple heuristic: more fields = higher confidence
  let score = 0;
  if (extracted.pricingModel || extracted.models) score += 2;
  if (extracted.freeTier) score += 1;
  if (extracted.unitPricing || extracted.models?.[0]?.inputPricePerMillion) score += 2;
  if (extracted.plans?.length > 0) score += 1;

  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

// Batch scrape all configured providers
export async function scrapeAllPricing(): Promise<Map<string, ScrapeResult<ScrapedPricing>>> {
  const results = new Map<string, ScrapeResult<ScrapedPricing>>();

  for (const providerId of Object.keys(pricingUrls)) {
    console.log(`Scraping pricing for ${providerId}...`);
    const result = await scrapePricing(providerId);
    results.set(providerId, result);

    // Rate limit: 2s between requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return results;
}
