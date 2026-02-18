#!/usr/bin/env tsx
/**
 * P0/P1 Provider Seed — fix thin categories + add high-value gaps
 *
 * 1. Reclassify PostHog, Amplitude, Statsig → analytics (keep in feature-flags too via subcategory)
 * 2. Insert missing providers across analytics, database, storage, push, monitoring
 * 3. Insert P1 high-value providers (PayPal, Plaid, Brevo, etc.)
 *
 * Run: npx tsx src/db/seed-p0.ts
 * Requires: TURSO_WRITE_TOKEN
 */

import { createClient } from '@libsql/client';

const TURSO_URL = process.env.TURSO_DATABASE_URL ?? 'libsql://api-broker-astein91.aws-us-west-2.turso.io';
const TURSO_TOKEN = process.env.TURSO_WRITE_TOKEN ?? process.env.TURSO_AUTH_TOKEN;

if (!TURSO_TOKEN) {
  console.error('Error: TURSO_WRITE_TOKEN is required');
  process.exit(1);
}

const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

interface SeedProvider {
  id: string;
  name: string;
  category: string;
  description: string;
  website: string;
  docsUrl?: string;
  pricingUrl?: string;
  strengths: string[];
  weaknesses?: string[];
  bestFor: string[];
  avoidIf?: string[];
  bestWhen?: string[];
  alternatives?: string[];
  compliance?: string[];
  ecosystem?: string;
  selfHostable?: boolean;
  subcategories?: string[];
}

