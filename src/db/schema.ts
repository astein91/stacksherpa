/**
 * Database Schema
 *
 * Using SQLite for simplicity (can swap to Postgres/Turso for production)
 * Tables mirror our TypeScript types but optimized for querying
 */

// SQL schema for providers table
export const SCHEMA = `
-- Providers: main table
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  subcategories TEXT,  -- JSON array
  status TEXT DEFAULT 'active',

  -- URLs
  website TEXT,
  docs_url TEXT,
  pricing_url TEXT,
  github_repo TEXT,

  -- Package info
  package TEXT,
  package_alt_names TEXT,  -- JSON object

  -- Compliance & security
  compliance TEXT,  -- JSON array
  data_residency TEXT,  -- JSON array
  self_hostable INTEGER DEFAULT 0,
  on_prem_option INTEGER DEFAULT 0,

  -- Qualitative
  strengths TEXT,  -- JSON array
  weaknesses TEXT,  -- JSON array
  best_for TEXT,  -- JSON array (scale)

  -- Routing hints
  avoid_if TEXT,  -- JSON array
  requires TEXT,  -- JSON array
  best_when TEXT,  -- JSON array

  -- Alternatives
  alternatives TEXT,  -- JSON array

  -- Ecosystem (for affinity scoring)
  ecosystem TEXT,  -- e.g., "supabase", "firebase", "aws"

  -- Timestamps
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_verified TEXT
);

-- Pricing: separate table for versioning
CREATE TABLE IF NOT EXISTS pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL REFERENCES providers(id),

  pricing_type TEXT,  -- usage, seat, flat, tiered, freemium
  currency TEXT DEFAULT 'USD',

  -- Free tier
  free_tier_included TEXT,
  free_tier_limitations TEXT,  -- JSON array

  -- Unit pricing
  unit TEXT,
  unit_price REAL,
  volume_discounts TEXT,  -- JSON array

  -- Plans
  plans TEXT,  -- JSON array

  -- Metadata
  source_url TEXT,
  scraped_at TEXT DEFAULT CURRENT_TIMESTAMP,
  confidence TEXT DEFAULT 'medium',

  UNIQUE(provider_id, scraped_at)
);

-- Platform support: per-platform SDK info
CREATE TABLE IF NOT EXISTS platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL REFERENCES providers(id),

  platform TEXT NOT NULL,  -- ios, android, web, server, edge
  sdk_package TEXT,
  sdk_version TEXT,
  maturity TEXT,  -- experimental, beta, stable, mature
  notes TEXT,

  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(provider_id, platform)
);

-- Latency metrics
CREATE TABLE IF NOT EXISTS latency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL REFERENCES providers(id),

  p50_ms REAL,
  p95_ms REAL,
  p99_ms REAL,
  cold_start_ms REAL,

  region TEXT,
  source TEXT,
  measured_at TEXT DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(provider_id, region, measured_at)
);

-- Reliability metrics
CREATE TABLE IF NOT EXISTS reliability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL REFERENCES providers(id),

  uptime_sla REAL,
  historical_uptime REAL,
  status_page_url TEXT,

  last_incident_date TEXT,
  last_incident_severity TEXT,
  last_incident_description TEXT,

  measured_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- AI Benchmarks (for AI/LLM providers)
CREATE TABLE IF NOT EXISTS ai_benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  model_name TEXT,

  -- LMArena
  lmarena_elo INTEGER,
  lmarena_rank INTEGER,
  lmarena_category TEXT,

  -- Artificial Analysis
  aa_quality_index REAL,
  aa_speed_index REAL,
  aa_price_per_m_token REAL,
  aa_tokens_per_second REAL,
  aa_ttft_ms REAL,

  -- Context window
  context_max_tokens INTEGER,
  context_effective_tokens INTEGER,

  -- Capabilities (as JSON for flexibility)
  capabilities TEXT,  -- JSON object

  -- Standard benchmarks
  benchmarks TEXT,  -- JSON array of {name, score, maxScore}

  measured_at TEXT DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(provider_id, model_name, measured_at)
);

-- Known issues (from GitHub, user reports, etc.)
CREATE TABLE IF NOT EXISTS known_issues (
  id TEXT PRIMARY KEY,  -- e.g., gh-openai-openai-node-123
  provider_id TEXT NOT NULL REFERENCES providers(id),

  symptom TEXT NOT NULL,
  scope TEXT,
  workaround TEXT,
  severity TEXT DEFAULT 'low',  -- low, medium, high, critical

  affected_versions TEXT,
  github_issue_url TEXT,

  reported_at TEXT,
  resolved_at TEXT,
  confidence TEXT DEFAULT 'medium',

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Decisions & outcomes (for learning loop)
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,

  intent TEXT,
  category TEXT,

  repo_signature TEXT,
  prefs_signature TEXT,

  candidates_considered TEXT,  -- JSON array
  chosen_provider TEXT REFERENCES providers(id),
  confidence TEXT,
  rationale TEXT,  -- JSON array
  fallbacks TEXT,  -- JSON array

  -- Outcome (filled in later)
  outcome_success INTEGER,
  outcome_stage TEXT,
  outcome_error_fingerprint TEXT,
  outcome_notes TEXT,
  outcome_recorded_at TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_providers_category ON providers(category);
CREATE INDEX IF NOT EXISTS idx_providers_status ON providers(status);
CREATE INDEX IF NOT EXISTS idx_pricing_provider ON pricing(provider_id);
CREATE INDEX IF NOT EXISTS idx_known_issues_provider ON known_issues(provider_id);
CREATE INDEX IF NOT EXISTS idx_known_issues_severity ON known_issues(severity);
CREATE INDEX IF NOT EXISTS idx_decisions_category ON decisions(category);
CREATE INDEX IF NOT EXISTS idx_decisions_chosen ON decisions(chosen_provider);

-- View: Latest pricing per provider
CREATE VIEW IF NOT EXISTS latest_pricing AS
SELECT p.*
FROM pricing p
INNER JOIN (
  SELECT provider_id, MAX(scraped_at) as max_scraped
  FROM pricing
  GROUP BY provider_id
) latest ON p.provider_id = latest.provider_id AND p.scraped_at = latest.max_scraped;

-- View: Latest AI benchmarks per provider
CREATE VIEW IF NOT EXISTS latest_ai_benchmarks AS
SELECT b.*
FROM ai_benchmarks b
INNER JOIN (
  SELECT provider_id, model_name, MAX(measured_at) as max_measured
  FROM ai_benchmarks
  GROUP BY provider_id, model_name
) latest ON b.provider_id = latest.provider_id
  AND b.model_name = latest.model_name
  AND b.measured_at = latest.max_measured;

-- View: Active issues (not resolved)
CREATE VIEW IF NOT EXISTS active_issues AS
SELECT * FROM known_issues
WHERE resolved_at IS NULL
ORDER BY
  CASE severity
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    ELSE 4
  END;
`;

