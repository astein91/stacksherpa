/**
 * Metadata Refresh Scraper
 *
 * Uses Firecrawl to refresh stale provider metadata from their websites.
 * Conservative: only fills empty/null fields, never overwrites existing data.
 */

import FirecrawlApp from '@mendable/firecrawl-js';
import { updateProviderMetadata, getProviderById } from '../../db/client.js';

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

// JSON Schema for metadata extraction
const metadataSchema = {
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: 'A concise 1-2 sentence description of what this API/service does',
    },
    complianceCertifications: {
      type: 'array',
      items: { type: 'string' },
      description: 'Compliance certifications mentioned (SOC2, HIPAA, GDPR, PCI-DSS, ISO27001, etc.)',
    },
    npmPackage: {
      type: 'string',
      description: 'The primary npm/Node.js package name for this service',
    },
    docsUrl: {
      type: 'string',
      description: 'URL to the developer documentation',
    },
    pricingUrl: {
      type: 'string',
      description: 'URL to the pricing page',
    },
    githubOrg: {
      type: 'string',
      description: 'GitHub organization or repo URL (e.g., "https://github.com/org/repo")',
    },
  },
};

export interface MetadataRefreshResult {
  providerId: string;
  fieldsUpdated: string[];
  fieldsSkipped: string[];
  error?: string;
}

/**
 * Refresh metadata for a single provider.
 * Only fills empty/null fields — never overwrites existing data.
 */
export async function refreshProviderMetadata(
  providerId: string,
  websiteUrl: string
): Promise<MetadataRefreshResult> {
  const result: MetadataRefreshResult = {
    providerId,
    fieldsUpdated: [],
    fieldsSkipped: [],
  };

  try {
    // Get current provider data to know what's missing
    const existing = await getProviderById(providerId);
    if (!existing) {
      result.error = `Provider not found: ${providerId}`;
      return result;
    }

    // Scrape the website
    const scrapeResult = await firecrawl.scrapeUrl(websiteUrl, {
      formats: ['extract'],
      extract: { schema: metadataSchema },
    });

    if (!scrapeResult.success || !scrapeResult.extract) {
      result.error = 'Firecrawl scrape failed';
      return result;
    }

    const extracted = scrapeResult.extract as Record<string, unknown>;

    // Build update object — only include fields that are currently empty
    const updates: Record<string, string | string[] | undefined> = {};

    if (!existing.description && extracted.description) {
      updates.description = String(extracted.description).slice(0, 500);
      result.fieldsUpdated.push('description');
    } else if (extracted.description) {
      result.fieldsSkipped.push('description');
    }

    if (!existing.pricingUrl && extracted.pricingUrl) {
      updates.pricingUrl = String(extracted.pricingUrl);
      result.fieldsUpdated.push('pricingUrl');
    } else if (extracted.pricingUrl) {
      result.fieldsSkipped.push('pricingUrl');
    }

    if (!existing.githubRepo && extracted.githubOrg) {
      // Extract org/repo from GitHub URL
      const ghUrl = String(extracted.githubOrg);
      const match = ghUrl.match(/github\.com\/([^/]+\/[^/]+)/);
      if (match) {
        updates.githubRepo = match[1];
        result.fieldsUpdated.push('githubRepo');
      }
    } else if (extracted.githubOrg) {
      result.fieldsSkipped.push('githubRepo');
    }

    if (!existing.docsUrl && extracted.docsUrl) {
      updates.docsUrl = String(extracted.docsUrl);
      result.fieldsUpdated.push('docsUrl');
    } else if (extracted.docsUrl) {
      result.fieldsSkipped.push('docsUrl');
    }

    if ((!existing.compliance || existing.compliance.length === 0) && Array.isArray(extracted.complianceCertifications) && extracted.complianceCertifications.length > 0) {
      updates.compliance = extracted.complianceCertifications.map(String);
      result.fieldsUpdated.push('compliance');
    } else if (extracted.complianceCertifications) {
      result.fieldsSkipped.push('compliance');
    }

    if (!existing.package && extracted.npmPackage) {
      updates.package = String(extracted.npmPackage);
      result.fieldsUpdated.push('package');
    } else if (extracted.npmPackage) {
      result.fieldsSkipped.push('package');
    }

    // Apply updates if any
    if (result.fieldsUpdated.length > 0) {
      await updateProviderMetadata(providerId, updates as any);
    }

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Unknown error';
    return result;
  }
}

/**
 * Refresh metadata for multiple stale providers.
 */
export async function refreshStaleProviderMetadata(
  providers: { id: string; website: string }[],
  maxPerRun = 3
): Promise<MetadataRefreshResult[]> {
  const results: MetadataRefreshResult[] = [];

  for (const provider of providers.slice(0, maxPerRun)) {
    console.log(`  Refreshing metadata for ${provider.id}...`);
    const result = await refreshProviderMetadata(provider.id, provider.website);
    results.push(result);

    if (result.fieldsUpdated.length > 0) {
      console.log(`    Updated: ${result.fieldsUpdated.join(', ')}`);
    }
    if (result.error) {
      console.log(`    Error: ${result.error}`);
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return results;
}
