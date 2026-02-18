#!/usr/bin/env tsx
/**
 * Bootstrap Provider Roster — Agentic Discovery
 *
 * Uses Claude Haiku in a tool-use loop to autonomously discover,
 * research, and register new API providers per category.
 *
 * The agent has tools to:
 *   - Search the web (Exa)
 *   - Check what providers we already have (Turso)
 *   - Scrape a provider's website (Firecrawl)
 *   - Register a new provider (Turso upsert)
 *
 * Run via: npm run cron:bootstrap
 *
 * Modes:
 *   (default)              Bootstrap all categories
 *   --category <cat>       Bootstrap a single category
 *   --dry-run              Discover but don't write
 *
 * Requires: ANTHROPIC_API_KEY, TURSO_WRITE_TOKEN, EXA_API_KEY
 * Optional: FIRECRAWL_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';
import Exa from 'exa-js';
import {
  getProvidersByCategory,
  insertDiscoveredProviderFull,
  insertDiscoveryLog,
} from '../db/client.js';
import { categoryAliases } from '../categories.js';
import type { KnownProvider } from '../types.js';

// All canonical categories (28)
const CATEGORIES = [
  'auth', 'database', 'storage', 'email', 'payments', 'analytics', 'monitoring', 'search',
  'sms', 'push', 'realtime', 'chat',
  'ai', 'ai-audio', 'ai-video', 'ai-image', 'vector-db',
  'cache', 'jobs', 'message-queue', 'hosting', 'cdn', 'feature-flags',
  'cms', 'media', 'maps',
  'web-search',
  'finance',
];

// Category descriptions to prevent misinterpretation by the agent
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'email': 'Transactional and marketing email delivery APIs (Resend, SendGrid, Postmark). NOT email clients or inboxes.',
  'payments': 'Payment processing, billing, and subscription management APIs (Stripe, Paddle). NOT financial data or banking.',
  'auth': 'Authentication, identity, and user management APIs (Clerk, Auth0, Supabase Auth). NOT authorization policies.',
  'sms': 'SMS, MMS, and text messaging APIs (Twilio, Vonage). NOT chat or messaging platforms.',
  'storage': 'File/object storage and upload APIs (S3, Cloudflare R2, Uploadthing). NOT databases.',
  'database': 'Managed database platforms with developer APIs (PlanetScale, Neon, Supabase). NOT ORMs or query builders.',
  'analytics': 'Product analytics, event tracking, and user behavior APIs (PostHog, Mixpanel, Amplitude). NOT web analytics or SEO.',
  'search': 'Full-text search and search-as-a-service APIs (Algolia, Meilisearch, Typesense). NOT web search engines.',
  'monitoring': 'Error tracking, APM, logging, observability, and audit trail platforms (Sentry, Datadog, Axiom, WorkOS Audit Logs). NOT uptime monitors.',
  'ai': 'LLM and AI model API platforms, including orchestration frameworks, agent memory, and document processing (OpenAI, Anthropic, Google AI, LangChain, Mem0, Unstructured). NOT standalone vector databases (that is "vector-db").',
  'push': 'Push notification delivery APIs (OneSignal, Firebase Cloud Messaging). NOT email or SMS.',
  'finance': 'Market data, stock prices, financial information, and programmatic trade execution APIs (Polygon.io, Alpha Vantage, Alpaca, Interactive Brokers). NOT payment processing (that is "payments").',
  'maps': 'Geocoding, mapping, and location APIs (Mapbox, Google Maps, HERE). NOT navigation apps.',
  'jobs': 'Background job processing, task queues, and worker infrastructure (BullMQ, Inngest, Trigger.dev). NOT recruitment, hiring, or job boards.',
  'vector-db': 'Vector databases and embedding storage (Pinecone, Weaviate, Qdrant). NOT traditional databases.',
  'ai-audio': 'Text-to-speech, speech-to-text, and audio generation APIs (ElevenLabs, Deepgram, AssemblyAI). NOT music streaming.',
  'ai-video': 'AI video generation and text-to-video APIs (Runway, Luma, Kling). NOT video hosting (that is "media").',
  'ai-image': 'AI image generation and text-to-image APIs (Midjourney, DALL-E, Stability AI). NOT image hosting.',
  'feature-flags': 'Feature flag and A/B testing platforms (LaunchDarkly, Statsig, Flagsmith). NOT analytics.',
  'message-queue': 'Message queue and event streaming platforms (Upstash Kafka, RabbitMQ, AWS SQS). NOT push notifications.',
  'cache': 'Cache and key-value store APIs (Upstash Redis, Momento, DynamoDB). NOT databases.',
  'realtime': 'Realtime communication infrastructure (Ably, Pusher, Liveblocks). NOT video calling.',
  'chat': 'In-app chat and live messaging APIs (Stream Chat, Sendbird, TalkJS). NOT SMS or email.',
  'hosting': 'App hosting, deployment, and PaaS platforms (Vercel, Railway, Fly.io, Render). NOT raw IaaS or VMs.',
  'cdn': 'Content delivery networks and edge platforms (Cloudflare, Fastly, KeyCDN). NOT hosting platforms.',
  'cms': 'Headless CMS and content management APIs (Sanity, Contentful, Strapi). NOT website builders.',
  'media': 'Media processing, video hosting, streaming, and image optimization (Mux, Cloudflare Stream, Imgix, Cloudinary). NOT AI generation (that is "ai-image" or "ai-video").',
  'web-search': 'Web search, SERP, and web scraping APIs (Exa, SerpApi, Firecrawl, Apify). NOT full-text search for apps (that is "search").',
};

// Domains that indicate a blog/news/aggregator site rather than a real provider
const BLOCKED_DOMAINS = new Set([
  'medium.com', 'dev.to', 'hackernoon.com', 'techcrunch.com',
  'producthunt.com', 'g2.com', 'capterra.com', 'alternativeto.net',
  'slant.co', 'stackshare.io', 'reddit.com', 'news.ycombinator.com',
  'wikipedia.org', 'github.com', 'stackoverflow.com', 'youtube.com',
]);

// Words in names that suggest an article, not a product
const ARTICLE_NAME_PATTERNS = /\b(best|top\s*\d+|vs\.?|versus|comparison|guide|review|how\s+to|tutorial|list\s+of|alternatives?\s+to)\b/i;

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

function validateProvider(input: Record<string, unknown>, expectedCategory: string): ValidationResult {
  const name = input.name as string;
  const website = input.website as string | undefined;

  if (ARTICLE_NAME_PATTERNS.test(name)) {
    return { valid: false, reason: `Name "${name}" looks like an article title, not a product name` };
  }

  if (website) {
    try {
      const hostname = new URL(website).hostname.replace(/^www\./, '');
      if (BLOCKED_DOMAINS.has(hostname)) {
        return { valid: false, reason: `Website domain "${hostname}" is a blog/news/aggregator site` };
      }
    } catch {
      // Invalid URL is fine — will still be stored
    }
  }

  const category = input.category as string;
  if (category !== expectedCategory) {
    return { valid: false, reason: `Category mismatch: agent said "${category}" but we asked for "${expectedCategory}"` };
  }

  return { valid: true };
}

// ============================================
// Agent Tools
// ============================================

const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_web',
    description: 'Search the web for information about APIs, services, and developer tools. Use this to find new providers, read comparison articles, discover recent launches, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "best vector database APIs 2026", "new webhook service launched")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_existing_providers',
    description: 'Get the list of providers we already have in our database for a category. Use this to check what we already know about before adding duplicates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Category to check (e.g., "email", "vector-db", "webhooks")',
        },
      },
      required: ['category'],
    },
  },
  {
    name: 'scrape_website',
    description: 'Scrape a provider website to get detailed information for building their profile. Returns markdown content from the URL.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'URL to scrape (e.g., "https://pinecone.io", "https://svix.com")',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'register_provider',
    description: 'Add a new provider to our database. Only call this for real, concrete API/service products that developers can sign up for and integrate. Do NOT register blog posts, articles, or comparison sites.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Display name (e.g., "Pinecone", "Svix"). Must be the actual product name.',
        },
        category: {
          type: 'string',
          description: 'Primary category.',
        },
        description: {
          type: 'string',
          description: 'Concise 1-3 sentence description of what this API/service does.',
        },
        website: {
          type: 'string',
          description: 'Primary website URL.',
        },
        docsUrl: { type: 'string', description: 'Developer docs URL.' },
        pricingUrl: { type: 'string', description: 'Pricing page URL.' },
        githubRepo: { type: 'string', description: 'GitHub repo (org/repo format).' },
        strengths: {
          type: 'array',
          items: { type: 'string', enum: ['dx', 'reliability', 'cost', 'performance', 'support', 'security', 'customization'] },
          description: 'Top 2-4 strengths.',
        },
        weaknesses: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific weaknesses.',
        },
        bestFor: {
          type: 'array',
          items: { type: 'string', enum: ['hobby', 'startup', 'growth', 'enterprise'] },
          description: 'Target scale segments.',
        },
        avoidIf: {
          type: 'array',
          items: { type: 'string' },
          description: 'Conditions where this is a poor fit.',
        },
        bestWhen: {
          type: 'array',
          items: { type: 'string' },
          description: 'Conditions where this shines.',
        },
        alternatives: {
          type: 'array',
          items: { type: 'string' },
          description: 'Provider IDs of competitors (lowercase slugs).',
        },
        compliance: {
          type: 'array',
          items: { type: 'string' },
          description: 'Verified compliance certs.',
        },
        ecosystem: { type: 'string', description: 'Ecosystem affinity.' },
        selfHostable: { type: 'boolean', description: 'Can be self-hosted.' },
        subcategories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Subcategories.',
        },
      },
      required: ['name', 'category', 'description', 'website', 'strengths', 'bestFor'],
    },
  },
  {
    name: 'done',
    description: 'Signal that you have finished discovering providers for this category. Call this when you have thoroughly researched and registered all notable providers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: {
          type: 'string',
          description: 'Brief summary of what you found and registered.',
        },
      },
      required: ['summary'],
    },
  },
];

// ============================================
// Tool Handlers
// ============================================

let exa: Exa | null = null;

function getExa(): Exa {
  if (!exa) exa = new Exa(process.env.EXA_API_KEY!);
  return exa;
}

async function handleSearchWeb(query: string): Promise<string> {
  try {
    const results = await getExa().searchAndContents(query, {
      type: 'auto',
      numResults: 8,
      text: true,
      highlights: true,
    });

    if (results.results.length === 0) return 'No results found.';

    return results.results
      .map(r => {
        const highlight = r.highlights?.[0] ?? r.text?.slice(0, 300) ?? '';
        return `**${r.title}**\n${r.url}\n${highlight}`;
      })
      .join('\n\n');
  } catch (err) {
    return `Search failed: ${err}`;
  }
}

async function handleGetExistingProviders(category: string): Promise<string> {
  try {
    const providers = await getProvidersByCategory(category);
    if (providers.length === 0) return `No providers in "${category}" category yet.`;

    return `Existing providers in "${category}" (${providers.length}):\n` +
      providers.map(p => `- ${p.name} (${p.id}) — ${p.description?.slice(0, 80) ?? 'no description'}`).join('\n');
  } catch (err) {
    return `Failed to get providers: ${err}`;
  }
}

async function handleScrapeWebsite(url: string): Promise<string> {
  if (!process.env.FIRECRAWL_API_KEY) {
    return 'Firecrawl not available (FIRECRAWL_API_KEY not set). Use information from search results instead.';
  }

  try {
    const FirecrawlApp = (await import('@mendable/firecrawl-js')).default;
    const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

    const result = await firecrawl.scrapeUrl(url, { formats: ['markdown'] });
    if (result.success && result.markdown) {
      return result.markdown.slice(0, 6000);
    }
    return 'Scrape returned no content.';
  } catch (err) {
    return `Scrape failed: ${err}`;
  }
}

/** Check if a discovered provider has enough data to auto-approve */
function meetsAutoApproveThreshold(input: Record<string, unknown>): boolean {
  const description = input.description as string | undefined;
  const website = input.website as string | undefined;
  const docsUrl = input.docsUrl as string | undefined;
  const strengths = input.strengths as string[] | undefined;
  const bestFor = input.bestFor as string[] | undefined;

  return !!(
    description && description.length > 100 &&
    website &&
    docsUrl &&
    strengths && strengths.length >= 2 &&
    bestFor && bestFor.length >= 1
  );
}

