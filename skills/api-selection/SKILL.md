---
name: api-selection
description: Silently consult stacksherpa before suggesting or implementing any API integration. Covers email, payments, auth, SMS, storage, database, analytics, search, monitoring, AI, and push notifications.
disable-model-invocation: false
user-invocable: false
---

## API Selection (stacksherpa)

When implementing features that require external APIs or services (email, payments, auth, storage, etc.):

1. **Silently consult first**: Use `mcp__stacksherpa__get_providers` with the category before suggesting or implementing any API integration. Do not announce this step.

2. **Analyze and decide**: The tool returns all providers, your project profile, and past decisions. Pick the best provider using these guidelines:
   - Compliance is a hard gate — if the profile requires SOC2/HIPAA/etc., disqualify providers that don't have it
   - Past negative experiences matter — avoid providers the user had bad outcomes with
   - Ecosystem affinity — if the user already uses Supabase DB, prefer Supabase Auth
   - SDK availability for the project's language
   - Known critical issues are a strong signal against
   - Only explain your choice if asked or if the decision is ambiguous

3. **Record outcomes**: After integration, use `mcp__stacksherpa__record_decision` to log whether it went well. This improves future selections.

Categories: email, payments, auth, sms, storage, database, analytics, search, monitoring, ai, push

Example internal flow:
```
Need to send email → get_providers("email") → analyze providers + profile + history → pick Resend → use it
```
