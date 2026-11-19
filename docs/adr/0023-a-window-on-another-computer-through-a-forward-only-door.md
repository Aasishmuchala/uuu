# 0023: A window on another computer, through a forward-only door

## Context

On 19 November 2026 the owner said: "AND IT NEEDS TO BE WINDOWS AND MAC APP", then "DONT STOP UNTIL ITS LAUNCH READY FOR MAC AND WINDOWS", and chose "Mac now, Windows next". The Mac app is `0020`. This record is the Windows half.

The rules that stood until then:

- This Mac only. No phone or remote access.
- The home screen, and every engine server, listens on `127.0.0.1` only (`0003`, `0015`, `0016`).
- The owner is the only person.
- Nothing leaves the building. Nothing is downloaded without the owner's yes. Free software only.
- Only the owner presses Test, saves keys, switches things on and opens allowances.
- The fence is never loosened (`0004`), and what runs unfenced never trusts what agents, apps or pages can write (`0007`).

The engine cannot move to Windows: its fence (sandbox-runtime, Seatbelt) exists only on macOS. And `0020` listed what a remote client would need: encryption, a way to know who is calling, no engine switch, no keep-awake, and App Studio's frames on another host. Each of those is a server change unless the PC's browser can see the very same addresses the Mac's does.

The owner's answers on 19 November 2026 (PLAN-DESKTOP O1 to O9): yes to a window on this Mac over the office network through a forward-only door, off until the owner turns it on from this Mac (O1); only the owner sits at the PC for launch (O2); the PC may do everything except keys, Test, switches, sign-ins, limits, allowances and anything with a price (O3); there is a Windows 10/11 PC on the same network and a USB stick (O4); no outside access, no Tailscale (O5); keep the Mac awake while the door is on and on power (O8); no Windows test-tool downloads (O9). On the review's L1 the owner decided: money stays on the Mac, so a PC may not stop a job or a task with an open approval.

## Decision

The engine does not move. "Company Engine" on Windows is a window on a PC that shows this Mac's home screen, reached through a door on the Mac that can do nothing but forward a few of the Mac's own `127.0.0.1` ports.

### DW1 to DW8, as built

1. **DW1. The engine stays on the Mac,** inside the same fence. Its data, keys and agents never reach the PC.
2. **DW2. A forward-only door, and on the PC a window made from what Windows already has.** On the Mac, one new part, the remote door (`engine/parts/41-remote.sh`): the Mac's own `/usr/sbin/sshd`, run as the owner with no administrator password and no system setting changed, from a configuration the engine writes at every start, on port 3220. On the PC, a "Company Engine" shortcut runs `open.ps1`, which starts Windows' own `ssh.exe` hidden to carry the PC's `127.0.0.1:3200` (and for a desk seat `127.0.0.1:3160` to `3169` and `3171` to `3189`) to the Mac, then opens Microsoft Edge in app mode (`--app=http://127.0.0.1:3200`) on a profile of its own with no extensions. Because the PC's browser sees the same addresses as the Mac's, every Host check, same-origin check, `frame-src`, `frame-ancestors` and per-app port works unchanged, and no HTTP server binds anything but `127.0.0.1` on either machine. The link is encrypted and both ends are pinned ed25519 keys, so there is no certificate, no password and no TLS. Nothing is compiled, so nothing is signed: the kit is two PowerShell scripts, a `.cmd`, an icon and text files the engine writes. Nothing is downloaded on either machine.
3. **DW3. Who is at the PC is known by the door they came through.** The home server listens on five more `127.0.0.1` ports, 3201 to 3205, one per seat. A seat's key may forward only to its own seat port, so a request arriving on 3201 is seat 1. The seat is read only from `req.socket.localPort`, never from a header. No cookie, no session, no login page.
4. **DW4. Roles, refused by default.** `owner` is the Mac's own port 3200, unchanged. `desk` reads everything and may make only the changes in `DESK_MAY`. `view` reads only and gets no app ports. Every change from a seat that is not on the list is answered 403, `mac_only`, "This is done on the Mac.", before its body is read.
5. **DW5. Only a Terminal on the Mac opens the door or adds a PC.** `engine remote on`, `off`, `allow` and `remove` refuse unless stdin is a terminal ("Run this yourself in Terminal.") and then need a typed `yes`. No page, route, agent or seat can do any of them.
6. **DW6. Same office network only.** The door's `AllowUsers` lets the owner's account in only from `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` and `169.254.0.0/16`. No port forward on the router, no relay, no Tailscale.
7. **DW7. The spike while planning** (loopback, temporary key): a user-run `/usr/sbin/sshd -D -f <config>` with `UsePAM no` starts without root; a key marked `restrict,port-forwarding,permitopen=...` reaches its port and is refused another (`administratively prohibited`); a command gives nothing (`ForceCommand /usr/bin/false`, `PermitTTY no`); `-R` is refused; no key gets `Permission denied (publickey)`.
8. **DW8. Testing without a Windows PC.** The Mac side is proved with the Mac's own `/usr/bin/ssh` using the very argument list the PC uses (`ssh-args.txt`, read by both). The PC's scripts are read line by line in both reviews. "Launch-ready" means kit made, Mac side proved, both reviews clean, checklist written; "launched" means the checklist passed on the real PC.

