/**
 * AI/LLM Benchmark Data Collection
 *
 * Sources:
 * - LMArena (Chatbot Arena) - ELO scores
 * - Artificial Analysis - Quality, speed, price indices
 * - Provider announcements - Official benchmark claims
 */

import Exa from 'exa-js';
import FirecrawlApp from '@mendable/firecrawl-js';
import type { ScrapedBenchmark, ScrapeResult } from '../types.js';

const exa = new Exa(process.env.EXA_API_KEY);
const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

// Known benchmark sources
export const benchmarkSources = {
  lmArena: 'https://lmarena.ai/?leaderboard',
  artificialAnalysis: 'https://artificialanalysis.ai/models',
  // Individual model pages for detailed benchmarks
  artificialAnalysisModels: {
    'gpt-4o': 'https://artificialanalysis.ai/models/gpt-4o',
    'claude-3-5-sonnet': 'https://artificialanalysis.ai/models/claude-3-5-sonnet',
    'gemini-2-flash': 'https://artificialanalysis.ai/models/gemini-2-0-flash',
  },
};

// Model name mapping (our IDs to various external names)
export const modelNameMap: Record<string, { lmArena: string[]; aa: string }> = {
  'openai-gpt4o': {
    lmArena: ['gpt-4o', 'gpt-4o-2024'],
    aa: 'gpt-4o',
  },
  'anthropic-claude-sonnet': {
    lmArena: ['claude-3-5-sonnet', 'claude-3.5-sonnet'],
    aa: 'claude-3-5-sonnet',
  },
  'google-gemini-flash': {
    lmArena: ['gemini-2.0-flash', 'gemini-2-flash'],
    aa: 'gemini-2-0-flash',
  },
  'google-gemini-pro': {
    lmArena: ['gemini-1.5-pro', 'gemini-pro'],
    aa: 'gemini-1-5-pro',
  },
};

// Schema for extracting Artificial Analysis data
const artificialAnalysisSchema = {
  type: 'object',
  properties: {
    modelName: { type: 'string' },
    qualityIndex: {
      type: 'number',
      description: 'Quality index score (0-100)',
    },
    speedIndex: {
      type: 'number',
      description: 'Speed index score',
    },
    outputTokensPerSecond: {
      type: 'number',
      description: 'Output tokens per second',
    },
    timeToFirstToken: {
      type: 'number',
      description: 'Time to first token in milliseconds',
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
  },
};

/**
 * Scrape LMArena leaderboard for ELO scores
 * Note: LMArena has dynamic content, may need special handling
 */
export async function scrapeLMArena(): Promise<ScrapeResult<ScrapedBenchmark[]>> {
  const startTime = Date.now();

  try {
    // LMArena is heavily JS-rendered, use Firecrawl
    const result = await firecrawl.scrapeUrl(benchmarkSources.lmArena, {
      formats: ['extract', 'markdown'],
      extract: {
        schema: {
          type: 'object',
          properties: {
            leaderboard: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  rank: { type: 'number' },
                  modelName: { type: 'string' },
                  elo: { type: 'number' },
                  votes: { type: 'number' },
                  organization: { type: 'string' },
                },
              },
            },
          },
        },
      },
      waitFor: 3000,  // Wait for JS to render
    });

    if (!result.success || !result.extract?.leaderboard) {
      // Fallback: try to parse from markdown
      return {
        success: false,
        error: 'Could not extract leaderboard data',
        duration: Date.now() - startTime,
        source: benchmarkSources.lmArena,
        scrapedAt: new Date().toISOString(),
      };
    }

    const benchmarks: ScrapedBenchmark[] = result.extract.leaderboard.map((entry: any) => ({
      source: 'lmarena',
      scrapedAt: new Date().toISOString(),
      provider: entry.organization?.toLowerCase() ?? 'unknown',
      model: entry.modelName,
      benchmarks: [
        {
          name: 'lmarena_elo',
          score: entry.elo,
          rank: entry.rank,
          category: 'overall',
        },
      ],
      confidence: 'high' as const,
    }));

    return {
      success: true,
      data: benchmarks,
      duration: Date.now() - startTime,
      source: benchmarkSources.lmArena,
      scrapedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
      source: benchmarkSources.lmArena,
      scrapedAt: new Date().toISOString(),
    };
  }
}

/**
 * Scrape Artificial Analysis for a specific model
 */
