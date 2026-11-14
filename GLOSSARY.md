# Company engine

One app that runs a company end to end, with people and AI agents working together.

## Language

**Engine**:
The whole system: the company plane, the departments, the systems of record and the foundation under them.
_Avoid_: Platform, app, OS

**Person**:
A human in the company.
_Avoid_: User, staff, employee

**Agent**:
An AI worker with a role and a boss on the org chart.
_Avoid_: Bot, coworker, teammate, assistant

**Department**:
A group of agents with the skills for one business function and one dashboard.
_Avoid_: Team, division, space

**System of record**:
The one place where a kind of data officially lives, such as the books or the CRM.
_Avoid_: Backend, source of truth, database

**Fence**:
The limits on what an agent can reach: files, network and secrets.
_Avoid_: Jail, guardrail, sandbox (that names the tool that builds a fence)

**Board**:
The place where tasks and agents are kept and handed out (paperclip). Agents reach it only through the gate.
_Avoid_: Dashboard, tracker, control panel

**Gate**:
The small server between the agents and the board. It turns away every request an agent has no need to make.
_Avoid_: Firewall, proxy, API gateway

**Model relay**:
The small server between the agents and the provider. It adds the provider's key itself, so the key never enters the fence, and it holds each agent to its pick.
_Avoid_: Proxy, gateway, router

**Provider**:
The outside service whose models agents can use instead of the Claude and Codex plans: Omega Plus. Off until the owner pastes a key in Settings and switches it on.
_Avoid_: Vendor, API, backend

**Pick**:
Two things. The one model chosen for an agent, by the ranking or by the owner in Settings. And the owner's choice of one version out of several in Needs you, which counts as accepting it.
_Avoid_: Default model, assignment

**Plans mode**:
The engine's normal state: agents use the owner's Claude and Codex plans.
_Avoid_: Free mode, default mode

**Provider mode**:
Agents use the provider through the model relay. Everything an agent reads and writes in a task is sent to the provider.
_Avoid_: Paid mode, outside mode

**Home screen**:
The owner's one front door to the engine, in a browser on this Mac.
_Avoid_: Portal, admin panel, UI

**Needs you**:
Everything waiting for the owner: work to accept, drafts to approve, questions, plans.
_Avoid_: Inbox, notifications, queue

**Task**:
What the owner asks for. The code calls it a goal.
_Avoid_: Ticket, request, issue

**Draft**:
Work an agent has prepared that is not final until the owner approves it.
_Avoid_: Proposal, suggestion, pending item

**Fence policy**:
The short file of extra allowances one agent's fence has, such as one folder it may read.
_Avoid_: Permissions, ACL, profile

**Proof**:
The check that the fence holds, with a result for every line, run by `engine prove`.
_Avoid_: Audit, scan, pen test

**Files**:
The page where the company brain's files are kept and filled in.
_Avoid_: Docs, wiki, knowledge base

**Lesson**:
A note an agent keeps about how to do its job better next time. The owner can change it.
_Avoid_: Memory, rule, learning

**Brief**:
The first document of a larger task: the goal in the owner's words, what done looks like, and anything unclear.
_Avoid_: Spec, requirements, ticket

**Plan**:
The second document of a larger task: the approach and the steps, with who does each.
_Avoid_: Roadmap, design, proposal

**Check**:
The Checker's six yes or no questions about a piece of work, ending in a verdict of pass or fail.
_Avoid_: Review, test, QA report

**Round**:
One check of a task. After five failed rounds the task stops and asks the owner.
_Avoid_: Iteration, attempt, cycle

**Accept**:
The owner's yes to finished work, a plan or a draft.
_Avoid_: Approve (for finished work), sign off, merge

**Send back**:
The owner's no, with a note, so the work is done again.
_Avoid_: Reject, deny, decline

**Routine**:
Standing work that runs on a schedule, kept as one small file. It starts switched off.
_Avoid_: Cron job, automation, workflow, schedule

