# 0018: The company brain can be searched, and only the owner still writes it

## Context

On 18 November 2026 the owner shared a video about giving a company's AI a better memory. It made four points: reading every file into the prompt is slow and noisy; a search should find the few passages that matter, not whole files; facts are tied together (a customer, its invoices, its promises), so a search should follow those ties; and the answer should name where each fact came from, and say what was not found.

The company brain until now was a folder of the owner's files (`0008`). Every ordinary agent was told to read what fitted, and the fence let it read the whole folder. That works while the folder is small. It does not say which file holds the answer, it cannot say what is missing, and it knows nothing of the books: no agent but the Bookkeeper could see a customer's invoices or unpaid amount.

The same rules apply as before. This Mac only, the fence is never loosened, what runs unfenced never trusts what agents or apps can write (`0007`), and agent text never reaches the brain (`0008`).

What is built is on the branch `build/v5-brain`. **Nothing of this is live.** The brain door's switch is off by default, the door has no `READY` file, and while the switch is off every run is exactly as before.

## Decision

Agents may ask the brain questions through a door of their own. The brain is not changed by this, and the owner is still the only one who writes it.

### The index

- **One index file, rebuilt whole, published by rename.** The home server cuts every brain file into passages (a section of a text file at most 900 characters; a table in groups of 20 rows) and builds `<state>/brain/index.sqlite` from scratch into a temp file in the same folder, then renames it into place. There is no incremental update. Readers open it read-only. The old search (`GET /api/brain/search` and the search source `brain`) is untouched, and so is the store's own small index.
- **Records from the books come in under a trust rule.** Customers, submitted invoices, deals, projects, tickets, contacts and active staff are added as one short passage each. A record is named and linked only when both its creator and its last editor are the owner's own books login, `Administrator`, or (for an invoice) the owner submitted it. Anything else gives numbers, dates and a status from a fixed list, or is left out and counted. No free-text field is ever asked for, no email address, no ticket subject, no draft, no cancelled document. Every string from the books is cut to one line of at most 80 characters, and refused if it holds `<`, `>`, a backtick or a line break. Reason: the Bookkeeper can create customers, the Sales agent creates every lead and deal, and a ticket's subject is written by an outsider. Words like that, put in front of every agent, would be a new way for one agent or one stranger to speak to all the others.
- **Typed links.** An invoice, deal, project or ticket links to its customer, and a contact to its customer. A file passage links to a name it mentions (whole words, any letter case). Search follows a link one hop, and two hops through a customer.

### Asking

- **Six steps, no model in the server.** Rewrite the question (clean the words, drop stop words, spot known names); run two keyword searches, strict and loose, plus a name search; fuse the lists by reciprocal rank fusion; walk links; rerank by fixed rules, at most two passages from one source; and the asking agent writes the cited answer. The server supplies the "not found" words: each word of the question that appears nowhere.
- **No meaning search without a model.** Without a model on this Mac, the search matches words, word stems, a last-word prefix and known names. When the first try finds little, the agent asks again in other words. The model is the rewriter. A local model for meaning search would need a download of a few hundred MB, and the owner chose to decide that after two weeks of word search.
- **Nothing a caller types is search syntax.** Every term goes in quoted, SQL is only prepared statements with bound values, and the index is opened read-only.

### The door

- **A fourth door, `engine/brain/door.mjs`, on `127.0.0.1:3190`.** Built on the pattern of the web, generation and viewer doors: a token minted outside the fence for each run, a switch that is off by default, a status file, a part script and a line in Health. Ports 3171 to 3189 belong to App Studio's apps, so the brain door takes 3190. It answers two things: `POST /brain/ask` (a question) and `POST /brain/notes` (the notes for a task). It refuses in a fixed order, all with plain sentences, and keeps a log of what was asked (`brain-asks.jsonl`, the first 200 characters of a question, never a token, a header or an answer).
- **Who may ask.** The eleven ordinary agents, by name in `config.json`: Chief of staff, Builder, Checker, Bookkeeper, Sales, Support, People, Marketer, Drafter, Artist and Art director. Each already reads the whole brain, so the door gives them no file they could not read. What is new for seven of them is books facts, bounded by the trust rule. The owner said yes to this on 18 November 2026, except that the Artist and the Art director do not need books facts. At most 120 questions an hour and 600 a day for one agent.
- **The Researcher is refused in three places.** It is the one walled agent and it may leave through the web door, so whatever it reads can leave. The company file check refuses a walled agent on the brain door's list. The fence planner refuses a walled plan that holds the brain door's port. The door's own code refuses it by name whatever the list says. Apps are refused too.
- **The fence changes in one place only.** Its inputs know the brain door's port. `fence.policyPortsAllowed` and `fence.readRootsAllowed` are not changed. A door's port is added to a run's lists for a listed agent and only while the owner's switch is on, as for the other doors. With the switch off, the plan is identical to before.

### Notes for each task