export async function scrapeArtificialAnalysis(
  modelId: string
): Promise<ScrapeResult<ScrapedBenchmark>> {
  const startTime = Date.now();
  const mapping = modelNameMap[modelId];

  if (!mapping) {
    return {
      success: false,
      error: `No model mapping for: ${modelId}`,
      duration: Date.now() - startTime,
      source: 'artificial_analysis',
      scrapedAt: new Date().toISOString(),
    };
  }

  const url = `https://artificialanalysis.ai/models/${mapping.aa}`;

  try {
    const result = await firecrawl.scrapeUrl(url, {
      formats: ['extract'],
      extract: { schema: artificialAnalysisSchema },
    });

    if (!result.success || !result.extract) {
      return {
        success: false,
        error: 'Extraction failed',
        duration: Date.now() - startTime,
        source: url,
        scrapedAt: new Date().toISOString(),
      };
    }

    const data = result.extract;

    return {
      success: true,
      data: {
        source: 'artificial_analysis',
        scrapedAt: new Date().toISOString(),
        provider: modelId.split('-')[0],
        model: data.modelName ?? mapping.aa,
        benchmarks: [
          {
            name: 'aa_quality_index',
            score: data.qualityIndex,
            maxScore: 100,
          },
          {
            name: 'aa_speed_index',
            score: data.speedIndex,
          },
          {
            name: 'aa_tokens_per_second',
            score: data.outputTokensPerSecond,
          },
          {
            name: 'aa_ttft_ms',
            score: data.timeToFirstToken,
          },
          {
            name: 'aa_price_per_m_input',
            score: data.inputPricePerMillion,
          },
        ].filter(b => b.score !== undefined),
        confidence: 'high',
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

/**
 * Search for official benchmark announcements
 */
export async function searchOfficialBenchmarks(
  provider: string,
  modelName: string
): Promise<{
  benchmarks: { name: string; score: number; source: string }[];
}> {
  const benchmarks: { name: string; score: number; source: string }[] = [];

  try {
    // Search for official benchmark announcements
    const results = await exa.searchAndContents(
      `${provider} ${modelName} benchmark MMLU HumanEval GPQA official`,
      {
        type: 'auto',
        numResults: 5,
        text: true,
        includeDomains: [
          `${provider}.com`,
          'arxiv.org',
          'huggingface.co',
        ],
      }
    );

    // Parse benchmark scores from text (simplified - would need better extraction)
    for (const result of results.results) {
      const text = result.text ?? '';

      // Look for common benchmark patterns
      const patterns = [
        { name: 'MMLU', regex: /MMLU[:\s]+(\d+\.?\d*)%?/i },
        { name: 'HumanEval', regex: /HumanEval[:\s]+(\d+\.?\d*)%?/i },
        { name: 'GPQA', regex: /GPQA[:\s]+(\d+\.?\d*)%?/i },
        { name: 'MATH', regex: /MATH[:\s]+(\d+\.?\d*)%?/i },
      ];

      for (const { name, regex } of patterns) {
        const match = text.match(regex);
        if (match) {
          benchmarks.push({
            name,
            score: parseFloat(match[1]),
            source: result.url,
          });
        }
      }
    }
  } catch (error) {
    console.error('Failed to search official benchmarks:', error);
  }

  return { benchmarks };
}

/**
 * Aggregate all benchmark data for a model
 */
export async function collectAllBenchmarks(
  modelId: string
): Promise<{
  lmArena?: { elo: number; rank: number };
  artificialAnalysis?: Record<string, number>;
  official?: { name: string; score: number }[];
}> {
  const result: {
    lmArena?: { elo: number; rank: number };
    artificialAnalysis?: Record<string, number>;
    official?: { name: string; score: number }[];
  } = {};

  // Get Artificial Analysis data
  const aaResult = await scrapeArtificialAnalysis(modelId);
  if (aaResult.success && aaResult.data) {
    result.artificialAnalysis = {};
    for (const b of aaResult.data.benchmarks) {
      result.artificialAnalysis[b.name] = b.score;
    }
  }

  // Get LMArena data (from cached leaderboard)
  const lmArenaResult = await scrapeLMArena();
  if (lmArenaResult.success && lmArenaResult.data) {
    const mapping = modelNameMap[modelId];
    if (mapping) {
      const entry = lmArenaResult.data.find(b =>
        mapping.lmArena.some(name =>
          b.model?.toLowerCase().includes(name.toLowerCase())
        )
      );
      if (entry?.benchmarks[0]) {
        result.lmArena = {
          elo: entry.benchmarks[0].score,
          rank: entry.benchmarks[0].rank ?? 0,
        };
      }
    }
  }

  return result;
}
