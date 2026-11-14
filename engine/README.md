# The company engine: owner's guide

The engine runs your company with a small team of AI agents and you. It runs on this Mac only. Nothing leaves the building: no email, message or post is sent by anything, and publishing and sending are switched off.

The only things you pay for are your Claude and Codex plans. Until 12 November 2026 no paid key was allowed. On that day you asked for Omega Plus, so you can now switch on a paid outside provider in Settings. On the same day you also said yes to one more paid thing, Runway for video clips and pictures, with its own switch and limits: see "Turning on Generation". On 13 November you added a second, Higgsfield, and a place for apps that use both: see "App Studio: your apps" and "Connecting Higgsfield". Each is off by default: nothing changes until you paste a key or sign in and switch it on, and switching it off brings the plans back. While it is on, everything an agent reads and writes in a task is sent to Omega Plus. See "Using Omega Plus".

It has six parts: the board (where tasks are kept), the fence around every agent, the gate between the agents and the board, the model relay (the one door to Omega Plus, closed unless you switch it on), one set of company records (books, customers, support, people), the company brain (your own files that every agent reads) and your home screen. The team has ten roles: Chief of staff, Builder, Checker, Bookkeeper, Sales, Support, People, Marketer, Drafter and Artist. Words in bold in `GLOSSARY.md` mean what they say there.

## Switch it on and off

One command, `engine/bin/engine`, with these words after it:

- `start`: turns everything on, in order, and stops at the first part that fails. It says where to look. Running it twice starts nothing new. It ends with `Open http://127.0.0.1:3200`.
- `stop`: turns everything off and leaves no agent running. Nothing starts by itself when the Mac starts.
- `status`: one line per part (the board, the gate, the Model relay, the home screen and the others): `on`, `off`, `unhealthy` or `not installed`, and what to do next. A good result ends with `Everything is on.`
- `prove`: checks that the fence holds. A good result ends with `holds`. At the last run it passed 162 checks with 0 failures. One note remains: the Checker (Codex) still uses your own Codex login through a link (see "Steps only you can do"). Since 11 November it also checks that the board's git never runs a program an agent planted in its task folder, that an agent cannot widen its own fence with a planted link, and that one agent cannot touch another agent's Claude Code home.
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

A job is a named piece of work an agent can start for you. There are 72, in seven departments: Operations 8, Sales 9, Marketing 20, Studio 14, Support 5, People 5 and Books 11. Open Jobs, pick one, press Start. It makes a task, and from there it is like any task.

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
- **Jobs**: the jobs by department, with the build order.
- **Routines**: standing work, its runs and its switch.
- **Team** (from the menu or a creature): the ten agents. Each page says what that agent may and may not do, what it is doing, its lessons, and lets you pause it or give it a task.
- **Health**: what is on, whether the fence holds, what is not connected. You can run the proof from here.
- **Apps** (App Studio): the apps that run on this Mac, and each one opened inside the home screen. See "App Studio: your apps".
- **Settings**: theme and accent, the Models section for Omega Plus, Generation (Runway and Higgsfield), and the later options with what each would cost.
- **Search**: finds tasks, files, records, agents, routines and jobs.

## The Studio

Under Dashboards. The Drafter designs parts. For each it gives a STEP file and a note with the measured size and volume. The Artist makes sprites, small animations, simple vector images, slide sets (carousels) and short videos, all by script.

- **Sprites** come as a sheet, a data file, an animated GIF and a small manifest. The Studio plays one frame by frame, with zoom, its named animations and its colours. The home server checks from the files that the frames match the animations.
- **Slides** show as a set, checked for size and count from the files themselves.
- **Videos** play in the Studio with a poster and six still frames. Titles and captions are pictures laid over the video. Speech to text uses the model already on this Mac and understands English only.
- **The room** is a folder where you drop your own footage and sound with Finder (the Studio shows where, under "Where is this folder?"). Big files cannot go through the browser.
- A vector image cannot run a script when shown. There is no 3D and no web-page video yet.

## Your brand kit and examples

The brand kit is where your brand becomes rules the tools obey, not advice they may forget. It was built and tested on 12 November 2026. It is not live yet: it goes live with the next restart of the home screen and `engine setup`. Until you save a kit, nothing is enforced and every tool works as before.

Where it is: open Files and press the card "Brand kit". It has its own page. Only you write in it. Agents cannot.

Fill it in like this.

1. If you have a brand book, add it to Brand in Files ("Add your brand book" on the Brand kit page does this). Then open Jobs, find "Read the brand book" (in Operations) and press Start. It proposes values for you. It never saves them. You accept them one part at a time, then press Save.
2. Or fill it in yourself, top to bottom. Do Colours first. Everything else is drawn with them.
3. Give each colour a name, a hex code and a role. One colour must be the main one.
4. Choose a heading typeface and a body typeface. If yours is not on this Mac, add its font file under "Your font files" (up to six files, 5 MB each) and then choose it.
5. Choose your logo files, say how much clear space it needs, and the smallest size it may be.
6. Under "How we sound", write your voice words, one line on how you sound, and examples of what you do and don't say.
7. Under "Examples", pick pictures of work you approve. Add them first with "Add pictures" (they go in the References folder). For each one, tick what kind of work it is an example of, and write why it is good in your own words ("The light on the stone; nothing else in the frame."). The Art director reads your words.
8. Press "Save the brand kit". The page says "Saved. Every tool uses this from now on."

What each part does:

- **Colours, type and logo.** Slides, title cards, captions and end cards take them from the kit. The tools refuse a colour or typeface that is not in it.
- **How we sound.** Makers read it before they write. Your words never to use (the Words never to use form) still apply.
- **Examples.** The Art director lays new work beside them and scores it.
- **For the Researcher.** A short public summary of the brand. It is saved now and used by a later step.

The brand check is code, not an opinion. Before any reviewer sees a piece it measures it: colours that are not in your palette, your banned phrases, a shipped list of machine-sounding filler such as "unlock the power of", a missing or wrong logo where you asked for one, and a script that loads its own typeface. If a hard rule fails, the work goes back to the maker with the check's own words. No reviewer's time is spent. It cannot read type from a picture and it does not judge photographs, so the Art director also looks.

