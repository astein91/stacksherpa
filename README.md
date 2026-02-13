# stacksherpa

Intelligent API recommendation engine for Claude Code. Silently picks the best APIs for your stack based on your project profile, constraints, and past experiences.

**450+ providers across 35 categories** — kept fresh by an agentic pipeline that discovers, scrapes, and updates the catalog automatically.

**[Browse the catalog &rarr; stacksherpa.vercel.app](https://stacksherpa.vercel.app)**

## Install

Add to your Claude Code MCP config (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "api-broker": {
      "command": "npx",
      "args": ["-y", "stacksherpa"]
    }
  }
}
```

That's it. The MCP server starts automatically when Claude needs it.

## What it does

When you ask Claude to implement something that needs an external API (email, payments, auth, etc.), stacksherpa:

1. Looks up all providers in the relevant category from a shared Turso database
2. Evaluates them against your project profile — stack, scale, compliance, budget
3. Factors in taste learned from your past decisions across all projects
4. Returns the best match with confidence level and rationale

Claude uses the recommendation silently — you just get the right API without having to research it.

## How it works

**Recommendation factors:**

- **Compliance gate** — SOC2, HIPAA, GDPR, PCI-DSS requirements eliminate non-compliant providers
- **Scale fit** — hobby, startup, growth, enterprise
- **Strength alignment** — matches your priorities (DX, reliability, cost, performance, support)
- **Ecosystem affinity** — prefers providers in ecosystems you already use (Supabase, AWS, Vercel, etc.)
- **Past experience** — positive/negative outcomes across all your projects
- **Known issues** — flags providers with active critical bugs from GitHub

**Categories:**

email, payments, auth, sms, storage, database, analytics, search, monitoring, ai, push, financial-data, prediction-markets, trading, secrets, rate-limiting, maps, video, scheduling, jobs, vector-db, ai-orchestration, document-processing, ai-memory, integrations, webhooks, api-gateway, audit-logging, ai-audio, ai-video, ai-image, feature-flags, message-queue, cache-kv, realtime

## MCP Tools

| Tool | Description |
|------|-------------|
| `recommend` | Get instant recommendation for a category |
| `get_profile` | View merged project profile + cross-project taste |
| `update_project_profile` | Surgical profile updates (set/append/remove) |
| `record_decision` | Record an API selection outcome |
| `get_provider` | Detailed provider info with pricing, issues, benchmarks |
| `list_categories` | All categories with provider counts |
| `get_search_strategy` | Tailored search queries for deeper research |
| `report_outcome` | Report integration success/failure for learning loop |
| `manage_projects` | List, update, or prune registered projects |

## Data architecture

```
Turso (shared, read-only for clients)
  providers      — 450+ providers with rich metadata
  pricing        — versioned pricing snapshots
  known_issues   — scraped from GitHub (reactions, severity)
  ai_benchmarks  — LMArena + Artificial Analysis scores
  discovery_log  — audit trail of bootstrap runs

Local (~/.stacksherpa/)
  profile.json   — your project constraints & preferences
  decisions.json — your API selection history
  defaults.json  — global defaults across all projects
  registry.json  — project registry for cross-project taste
```

Client data never leaves your machine. The Turso catalog is read-only from MCP clients.

## Configuration

### Project profile

Create `.stacksherpa/profile.json` in your project root:

```json
{
  "project": {
    "name": "my-app",
    "stack": { "language": "TypeScript", "framework": "Next.js", "hosting": "Vercel" },
    "scale": "startup"
  },
  "constraints": {
    "compliance": ["SOC2"],
    "budgetCeiling": { "monthly": 100 }
  },
  "preferences": {
    "prioritize": ["dx", "reliability"],
    "avoidProviders": ["sendgrid"]
  }
}
```

Or let Claude update it for you — it calls `update_project_profile` automatically when it learns about your stack.

### Global defaults

Set defaults for all projects in `~/.stacksherpa/defaults.json`. Local project profiles merge with globals (arrays union, scalars override).

## Keeping the catalog fresh

The catalog is maintained by an agentic pipeline — no manual data entry.

### Daily cron (`npm run cron:daily`)

Runs on a schedule (GitHub Actions or manually):

| Step | Schedule | What it does |
|------|----------|--------------|
| GitHub issues | Every run | Scrapes issues with 2+ reactions from provider repos |
| Pricing | Every run | Re-scrapes up to 3 stale providers via Firecrawl |
| AI benchmarks | Mondays | Updates LMArena and Artificial Analysis scores |
| Discovery | 1st & 15th | Finds new providers via Exa search |
| Metadata refresh | Every run | Re-scrapes 2 stale provider websites |
| Agent refresh | Mondays | Claude Haiku re-evaluates provider profiles |
| Bootstrap | 1st of month | Full agentic discovery across all 35 categories |

### Bootstrap pipeline (`npm run cron:bootstrap`)

An AI agent (Claude Haiku + Exa search + Firecrawl) autonomously discovers new providers:

1. Checks existing providers in each category
2. Searches for comparison articles and recent launches
3. Scrapes each candidate's website for accurate details
4. Validates against category definitions and blocked domains
5. Inserts as `review_status = 'pending'` with full audit trail

New discoveries require manual approval before appearing in recommendations:

```bash
npm run cron:review -- --list                    # See what's pending
npm run cron:review -- --approve pinecone qdrant # Approve specific providers
npm run cron:review -- --approve-category jobs   # Approve an entire category
npm run cron:review -- --reject some-blog        # Reject bad entries
npm run cron:review -- --log                     # View audit trail
```

### Environment variables

| Variable | Required for | Purpose |
|----------|-------------|---------|
| `TURSO_AUTH_TOKEN` | All reads | Read-only Turso access |
| `TURSO_WRITE_TOKEN` | Cron jobs | Write access for scrapers/agents |
| `ANTHROPIC_API_KEY` | Agent refresh, bootstrap | Claude Haiku for agentic pipelines |
| `EXA_API_KEY` | Bootstrap | Web search for provider discovery |
| `FIRECRAWL_API_KEY` | Pricing, metadata | Website scraping |
| `GITHUB_TOKEN` | Issue scraping | Higher rate limits for GitHub API |

## Web app

The `web/` directory contains a Next.js app for browsing the provider catalog. It reads directly from Turso (read-only) and shows only approved providers.

```bash
cd web
npm install
npm run dev    # http://localhost:3000
```

Deployed to Vercel with `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` environment variables.

## Development

```bash
# Install dependencies
npm install

# Type-check
npm run build

# Run MCP server locally
npm run dev

# Run tests
npm test

# Seed/migrate Turso schema
TURSO_WRITE_TOKEN=... npm run seed:turso

# Bootstrap a single category (dry run)
npm run cron:bootstrap -- --category jobs --dry-run

# Full agent refresh
npm run cron:agent-refresh -- --full
```

## License

MIT
