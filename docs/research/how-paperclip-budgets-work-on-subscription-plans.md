# How paperclip budgets work on subscription plans

Source: github.com/paperclipai/paperclip at commit `4398a723c0d77efaea47a17f77ec94152c2715f9` (default branch, 2026-11-10), plus docs.paperclip.ing. Paths below are paths in that repository unless a URL is given. Read only; nothing was cloned or run.

## Short answer

- On a subscription login, Claude Code and Codex runs are recorded with token counts and a billing type of `subscription_included`, and the money recorded for them is forced to 0 cents. They do not count against any budget.
- The only budget metric is `billed_cents` (money). A budget cannot be set in tokens, runs or time.
- So a dollar budget does nothing to stop a subscription agent that is burning through its plan. The real limit on subscription runs is the provider's own quota, which paperclip shows and reacts to but does not budget.
- Prices from a rate card are applied only to API-key runs. Codex reports no cost at all; Claude reports a cost that paperclip reads but zeroes for subscription runs.
- Hard stop (100%) pauses the scope, refuses new work, asks running work to stop shortly after, and opens a board approval. Warning (80%, default) only records an incident and does not pause.
- Quota exhaustion is detected from CLI output. The run is classified `provider_quota`, and the issue is rescheduled to the reset time (default one hour if none is given). Nobody is paused and no person is asked.
- Watch for a mis-classification trap: a set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` makes the run metered, and an unclassifiable run is "unpriced", which the default policy treats as a block.

## 1. What is recorded for a Claude Code run and a Codex run

**Claude Code (`claude_local`): tokens plus a CLI-reported dollar cost.**
- Tokens come from the Claude CLI result event. The adapter sums the per-model `modelUsage` ledger (input plus cache-creation, cache-read, output) because the top-level `usage` undercounts when subagents ran. `packages/adapters/claude-local/src/server/parse.ts` (`claudeModelUsageTotals`, comment above it).
- The cost is the CLI's own `total_cost_usd` (and per-model `costUSD`), passed through as `costUsd`. `parse.ts` (lines ~145-160, `claudeModelReceipts`); `packages/adapters/claude-local/src/server/execute.ts` returns `costUsd: parsedStream.costUsd`.
- Billing type: `resolveClaudeBillingType` returns `metered_api` for Bedrock, `api` if `ANTHROPIC_API_KEY` is non-empty, otherwise `subscription`. `execute.ts` line ~173. The docs list `CLAUDE_CODE_OAUTH_TOKEN` or a subscription login as the other auth modes (`docs/adapters/claude-local.md`).

**Codex (`codex_local`): tokens only, no cost.**
- Tokens come from the `turn.completed` event's `usage` (`input_tokens`, `cached_input_tokens`, `output_tokens`). Cached tokens are stored separately from input. `packages/adapters/codex-local/src/server/parse.ts`.
- The adapter always returns `costUsd: null`. `packages/adapters/codex-local/src/server/execute.ts` (the result objects around lines 1391-1625).
- Billing type: `resolveCodexBillingType` returns `api` if `OPENAI_API_KEY` is non-empty, otherwise `subscription`; the biller is then `chatgpt`. `execute.ts` lines ~199-207. Per-agent homes force `OPENAI_API_KEY=""` unless one is configured per agent (`docs/adapters/codex-local.md`, "Per-agent isolation and auth seeding").

**What reaches the ledger for a subscription run.** The adapter's `subscription` is normalised to `subscription_included` (`server/src/services/heartbeat/run-state.ts`, `normalizeLedgerBillingType`), and `normalizeBilledCostCents` returns 0 for that type. At final settlement `costUnits = billingType === "subscription_included" ? 0n : ...`, so the ledger row has tokens and `cost_cents = 0`. `server/src/services/run-cost-accounting.ts` (line ~360); `packages/db/src/schema/cost_events.ts` (columns `input_tokens`, `cached_input_tokens`, `output_tokens`, `cost_cents`, `billing_type`, `cost_status`). Cost status for `subscription_included` is `reported`, not unpriced (`run-state.ts` `resolveLedgerCostStatus`).

The docs page says the same: subscription runs "usually add no per-call charge", and fees are "kept separate from recorded charges and from agent budgets" (https://docs.paperclip.ing/guides/day-to-day/costs/).

## 2. Is a cost computed from a price table for a subscription run?

No. Both rate cards apply to API billing only.
- `server/src/services/anthropic-pricing.ts` (`priceAnthropicReceipt`) returns the receipt unchanged unless `billingType` is `api` or `metered_api`, and only for the models in `RATE_CARDS` (`claude-sonnet-5`, `claude-opus-5-5`). Provenance says "standard global API pricing assumed ... not an invoice".
- `server/src/services/codex-pricing.ts` (`priceCodexReceipt`) requires `provider === "openai"`, `biller === "openai"` and `billingType` `api` or `metered_api`, and only for models in `RATES` (version `openai-standard-2026-09-30`).
- Both tables are hard-coded in those two files; there is no user-editable price table. A priced result is labelled `costStatus: "estimated"` with `pricingProvenance.source: "rate_card"`. `docs/guides/agent-developer/cost-reporting.md` says the same: a complete receipt for a supported direct API model "can be priced using a recorded list-price estimate"; estimates are labelled.
- Subscription fees are a separate thing: user-entered account prices in `ai_subscriptions`, shown as a Subscriptions tile, outside run costs and budgets (`maps/feature-map/budgets-costs.md`, sub-feature `subscriptions`; docs page above).

Not established: whether the Claude CLI's `total_cost_usd` for a subscription run is kept anywhere after being zeroed in `cost_cents` (the `cost_events.reported_cost_cents` column exists but I did not trace what writes it).

## 3. What a budget can be expressed in

Money only.
- `BUDGET_METRICS = ["billed_cents"]`. `packages/shared/src/constants.ts` (line ~905). The upsert validator defaults `metric` to `billed_cents` and accepts only that enum. `packages/shared/src/validators/budget.ts`.
- Windows: `calendar_month_utc` or `lifetime` (`BUDGET_WINDOW_KINDS`). Scopes: `company`, `agent`, `project`.
- Other fields: `amount` (cents), `reservationCents` (per-run hold, default 0), `warnPercent` (1-99, default 80), `hardStopEnabled` (default true), `unpricedUsagePolicy` (`block` default, or `allow`), `notifyEnabled`. `packages/db/src/schema/budget_policies.ts`.
- The design plan says token budgets were deliberately left for later as advisory controls and lists `total_tokens`, `requests` as future metrics. `doc/plans/2026-03-14-budget-policies-and-enforcement.md` ("Metric To Enforce First", "Future Budget Metrics", "Why Not Tokens First"). The live docs say: "Tokens are tracked and shown in reports but aren't a budget unit" (docs page above).
- No run-count or time budget exists in the validator or constants. Per-run time is a separate adapter setting (`timeoutSec`, `maxTurnsPerRun` in `docs/adapters/claude-local.md`), not a budget.

What counts: `knownRunCostCents` returns "0" for `subscription_included` and `subscription`, and the live-exposure SQL excludes those billing types, so running subscription work adds nothing to exposure. `server/src/services/budget-exposure.ts`. The plan confirms the intent: `subscription_included` "does not count against money budget"; `subscription_overage` and `metered_api` do.

## 4. Warning threshold and hard stop

Warning (default 80%):
- Creates a `soft` budget incident and an activity entry `budget.soft_threshold_crossed`, only if `notifyEnabled`. No approval, no pause. `server/src/services/budgets.ts` (`evaluateAffectedScopes`, `createIncidentIfNeeded`). The docs page: "This warning does not pause work."
- The older repo guide says the agent "is warned to focus on critical tasks only" and that it should read `spentMonthlyCents` vs `budgetMonthlyCents` itself (`docs/guides/board-operator/costs-and-budgets.md`, `docs/guides/agent-developer/cost-reporting.md`). I found no code that injects a warning into the agent's run; treat that as documentation, not confirmed behaviour. The live docs page does not repeat it.

Hard stop (100%, or unpriced usage under the `block` policy):
- Opens a `hard` incident and a pending `budget_override_required` approval, then `pauseAndCancelScopeForBudget`: the company, agent or project is set to `paused` with `pauseReason: "budget"`. `budgets.ts`.
- New work in the scope is refused at admission. `doc/plans/2026-03-14-budget-policies-and-enforcement.md` ("Active Run Behavior"); `maps/agent-access-map/budgets-costs.md` ("A committed hard stop prevents fresh provider work immediately").
- Work already running is not cut instantly. A durable Stop request is written and delivered asynchronously; the run can add a little more spend first. `server/src/services/heartbeat/budget-cancellation.ts`; `maps/agent-access-map/budgets-costs.md`; docs page: "moments later rather than at the exact same instant". README: "usage reporting and in-flight work can delay a stop".
- If the provider only reports usage at the end of a run, that spend is counted when the run finishes (docs page; `doc/plans/2026-11-03-accounting-contention-and-budget-enforcement.md`, "The current guarantee is already narrower than a dollar cap").
- Who is told: a pending approval and a `budget.hard_threshold_crossed` activity entry (`budgets.ts`), an attention/inbox notification of kind `budget_alert` (`notifyAttentionRetentionWork` in `budgets.ts`), incident cards on Costs/Budgets, and a dashboard banner counting active incidents and paused agents (docs page). The docs page mentions a separate Slack/Discord notification guide; I did not read it.
- Resume: raise the budget (`raise_budget_and_resume`) or `keep_paused` (`packages/shared/src/constants.ts`); paused agents resume automatically at the UTC month rollover unless paused manually (docs page).

## 5. Subscription rate limits and quota exhaustion

Paperclip detects and handles them, separately from budgets. They are not a budget event.

- Detection: the adapters match CLI output for usage-limit phrases and set `errorCode: "provider_quota"` and `errorFamily: "provider_quota"`. Claude: `parse.ts` (regexes for "usage limit reached", "5 hour limit reached", "weekly limit reached", "out of extra usage", and a reset-time parser) and `execute.ts` (`providerQuota`). Codex: `parse.ts` (`CODEX_PROVIDER_QUOTA_RE`, `CODEX_USAGE_LIMIT_RE`, "try again at ...") and `execute.ts` line ~1587.
- Retry: the reset time is carried as `retryNotBefore`/`providerQuotaRetryNotBefore`. `provider_quota` is a retryable error family (`server/src/services/heartbeat/retries.ts`, `readTransientRecoveryContractFromRun`). Recovery (`server/src/services/recovery/service.ts`, `classifyAdapterFailureForRecovery`) waits until the parsed reset time; if none, it uses `PROVIDER_LIMIT_DEFAULT_COOLDOWN_MS` = 60 minutes (`server/src/services/system-recovery-state.ts`).
- What it does to the issue: it schedules an issue monitor with service name "AI provider quota", `recoveryPolicy: "wake_owner"`, notes "Provider usage quota reached; retry ... at the provider reset time", and logs `issue.monitor_scheduled`. The recovery action's owner is `system`, not a board user, and the next action reads "Wait for provider quota recovery, then retry the original assignee; do not wake a takeover owner." `recovery/service.ts` (~lines 2551-2600, ~4380-4475). The agent is not paused by this path (I found no pause in it).
- Docs: `docs/adapters/claude-local.md` ("Quota waits") says the same for Claude, including the one-hour backoff when no reset time exists.
- Visibility: quota windows are fetched and shown, not enforced. Claude via `https://api.anthropic.com/api/oauth/usage` (5-hour, 7-day, per-model weekly, extra usage) or a CLI `/usage` probe (`packages/adapters/claude-local/src/server/quota.ts`); Codex via `https://chatgpt.com/backend-api/wham/usage` or `codex app-server` `account/rateLimits/read` (`packages/adapters/codex-local/src/server/quota.ts`). `server/src/services/quota-windows.ts` collects them per connected account. Latest rate-limit snapshots a harness reports are stored per agent but "never drive execution" (`server/src/services/agent-provider-rate-limits.ts`). The docs page: quota windows are shown for connected Anthropic and OpenAI subscriptions, "Usage not reported" if no percentage.
- The design plan separates the two: "budgets are policy controls; quotas are usage visibility" (`doc/plans/2026-03-14-budget-policies-and-enforcement.md`).
- Shared logins: rotating subscription credentials shared by many concurrent runs are a known concern (see point 6).

