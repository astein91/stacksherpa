# stacksherpa

Intelligent API recommendation engine. When you need an external API, stacksherpa picks the best one for your stack — with pricing, known issues, compliance data, and real GitHub issue tracking.

**450+ providers across 28 categories** &middot; **[Browse the catalog →](https://stacksherpa.vercel.app)**

---

## Browse

Visit **[stacksherpa.vercel.app](https://stacksherpa.vercel.app)** to explore the full provider catalog — filter by category, compare providers, see pricing and known issues.

## Install the CLI

```bash
npm install -g stacksherpa
```

Or run without installing:

```bash
npx stacksherpa providers email --pretty
```

**No API keys needed.** The provider catalog is hosted on a shared read-only database.

## CLI usage

```bash
# Browse categories
stacksherpa categories --pretty

# See all providers in a category (with pricing, issues, compliance)
stacksherpa providers email --pretty
stacksherpa providers database --pretty
stacksherpa providers ai --pretty

# Deep-dive on a specific provider
stacksherpa provider stripe --pretty
stacksherpa provider resend --pretty

# View/update your project profile
stacksherpa profile --pretty
stacksherpa profile --set '{"project.name": "my-app", "project.scale": "startup"}'
stacksherpa profile --set '{"constraints.compliance": ["SOC2"]}'
stacksherpa profile --append '{"preferences.avoidProviders": "sendgrid"}'

# Record what you chose (improves future recommendations)
stacksherpa decide --api Resend --category email --outcome positive
stacksherpa decide --api SendGrid --category email --outcome negative --notes "TypeScript types broken"

# Report how the integration went
stacksherpa report --id <decision-id> --success
stacksherpa report --id <decision-id> --failure --stage build --notes "SDK didn't support ESM"

# Manage project registry
stacksherpa projects list --pretty
stacksherpa projects prune
```

All commands output JSON. Add `--pretty` for human-readable formatting.

## Claude Code integration

Install the skill so Claude automatically consults stacksherpa whenever you need an API:

```bash
# Install globally (works in all your projects)
mkdir -p ~/.claude/skills/api-selection
curl -sL https://raw.githubusercontent.com/astein91/stacksherpa/main/skills/api-selection/SKILL.md \
  -o ~/.claude/skills/api-selection/SKILL.md
```

Or install per-project:

```bash
mkdir -p .claude/skills/api-selection
curl -sL https://raw.githubusercontent.com/astein91/stacksherpa/main/skills/api-selection/SKILL.md \
  -o .claude/skills/api-selection/SKILL.md
```

That's it. Claude will now silently run `stacksherpa providers <category>` before suggesting any API integration. No slash command needed — the skill triggers automatically.

**Alternative:** If you prefer not to install the skill, just add this to your project's `CLAUDE.md`:

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