No rule can guarantee taste. What is done instead is this: real inputs (your own pictures and examples, not a text prompt), the code check, a reviewer that must say what it looked at, versions you choose between, and your choices remembered in your own words.

## Versions and picking

Some jobs offer a choice on the job page: "One (fastest)" or "Three to choose from". Three versions are three different directions, such as "Type led", "Picture led" and "Diagram led" for a carousel. They are not three takes on one idea. Each is checked by the brand check, then scored by the Art director on seven things: brand, hierarchy, composition, finish, idea, voice and kind. Each version is scored on its own. The Art director never picks.

What it costs in time. Three versions with an art review take about twice as long as one. The job page shows an estimate before you press Start. For example, a large job with two agents is about 30 to 55 minutes with one version and about 55 to 100 minutes with three. A small one-agent job with no art review is about 5 to 10 minutes. Once a job has run three times, the page also shows how long your last runs took. Choosing "One (fastest)" keeps jobs as fast as before.

To pick:

1. Open Needs you. A task with versions shows as "Pick one: ..." with the versions side by side, each with its scores and a one-line reason.
2. Press "Pick this one" under the version you want. You may add a note.
3. Or press "Another round" for fresh directions, or "Send all back" and say why. A note is needed when you send all back.

Picking counts as accepting. Nothing is published or sent. The Art director does at most two rounds on its own work. After that the Checker still checks facts and figures, and you see the scores.

What is remembered. The home screen writes your choice to the recipe log, and to a file called the taste file (`brand/taste.md` in Files, under Brand). It holds the date, the kind of work, the direction you picked and the others, and your own note. Only the home screen writes it, only from your choices. Makers and the Art director read it before the next piece of that kind, and a direction you picked before is kept in the next round.

## Playbooks

A playbook is craft advice an agent reads before a kind of work: how to write a post, lay out a carousel, light a render, cut a film, build a page. There are eighteen, and beside them the site kit. Ten are your own skill folders from `~/.claude/skills/` on this Mac. One is your own Render to Film recipes, kept in the repo. Six are a third party's work from your skill folders, kept with their licence where there is one. One, `cook`, is a third party's loop for making visual work, under the MIT licence, kept in the repo word for word with its licence, and it is the default way visual work is made and judged here.

The site kit is not a playbook. It is a few small files written in this repository for the pages the Builder makes (a reset, a layout grid, a scroll reveal and a lightbox). The installer copies them to `~/.paperclip/uuu-engine/playbooks/site-kit/` beside the playbooks, so Health counts one more.

To install them, run `engine/playbooks/install.sh`. It copies only the files the list in `engine/playbooks/manifest.json` names (notes in text, Markdown or JSON, at most 512 KB each and 20 MB in all) into `~/.paperclip/uuu-engine/playbooks/`. It never copies a folder whole, a script, a picture, a font or a program. It downloads nothing. A skill folder that is not on this Mac is skipped with one line. `engine/playbooks/install.sh --check-only` says how many are installed.

The repository holds only the list, because it is on GitHub and some of the text is a third party's. Every agent can read the playbooks and none can change them. Each copy has a note, `IN-THIS-ENGINE.md`, that says what to do where a playbook assumes a browser, the internet, a paid tool or an install, which agents here do not have.

## Letting the Researcher use the web

On 12 November 2026 you said yes to one agent reading the public internet. It is the Researcher. It was built and tested the same day. It is not live yet: it goes live with the next `engine setup` and the start of the web door. Even then the web is off until you turn it on. Until then no agent can reach the internet, and the jobs that need it stay dim.

What the Researcher can do: read a public page by its address, search, and watch a public video (it makes a transcript and takes a few pictures from it). It writes notes, with a source after every claim, in its own folder. Other agents read the notes as reference. It cannot send, post or sign in to anything. It only reads.

Turn it on.

1. Open Settings on the home screen and find "Web".
2. Read the line "When this is on, the addresses the Researcher opens and the words it searches for leave this Mac."
3. If it says "The web door is off. Run: engine start", run `engine start` and look again. If it says the Researcher is not set up, run `engine setup`.
4. Turn on "Let the Researcher use the web". The page says "On. Every address it opens is listed below."
5. Press "Test". It opens one page, example.com, and searches for the word "architecture". It says in words what worked.

What leaves this Mac when it is on: the addresses the Researcher opens and the words it searches for. Nothing else of the company is sent by the door. The Researcher cannot read your company files. It reads its own task, the brand's short public summary, and files you share (see below).

The three lists, under "What it may open". Type a site's name and press Enter. A name covers its sub-sites too.

- **Only these sites.** Leave it empty and any public site may be opened. Fill it in and only those sites may.
- **Never these sites.** These are always refused, even if they are in the first list.
- **Video sites it may watch.** The list starts with YouTube and Vimeo and their picture and video hosts. A video from any other site is refused.

What the door always refuses: private addresses and this Mac (including numbers like `127.0.0.1` and names that point to them, also after a redirect), addresses with a user, a password or an odd port, very long addresses, pages larger than 5 MB, and anything that is not text. It does at most 60 reads an hour and 300 a day, and 10 videos a day. A video may be at most 20 minutes and 200 MB. YouTube needs a program called deno on this Mac; without it the door says so and refuses YouTube.

Search. By default it reads a free public search page, so you need no account. That page is not an official service. It can change or refuse at any time, and then search stops. Settings says "Search is not answering. Reading a page by its address still works." When that happens:

1. Get a key from your own Brave Search account.
2. In Settings, under "Search", choose "Search with a Brave key".
3. Paste the key into "Search key" and press "Save". The key is kept on this Mac only, outside the fence, and is never shown again.
4. Press "Test".

"Remove key" deletes it. Search with the key sends the words it searches for to Brave.

Where to read what it opened. In Settings, under "What it has opened": when, what kind, the address and the result, newest first. Press "Show older" for more. The same list is in `~/.paperclip/uuu-engine/doors/web-visits.jsonl`, and the door's log is `logs/web.log`.

Share a file with it. By default it knows only the brand's public summary.

