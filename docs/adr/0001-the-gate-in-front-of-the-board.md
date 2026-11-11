# 0001: The gate in front of the board

## Context

The board (paperclip) treats a request with no login as the owner, with full rights. An agent has to reach the board to do its job, so an agent could drop its own login and act as the owner. We found this while proving the fence (phase 1 ticket 13).

We then found that the board's own grants cannot save us. The owner cannot remove or replace an agent's grants over the board's interface. Every agent holds the default grants: configure agents, create skills, manage tool connections and more. Tool connections cover email and chat, which the board would use for the agent.

## Decision

Agents never reach the board directly. The fence closes the board's port, so the only way is the gate, a small server we wrote (`engine/gate/`).

- A request with no agent token is turned away. A live connection with no token is closed.
- Every request that changes something is refused unless it is on a short list of what the work routine needs: 13 rows taken from the board's own skill for agents (create a task, update it, comment, check it out, release it, documents, ask for an approval, and the like).
- The gate reads the request body too. A task change may not carry launch settings, workspace choices or a project. An approval of type "hire an agent" is refused. Both would have been a way out of the fence.
- Tool endpoints are refused.
- Every refusal has a rule name and a line in the refusal log, with no token and no content.
- The owner keeps using the board and the home screen with no sign-in.

## Consequences

- The default grants stay on the board and do nothing, because the gate blocks what they would allow. The company file does not pretend to trim them.
- The list must be kept right. When the board is updated, a new way to change something is refused by default, so work may stop with a refusal in the log. Someone must read the log and decide whether to add a row. This is the standing cost.
- Other programs on this Mac can still reach the board as the owner. The gate closes the gap for agents only.
- The proof (`engine prove`) tries each refusal with a real agent test key.

## Rejected

- Switching the board to its own sign-in mode (ticket 13, option 1). It would also cover other programs on this Mac, but it does not remove the default grants. It stays an option for the owner.
- Relying on the board's grants. They cannot be removed.
- Allowing everything except a refusal list. A change nobody thought of would pass.