async function handleRegisterProvider(
  input: Record<string, unknown>,
  dryRun: boolean,
  runId: string,
  expectedCategory: string,
  autoApprove: boolean = true,
): Promise<{ result: string; registered: boolean }> {
  const name = input.name as string | undefined;
  if (!name) {
    return { result: 'Error: name is required to register a provider.', registered: false };
  }
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  // Validate before inserting
  const validation = validateProvider(input, expectedCategory);
  if (!validation.valid) {
    console.log(`    [SKIPPED] ${name}: ${validation.reason}`);
    if (!dryRun) {
      await insertDiscoveryLog({
        runId,
        providerId: id,
        providerName: name,
        category: expectedCategory,
        action: 'skipped',
        reason: validation.reason,
        fieldsJson: JSON.stringify(input),
      });
    }
    return { result: `Skipped "${name}": ${validation.reason}`, registered: false };
  }

  const provider: KnownProvider = {
    id,
    name,
    category: input.category as string,
    description: input.description as string,
    website: input.website as string,
    docsUrl: input.docsUrl as string | undefined,
    pricingUrl: input.pricingUrl as string | undefined,
    githubRepo: input.githubRepo as string | undefined,
    strengths: input.strengths as KnownProvider['strengths'],
    weaknesses: input.weaknesses as string[] | undefined,
    bestFor: input.bestFor as KnownProvider['bestFor'],
    avoidIf: input.avoidIf as string[] | undefined,
    bestWhen: input.bestWhen as string[] | undefined,
    alternatives: input.alternatives as string[] | undefined,
    compliance: input.compliance as string[] | undefined,
    ecosystem: input.ecosystem as string | undefined,
    selfHostable: input.selfHostable as boolean | undefined,
    subcategories: input.subcategories as string[] | undefined,
    status: 'active',
    reviewStatus: 'pending',
    lastVerified: new Date().toISOString().split('T')[0],
  };

  // Auto-approve if quality gate passes
  const qualityPass = autoApprove && meetsAutoApproveThreshold(input);
  const reviewStatus = qualityPass ? 'approved' : 'pending';
  provider.reviewStatus = reviewStatus;

  if (dryRun) {
    console.log(`    [DRY RUN] Would register: ${name} (${id}) as ${reviewStatus}`);
    return { result: `[DRY RUN] Would register ${name} (${id}) as ${reviewStatus}`, registered: true };
  }

  try {
    await insertDiscoveredProviderFull(provider, reviewStatus);
    await insertDiscoveryLog({
      runId,
      providerId: id,
      providerName: name,
      category: expectedCategory,
      action: qualityPass ? 'auto-approved' : 'registered',
      fieldsJson: JSON.stringify(input),
    });
    const statusLabel = qualityPass ? 'auto-approved' : 'pending — awaiting review';
    console.log(`    Registered: ${name} (${id}) as ${statusLabel}`);
    return { result: `Registered ${name} (${id}) as ${statusLabel}.`, registered: true };
  } catch (err) {
    const msg = `Failed to register ${name}: ${err}`;
    console.error(`    ${msg}`);
    return { result: msg, registered: false };
  }
}

