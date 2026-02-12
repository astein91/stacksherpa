// ============================================
// File Metadata (all persisted files)
// ============================================

export interface FileMeta {
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Core Domain Types
// ============================================

export interface ProjectContext {
  name: string;
  stack?: {
    language?: string;
    framework?: string;
    hosting?: string;
  };
  scale?: 'hobby' | 'startup' | 'growth' | 'enterprise';
  regions?: string[];
}

export interface Constraints {
  compliance?: string[];                    // SOC2, HIPAA, GDPR, PCI-DSS
  budgetCeiling?: {
    monthly?: number;
    perRequest?: number;
  };
  selfHosted?: boolean;
  dataResidency?: string[];                 // us, eu, apac
  mustHaveFeatures?: string[];              // webhooks, sandbox-mode
  dealbreakers?: string[];                  // no-sdk, usage-based-only
  requiredSdkLanguages?: string[];          // typescript, python, go
  vendorLockInTolerance?: 'low' | 'medium' | 'high';
}

export interface Preferences {
  prioritize?: ('reliability' | 'cost' | 'dx' | 'performance' | 'support')[];
  riskTolerance?: 'low' | 'moderate' | 'high';
  preferredProviders?: string[];
  avoidProviders?: string[];
}

// Merge policies for combining global + local profiles
export type MergePolicy = 'override' | 'union' | 'max' | 'min';

export const MERGE_POLICIES: Record<string, MergePolicy> = {
  // Constraints - mostly union (additive requirements)
  'compliance': 'union',
  'dataResidency': 'union',
  'mustHaveFeatures': 'union',
  'dealbreakers': 'union',
  'requiredSdkLanguages': 'union',
  'budgetCeiling.monthly': 'min',           // stricter of the two
  'budgetCeiling.perRequest': 'min',
  'selfHosted': 'override',                 // local wins
  'vendorLockInTolerance': 'override',

  // Preferences - mostly override (local taste)
  'prioritize': 'override',
  'riskTolerance': 'override',
  'avoidProviders': 'union',                // accumulate
  'preferredProviders': 'override',
};

// ============================================
// User Decision Tracking (canonical in local)
// ============================================

export interface UserDecision {
  id: string;
  api: string;
  category: string;
  outcome: 'positive' | 'negative' | 'neutral';
  context?: string;                         // "high volume", "billing portal"
  notes?: string;
  notesPrivate: boolean;                    // don't propagate to global
  date: string;
  recordedBy: 'user' | 'agent';
  toolVersion: string;
}

export interface ProjectDecisions extends FileMeta {
  decisions: UserDecision[];
}

// ============================================
// Project Profile (local)
// ============================================

export interface ProjectProfile extends FileMeta {
  project: ProjectContext;
  constraints?: Constraints;
  preferences?: Preferences;
  shareToGlobalTaste: boolean;              // default: true
}

// ============================================
// Global Defaults (normative)
// ============================================

export interface GlobalDefaults extends FileMeta {
  constraints?: Constraints;
  preferences?: Preferences;
}

// ============================================
// Project Registry (global)
// ============================================

export interface RegisteredProject {
  path: string;
  name: string;
  addedAt: string;
  shareToGlobalTaste: boolean;
}

export interface ProjectRegistry extends FileMeta {
  projects: RegisteredProject[];
}

// ============================================
// Computed Taste (derived from all decisions)
// ============================================

export interface ExperienceSummary {
  id: string;                               // decision ID
  project: string;
  api: string;
  category: string;
  outcome: 'positive' | 'negative' | 'neutral';
  context?: string;
  noteSummary?: string;                     // truncated, sanitized
  date: string;
}

export interface ScoredPattern {
  id: string;
  signal: string;                           // "prefers:Resend:email"
  confidence: number;                       // 0.0 - 1.0
  evidenceIds: string[];                    // Decision IDs
  firstObserved: string;
  lastReinforced: string;
}

export interface ComputedTaste {
  experiences: ExperienceSummary[];
  patterns: ScoredPattern[];
  computedAt: string;
}

// ============================================
// Effective Profile (merged result)
// ============================================

export interface EffectiveProfile {
  project?: ProjectContext;
  constraints: Constraints;
  preferences: Preferences;
}

export interface MergeDetail {
  field: string;
  policy: MergePolicy;
  globalValue: unknown;
  localValue: unknown;
  effectiveValue: unknown;
}

// ============================================
// Recommendation Types
// ============================================

export interface Gap {
  field: string;                            // "constraints.compliance"
  question: string;
  options?: string[];
  relevance: string;
  impact: 'high' | 'medium' | 'low';
}

export interface RecommendationContext {
  relevantExperiences: ExperienceSummary[];
  appliedPatterns: Array<{ signal: string; confidence: number }>;
}

// ============================================
// Legacy Types (used for migration)
// ============================================

/** Used to migrate legacy profile history to decisions.json */
export interface PastDecision {
  api: string;
  category: string;
  date: string;
  outcome: 'positive' | 'negative' | 'neutral';
  notes?: string;
}

// ============================================
// Rich Provider Data Schema
// ============================================

export interface PricingModel {
  type: 'usage' | 'seat' | 'flat' | 'tiered' | 'freemium';
  currency: 'USD';