## 6. Stated guidance for subscription plans

- A subscription run is "visible in reporting", "does not count against money budget", and the user "should still see the token usage and provider quota state". `doc/plans/2026-03-14-budget-policies-and-enforcement.md` ("Subscription Usage Decision").
- "Subscription fees are kept separate from recorded charges and from agent budgets"; agents sharing one paid seat count once. Docs page (https://docs.paperclip.ing/guides/day-to-day/costs/).
- "For high-concurrency sandbox fleets, prefer a per-agent `OPENAI_API_KEY` over a shared ChatGPT-subscription login... API-key mode is metered per token... ChatGPT-subscription auth uses the subscription's flat-plan economics and quota behavior. Pick the mode deliberately." `docs/adapters/codex-local.md`.
- Prerequisite: local Claude and Codex subscription sign-in needs Python 3 and the provider CLI on the host (`README.md`, quick start).
- The README's problem statement names "max your quota" as a risk and answers with "spend tracking, budget alerts, and automatic pauses" (`README.md`, comparison table). Given points 1 and 3, that does not stop quota burn on a subscription; this sentence is my inference, not a paperclip statement.

## Gotchas inferred from the code (inference, not stated in the docs)

- Billing is classified from the environment, not from the account. A non-empty `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the adapter or host environment turns a run into `api`, which is priced and counts against budgets. If the owner has either key exported in the shell that launches paperclip, runs may be metered. (`execute.ts` in both adapters; codex per-agent isolation blanks `OPENAI_API_KEY` unless configured.)
- With the default `unpricedUsagePolicy = "block"` and any active hard-stop budget with `amount > 0`, an unpriced event can pause a scope below 100%. `hardStopReached` in `budgets.ts`; the docs page confirms: "unpriced usage can block a scope below 100%". Subscription runs are exempt only because they settle as `reported` at 0 cents. A run whose billing type resolves to `unknown` with no price would be unpriced.
- A dollar budget set for a subscription-only company never trips. If a hard cap on subscription use is wanted, it has to come from something other than paperclip budgets (provider quota, `maxTurnsPerRun`, `timeoutSec`, pausing agents manually).

## Not found

- Whether the CLI-reported `total_cost_usd` of a Claude subscription run is kept anywhere after the ledger zeroes it (`reported_cost_cents` not traced).
- Any token, run-count or time budget: none exists in the sources read; only the plan's "future metrics" list.
- Any code that injects the 80% warning into an agent's own run or prompt. Only the older guides claim this.
- Who exactly receives the hard-stop notification beyond the approval, activity entry, `budget_alert` attention item, incident cards and dashboard banner. The Slack/Discord notification guide was not read.
- Any automatic pause, or any person being asked, when subscription quota is exhausted. The recovery path schedules a timed retry owned by `system`; I found no escalation to a person on it, but did not read every branch of `recovery/service.ts`.
- Live behaviour. Nothing was run. The repo's own feature map says verification for these paths is source-review or controlled-provider tests, not live provider termination latency (`maps/feature-map/budgets-costs.md`).
- Differences between the older guides under `docs/guides/` and the current docs site; the repo copies appear older than the source (for example they describe the 80% warning as telling the agent to focus).