// ============================================
// Agent Loop
// ============================================

interface BootstrapOptions {
  dryRun?: boolean;
  category?: string;
  autoApprove?: boolean;
}

interface BootstrapResult {
  category: string;
  registered: number;
  toolCalls: number;
  tokensUsed: number;
  summary: string;
}

const SYSTEM_PROMPT = `You are an API discovery agent for a developer tool recommendation database called stacksherpa. Your job is to find and register real API/service providers for a given category.

You have access to tools to search the web, check our existing database, scrape provider websites, and register new providers.

## CRITICAL: Never rely on training data
- You MUST search the web and scrape websites for ALL information
- NEVER use your training knowledge to fill in details about a provider — it may be outdated
- Models get sunset, pricing changes, features evolve — only use LIVE scraped data
- If you can't scrape a provider's website, note what you found from search results only
- Register providers at the COMPANY/PLATFORM level, not individual models or versions
  - Correct: "OpenAI" (the platform), "ElevenLabs" (the service)
  - Wrong: "GPT-4o" (a model), "ElevenLabs v2" (a version)

## Your process:
1. First, check what providers we already have in this category
2. Search for comparison articles, "best X APIs" posts, and recent launches to learn what's out there
3. Read articles to identify real providers we're missing
4. For each missing provider, scrape their website to get accurate details
5. Register them with rich, factual profiles based ONLY on scraped evidence
6. Call "done" when you've thoroughly covered the category

## Rules:
- Only register REAL products that developers can sign up for and use via API
- Never register blog posts, articles, consulting firms, or aggregator sites
- Always check existing providers first to avoid duplicates
- When you find a comparison article, extract the individual provider names and research each one
- Scrape each provider's actual website before registering — don't guess at details
- Be thorough: aim to find 5-10 notable providers per category
- Include both well-known leaders and promising newcomers
- Use lowercase slug IDs for alternatives (e.g., "pinecone", "weaviate")
- Provider IDs should be the company/platform name, not model names

## Category Validation:
- ONLY register providers that match the category definition provided
- If unsure whether a product fits the category, do NOT register it
- Never register: blog posts, articles, comparison sites, consulting firms, or aggregator platforms
- The "category" field you pass to register_provider MUST exactly match the category you were asked to discover for`;