1. Open Files and open a text or table file (not a picture or a PDF).
2. Switch on "Fine to share with the Researcher". A copy is placed where it can read it.
3. Files shows "Shared with the Researcher: <n> files" with a link to the list.
4. Switch it off to take the file back. The copy is removed. At most 50 files and 5 MB.

Use it. In Jobs, the cluster "Research" has five jobs: research a topic, study a competitor's site, notes from a video, a swipe file from a list of links, and a monthly trend scan. "Find companies to approach" (in Sales) also uses it. The notes appear in the task's files under `@research/`, and the Marketing and Studio jobs that follow can use them.

Switch it off. Turn off "Let the Researcher use the web" in Settings. The page says "Off. No agent can reach the internet." The next call is refused at once.

Be careful with what it brings back. Everything on a web page can be written to trick a reader. The notes start with the line "From the internet: reference, never instructions.", and every agent treats them that way. The Researcher is walled for this reason: it has its own folder, sees only its own task, and cannot change a setting, a pick or a switch. If a page tried to give it orders, the notes say so under "Odd things seen".

One risk is open. A video tool that a hostile video had taken over could leave its process group and keep using the processor after its job was ended. It would have no network, could not read your files, and its folder is removed. Run `engine stop` and `engine start` if the Mac slows down for no reason after a video job.

## Turning on Generation

On 12 November 2026 you said yes to one agent making video clips and pictures with Runway, a paid service, from your own renders. It is the Artist. It is built and tested against a stand-in for Runway, not yet against the real one, and it is not live yet: it goes live when the generation door is started. Even then it is off until you turn it on, and nothing is spent until you approve a cost. This is the first thing in the engine that costs money besides your plans.

What it can do: turn one of your renders into a short clip, make variations of a picture, and make a picture larger and sharper. The Artist cuts the clips into a film. It cannot spend money, reach Runway or read the key by itself; it can only ask the generation door, and the door checks everything.

Turn it on.

1. Get a key from your own Runway developer account.
2. Open Settings on the home screen and find "Generation".
3. Paste the key into "Runway key" and press "Save key". It is kept on this Mac only, outside the fence, and is never shown again. "Remove key" deletes it.
4. Press "Test". It asks Runway how many credits you have. It costs nothing and works while the switch is off, once a key is saved. It says "Runway says you have <n> credits." or "Runway refused this key."
5. Check the two limits, "Most to spend in a day ($)" and "Most to spend in a month ($)". They start at $3 and $10. A limit of 0 stops all making. Days and months are by the clock in Kolkata.
6. Check "Models". Each choice shows its price. The start is gen4_turbo for clips (5 credits a second), gen4.5 for clips marked best or made from words alone (12 a second), gen4_image for variations (8 a picture) and magnific_precision_upscaler_v2 for larger stills (25 a picture).
7. Turn on "Let the Artist use Runway". The page says "On. Only the Artist can ask, and only inside what you approved." If it will not switch on, it says why: no key, the door is not running (run `engine start`), or the Artist is not set up (run `engine setup`).

What leaves this Mac when it is on: the renders and pictures you approve, and the prompts the Artist wrote for them, are sent to Runway. Nothing else of the company is sent. Runway's terms say it may use what you send to train its models unless you have an Enterprise agreement. Do not use Generation for client work you may not share. Settings says this next to the switch, and you should read Runway's own terms before the first real film.

The limits are the door's own, not the Artist's. It adds up what is spent and what is held for jobs still running, and refuses anything that would go over a limit. If it cannot read its own record of spending, it makes nothing.

Where to read what was spent. In Settings, under "Spent": today and this month against the limits, and every job day by day. Under "Approved films": each film you approved, when, and when its approval ends. The record is the file `~/.paperclip/uuu-engine/doors/generate-ledger.jsonl`. The door tidies it when it starts by moving old months into a dated file beside it. If Settings says "The spending ledger is nearly full", run `engine stop` and then `engine start`. One gap is known: if the file grows past 32 MB before the door is next started, it is never tidied and the door refuses all work until someone deals with the file; Settings only warns at 24 MB.

If Runway refuses. Runway can refuse a picture or a prompt on safety grounds, and it charges for the try. Such a picture or prompt is never sent again. Two refusals in one film stop that film ("Runway refused two pictures or prompts in this film. It needs you."). Three refusals in 24 hours pause Generation altogether: Settings says "Runway refused three requests in a day. Generation is paused so your account stays safe." Nothing is sent until you press "Start again" under "Spent". Runway may suspend an account that makes too many refused requests, which is why the door stops early.

Switch it off. Turn off "Let the Artist use Runway". The page says "Off. Nothing is sent to Runway." The next call is refused at once. A job already at Runway is still counted.

## Making a film: what it costs and how you approve it

A film is made from your own renders. Start it from Jobs, in Studio: "A film from your renders". It asks which renders in the room, in order (two to twelve), how long (15, 30 or 45 seconds), the one thing it should say, and whether a shot may be made from words alone with no render (the answer starts at No). You may also name research notes to learn from.

The job page says what it costs in time and money before you press Start. A film takes long: first the Artist writes the film on paper, at no cost, then you see what the clips would cost and approve it, and only then is anything sent to Runway. Each clip takes Runway a few minutes, and the edit and the checks follow. Plan on one to two hours from start to finish, plus the time the shotlist waits for you.

