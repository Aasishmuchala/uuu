# 0021: Runway by sign-in, through the same generation door

## Context

On 18 November 2026 the owner asked for a Runway door that signs in to his Runway account through Runway's MCP server, the way Higgsfield does, with the same switch, the same daily and monthly limits, and a security review. He wants to use the account and the credits he already has, with no developer key. The key stays as the other way in.

`0017` rejected Runway's own MCP server ("It adds nothing a key does not."). That is replaced. It was true while the only question was how to pay. The owner has now said how he wants to pay, and a key does not use his account's credits.

Every other rule stands: this Mac only, the fence is never loosened, and what runs unfenced never trusts what agents or apps can write (`0007`). Money and safety sentences are shown whole (`0016`).

What was found out, and how. On 18 November 2026 the orchestrator made one read-only visit to `https://mcp.runwayml.com`, with the owner signing in by hand in his own browser. Nothing was made, uploaded or spent. The sign-in file was deleted straight after. The notes are in `.router/RUNWAY-MCP-FACTS.md`.

- Runway's sign-in is open to a program on this Mac. It offers registration of a client, a code exchange with PKCE (S256), no client secret, and it accepted a return to `http://127.0.0.1:3200`. Its sign-in page names the client as "uuu engine on this Mac" and marks it "Unverified MCP client".
- A sign-in lasts about 30 days and comes with a refresh token.
- The server has 47 tools. None of them lists a price.
- Runway publishes no way to cancel a sign-in from the program's side.

## Decision

The generation door grows a second way in to Runway, as it grew Higgsfield in `0017`. It is off until the owner switches Generation on, and it spends nothing until he approves a cost.

- **One origin, fixed.** The door talks to one address for this, `https://mcp.runwayml.com`, named in one file. Its sign-in paths (`/register`, `/authorize`, `/token`) and its tool names are fixed in the code. No metadata is read at run time, so a changed document cannot move the sign-in. Sign-in and tokens use that one host and no other. A stand-in on 127.0.0.1 is accepted only in tests.
- **The owner signs in himself.** Settings has "Sign in to Runway". The door registers itself as "uuu engine on this Mac", makes a one-time state and verifier, and gives the home server the address to open. His browser goes to Runway, he signs in and says yes, and it comes back to the home screen, which passes the code straight to the door. The code lives only a few minutes, so the door finishes the sign-in at once. A return whose state is not the door's changes nothing; the right state is taken once, within ten minutes.
- **The login is a file the door alone reads.** It is `<state>/secrets/doors/runway-oauth.json`, written and read by the door only, never shown, never in a log, an answer or an error, and sent only to Runway's one address. The home server never opens it. Agents and apps cannot reach it: the fence already hides `secrets/`, and a test proves it for this file. A refresh is done when under a minute remains, or once after a refusal. A refused refresh marks the file "refused", and the door says so until the owner signs in again.
- **The same switch.** There is no third switch. "Let the Artist use Runway" covers Runway by key and by sign-in, and may now be switched on with a saved key or a sign-in. Higgsfield has a switch of its own because it is another company with other terms. Runway is the same company either way.
- **The same limits.** One daily limit, one monthly limit, one pause, the same ledger, at most two jobs running for one caller and four in all. A batch and an allowance work with either way in.
- **The key first.** With a key saved, the door uses Runway's developer service exactly as before, with exact prices and the path that was built and reviewed. It uses the sign-in only when no key is saved and the door is signed in. A caller, an agent or an app never chooses. Every run that works today is unchanged.
- **One unit of money, and a rate.** The unit stays the US cent. A Runway account credit is not a developer credit, so Settings has "One Runway account credit counts as (cents)", a whole number from 1 to 50. It starts at 3. Runway's public plans work out between about 1 and 2.5 cents a credit, so 3 is on the safe side: a job is held at more than it costs, never less. A credit price is turned into cents at the rate, rounded up to a whole cent, and the owner always reads dollars. Changing the rate does not change what he already approved. Every ledger line for this way in also holds the credits and the rate it used.
- **There is no price table. Each model has a ceiling, and Runway's own quote is checked against it.** No tool tells the price of a model ahead of time, and the price depends on the model, the size and the settings. So each model the sign-in may use has a ceiling in account credits, the door's own figure, about twice the developer price of the same model. It is the most the door will hold for one job, never a price. The door holds the ceiling before it asks Runway anything, so every limit, batch and allowance is checked at the ceiling. Runway answers a request that has not been approved with `cost_confirmation_required` and a quote. The door reads a quote only when it is plain: one approval string and one credit count, a whole number of at least 1, under a name that says credits. A quote of 0, a part of a credit, or a number under a name with no unit (`price`, `cost`, `amount`) is no quote, and nothing is agreed or spent. A quote above the ceiling is refused. The door turns the quote into cents at the rate, checks it again against the daily limit, the monthly limit, the batch or the allowance, and only then agrees by sending the request again with Runway's `costApproval` string.
- **A job counts at its ceiling until a real quote confirms the reader.** No real quote has been seen yet, so the door does not trust its reading of one to lower the cost. A job is settled at its ceiling, and the quote is noted beside it in the ledger, so the first real jobs show whether the reading is right. A higher cost Runway states later still raises the charge. A job that fails or is refused counts as spent unless Runway says it cost nothing.
- **A job that starts before a quote is never agreed to.** The door agrees to nothing unless the first answer is a quote. If Runway starts a job anyway, the door counts it at its ceiling and pauses Generation until the owner presses Start again. When Runway names the job, the door still follows it to the end, so a higher cost Runway states reaches the ledger and what it made is kept. See "What is not known yet".
- **An identical request is not charged twice.** Runway returns the earlier task for an identical request within 10 minutes instead of charging again, unless the request says to repeat.
- **The same checks on what comes back.** A result is fetched only from `https`, a public address looked up and pinned, no redirect, none of our headers, size caps, the first bytes checked. A job that fails or is flagged counts as spent unless Runway says it cost nothing. A job left open when the door starts is asked about once and counts as spent without a clear answer.
- **Pictures go in only to a host on a pinned list.** The list is empty until the upload host is learned from a real upload. Until then a job that starts from a picture is refused when it goes by sign-in.

