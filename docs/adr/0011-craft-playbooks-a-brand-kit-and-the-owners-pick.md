# 0011: Craft playbooks, a brand kit, and the owner's pick

## Context

On 12 November 2026 the owner asked for outputs that are not "AI slop": the brand book, the marketing and everything else in the company's files must be followed through, with the best design, copywriting and film skills behind it. The owner then said yes to four upgrades. This record covers the first one only: the playbooks, the brand kit, the check by code, the Art director, versions with the owner's pick, and the taste file. The others (a Researcher on the internet, Runway, real front-end builds) have their own records.

Until now nothing mechanical enforced a colour or a font. The brand was one free-text file. The only reviewer was the Checker, which keeps facts, figures and "does it do what was asked", and whether it sees a picture at all was never proven. An agent that made a picture was also the only one that looked at it. There was no way to ask for several versions and choose.

Nothing of this step is live yet. It is built and tested. It goes live with the next restart of the home screen and `engine setup`. Every rule stands as before: this Mac only, the owner is the only person, the fence is never loosened to make something work, and what runs unfenced never trusts what agents can write (`0007`).

## Decision

**Playbooks come from the owner's own skill folders, are read by path, and live outside the repo.**

- The owner said yes to giving agents craft playbooks from the skill folders in `~/.claude/skills/` on this Mac. There are sixteen: ten the owner wrote, six a third party wrote (their licences are kept beside them, or the note says none was found).
- `engine/playbooks/install.sh` copies only the files a manifest names, ending in `.md`, `.txt` or `.json`, at most 512 KB a file and 20 MB in all, into `<state>/playbooks/<name>/`. It never copies a whole folder, a script, a picture, a font, `.venv`, `node_modules` or a link that leaves its folder. Nothing is downloaded.
- The repo holds only `engine/playbooks/manifest.json`: names, file lists, roles, kinds of work and a short note in our own words. No playbook text is in the repo, because the repo is on GitHub and some playbooks are a third party's work.
- Each copy gets `IN-THIS-ENGINE.md`. It says what the playbook assumes that an agent here lacks (a browser, the internet, a paid tool, an install) and what to do instead. The brand kit outranks any colour, typeface or logo a playbook suggests.
- Agents read playbooks as plain files in a read-only folder, named in the task text ("Read first, from the playbooks: ...") and in the maker's role. Neither program loads them as skills. That works the same for both programs, and a test can check it. Nobody can write there: it is not on any fence's write list.

**The brand kit is data, not one text file.**

- `brand/kit.json` in the company brain holds the colours by name and role, the two typefaces, the smallest sizes, the logo files and their clear space, the margins, the voice with do and don't examples, the owner's reference pictures with the owner's own reason each is good, and what the Researcher may see. Only the home server writes it, from the owner's typing and uploads on the Brand kit page in Files. No agent can.
- Each save also writes `kit.css`, `brand.md` (so every job that reads the old brand page still works) and a short public summary. The art tools, slides, title cards and captions take their colours, type and logo from the kit.
- The job "Read the brand book" may propose values from an uploaded brand book. The owner accepts part by part. Agents never invent company facts, and nothing is saved until the owner presses Save.
- Until the owner saves a kit, nothing is enforced and the tools behave as before.

**A brand check by code runs before any reviewer.**

- `engine/art/brandcheck.py` finds the pieces by listing the goal's folder itself and measures them. It checks colours off the palette (on pictures made by script, from flat areas, so photographs are not judged), a claimed company picture or logo against the pixels, the logo's presence, size and clear space where the kit asks for one, a script that loads a typeface itself, the owner's can't-say list, a shipped list of machine-sounding filler, and versions that are near copies. It writes nothing.
- Nobody reads another's report. The maker runs it to fix things before reporting. The Chief of staff runs it before any reviewer's step, and a failed hard rule goes back to the maker with the tool's own lines, so no reviewer's time is spent. The Art director runs it before it scores. The home screen runs it inside the fence under an identity of its own, so a hostile picture is never decoded outside the fence. A maker cannot forge a report that nobody reads.
- It cannot read type from a picture. So the tools refuse off-kit type and the check scans the script, as a deterrent, with the Art director's eyes behind it.

**The Art director looks, and the Checker stays last.**