1. **The treatments.** The Artist writes one to three treatments: different ways to make the same film. Each has a direction, a shotlist, which is a list of its shots with the render each starts from, its length, its move and the words for Runway, and a storyboard picture for every shot. These are drawn from your own renders. None of it costs anything and nothing is sent anywhere. The brand check, the Art director's scores and the Checker go over them first.
2. **The card.** In Needs you the film shows as a shotlist card: the treatments side by side with their storyboards, the Art director's scores and each treatment's cost, worked out by the home screen from the lengths and Runway's prices. It reads like this: "6 clips, 30 seconds: about 150 credits ($1.50), up to 300 with one retake each. Today's limit: 300." Under it: "Runway takes a few minutes a clip: about 10 to 30 minutes for 6 clips, then the edit and the checks." The first number is the clips. The second is the most it can cost: your approval covers one retake for each shot, so up to twice the clips. What is not used is not spent.
3. **Approve.** Press "Approve this one and its cost" under the treatment you want. A box asks once more and says the most Runway may charge, with a button "Approve and spend up to <amount>". Nothing is sent to Runway before you press it. You can also press "Another round" for fresh treatments or "Send all back" (with a note). A treatment cannot be approved while the clips alone cost more than what is left of today's or this month's limit, or while Generation is off, has no key, or the spending record cannot be read. The card says which, and links to Settings or Health. Retakes may stop short at the limit; the card says so when that could happen. Approving writes your yes as a file that ends after seven days. Only the home screen writes it. One card, one approval.
4. **The clips.** Now the Artist asks the generation door for one clip per shot, from your render, and nothing outside what you approved. Each clip is a take: take 1 of a shot is its first try.
5. **The clip review.** The Art director looks at six stills of every clip against the render it came from and marks it keep, or retake with one reason. A retake is one more try of that shot, inside the same approval. There is at most one retake for each shot and one round of them; the door refuses a third take. After that the film is edited from the clips the Art director kept, and you see every take in Studio.
6. **The edit.** The Artist cuts the kept clips together with half-second crossfades (the usual), a title card and an end card drawn from your brand kit, and captions if the shotlist has them. A sound from the room is added when the job names one; the clips' own sound is not used. It writes the film, a poster and six stills. The brand check and the Checker go over it. The poster of a film shows Runway's footage, so its colours are only noted against your palette; the cards are measured hard.
7. **Accept.** The finished film comes to Needs you as an ordinary card, to Accept or send back. It is not published or sent anywhere.

Studio's film view. In Studio, under "Films", every film shows as a row of shots: the storyboard, the clip and its stills, each take (Take 1, Take 2) with its credits, the picture that was sent to Runway (kept for one day, then "No longer kept"), the Art director's verdict ("Keep", "Retake: <reason>" or "Not looked at yet"), and at the top the total, such as "120 of 300 credits". While clips are being made it says "Runway may still charge for clips that are being made." The numbers are the door's own record, not what the Artist reports.

When something goes wrong:

- **Runway refuses a picture or prompt.** The take shows "Refused by Runway" and is not sent again. Two in one film freeze it and the film view says "Runway refused two pictures or prompts in this film. It needs you."
- **A limit is reached.** The door refuses the next clip. The clips already made are kept. Settings says "Today's limit is reached. Nothing more will be made until tomorrow, or raise the limit." The goal stops, blocked, with the door's sentence.
- **The shotlist is changed after you approved it.** The film view says so. The clips follow what you approved.
- **Runway fails or does not answer.** A job that fails shows as "Failed". A job Runway does not finish in 20 minutes is stopped and its cost stays counted. A take whose result could not be fetched safely is paid for but nothing is kept.
- **Your approval ends.** After seven days. The film view says "Approval ended". Nothing more is made for it.

## Variations and larger stills

Two small jobs, in Studio: "Variations of a still" (one to three versions of a picture from the room, changing only what you say) and "A larger, sharper still" (two or four times larger, up to 4096 pixels on the long side).

Pressing Start is your yes. The job page says the cost first, for example "Each variation costs 8 credits ($0.08) with gen4_image; three cost 24 credits ($0.24). Pressing Start approves the cost of the number you choose; nothing else is spent." Start then writes a batch of one try for each picture, and the Artist makes only those. If the cost is more than is left of today's or this month's limit, Start is refused and says so, and nothing is made. No small job runs without your Start.

## Previewing and exporting a site

Three jobs in Marketing make a page: "A landing page", "A project page for a property or a visualisation" and "A small site (up to six pages)". The Builder writes a static site of HTML, CSS and a little JavaScript, from your brand kit and the engine's site kit, with your own pictures copied in. Nothing is installed and nothing is fetched. You get three versions to choose from, the way you do for a carousel. The Builder, and then the Art director, look at each page in a real browser before it reaches you.

The page viewer is built and tested, not yet live: it goes live when the page viewer is started. Even then it is off until you turn it on, and nothing is sent anywhere: the pages are opened on this Mac, in a hidden Chrome that can reach nothing but the page itself.

Turn it on.

1. Chrome has to be installed on this Mac. The viewer uses it and never touches your own Chrome or its profile.
2. Open Settings on the home screen and find "Page viewer".
3. Press "Test". It opens a page built into the engine, nothing an agent made, and says "Chrome opened a test page and took <n> pictures in <s> seconds." It works while the switch is off, once the viewer is running. If it says "No Chrome was found on this Mac.", install Chrome. If it says the viewer is off, run `engine start`.
4. Turn on "Let pages be opened to take pictures". The page says "On. Only the Builder and the Art director can ask." If it will not switch on, it says why: the viewer is not running (run `engine start`), no Chrome was found, or the Builder and the Art director are not set up (run `engine setup`).

Settings also shows which Chrome version is used and how many pages were opened and refused today. While the switch is off, the Builder and the Art director are refused at once, and a page job stops with "The page viewer is off. Switch it on in Settings."

The pictures and the report on a task. Open the task of a page job. Under "How the site looks" you see each version's pages at computer width and at phone width, in light and, when the page has a dark setting, in dark. Each opens larger. Under "What the page viewer found" are plain sentences about what the page did in Chrome: errors, anything wider than a phone, pictures that did not load, addresses it tried to reach and was blocked from, missing descriptions and labels, text that is hard to read, and the typefaces and sizes it drew. With nothing to fix it says "Nothing to fix was found." Files that could not be part of the site are listed ("Left out of the site: <name> (<why>)"). "Take pictures again" asks for new ones. The pick card for three versions shows the first page of each at both widths. While the switch is off the task says "The page viewer is off, so there are no pictures of this site. Switch it on in Settings."

Open the preview. On a version, press "Open the preview". The site opens in a new tab of your own browser, on its own address, `http://127.0.0.1:3160/`, which is another origin than the home screen. It shows one site at a time, so opening another replaces it. A page there can reach nothing but itself. If it is not running the home screen says "The preview is not running. Run: engine start". The preview works whatever the switch.