### What is sent

The prompts, and the pictures an agent or an app prepared from the owner's own renders or pictures, go to Runway, as with the key. What he makes is saved in his Runway library and spends his Runway account's credits. Settings says, always, beside the sign-in: "What you make this way is saved in your Runway library and spends your Runway account's credits." It also keeps the terms sentence, whole: "Runway's terms say it may use what you send to train its models unless you have an Enterprise agreement. Do not use Generation for client work you may not share." Settings also says which way is in use. With a key: "Your Runway key is used. The sign-in is the other way in, used when no key is saved." With a sign-in and no key: "Your Runway account is used. Prices are in your account's credits, turned into dollars at the rate below."

### Signing out

"Sign out of Runway" deletes only the local sign-in file. Runway publishes no way to cancel a sign-in from this side, so the grant stays valid on Runway's side until it runs out, about 30 days, or until the owner removes "uuu engine on this Mac" in his Runway account. The engine cannot do that for him. The guide says so.

### What is not known yet

These are said plainly. None is hidden.

- **Whether every request that has not been approved returns a quote.** It was not tested, because testing it could spend. A request that starts at once and charges at once would bypass the owner's agreement, though not his limits, since the ceiling is held first. Until this is proven, the door treats it as unsafe: it agrees to nothing unless the first answer is a quote, and a job that starts anyway pauses Generation. The security review must check this, and the first real job is the real test. If Runway charged such a job more than its ceiling and never said so, the ledger would hold less than was spent. The pause limits that to one job.
- **What anything costs, in credits, ahead of time.** Nothing publishes it. The quote comes only when a job is asked for, after the owner's approval, so the approval card cannot show it. By the sign-in, the approval card, a batch's budget, a still job's Start and an app's estimate all show the model's ceiling in dollars at the owner's rate, as "up to": the most the job may cost, never a price. The batch the owner approves is that amount, the same one the door holds.
- **Which host takes an uploaded picture, and which hosts serve results.** Neither is named in Runway's tool text. The upload host is learned on the first real upload and then pinned, as was done for Higgsfield.
- **How many credits are left.** The balance check returned the plan name and a billing link, not a number. Settings may say so instead of a figure.
- **Nothing here is confirmed against a real job.** The first contact with a real job is the owner's own, after he signs in and switches Generation on.

## Consequences

- No new part. The generation door gets a second client file, a second sign-in built from the same code as Higgsfield's, and four owner routes (begin, finish, forget, balance). The door's status file gains a `runway` object that holds only whether it is signed in and whether it was refused.
- Settings has "Sign in to Runway", "Sign out of Runway", "Test" and the rate field. "Test" asks only for the balance, costs nothing and works while the switch is off. Setup shows "Sign in to Runway"; it does none of these for the owner.
- With Generation off, the Artist sends nothing to Runway by either way. An app with an open allowance still may, by the key or by the sign-in, as with the key under `0016`: app jobs need the app on, an open allowance, the service ready and the limits, not the Artist's switch.
- The sign-in expires after about 30 days. Settings then says "Runway asked you to sign in again." and the owner presses the button.
- Runway shows the sign-in page as "Unverified MCP client". That is true and is left as it is.
- If Runway ever refuses this client, the key still works.

## Rejected

- **A switch of its own for the sign-in, as Higgsfield has.** The owner asked for the same switch, and one company with one set of terms needs one.
- **Preferring the sign-in over the key.** It would change runs that work today, and a model would have two prices.
- **Letting an agent or an app choose the way in.** Two prices for one model.
- **A table of prices for the sign-in.** Nothing true to fill it with. A made-up price could be lower than the real one.
- **Runway's Dev MCP server.** By Runway's own words it does not make media, create keys or create projects.
- **The archived open-source Runway MCP server.** It takes the API key, and it has no sign-in, so it does not use the owner's account credits.
- **Reading Runway's sign-in metadata at run time.** A changed document could move the sign-in to another host.