  // Free tier details
  freeTier?: {
    included: string;  // e.g., "100 emails/day", "1000 API calls/month"
    limitations?: string[];
  };

  // Unit pricing (as precise as available)
  unitPricing?: {
    unit: string;  // e.g., "1K emails", "1M tokens", "API call", "MAU"
    price: number;
    volumeDiscounts?: { threshold: number; pricePerUnit: number }[];
  };

  // Flat/seat pricing
  plans?: {
    name: string;
    priceMonthly?: number;
    priceYearly?: number;
    includes: string;
  }[];

  lastVerified: string;  // ISO date
  source?: string;  // URL to pricing page
}

export interface PlatformSupport {
  platform: 'ios' | 'android' | 'web' | 'server' | 'edge' | 'react-native' | 'flutter';
  sdkPackage?: string;
  sdkVersion?: string;
  maturity: 'experimental' | 'beta' | 'stable' | 'mature';
  notes?: string;
}

export interface LatencyMetrics {
  p50Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
  coldStartMs?: number;
  measuredAt: string;  // ISO date
  source?: string;  // how measured / where from
  region?: string;
}

export interface ReliabilityMetrics {
  uptimeSla?: number;  // e.g., 99.9
  historicalUptime?: number;  // actual observed
  statusPageUrl?: string;
  lastIncident?: {
    date: string;
    severity: 'minor' | 'major' | 'critical';
    description: string;
  };
  measuredAt: string;
}

// AI/LLM specific benchmarks
export interface AIBenchmarks {
  // LMArena / Chatbot Arena
  lmArena?: {
    elo: number;
    rank?: number;
    category?: string;  // e.g., "coding", "overall", "hard-prompts"
    measuredAt: string;
  };

  // Artificial Analysis
  artificialAnalysis?: {
    qualityIndex?: number;  // 0-100
    speedIndex?: number;
    pricePerMToken?: number;
    tokensPerSecond?: number;
    ttft?: number;  // time to first token (ms)
    measuredAt: string;
  };

  // Standard benchmarks
  benchmarks?: {
    name: string;  // e.g., "MMLU", "HumanEval", "GPQA", "MATH"
    score: number;
    maxScore?: number;
    measuredAt: string;
  }[];

  // Context window
  contextWindow?: {
    maxTokens: number;
    effectiveTokens?: number;  // before quality degrades
  };