**Job**:
A named piece of work an agent can start for the owner, kept as one small file. Starting a job makes a task.
_Avoid_: Ready-made goal, template, preset, blueprint

**Map**:
The home page: the company brain in the middle, the departments around it.
_Avoid_: Home, overview

**Company brain**:
The company's own files that every agent reads before it works.
_Avoid_: Knowledge base, wiki, memory

**Hand-off**:
What is left for the owner when a job runs: you lead, you approve, or on its own.
_Avoid_: Autonomy level, mode

**Stage**:
One step of the build order: Foundations, Take in, Make, Hand on.
_Avoid_: Phase, level, tier

**Dashboard**:
The figures and records of one department.
_Avoid_: Report, analytics, control panel

**Recipe log**:
The one file in the company brain that the home server writes: the Marketing scores, as numbers and plain labels only.
_Avoid_: History, analytics

**Room**:
The folder where the owner drops footage and sound for the Artist's video work.
_Avoid_: Library, media bin

**Brand kit**:
The owner's brand as data in the company brain: colours by name, two typefaces, the smallest sizes, logo files and their clear space, the voice with examples, and approved example pictures. Only the home screen writes it, from what the owner types and uploads. The art tools take their colours, type and logo from it.
_Avoid_: Brand book (that is the owner's own document), style guide, theme

**Brand check**:
The code that measures a piece against the brand kit and the can't-say list before any reviewer sees it: colours off the palette, banned or filler phrases, a missing or wrong logo, a script that loads its own typeface. It writes nothing, and nobody reads anybody else's result.
_Avoid_: Brand review, lint, QA

**Playbook**:
Craft advice from the owner's own skill folders on this Mac, copied into the engine's state folder where every agent can read it and none can write it. The repo holds only a list of them, and two playbooks it keeps whole: the owner's Render to Film recipes and `cook`.
_Avoid_: Skill, prompt, template

**Version**:
One of up to three pieces made for the same ask, each in a different direction, for the owner to choose between. The code calls it a variant.
_Avoid_: Draft, option, take, variant

**Direction**:
A named way of making a kind of piece, such as "Picture led" for a carousel. Three versions are three different directions.
_Avoid_: Style, theme, concept

**Taste file**:
The one file in the company brain, `brand/taste.md`, that records what the owner picked and sent back, by kind of piece, in the owner's own words. Only the home screen writes it. Makers and the Art director read it before the next piece of that kind.
_Avoid_: Preferences, profile, memory

**Web door**:
The small server that lets the Researcher, and no other agent, read public pages, search and watch videos. It refuses private addresses and keeps a list of every address opened. Off until the owner switches it on in Settings.
_Avoid_: Proxy, browser, internet access

**Narrow gate**:
A second listener of the gate, used only by a walled agent. It lets the agent read and answer its own task and nothing else on the board.
_Avoid_: Second gate, restricted gate

**Walled agent**:
An agent that reads text from the internet and so is kept apart: its own folder, only its own task on the board, and none of the company's files except those the owner shared. Only the Researcher is walled.
_Avoid_: Sandboxed agent, isolated agent

**Research folder**:
The folder `tasks/research/` where the Researcher works and writes its notes. Other agents read the notes there and cannot change them. The home screen shows them in a task's files under `@research/`.
_Avoid_: Web folder, scratch folder

**Shared files**:
The text and table files the owner marked "Fine to share with the Researcher", with the brand's public summary. They are the only company files the Researcher can read.
_Avoid_: Public files, exported files

**Generation door**:
The small server that lets the Artist, and the apps in App Studio, and no other agent, make video clips and pictures with Runway and Higgsfield, two paid services, from the owner's own renders. The Artist spends only inside a batch the owner approved, and an app only inside an allowance. It keeps the spending ledger, and holds the Runway key and the Higgsfield sign-in, which no agent can read. Off until the owner switches it on in Settings.
_Avoid_: Runway connection, Higgsfield connection, video API, AI generator

**Page viewer**:
The small server that lets the Builder and the Art director, and no other agent, see the pages the Builder made. It opens a site in a hidden Chrome that runs outside the fence, with Chrome's own sandbox on and a proxy that passes only the site, and gives back pictures at computer and phone width and a report. Off until the owner switches it on in Settings.
_Avoid_: Browser, screenshot tool, web door

**Preview**:
The owner's own look at a site an agent built, in the owner's own browser, on its own address (127.0.0.1 port 3160). It holds one site at a time, from memory, and the home screen is the only thing that can load it. A page in it can reach nothing but itself. Nothing is published.
_Avoid_: Staging, live site, publish

**Site kit**:
The few small files in `engine/site-kit/` (a reset, a layout grid, a scroll reveal and a lightbox), written in this repository for the pages the Builder makes. The playbooks installer copies them to the playbooks folder. They fetch nothing; a library that is not in the kit is not used.
_Avoid_: Framework, template, theme

**Page rules**:
The part of the brand check that reads a site's own files as text and sends the page back to the Builder when it breaks a hard rule: the kit's tokens file changed, a colour or a typeface that is not the kit's, text smaller than the kit's smallest, an address outside the site, or no logo in the header.
_Avoid_: Lint, style guide

**Treatment**:
One way to make a film, on paper: a direction, a shotlist and a storyboard still for every shot. A film comes as one to three treatments at no cost. The owner approves one with its cost.
_Avoid_: Concept, pitch, version of a film

**Shotlist**:
The list of a treatment's shots: for each, the render it starts from, its length in seconds, the move, and the words sent to Runway. The home screen works out its cost from the lengths.
_Avoid_: Storyboard, script, scene list

**Batch**:
The owner's yes for one film or one still job, written as a file only the home screen writes. It names the shots, the models, the longest length of each, the takes allowed and the most it may cost, and it ends after seven days. The generation door spends only inside a batch.
_Avoid_: Order, budget, permission slip

**Take**:
One try at a shot: one call to Runway and the clip it makes. The first is take 1, named like `s01-t1`.
_Avoid_: Attempt, render, version

**Retake**:
A second take of a shot, made when the Art director marks the first one to be redone. Each shot may have one. The generation door refuses a third.
_Avoid_: Redo, reshoot

**Credit**:
A service's unit of price. One Runway credit is one US cent. A Higgsfield credit is worth the number of cents set in Settings (**cents per credit**). A clip costs credits for each second; a picture costs a fixed number.
_Avoid_: Token, point

**Spending ledger**:
The generation door's own file, `doors/generate-ledger.jsonl`, with a line for every amount held, spent or given back, for the Artist and every app together, in US cents. Every limit is checked against it. The door alone writes it and tidies it when it starts; if it cannot be read, nothing is made.
_Avoid_: Bill, invoice, usage log

**App Studio**:
The page on the home screen, and the part of the engine behind it, where the apps the company makes live. Each app is listed with its state, switched on and off by the owner, and opened inside the home screen. Off until the engine's App Studio part is installed.
_Avoid_: App store, marketplace, plugins

**App**:
A program the engine runs for the owner and the Artist, kept as a folder in the repository, `apps/<name>/`, and run only inside its own fence. The first is Render to Film. It reaches Runway and Higgsfield only through the engine.
_Avoid_: Plugin, extension, tool

**Manifest**:
An app's `app.json`: its name, its port, what it starts from and which parts of the engine it may ask (the generation door, the model relay) and which programs it may use (ffmpeg). One that breaks a rule makes the app "damaged": it is listed and never started.
_Avoid_: Config, settings file

**The host**:
The small program, `engine/apps/host.mjs`, that starts each app inside its fence, serves its pages on its own address and is the app's only way into the engine. It is the one part of App Studio that runs unfenced, and it has no dependencies.
_Avoid_: Server, launcher, runner

**App fence**:
The limits on what an app's code, its packages and its build can reach: only its own folders and Node, no network port, and only its own sockets. It is the agents' fence built for apps; the same tool, other rules. Its install mode alone may reach the public package registry.
_Avoid_: Sandbox (that names the tool), container

**Engine socket**:
The one door an app has into the engine: a file on this Mac that only that app's fence can reach. The host knows which app is asking by which socket it came through, so an app holds no key or secret.
_Avoid_: API key, app token, endpoint

**Allowance**:
The owner's yes for an app to spend today: $2, $5, $10 or $20, set in the home screen's bar above the app, never more than what is left of the day's and month's limits. It ends at the next midnight in Kolkata, or when the owner presses "Stop spending". It is a file only the home screen writes.
_Avoid_: Budget, credit line, permission

**Higgsfield**:
A second paid service, beside Runway, that makes pictures and clips. The generation door reaches it through its MCP server after the owner signs in once with his browser. Off until the owner switches it on in Settings. Its terms let it train its models on what is sent.
_Avoid_: Higgs, HF

**Cents per credit**:
The number in Settings that says what one Higgsfield credit costs, from 1 to 50 cents. It starts at 5. Every price the owner reads is in dollars, worked out with it.
_Avoid_: Exchange rate, conversion

**Model table**:
The door's list of every model it will pay for, from Runway and Higgsfield, with what each can do and its price. A price always comes from the table. A model with no price in it is refused, and nothing is spent.
_Avoid_: Price list, catalogue

**Cook**:
A third party's playbook, under the MIT licence, for making visual work as a loop: references, a target, a number to reach, a round of looking and fixing, a judge who knows nothing of the build. It is the default way pages, films and stills are made and judged here.
_Avoid_: Skill, workflow

**Daily brief**:
A short note each morning of what happened that needs no decision.
_Avoid_: Digest, report, summary email

**Sprite**:
A small picture or animation made of frames, with its data file and a GIF.
_Avoid_: Icon, asset, animation file

## Roles

**Owner**:
The person the company belongs to; the top of the org chart.
_Avoid_: Admin, boss, user

**Chief of staff**:
The agent that turns the owner's goals into tasks and assigns them.
_Avoid_: CEO, manager, orchestrator

**Builder**:
The agent that does the work on a task.
_Avoid_: Engineer, worker, implementer

**Checker**:
The agent that tests and reviews a builder's work before it reaches the owner.
_Avoid_: Reviewer, QA, verifier

**Art director**:
The agent that looks at finished pictures, pages and words against the brand kit and the owner's examples, and scores each version on seven axes. It never changes the work and never picks a version. It comes before the Checker.
_Avoid_: Designer, reviewer, creative director

**Bookkeeper**:
The agent that prepares entries and invoices in the books as drafts.
_Avoid_: Accountant, finance bot

**Sales**:
The agent that records leads and deals and qualifies them, as drafts.
_Avoid_: Salesperson, rep, CRM bot

**Support**:
The agent that drafts replies to customers. Nothing is sent.
_Avoid_: Helpdesk bot, agent (for the role)

**People**:
The agent that prepares staff records, leave and attendance, as drafts.
_Avoid_: HR, personnel, recruiter

**Marketer**:
The agent that drafts posts and newsletters. Nothing is published.
_Avoid_: Social media manager, copywriter

**Drafter**:
The agent that designs parts and gives back a STEP file with measured size.
_Avoid_: Engineer, CAD operator, designer

**Artist**:
The agent that makes sprites, animated GIFs, sprite sheets, simple vector images, slides and videos by script. It is the only agent that may use the generation door, to make film clips and stills inside a batch the owner approved.
_Avoid_: Designer, illustrator, animator

**Researcher**:
The one agent that may read public web pages and watch videos, through the web door, when the owner has switched the web on. It writes research notes with a source for every claim. It reads only its own task and the files the owner shared with it.
_Avoid_: Browser, scraper, crawler, web agent
