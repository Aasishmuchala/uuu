# The company engine: owner's guide

The engine runs your company with a small team of AI agents and you. It runs on this Mac only. Nothing leaves the building: no email, message or post is sent by anything, and publishing and sending are switched off.

It has five parts: the board (where tasks are kept), the fence around every agent, the gate between the agents and the board, one set of company records (books, customers, support, people), the company brain (your own files that every agent reads) and your home screen. The team has ten roles: Chief of staff, Builder, Checker, Bookkeeper, Sales, Support, People, Marketer, Drafter and Artist. Words in bold in `GLOSSARY.md` mean what they say there.

## Switch it on and off

One command, `engine/bin/engine`, with these words after it:

- `start`: turns everything on, in order, and stops at the first part that fails. It says where to look. Running it twice starts nothing new. It ends with `Open http://127.0.0.1:3200`.
- `stop`: turns everything off and leaves no agent running. Nothing starts by itself when the Mac starts.
- `status`: one line per part: `on`, `off`, `unhealthy` or `not installed`, and what to do next. A good result ends with `Everything is on.`
- `prove`: checks that the fence holds. A good result ends with `holds`. At the last run it passed 112 checks with 0 failures. One note remains: the Checker (Codex) still uses your own Codex login through a link (see "Steps only you can do"). Since 11 November it also checks that the board's git never runs a program an agent planted in its task folder, that an agent cannot widen its own fence with a planted link, and that one agent cannot touch another agent's Claude Code home.
- `setup`: makes the board match the company files. Safe to run again.
- `test`: runs every test. A good result ends with `All tests passed.`

## Open the home screen

Go to http://127.0.0.1:3200 in your browser. It works only on this Mac. If the engine is off, the page does not load; run `engine start`.

What you see:

- **In the middle at the top:** four sections: Map, Tasks, Dashboards and Files.
- **At the right:** Needs you, with a count. It opens as a drawer from any page. Beside it are Jobs and Routines as words, and Health, Settings and the light and dark switch as small icons.
- **Down the left:** a dock of small pixel creatures, one for each department and one for the brain. Click one to see that department.
- **On a phone-sized window:** the four sections become a bar at the bottom, and the map becomes a small crown over a plain list.

Press Cmd+K anywhere to jump to a page, an agent or a search result. Press `c` for a new task.

## Give a task

On the Map there is one box. Say what you want done, in your own words, then press Enter.

- **Plain.** Type it and send. The Chief of staff sizes it, hands it out, and the Checker looks at the result before it reaches you.
- **Plan first.** Tick "Plan first". The Chief of staff writes a short brief and a plan, then waits. Nothing is done until you accept the plan. Use it for anything big or costly.
- **To one agent.** Type `@` and pick the agent. The task goes to that agent, and the Checker still checks it.
- **From a job.** Type `/` and pick one, or open Jobs. It opens with blanks to fill.
- **A question.** If you ask something about the company, the box answers from your files. See "Ask the brain".

An agent's own page (under Team) has a conversation where you can give it a task too.

## Needs you

Everything waiting for you shows as cards, one main button each. Click Needs you at the top right and it opens as a drawer on any page. The same list is also under Tasks.

- **Accept.** The work is good. A finished task waits under "Pending review" until you accept it. A draft becomes final only when you accept it.
- **Send back.** The work is not right. Write a note. The task reopens and the agent does it again.
- **Answer a question.** If a brief or plan has something unclear, work stops and the question shows here. Type the answer. Work carries on.
- **Accept a plan.** For a plan-first task, read the plan, then Accept, or Send back with a note to change it.
- **Hand on.** When a job is accepted and the next job fits it, a button offers the next one. Nothing is passed on until you press it.

Press Esc on a card to close it without doing anything.

## The acceptance view

Open a task from Tasks. At the top you see who did it, how many checks it took, and one large Accept button when it is waiting. Below are the Checker's numbered checks, each pass or fail with its reason. There is a tab per round. Then the timeline of steps, the documents in order (brief, plan, summary, check), the conversation, and the files. After five failed checks the task stops and asks you.

## The company brain

The company brain is the page called Files. These are your own files, and every agent reads them before it works, so what they make sounds like your company. Only you write in it.

- **Nine basics**, filled through short forms: About the company, Brand, Words never to use, Prices and services, Terms, Refunds, the Support promise, Team and Ideal customer. Filling them takes about 20 minutes and is the best first step. The page shows a count of how many are filled.
- **Ten folders:** Company basics, Brand, Prices and services, Policies, People, Customers, Calls and meetings, References, Packs, and Loose files (files that were there before). Nothing is moved for you.
- **Adding a file:** by form, by paste, or by upload. Text, Markdown, CSV and images are accepted. A PDF can be kept and downloaded but is not read. SVG pictures are not accepted.
- **Search** finds words across all of it. The Lessons tab shows what agents have learned, and you can change a lesson.
- **The recipe log** is the one file the home server writes, from the Marketing scores. It holds numbers and plain labels only, never words an agent wrote.

