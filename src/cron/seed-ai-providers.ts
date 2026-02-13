#!/usr/bin/env tsx
/**
 * Seed AI/LLM Providers — Structural Data Only
 *
 * Registers major AI/LLM providers with structural data (identity, URLs,
 * packages, compliance, alternatives). Does NOT hardcode descriptions,
 * strengths, or routing hints — those are populated by the agent-refresh
 * pipeline using live web data.
 *
 * After seeding, run: npm run cron:agent-refresh -- --category ai
 * to populate descriptions with current model info from the web.
 *
 * Run via: npm run seed:ai
 * Requires: TURSO_WRITE_TOKEN
 */

import { upsertProvider } from '../db/client.js';
import type { KnownProvider } from '../types.js';

/**
 * Structural-only provider entries. Fields like description, strengths,
 * weaknesses, bestFor, avoidIf, bestWhen are intentionally minimal —
 * agent-refresh will overwrite them with live web-researched data.
 */
const providers: KnownProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'ai',
    description: 'LLM and AI model API platform — GPT, o-series reasoning, DALL-E, Whisper.',
    website: 'https://openai.com',
    docsUrl: 'https://platform.openai.com/docs',
    pricingUrl: 'https://openai.com/api/pricing',
    githubRepo: 'openai/openai-node',
    package: 'openai',
    packageAltNames: { python: 'openai', go: 'github.com/openai/openai-go' },
    compliance: ['SOC2', 'GDPR', 'HIPAA'],
    alternatives: ['anthropic', 'google-ai', 'azure-openai'],
    selfHostable: false,
    subcategories: ['llm', 'image-generation', 'speech', 'embeddings', 'video'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'ai',
    description: 'Claude model family — LLM API for coding, analysis, and long-context tasks.',
    website: 'https://anthropic.com',
    docsUrl: 'https://docs.anthropic.com',
    pricingUrl: 'https://anthropic.com/pricing',
    githubRepo: 'anthropics/anthropic-sdk-python',
    package: '@anthropic-ai/sdk',
    packageAltNames: { python: 'anthropic', go: 'github.com/anthropics/anthropic-sdk-go' },
    compliance: ['SOC2', 'GDPR', 'HIPAA'],
    alternatives: ['openai', 'google-ai', 'deepseek'],
    selfHostable: false,
    subcategories: ['llm', 'embeddings'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'google-ai',
    name: 'Google AI',
    category: 'ai',
    description: 'Gemini model family — multimodal LLM API with large context windows.',
    website: 'https://ai.google.dev',
    docsUrl: 'https://ai.google.dev/docs',
    pricingUrl: 'https://ai.google.dev/pricing',
    githubRepo: 'google-gemini/generative-ai-js',
    package: '@google/generative-ai',
    packageAltNames: { python: 'google-generativeai' },
    compliance: ['SOC2', 'GDPR', 'HIPAA', 'ISO27001'],
    ecosystem: 'google-cloud',
    alternatives: ['openai', 'anthropic', 'deepseek'],
    selfHostable: false,
    subcategories: ['llm', 'image-generation', 'embeddings', 'speech'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'mistral',
    name: 'Mistral AI',
    category: 'ai',
    description: 'European AI lab — open-weight and API models, strong on code generation.',
    website: 'https://mistral.ai',
    docsUrl: 'https://docs.mistral.ai',
    pricingUrl: 'https://mistral.ai/technology',
    githubRepo: 'mistralai/client-js',
    package: '@mistralai/mistralai',
    packageAltNames: { python: 'mistralai' },
    compliance: ['SOC2', 'GDPR'],
    alternatives: ['openai', 'anthropic', 'deepseek'],
    selfHostable: true,
    subcategories: ['llm', 'embeddings', 'code-generation', 'speech'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'meta-llama',
    name: 'Meta Llama',
    category: 'ai',
    description: 'Open-source LLM family from Meta — no direct API, hosted via inference providers.',
    website: 'https://llama.meta.com',
    docsUrl: 'https://llama.meta.com/docs',
    alternatives: ['together-ai', 'groq', 'fireworks-ai', 'deepseek'],
    selfHostable: true,
    subcategories: ['llm', 'embeddings'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'cohere',
    name: 'Cohere',
    category: 'ai',
    description: 'Enterprise AI platform — RAG, embeddings, and reranking.',
    website: 'https://cohere.com',
    docsUrl: 'https://docs.cohere.com',
    pricingUrl: 'https://cohere.com/pricing',
    githubRepo: 'cohere-ai/cohere-typescript',
    package: 'cohere-ai',
    packageAltNames: { python: 'cohere' },
    compliance: ['SOC2', 'GDPR', 'HIPAA'],
    alternatives: ['openai', 'anthropic', 'google-ai'],
    selfHostable: true,
    onPremOption: true,
    subcategories: ['llm', 'embeddings', 'search'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'ai21-labs',
    name: 'AI21 Labs',
    category: 'ai',
    description: 'Enterprise NLP — Jamba hybrid SSM-Transformer models, summarization APIs.',
    website: 'https://ai21.com',
    docsUrl: 'https://docs.ai21.com',
    pricingUrl: 'https://ai21.com/pricing',
    githubRepo: 'AI21Labs/ai21-typescript',
    package: 'ai21',
    packageAltNames: { python: 'ai21' },
    compliance: ['SOC2', 'GDPR'],
    alternatives: ['cohere', 'openai', 'anthropic'],
    selfHostable: false,
    subcategories: ['llm', 'embeddings'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'together-ai',
    name: 'Together AI',
    category: 'ai',
    description: 'Inference platform for open-source models — hosting, fine-tuning, GPU cloud.',
    website: 'https://together.ai',
    docsUrl: 'https://docs.together.ai',
    pricingUrl: 'https://together.ai/pricing',
    githubRepo: 'togethercomputer/together-typescript',
    package: 'together-ai',
    packageAltNames: { python: 'together' },
    compliance: ['SOC2', 'GDPR'],
    alternatives: ['fireworks-ai', 'groq', 'replicate'],
    selfHostable: false,
    subcategories: ['llm', 'embeddings', 'image-generation'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'groq',
    name: 'Groq',
    category: 'ai',
    description: 'Ultra-fast LLM inference on custom LPU hardware.',
    website: 'https://groq.com',
    docsUrl: 'https://console.groq.com/docs',
    pricingUrl: 'https://groq.com/pricing',
    githubRepo: 'groq/groq-typescript',
    package: 'groq-sdk',
    packageAltNames: { python: 'groq' },
    compliance: ['SOC2'],
    alternatives: ['cerebras', 'together-ai', 'fireworks-ai'],
    selfHostable: false,
    subcategories: ['llm'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'fireworks-ai',
    name: 'Fireworks AI',
    category: 'ai',
    description: 'Fast inference platform — function calling, compound AI, open models.',
    website: 'https://fireworks.ai',
    docsUrl: 'https://docs.fireworks.ai',
    pricingUrl: 'https://fireworks.ai/pricing',
    githubRepo: 'fw-ai/fireworks-js',
    package: 'fireworks-js',
    packageAltNames: { python: 'fireworks-ai' },
    compliance: ['SOC2', 'GDPR'],
    alternatives: ['together-ai', 'groq', 'replicate'],
    selfHostable: false,
    subcategories: ['llm', 'embeddings'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'perplexity',
    name: 'Perplexity',
    category: 'ai',
    description: 'Search-augmented LLM API — grounded responses with citations.',
    website: 'https://perplexity.ai',
    docsUrl: 'https://docs.perplexity.ai',
    pricingUrl: 'https://docs.perplexity.ai/guides/pricing',
    compliance: ['SOC2'],
    alternatives: ['openai', 'google-ai'],
    selfHostable: false,
    subcategories: ['llm', 'search'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'ai',
    description: 'Chinese AI lab — frontier-quality open-weight models at very low cost.',
    website: 'https://deepseek.com',
    docsUrl: 'https://platform.deepseek.com/api-docs',
    pricingUrl: 'https://platform.deepseek.com/api-docs/pricing',
    githubRepo: 'deepseek-ai/DeepSeek-V3',
    alternatives: ['openai', 'anthropic', 'together-ai'],
    selfHostable: true,
    subcategories: ['llm', 'code-generation'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'xai',
    name: 'xAI',
    category: 'ai',
    description: 'Grok model family — large context windows, competitive pricing.',
    website: 'https://x.ai',
    docsUrl: 'https://docs.x.ai',
    pricingUrl: 'https://docs.x.ai/docs/pricing',
    alternatives: ['openai', 'anthropic', 'google-ai'],
    selfHostable: false,
    subcategories: ['llm', 'image-generation', 'video'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'amazon-bedrock',
    name: 'Amazon Bedrock',
    category: 'ai',
    description: 'AWS managed multi-model API — Claude, Llama, Mistral, and more under unified billing.',
    website: 'https://aws.amazon.com/bedrock',
    docsUrl: 'https://docs.aws.amazon.com/bedrock',
    pricingUrl: 'https://aws.amazon.com/bedrock/pricing',
    package: '@aws-sdk/client-bedrock-runtime',
    packageAltNames: { python: 'boto3' },
    compliance: ['SOC2', 'HIPAA', 'GDPR', 'PCI-DSS', 'ISO27001'],
    ecosystem: 'aws',
    alternatives: ['azure-openai', 'google-ai', 'openai'],
    selfHostable: false,
    subcategories: ['llm', 'embeddings', 'image-generation'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    category: 'ai',
    description: 'OpenAI models on Microsoft Azure with enterprise networking and compliance.',
    website: 'https://azure.microsoft.com/en-us/products/ai-services/openai-service',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/ai-services/openai',
    pricingUrl: 'https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service',
    package: 'openai',
    packageAltNames: { python: 'openai' },
    compliance: ['SOC2', 'HIPAA', 'GDPR', 'PCI-DSS', 'ISO27001'],
    ecosystem: 'azure',
    alternatives: ['openai', 'amazon-bedrock', 'google-ai'],
    selfHostable: false,
    subcategories: ['llm', 'image-generation', 'speech', 'embeddings', 'video'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'replicate',
    name: 'Replicate',
    category: 'ai',
    description: 'Run any open-source model via API — 50K+ models, pay-per-second billing.',
    website: 'https://replicate.com',
    docsUrl: 'https://replicate.com/docs',
    pricingUrl: 'https://replicate.com/pricing',
    githubRepo: 'replicate/replicate-javascript',
    package: 'replicate',
    packageAltNames: { python: 'replicate' },
    compliance: ['SOC2'],
    alternatives: ['together-ai', 'fireworks-ai', 'huggingface'],
    selfHostable: false,
    subcategories: ['llm', 'image-generation', 'speech', 'video'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'huggingface',
    name: 'Hugging Face',
    category: 'ai',
    description: 'Open-source AI hub — model hosting, inference API, Transformers ecosystem.',
    website: 'https://huggingface.co',
    docsUrl: 'https://huggingface.co/docs',
    pricingUrl: 'https://huggingface.co/pricing',
    githubRepo: 'huggingface/huggingface.js',
    package: '@huggingface/inference',
    packageAltNames: { python: 'huggingface_hub' },
    compliance: ['SOC2', 'GDPR'],
    alternatives: ['replicate', 'together-ai'],
    selfHostable: true,
    subcategories: ['llm', 'embeddings', 'image-generation', 'speech'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  {
    id: 'cerebras',
    name: 'Cerebras',
    category: 'ai',
    description: 'Fastest inference in industry — wafer-scale chips, 3000+ tok/s.',
    website: 'https://cerebras.ai',
    docsUrl: 'https://inference-docs.cerebras.ai',
    pricingUrl: 'https://cerebras.ai/inference',
    alternatives: ['groq', 'together-ai', 'fireworks-ai'],
    selfHostable: false,
    subcategories: ['llm'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },

  // Reclassify vercel-ai-sdk from 'ai' to 'ai-orchestration'
  {
    id: 'vercel-ai-sdk',
    name: 'Vercel AI SDK',
    category: 'ai-orchestration',
    description: 'TypeScript SDK for building AI apps — unified API across 20+ LLM providers.',
    website: 'https://sdk.vercel.ai',
    docsUrl: 'https://sdk.vercel.ai/docs',
    githubRepo: 'vercel/ai',
    package: 'ai',
    ecosystem: 'vercel',
    alternatives: ['langchain', 'llamaindex'],
    selfHostable: true,
    subcategories: ['sdk', 'framework'],
    reviewStatus: 'approved',
    lastVerified: '2024-01-01',
  },
];

async function main() {
  if (!process.env.TURSO_WRITE_TOKEN) {
    console.error('Error: TURSO_WRITE_TOKEN is required');
    process.exit(1);
  }

  console.log(`Seeding ${providers.length} AI providers (structural data only)...\n`);

  let success = 0;
  let failed = 0;

  for (const provider of providers) {
    try {
      await upsertProvider(provider);
      console.log(`  OK ${provider.id} (${provider.category})`);
      success++;
    } catch (err) {
      console.error(`  FAIL ${provider.id}: ${err}`);
      failed++;
    }
  }

  console.log(`\nSeed complete: ${success} succeeded, ${failed} failed`);

  // Prompt to run agent-refresh to fill in live descriptions
  if (success > 0) {
    console.log('\nDescriptions are minimal placeholders.');
    console.log('Run agent-refresh to populate with live web data:');
    console.log('  npm run cron:agent-refresh -- --category ai');
  }

  if (failed > 0) process.exit(1);
}

main();
