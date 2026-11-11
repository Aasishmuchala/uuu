# The company engine: owner's guide

The engine runs your company with a small team of AI agents and you. It runs on this Mac only. Nothing leaves the building: no email, message or post is sent by anything, and publishing and sending are switched off.

It has five parts: the board (where tasks are kept), the fence around every agent, the gate between the agents and the board, one set of company records (books, customers, support, people) and your home screen. The team has ten roles: Chief of staff, Builder, Checker, Bookkeeper, Sales, Support, People, Marketer, Drafter and Artist. Words in bold in `GLOSSARY.md` mean what they say there.

## Switch it on and off

One command, `engine/bin/engine`, with these words after it:

- `start`: turns everything on, in order, and stops at the first part that fails. It says where to look. Running it twice starts nothing new. It ends with `Open http://127.0.0.1:3200`.
- `stop`: turns everything off and leaves no agent running. Nothing starts by itself when the Mac starts.
- `status`: one line per part: `on`, `off`, `unhealthy` or `not installed`, and what to do next. A good result ends with `Everything is on.`
- `prove`: checks that the fence holds. A good result ends with `holds`. At the last run it passed 101 checks with 0 failures. One note remains: the Checker (Codex) still uses your own Codex login through a link (see "Two steps only you can do").
- `setup`: makes the board match the company files. Safe to run again.
- `test`: runs every test. A good result ends with `All tests passed.`

## Open the home screen

Go to http://127.0.0.1:3200 in your browser. It works only on this Mac. If the engine is off, the page does not load; run `engine start`.

Press Cmd+K anywhere to jump to a page, an agent or a search result.

## Give a task

At the bottom of Home there is one box. Say what you want done, in your own words, then press Enter.

- **Plain.** Type it and send. The Chief of staff sizes it, hands it out, and the Checker looks at the result before it reaches you.
- **Plan first.** Tick "Plan first". The Chief of staff writes a short brief and a plan, then waits. Nothing is done until you accept the plan. Use it for anything big or costly.
- **To one agent.** Type `@` and pick the agent. The task goes to that agent, and the Checker still checks it.
- **From a ready-made goal.** Type `/` and pick one. It opens as a draft you can change, with blanks to fill.

An agent's own page (under Team) has a conversation where you can give it a task too.

## Needs you

Everything waiting for you shows on Home as cards, one main button each. You can also see them under Tasks.

- **Accept.** The work is good. A finished task waits under "Pending review" until you accept it. A draft becomes final only when you accept it.
- **Send back.** The work is not right. Write a note. The task reopens and the agent does it again.
- **Answer a question.** If a brief or plan has something unclear, work stops and the question shows here. Type the answer. Work carries on.
- **Accept a plan.** For a plan-first task, read the plan, then Accept, or Send back with a note to change it.

Press Esc on a card to close it without doing anything.

## The acceptance view

Open a task from Tasks. At the top you see who did it, how many checks it took, and one large Accept button when it is waiting. Below are the Checker's numbered checks, each pass or fail with its reason. There is a tab per round. Then the timeline of steps, the documents in order (brief, plan, summary, check), the conversation, and the files. After five failed checks the task stops and asks you.

## Routines

A routine is standing work on a schedule. Two exist:

- **Daily brief**: every morning at 09:00, a short note of what happened that needs no decision.
- **Weekly content plan**: Mondays at 10:00, drafts of three posts and a newsletter. Nothing is published.

Both start switched off. Until the daily brief is switched on, Home shows a brief the home screen puts together itself. To switch one on, open Routines and use its switch. Each run costs one run of that agent on your plan. You can also use Run now, or pause it again. Agents cannot create, change or start a routine.

## The pages

- **Home**: what needs you, what is running, the daily brief, and the box to give a task.
- **Tasks**: every task, as a board or a list. A task's page is the acceptance view.
- **Docs**: company documents. Add one, read it, search it, and see what agents learned.
- **Team**: the ten agents. Each page says what that agent may and may not do, what it is doing, its lessons, and lets you pause it or give it a task.
- **Books, Customers, Support, People**: figures first, then drafts waiting for you.
- **Marketing**: content drafts by week. Publishing is off.
- **Studio**: parts and pictures the Drafter and the Artist made.
- **Routines**: standing work, its runs and its switch.
- **Ready-made goals**: tasks written in advance for each department.
- **Health**: what is on, whether the fence holds, what is not connected. You can run the proof from here.
- **Settings**: theme and accent, and the later options with what each would cost.
- **Search**: finds tasks, documents, records, agents, routines and ready-made goals.