function buildUserPrompt(category: string): string {
  // Find all aliases that map to this category
  const aliases = Object.entries(categoryAliases)
    .filter(([, cat]) => cat === category)
    .map(([alias]) => alias);

  const description = CATEGORY_DESCRIPTIONS[category];

  let prompt = `Discover and register providers for the "${category}" category.`;
  if (description) {
    prompt += `\n\n**Category definition**: ${description}`;
  }
  if (aliases.length > 0) {
    prompt += `\n\n**Also known as**: ${aliases.join(', ')}.`;
  }
  prompt += `\n\nStart by checking what we already have, then search for what's missing. Only register providers that match the category definition above.`;
  return prompt;
}

async function bootstrapCategory(
  anthropic: Anthropic,
  category: string,
  dryRun: boolean,
  runId: string,
  autoApprove: boolean = true,
): Promise<BootstrapResult> {
  const result: BootstrapResult = {
    category,
    registered: 0,
    toolCalls: 0,
    tokensUsed: 0,
    summary: '',
  };

  console.log(`\n--- Agent: ${category} ---`);

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: buildUserPrompt(category),
    },
  ];

  const MAX_TURNS = 15;
  const MAX_TOKENS_PER_CATEGORY = 500_000; // ~$0.63 ceiling per category

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (result.tokensUsed >= MAX_TOKENS_PER_CATEGORY) {
      console.log(`    [budget] Token ceiling reached (${result.tokensUsed.toLocaleString()} tokens), stopping category`);
      result.summary = `Stopped: token budget exceeded (${result.tokensUsed.toLocaleString()} tokens)`;
      return result;
    }
    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages,
        tools: AGENT_TOOLS,
      });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 429) {
        console.log(`    [rate-limited] Waiting 60s before retry...`);
        await sleep(60000);
        try {
          response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            system: SYSTEM_PROMPT,
            messages,
            tools: AGENT_TOOLS,
          });
        } catch {
          console.error(`    [error] Rate limit retry failed, stopping category`);
          result.summary = 'Stopped due to rate limit';
          return result;
        }
      } else {
        throw err;
      }
    }

    result.tokensUsed += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    // Check if we're done (no tool use, or stop reason is end_turn)
    if (response.stop_reason === 'end_turn' && !response.content.some(b => b.type === 'tool_use')) {
      const textBlock = response.content.find(b => b.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        result.summary = textBlock.text;
      }
      break;
    }

    // Process tool calls
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUseBlocks.length === 0) break;

    // Add assistant message with all content
    messages.push({ role: 'assistant', content: response.content });

    // Process each tool call and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      result.toolCalls++;
      const input = toolUse.input as Record<string, unknown>;
      let toolResult: string;

      switch (toolUse.name) {
        case 'search_web':
          console.log(`    [search] ${input.query}`);
          toolResult = await handleSearchWeb(input.query as string);
          break;

        case 'get_existing_providers':
          console.log(`    [db] checking ${input.category}`);
          toolResult = await handleGetExistingProviders(input.category as string);
          break;

        case 'scrape_website':
          console.log(`    [scrape] ${input.url}`);
          toolResult = await handleScrapeWebsite(input.url as string);
          break;

        case 'register_provider': {
          const registerResult = await handleRegisterProvider(input, dryRun, runId, category, autoApprove);
          toolResult = registerResult.result;
          if (registerResult.registered) {
            result.registered++;
          }
          break;
        }

        case 'done':
          result.summary = input.summary as string;
          console.log(`    [done] ${result.summary}`);
          // Return result immediately
          return result;

        default:
          toolResult = `Unknown tool: ${toolUse.name}`;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: toolResult,
      });

      // Small delay between tool calls for rate limiting
      await sleep(300);
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return result;
}