Agents cannot write in Files. Anything they want kept comes to you as a draft.

## Jobs and the build order

A job is a named piece of work an agent can start for you. There are 60, in seven departments: Operations 7, Sales 9, Marketing 12, Studio 11, Support 5, People 5 and Books 11. Open Jobs, pick one, press Start. It makes a task, and from there it is like any task.

- **Hand-off tags** say what is left to you: "You lead" (the agent gets things ready, you do the main part), "You approve" (the agent does the work, and it counts when you approve it), "On its own" (the agent does it to the end, it is checked, and you read the result).
- **The build order** has four stages: Foundations (fill the company brain), Take in (jobs that read and sort what comes in), Make (jobs that produce work) and Hand on (work passed from one agent to the next, such as a call write-up, then a proposal, then an invoice draft).
- **What can start.** On the live engine 49 jobs can start before any basics are filled. Nine wait until you fill the basics (what we sell, brand, team and the recipe log). Three stay dim with the reason shown: agents have no internet, and sending needs a connected account.
- A job says "Takes a few minutes. It is checked before it reaches you." That is true: expect 5 to 40 minutes, as in the trials below.

## Ask the brain

Type a question about your company in the Map's box, such as "How long is our warranty?". An agent reads your files and answers from them. It names the files it used and lists what the files do not say.

- **It takes time.** The one time measured so far: that warranty question was answered on the live engine in about 40 seconds. Answers usually take a minute or two.
- **It is labelled "Not checked".** The Checker does not look at these answers, which is why they are fast. If an answer matters (a price you will quote, a date you will promise), check the file it names.
- If your files do not cover the question, it says "Your files do not say." Fill the folder it points to.

## Routines

A routine is standing work on a schedule. Two exist:

- **Daily brief**: every morning at 09:00, a short note of what happened that needs no decision.
- **Weekly content plan**: Mondays at 10:00, drafts of three posts and a newsletter. Nothing is published.

Both start switched off. Until the daily brief is switched on, the Map shows a brief the home screen puts together itself. To switch one on, open Routines and use its switch. Each run costs one run of that agent on your plan. You can also use Run now, or pause it again. Agents cannot create, change or start a routine.

## The pages

- **Map**: the company brain in the middle, the departments around it, the daily brief, and the box to give a task or ask a question. Click a department to zoom into its jobs.
- **Tasks**: every task, as a board or a list. A task's page is the acceptance view.
- **Dashboards**: figures first, then drafts waiting for you. Books, Customers, Support, People, Marketing and Studio.
- **Files**: the company brain.
- **Needs you**: the drawer and the full list.
- **Jobs**: the 60 jobs by department, with the build order.
- **Routines**: standing work, its runs and its switch.
- **Team** (from the menu or a creature): the ten agents. Each page says what that agent may and may not do, what it is doing, its lessons, and lets you pause it or give it a task.
- **Health**: what is on, whether the fence holds, what is not connected. You can run the proof from here.
- **Settings**: theme and accent, and the later options with what each would cost.
- **Search**: finds tasks, files, records, agents, routines and jobs.

## The Studio

Under Dashboards. The Drafter designs parts. For each it gives a STEP file and a note with the measured size and volume. The Artist makes sprites, small animations, simple vector images, slide sets (carousels) and short videos, all by script.

- **Sprites** come as a sheet, a data file, an animated GIF and a small manifest. The Studio plays one frame by frame, with zoom, its named animations and its colours. The home server checks from the files that the frames match the animations.
- **Slides** show as a set, checked for size and count from the files themselves.
- **Videos** play in the Studio with a poster and six still frames. Titles and captions are pictures laid over the video. Speech to text uses the model already on this Mac and understands English only.
- **The room** is a folder where you drop your own footage and sound with Finder (the Studio shows where, under "Where is this folder?"). Big files cannot go through the browser.
- A vector image cannot run a script when shown. There is no 3D and no web-page video yet.

## What is switched off

Each is an off switch or an account step. Nothing is done for you.

- **Anything that needs the internet.** Agents have no internet, so jobs that would look things up online stay dim, with the reason shown.
- **Publishing and sending.** No post, email or message can go out. To turn it on, connect the account first; each page says "Connect an account to turn this on."
- **WhatsApp and the GST portal.** Off in the same way.
- **India Compliance's paid features.** Off.
- **PDF printing of invoices.** Off until there is more disk.
- **Routines.** Off until you switch them on.

## Steps only you can do

