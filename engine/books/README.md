# Books: the company's system of record

One Frappe bench holds the company's books (ERPNext with India Compliance),
customers (Frappe CRM), support (Frappe Helpdesk) and people (Frappe HRMS).
These scripts install it, start it, stop it and say whether it is healthy.

| Command | What it does |
|---|---|
| `install.sh` | Installs everything below. Safe to run again: each step checks whether it is already done and skips it. Refuses to start a download or build with less than 9 GB free. Ends with the books running. |
| `start.sh` | Starts the database, then the bench in the background. Exits 0 when the web server answers. Running it twice starts nothing new. |
| `stop.sh` | Stops the bench and shuts the database down cleanly. Exits 0 when all five ports are closed. Safe when nothing runs. |
| `status.sh` | One line each for database, web, background workers and cache: `on`, `off` or `unhealthy`. Exits 0 only if all are on. |

`lib.sh` holds the shared settings; `books_setup.py` does the first-run setup
and makes the owner's API key (run by `install.sh` with the bench's Python).

## Set-up wizard

`setup-wizard.sh` asks the owner for the three entries only they know, and
writes them into the books (`--dry-run`: the books check everything, then it
is undone; `--status`: what the books hold now). Its helper `wizard_books.py`
runs in the bench and saves in one transaction, so a refusal saves nothing:

- GST: `Company.gstin` and `gst_category`, as India Compliance's own set-up
  wizard does (`india_compliance/setup_wizard.py`, `update_company_info`).
- Address: the company's own Address (linked to the Company), with `gstin`
  and `gst_category`. Invoices take the company's GST number from it.
- Holidays: one Holiday List, `<company> holidays <year>-<year+1>`, from 1
  January of this year to 31 December of next year; `Company.default_holiday_list`;
  and one submitted Holiday List Assignment for the company, which is where
  HRMS 16 looks for a person's holiday list.

Running it again updates the same Address and list: public holidays already
there stay. It refuses if India Compliance's online look-ups are switched on,
so no GST number leaves this Mac. Tests: `tests/test_wizard_books.py`.

## What is where

- Bench: `~/.paperclip/uuu-engine/books/bench` (site `engine.localhost`)
- Database files: `~/.paperclip/uuu-engine/books/mariadb`, settings in `~/.paperclip/uuu-engine/books/my.cnf`
- Logs: `~/.paperclip/uuu-engine/logs/books-bench.log`, `books-mariadb.log`, `books-install-redis.log`; the bench also writes its own logs in `bench/logs/`
- Process ids and the database socket: `~/.paperclip/uuu-engine/run/books-*`
- Secrets (mode 0600, never in the repo): `~/.paperclip/uuu-engine/secrets/`
  - `mariadb-root.txt`: database root password
  - `bench-admin.txt`: the bench's Administrator password
  - `bench-owner-api.txt`: Administrator API key (line 1) and secret (line 2); send as `Authorization: token <key>:<secret>`
- Skipped apps, if disk ran short: `~/.paperclip/uuu-engine/books/skipped-apps.txt` (absent when nothing was skipped)

## Ports

| Port | Part | Listens on |
|---|---|---|
| 3317 | MariaDB 11.8 (private instance, never a brew service) | 127.0.0.1 |
| 8120 | web (`http://127.0.0.1:8120`) | all interfaces (Frappe's dev server has no host option) |
| 9120 | socketio (live updates) | all interfaces |
| 11120 | redis queue (background jobs) | 127.0.0.1 |
| 13120 | redis cache | 127.0.0.1 |

## What was installed outside the repo

- Homebrew: `mariadb@11.8`, `mariadb-connector-c`; as mariadb's dependencies
  `mecab`, `mecab-ipadic`, `msgpack`, `onigmo`, `groonga` were added and
  `simdjson` (4.6.4 to 5.1.1) and `pcre2` (10.47 to 10.49) were upgraded.
  `pkg-config` was already there (as `pkgconf`). Homebrew's post-install step
  for mariadb also made an unused data folder `/opt/homebrew/var/mysql`.
- `yarn` 1.22 installed globally into Node 24 (`~/.nvm/versions/node/v24.13.0`).
- The `bench` tool: `uv tool install frappe-bench` (`~/.local/bin/bench`).
- Apps, each from its `version-16` branch (telephony from `develop`), in this
  order: frappe, erpnext, india_compliance, hrms, crm, telephony, helpdesk.
- Company `Sthyra` (STH), India, INR, Asia/Kolkata, chart "India - Chart of
  Accounts", fiscal year 2026-2027 (1 April 2026 to 31 March 2027). No demo
  data, no email account, no India Compliance API features, telemetry off.

Nothing starts at login and no shell profile was changed.

## Remove all of it

```bash
engine/books/stop.sh
rm -rf ~/.paperclip/uuu-engine/books
rm -f ~/.paperclip/uuu-engine/secrets/{mariadb-root,bench-admin,bench-owner-api}.txt
rm -f ~/.paperclip/uuu-engine/logs/books-*.log ~/.paperclip/uuu-engine/run/books-*
uv tool uninstall frappe-bench
~/.nvm/versions/node/v24.13.0/bin/npm uninstall -g yarn
brew uninstall mariadb@11.8 mariadb-connector-c
brew uninstall groonga mecab-ipadic mecab msgpack onigmo   # brew refuses any still needed by something else
rm -rf /opt/homebrew/var/mysql   # only if no other MariaDB/MySQL uses it
```

## Notes

- Caches: the installer gives the bench its own uv, yarn and npm caches under
  `books/.cache` and deletes them after each app. The owner's shared uv cache
  is not cleaned: running tools (`uvx`, `uv run` MCP servers) keep their
  environments in it and hold its lock, so cleaning it would break them.
- The Procfile has no `watch:` line, and the web server runs with
  `--noreload` (one process instead of a reloader pair).
- While apps install and the bench is not yet running, `install.sh` starts the
  two redis servers on their own and stops them afterwards.
- Disk measured on 11 November 2026: bench folder 3.7 GB, database 0.4 GB.
  Nothing was skipped.
