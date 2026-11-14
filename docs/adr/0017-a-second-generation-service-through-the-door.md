# 0017: A second paid generation service, Higgsfield, comes in through the same door

## Context

On 13 November 2026 the owner asked for Render to Film to use "runway + higgsfield mcp" (`0016`). Runway is already behind the generation door (`0014`). Higgsfield is a second paid service for pictures and clips, and the owner named its MCP server, not its developer interface, as the way in. He is signed in to Higgsfield with a plan of his own. Builders were allowed on 13 November to read his account read-only, to list its models and its balance. His plan is not in Higgsfield's public price list.

The same rules apply as for Runway. The change is the owner's to make. Every other rule stands: this Mac only, the fence is never loosened, and what runs unfenced never trusts what agents or apps can write (`0007`). Two things are new. Higgsfield asks the owner to sign in with a browser, so the engine holds a login and not a key. And the owner reads prices in Higgsfield credits, which are not Runway's.

## Decision

Higgsfield goes through the generation door, as a second service in the same table, off until the owner switches it on and signs in.

- **Through its MCP server.** The door talks to one address, `https://mcp.higgsfield.ai`, named in one file (`engine/generate/higgsfield.mjs`) and checked the way Runway's address is. It uses a small client of its own with no dependencies: it asks for a price, makes a job, and asks how the job is going. A stand-in on 127.0.0.1 is accepted only in tests. It never uses `use_unlim` or `use_free_gens`, and never the tools that show widgets, run presets or list the owner's history.
- **The owner signs in with his browser, and the door keeps the login.** Settings has "Sign in to Higgsfield". The door registers itself as a client, makes a one-time state and verifier, and gives the home server the address to open. The owner's browser goes to Higgsfield, signs in and comes back to the home screen, which passes the code straight to the door. The door finishes the sign-in. A return whose state is not the door's changes nothing; the right state is taken once, within ten minutes. The login is a file, `<state>/secrets/doors/higgsfield-oauth.json`, read and written by the door only, never shown, never in a log or an answer, and sent only to Higgsfield's address in one header. A refresh is done when under a minute remains, or once after a refusal; a refused refresh sets the file to "refused" and the door says so until the owner signs in again. "Sign out of Higgsfield" deletes the file.
- **One sign-in authority, chosen on purpose.** Higgsfield advertises two. One names another company's sign-in service; the other is the MCP host's own. The door uses the host's own, so the code, the verifier and both tokens never reach a second host, and there is one name to pin, not two. The paths are fixed in the code and no metadata is read at run time, so a changed document cannot move the sign-in. The cost: if Higgsfield ever refuses this client, Higgsfield stays off and Runway still works, until a planned change.
- **One table of models, one unit of money.** `engine/generate/registry.mjs` holds every model the door will pay for, Runway's and Higgsfield's, with its kinds, its pictures, its sizes, its seconds, its longest prompt and its price. Higgsfield's ids start `hf.`. **The unit is the US cent**, in the ledger, in the limits, in a batch and in an allowance. A Runway credit is one cent already, so no old line changes meaning. A Higgsfield credit is turned into cents at the owner's rate, rounded up to a whole cent, and the owner always reads dollars. The rate is a number in Settings, 1 to 50 cents, and starts at 5 ("Plus is about 5 cents a credit"). Changing it does not change what the owner already approved. Every line the door writes for Higgsfield also holds the credits and the rate it used.
- **Prices come from the table, never from an answer.** Approval cards, estimates and allowances need a price without the network, and a price must not move after the owner said yes. Before a Higgsfield job the door asks Higgsfield's price with the same arguments and `get_cost`. If the live price is higher than the table's, the door refuses with `gen_price_changed` and nothing is held. Otherwise it holds the table's price. A job is settled at the table's price, or at a higher cost Higgsfield states afterwards. A Higgsfield job that fails or is flagged counts as spent, unless Higgsfield says it cost nothing. A flagged job counts as a refusal and feeds the same three-a-day pause as Runway's.
- **Runway first.** When both services offer a model, the door uses Runway's developer service: exact prices, no sign-in, the path that was built and reviewed in step 3. Higgsfield has only what Runway does not: FLUX.2 Max, Wan 2.6 and a 4K upscale of a picture.
- **The same limits.** One daily cap, one monthly cap, one pause, one freeze of a film, and at most two jobs running for one caller and four in all. Higgsfield has no limit of its own and shares these. Both an agent's batch and an app's allowance work with either service.
- **The same checks on what comes back.** A result is fetched only from `https`, a public address looked up and pinned, no redirect, no header of ours, at most 200 MB a video and 30 MB a picture, the first bytes checked. A Higgsfield job is asked about every six seconds and given up after 20 minutes, still counted. At the door's start, each Higgsfield job left open is asked about once; with no clear answer, it counts as spent.