const PROVIDERS: SeedProvider[] = [
  // ============================================
  // ANALYTICS (P0 — raise from 2 to 8+)
  // ============================================
  {
    id: 'segment',
    name: 'Segment',
    category: 'analytics',
    description: 'Customer data platform (CDP) that collects, cleans, and routes event data to 400+ downstream tools. Developers use it as the single API for all analytics, marketing, and data warehouse integrations.',
    website: 'https://segment.com',
    docsUrl: 'https://segment.com/docs',
    pricingUrl: 'https://segment.com/pricing',
    strengths: ['dx', 'customization', 'reliability'],
    weaknesses: ['Expensive at scale', 'Free tier limited to 1,000 visitors/month', 'Can add latency as a proxy layer'],
    bestFor: ['startup', 'growth', 'enterprise'],
    avoidIf: ['Budget under $50/mo', 'Only need basic page views', 'Latency-sensitive real-time pipelines'],
    bestWhen: ['Sending events to multiple downstream tools', 'Need a single tracking API across web/mobile', 'Building a composable data stack'],
    alternatives: ['rudderstack', 'heap', 'posthog', 'mixpanel'],
    compliance: ['SOC2', 'GDPR', 'HIPAA'],
    ecosystem: 'twilio',
    subcategories: ['cdp', 'event-routing'],
  },
  {
    id: 'heap',
    name: 'Heap',
    category: 'analytics',
    description: 'Autocapture product analytics platform that records all user interactions without manual instrumentation. Developers use it for retroactive analysis — ask questions about behavior that happened before you defined the event.',
    website: 'https://heap.io',
    docsUrl: 'https://developers.heap.io',
    pricingUrl: 'https://heap.io/pricing',
    strengths: ['dx', 'customization'],
    weaknesses: ['Autocapture increases data volume and cost', 'Less control over event taxonomy than manual instrumentation', 'UI can feel complex for simple use cases'],
    bestFor: ['startup', 'growth', 'enterprise'],
    avoidIf: ['Need strict event schema governance', 'Very high-traffic consumer app (cost scales with sessions)', 'Prefer code-first instrumentation'],
    bestWhen: ['Want analytics without upfront instrumentation work', 'Need retroactive event analysis', 'Product teams want self-serve insights'],
    alternatives: ['posthog', 'amplitude', 'mixpanel', 'segment'],
    compliance: ['SOC2', 'GDPR'],
    subcategories: ['product-analytics', 'autocapture'],
  },
  {
    id: 'rudderstack',
    name: 'RudderStack',
    category: 'analytics',
    description: 'Open-source customer data platform for collecting, routing, and transforming event data. Developer-focused alternative to Segment with warehouse-native architecture and self-hosting option.',
    website: 'https://rudderstack.com',
    docsUrl: 'https://www.rudderstack.com/docs',
    pricingUrl: 'https://www.rudderstack.com/pricing',
    strengths: ['dx', 'cost', 'customization'],
    weaknesses: ['Smaller integration catalog than Segment', 'Self-hosted version requires infrastructure expertise', 'Smaller community than proprietary alternatives'],
    bestFor: ['startup', 'growth', 'enterprise'],
    avoidIf: ['Need 400+ pre-built integrations', 'No infrastructure team for self-hosting', 'Prefer managed-only solutions'],
    bestWhen: ['Want open-source CDP', 'Warehouse-first data architecture', 'Need to self-host for compliance'],
    alternatives: ['segment', 'posthog', 'heap'],
    compliance: ['SOC2', 'GDPR', 'HIPAA'],
    selfHostable: true,
    subcategories: ['cdp', 'event-routing', 'warehouse-native'],
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics 4',
    category: 'analytics',
    description: 'Free web and app analytics platform with event-based tracking, cross-platform measurement, and BigQuery integration. The default analytics tool for most web properties.',
    website: 'https://analytics.google.com',
    docsUrl: 'https://developers.google.com/analytics',
    pricingUrl: 'https://analytics.google.com',
    strengths: ['cost', 'reliability'],
    weaknesses: ['Complex migration from Universal Analytics', 'Data sampling on free tier at high volumes', 'Privacy concerns — data used for Google ad targeting', 'Limited real-time capabilities'],
    bestFor: ['hobby', 'startup', 'growth'],
    avoidIf: ['Need privacy-first analytics', 'GDPR-strict environment without consent management', 'Need raw event-level data without sampling'],
    bestWhen: ['Basic web analytics on a budget', 'Already in Google ecosystem (Ads, BigQuery)', 'Need cross-platform web + app measurement'],
    alternatives: ['plausible', 'fathom', 'posthog', 'amplitude'],
    compliance: ['GDPR'],
    ecosystem: 'gcp',
    subcategories: ['web-analytics', 'app-analytics'],
  },
  {
    id: 'plausible',
    name: 'Plausible',
    category: 'analytics',
    description: 'Lightweight, privacy-focused web analytics. No cookies, GDPR-compliant by default, open-source. A simple alternative to Google Analytics for teams that want traffic insights without invasive tracking.',
    website: 'https://plausible.io',
    docsUrl: 'https://plausible.io/docs',
    pricingUrl: 'https://plausible.io/#pricing',
    strengths: ['dx', 'cost', 'security'],
    weaknesses: ['No product analytics (funnels, cohorts, user-level tracking)', 'Limited to web — no mobile SDK', 'Smaller feature set than full analytics platforms'],
    bestFor: ['hobby', 'startup'],
    avoidIf: ['Need product analytics with user-level tracking', 'Need mobile app analytics', 'Need advanced funnels/cohorts/retention analysis'],
    bestWhen: ['Privacy-first web analytics', 'Want to drop Google Analytics', 'Simple traffic dashboard without complexity'],
    alternatives: ['fathom', 'google-analytics', 'posthog'],
    compliance: ['GDPR'],
    selfHostable: true,
    subcategories: ['web-analytics', 'privacy-first'],
  },
  {
    id: 'fathom',
    name: 'Fathom',
    category: 'analytics',
    description: 'Privacy-focused website analytics with simple dashboard, no cookies, and GDPR/CCPA compliance. Fast script that doesn\'t slow down pages.',
    website: 'https://usefathom.com',
    docsUrl: 'https://usefathom.com/docs',
    pricingUrl: 'https://usefathom.com/pricing',
    strengths: ['dx', 'performance', 'security'],
    weaknesses: ['No product analytics or user-level tracking', 'No free tier', 'Limited integrations compared to GA4'],
    bestFor: ['hobby', 'startup', 'growth'],
    avoidIf: ['Need product analytics with funnels/cohorts', 'Need free tier', 'Need mobile app analytics'],
    bestWhen: ['Privacy-first web analytics', 'Want simple, fast analytics without cookies', 'Compliance-first environment'],
    alternatives: ['plausible', 'google-analytics', 'posthog'],
    compliance: ['GDPR'],
    subcategories: ['web-analytics', 'privacy-first'],
  },

  // ============================================
  // DATABASE (P0 — raise from 3 to 10+)
  // ============================================
  {
    id: 'mongodb-atlas',
    name: 'MongoDB Atlas',
    category: 'database',
    description: 'Fully managed MongoDB cloud database with global multi-region clusters, serverless instances, and integrated search. The default document database for JavaScript/TypeScript developers.',
    website: 'https://www.mongodb.com/atlas',
    docsUrl: 'https://www.mongodb.com/docs/atlas',
    pricingUrl: 'https://www.mongodb.com/pricing',
    strengths: ['dx', 'reliability', 'performance'],
    weaknesses: ['Costs escalate quickly with large datasets', 'Serverless instances have cold start latency', 'Complex aggregation pipelines can be hard to debug'],
    bestFor: ['startup', 'growth', 'enterprise'],
    avoidIf: ['Need strong relational integrity (use Postgres)', 'Budget-constrained with large data volumes', 'Team prefers SQL over document queries'],
    bestWhen: ['Flexible document schema', 'Full-text search alongside database', 'Global multi-region distribution needed'],
    alternatives: ['supabase', 'neon', 'planetscale', 'cockroachdb'],
    compliance: ['SOC2', 'HIPAA', 'GDPR', 'PCI-DSS', 'ISO27001'],
    subcategories: ['document-db', 'nosql', 'serverless'],
  },
  {
    id: 'cockroachdb',
    name: 'CockroachDB',
    category: 'database',
    description: 'Distributed SQL database that scales horizontally with strong consistency and multi-region survivability. PostgreSQL-compatible wire protocol means existing Postgres tools and ORMs work out of the box.',
    website: 'https://www.cockroachlabs.com',
    docsUrl: 'https://www.cockroachlabs.com/docs',
    pricingUrl: 'https://www.cockroachlabs.com/pricing',
    strengths: ['reliability', 'performance', 'security'],
    weaknesses: ['Higher latency than single-region Postgres for simple queries', 'Pricing can be opaque for serverless tier', 'Some Postgres extensions not supported'],
    bestFor: ['growth', 'enterprise'],
    avoidIf: ['Single-region app where latency matters most', 'Need full Postgres extension compatibility', 'Budget-constrained hobby project'],
    bestWhen: ['Multi-region with strong consistency requirements', 'Need horizontal scaling without sharding', 'Want Postgres compatibility with global distribution'],
    alternatives: ['neon', 'planetscale', 'supabase', 'mongodb-atlas'],
    compliance: ['SOC2', 'HIPAA', 'GDPR', 'PCI-DSS'],
    selfHostable: true,
    subcategories: ['distributed-sql', 'postgres-compatible'],
  },
  {
    id: 'supabase-db',
    name: 'Supabase Postgres',
    category: 'database',
    description: 'Managed Postgres with instant REST and GraphQL APIs, row-level security, realtime subscriptions, and edge functions. The open-source Firebase alternative built on Postgres.',
    website: 'https://supabase.com/database',
    docsUrl: 'https://supabase.com/docs/guides/database',
    pricingUrl: 'https://supabase.com/pricing',
    strengths: ['dx', 'cost', 'customization'],
    weaknesses: ['Connection pooling limits on free tier', 'Realtime subscriptions add complexity', 'Vendor-specific patterns (RLS policies) create lock-in'],
    bestFor: ['hobby', 'startup', 'growth'],
    avoidIf: ['Need raw Postgres without abstraction layer', 'Enterprise compliance requirements beyond SOC2', 'Very high-throughput OLTP workloads'],
    bestWhen: ['Full-stack app with auth + DB + storage in one platform', 'Want instant APIs without building REST layer', 'Real-time features needed alongside database'],
    alternatives: ['neon', 'planetscale', 'firebase', 'mongodb-atlas'],
    compliance: ['SOC2', 'HIPAA', 'GDPR'],
    ecosystem: 'supabase',
    selfHostable: true,
    subcategories: ['postgres', 'baas'],
  },
  {
    id: 'aws-rds',
    name: 'AWS RDS',
    category: 'database',
    description: 'Managed relational database service supporting PostgreSQL, MySQL, MariaDB, Oracle, and SQL Server. Handles backups, patching, scaling, and replication within the AWS ecosystem.',
    website: 'https://aws.amazon.com/rds',
    docsUrl: 'https://docs.aws.amazon.com/rds',
    pricingUrl: 'https://aws.amazon.com/rds/pricing',
    strengths: ['reliability', 'performance', 'security'],
    weaknesses: ['Complex pricing model', 'No serverless option for most engines (Aurora Serverless only)', 'Requires AWS networking knowledge (VPC, security groups)'],
    bestFor: ['growth', 'enterprise'],
    avoidIf: ['Want serverless/pay-per-query pricing', 'Not already on AWS', 'Need simple one-click setup'],
    bestWhen: ['Already on AWS infrastructure', 'Need managed Oracle or SQL Server', 'Enterprise workloads requiring high availability'],
    alternatives: ['neon', 'supabase-db', 'planetscale', 'google-cloud-sql'],
    compliance: ['SOC2', 'HIPAA', 'GDPR', 'PCI-DSS', 'ISO27001'],
    ecosystem: 'aws',
    subcategories: ['postgres', 'mysql', 'managed-rds'],
  },
  {
    id: 'google-cloud-sql',
    name: 'Google Cloud SQL',
    category: 'database',
    description: 'Fully managed relational database for PostgreSQL, MySQL, and SQL Server on Google Cloud. Integrated with Cloud Run, App Engine, and BigQuery for analytics.',
    website: 'https://cloud.google.com/sql',
    docsUrl: 'https://cloud.google.com/sql/docs',
    pricingUrl: 'https://cloud.google.com/sql/pricing',
    strengths: ['reliability', 'performance', 'security'],
    weaknesses: ['Requires GCP knowledge', 'No true serverless (AlloyDB Omni is separate)', 'Cold starts when scaling from zero'],
    bestFor: ['growth', 'enterprise'],
    avoidIf: ['Not on GCP', 'Want serverless pay-per-query', 'Need simple developer-first setup'],
    bestWhen: ['Already on Google Cloud', 'Need BigQuery integration', 'Running on Cloud Run or App Engine'],
    alternatives: ['aws-rds', 'neon', 'supabase-db', 'cockroachdb'],
    compliance: ['SOC2', 'HIPAA', 'GDPR', 'PCI-DSS', 'ISO27001'],
    ecosystem: 'gcp',
    subcategories: ['postgres', 'mysql', 'managed-rds'],
  },
  {
    id: 'turso',
    name: 'Turso',
    category: 'database',
    description: 'Edge-hosted SQLite database with libSQL. Embedded replicas at the edge for ultra-low-latency reads, with a central primary for writes. Built for apps that need fast reads globally.',
    website: 'https://turso.tech',
    docsUrl: 'https://docs.turso.tech',
    pricingUrl: 'https://turso.tech/pricing',
    strengths: ['performance', 'cost', 'dx'],
    weaknesses: ['SQLite feature set (no stored procedures, limited types)', 'Eventual consistency for edge replicas', 'Smaller ecosystem than Postgres'],
    bestFor: ['hobby', 'startup', 'growth'],
    avoidIf: ['Need full Postgres feature set', 'Heavy write workloads', 'Need strong consistency across all reads'],
    bestWhen: ['Read-heavy workloads at the edge', 'Want embedded database replicas', 'Building with SQLite/libSQL ecosystem'],
    alternatives: ['neon', 'supabase-db', 'planetscale', 'cloudflare-d1'],
    compliance: ['SOC2', 'GDPR'],
    subcategories: ['sqlite', 'edge-db'],
  },
  {
    id: 'cloudflare-d1',
    name: 'Cloudflare D1',
    category: 'database',
    description: 'Serverless SQLite database on Cloudflare\'s edge network. Built for Cloudflare Workers with automatic read replication and pay-per-query pricing.',
    website: 'https://developers.cloudflare.com/d1',
    docsUrl: 'https://developers.cloudflare.com/d1',
    pricingUrl: 'https://developers.cloudflare.com/d1/pricing',
    strengths: ['cost', 'performance', 'dx'],
    weaknesses: ['Tightly coupled to Cloudflare Workers ecosystem', 'SQLite limitations', 'Still maturing — fewer features than established databases'],
    bestFor: ['hobby', 'startup'],
    avoidIf: ['Not on Cloudflare Workers', 'Need full relational database features', 'Heavy write throughput'],
    bestWhen: ['Building on Cloudflare Workers', 'Want serverless SQLite at the edge', 'Cost-sensitive with pay-per-query pricing'],
    alternatives: ['turso', 'neon', 'supabase-db'],
    ecosystem: 'cloudflare',
    subcategories: ['sqlite', 'edge-db', 'serverless'],
  },

  // ============================================
  // STORAGE (P0 — raise from 4 to 9+)
  // ============================================
  {
    id: 'google-cloud-storage',
    name: 'Google Cloud Storage',
    category: 'storage',
    description: 'Object storage service with global edge caching, multiple storage classes (Standard, Nearline, Coldline, Archive), and deep integration with GCP services like BigQuery and Cloud CDN.',
    website: 'https://cloud.google.com/storage',
    docsUrl: 'https://cloud.google.com/storage/docs',
    pricingUrl: 'https://cloud.google.com/storage/pricing',
    strengths: ['reliability', 'performance', 'security'],
    weaknesses: ['Complex IAM model', 'Egress costs can be significant', 'Requires GCP account and billing setup'],
    bestFor: ['growth', 'enterprise'],
    avoidIf: ['Not on GCP', 'Want simple developer-first storage API', 'Budget-sensitive about egress fees'],
    bestWhen: ['Already on Google Cloud', 'Need tiered storage classes for cost optimization', 'ML/data pipeline integration with BigQuery'],
    alternatives: ['cloudflare-r2', 'aws-s3', 'azure-blob', 'backblaze-b2'],
    compliance: ['SOC2', 'HIPAA', 'GDPR', 'PCI-DSS', 'ISO27001'],
    ecosystem: 'gcp',
    subcategories: ['object-storage'],
  },
  {
    id: 'azure-blob',
    name: 'Azure Blob Storage',
    category: 'storage',
    description: 'Microsoft\'s massively scalable object storage for unstructured data. Hot, Cool, Cold, and Archive tiers for cost optimization. Integrated with Azure CDN and Azure Functions.',
    website: 'https://azure.microsoft.com/products/storage/blobs',
    docsUrl: 'https://learn.microsoft.com/azure/storage/blobs',
    pricingUrl: 'https://azure.microsoft.com/pricing/details/storage/blobs',
    strengths: ['reliability', 'security', 'performance'],
    weaknesses: ['Azure-specific SDK patterns', 'Complex pricing with multiple dimensions', 'Enterprise-oriented UX can feel heavy for small projects'],
    bestFor: ['growth', 'enterprise'],
    avoidIf: ['Not on Azure', 'Want simple developer-first API', 'Hobby or side project'],
    bestWhen: ['Already on Azure', 'Enterprise compliance requirements', '.NET or Microsoft ecosystem'],
    alternatives: ['aws-s3', 'google-cloud-storage', 'cloudflare-r2'],
    compliance: ['SOC2', 'HIPAA', 'GDPR', 'PCI-DSS', 'ISO27001'],
    ecosystem: 'azure',
    subcategories: ['object-storage'],
  },
  {
    id: 'backblaze-b2',
    name: 'Backblaze B2',
    category: 'storage',
    description: 'S3-compatible object storage at 1/5th the price of AWS S3. Free egress with Cloudflare CDN partnership. Simple, cost-effective storage for backups, media, and static assets.',
    website: 'https://www.backblaze.com/cloud-storage',
    docsUrl: 'https://www.backblaze.com/docs/cloud-storage',
    pricingUrl: 'https://www.backblaze.com/cloud-storage/pricing',
    strengths: ['cost', 'dx', 'reliability'],
    weaknesses: ['Fewer regions than AWS/GCP/Azure', 'Limited ecosystem integrations', 'No built-in CDN (relies on Cloudflare partnership)'],
    bestFor: ['hobby', 'startup', 'growth'],
    avoidIf: ['Need multi-region with guaranteed latency SLAs', 'Need deep cloud ecosystem integration', 'Enterprise compliance beyond SOC2'],
    bestWhen: ['Cost-sensitive storage workloads', 'Backups and archival', 'Static asset hosting with Cloudflare CDN'],
    alternatives: ['cloudflare-r2', 'aws-s3', 'google-cloud-storage'],
    compliance: ['SOC2', 'GDPR'],
    subcategories: ['object-storage'],
  },
  {
    id: 'supabase-storage',
    name: 'Supabase Storage',
    category: 'storage',
    description: 'S3-backed file storage with row-level security policies, image transformations, and resumable uploads. Integrated with Supabase Auth for access control.',
    website: 'https://supabase.com/storage',
    docsUrl: 'https://supabase.com/docs/guides/storage',
    pricingUrl: 'https://supabase.com/pricing',
    strengths: ['dx', 'cost', 'security'],
    weaknesses: ['Tied to Supabase ecosystem', 'Image transformations limited compared to dedicated services', 'Storage limits on free tier (1GB)'],
    bestFor: ['hobby', 'startup', 'growth'],
    avoidIf: ['Not using Supabase', 'Need advanced image/video processing', 'Multi-cloud storage strategy'],
    bestWhen: ['Already using Supabase for auth/database', 'Need integrated RLS for file access control', 'Simple file uploads with auth integration'],
    alternatives: ['uploadthing', 'cloudflare-r2', 'aws-s3'],
    compliance: ['SOC2', 'GDPR'],
    ecosystem: 'supabase',
    subcategories: ['object-storage', 'baas'],
  },
  {
    id: 'vercel-blob',
    name: 'Vercel Blob',
    category: 'storage',
    description: 'Edge-optimized blob storage built for Vercel deployments. Simple put/get API with global CDN, client-side uploads, and automatic cache invalidation.',
    website: 'https://vercel.com/docs/storage/vercel-blob',
    docsUrl: 'https://vercel.com/docs/storage/vercel-blob',
    pricingUrl: 'https://vercel.com/pricing',
    strengths: ['dx', 'performance'],
    weaknesses: ['Vercel-only — not portable', 'Limited feature set compared to S3', 'Storage costs can add up on Pro plan'],
    bestFor: ['hobby', 'startup'],
    avoidIf: ['Not on Vercel', 'Need S3 API compatibility', 'Large-scale storage workloads'],
    bestWhen: ['Deploying on Vercel', 'Simple file uploads (avatars, images)', 'Want zero-config storage with CDN'],
    alternatives: ['uploadthing', 'cloudflare-r2', 'supabase-storage'],
    ecosystem: 'vercel',
    subcategories: ['object-storage', 'edge-storage'],
  },

  // ============================================
  // PUSH (P0 — raise from 3 to 8+)
  // ============================================
  {
    id: 'airship',
    name: 'Airship',
    category: 'push',
    description: 'Enterprise mobile engagement platform with push notifications, in-app messaging, SMS, and email. Advanced segmentation, A/B testing, and journey orchestration for mobile-first teams.',
    website: 'https://www.airship.com',
    docsUrl: 'https://docs.airship.com',
    pricingUrl: 'https://www.airship.com/pricing',
    strengths: ['reliability', 'customization', 'support'],
    weaknesses: ['Enterprise pricing — not accessible for small teams', 'Complex SDK setup', 'Overkill for simple push notification use cases'],
    bestFor: ['growth', 'enterprise'],
    avoidIf: ['Budget-constrained startup', 'Simple push-only use case', 'Prefer open-source solutions'],
    bestWhen: ['Enterprise mobile engagement strategy', 'Need multi-channel (push + in-app + SMS)', 'Advanced segmentation and A/B testing'],
    alternatives: ['onesignal', 'braze', 'firebase-messaging'],
    compliance: ['SOC2', 'GDPR', 'ISO27001'],
    subcategories: ['mobile-engagement', 'multi-channel'],
  },
  {
    id: 'braze',
    name: 'Braze',
    category: 'push',
    description: 'Customer engagement platform with push notifications, email, SMS, in-app messaging, and content cards. Real-time data streaming and journey orchestration for lifecycle marketing.',
    website: 'https://www.braze.com',
    docsUrl: 'https://www.braze.com/docs',
    pricingUrl: 'https://www.braze.com/pricing',
    strengths: ['reliability', 'customization', 'performance'],
    weaknesses: ['Enterprise pricing — starts at $50k+/year', 'Complex integration for simple use cases', 'Heavy SDK footprint'],
    bestFor: ['growth', 'enterprise'],
    avoidIf: ['Budget under $50k/year', 'Simple push-only needs', 'Small engineering team'],
    bestWhen: ['Lifecycle marketing across channels', 'Need real-time event-triggered messaging', 'Enterprise-scale user engagement'],
    alternatives: ['onesignal', 'airship', 'customer-io'],
    compliance: ['SOC2', 'GDPR', 'ISO27001'],
    subcategories: ['mobile-engagement', 'multi-channel', 'lifecycle'],
  },
  {
    id: 'customer-io',
    name: 'Customer.io',
    category: 'push',
    description: 'Messaging platform for targeted push notifications, email, SMS, and in-app messages. Event-driven workflows with visual journey builder. Popular with product-led growth teams.',
    website: 'https://customer.io',
    docsUrl: 'https://customer.io/docs',
    pricingUrl: 'https://customer.io/pricing',
    strengths: ['dx', 'customization', 'cost'],
    weaknesses: ['Push notification features less mature than dedicated push platforms', 'Can be complex for simple transactional messages', 'Webhook integrations require custom development'],
    bestFor: ['startup', 'growth'],
    avoidIf: ['Only need basic push notifications', 'Enterprise-scale with millions of users', 'Need dedicated push infrastructure'],
    bestWhen: ['Product-led growth messaging', 'Event-driven lifecycle campaigns', 'Multi-channel (email + push + SMS) from one platform'],
    alternatives: ['onesignal', 'braze', 'airship'],
    compliance: ['SOC2', 'GDPR'],
    subcategories: ['lifecycle', 'multi-channel'],
  },
  {
    id: 'expo-push',
    name: 'Expo Push',
    category: 'push',
    description: 'Push notification service built into the Expo React Native framework. Unified API for iOS APNs and Android FCM with automatic token management and receipt tracking.',
    website: 'https://expo.dev/push-notifications',
    docsUrl: 'https://docs.expo.dev/push-notifications/overview',
    pricingUrl: 'https://expo.dev/pricing',
    strengths: ['dx', 'cost'],
    weaknesses: ['Only works with Expo/React Native apps', 'No web push support', 'Limited segmentation and analytics compared to dedicated platforms'],
    bestFor: ['hobby', 'startup'],
    avoidIf: ['Not using Expo/React Native', 'Need web push notifications', 'Need advanced segmentation and A/B testing'],
    bestWhen: ['Building with Expo/React Native', 'Want zero-config push setup', 'Simple notification use cases'],
    alternatives: ['onesignal', 'firebase-messaging'],
    ecosystem: 'expo',
    subcategories: ['mobile-push', 'react-native'],
  },
  {
    id: 'aws-pinpoint',
    name: 'AWS Pinpoint',
    category: 'push',
    description: 'Multi-channel messaging service supporting push notifications, email, SMS, and voice. Integrated with AWS ecosystem for analytics, segmentation, and campaign management.',
    website: 'https://aws.amazon.com/pinpoint',
    docsUrl: 'https://docs.aws.amazon.com/pinpoint',
    pricingUrl: 'https://aws.amazon.com/pinpoint/pricing',
    strengths: ['cost', 'reliability', 'customization'],
    weaknesses: ['AWS-centric — requires AWS account and IAM setup', 'Complex configuration compared to dedicated push services', 'Documentation can be dense'],
    bestFor: ['growth', 'enterprise'],
    avoidIf: ['Not on AWS', 'Want simple push API without AWS complexity', 'Small team without AWS expertise'],
    bestWhen: ['Already on AWS infrastructure', 'Need multi-channel from one AWS service', 'Cost-sensitive at high volume'],
    alternatives: ['onesignal', 'firebase-messaging', 'braze'],
    compliance: ['SOC2', 'HIPAA', 'GDPR', 'PCI-DSS'],
    ecosystem: 'aws',
    subcategories: ['multi-channel', 'campaign'],
  },

  // ============================================
  // MONITORING (P0 — raise from 5 to 10+)
  // ============================================
  {
    id: 'new-relic',
    name: 'New Relic',
    category: 'monitoring',
    description: 'Full-stack observability platform with APM, infrastructure monitoring, logs, browser monitoring, and synthetic checks. Generous free tier with 100GB/month of data ingest.',
    website: 'https://newrelic.com',
    docsUrl: 'https://docs.newrelic.com',
    pricingUrl: 'https://newrelic.com/pricing',
    strengths: ['dx', 'cost', 'customization'],
    weaknesses: ['Per-user pricing can be expensive for large teams', 'UI complexity — many features can overwhelm', 'Agent overhead for some language runtimes'],
    bestFor: ['startup', 'growth', 'enterprise'],
    avoidIf: ['Solo developer who only needs error tracking', 'Budget-constrained team with many developers', 'Prefer lightweight/targeted monitoring tools'],
    bestWhen: ['Need full-stack observability in one platform', 'Want generous free tier to start', 'Enterprise APM with distributed tracing'],
    alternatives: ['datadog', 'grafana-cloud', 'sentry', 'honeycomb'],
    compliance: ['SOC2', 'HIPAA', 'GDPR', 'PCI-DSS'],
    subcategories: ['apm', 'infrastructure', 'logs', 'browser'],
  },
  {
    id: 'grafana-cloud',
    name: 'Grafana Cloud',
    category: 'monitoring',
    description: 'Managed observability stack built on Grafana, Prometheus, Loki, and Tempo. Metrics, logs, traces, and dashboards with generous free tier. Open-source foundation means no vendor lock-in.',
    website: 'https://grafana.com/products/cloud',
    docsUrl: 'https://grafana.com/docs/grafana-cloud',
    pricingUrl: 'https://grafana.com/pricing',
    strengths: ['dx', 'cost', 'customization'],
    weaknesses: ['Requires understanding of Prometheus/Loki/Tempo ecosystem', 'Self-hosted Grafana requires infrastructure expertise', 'Alerting configuration can be complex'],
    bestFor: ['startup', 'growth', 'enterprise'],
    avoidIf: ['Want all-in-one with zero config', 'Team unfamiliar with Prometheus ecosystem', 'Need built-in error tracking (use Sentry alongside)'],
    bestWhen: ['Want open-source observability stack', 'Already using Prometheus metrics', 'Need customizable dashboards'],
    alternatives: ['datadog', 'new-relic', 'honeycomb'],
    compliance: ['SOC2', 'GDPR'],
    selfHostable: true,
    subcategories: ['metrics', 'logs', 'traces', 'dashboards'],
  },
  {
    id: 'honeycomb',
    name: 'Honeycomb',
    category: 'monitoring',
    description: 'Observability platform built for debugging complex distributed systems. High-cardinality event-based analysis with BubbleUp for anomaly detection. Designed for OpenTelemetry-native workflows.',
    website: 'https://www.honeycomb.io',
    docsUrl: 'https://docs.honeycomb.io',
    pricingUrl: 'https://www.honeycomb.io/pricing',
    strengths: ['dx', 'performance', 'customization'],
    weaknesses: ['Learning curve for teams used to metrics-based monitoring', 'No built-in infrastructure monitoring', 'Pricing can escalate with high event volume'],
    bestFor: ['growth', 'enterprise'],
    avoidIf: ['Simple app that doesn\'t need distributed tracing', 'Need infrastructure metrics alongside APM', 'Budget-constrained with high event volumes'],
    bestWhen: ['Debugging complex microservices', 'OpenTelemetry-native instrumentation', 'Need high-cardinality analysis (query by any field)'],
    alternatives: ['datadog', 'grafana-cloud', 'new-relic'],
    compliance: ['SOC2', 'GDPR'],
    subcategories: ['observability', 'distributed-tracing'],
  },
  {
    id: 'dynatrace',
    name: 'Dynatrace',
    category: 'monitoring',
    description: 'AI-powered full-stack observability platform with automatic discovery, root cause analysis, and AIOps. Enterprise-grade APM, infrastructure monitoring, and digital experience management.',
    website: 'https://www.dynatrace.com',
    docsUrl: 'https://docs.dynatrace.com',
    pricingUrl: 'https://www.dynatrace.com/pricing',
    strengths: ['reliability', 'performance', 'security'],
    weaknesses: ['Enterprise pricing — expensive for small teams', 'Complex deployment with OneAgent', 'Vendor lock-in with proprietary query language'],
    bestFor: ['enterprise'],
    avoidIf: ['Startup or small team', 'Budget under $1k/month', 'Prefer open-source tooling'],
    bestWhen: ['Large enterprise with complex infrastructure', 'Need AI-powered root cause analysis', 'Hybrid cloud/on-prem environments'],
    alternatives: ['datadog', 'new-relic', 'splunk-observability'],
    compliance: ['SOC2', 'HIPAA', 'GDPR', 'PCI-DSS', 'ISO27001'],
    subcategories: ['apm', 'aiops', 'infrastructure'],
  },
  {
    id: 'splunk-observability',
    name: 'Splunk Observability',
    category: 'monitoring',
    description: 'Enterprise observability suite (formerly SignalFx) with real-time streaming analytics, APM, infrastructure monitoring, and log analysis. Part of the Splunk/Cisco ecosystem.',
    website: 'https://www.splunk.com/en_us/products/observability.html',
    docsUrl: 'https://docs.splunk.com/observability',
    pricingUrl: 'https://www.splunk.com/en_us/products/pricing.html',
    strengths: ['reliability', 'performance', 'security'],
    weaknesses: ['Enterprise pricing model', 'Complex onboarding compared to dev-focused tools', 'Splunk ecosystem can feel heavy'],
    bestFor: ['enterprise'],
    avoidIf: ['Startup or small team', 'Want developer-first DX', 'Budget under $2k/month'],
    bestWhen: ['Already in Splunk/Cisco ecosystem', 'Enterprise-scale infrastructure monitoring', 'Need real-time streaming analytics'],
    alternatives: ['datadog', 'new-relic', 'dynatrace'],
    compliance: ['SOC2', 'HIPAA', 'GDPR', 'PCI-DSS'],
    subcategories: ['apm', 'infrastructure', 'logs'],
  },
  {
    id: 'betterstack',
    name: 'Better Stack',
    category: 'monitoring',
    description: 'Modern observability stack combining uptime monitoring, incident management, and log management (Logtail). Developer-friendly alternative to PagerDuty + Datadog Logs.',
    website: 'https://betterstack.com',
    docsUrl: 'https://betterstack.com/docs',
    pricingUrl: 'https://betterstack.com/pricing',
    strengths: ['dx', 'cost', 'reliability'],
    weaknesses: ['No APM or distributed tracing', 'Smaller ecosystem than Datadog/New Relic', 'Log query language less powerful than Splunk'],
    bestFor: ['hobby', 'startup', 'growth'],
    avoidIf: ['Need full APM with distributed tracing', 'Enterprise compliance beyond SOC2', 'Need metrics alongside logs'],
    bestWhen: ['Uptime monitoring + log management in one tool', 'Want clean developer-friendly UI', 'Replacing PagerDuty for incident management'],
    alternatives: ['datadog', 'grafana-cloud', 'new-relic'],
    compliance: ['SOC2', 'GDPR'],
    subcategories: ['uptime', 'logs', 'incidents'],
  },

  // ============================================
  // P1: HIGH-VALUE PROVIDER GAPS
  // ============================================
  {
    id: 'paypal',
    name: 'PayPal',
    category: 'payments',
    description: 'Global payment platform with checkout, invoicing, subscriptions, and payouts. Supports 200+ markets and 100+ currencies. The most recognized payment brand for consumer trust.',
    website: 'https://developer.paypal.com',
    docsUrl: 'https://developer.paypal.com/docs',
    pricingUrl: 'https://www.paypal.com/us/webapps/mpp/merchant-fees',
    strengths: ['reliability', 'security'],
    weaknesses: ['Higher transaction fees than Stripe (2.99% + fixed)', 'Developer experience lags behind Stripe', 'Account holds and freezes are common complaints', 'SDK can feel dated compared to modern alternatives'],
    bestFor: ['startup', 'growth', 'enterprise'],
    avoidIf: ['Developer experience is top priority', 'Want modern React/component-based checkout', 'Selling digital goods with high chargeback risk'],
    bestWhen: ['Consumer-facing checkout where PayPal brand trust matters', 'International payments in 200+ markets', 'Need PayPal + Venmo as payment options'],
    alternatives: ['stripe', 'paddle', 'square'],
    compliance: ['SOC2', 'PCI-DSS', 'GDPR'],
    subcategories: ['checkout', 'invoicing', 'payouts'],
  },
  {
    id: 'plaid',
    name: 'Plaid',
    category: 'finance',
    description: 'Financial data API for connecting bank accounts, verifying identity, and accessing transaction data. The standard for account linking in fintech apps — used by Venmo, Robinhood, and Coinbase.',
    website: 'https://plaid.com',
    docsUrl: 'https://plaid.com/docs',
    pricingUrl: 'https://plaid.com/pricing',
    strengths: ['dx', 'reliability', 'security'],
    weaknesses: ['Per-connection pricing adds up at scale', 'Some banks have connectivity issues', 'Sandbox can behave differently from production'],
    bestFor: ['startup', 'growth', 'enterprise'],
    avoidIf: ['Don\'t need bank account linking', 'Budget-constrained with many connected accounts', 'Operating only outside US/Canada/UK'],
    bestWhen: ['Bank account linking and verification', 'Transaction data aggregation for PFM apps', 'ACH payment initiation', 'Identity verification via bank data'],
    alternatives: ['mx', 'yodlee', 'finicity'],
    compliance: ['SOC2', 'GDPR', 'ISO27001'],
    subcategories: ['account-linking', 'identity-verification', 'transactions'],
  },
  {
    id: 'brevo',
    name: 'Brevo',
    category: 'email',
    description: 'All-in-one marketing and transactional email platform (formerly Sendinblue). Combines email, SMS, WhatsApp, and CRM with generous free tier of 300 emails/day.',
    website: 'https://www.brevo.com',
    docsUrl: 'https://developers.brevo.com',
    pricingUrl: 'https://www.brevo.com/pricing',
    strengths: ['cost', 'customization'],
    weaknesses: ['Transactional email DX less polished than Resend/Postmark', 'Brevo branding on free tier emails', 'API can feel dated compared to modern alternatives'],
    bestFor: ['hobby', 'startup', 'growth'],
    avoidIf: ['Need best-in-class developer experience', 'React Email component-based templates', 'Enterprise-scale transactional email'],
    bestWhen: ['Need email + SMS + CRM in one platform', 'Budget-constrained but need decent volume', 'Marketing and transactional email from one provider'],
    alternatives: ['resend', 'sendgrid', 'mailgun', 'postmark'],
    compliance: ['GDPR'],
    subcategories: ['transactional', 'marketing', 'sms'],
  },
  {
    id: 'mailchimp-transactional',
    name: 'Mailchimp Transactional',
    category: 'email',
    description: 'Transactional email API (formerly Mandrill) from Mailchimp/Intuit. Reliable delivery with detailed analytics, template management, and inbound email processing.',
    website: 'https://mailchimp.com/developer/transactional',
    docsUrl: 'https://mailchimp.com/developer/transactional/docs',
    pricingUrl: 'https://mailchimp.com/pricing/transactional-email',
    strengths: ['reliability', 'performance'],
    weaknesses: ['Requires Mailchimp account (bundled pricing)', 'API design feels legacy compared to Resend', 'Block-based pricing in 25k chunks'],
    bestFor: ['startup', 'growth', 'enterprise'],
    avoidIf: ['Want standalone transactional email without Mailchimp', 'Need modern developer-first API', 'Low volume where block pricing is wasteful'],
    bestWhen: ['Already using Mailchimp for marketing email', 'Need combined marketing + transactional', 'High-volume transactional email'],
    alternatives: ['resend', 'postmark', 'sendgrid', 'mailgun'],
    compliance: ['SOC2', 'GDPR'],
    subcategories: ['transactional'],
  },
  {
    id: 'sparkpost',
    name: 'SparkPost',
    category: 'email',
    description: 'High-volume email delivery platform (now part of MessageBird/Bird) with predictive analytics, deliverability tools, and real-time bounce classification. Handles 40%+ of the world\'s B2C email.',
    website: 'https://www.sparkpost.com',
    docsUrl: 'https://developers.sparkpost.com',
    pricingUrl: 'https://www.sparkpost.com/pricing',
    strengths: ['performance', 'reliability'],
    weaknesses: ['Ownership changes (MessageBird → Bird) create uncertainty', 'API complexity for simple use cases', 'Pricing not transparent — requires sales contact at higher tiers'],
    bestFor: ['growth', 'enterprise'],
    avoidIf: ['Low volume (< 100k/month)', 'Want transparent self-serve pricing', 'Prefer independent companies over conglomerates'],
    bestWhen: ['High-volume email delivery (millions/month)', 'Need deliverability analytics and tools', 'Enterprise sender reputation management'],
    alternatives: ['sendgrid', 'mailgun', 'amazon-ses'],
    compliance: ['SOC2', 'GDPR'],
    subcategories: ['transactional', 'deliverability'],
  },
  {
    id: 'fusionauth',
    name: 'FusionAuth',
    category: 'auth',
    description: 'Self-hostable authentication and authorization platform with SSO, MFA, OAuth2, SAML, and user management. Runs anywhere — Docker, Kubernetes, bare metal, or FusionAuth Cloud.',
    website: 'https://fusionauth.io',
    docsUrl: 'https://fusionauth.io/docs',
    pricingUrl: 'https://fusionauth.io/pricing',
    strengths: ['customization', 'security', 'cost'],
    weaknesses: ['Self-hosted version requires Java runtime', 'UI feels enterprise-oriented', 'Smaller community than Auth0/Clerk'],
    bestFor: ['startup', 'growth', 'enterprise'],
    avoidIf: ['Want managed-only with zero infrastructure', 'Prefer modern React-component login flows', 'Small hobby project where Clerk/Supabase Auth suffice'],
    bestWhen: ['Need self-hosted auth for compliance', 'Want to avoid per-MAU pricing at scale', 'Enterprise SSO (SAML/OIDC) requirements'],
    alternatives: ['clerk', 'auth0', 'supabase-auth', 'keycloak'],
    compliance: ['SOC2', 'HIPAA', 'GDPR'],
    selfHostable: true,
    subcategories: ['sso', 'mfa', 'self-hosted'],
  },
  {
    id: 'svix',
    name: 'Svix',
    category: 'realtime',
    description: 'Webhook delivery infrastructure with automatic retries, signature verification, and a management dashboard. Lets you add reliable webhooks to your product without building delivery infrastructure.',
    website: 'https://www.svix.com',
    docsUrl: 'https://docs.svix.com',
    pricingUrl: 'https://www.svix.com/pricing',
    strengths: ['dx', 'reliability', 'security'],
    weaknesses: ['Adds a proxy layer in the webhook path', 'Niche product — only makes sense if you\'re a webhook provider', 'Self-hosted version requires more setup than managed'],
    bestFor: ['startup', 'growth', 'enterprise'],
    avoidIf: ['Only consuming webhooks (not sending)', 'Simple webhook needs with few endpoints', 'Don\'t want dependency for webhook infra'],
    bestWhen: ['Building a product that sends webhooks to customers', 'Need reliable delivery with retries and monitoring', 'Want webhook management UI for your customers'],
    alternatives: ['hookdeck'],
    compliance: ['SOC2'],
    selfHostable: true,
    subcategories: ['webhooks', 'event-delivery'],
  },
];