### The pinned interfaces, as built

**Ports.** `engine/config.json` has `ports.seats` 3201 and `ports.remote` 3220, and `remote.seats` 5. Seat `n` is port `3200 + n`.

**State.** `<state>/remote/seats.json` (`{ "seats": [ { "n", "name", "role": "desk"|"view", "state": "waiting"|"allowed", "fingerprint", "added" } ] }`, at most 16 KB, written only by `engine remote`, write then rename); `<state>/remote/seat-keys.json`; `<state>/remote/authorized_keys` and `<state>/remote/sshd_config`, both rebuilt from a fixed template and the seats at every start, never edited in place; `<state>/remote/on` (the marker); `<state>/secrets/remote/host_ed25519` (made once, never printed); `<state>/logs/remote.log`. Folders 700, files 600. Every reader (the home server and the door) checks a real file, not a link, the owner's, with no group or other bits, under a size cap; anything else counts as "no seats", so every seat port is refused and the door will not start.

**The door's configuration**, every line, checked back with `sshd -T` by the tests: `Port 3220`, `AddressFamily inet`, `ListenAddress 0.0.0.0`, `HostKey <secrets>/remote/host_ed25519`, `HostKeyAlgorithms ssh-ed25519`, `PubkeyAcceptedAlgorithms ssh-ed25519`, `AuthorizedKeysFile <state>/remote/authorized_keys`, `PidFile <state>/run/remote.pid`, `UsePAM no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PubkeyAuthentication yes`, `PermitRootLogin no`, `AllowUsers <owner>@10.0.0.0/8 <owner>@172.16.0.0/12 <owner>@192.168.0.0/16 <owner>@169.254.0.0/16`, `AllowTcpForwarding local`, `PermitOpen` the union of the allowed seats' ports, `PermitTTY no`, `ForceCommand /usr/bin/false`, `MaxSessions 0`, `X11Forwarding no`, `AllowAgentForwarding no`, `AllowStreamLocalForwarding no`, `PermitTunnel no`, `GatewayPorts no`, `PermitUserRC no`, `PermitUserEnvironment no`, `StrictModes yes`, `MaxAuthTries 2`, `LoginGraceTime 20`, `MaxStartups 3:50:6`, `ClientAliveInterval 30`, `ClientAliveCountMax 3`, `LogLevel VERBOSE`. No `Subsystem`, no `AcceptEnv`, no `Banner`. It runs as `/usr/sbin/sshd -D -e -f <state>/remote/sshd_config` with an environment of `PATH=/usr/bin:/bin:/usr/sbin:/sbin` only. Its output goes through a small writer that puts the time (UTC) before every line and appends to the log, opened 600 and never through a link (the review's L4; the plan had `-E <log>`, whose lines carry no time). Nothing else writes that log: `engine status`, `start` and `stop` drop the remote part's errors instead of appending them (the second look's S3). The door refuses to start, with `The remote door could not start: <reason>.`, when the seats fail the rule above, no seat is allowed, a folder on the way can be changed by others, its ports overlap the engine's own, the host key is missing or not private, or `sshd -t` fails. While the door runs and the Mac is on power, `/usr/bin/caffeinate -s -w <the door's pid>` keeps the Mac awake and ends with the door (O8).

**A seat's line in `authorized_keys`.** Only the 68-character key comes from the PC; the options and the comment are the engine's.
- desk: `restrict,port-forwarding,permitopen="127.0.0.1:<3200+n>",permitopen="127.0.0.1:3160"` to `3169`, `permitopen="127.0.0.1:3171"` to `3189`, then ` ssh-ed25519 <key> seat-<n>`.
- view: `restrict,port-forwarding,permitopen="127.0.0.1:<3200+n>" ssh-ed25519 <key> seat-<n>`.
- Never forwarded for anyone: 3200, 3100, 3110, 3111, 3120, 3130, 3140, 3150, 3170, 3190, 8120, another seat's port, or any other port.

**A seat request** (`seat-request.txt`, written by "Set up"): exactly one line matching `^ssh-ed25519 [A-Za-z0-9+/]{68}( [ -~]{0,64})?\r?\n?$`, at most 200 bytes, a real file, accepted by `ssh-keygen -l`. Anything else: `This is not a seat request made by "Set up.cmd".`, exit 1, nothing written.

**Commands** (`engine remote <word>`):
- `status`: `remote door: off` or `remote door: on, <k> PC(s) allowed`, from the part's health, that is the running door, never from the marker alone (the review's M2). Also one line in `engine status`.
- `kit <existing folder> [--name "<words>"] [--role desk|view]`: reserves the lowest free seat as `waiting` (default `Windows PC`, `desk`), makes the host key if missing, writes the kit, prints its folder. A sixth: `Five PCs are already listed. Remove one first.`
- `allow <seat-request.txt>`: checks the request, prints `This PC's code: <fingerprint>`, `It must match the code the PC showed.` and then `PC <n> (<name>) asks to join as <role>. Type yes to allow it.` (the review's L2). A request whose comment names a seat that is not waiting is refused before any question: `That PC is not waiting to join. Nothing was changed.` One that names none takes the first waiting seat. On `yes` the seat is filled only if it is still the one shown, `authorized_keys` is rewritten, and the door is restarted if it is on or running.
- `seats`: one line per seat: number, name, role, state, fingerprint.
- `remove <n>`: removes the seat and its key; if the door is switched on or running it is stopped, which ends every connection, and started again only if a PC is still allowed. When no PC is left, the door is also switched off (the marker goes, and it says `remote door: off`), so `engine start` does not fail on it (the second look's S2). A stop that fails is said and the command fails.
- `on`: writes the marker and starts the door; if the start fails, the door is stopped before the marker goes, and the marker stays if that stop fails too. `off`: stops the door, then removes the marker only if the stop worked. `engine start` starts the door only when the marker exists, and last; `engine stop` stops it first.

**The home server on a seat port.** It listens on `127.0.0.1:3201` to `3205` always, and checks each listener's own address after binding. Host must be exactly `127.0.0.1:3200` or `localhost:3200` (what the PC's browser sends); the same-origin rule is the existing one. A port with no `allowed` seat, or a `seats.json` that fails the rule, answers every request 403, `seat_unknown`, "This PC is not allowed to open the engine.", read again on every request so a removed seat is refused on its next one. A change from a seat is refused unless the role is `desk` and the route is in `DESK_MAY`: 403, `mac_only`, "This is done on the Mac.", hint "Keys, switches, sign-ins and money stay on the Mac that runs the engine.", body unread. `GET /api/shell` gains `seat`: `null` on the Mac's port, `{ "n": 1, "role": "desk" }` on a seat's. On a seat the shell shows one fixed line: "You are on a second PC. Keys, switches and money stay on the Mac."

**The kit** `Company Engine for Windows/`: `Set up.cmd`, `Read me.txt`, `files/setup.ps1`, `files/open.ps1`, `files/ssh-args.txt`, `files/door.txt` (seat, port, the owner's short user name, the Mac's `<LocalHostName>.local` then each private IPv4 address), `files/known_hosts` (one line, `company-engine ssh-ed25519 <host key>`), `files/CompanyEngine.ico` (256 pixels, a PNG inside an ICO). `ssh-args.txt` is one argument per line: `-F {EMPTY}`, `-N`, `-T`, `-i {KEY}`, `-p 3220`, `-o IdentitiesOnly=yes`, `-o IdentityAgent=none`, `-o BatchMode=yes`, `-o StrictHostKeyChecking=yes`, `-o UserKnownHostsFile={KNOWN}`, `-o GlobalKnownHostsFile={EMPTY}`, `-o HostKeyAlias=company-engine`, `-o HostKeyAlgorithms=ssh-ed25519`, `-o ForwardAgent=no`, `-o ConnectTimeout=8`, `-o ServerAliveInterval=15`, `-o ServerAliveCountMax=3`, `-o ExitOnForwardFailure=no`, `-L 127.0.0.1:3200:127.0.0.1:{SEATPORT}`, for a desk seat `-L 127.0.0.1:<p>:127.0.0.1:<p>` for each p in 3160 to 3169 and 3171 to 3189, and `{USER}@{HOST}` last. `open.ps1` holds those lines itself and takes the file only if every line is one of them whole, values included, each pinned line exactly once, the door's port from `door.txt`, and the target last (the review's L3).

**The PC's scripts** (Windows PowerShell 5.1 built-ins, no module, no `Invoke-Expression`, no download, no administrator rights, at most 150 lines each, every sentence in one block at the top). `setup.ps1` refuses Windows below build 17763, needs `%SystemRoot%\System32\OpenSSH\ssh.exe`, makes `%LOCALAPPDATA%\CompanyEngine\` and the key there with `ssh-keygen -t ed25519` (never over one that exists), copies the files, makes the two shortcuts, writes `seat-request.txt` beside `Set up.cmd`, and shows the code. The private key never leaves the PC. `open.ps1` (1) goes straight to the window if `127.0.0.1:3200/api/shell` already answers with a `seat`; (2) says so if another program holds 3200; (3) starts `ssh.exe` hidden for each host in `door.txt` in turn and waits up to 15 seconds; (4) opens Edge, else Chrome, else the default browser, waits for the window to close, then stops the `ssh.exe` it started, by its process ID.

### The two role lists in full

`DESK_MAY` (`engine/home/server/lib/seats.mjs`), the only changes a desk seat may make, 18 routes:

| Route | What it is |
|---|---|
| `POST /api/goals` | Make a task |
| `POST /api/goals/:id/note` | Comment on a task (not a priced order, below) |
| `POST /api/goals/:id/stop` | Stop a task (not a job, nor one with an open approval, below) |
| `POST /api/inbox/act` | Needs you: each action sorted again once the item is known |
| `POST /api/ask` | Ask the brain |
| `POST /api/brain/files`, `POST /api/brain/move`, `DELETE /api/brain/file/:token`, `POST /api/brain/forms/:id`, `POST /api/brain/starters`, `POST /api/brain/index/refresh` | Files and brain notes |
| `POST /api/knowledge`, `DELETE /api/knowledge/doc/:id` | The company's documents |
| `POST /api/brand/kit`, `POST /api/brand/kit/font`, `DELETE /api/brand/kit/font/:name` | The brand kit's words and pictures |
| `POST /api/tasks/:id/sites/:ref/shots`, `POST /api/tasks/:id/sites/:ref/preview` | Pictures and the preview of a site a task already made |

Inside `POST /api/inbox/act` a desk seat may take only: board `dismiss`, `answer`, `accept`, `reject`, `send_back`, `stop`, and `approve` of a finished task's review; goals `acknowledge`, `reopen`, `pick`; staged `answer`, `accept`, `send_back`, `stop`; bench `send_back`; content `approve`, `send_back`; brain `open`, `dismiss`. Never: approving a shot list and its cost, another round of versions or treatments, making a draft in the books final, approving an agent's request to the board, or trying a failed run again.

Three refusals inside desk routes, each `mac_only`:
- **A priced order in a note** (the review's M1, the second look's S1, the third look's T1). A seat's note, on a task or with any inbox action, is checked before anything is written: the note as typed, every string inside it when it is JSON (a question card's answers, after `JSON.parse`), and each written answer again as it is sent to the board, one by one and all joined (an order split over two answers, the fourth look's U2). Each is read as a reader would take it: HTML entities decoded (and, for the order search only, `\u` and `\x` escapes, so a Windows path such as `C:\xdev` is not read as an escape), invisible characters dropped (default-ignorable code points, the bidi controls that turn text round, tag characters, the Hangul fillers), NFKD with the combining marks dropped. Then two rules. **Plain English letters only:** a letter or digit outside Basic Latin, or a letter in a box, a circle or a flag, is refused with "From the PC, notes can use plain English letters only. Write it on the Mac to use other letters." The only person at a seat is the owner, who writes English; this replaces a table of lookalikes that could never be finished. **No order:** what is left is folded to letters and digits in capitals, with `@` and `()` read as A and O, `|`, `1`, `I` and `L` as one, `0` as O and `3` as E, and searched for `ANOTHERROUND` or `SHOTLISTACCEPTED`, forwards and backwards; found, it is refused with "From the PC, a note cannot place this order. Do it on the Mac." (the fourth look's U3) So "Not another round yet" is refused from a seat too: the safe side. The Chief of staff acts on the owner's comment, and its reader is a model: a comment that looks the same is the same order. One helper, `seatNoteError`, serves the note route, the inbox and the question card.
- **A stop with a price** (the review's L1, the owner's decision). A seat's stop of a job (the home server's `template:` record, or a `JOB:` line in the task's text), or of a task whose goal or step has a generation batch still open, is refused in `lib/stop.mjs` before any approval is closed or the board is asked, for every place that offers Stop.
- **A view seat** may change nothing at all.

`MAC_ONLY`, 51 routes, refused for every seat:

| Group | Routes |
|---|---|
| App Studio | `POST /api/apps/:slug/switch`, `/allowance`, `/allowance/stop`, `/thinks` |
| The brain door | `POST /api/brain-door/switch`, `/tidy`, `/test` |
| Agents | `POST /api/company/agents/:id/pause`, `/resume` |
| Generation | `POST /api/generation/switch`, `/caps`, `/models`, `/key`, `/key/remove`, `/test`, `/resume`, `/higgsfield/switch`, `/higgsfield/rate`, `/higgsfield/begin`, `/higgsfield/forget`, `/higgsfield/test`, `/runway/begin`, `/runway/forget`, `/runway/test`, `/runway/rate` |
| The proof | `POST /api/health/prove` |
| Jobs | `POST /api/jobs/:department/:id/start` |
| Models | `POST /api/models/key`, `/key/remove`, `/refresh`, `/pick`, `/test`, `/mode` |
| Routines | `POST /api/routines/:id/run`, `/pause`, `/resume` |
| Settings | `POST /api/settings` |
| Setup | `POST /api/setup/skip`, `/dismiss` |
| Lessons | `POST /api/team/:slug/lessons`, `POST /api/team/:slug/lessons/:n`, `DELETE /api/team/:slug/lessons/:n` |
| The viewer door | `POST /api/viewer/switch`, `/test` |
| The web door | `POST /api/web/switch`, `/lists`, `/search`, `/search-key`, `/search-key/remove`, `/test`, `/share` |

Two reads a seat never gets (`SEAT_HIDDEN`), because they carry a sign-in's one-time code: `GET /api/generation/higgsfield/back` and `GET /api/generation/runway/back`. Every POST, PUT, PATCH and DELETE route the router holds is in exactly one list; a route added without sorting fails `test/seats-routes.test.mjs` with `Sort this route in seats.mjs: <METHOD> <pattern>`.

### What a seat cannot do

Each point has a test or a pinned configuration line:
- Reach the Mac's 3200, the board, the gate, the relay, the doors, the books' own screens (8120), another seat's port, or any port not on its key's line (door tests 2 and 4; `PermitOpen` and the key's `permitopen` options).
- Get a shell, run a command, open files, `sftp`, `-R`, `-D` or agent forwarding (door test 3; `ForceCommand /usr/bin/false`, `PermitTTY no`, `MaxSessions 0`, `AllowTcpForwarding local`, `restrict`).
- Sign in with a password, an RSA key or an unknown key (door test 5; `PasswordAuthentication no`, `PubkeyAcceptedAlgorithms ssh-ed25519`).
- Make any change outside `DESK_MAY`, or read a sign-in's return (seats tests 5 and 10, `seats-routes.test.mjs`).
- Write either of the engine's two order lines, `ANOTHER ROUND` or `SHOTLIST ACCEPTED`, as the engine writes them, or anything that looks the same: in another alphabet, in boxed, circled or flag letters, with invisible characters, or hidden or encoded in the ways the kept tests try (the cases of all four reviews); stop a job or a task with an open approval (`seats-money.test.mjs`). A near spelling in plain characters (`SHOTL!ST ACCEPTED`, `ANOTHER ROVND`, an order split by markup or an encoding the check does not know) is not stopped by the check. Against that, the Chief of staff's role counts the owner's line only when it matches the engine's text letter for letter. A desk seat can also still ask for more versions in plain words, by sending work back or making a new task, as `desk` allows; any round that follows is made inside the limits set on the Mac, and a film's clips still need the owner's approval there. Stopping a seat from asking at all would need every comment a seat writes to be marked, and the Chief of staff's role to ignore orders in marked comments: a change for the owner to decide, not made.
- Open the door, add a seat, or learn a key: no route does any of these, and the commands need a terminal and a typed yes (commands test 9, route completeness).
- Stay connected after it is removed (door tests 6 and M2).
- Be reached by an agent: the fence's own planner refuses ports 3201 to 3205, 3220 and 3200 as a local service, and `<state>/remote`, `<state>/secrets/remote`, `<state>/logs` and `<state>/run` as read or write folders (`engine/remote/test/fence.test.mjs`; no fence file changed).

## Which of the owner's rules this changes

As answered in O1 to O5:

| Rule until now | After Windows goes live |
|---|---|
| "This Mac only." | The engine, its data, its keys and its agents stay on this Mac only. Its screens may also be shown on the PCs the owner allowed, one by one (O1). |
| "No phone or remote access." | No access from outside the office network, and none from a phone (O5). A listed PC on the same network may connect. |
| "The home screen listens on 127.0.0.1 only." | Unchanged. One new listener exists beyond 127.0.0.1: the remote door on 3220, off until the owner turns it on. |
| "The owner is the only person." | Unchanged: only the owner sits at the PC for launch (O2). |
| "Nothing leaves the building." | Unchanged. |
| "Nothing is downloaded without the owner's yes." | Unchanged: nothing is downloaded. |
| "Free software only." | Unchanged. |
| "Only the owner presses Test, saves keys, switches things on, opens allowances." | Stronger: these work only on the Mac itself (O3), and so does anything with a price, stopping one included. |
| "Never loosen the fence." | Unchanged: no file under `engine/fence/` was changed, and a kept test shows an agent can reach neither 3220 nor 3201 to 3205, nor the door's folders. |

## Measured

**The spike while planning (DW7)** is above.

**T6, 19 November 2026, on 127.0.0.1 with test keys** (OpenSSH 10.3p1, macOS 27):

| # | Question | Answer, and the line that shows it |
|---|---|---|
| 1 | Forwarding with `MaxSessions 0`, and a command refused | yes: `forward HTTP: 200`; the command `channel 0: open failed`, exit 255 |
| 2 | `AllowUsers <user>@127.0.0.0/8` lets a loopback client in; `<user>@10.0.0.0/8` alone keeps it out | yes: `200`; `User ... from 127.0.0.1 not allowed because not listed in AllowUsers` |
| 3 | `HostKeyAlias=company-engine` verifies; another host key fails with no forward | yes: `200`; `REMOTE HOST IDENTIFICATION HAS CHANGED`, exit 255, forward `000` |
| 4 | One key line with 30 `permitopen` options, and a port not listed refused | yes: 864 characters, `200`, `200`, the third `administratively prohibited` |
| 5 | An RSA key refused with `PubkeyAcceptedAlgorithms ssh-ed25519` | yes: `Permission denied (publickey)` |
| 6 | A password attempt | `Permission denied (publickey)` |
| 7 | `sshd -T` prints every pinned line | yes, `sshd -t` exit 0; no line rewritten or refused |
| 8 | `StrictModes yes` under `~/Library/Caches/<folder>` 700 | works; a parent of 644, 775 or the folder 770 refuses with `bad ownership or modes` |
| 9 | `caffeinate -s -w <pid>` ends with the pid | yes |
| 10 | `sips` writes a 256-pixel ICO from the loft icon | yes: `MS Windows icon resource - 1 icon, 256x256 with PNG image data` |

T6's look-ups on Windows (which OpenSSH ships in each Windows, Edge's app mode, PowerShell 5.1's built-ins) are in its own answer to the orchestrator; they are the reason for the build 17763 floor and for the "Turn on OpenSSH Client" sentence, and the first real PC is their test.

**The tests as built**, all on 127.0.0.1 from port 47000 up in temporary states with keys made for the test: the home server's seat suites (`engine/home/server/test/seats*.test.mjs`) and the door's (`engine/remote/test/*.test.mjs`), each run with the whole home server suite before this record was written. Nothing was ever bound on 3220.

## The first security review, and what changed

Fable reviewed the diff as an attacker in twelve seats (`REVIEW-DESKTOP.md`): High 0, Medium 2, Low 4. All six are fixed, each with a test that failed before it:
- **M1**, a seat's note could give the "another round" order: refused (`seats-money.test.mjs`).
- **M2**, the door could run while the engine said it was off, and removing a PC then did not end its connection: status, restart, `on` and `off` now follow the running door (door test M2, start test M2).
- **L1**, a seat could stop a job or a film mid-way: refused, the owner's decision.
- **L2**, `allow` did not say which PC, name or role the yes was for, and a request naming another seat fell through to the first: both fixed (commands test L2).
- **L3**, `open.ps1` checked option names, not values: whole lines now (commands test L3).
- **L4**, the log had no times on sshd's lines and was mode 644: both fixed (door test L4).

The second look (Fable) found M1's check passed by one changed character or a second line, and two loose ends; all three are fixed, each with a test that failed before it:
- **S1**, a lookalike letter, a hyphen, a prefix or a second line slipped the order past the check: the whole note is now folded and searched (`seats-money.test.mjs`).
- **S2**, removing the last PC left the door switched on with nothing to run, so `engine start` failed every time: the door is switched off then (start test S2).
- **S3**, `engine status`, `start` and `stop` appended the remote part's errors to its log, making it 644 or writing through a link: they no longer write it (start test S3).

The third look (Fable) found three ways still past that check: a JSON escape in a question card's answer, decoded only after the check; the Hangul fillers, which count as letters; and lookalikes outside the table (other scripts, letters in boxes and flags, `@`, `()`, `|`, an HTML entity, the words backwards behind a right-to-left override). The orchestrator chose a fixed rule over a longer table: decode first, then plain English letters only, then the order searched both ways (T1, `seats-money.test.mjs`, every case of the review).

The fourth look (Fable) said GO, with three Low items, all fixed: U1, near spellings in plain characters still pass, so this record says so and the Chief of staff's role counts the line only letter for letter; U2, an order split over two answers of one question card is refused, the answers checked joined; U3, an order gets its own sentence, and `\u` and `\x` escapes are decoded for the order search only, so a Windows path passes the letters rule.

Accepted by that review, with the reason:
- `POST /api/settings` is Mac-only; site pictures, site previews and the brain index refresh are desk.
- Seat listeners open only on the configured seat ports; seat keys live in `seat-keys.json`; `pgrep -P` finds the door's children (a reconnecting client did not survive a stop in six tries); `sshd -t` is the check.
- The typed yes can be given through a pseudo-terminal: anything able to do that already runs unfenced as the owner and could write the files itself. The fence, not the terminal check, keeps agents out.
- `engine remote kit` needs no terminal: a waiting seat lets nobody in.
- "Same office network" is really "any private address". On another network with the door on, strangers reach sshd's sign-in and nothing more. So the owner turns the door off before taking the Mac elsewhere (the README says so).
- Any other program listening on the Mac's 3160 to 3169 or 3171 to 3189 is reachable by a desk seat: the plan pins that range.

## Consequences

- One listener exists beyond `127.0.0.1`: the remote door on 3220, and only while it is on. Strangers on the office network reach sshd's sign-in, with ed25519 keys only, two tries and no password. They can hold a few unauthenticated slots (`MaxStartups 3:50:6`) and slow a PC's sign-in.
- Any program on the PC, and any other Windows user on it, can reach the PC's own `127.0.0.1:3200` and app ports as that seat while the window is open, just as any program on the Mac can reach the home screen today. The PC's private key sits in `%LOCALAPPDATA%\CompanyEngine` under the profile's own access rules.
- The Mac must be awake and on the same network. While the door is on and the Mac is on power, it is kept awake.
- Edge is Microsoft's and talks to Microsoft as any browser does. The window's own profile has no extensions.
- The books' own screens on 8120 open only on the Mac.
- No Dock-style count and no notifications on Windows.
- If the home screen is down while the door is up, the PC says "The Mac is off, asleep, or not on this network."
- Left behind on the PC after it is removed, until the owner deletes the folder: `ssh-error.txt`, `ssh-output.txt` and the window's browser profile.
- The PC's scripts were never run on Windows here. Until the ten checks on the real PC pass, Windows is "ready, not yet run on real Windows".

## Rejected

| Option | Why not |
|---|---|
| **Tauri (WebView2) shell** | Several GB of downloads (the Rust toolchain with the Windows target, Tauri's crates, `cargo-xwin` with Microsoft's CRT and SDK, LLVM), cross-building from a Mac is experimental, unsigned it meets SmartScreen and a certificate is paid, and it would still need the whole network, login and TLS layer. It buys a taskbar badge. |
| **A C# WebView2 shell, cross-built with .NET** | A smaller download, the same signing, testing and network problems, and a second native program to review. |
| **Browser or PWA straight to the Mac over TLS** | Every server would bind the network; twenty-one origins would need certificates from a private authority the PC trusts; every Host check, origin check, `frame-src` and `frame-ancestors` would change; a login with passwords and sessions would be new unfenced code. The largest attack surface of all. |
| **Tailscale** | A download on both machines, an account, and a service outside the building. The door would work over it unchanged if the owner ever wants access from outside (O5). |
| **Screen sharing or remote desktop** | Opens the whole Mac, not the engine. |
| **The system's "Remote Login"** | Needs the administrator password and allows password logins and a full shell by default. The engine's own door allows neither, and the system setting is never touched. |
| **Porting the engine to Windows** | The fence does not exist there. |
