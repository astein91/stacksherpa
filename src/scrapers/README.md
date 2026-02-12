# API Broker Data Pipeline

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      DATA SOURCES                                │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────┤
│   Pricing   │  Benchmarks │  Reliability│  Discovery  │   SDK   │
│   Pages     │  (AI/LLM)   │  & Status   │  (New APIs) │  Info   │
└──────┬──────┴──────┬──────┴──────┬──────┴──────┬──────┴────┬────┘
       │             │             │             │           │
       ▼             ▼             ▼             ▼           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    COLLECTION LAYER                              │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────┤
│  Firecrawl  │    Exa      │  Direct API │    Exa      │  npm/   │
│  (scrape +  │  (search +  │  (status    │  (semantic  │  GitHub │
│   extract)  │   scrape)   │   pages)    │   search)   │   API   │
└──────┬──────┴──────┬──────┴──────┬──────┴──────┬──────┴────┬────┘
       │             │             │             │           │
       └─────────────┴──────┬──────┴─────────────┴───────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PROCESSING LAYER                              │
│  • LLM extraction (structured data from unstructured)           │
│  • Validation (schema conformance)                               │
│  • Deduplication                                                 │
│  • Change detection (what's new vs. what changed)               │
└──────────────────────────────┬──────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STORAGE (knowledge.ts → DB)                   │
│  • Versioned provider records                                    │
│  • Change history                                                │
│  • Freshness tracking                                            │
└─────────────────────────────────────────────────────────────────┘
```

## Data Sources by Type

### 1. Pricing Data
| Source Type | Tool | Example |
|-------------|------|---------|
| Pricing pages | Firecrawl | `openai.com/api/pricing` |
| Pricing APIs | Direct fetch | Some providers have JSON pricing |

### 2. AI/LLM Benchmarks
| Source | URL | Data |
|--------|-----|------|
| LMArena | `lmarena.ai` | ELO scores, rankings |
| Artificial Analysis | `artificialanalysis.ai` | Quality index, speed, TTFT |
| Official benchmarks | Provider blogs | MMLU, HumanEval, etc. |

### 3. Reliability & Status
| Source | Tool | Data |
|--------|------|------|
| Status pages | Direct API | Uptime %, incidents |
| Statuspage.io API | Direct fetch | Many providers use this |

### 4. New API Discovery
| Source | Tool | Query |
|--------|------|-------|
| Product Hunt | Exa | "new [category] API launched" |
| Hacker News | Exa | "Show HN: [category] API" |
| Tech blogs | Exa | "best [category] API 2025" |
| GitHub trending | GitHub API | New SDKs in category |

### 5. SDK/Package Info
| Source | Tool | Data |
|--------|------|------|
| npm registry | API | Version, downloads, updated |
| PyPI | API | Same for Python |
| GitHub | API | Stars, issues, last commit |

## Tool Selection: Firecrawl vs Exa

**Decision: Use Firecrawl + Direct APIs for v0. Add Exa later if needed.**

| Capability | Firecrawl | Exa | GitHub API |
|------------|-----------|-----|------------|
| Structured extraction | ✅ Best | ⚠️ Basic | ❌ |
| Known URL scraping | ✅ | ✅ | ❌ |
| Semantic search | ❌ | ✅ Best | ❌ |
| JS-rendered pages | ✅ Full browser | ⚠️ Limited | N/A |
| Issues/bugs | ❌ | ❌ | ✅ Best |
| SDK metadata | ❌ | ❌ | ✅ Best |

**Rationale:**
- **Firecrawl** handles 90% of our needs (pricing pages, benchmark sites)
- **GitHub API** is free and gives us issues, releases, SDK info
- **Exa** is nice-to-have for discovery but can be manual initially

### Firecrawl (Primary - structured extraction)
```typescript
const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

// Extract pricing with LLM + JSON schema
const result = await firecrawl.scrapeUrl("https://openai.com/api/pricing", {
  formats: ["extract"],
  extract: {
    schema: {
      type: "object",
      properties: {
        models: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              inputPricePerMillion: { type: "number" },
              outputPricePerMillion: { type: "number" },
              contextWindow: { type: "number" }
            }
          }
        }
      }
    }
  }
});
```

### GitHub API (Issues, SDK info, releases)
```typescript
// Get open bugs for a provider SDK
const issues = await fetch(
  'https://api.github.com/repos/openai/openai-node/issues?labels=bug&state=open',
  { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
);

// Get latest release
const release = await fetch(
  'https://api.github.com/repos/stripe/stripe-node/releases/latest'
);

// Search for issues with high engagement
const search = await fetch(
  'https://api.github.com/search/issues?q=repo:openai/openai-node+is:issue+is:open+sort:reactions-+1'
);
```

### Direct APIs (npm, status pages)
```typescript
// npm registry - package info, download counts
const npmInfo = await fetch(`https://registry.npmjs.org/${packageName}`);

// Statuspage.io (many providers use this)
const status = await fetch(`https://status.openai.com/api/v2/summary.json`);
```

### Exa (Optional - for discovery only)
```typescript
// Only needed if you want automated new API discovery
const exa = new Exa(process.env.EXA_API_KEY);

const results = await exa.searchAndContents(
  "new authentication API startup launched 2025",
  { type: "auto", numResults: 10 }
);
```

## Scraping Schedule

| Task | Frequency | Tool | Script |
|------|-----------|------|--------|
| Pricing updates | Weekly | Firecrawl | `npm run scrape:pricing` |
| Benchmark scores | Weekly | Firecrawl | `npm run scrape:benchmarks` |
| Status/reliability | Daily | Direct API | `npm run scrape:status` |
| SDK versions | Daily | npm/GitHub API | `npm run scrape:sdks` |
| **Known issues** | Daily | **GitHub API** | `npm run issues:all` |
| New API discovery | Weekly | Manual / Exa | `npm run discover` |
| Freshness check | Daily | Local | `npm run freshness` |

## Implementation Plan

### Phase 1: GitHub + Manual ✅
- [x] GitHub Issues scraper for known bugs
- [x] Freshness checker
- [x] Rich schema with timestamps
- [ ] Manual curation of top 20 providers

### Phase 2: Automated Updates
- [ ] Firecrawl jobs for pricing pages
- [ ] Firecrawl jobs for AI benchmarks (LMArena, Artificial Analysis)
- [ ] Status page polling
- [ ] npm/GitHub SDK version tracking

### Phase 3: Full Automation
- [ ] GitHub Actions scheduled jobs
- [ ] Change detection + Slack/Discord alerts
- [ ] Auto-discovery pipeline (Exa or manual review queue)

## File Structure (Current)
```
src/scrapers/
├── README.md                    # This file
├── types.ts                     # ✅ Scraper-specific types
├── sources/
│   ├── github-issues.ts         # ✅ GitHub bugs/issues scraper
│   ├── pricing.ts               # ✅ Firecrawl pricing extraction
│   ├── benchmarks.ts            # ✅ LMArena + Artificial Analysis
│   └── discovery.ts             # ✅ Exa-based discovery (optional)
└── jobs/
    └── check-freshness.ts       # ✅ Identifies stale data
```

## Environment Variables

```bash
# Required
GITHUB_TOKEN=ghp_...           # GitHub API (higher rate limits)
FIRECRAWL_API_KEY=fc_...       # Firecrawl for web scraping

# Optional
EXA_API_KEY=exa_...            # Only if using discovery
```

## CLI Usage

```bash
# Check what data is stale
npm run freshness

# Get GitHub issues for a specific provider
npm run issues openai
npm run issues stripe

# Get issues for all providers
npm run issues:all

# Discovery (requires EXA_API_KEY)
npm run discover
```
