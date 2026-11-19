# engine/stress: the stress harness

Stress tests the whole engine on a staged copy, never on the live one (`.router/PLAN-STRESS.md`). Nothing in this
folder is part of `engine test`: the harness files are named `*.mjs`, never `*.test.mjs`, and the self-checks
`*.check.mjs`.

## The rules (binding for every task that uses this folder)

1. **Live is read only.** Nothing here starts, stops, loads, edits or calls the live engine (ports 3100-3299, 8120,
   state `~/.paperclip/uuu-engine`). No file under `/Users/aasish/uuu/engine` is edited.
2. **All code work happens in the worktree `/Users/aasish/uuu-stress`, branch `build/v5-stress`.** Evidence and the
   ledger go to `/Users/aasish/uuu/.router/` (git-ignored).
3. **Staged only.** Every process the harness starts lives under one stage folder, on ports `base+N`, base one of
   4300, 4400, 4500, 4600, 4700, 4800. Never 3100-3299, 5000, 5432, 7000, 8120.
4. **Never kill by name, never kill a database.** Only process ids the stage itself started, checked by command line
   before the signal. No `pkill`, `killall`, `kill $(pgrep ...)`. A staged port already taken: the stage stops and
   says so; it kills nothing.
5. **No real agent, no real spend, no outside call.** Model, Runway, Higgsfield and the internet are the fakes in
   `engine/test/stubs/`. Any connect to an address that is not loopback from a staged process is a critical finding.
6. Never read or print `agent.env`, `auth.json`, or anything under a live `secrets/` folder.
7. Node is `N=$HOME/.nvm/versions/node/v24.22.3/bin/node` (the plain `node` is broken; v24.13.0 fails a real-fence
   test).
8. Reports go in the builder's answer. The ledger and checklist `.md` files are written only by `ledger.mjs`.
9. Harness files live only under `engine/stress/`.
10. Commit by path, in the worktree only. No push. Nothing goes live from this plan.

## How to run

From `/Users/aasish/uuu-stress`, with `N=$HOME/.nvm/versions/node/v24.22.3/bin/node`:

```
$N --test engine/stress/check/                                  # the harness's own checks (about 40 s, base 4300)
$N engine/stress/run.mjs <browser|routes|doors|agents|soak|recovery|all> [--pass <n>] [--quick] [--only <id>] [--base <n>] [--minutes <n>]
$N engine/stress/ledger.mjs render | add .. | set <id> .. | diff <a> <b> | checklist
```

- `run.mjs` loads `engine/stress/<sweep>/index.mjs` (`export default async (ctx) => {}`); a sweep not built yet prints
  `SWEEP <name>: not built` and exits 2. Exit 0: no finding of medium or higher; 1: some; 2: the harness failed. The
  last line is always `SWEEP <name>: checks <n>, findings critical <a> high <b> medium <c> low <d>`.
- `--pass` defaults to 0, the scratch pass; the full passes (T8, T12) name theirs. Findings go to
  `$STRESS_OUT/pass-<n>/findings.jsonl` (default `/Users/aasish/uuu/.router/evidence/stress`).
- `ctx = { sweep, pass, quick, only, base, minutes, out, passDir, record, check, startStage, openBrowser, log }`.
  `ctx.record(finding)` fills `id` and `repro` (`$N engine/stress/run.mjs <sweep> --only <id>`) when not given;
  `ctx.check(n)` counts checks (or return `{ checks }`). Stages and browsers opened through `ctx` are closed when the
  sweep ends, even when it throws. `run.mjs` keeps the Mac awake with `caffeinate -w <its pid>`.
- The self-checks use base 4300 (`STRESS_CHECK_BASE` to change). While building, each wave-2 sweep uses its own base:
  browser 4400, routes 4500, doors and agents 4600, soak and recovery 4700.
- `ledger.mjs` files: `STRESS_OUT`, `STRESS_LEDGER` and `STRESS_LAUNCH` override the evidence folder,
  `.router/STRESS-LEDGER.md` and `.router/STRESS-LAUNCH.md`.

## The stage (`lib/stage.mjs`)

`startStage({ base, dataset, faults, apps, label, appsSpawn, nodeModules })` makes `/private/tmp/uuu-stress-stage-<label>-XXXXXX/`
(short on purpose: an app's socket path must stay under macOS's 104 bytes; `STRESS_STAGE_PARENT` changes the parent):