// ============================================
// Main
// ============================================

export async function bootstrapAll(options: BootstrapOptions = {}): Promise<BootstrapResult[]> {
  if (!process.env.EXA_API_KEY) {
    console.log('Skipping bootstrap: EXA_API_KEY not set');
    return [];
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('Skipping bootstrap: ANTHROPIC_API_KEY not set');
    return [];
  }

  const anthropic = new Anthropic();
  const categories = options.category ? [options.category] : CATEGORIES;
  const runId = `bootstrap-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`;

  console.log(`Run ID: ${runId}`);

  const autoApprove = options.autoApprove ?? true;
  const results = await processInBatches(categories, 3, (category) =>
    bootstrapCategory(anthropic, category, options.dryRun ?? false, runId, autoApprove),
  );

  // Summary
  const totalRegistered = results.reduce((s, r) => s + r.registered, 0);
  const totalToolCalls = results.reduce((s, r) => s + r.toolCalls, 0);
  const totalTokens = results.reduce((s, r) => s + r.tokensUsed, 0);

  console.log('\n=== Bootstrap Summary ===');
  console.log(`Run ID: ${runId}`);
  console.log(`Categories: ${categories.length}`);
  console.log(`Providers registered (pending review): ${totalRegistered}`);
  console.log(`Tool calls: ${totalToolCalls}`);
  console.log(`Tokens: ${totalTokens.toLocaleString()} (~$${(totalTokens * 0.00000125).toFixed(4)})`);

  for (const r of results) {
    if (r.registered > 0 || r.summary) {
      console.log(`  ${r.category}: +${r.registered} providers — ${r.summary}`);
    }
  }

  if (totalRegistered > 0) {
    if (autoApprove) {
      console.log(`\n${totalRegistered} new providers (auto-approved if quality gate passed, else pending).`);
      console.log('Check pending: npm run cron:review -- --list');
    } else {
      console.log(`\n${totalRegistered} new providers pending review. Run: npm run cron:review -- --list`);
    }
  }

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
  delayMs = 500,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < items.length) await sleep(delayMs);
  }
  return results;
}