async function upsert(p: SeedProvider) {
  const id = p.id;
  const now = new Date().toISOString().split('T')[0];

  await client.execute({
    sql: `INSERT INTO providers (
      id, name, category, description, website, docs_url, pricing_url,
      strengths, weaknesses, best_for, avoid_if, best_when, alternatives,
      compliance, ecosystem, self_hostable, subcategories,
      status, review_status, last_verified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'approved', ?)
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category,
      description = excluded.description,
      website = excluded.website,
      docs_url = excluded.docs_url,
      pricing_url = excluded.pricing_url,
      strengths = excluded.strengths,
      weaknesses = excluded.weaknesses,
      best_for = excluded.best_for,
      avoid_if = excluded.avoid_if,
      best_when = excluded.best_when,
      alternatives = excluded.alternatives,
      compliance = excluded.compliance,
      ecosystem = excluded.ecosystem,
      self_hostable = excluded.self_hostable,
      subcategories = excluded.subcategories,
      status = 'active',
      review_status = 'approved',
      last_verified = excluded.last_verified`,
    args: [
      id, p.name, p.category, p.description, p.website,
      p.docsUrl ?? null, p.pricingUrl ?? null,
      JSON.stringify(p.strengths), JSON.stringify(p.weaknesses ?? []),
      JSON.stringify(p.bestFor), JSON.stringify(p.avoidIf ?? []),
      JSON.stringify(p.bestWhen ?? []), JSON.stringify(p.alternatives ?? []),
      JSON.stringify(p.compliance ?? []), p.ecosystem ?? null,
      p.selfHostable ? 1 : 0, JSON.stringify(p.subcategories ?? []),
      now,
    ],
  });
}