## The Studio

The Drafter designs parts. For each it gives a STEP file and a note with the measured size and volume. The Artist makes sprites, small animations and simple vector images by script. A sprite comes as a sheet, a data file, an animated GIF and a small manifest. The Studio plays a sprite frame by frame, with zoom, its named animations and its colours. The home server checks from the files that the frames match the animations. A vector image cannot run a script when shown.

## What is switched off

Each is an off switch or an account step. Nothing is done for you.

- **Publishing and sending.** No post, email or message can go out. To turn it on, connect the account first; each page says "Connect an account to turn this on."
- **WhatsApp and the GST portal.** Off in the same way.
- **India Compliance's paid features.** Off.
- **PDF printing of invoices.** Off until there is more disk.
- **Routines.** Off until you switch them on.

## Two steps only you can do

- **The Checker's own Codex login.** Run `engine/fence/login-wizard.sh codex` and follow the steps. Until then the Checker uses your own Codex login through a link, and the proof shows one note. `engine/fence/login-wizard.sh --status` shows where each login stands. The Claude agents' login is `engine/fence/login-wizard.sh`.
- **Connecting accounts.** Before anything can be published or sent, you connect the account it goes through.

Also optional: the board can be switched to its own sign-in. Today, other programs on this Mac can still reach the board and the home screen as you. The gate closes this gap for agents only.

## What would turn this on later

None of these is built or running. Each is a choice for later. Settings lists them as off.

**Other chat apps as extra windows.** LobeHub, Open WebUI, Cherry Studio or Jan could talk to the company through an address that looks like OpenAI's. It would turn on if you want to chat with the team from one of those apps. The home server would need that address added.

**A separate workflow engine.** Kestra could run long scheduled workflows. It would turn on if routines stop being enough. It needs about 4 GB of memory while it runs.

**A free helper model on this Mac.** Ollama is already installed. A small model could do small jobs without using your plans. It would turn on if you have the disk. Expect about 5 GB of disk and 4 GB of memory while it runs.

**Editing sprites in place.** Piskel, a free pixel-art editor, could be served from the home screen so you can touch up a sprite by hand. It would turn on if you want to edit by hand rather than ask the Artist again. It is a small download.

**Previewing Aseprite files.** The Studio could show files from Aseprite if you buy or compile your own copy for personal use. Its licence does not let the engine ship or run it, so the engine will never install it. Ask for the preview once you have it.

## Where things live

- The engine's state: `~/.paperclip/uuu-engine/`. It holds the company records (`books/`), agents' task folders (`tasks/`), lessons (`lessons/`), company documents (`knowledge/docs/`), the Drafter's and Artist's tools (`cad/`, `art/`) and the last proof (`proof/last.json`).
- Logs: `~/.paperclip/uuu-engine/logs/`. One file per part, plus `gate-refusals.log`, which lists what the gate turned away.
- Secrets: `~/.paperclip/uuu-engine/secrets/`, and the agents' login in `agent.env` beside it. Only you can read them. They are never in the repository and are never shown here.
- The company's files (agents, instructions, routines, ready-made goals): `engine/company/`.
- Decisions and why: `docs/adr/`.

## What to do when a part says `unhealthy`

1. Run `engine status` and read the sentence next to it.
2. Look at that part's log in `~/.paperclip/uuu-engine/logs/`.
3. Run `engine stop`, then `engine start`.
4. If it still fails, the log line it ends on is what to hand to whoever helps you.

If the fence proof fails, do not give agents work. Run `engine stop` and ask for help.

## Remove everything

1. `engine/bin/engine stop`.
2. Remove the company records as in `engine/books/README.md` ("Remove all of it").
3. Delete `~/.paperclip/uuu-engine/`. The board keeps its own data at `~/.paperclip/instances/default`; delete that too only if nothing else of yours uses it.
4. Delete the repository folder if you no longer want the files.

Your own Codex login and your own files are never touched by the engine.

## What the live trials showed

(filled in by the orchestrator after the trials)