  // Capabilities
  capabilities?: {
    toolCalling?: boolean;
    vision?: boolean;
    audio?: boolean;
    streaming?: boolean;
    jsonMode?: boolean;
    functionCalling?: boolean;
  };
}

export interface KnownIssue {
  id: string;
  symptom: string;
  scope: string;  // e.g., "iOS 17+ simulator", "Node 18 + ESM"
  workaround?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedVersions?: string;
  githubIssue?: string;
  reportedAt: string;
  resolvedAt?: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface KnownProvider {
  // Identity
  id?: string;  // unique slug: "openai", "stripe", "clerk"
  name: string;
  description?: string;
  website?: string;
  docsUrl?: string;

  // Categorization
  category?: string;  // primary category
  subcategories?: string[];  // e.g., ["transactional", "marketing"] for email

  // Status & freshness
  status?: 'active' | 'beta' | 'deprecated' | 'sunset';
  lastVerified?: string;  // ISO date - when we last checked all data

  // SDK/Package info (primary)
  package?: string;
  packageAltNames?: Record<string, string>;  // { "python": "openai", "go": "github.com/openai/openai-go" }

  // Platform support (detailed per-platform)
  platforms?: PlatformSupport[];

  // Compliance & security
  compliance?: string[];  // SOC2, HIPAA, GDPR, PCI-DSS, ISO27001
  dataResidency?: string[];  // regions where data can be stored
  selfHostable?: boolean;
  onPremOption?: boolean;

  // Pricing (precise)
  pricing?: PricingModel;

  // Performance metrics
  latency?: LatencyMetrics;
  reliability?: ReliabilityMetrics;

  // AI/LLM specific
  aiBenchmarks?: AIBenchmarks;

  // Scale fit (new format)
  bestFor?: ('hobby' | 'startup' | 'growth' | 'enterprise')[];
  // Legacy scale field (backward compat)
  scale?: ('hobby' | 'startup' | 'growth' | 'enterprise')[];

  // Qualitative strengths (for matching)
  strengths?: ('dx' | 'reliability' | 'cost' | 'performance' | 'support' | 'security' | 'customization')[];
  weaknesses?: string[];

  // Routing hints
  avoidIf?: string[];  // conditions: "strict data residency", "need offline support"
  requires?: string[];  // dependencies: "internet", "api_key", "webhook_endpoint"
  bestWhen?: string[];  // positive conditions: "need fast iteration", "high volume"

  // Known issues (for learning loop)
  knownIssues?: KnownIssue[];

  // Ecosystem (for affinity scoring)
  ecosystem?: string;  // e.g., "supabase", "firebase", "aws", "vercel"

  // Competitive positioning
  alternatives?: string[];  // other provider IDs
  migratingFrom?: {
    provider: string;
    guide?: string;
    effort: 'trivial' | 'moderate' | 'significant';
  }[];

  // ============================================
  // Legacy fields (backward compat, will migrate)
  // ============================================
  hasFreeTier?: boolean;
  hasSdk?: boolean;
}

// ============================================
// Decision & Outcome Tracking (for learning)
// ============================================

export interface Decision {
  decisionId: string;
  timestamp: string;

  // What was asked
  intent: string;
  category: string;

  // Context at decision time
  repoSignature?: string;  // hash of repo facts
  prefsSignature?: string;  // hash of prefs used

  // What was decided
  candidatesConsidered: string[];
  chosenProvider: string;
  confidence: 'high' | 'medium' | 'low';
  rationale: string[];
  fallbacks: string[];
}

export interface Outcome {
  decisionId: string;
  timestamp: string;

  // Result
  success: boolean;
  stage?: 'setup' | 'build' | 'runtime' | 'quota' | 'auth' | 'platform';

  // Error info (if failed)
  errorFingerprint?: string;
  errorMessage?: string;

  // Context
  sdkVersion?: string;
  apiVersion?: string;
  platform?: string;
  environment?: string;  // "dev", "ci", "prod"

  // Timing
  timeToWorkingMinutes?: number;
  retriesNeeded?: number;
  fallbackUsed?: string;

  // Feedback
  notes?: string;
}