- **Fill the nine basics in Files** (about 20 minutes). Until then nine jobs wait and the agents' work sounds less like your company.
- **The Checker's own Codex login.** Run `engine/fence/login-wizard.sh codex` and follow the steps. Until then the Checker uses your own Codex login through a link, and the proof shows one note. `engine/fence/login-wizard.sh --status` shows where each login stands. The Claude agents' login is `engine/fence/login-wizard.sh`.
- **Connecting accounts.** Before anything can be published or sent, you connect the account it goes through.
- **The books, before real use.** Run `engine/books/setup-wizard.sh`. It asks whether the company is registered for GST (and its GST number and scheme), the company's address, and the weekly days off and public holidays, then shows it all and saves it in one go. Until then invoices say "Nil-Rated" even where tax is charged, and leave can be drafted but not made final. `--dry-run` checks your answers without saving; `--status` shows what the books hold.

Also optional: the board can be switched to its own sign-in. Today, other programs on this Mac can still reach the board and the home screen as you. The gate closes this gap for agents only.

## What would turn this on later

None of these is built or running. Each is a choice for later. Settings lists them as off.

**Other chat apps as extra windows.** LobeHub, Open WebUI, Cherry Studio or Jan could talk to the company through an address that looks like OpenAI's. It would turn on if you want to chat with the team from one of those apps. The home server would need that address added.

**A separate workflow engine.** Kestra could run long scheduled workflows. It would turn on if routines stop being enough. It needs about 4 GB of memory while it runs.

**A free helper model on this Mac.** Ollama is already installed. A small model could do small jobs without using your plans. It would turn on if you have the disk. Expect about 5 GB of disk and 4 GB of memory while it runs.

**Editing sprites in place.** Piskel, a free pixel-art editor, could be served from the home screen so you can touch up a sprite by hand. It would turn on if you want to edit by hand rather than ask the Artist again. It is a small download.

**Previewing Aseprite files.** The Studio could show files from Aseprite if you buy or compile your own copy for personal use. Its licence does not let the engine ship or run it, so the engine will never install it. Ask for the preview once you have it.

## Where things live

- The engine's state: `~/.paperclip/uuu-engine/`. It holds the company records (`books/`), agents' task folders (`tasks/`), lessons (`lessons/`), the company brain's files (`knowledge/docs/`), the Drafter's and Artist's tools (`cad/`, `art/`), your footage and the speech model (`media/`) and the last proof (`proof/last.json`).
- Logs: `~/.paperclip/uuu-engine/logs/`. One file per part, plus `gate-refusals.log`, which lists what the gate turned away.
- Secrets: `~/.paperclip/uuu-engine/secrets/`, and the agents' login in `agent.env` beside it. Only you can read them. They are never in the repository and are never shown here.
- The company's files (agents, instructions, routines, jobs): `engine/company/`.
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

### The first trials, 11 November 2026

Every department got a real task on the live engine, with made-up customers. Nothing was sent out.

| Trial | Result |
|---|---|
| Studio | Passed first time: a CAD part with its drawing (16 minutes) and a four-frame sprite (30 minutes). |
| Support | Passed: a reply to a made-up ticket was drafted and waited for approval. 29 minutes. |
| Marketing | Passed after one question to the owner was answered. 36 minutes, three check rounds. |
| Books | Passed: an invoice was drafted, checked, approved and became final. A bill sent back from Needs you was corrected in two minutes. |
| People | Passed in part: attendance and a leave draft worked. Leave cannot be made final until the books have a holiday list. |
| Customers | Failed the first time: Sales did not own its lead, and its question could not be answered from the home screen. Both were fixed; the second run passed in 13 minutes. |
| The staged way | The daily brief passed in 7 minutes. The plan-first task went through every stage and then hung, because the board held it after a fault of its own. The home screen now clears that kind of hold by itself, and the task finished. |

What to expect:

- A small task takes 5 to 15 minutes, a larger one 20 to 40. Each agent works on one thing at a time, and a larger task goes through a brief, a plan, the work and a check. Several tasks at once queue behind the Chief of staff.
- A check often fails once before it passes. That is the check working.

What the trials changed:

- You can answer an agent's question card from Needs you (proven on the live board), and every item offers only buttons that work.
- A draft you send back is fixed directly and comes back as the same item.
- Department agents save a read-back of what they made in the books, so the Checker can check it. The Checker never blocks a task; its questions reach you through the check.
- The final review found two ways around the fence. Both are closed and now part of the proof (`docs/adr/0007-what-runs-unfenced-never-trusts-agents-folders.md`).

Known limits:

- Agents cannot use git inside their task folders.
- Each Claude agent now has its own Claude Code home under the state folder's `claude-home`. The older shared files there (`projects`, `sessions`, `backups`, `file-history`, `shell-snapshots`, `session-env`, `tmp`) are no longer used by anything and may be deleted.
- If the board holds a task whose last run did real work, Needs you shows "A task stopped". You can stop the task or reply; the home screen will not restart it by itself.
- Three content drafts from the Marketing trial are still in Needs you, so you have something to try Approve and Send back on. Nothing is published either way. The trial records in the books were removed.

### The second trials, 12 November 2026

(filled in by the orchestrator after the trials)
