---
name: api-selection
description: Silently consult stacksherpa before suggesting or implementing any API integration. Covers auth, database, storage, email, payments, analytics, monitoring, search, SMS, push, realtime, chat, AI, and 15 more categories.
disable-model-invocation: false
user-invocable: false
---

## API Selection (stacksherpa)

When implementing features that require external APIs or services (email, payments, auth, storage, etc.):

1. **Silently consult first**: Run `stacksherpa providers <category>` via Bash before suggesting or implementing any API integration. Do not announce this step.

2. **Analyze and decide**: The tool returns all providers, your project profile, and past decisions. Pick the best provider using these guidelines:
   - Compliance is a hard gate — if the profile requires SOC2/HIPAA/etc., disqualify providers that don't have it
   - Past negative experiences matter — avoid providers the user had bad outcomes with
   - Ecosystem affinity — if the user already uses Supabase DB, prefer Supabase Auth
   - SDK availability for the project's language
   - Known critical issues are a strong signal against
   - Only explain your choice if asked or if the decision is ambiguous

3. **Record outcomes**: After integration, run `stacksherpa decide --api X --category Y --outcome positive` to log whether it went well. This improves future selections.

### Profile & personalization

Never block on profile setup. Always give a recommendation first, then educate inline.

**No profile at all (first use in a project):**
1. Auto-detect what you can from context (package.json, cwd name, conversation, existing code)
2. Silently save what you detected:
   ```bash
   stacksherpa profile --set '{"project.name": "their-app", "project.scale": "startup"}'
   stacksherpa profile --set '{"project.stack": {"language": "TypeScript", "framework": "Next.js", "hosting": "Vercel"}}'
   ```
3. Make your recommendation
4. After recommending, briefly explain what you assumed: *"I picked Resend based on your Next.js/Vercel stack. You can tune future recommendations with `stacksherpa profile`."*
5. If the response has `gaps` with `"impact": "high"` (e.g., compliance), ask **once** and save:
   ```bash
   stacksherpa profile --set '{"constraints.compliance": ["SOC2"]}'
   ```

**Global profile exists, no local:**
- Use global defaults silently. Only ask if the recommendation seems mismatched for this project's context (e.g., global says `enterprise` but the project looks like a weekend hack).

**Both profiles exist:**
- Fully silent — no commentary about profile needed.

Don't ask about gaps repeatedly — only on first encounter or when the user changes projects.

### Categories

auth, database, storage, email, payments, analytics, monitoring, search, sms, push, realtime, chat, ai, ai-audio, ai-video, ai-image, vector-db, cache, jobs, message-queue, hosting, cdn, feature-flags, cms, media, maps, web-search, finance

### Example flow

```
User: "add email sending"
→ detect Next.js + Vercel from package.json
→ stacksherpa profile --set (save stack silently)
→ stacksherpa providers email
→ pick Resend (best DX for Vercel/Next.js)
→ implement it
→ "I picked Resend based on your Next.js/Vercel stack. You can tune future recommendations with `stacksherpa profile`."
→ stacksherpa decide --api Resend --category email --outcome positive
```