Download as a zip. Press "Download as a zip" and the browser saves the version's files, only the files that are part of the site. It works whatever the switch.

Nothing is published. The preview is your own browser on this Mac, and the zip is a file. The engine never sends a site anywhere. To put one on the internet, you take the zip.

The brand check reads every page before a reviewer sees it, from its files and by code. It sends a page back when the kit's own style file was changed, when a colour or a typeface is not your kit's, when text is smaller than your kit's smallest, when an address outside the site is in a place a page loads from, or when the logo is missing from the header. It reads text and runs nothing: a colour or typeface a script sets while it runs is only caught by the viewer's report and the Art director's own look, not by the check. A link to another site is fine.

## App Studio: your apps

An app is a program the company made, kept in the repository as a folder, `apps/<name>/`, that runs on this Mac only. App Studio is the page that lists them, turns them on and off, and opens one inside the home screen. The first is Render to Film. You and the Artist both use it. An app reaches Runway and Higgsfield only through the engine, so the keys never go into it and one set of limits and one record of spending cover the Artist and every app.

It is built and tested, not yet live. It goes live when the App Studio part is started, after the engine has been told the first app is ready. Until then the Apps page says "Waits for App Studio." and Render to Film says "Not ready yet.". Everything below is how it works once it is on, and nothing is switched on for you.

Open an app.

1. Click "Apps" in the menu. Each app is a tile with its picture, its name and its state: "Off", "Starting…", "On", "Stopped. It could not start.", "Not ready yet." or "This app's description is damaged.".
2. Press "Turn on". The host starts the app inside its fence. It takes a few seconds; the page asks again every two seconds until the app answers. If it will not turn on, the page says why.
3. Press "Open". The app opens inside the home screen. "Open in its own window" opens it in its own browser tab on its own address, for example `http://127.0.0.1:3171/` for Render to Film. "Turn off" ends it.
4. An app that stops by itself is started again after five seconds. If it stops three times in ten minutes, it says "Stopped. It could not start." and stays stopped until you turn it off and on.

The bar above the app. The bar is the home screen's own. The app cannot draw over it or change it. It has the way back to Apps, the app's name and state, what the app may spend today, the model it thinks with, and "Open in its own window". This is where you decide about money, because an app's own screens cannot be trusted to ask for you.

The daily allowance. An app cannot spend anything until you say so. While nothing is allowed, the bar says "This app cannot spend anything right now." and every spending button in the app is off with "Allow spending in the bar above.". Press "Allow spending" and pick $2, $5, $10 or $20. The box says "What is left of today's limit: $X." and an amount over that is off. It ends at midnight in Kolkata, or the moment you press "Stop spending". The bar then reads "Allowed today: $5.00. Spent: $1.20.". Inside it, each click in the app spends without asking again, and each button shows its price before you click. It is a bound, not a promise: the app can spend up to it, and the daily and monthly limits in Settings still hold on top of it. Pressing "Stop spending" ends it at once. A job already at the service is still counted.

What the app thinks with. "Thinks with <model>." names the model that answers the app's own questions (its check of people in a render, its finding of close-ups, its storyboard planner and its editor's chat). It starts as the Art director's model and you can change it in the bar. It uses your model provider, so its cost is in Settings, Models, not in Generation's spending. It is held to 60 questions an hour and 300 a day for each app.

Where an app's files live.

- Its program and its notes: `apps/render-to-film/` in the repository. Nothing there changes when it runs except the two folders it builds, `.build` and `dist`.
- Its packages: `~/.paperclip/uuu-engine/apps/render-to-film/deps/`, with their store in `store/` beside it. They were fetched once, with your yes of 13 November.
- Its pictures, clips and documents: `~/.paperclip/uuu-engine/apps/render-to-film/data/`. This is the only place an app writes. `tmp/` and `home/` beside it are its scratch space.
- Which apps are on: `~/.paperclip/uuu-engine/apps/state.json`. What it may spend today: `doors/allowances/render-to-film.json`.
- What it printed: `~/.paperclip/uuu-engine/logs/apps/render-to-film.log`, cut when it passes 5 MB.

What an app cannot reach. It runs in a fence like the agents', built for apps. It can read only its own program, its own packages and folders, and Node. It can write only its own data. It can reach no internet and no port on this Mac, not even the board or the home screen. The only way out is one socket to the engine, which carries only what the app is allowed to ask: pictures and clips through the generation door, and thinking through the model relay. It cannot read your files, your keys or the Higgsfield sign-in, or another app's folder. No agent can reach an app either: the Artist is refused its address. Another page of yours cannot read an app, or an app the home screen, because each is its own address.

An app that is sick. Health shows one line: "App Studio is on. Open: Render to Film.", or "App Studio is on. No app is switched on.", or, if one has stopped three times, "<app> stopped three times; switch it off and on in App Studio." Its log has what it printed.

Known limits. There are no WebSockets or cookies in an app, and a plain form post is refused: the app sends its writes another way. A picture you give an app stays on this Mac; only the pictures it sends to a service leave it, inside your allowance. The sites the Builder makes do not appear in App Studio yet.

## Render to Film

Render to Film turns a render into cinematic stills, clips and a finished film. It was your app on Runway's own platform. It now runs here, with no Runway sign-in, no Runway credits and no Runway storage. It has seven tabs: Director (plans a film), Stills, Video, Close-ups, Location, Edit and Library.

Prices come before each button. Every button that spends shows its price before you click it, for example "About $0.40". It comes from the engine's own table, so it needs no network. A price the table does not have says "Price unknown", and nothing is made. A button is off with "Allow spending in the bar above." while no allowance is open. If a service is not ready, the button says which: "Needs a Runway key. Add it in Settings on the home screen." or "Needs Higgsfield. Switch it on and sign in from Settings on the home screen.". The header chip repeats what the bar above says.

Which service makes what.

- **Runway** makes most of it, through its public service and your key: Gen-4 Image, GPT Image 2, Nano Banana, Seedream and Grok Imagine for pictures, and Gen-4 Turbo, Gen-4.5, Veo 3.1, Seedance 2, Kling 3 and Hailuo 3 for clips, and the Precision upscaler for a larger still. The door always uses Runway when it offers a model.
- **Higgsfield** makes what Runway does not: FLUX.2 Max, Wan 2.6 and its 4K upscale of a picture.
- **This Mac** makes the cuts. Trim, join, captured frames and the final export are done by ffmpeg inside the fence.
- **Your model provider** does the thinking, as above.