- **Brain notes** are built, when the switch is on, after the board has taken a task the home server made. The question is the task's title and the owner's own words for it, never the job's full agent prompt and never anything read back from the board. The result is a file `<state>/brain/notes/<task id>.json`, served only by the brain door.
- **Notes are never in a task's text or a comment.** The Researcher reads its task's parents through the narrow gate. Anything pasted into a goal's text could reach it and leave through the web door. So the notes are a file the door serves, and an agent asks for them with its own token.
- Building notes never fails or slows a task. Notes older than 30 days go, and above 2,000 files the oldest.

### Tidy-ups

- **Three fixed rules and no model run.** The home server finds, in the owner's own files, two files that say the same thing, two files that give different figures for the same label, and a date that has passed. Each shows in Needs you with the two passages side by side, an "Open the file" button and "Not a problem".
- **The Chief of staff may also suggest one.** The owner chose this on 18 November 2026. It is off until the owner switches it on. A suggestion is a quoted note of at most 600 characters, labelled "Note written by an agent", and kept in the home server's own decisions, never in the brain or the index.
- **No press ever writes an agent's words into the brain.** The owner opens the file and changes it by hand.

### Going live

Not part of this decision. It is a separate step: the review read by the owner, a merge, `engine setup`, a restart, the proof on the live engine with new checks, and then the owner's own press on the switch.

## Consequences

- With the switch off nothing changes. No notes are built, no agent gets `UUU_BRAIN_URL`, and the role text falls back to today's "look in the knowledge folder". No index is built and the books are not read for it either: the Brain page in Files and its routes say "The brain is off. Switch it on in Settings.", and Needs you has no tidy-ups. The one exception is the owner's own Test question in Settings, which may build the index when he presses it.
- Agents can still read the whole brain folder. With the switch on they are told to start from the notes and to open a whole file only when a passage names it, but the fence still allows every file. Taking the folder away would tighten the fence and make the door a hard dependency. The owner chose not to do that yet.
- There is no meaning search without a model. Until then an agent may have to try other words, and the "not found" list says plainly what the brain did not have.
- Books facts now reach seven agents that had none: customer names, invoice totals and unpaid amounts, deal stages, staff names and job titles. The trust rule bounds it: only what the owner's own login made or approved is named, and no free text from anyone else is shown.
- The index is a cache. It can be deleted, and the next build makes it again from the files and the books. A half-written index is never seen, because publishing is a rename.
- Tidy-ups cost no model run. The Chief of staff's suggestions are the one case that does, and they are off until the owner turns them on.
- The security review (T18) found four things, all closed in T19, each with a test that fails on the code before it:
  - An agent could change a customer's or a staff member's name, and a later save by the owner made the record look like the owner's again. Now the books' change history (the Version records) is read too, and a record anyone but `Administrator` ever wrote a version of is left out and counted. When the history cannot be read, no customer, project, contact or staff record is trusted. This rests on the books keeping a history for those doctypes; the first live proof should check that an agent's change to a customer leaves a Version.
  - An agent could flood the door with bad requests that were never counted, and each refusal was a line in the log of what was asked, so real questions were pushed out. Now every call of an agent counts before its body is read, and while an agent is over its limit the log gets at most one line from it an hour.
  - A record's id went into the index unchecked. Now a project's and a staff member's id must be a naming series, a contact's id must be built from its own name and its company, and a customer's id must be its own name or a naming series; any other record is left out and counted.
  - The index and the tidy-ups ran with every switch off. Now they wait for the brain switch, as said above.
- A new listener runs unfenced. It opens only its secret, the list of agent ids, the switches file, the index (read-only) and the notes folder (no-follow), and it writes only its status file and its log. That path from the books to every agent is the thing the security review of this step is set to examine.

## Rejected

- **Putting meaning search in now (D2).** A local embedding model is a download of a few hundred MB, for a gain nobody has measured here. The two weeks of word search will show what agents ask and what is not found.
- **Extending the store's own index (D1).** It is keyed one row per file and its tests pin its shape. A second file with passages, records and links is simpler. A database shared by two processes in WAL mode was rejected as well: the door would need write access to the side files.
- **A route on the gate, or a second listener in the home server, instead of a door (D4).** The gate is the way to the board and nothing else. The home server holds the books key and acts as the owner, so a listener there would carry that power. The door process holds only a read-only file. A new read folder in the fence was rejected too: a file cannot be asked a question, and it would change every policy.
- **Putting the notes in the task's text (D8's alternative for notes).** It would put brain text where the Researcher can read it.
- **Letting the owner's press write an agent's suggestion into the brain (D8).** `0008` says agent text must never reach the brain, and a button does not change who wrote the sentence. Every agent would read it the next day. The suggestion is shown as a quote, and the owner edits the file himself.
- **Letting an agent tidy the files itself.** It would be the same thing without the button.
- **Taking the whole folder away from agents now.** See Consequences. It is a later decision, after the door has been on for a while.
