# 21: Connect an account for sending

**What to build:** Three jobs stay dim because sending needs a connected account. Pick one account (email first), keep its secret where only the home server reads it, and let a sent message happen only after the owner's Accept. Agents still cannot send or reach the internet.

**Blocked by:** none

**Status:** needs-triage

**Plan tasks:** none (left for later by version 3, 12 November 2026)

- [ ] The owner chooses which account to connect first
- [ ] The secret is kept in the secrets folder and never shown
- [ ] Sending happens from the home server, after Accept, and is logged
- [ ] The three dim jobs can start
- [ ] The fence proof still holds
