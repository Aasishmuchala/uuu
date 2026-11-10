# How paperclip budgets work on subscription plans

Label: wayfinder:research
Type: research
Status: resolved

## Question

How do paperclip's cost tracking, budgets and hard stops behave when agents run on subscription plans (Claude Code signed in to a Claude plan, Codex signed in to a ChatGPT plan) and not on API keys? Cover what it measures in that case, whether a budget can be set in tokens or runs when there is no real cost, and how plan rate limits show up.

## Answer

Runs on a subscription plan never count against a paperclip budget, so a budget cannot limit them.

- **What is recorded:** token counts, a billing type of `subscription_included`, and 0 cents of money, for both Claude Code and Codex.
- **What a budget can be:** money only (`billed_cents`), per month or lifetime, for the company, an agent or a project. No budget in tokens, runs or time.
- **Warning and hard stop:** at 80% it records a warning and does not pause. At 100% it pauses that scope, refuses new work, asks running work to stop shortly after, and opens a board approval. Neither triggers on subscription runs, because they record no money.
- **When the plan's quota runs out:** detected from the CLI's output. The task is rescheduled to the provider's reset time, or one hour later if none is given. No one is paused or asked. Quota windows show in the interface but are not enforced.
- **Trap:** if `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set where paperclip starts, a run is billed as metered API use. Checked on this Mac on 11 November 2026: `OPENAI_API_KEY` is set in the shell environment; `ANTHROPIC_API_KEY` is not. The Codex adapter's docs say it blanks `OPENAI_API_KEY` per agent unless one is configured.
- **Not found in the sources:** whether the 80% warning reaches the agent's own run, and who is notified on a hard stop beyond the approval and dashboard.

Findings with sources: branch `research/how-paperclip-budgets-work-on-subscription-plans`, file `docs/research/how-paperclip-budgets-work-on-subscription-plans.md`.
