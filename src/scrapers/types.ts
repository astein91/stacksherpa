// Scraper-specific types

export interface ScrapedPricing {
  source: string;
  scrapedAt: string;
  raw: unknown;  // Original scraped data
  extracted: {
    type: 'usage' | 'seat' | 'flat' | 'tiered' | 'freemium';
    currency: string;
    freeTier?: {
      included: string;
      limitations?: string[];
    };
    unitPricing?: {
      unit: string;
      price: number;
      volumeDiscounts?: { threshold: number; pricePerUnit: number }[];
    };
    plans?: {
      name: string;
      priceMonthly?: number;
      priceYearly?: number;
      includes: string;
    }[];
  };
  confidence: 'high' | 'medium' | 'low';
}

export interface ScrapedBenchmark {
  source: string;
  scrapedAt: string;
  provider: string;
  model?: string;
  benchmarks: {
    name: string;  // "lmarena_elo", "mmlu", "humaneval", etc.
    score: number;
    maxScore?: number;
    rank?: number;
    category?: string;
  }[];
  confidence: 'high' | 'medium' | 'low';
}

export interface DiscoveredAPI {
  name: string;
  description: string;
  website: string;
  category: string;
  discoveredAt: string;
  source: string;  // Where we found it
  sourceUrl: string;
  signals: {
    productHunt?: { votes: number; date: string };
    hackerNews?: { points: number; date: string };
    githubStars?: number;
    funding?: string;
  };
  needsReview: boolean;
}

export interface FreshnessCheck {
  providerId: string;
  field: string;
  lastVerified: string;
  daysSinceVerified: number;
  status: 'fresh' | 'stale' | 'critical';
  suggestedAction?: string;
}

// Exa search configuration per category
export interface DiscoveryConfig {
  category: string;
  queries: string[];
  excludeDomains?: string[];  // Don't re-discover known providers
  minScore?: number;
}

// Firecrawl extraction schema per provider type
export interface ExtractionConfig {
  providerType: string;
  urlPatterns: string[];
  schema: Record<string, unknown>;  // JSON Schema for extraction
}

// Scraper job result
export interface ScrapeResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
  source: string;
  scrapedAt: string;
}

// Change detection
export interface ProviderChange {
  providerId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changedAt: string;
  source: string;
  severity: 'info' | 'warning' | 'breaking';
}
