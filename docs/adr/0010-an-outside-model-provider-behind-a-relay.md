# 0010: An outside model provider, behind a relay

## Context

Until 12 November 2026 the owner's rule was: free software only, no paid key of any kind, and the only paid things are the Claude and Codex plans. On 12 November 2026 the owner changed that rule on purpose by asking for Omega Plus, a paid gateway to many models, set up in Settings with a key the owner pastes. The change is the owner's to make. Every other rule stands: this Mac only, the fence is never loosened to make something work, and what runs unfenced never trusts what agents can write (`0007`).

Omega Plus is run by SingleByte Infotech Pvt Ltd, at `api.omegaplusapi.com`. One key opens it. It takes three request formats, and it lists its models at an address that needs no key.

A key inside the fence would be a key an agent can read. An outside host in the fence's list would be a way out for data (see "Still open" in the fence's guide). So the provider could not simply be added to the lists the way the Claude and Codex hosts are.

## Decision

A new part, the model relay, sits between the agents and the provider. It is a small server with no dependencies, on 127.0.0.1 port 3120, started and stopped with the engine.

- **Off by default.** Nothing changes until the owner pastes a key in Settings and switches it on. Switching off restores the plans. There are two modes: plans (today) and provider. The mode, the picks and the last list of models are in `<state>/models/state.json`, which agents cannot reach through the fence. A missing file means plans. A damaged file stops runs rather than guessing.
- **The key never enters the fence.** It is in `<state>/secrets/provider/omega-key` (only the owner can read it), written only by the home server from what the owner types, never returned by any route, never logged, and removable. The relay reads it on every call and adds it itself. No agent program is ever given it.
- **Agents reach only the gate and the relay.** In provider mode the fence lists the gate and the relay and no model host at all: not `api.anthropic.com`, not the OpenAI hosts, not the provider. An agent cannot reach the provider directly.
- **The relay trusts nobody inside the fence.** It accepts only a token minted outside the fence for one agent (the agent's id, an expiry and a keyed hash), so it knows who calls. It forwards only the three model paths, only by POST, with size and time caps, follows no redirect, removes every credential an agent sent and adds the real key. It changes nothing in an answer.
- **Each agent is held to its pick.** The relay sets the request's `model` to the model picked for that agent, so no agent can choose another, and a program's background calls land on the pick too.
- **The owner's Claude login is never sent.** In provider mode the Claude wrapper does not read the login file at all, so the program has no login to send to the relay or the provider. Without this, the Claude program would send its saved login to any base address it is given.
- **Both programs go through the relay.** Claude agents through their own base-address setting. The Checker stays on the Codex program, pointed at the relay by the wrapper, so its checks come from a different maker than the work it checks.
- **The picks.** A short ranking in `engine/company/models.json` says, best first, which models suit each need: thinking, making, writing and checking. The pick for an agent is the first one on its list that the live list has. The nine agents on the Claude program get the best Claude-named model (Fable 5.1 first), because the Claude program's own documentation says running non-Claude models through it is not supported. The Checker gets the best GPT-named model. The owner can change any pick in Settings, from the live list; a choice outside the ranking is marked "not ranked". Flash, lite and the provider's own models are never picked on their own.
- **One page for it.** The "Models" section of Settings: paste the key, Save, Test, Remove, the table of picks, and the switch. The Settings test asks each picked model a one-line question through the relay.

## What the provider can see

When the switch is on, everything an agent reads and writes in a task is sent to Omega Plus: the task, the files the agent opens, what it writes, and the answers. The Claude and Codex plans are no longer used for the agents while it is on. The warning is on the Settings page all the time.

## What cannot be checked

The provider's own documentation says a model's name "does not guarantee a particular upstream model". So the engine cannot know which model really answers under a name. Their documentation page also lists other names than the list their address serves. The engine therefore never assumes that a name exists. It reads the live list and picks from that, and Settings says in one sentence that the provider decides what answers under a name.

## Limits

The provider has usage limits. When one is reached, agents cannot work until it resets, and Settings says so. A refused key makes the Claude program retry for a few minutes before the run fails; the relay passes the provider's answer through untouched, and Settings shows that the key was refused in the meantime.

The provider's installer script (`omega-helper.sh`) is not needed and must not be run or downloaded.

## Consequences

- One more part to run, with its own line in `engine status` and Health.
- The nine Claude-program agents run on one family of models, and the Checker on a GPT-named one. The board's agent pages still say `sonnet` or `opus`; Settings shows the real pick.
- The board's own figures for the Claude and Codex plans do not apply in provider mode.
- Nothing is sent to the board when the switch changes. The wrappers and the relay read the state file on every run, so the next run of every agent uses the new mode.
- The fence in provider mode has a shorter outside list than in plans mode. The proof checks both modes, including that an agent cannot reach the provider, cannot read the key or the relay's secret, cannot call the relay with another agent's token or none, and cannot make the relay use another model.
- An agent can see its own relay token: both programs hand their environment to their shell tool (checked in the rehearsal). The token works only on this Mac, only at the relay, only for that agent's own picked model, and for six hours. An agent that wrote it into the shared folder would give another agent nothing it does not already have, except a different model for those hours. The provider key and the relay's secret are never inside the fence.
- The provider has never been switched on in this engine. Provider mode was tried only against a stand-in provider with a made-up key. Real use starts when the owner pastes a key.

## Rejected

- Adding the provider's host to the fence's list and giving agents the key: the key would be readable by agents, and so would everything it can spend.
- Putting the key in the agent login file or the board's settings: the same, and the board would need a restart on every change.
- Sending the picks to the board's agent settings: a second source of truth, a board write on every switch, and `engine setup` would have to know the mode.
- Moving the Checker to the Claude program: its checks would come from the same maker as the work it checks.
- Running the Claude program on GPT-named or other models: its documentation says that is not supported.
- Hard-coding the list of models: the provider's own pages disagree with each other.
- Letting the relay retry: no retry hides a refused key or a reached limit, and a loop would spend the limit faster.