### What is sent

Anything the owner sends to Higgsfield, and anything it makes, can be used by Higgsfield to train its models. Its terms (as read by the builders on 13 November 2026, section 4.4) say so, and a deletion stops future training but not what was already done. It documents a way to exclude data from training only for its separate developer service, not for signing in the way the engine does. So Settings says, always, beside the switch: "Higgsfield's terms let it use what you send, and what it makes, to train its models unless you turn that off in your Higgsfield account. Do not send client work you may not share." The owner should not count on an opt-out. His rule: keep Higgsfield off for work that is not his to share. The switch is off by default, and while it is off nothing is sent to Higgsfield.

What goes: the pictures an agent or an app prepared from the owner's own renders or pictures, the prompts (at most 4,000 characters for a Higgsfield model) and the choices that go with them.

### What is not possible yet

These are said plainly. None is hidden.

- **A Higgsfield job that starts from a picture cannot run.** The door sends a picture only to an upload address it has been told to trust, and Higgsfield names that address when it answers, which the door cannot know in advance. The list of trusted upload hosts, `HF_UPLOAD_SUFFIXES` in the registry, is empty on purpose. Every Higgsfield upload is refused, and the door says so: "The door does not know Higgsfield's upload address yet, so no picture can go to Higgsfield. Nothing was spent." This holds FLUX.2 Max and Wan 2.6, which need a picture. It is settled at the first real sign-in, by the orchestrator and the owner together; the door never guesses a host. Runway jobs are not affected.
- **Two Higgsfield models have no price.** Wan 2.6 and the 4K upscale of a picture were not given a price by anything the builders could read, so the table holds none and the door refuses to make anything with them (`gen_no_price`). FLUX.2 Max is priced at 4 credits a picture, from Higgsfield's own pricing explainer, and has not been checked with a signed-in price. The live price is only a guard until then. Two of Runway's GPT Image variants have no price in the table either.
- **Aleph and clip upscale are left out.** Aleph, Runway's AI grade and edit of a clip, needs a video sent to Runway, which the door cannot do (it has no upload address it can pin). Higgsfield gives no price before a video upscale. Render to Film's built-in look stays. Each is a ticket.
- **Nothing is confirmed against the real Higgsfield.** The first contact is the owner's own "Test" in Settings (it asks only for the credit balance, costs nothing, and works while the switch is off), and his first real job. The door reads Higgsfield's answers tolerantly: a missing or odd field never crashes it, and a doubt means nothing is spent. The first real answer that differs from a guess shows up as `gen_could_not_start` with Higgsfield's own words, and a fix.

## Consequences

- No new part. The generation door grows: new files `registry.mjs`, `higgsfield.mjs`, `mcp.mjs` and `oauth.mjs`, new owner routes for sign-in, forgetting and balance, and the app routes of `0016`.
- Nothing of this is live yet. It is built and tested against a stand-in Higgsfield, never the real one. With Higgsfield off, every run is exactly as before. At go-live one line changes: the owner switches Higgsfield on and signs in.
- The ledger gains `provider`, `units`, `rate` and `app` on the lines that need them. A line with a field of the wrong kind is unreadable, and the door still fails closed.
- Higgsfield's sign-in can fail. If Higgsfield refuses a sign-in from a loopback address or a refresh from this client, Higgsfield stays off, Settings says "The Higgsfield sign-in did not finish. Try again.", and Runway's presets work. A further sign-in grant that Higgsfield advertises would then be one door task and one Settings task.
- After a sign-out the switch can stay on, and Settings then says "On, but not signed in." Nothing is sent.
- Settings does not say that picture jobs are held. Only the door's own refusal does.
- Higgsfield may differ from the table. A live price above the table's refuses the job; a live price below it is not used, so a cheaper job is held at the higher price and settled at the table's price.

## Rejected

- **Higgsfield's developer interface (REST) with a key.** The owner's words name the MCP server, and that interface lacks the upscale and editing tools. Its training opt-out does not reach the way the engine signs in.
- **The home server holding the tokens.** It would make two writers of one file. The home server only passes the owner's browser along.
- **Live prices as the price.** A price must not move after the owner said yes, and a card needs a price without the network.
- **Caps for each service, or Higgsfield credits as a second unit.** One set of limits is what the owner asked for, and one unit keeps the ledger honest.
- **Runway's own MCP server.** It adds nothing a key does not.
- **Guessing Higgsfield's upload host.** An address chosen without seeing the answer could send the owner's pictures anywhere.
- **Following Higgsfield's other sign-in service.** It would put a second company's host on the path of the owner's login.