async function main() {
  console.log('=== P0/P1 Provider Seed ===\n');

  // Step 1: Reclassify misplaced analytics providers
  console.log('--- Step 1: Fix analytics misclassification ---');
  const reclassifications = [
    { id: 'posthog', from: 'feature-flags', to: 'analytics' },
    { id: 'amplitude', from: 'feature-flags', to: 'analytics' },
  ];
  for (const r of reclassifications) {
    const result = await client.execute({
      sql: `UPDATE providers SET category = ? WHERE id = ? AND category = ?`,
      args: [r.to, r.id, r.from],
    });
    console.log(`  ${r.id}: ${r.from} → ${r.to} (${result.rowsAffected} rows)`);
  }

  // Step 2: Insert/upsert providers
  console.log('\n--- Step 2: Upsert providers ---');
  let inserted = 0;
  for (const p of PROVIDERS) {
    try {
      await upsert(p);
      console.log(`  [OK] ${p.name} (${p.category})`);
      inserted++;
    } catch (err) {
      console.error(`  [FAIL] ${p.name}: ${err}`);
    }
  }

  // Step 3: Verify counts
  console.log('\n--- Step 3: Verify category counts ---');
  const counts = await client.execute(
    `SELECT category, COUNT(*) as count FROM providers WHERE status != 'deprecated' AND category IN ('analytics','database','storage','push','monitoring','payments','finance','email','auth') GROUP BY category ORDER BY count DESC`,
  );
  for (const row of counts.rows) {
    console.log(`  ${row.category}: ${row.count}`);
  }

  console.log(`\nDone. ${inserted} providers upserted.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
