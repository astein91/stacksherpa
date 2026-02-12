# stacksherpa

Intelligent API recommendation engine for Claude Code. Silently picks the best APIs for your stack based on your project profile, constraints, and past experiences.

## Install

```bash
claude plugin add github:alexstein/stacksherpa
```

That's it. The skill loads automatically and the MCP server starts on first use.

## What happens

When you ask Claude to implement something that needs an external API (email, payments, auth, etc.), stacksherpa:

1. Checks the shared provider catalog (50+ providers across 13 categories)
2. Scores providers against your project profile (stack, scale, compliance, budget)
3. Applies taste learned from your past decisions across all projects
4. Returns the best match with confidence level

Claude uses the recommendation silently — you just get the right API without having to research it.

## How it works

**Scoring factors:**
- Compliance match (SOC2, HIPAA, GDPR, PCI-DSS)
- Scale fit (hobby → enterprise)
- Strength alignment with your priorities (DX, reliability, cost, performance)
- Ecosystem affinity (prefers providers in ecosystems you already use)
- Past experience (positive/negative outcomes across projects)
- Pattern inference (learns your preferences over time)

**Categories:** email, payments, auth, sms, storage, database, analytics, search, monitoring, ai, push, financial-data, trading, prediction-markets

## Tools

The MCP server exposes these tools:

| Tool | Description |
|------|-------------|
| `recommend` | Get instant recommendation for a category |
| `get_profile` | View merged project profile + taste |
| `update_project_profile` | Surgical profile updates (set/append/remove) |
| `record_decision` | Record an API selection outcome |
| `get_provider` | Detailed provider info (pricing, issues, benchmarks) |
| `list_categories` | All categories with provider counts |
| `get_search_strategy` | Tailored search queries for research |
| `report_outcome` | Report integration success/failure |

## Data

- **Shared catalog**: Hosted on Turso (read-only from clients). Providers, pricing, issues, benchmarks.
- **Local data**: `~/.stacksherpa/` stores your profiles, decisions, and project registry. Never leaves your machine.

## Configuration

### Project profile

Create `.stacksherpa/profile.json` in your project:

```json
{
  "project": {
    "name": "my-app",
    "stack": { "language": "TypeScript", "framework": "Next.js" },
    "scale": "startup"
  },
  "constraints": {
    "compliance": ["SOC2"]
  },
  "preferences": {
    "prioritize": ["dx", "reliability"]
  }
}
```

Or let Claude update it for you via the `update_project_profile` tool.

### Global defaults

Set defaults for all projects in `~/.stacksherpa/defaults.json`. Local project profiles override globals.

## Advanced

### Self-hosting the catalog

Set environment variables to point at your own Turso database:

```bash
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-read-token
```

### Seeding the catalog

```bash
TURSO_WRITE_TOKEN=your-write-token npm run seed:turso
```

### Running scrapers

Scrapers update pricing, issues, and benchmarks. They require write access to Turso and API keys for data sources:

```bash
FIRECRAWL_API_KEY=... TURSO_WRITE_TOKEN=... npm run cron:daily
```