What it cannot do yet. These are said on the screen, in plain words, where they come up.

- **Higgsfield jobs that start from a picture.** FLUX.2 Max and Wan 2.6 both need a picture sent to Higgsfield, which is held until the upload address is known. See "Connecting Higgsfield".
- **Two Higgsfield models have no price:** Wan 2.6 and the 4K upscale. They say "Price unknown", and nothing is made with them. Two of Runway's GPT Image variants have no price in the table either.
- **AI grades and edits of a clip (Runway's Aleph)** and **clip upscale** are left out. The screens say "AI grades and edits of a clip are not available on this Mac yet. Use the built-in look." and "Clip upscale is not available on this Mac yet." The built-in look on the Edit tab stays.
- **Dropped presets:** Krea Image 3 and LTX-2.5 Pro (a model no service here offers), Gen-4.5's frames in between, and negative prompts and seeds.
- **Small things known:** the Edit tab's caption can read "8s" for a film of 7.5 seconds with fades; a label can still read "Reviewed by Claude Opus 5.5" though the model is the one you picked; and one error on saving to the library still says "Runway account".

The Artist knows Render to Film's recipes, as words, in a playbook. It never opens the app and cannot spend what the app can: it makes clips and pictures only inside a batch you approved (see "Making a film").

## Connecting Higgsfield

Higgsfield is a second paid service for pictures and clips, beside Runway. It is not live yet, and it is off until you sign in and switch it on. Nothing is sent to it while it is off.

1. Open Settings, then Generation, and find "Higgsfield".
2. Read the warning, which is always shown: "Higgsfield's terms let it use what you send, and what it makes, to train its models unless you turn that off in your Higgsfield account. Do not send client work you may not share." Higgsfield's own pages document a way to turn this off only for its developer service, not for the way the engine signs in, so do not count on it. Keep Higgsfield off for any work that is not yours to share.
3. Press "Sign in to Higgsfield". Higgsfield's own page opens in a new tab. Sign in there and say yes. You come back to Settings, which says "Higgsfield is connected." If it says "The Higgsfield sign-in did not finish. Try again.", press the button again. The engine keeps the sign-in in a file only the generation door can read; you never type a password or a key into it.
4. Set the rate, "One Higgsfield credit counts as (cents)". It starts at 5. Your plan is not in Higgsfield's public price list. Plus is about 5 cents a credit; change the number to match your plan. It turns Higgsfield's credits into cents so every price you read is in dollars, and changing it does not change what you already approved.
5. Press "Test". It asks Higgsfield how many credits you have, costs nothing and works while the switch is off. It says "Higgsfield says you have <n> credits." Waiting can take up to 75 seconds.
6. Turn on "Use Higgsfield". The page says "On. Your apps and the Artist may use it, inside what you approve." The Artist and apps may then use a Higgsfield model: in a film or a still job, once you choose one in Settings, Models, and in Render to Film, where the button names the service.

"Higgsfield asked you to sign in again." means the sign-in ran out: press "Sign in to Higgsfield" again. "Sign out of Higgsfield" deletes the sign-in. If you sign out, the switch can stay on; Settings then says "On, but not signed in." and nothing is sent.

What is held. The door sends a picture to Higgsfield only to an upload address it has been told to trust, and Higgsfield names that address when it answers, which the door does not know yet. It will not guess one. Until it is known, every Higgsfield job that starts from a picture is refused with "The door does not know Higgsfield's upload address yet, so no picture can go to Higgsfield. Nothing was spent." That is FLUX.2 Max and Wan 2.6. Runway jobs are not touched. Settings does not say this yet; the refusal does. Higgsfield's first real answers are checked at your first sign-in and your first job.

What it costs and how it is kept safe. A price always comes from the engine's table, never from Higgsfield's answer. Just before a job, the door asks Higgsfield its live price, and if that is higher than the table's it makes nothing ("Higgsfield's price for this is higher than the door's table, so nothing was spent."). A job that fails or is refused on safety grounds still counts as spent unless Higgsfield says it cost nothing. A refused one counts toward the same three-a-day pause as Runway's. Runway and Higgsfield share one daily and one monthly limit, in Settings, in dollars.

## Cook: how visual work is made here

Cook is a way of making visual work in rounds, until it holds up beside real references. It is a third party's playbook under the MIT licence, kept here word for word with its licence, and it is the default for pages and sites (the Builder), films, stills, carousels, posters and title cards (the Artist) and every review (the Art director). Its loop, in five lines:

1. **Start from references.** Your own pictures and the files the task names, and the references your brand kit lists with your reasons. They are the bar, not loose inspiration.
2. **Make a target.** The three versions are the target: one for each direction. You pick one.
3. **Set a number.** Before building, the maker writes a score out of 10 for each of composition, light, colour, materials, detail and motion into `cook/BRIEF.md` in the task's folder, and starts a ledger, `cook/ROUNDS.md`.
4. **Round after round.** Design first, motion second. Each round puts the reference on the left and the work on the right in one picture; the Art director, who has seen none of the build, scores it with numbers; the maker fixes the weakest part and logs it. Your picks and notes calibrate the Art director's scores.
5. **Stop at the bar, or at the limit.** A round happens inside one step, within its time, the three tries and the batch you approved. When the time runs out first, the maker says plainly what is still below the bar. Nothing is published, and anything that spends waits for your approval.

Cook's own hours and usage pacing are not used; the job's own limits are. Its helper script is not installed and its colour check, which needs a library this Mac's art tools lack, is done another way or marked "not measured". Its files are in `cook/` inside the task's folder, never in a piece's folder. They are the same for the screens of the engine itself, which are being redone this way.

## What is switched off

Each is an off switch or an account step. Nothing is done for you.

- **Generation.** Off until you save a Runway key and turn it on (see "Turning on Generation"). Nothing is sent to Runway and nothing is spent while it is off.
- **Higgsfield.** Off until you sign in and turn it on (see "Connecting Higgsfield"). Nothing is sent to it while it is off.
- **Apps.** Off until the App Studio part is started and you turn an app on (see "App Studio: your apps"). An app that is off runs nothing and spends nothing.
- **Anything that needs the internet.** Agents have no internet, so jobs that would look things up online stay dim, with the reason shown. The one exception is the Researcher, once you switch on the web (see "Letting the Researcher use the web").
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

## Using Omega Plus

Omega Plus is a paid service that offers many models behind one key. It is run by SingleByte Infotech Pvt Ltd, at `api.omegaplusapi.com`. It is off by default. The engine works as before until you do these steps. Provider mode has not been switched on here yet, so the first real use is yours.

1. Get a key from your Omega Plus account.
2. Open Settings on the home screen and find "Models".
3. If it says the list of models has not been read, press "Read the list".
4. Paste the key into "Provider key" and press "Save key". The field is empty again, and the page says "A key is saved". The key is never shown again.
5. Press "Test". It says whether the key works, shows your plan and what is used, and asks each picked model a one-line question.
6. Look at the table. Each agent has a model picked for it. You can change any pick from the list. A choice marked "not ranked" is one the engine would not pick by itself.
7. Turn on "Use Omega Plus for the agents". Nothing else is needed. Each agent's next run uses it.
8. Open Health and run the proof, to check that the fence holds.

To switch back, turn the switch off. Your agents use your Claude and Codex plans again, exactly as before. "Remove key" also switches it off and deletes the key.

What is sent where:

- Everything an agent reads and writes in a task goes to Omega Plus. Omega Plus decides which model answers under each name. Its own documentation says a name does not guarantee a particular model, so this cannot be checked from here.
- Your key stays outside the fence, in the secrets folder. Only the model relay uses it. Agents can reach only the gate and the model relay, and no outside host at all.
- Your Claude login is never sent to the relay or to Omega Plus.
- Your Codex login cannot be read by the Checker while Omega Plus is on.
- If Omega Plus ever quoted your key back in an answer, the relay withholds that answer. It looks for the key as written and in its usual escaped forms.
- Each agent is held to the model picked for it. Nine agents run on the Claude program, so they get the best Claude-named model the list has (Fable 5.1 first). The Checker stays on the Codex program with the best GPT-named model, so its checks come from a different maker.

If something goes wrong:

- **Limit reached.** Omega Plus has usage limits. When one is reached, agents cannot work until it resets, and Settings says so.
- **Key refused.** Settings says "Omega Plus refused this key." The Claude program tries again for a few minutes before a run fails. Paste the key again, or remove it and switch off.
- **The model relay is off.** Run `engine start`.

The installer script from Omega Plus (`omega-helper.sh`) is not needed. Do not run it.

## What would turn this on later

None of these is built or running. Each is a choice for later. Settings lists them as off.

**Other chat apps as extra windows.** LobeHub, Open WebUI, Cherry Studio or Jan could talk to the company through an address that looks like OpenAI's. It would turn on if you want to chat with the team from one of those apps. The home server would need that address added.

**A separate workflow engine.** Kestra could run long scheduled workflows. It would turn on if routines stop being enough. It needs about 4 GB of memory while it runs.

**A free helper model on this Mac.** Ollama is already installed. A small model could do small jobs without using your plans. It would turn on if you have the disk. Expect about 5 GB of disk and 4 GB of memory while it runs.

**Editing sprites in place.** Piskel, a free pixel-art editor, could be served from the home screen so you can touch up a sprite by hand. It would turn on if you want to edit by hand rather than ask the Artist again. It is a small download.

**Previewing Aseprite files.** The Studio could show files from Aseprite if you buy or compile your own copy for personal use. Its licence does not let the engine ship or run it, so the engine will never install it. Ask for the preview once you have it.

## Where things live

- The engine's state: `~/.paperclip/uuu-engine/`. It holds the company records (`books/`), agents' task folders (`tasks/`), lessons (`lessons/`), the company brain's files (`knowledge/docs/`), the Drafter's and Artist's tools (`cad/`, `art/`), your footage and the speech model (`media/`) and the last proof (`proof/last.json`).
- Playbooks: `~/.paperclip/uuu-engine/playbooks/` (one folder each, with `index.json`). Made by `engine/playbooks/install.sh`. Every agent reads them, none writes them.
- The brand kit: `~/.paperclip/uuu-engine/knowledge/docs/brand/kit.json`, with `kit.css`, `brand.md`, your fonts in `fonts/` and the taste file `taste.md` beside it. Only the home server writes them. The brand's short public summary is `knowledge/shared/brand-public.md`.
- Omega Plus settings: `~/.paperclip/uuu-engine/models/state.json` (the mode, the picks, the last list of models) and `relay-status.json` beside it (what the model relay has seen). The key is `secrets/provider/omega-key` and the relay's own secret is `secrets/provider/relay-secret`. Agents cannot reach any of them.
- The web door's switches and lists: `~/.paperclip/uuu-engine/doors/state.json`, and what it opened: `doors/web-visits.jsonl`, with `web-status.json` beside it. A Brave search key, if you add one, is `secrets/doors/search-key`. Agents cannot reach any of them.
- Generation: the switch, the limits and the models are in `~/.paperclip/uuu-engine/doors/state.json` beside the web door's, with Higgsfield's switch and its cents per credit. The Runway key is `secrets/doors/runway-key`. The Higgsfield sign-in is a file in `secrets/doors/`, named `higgsfield-oauth.json`; only the generation door reads or writes it, and it is never shown here. Agents cannot reach any of them.
- Apps: their programs are in `apps/` in the repository, one folder each. Each app's packages, data and scratch folders are in `~/.paperclip/uuu-engine/apps/<name>/` (`deps/`, `store/`, `data/`, `tmp/`, `home/`), the owner's switches in `apps/state.json` beside them, and the sockets an app uses while it runs in `run/apps/<name>/`. Only the app's own fence can reach its folders, and no agent can reach any of them.
- What an app may spend today: `~/.paperclip/uuu-engine/doors/allowances/<name>.json`, one small file each, written only by the home screen and read by the generation door. It ends at midnight in Kolkata.
- Your approvals for films and still jobs: `~/.paperclip/uuu-engine/doors/batches/`, one small file each, written only by the home screen. They are removed 30 days after they end.
- What was spent: `~/.paperclip/uuu-engine/doors/generate-ledger.jsonl`, written only by the generation door, with dated copies of old months (`generate-ledger-<date>.jsonl`) beside it.
- The generation door's work folder: `~/.paperclip/uuu-engine/doors/work/gen/`. It holds the pictures sent to Runway (for one day) and the clips and pictures Runway made (for two days), and the job records. The clips and pictures you keep are copied into the goal's folder by the Artist. Agents cannot reach this folder.
- Page viewer: its switch is in `~/.paperclip/uuu-engine/doors/state.json` beside the other doors', and what it counted is `doors/viewer-status.json`. Agents cannot reach either.
- The viewer's work folder: `~/.paperclip/uuu-engine/doors/work/view/`. It holds one site for the render that is running and is removed when the render ends. Agents cannot reach this folder.
- The home screen's pictures of pages: `~/.paperclip/uuu-engine/home/shots/`, one folder for each version's files, at most 500 MB in all, oldest removed first. Only the home server writes there; agents cannot read it.
- The site kit: `~/.paperclip/uuu-engine/playbooks/site-kit/`, copied there by `engine/playbooks/install.sh` from `engine/site-kit/`. Every agent can read it and none can change it.
- The Researcher's notes: `~/.paperclip/uuu-engine/tasks/research/<goal>/`. Files you shared with it: `knowledge/shared/`.
- Logs: `~/.paperclip/uuu-engine/logs/`. One file per part, including `relay.log`, plus `gate-refusals.log`, which lists what the gate turned away. Each app's own output is `logs/apps/<name>.log`.
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

Six trials ran at the same time on the live engine with the new interface, all with made-up values marked TRIAL. Nothing was sent out. Six at once is the hardest case: every task goes through the Chief of staff, so most of each time below was spent waiting in line.

| Trial | Result |
|---|---|
| One question to the brain | Passed: "How long is our warranty?" was answered in about 40 seconds on an idle engine, with the file named and the answer labelled Not checked. |
| Ask the brain, forms and files | Passed in part: four questions were answered correctly. Adding a file by paste, a picture, a table and a PDF, moving, deleting and the forms all worked, and every refusal was right. Behind five other trials each answer took 33 to 50 minutes; the answer itself took 1 to 3. |
| The chain, from a call to an invoice draft | Passed in part: the call write-up, the proposal, the quotation (₹22,066, approved) and the invoice draft followed one another with nothing copied by hand, and the figures agreed everywhere. The write-up needed three check rounds because the job and its pack disagreed. |
| Books | Passed: an invoice was drafted and approved. "Unpaid invoices with follow-ups" and "GST summary for a month" each had 9 of 9 figures right. |
| Marketing | Passed in part: five concepts, an announcement sent back and redone to the note, and a five-slide carousel laid out by code in the brand's colours. The recipe log and the dashboard's list of concepts showed the wrong things. |
| Studio video | Passed in part: a title card, a slow reveal over two pictures and captions on a spoken clip were all made and accepted. Three caption faults in the video tool got past the Checker. |
| Six other jobs | Passed in part: all six finished and were accepted, none invented anything, and the three dim jobs refused with the right sentence. Every one needed two check rounds. |

After the fixes were applied to the live engine, three were proven again on it:

- A question to the brain was answered in 45 seconds, in plain sentences, with its four files named.
- The same job started twice made two tasks, each with its own answers. Both passed their first check, in 10 and 11 minutes.
- Captions were made again with the fixed tool: the first caption appears as the voice starts (2.0 seconds in), no frame shows two captions, and they break at sentence ends. It took 43 minutes and three check rounds; the first two failed on the notes beside the video, not the video.

What to expect:

- On an idle engine a question to the brain takes about a minute, and a job takes 10 to 25 minutes of work.
- Tasks queue. With six trials open, jobs took 14 to 133 minutes from start to finish, and most of that was waiting. The home screen now says so ("Waiting its turn: 3 tasks are ahead of it.") and no longer promises "a few minutes".
- The first check often fails and the second passes.

What the trials changed (52 findings: 51 fixed, one left as a ticket):

- Starting the same job twice makes two tasks. Before, the second start landed on the first task and the recipe log described the wrong work.
- After you answer an agent's question, the task says "Your answer is waiting its turn". Before, it showed a red "blocked" card with Try again for up to 55 minutes.
- A draft quotation's or invoice's card lists its lines, so you see what you approve. "What can come next" sits at the top of an accepted task.
- Captions: none before the voice starts, never two at once, breaks at sentence ends. A video's length is kept to one decimal.
- The recipe log keeps one row for every Accept and Send back. The Marketing dashboard lists the concepts.
- Answers are plain sentences, and a long comment from an agent folds behind "Show all".
- The call write-up job and its pack now ask for the same parts. Forms ask for what the books need: a unit, a tax code, the company's state.
- Support's login can now read who raised a request, so a reply can be drafted to the right person. The books grant this by group of fields, so it also reads the request's priority, type, team, response times, contact and customer. It can change none of them.
- A task that waits on you stays in Needs you until you answer it. The final review found that an agent's queued run could hide it for a while.
- A second question or typed task with the same first line as an open one is a new task. Before, the board quietly kept the old one.
- Agents' instructions: results name files by their titles; a slide that uses a company picture uses a real one; a manifest is never edited by hand; a point of wording is a note on a pass, not a fail.

Known limits:

- You cannot check a GST split by month from the home screen yet (`.scratch/company-engine/issues/23-tax-by-month-on-the-books-dashboard.md`).
- The Checker cannot always open pictures; when it cannot, its check says so.
- Every record the trials made was removed: in the books, the company brain, the room and the task list. The four starter packs the trials added to the brain stay (carousel, captions, call write-up, proposal), and the nine basics are empty again for you to fill.
- Still there from the first trials: three Marketing drafts in Needs you, eight finished tasks, and the helpdesk's own sample request.
