# stacksherpa

Intelligent API recommendation engine. 450+ providers across 28 categories — with pricing, known issues, compliance data, and live GitHub issue tracking.

**[Browse the catalog →](https://stacksherpa.vercel.app)**

## Quick start

```bash
# 1. Install the CLI
npm install -g stacksherpa

# 2. Install the Claude Code skill (Claude will auto-consult stacksherpa when you need an API)
mkdir -p ~/.claude/skills/api-selection
curl -sL https://raw.githubusercontent.com/astein91/stacksherpa/main/skills/api-selection/SKILL.md \
  -o ~/.claude/skills/api-selection/SKILL.md

# 3. Try it
stacksherpa providers email --pretty
```

No API keys needed. The catalog is a shared read-only database.

---

## Browse the catalog

Visit **[stacksherpa.vercel.app](https://stacksherpa.vercel.app)** to explore providers, compare options, and see pricing and known issues — no install required.

## CLI usage

```bash
stacksherpa categories --pretty                # List all 28 categories
stacksherpa providers email --pretty            # All email providers + your profile
stacksherpa providers database --pretty         # All database providers
stacksherpa provider stripe --pretty            # Deep-dive on one provider

stacksherpa profile --pretty                    # View your project profile
stacksherpa profile --set '{"project.scale": "startup"}'
stacksherpa profile --set '{"constraints.compliance": ["SOC2"]}'

stacksherpa decide --api Resend --category email --outcome positive
stacksherpa report --id <decision-id> --success

stacksherpa projects list --pretty
```

All commands output JSON. Add `--pretty` for human-readable formatting.

## Claude Code skill

The quick start installs the skill globally (`~/.claude/skills/`). You can also install per-project:

```bash
mkdir -p .claude/skills/api-selection
curl -sL https://raw.githubusercontent.com/astein91/stacksherpa/main/skills/api-selection/SKILL.md \
  -o .claude/skills/api-selection/SKILL.md
```

Once installed, Claude will silently run `stacksherpa providers <category>` before suggesting any API integration. No slash command needed — the skill triggers automatically.

**Alternative — no skill, just instructions:** Add this to your project's `CLAUDE.md`:

```markdown
## API Selection
When implementing features that require external APIs:
1. Run `stacksherpa providers <category>` via Bash before choosing a provider
2. Pick the best match based on the returned profile, pricing, and issues
3. After integration, run `stacksherpa decide --api X --category Y --outcome positive`
```

## Categories (28)

| Group | Categories |
|-------|-----------|
| **Core** | auth, database, storage, email, payments, analytics, monitoring, search |
| **Messaging** | sms, push, realtime, chat |
| **AI** | ai, ai-audio, ai-video, ai-image, vector-db |
| **Infrastructure** | cache, jobs, message-queue, hosting, cdn, feature-flags |
| **Content & data** | cms, media, maps, web-search, finance |

## What each provider includes

- Description, website, docs URL, pricing URL
- Strengths (dx, reliability, cost, performance, support, security, customization)
- Best for (hobby / startup / growth / enterprise)
- Avoid if / best when (concrete conditions)
- Alternatives (linked provider IDs)
- Compliance certs (SOC2, HIPAA, GDPR, PCI-DSS, ISO27001)
- Ecosystem affinity (vercel, supabase, aws, cloudflare, etc.)
- Self-hostable flag
- **Live pricing** — scraped from provider websites
- **Known issues** — scraped from GitHub (reactions, severity, workarounds)

## Project profile

Create `.stacksherpa/profile.json` in your project root to personalize recommendations:

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

Global defaults in `~/.stacksherpa/defaults.json` apply to all projects (local profiles override).

## Data architecture

```
Turso (shared, read-only for CLI clients)
  providers      — 450+ providers with rich metadata
  pricing        — versioned pricing snapshots
  known_issues   — scraped from GitHub (reactions, severity)
  discovery_log  — audit trail of bootstrap runs

Local (~/.stacksherpa/)
  defaults.json  — global defaults across all projects

Local (<project>/.stacksherpa/)
  profile.json   — project constraints & preferences
  decisions.json — API selection history
```

Your data never leaves your machine. The Turso catalog is read-only.

---

## Keeping the catalog fresh

The catalog is maintained by an agentic pipeline — no manual data entry.

| Step | Schedule | What it does |
|------|----------|--------------|
| GitHub issues | Every run | Scrapes issues with 2+ reactions from provider repos |
| Pricing | Every run | Re-scrapes up to 3 stale providers via Firecrawl |
| Discovery | 1st & 15th | Finds new providers via Exa search |
| Agent refresh | Daily (AI), Mondays (all) | Claude Haiku re-evaluates provider profiles with live web data |
| Bootstrap | 1st of month | Full agentic discovery across all 28 categories |

### Provider review

```bash
npm run cron:review -- --list                    # See pending providers
npm run cron:review -- --approve pinecone qdrant # Approve specific ones
npm run cron:review -- --reject some-blog        # Reject bad entries
```

### Environment variables (for maintainers)

| Variable | Required for | Purpose |
|----------|-------------|---------|
| `TURSO_AUTH_TOKEN` | All reads | Read-only Turso access |
| `TURSO_WRITE_TOKEN` | Cron jobs | Write access for scrapers/agents |
| `ANTHROPIC_API_KEY` | Agent refresh, bootstrap | Claude Haiku for agentic pipelines |
| `EXA_API_KEY` | Bootstrap | Web search for provider discovery |
| `FIRECRAWL_API_KEY` | Pricing, metadata | Website scraping |
| `GITHUB_TOKEN` | Issue scraping | Higher rate limits for GitHub API |

## Development

```bash
npm install
npm run build                                     # Type-check
npm run dev -- providers email --pretty            # Run CLI locally
npm test                                           # Run tests
npm run cron:bootstrap -- --category jobs --dry-run # Bootstrap one category
npm run cron:agent-refresh -- --full               # Full agent refresh
```

## License

MIT