// Helper type for JSON fields
export type JsonField = string | null;

// Row types matching the schema
export interface ProviderRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  subcategories: JsonField;
  status: string;
  website: string | null;
  docs_url: string | null;
  pricing_url: string | null;
  github_repo: string | null;
  package: string | null;
  package_alt_names: JsonField;
  compliance: JsonField;
  data_residency: JsonField;
  self_hostable: number;
  on_prem_option: number;
  strengths: JsonField;
  weaknesses: JsonField;
  best_for: JsonField;
  avoid_if: JsonField;
  requires: JsonField;
  best_when: JsonField;
  alternatives: JsonField;
  ecosystem: string | null;
  created_at: string;
  updated_at: string;
  last_verified: string | null;
}

export interface PricingRow {
  id: number;
  provider_id: string;
  pricing_type: string | null;
  currency: string;
  free_tier_included: string | null;
  free_tier_limitations: JsonField;
  unit: string | null;
  unit_price: number | null;
  volume_discounts: JsonField;
  plans: JsonField;
  source_url: string | null;
  scraped_at: string;
  confidence: string;
}

export interface KnownIssueRow {
  id: string;
  provider_id: string;
  symptom: string;
  scope: string | null;
  workaround: string | null;
  severity: string;
  affected_versions: string | null;
  github_issue_url: string | null;
  reported_at: string | null;
  resolved_at: string | null;
  confidence: string;
  created_at: string;
  updated_at: string;
}