| Path | What |
| --- | --- |
| `root/engine` | an APFS clone of the worktree's `engine/`, its `config.json` rewritten (state, ports, `node24`, `paperclip.instanceRoot`, `fence.realClaude` = `root/fake-claude`, `fence.policyPortsAllowed` = the books' port); `node_modules` a link to the worktree's (`nodeModules: "clone"` clones it) |
| `root/apps` | clones of `apps/*` without their `node_modules` links; with `apps: true`, each `app.json` port moved to base+71.. |
| `state` | the dataset (`lib/seed.mjs`), made-up secrets (provider key `sk-stress-fake-0000`, a fake Runway key), part logs in `state/logs/<part>.log` |
| `home`, `tmp` | each child's `HOME` and `TMPDIR` |
| `pids.json` | `{ part: { pid, startedAt, fault? } }` |
| `outside-calls.jsonl` | every connect or lookup the guard refused |
| `fakes/<part>.json` | the control address of the relay's, web door's and generation door's fakes |

Every Node child runs as `$N --import root/engine/stress/lib/netguard.mjs ...` with `cwd` the copy, its own `HOME`,
`TMPDIR` and `PATH`, and none of the caller's environment. The guard lets only 127.0.0.1, ::1, localhost and unix
sockets through, never a live port, and logs and throws on anything else. Chrome (`lib/cdp.mjs`) gets
`--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1`, downloads denied, its own profile under `/private/tmp`.

How each part runs:

| Part | Process |
| --- | --- |
| home, gate (with gateNarrow), viewer, brain | the copy's own entry file, as `engine/parts/NN-*.sh` starts it |
| apps | `apps: false`: the copy's `apps/host.mjs`, no app switched on. `apps: true`: the runner's second host (`createAppHost`), app ports base+71..+89, `spawnApp` the copy's fenced `app-exec` (`appsSpawn: "fenced"`) or the host's test fixture as app `fix` (`appsSpawn: "fixture"`) |
| board, books | `lib/part-runner.mjs`: the stub board and stub books (`engine/test/stubs/`), as separate processes |
| relay, web, generate | `lib/part-runner.mjs`: the factories (`createRelay`, `createWebDoor`, `createGenerateDoor`) with the fakes in the same process: the fake provider; the fake internet (and the watch's programs made unfindable); fake Runway, Runway MCP and Higgsfield. Their real entries' start-up glue is not run (accepted gap) |

The gate and the narrow gate are one process, as on the live engine: `kill`, `start` and faults on either act on
both. `stage.setFault(part, mode)` replaces a part with a fault server on its port(s); `null` brings the real part
back. `stage.setBehaviour(fake, behaviour)` changes a fake's `behaviour` (`provider`, `internet` (read only),
`runway`, `runway-mcp`, `higgsfield`). `stage.probe(host, port)` makes one connect from a guarded runner.
`stage.healthy(part)` asks a part's health address.

Known: the home's provider reads (`/v1/models` and friends, `lib/provider.mjs`) go to Omega Plus's fixed origin,
which a real entry cannot point at a fake. In the stage the guard refuses them and logs them in
`outside-calls.jsonl` with `part: "home"` and host `api.omegaplusapi.com`.

## Ports (offsets from the base)

| Part | Offset | 4300 | 4400 | 4500 | 4600 | 4700 | 4800 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| board | +1 | 4301 | 4401 | 4501 | 4601 | 4701 | 4801 |
| gate | +10 | 4310 | 4410 | 4510 | 4610 | 4710 | 4810 |
| gateNarrow | +11 | 4311 | 4411 | 4511 | 4611 | 4711 | 4811 |
| relay | +20 | 4320 | 4420 | 4520 | 4620 | 4720 | 4820 |
| web | +30 | 4330 | 4430 | 4530 | 4630 | 4730 | 4830 |
| generate | +40 | 4340 | 4440 | 4540 | 4640 | 4740 | 4840 |
| viewer | +50 | 4350 | 4450 | 4550 | 4650 | 4750 | 4850 |
| preview | +60 (sites +61..+69) | 4360 | 4460 | 4560 | 4660 | 4760 | 4860 |
| apps | +70 (apps +71..+89) | 4370 | 4470 | 4570 | 4670 | 4770 | 4870 |
| brain | +90 | 4390 | 4490 | 4590 | 4690 | 4790 | 4890 |
| books (benchWeb) | +91 | 4391 | 4491 | 4591 | 4691 | 4791 | 4891 |
| benchSocketio, benchRedisQueue, benchRedisCache | +92, +93, +94 | never bound | | | | | |
| benchDb | +95 | never bound | | | | | |
| home | +99 | 4399 | 4499 | 4599 | 4699 | 4799 | 4899 |
| fakes, control addresses | port 0 | | | | | | |

## Datasets (`lib/seed.mjs`)

- `normal`: `boardSeedV2()` and `state-seed-v2` (the existing seeds).
- `empty`: the company, its agents and project; no tasks, no files, empty basics, no routines, no jobs.
- `large`: 500 tasks over every status and stage, 200 documents in `knowledge/docs`, 120 Needs you items, 50 jobs
  started, 30 routines; in each kind a 5000-character title, `<script>alert(1)</script>`, a right-to-left title, an
  emoji-only title and `../../secrets/provider/omega-key`.