// ============================================
// CLI
// ============================================

const isDirectRun = process.argv[1]?.endsWith('bootstrap-roster.ts') ||
                    process.argv[1]?.endsWith('bootstrap-roster.js');

if (isDirectRun) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const noAutoApprove = args.includes('--no-auto-approve');
  const catIdx = args.indexOf('--category');
  const singleCategory = catIdx !== -1 ? args[catIdx + 1] : undefined;

  if (!process.env.TURSO_WRITE_TOKEN && !isDryRun) {
    console.error('Error: TURSO_WRITE_TOKEN is required (or use --dry-run)');
    process.exit(1);
  }

  if (!process.env.EXA_API_KEY) {
    console.error('Error: EXA_API_KEY is required');
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY is required');
    process.exit(1);
  }

  console.log('=== stacksherpa Bootstrap Agent ===');
  console.log(`Started at: ${new Date().toISOString()}`);
  if (isDryRun) console.log('DRY RUN enabled');
  if (noAutoApprove) console.log('Auto-approve DISABLED — all providers will be pending');
  if (singleCategory) console.log(`Category: ${singleCategory}`);

  bootstrapAll({ dryRun: isDryRun, category: singleCategory, autoApprove: !noAutoApprove })
    .then(() => console.log('\nDone'))
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