- A new agent, the Art director, reviews the craft of finished pieces against the kit and the references. It runs on the Claude program because that program can open pictures. In plans mode it is on Opus and the makers are on Sonnet. In provider mode its ranking puts Opus first so it differs from the makers where the list allows. Whether a provider's model really sees pictures cannot be checked from here.
- It reads the kit, the taste file and up to six references of the kind. For each piece it first writes the three weakest things it sees, pointing at places, then argues against its first verdict, then scores seven axes from 0 to 10: brand, hierarchy, composition, finish, idea, voice, kind. A score with nothing under "Seen" does not count. A piece meets the bar when every axis is at least 6 and the total is at least 52 of 70. The home screen works that out from the numbers, never from the Art director's word.
- It looks and never changes: it cannot write in the task folder and never picks a version. It does at most two rounds. After a second fail the work goes on with its scores and the owner sees them.
- The order for a job with an art review is maker, brand check, Art director, Checker, owner. The Checker is last because it is the gate on facts, and the Art director's actions can change words. For such a job the Checker no longer scores brand fit. Jobs with no art review and one version run as before and as fast.

**Versions are different directions.**

- A job may offer one version or three. Three versions are three different directions of the kind (for a carousel: type led, picture led, diagram led, split, sequence; the lists are in `engine/company/brand/directions.json`), one piece each, never three takes on one idea. That makes "three different" checkable, lets a later round use fresh ones, and gives the taste file words that mean something.
- Each version is checked and scored on its own, never against the others.
- The job page says what it costs in time before Start. Three versions with an art review take about twice as long as one. "One (fastest)" is always there.

**The owner's pick and the taste file.**

- Needs you shows the versions side by side with their scores and one-line reasons. The owner picks one, asks for another round, or sends all back with a note. The pick is the acceptance: one touch.
- The home server records it, adds a row to the recipe log (now Marketing and Studio) and writes a line to `brand/taste.md`: the kind, the date, the direction titles from the repo's list and the owner's own note. Only the home server writes that file, only from the owner's choices and words, never from anything an agent wrote. Makers and the Art director read it before the next piece of that kind.

## What no rule can promise

No rule can guarantee taste. What is done instead: real inputs (the owner's own renders, pictures and references, not a text prompt), a code check that fails on measurable breaks, a reviewer that must say what it looked at and scores each version on its own, versions as different directions for the owner to choose between, and the owner's choices remembered in the owner's own words. The Art director is another model run, not a person, and the brand check does not see type in a picture. The owner's pick is the final judge.

## Consequences

- More stages mean more waiting for the jobs that use them. Single-version jobs with no art review keep today's speed.
- One more agent, the Art director, and one more tool identity for the brand check, both made by `engine setup`.
- The fence gains read-only access to `<state>/playbooks` for every agent that has a policy. Nothing else about a run's reach changes for this step.
- The hole that let one agent's program settings load in another agent's run is closed in the same step (`0012`).
- Cut for speed, and said here: the logo's clear space is measured to the picture's edges only; text on a picture is not read back from pixels, only the declared words are checked; no history of kit versions; the taste file is a list, not a model of taste; fonts on pages are the kit's files with no subsetting.

## Rejected

- Copying playbooks into the repo: some are a third party's work and the repo is on GitHub.
  - One exception, made on 14 November 2026 at the owner's request: `cook`, a third party's loop for making visual work, is kept in the repo word for word (`engine/playbooks/own/cook/`). It is under the MIT licence, which allows this if the licence stays beside the copy, so `LICENSE.md` is kept with it, and the repo is the owner's own private one. It is installed as an own playbook with an engine note, and only its notes are copied, never its script. The owner's own Render to Film recipes are kept the same way. Every other playbook is still only listed.
- Copying whole skill folders: some hold programs, install lines and a 514 MB virtual environment.
- Loading playbooks through a program's own skill loading, or linking them into an agent's home: it works for one program only, depends on discovery rules the fence now restricts, and the agent's home is writable.
- A report file written by the checking step: a file in a shared task folder can be forged by the maker.
- Three takes on one idea as "versions": near copies, and nothing to learn about the owner's taste.
- A pick in the middle of the task followed by a finishing step and a second Accept: slower, and two touches.
- Letting the Art director pick: the owner picks.
