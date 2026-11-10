# Who counts as the owner on the board

Label: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 12

## Question

In paperclip's default local mode, any request that carries no login counts as the owner, with full rights. A fenced agent has to reach the board to do its job, so it can drop its own login and act as the owner, and an owner can create an agent that runs any command outside the fence. How is that closed?

## What is known

- Found on 11 November 2026 while proving the fence: from inside it, a request with no login lists the companies, the agents and the secrets.
- Read in paperclip's code (`server/dist/middleware/auth.js`, version 2026.1106.0): in `local_trusted` mode a request without a token is the board, as instance admin.
- When a request carries an agent's token, paperclip refuses agents the dangerous changes itself: `command`, `cwd`, `env`, `args`, and the `process` adapter. So only the missing login is the gap.
- The proof script shows it as the one failing line per tool: "could act as you on the paperclip board".

## Options

1. **Paperclip's own login mode (recommended).** Switch the server to `authenticated`. The owner signs in to the board in the browser; a request with no login is nobody. Paperclip has a one-time claim link that hands the existing company to the signed-in owner, and sign-up is switched off afterwards. Cost: the owner creates a board login once and signs in again when the session ends; the command-line tool needs its own approval once. Nothing custom to maintain, and it also covers every other program on this Mac.
2. **A small gate in front of the board.** Keep the no-login mode for the owner. Agents reach the board only through a gate that refuses requests without a token. Cost: custom security code to keep correct across paperclip updates. No login for the owner.

Either way the proof's failing line must turn to PASS before agents do real work.
