# Company engine blueprint

Written 11 November 2026. A design for one app that runs a company end to end with people and AI agents. It draws on the 368 repositories in [company-engine-repos.md](company-engine-repos.md).

**Status:** a design from reading READMEs and some source code. Nothing here has been installed or run, and no two pieces have been tested together.

## The idea

The engine has three planes and a foundation under them.

1. **Company plane.** Who works here (people and agents), what the goals are, who may do what, what it costs, and what is waiting for approval.
2. **Departments.** Sales, marketing and PR, finance, HR, support, a creative studio, and CAD. Each department is a few agents with a role, the skills for that job, and one dashboard.
3. **Systems of record.** The books, the CRM, the customer inbox, the files. Agents work in these through APIs. People mostly see the department pages.
4. **Foundation.** Memory, channels, security, model routing and tracing, shared by everything above.

You build one home screen over all of it: an inbox of what needs you, a page per department, and search. The rest is taken from open source.

## The pick for every function

"Agents drive it by" says how an agent operates the tool. MCP means the tool ships its own agent interface.

### Company plane

| Function | Pick | Why this one | Backup | Agents drive it by | Licence | Watch out |
|---|---|---|---|---|---|---|
| Org chart, goals, tasks, budgets, approvals | paperclip | Models a company of people and agents: reporting lines, goal-linked tasks, budget hard stops, approval gates, routines, multi-company | agno (AgentOS), Kortix CompanyOS | REST, CLI, MCP, webhooks | MIT | Chat and email connectors are experimental |
| The agents themselves | Claude Code, Codex, opencode through paperclip adapters | You already run them; paperclip hires "anything that can receive a heartbeat" | rakazo for agents that need their own desktop and a phone app; OpenClaw for presence on chat apps | Adapters | Mixed | Each needs its own account or key |
| Job descriptions for agents | agency-agents, gstack, knowledge-work-plugins, marketingskills | Ready role prompts and skills by department | wshobson/agents, ECC | Markdown skills | MIT, Apache-2.0 | Prompt quality varies; test before trusting |
| Training and testing skills | anthropics/skills skill-creator, paperclip Skill Studio | Tests a skill with and without, then tunes it | promptfoo | CLI | Apache-2.0, MIT | |

### Systems of record

| Function | Pick | Why this one | Backup | Agents drive it by | Licence | Watch out |
|---|---|---|---|---|---|---|
| Accounting, invoicing, stock, projects | ERPNext | One system for the books, orders, stock and projects | bigcapital, Odoo, Dolibarr | REST | GPL-3.0 | Heavy stack to run |
| Indian GST | India Compliance (on ERPNext) | GSTR-1 preparation, e-invoice, e-waybill, purchase reconciliation | none found | Through ERPNext | GPL-3.0 | Some GST automation needs a paid account |
| HR, attendance, payroll | Frappe HRMS | Leave, attendance with location check-in, claims, appraisals, salary structures | horilla | REST | GPL-3.0 | README does not mention PF or ESI |
| Sales CRM | Frappe CRM | Same stack as the books; Exotel calling; WhatsApp add-on | Twenty (stronger product), EspoCRM, Krayin | REST | AGPL-3.0 | WhatsApp needs a third-party add-on |
| Customer inbox and support | Chatwoot | Web chat, email, WhatsApp, Instagram and Telegram in one inbox, with a help centre | Frappe Helpdesk, Zammad | REST | MIT | Its AI agent may sit in a paid tier |
| Subscriptions and usage billing | Lago | Metering, plans and invoices with its own MCP server | Kill Bill | MCP, REST | AGPL-3.0 | Only if you sell subscriptions |
| Contracts and e-signature | DocuSeal | Sign contracts, offer letters and NDAs by API | Documenso | REST, webhooks | AGPL-3.0 | Embedding and bulk send are paid; Aadhaar e-sign not stated |
| Paper and receipts archive | Paperless-ngx | Scanned documents become searchable | Nextcloud | REST | GPL-3.0 | Stores documents unencrypted |
| Wiki and procedures | Docmost | Spaces, permissions, page history | Outline (not open source), AFFiNE | Not stated | AGPL-3.0 | No agent API stated |
| Human project tracking | ERPNext projects | Already there | Plane | REST | GPL-3.0 | |

### Go to market

| Function | Pick | Why this one | Backup | Agents drive it by | Licence | Watch out |
|---|---|---|---|---|---|---|
| Social posting | postiz | Scheduling across networks; you already have its plugin | trypost (MCP), Mixpost | REST | AGPL-3.0 | Each network needs API approval |
| Email campaigns | listmonk | One small server for lists and campaigns | Mautic, BillionMail | REST | AGPL-3.0 | Deliverability is yours to manage |
| SEO | open-seo with claude-seo and marketingskills | Keyword, rank, backlink and audit data over MCP | open-seo-mcp-skills | MCP | MIT | Needs a paid DataForSEO key |
| Ads | claude-ads | Audits and plans across twelve ad platforms | none found | Skill | MIT | Read-only: it does not run campaigns |
| Blog and newsletter | Ghost | Publishing and memberships | Payload | REST | MIT | |
| Landing pages | hallmark | Pages that pass a browser lint for generic design | impeccable, unslop | Skill | MIT | |
| Web analytics | Umami | Light analytics with an MCP endpoint | Plausible, PostHog | MCP, REST | MIT | MCP is off by default |
| Lead capture and WhatsApp flows | Typebot with Chatwoot | Scripted qualification on the official WhatsApp Cloud API | ChatbotX | REST, MCP | FSL, MIT | Avoid unofficial WhatsApp gateways: accounts get banned |
| Booking meetings | cal.diy | Booking pages and calendar sync | none found | Not stated | MIT | Its README says personal use only, not production |
| Surveys | Formbricks | In-app, link and email surveys | Typebot | Webhooks | AGPL-3.0 | |
| PR and news monitoring | Build it from AIHOT's pipeline, with firecrawl or Scrapling for collection | No ready tool fits; AIHOT publishes its dedupe, scoring and daily-brief prompts | BettaFish (Chinese platforms), worldmonitor (geopolitics) | Your own | MIT | Scraping terms; this is a build, not an install |
| How AI models describe your brand | niubigeo | Repeats questions across models and stores answers and sources | none | REST | Apache-2.0 | Needs model keys |

### Creative studio

The closest thing to "open-source Adobe inside the app" is the storytold family. Seven tools share one shape: a native app, a browser build (WebAssembly), an MCP server, a command line, and MIT or Apache-2.0 licensing. All of them call themselves alpha.

| Function | Pick | Why this one | Backup | Agents drive it by | Licence | Watch out |
|---|---|---|---|---|---|---|
| Photo editing | photocraft | Layers, masks, real PSD files; runs in the browser | miniPaint in-app; GIMP outside | MCP, CLI | MIT or Apache-2.0 | Early alpha; "not yet a Photoshop replacement" |
| Raw photos in bulk | lightcraft | Lightroom-style develop and batch export | darktable command line | MCP, CLI | MIT or Apache-2.0 | Alpha, about 51% ready by its own estimate |
| Vector and logos | vectorcraft | Illustrator-style; SVG, PDF, AI, EPS; opens Affinity files | Penpot, Graphite | MCP, CLI | MIT or Apache-2.0 | Alpha, about 65% ready |
| Posters and social graphics | doory | Canva-style editor with templates and bulk fill | fabric.js custom editor | MCP, REST | Attribution licence | Must credit the author in the app; only ten templates |
| Brand and interface design | Penpot | Figma-style, self-hosted, mature | doop | MCP, REST | MPL-2.0 | Several services to run |
| Video editing on a timeline | filmcraft | Multicam, colour, titles, captions; exports to Premiere and Resolve formats | Concat (AGPL, MCP); Kdenlive outside | MCP, CLI | MIT or Apache-2.0 | Alpha, about 56% ready; slow on big footage |
| Video made by agents | hyperframes (you already use it) | HTML rendered to MP4, deterministic | openfilm, Remotion, gitdiagram's pipeline | CLI | Apache-2.0 | |
| Motion graphics | effectcraft | After Effects-style; headless render; Lottie export | Motion Canvas, Manim | MCP, CLI | MIT or Apache-2.0 | First commit 1 October 2026; about 45% ready |
| AI image and video generation | ComfyUI plus your Higgsfield and Runway accounts | Local models and paid models side by side | artcraft | REST | GPL-3.0 | Needs a strong GPU |
| Voice | VoiceStudio and whisperX | Local voice-over, dubbing, transcripts with speakers | Handy for dictation | CLI | AGPL-3.0, BSD | Voice cloning needs consent rules |
| Media processing in the background | SnapOtter | 200+ convert, compress, OCR and transcribe tools behind one API | ffmpeg scripts | REST | AGPL-3.0 | Default admin password; change it |
| Whiteboard | Excalidraw | A React component you embed | tldraw, drawnix | SDK | MIT | |
| Documents, sheets, slides | ONLYOFFICE now; wordcraft and gridcraft later | ONLYOFFICE is mature and embeds; the craft tools are agent-drivable but young | Univer, genoffice, the Anthropic Office skills, bento for decks | SDK, REST; MCP for the craft tools | AGPL-3.0; MIT or Apache-2.0 | ONLYOFFICE community edition suits about 20 users |
| PDF | Stirling-PDF | Merge, split, sign, redact, OCR by API | pdfcraft | REST | Open core | Some features paid |

### CAD and 3D

| Function | Pick | Why this one | Backup | Agents drive it by | Licence | Watch out |
|---|---|---|---|---|---|---|
| Product CAD from a description | Atech Atelier, run as a separate CAD worker | The agent writes a FreeCAD script, a sandbox builds it, and every solid is measured | text-to-cad, CadQuery, build123d | Its `./check` loop | GPL-3.0 | Keep it a separate service; preview quality |
| 2D drawings, DXF and DWG | cadcraft | AutoCAD-style with a browser build | LibreCAD outside | MCP, CLI | MIT or Apache-2.0 | Early; unproven on real drawings |
| Parametric CAD in the browser | solidcraft | Sketches, constraints, assemblies | FreeCAD outside | MCP | Apache-2.0 | Simple parts only so far |
| Buildings and floor plans | pascalorg/editor | Browser 3D building editor; agents edit scenes | Blender | MCP, CLI | MIT | Hosted features use paid credits |
| 3D and rendering | Blender with its MCP server | Agents drive it through Python | Your 3ds Max and V-Ray stay outside the engine | MCP | GPL | |

### Dashboards

| Function | Pick | Why this one | Backup | Agents drive it by | Licence | Watch out |
|---|---|---|---|---|---|---|
| Agent work and cost | paperclip's dashboard, with Langfuse for traces | Spend by agent, project, goal and model | caprock, Phoenix | REST | MIT | |
| Business dashboards | Metabase | Easy for non-technical people; embeds in your screens | Frappe Insights, Superset, Redash | REST | AGPL-3.0 | Some features paid |
| Numbers agents can trust | WrenAI | One written definition per metric, so two agents give the same answer | Cube, auto-ontology | MCP, CLI | Apache-2.0 | Its own dashboards are paid |
| Reports written by agents | Evidence | SQL and Markdown published as a site | Lightdash | CLI | MIT | |
| Charts in your own screens | ECharts | Widest chart range | Recharts | Library | Apache-2.0 | |

### Memory

| Function | Pick | Why this one | Backup | Agents drive it by | Licence | Watch out |
|---|---|---|---|---|---|---|
| Answers from company documents, with sources | AnythingLLM | Workspaces per department; refuses when the documents don't cover it | LightRAG, ragflow | REST | MIT | Telemetry on by default |
| What agents learned from doing the work | hindsight | One memory bank per team or client; retain, recall, reflect | mem0, claude-mem's pattern | MCP, REST | MIT | Newer project |
| Facts that change over time | graphiti | Every fact has a date range and a source | cognee | SDK | Apache-2.0 | You run a graph database |
| Memory people can open and edit | EverOS | Plain Markdown files under version control | OpenViking | MCP, REST | Apache-2.0 | Newer project |
| Task history | paperclip tasks | Threads, documents and run history stay on the task | beads | REST | MIT | |

Start with two: AnythingLLM for documents and hindsight for experience. Add the others only when a real need shows up.

### Channels

| Function | Pick | Why this one | Backup | Agents drive it by | Licence | Watch out |
|---|---|---|---|---|---|---|
| People and agents talking | Zulip | Every task or customer case gets its own topic | Mattermost, Rocket.Chat, Matrix | REST | Apache-2.0 | |
| Customers | Chatwoot on the official WhatsApp Cloud API | One inbox, human handover | evolution-api in Meta mode | REST | MIT | Meta charges per conversation |
| Calls and voice agents | LiveKit | Real-time audio and video with an agents framework | Jitsi for plain meetings | SDK, webhooks | Apache-2.0 | Needs media servers |
| Agent to agent | A2A protocol | A standard way for agents to call each other | paperclip delegation | SDK | Apache-2.0 | Protocol only |
| Agent to screen | AG-UI | Streams progress and approvals into your interface | | SDK | MIT | Protocol only |
| Presence on many chat apps | OpenClaw | Twenty-plus channels through one gateway | Hermes Agent, zeroclaw | CLI, MCP | MIT | Inbound messages are an injection risk; sandbox it |

### Security

| Function | Pick | Why this one | Backup | Licence | Watch out |
|---|---|---|---|---|---|
| One sign-in for everything | authentik | Covers every app above | Keycloak, Zitadel | MIT core | Enterprise features separate |
| Who and which agent may see or change which record | paperclip permissions with OpenFGA | Allowed, Ask or Off per connection; fine-grained rules per record | Cedar | MIT, Apache-2.0 | The permission model needs designing |
| Secrets | Infisical | Agents get short-lived access and never hold real keys | OpenBao | Open core | Some features paid |
| Team passwords | Vaultwarden | Works with Bitwarden apps | Passbolt | AGPL-3.0 | Unofficial server |
| Sandbox for every agent command | sandbox-runtime | Limits files and network without containers | OpenShell | Apache-2.0 | |
| Blocking risky agent actions | FailproofAI with paperclip approval gates | Forty built-in policies across twelve agent tools | | MIT plus Commons Clause | Fine internally; cannot be sold as a service |
| Vetting skills before install | SkillSpector | Scans third-party skills for malicious patterns | | Apache-2.0 | |
| Scanning your own code | semgrep, trivy, osv-scanner, betterleaks | Bugs, vulnerable dependencies, leaked keys | gitleaks, nuclei | Mixed | |
| Watching servers | Wazuh | Intrusion detection and log analysis | AiSOC (new) | GPL | Heavy to run |
| Private network | headscale | Internal services never face the internet | pangolin | BSD-3-Clause | |
| Backups | restic | Encrypted backups of every database and file store | | BSD-2-Clause | |
| Audit before launch | Cloudflare security-audit skill | Separate agents find and verify | pentagi | MIT | Many subagents |

### Plumbing

| Function | Pick | Backup | Licence | Watch out |
|---|---|---|---|---|
| One gateway for all models, with budgets | LiteLLM | bifrost, agentgateway | Open core | Some features paid |
| Traces and tests of agent runs | Langfuse | Phoenix, promptfoo | Open core | Several services |
| App-to-app automation | Activepieces (its connectors double as agent tools) | n8n, Kestra, Temporal | MIT | n8n's licence forbids reselling |
| Database and files | Postgres through Supabase | NocoDB or Teable for spreadsheet-style tables | Apache-2.0 | |
| Agents on websites and desktops | agent-browser, agent-desktop, Playwright | CLI-Anything | Apache-2.0 | |
| Web data | Scrapling, firecrawl | | BSD, AGPL | Public data only |
| Deploying all of this | Coolify | Docker Compose by hand | Apache-2.0 | Protect its API token |
| Interface | Astryx or shadcn/ui, Magic UI, ECharts, xyflow | | MIT | |
| Interface quality gates | hallmark, impeccable, unslop | | MIT, Apache-2.0 | |
| Answers as working tools | OpenIntelligentUI | | MIT | Needs its router replaced |

## How it becomes one app and not thirty

This is where "beautiful and easy" is won or lost. Four rules:

1. **One front door.** Everyone signs in once and lands on the home screen. No one is sent to ERPNext or Chatwoot by default.
2. **Systems run in the background.** Agents do the data entry through APIs. People see department pages: a dashboard, the tasks in flight, and what needs approval.
3. **Deep tools open in place.** The video editor, the design canvas or a CRM record opens inside the engine when a person needs it. The browser builds of the craft tools and the embeddable editors make this possible.
4. **One look for what people touch daily.** Build your own screens for the ten most-used views. Leave the back-office screens as they are.

Embedding thirty apps in frames will look patched together. Expect to build the home screen, the department pages and those ten views yourself.

## What open source does not cover

- **PR outreach.** No journalist database or pitch tracker was found. Monitoring exists only as patterns to build from.
- **Running ad campaigns.** Auditing and planning are covered; changing live campaigns is not.
- **Indian payroll law.** PF, ESI and TDS handling was not stated in the HR README and needs checking.
- **Indian banking and payments.** No bank feeds, UPI or payment-gateway connector turned up.
- **Aadhaar e-sign.** Not stated by either e-signature tool.
- **Production-grade creative tools in the browser.** The craft suite fits the idea exactly but is alpha. For client work today, people still finish in Kdenlive, GIMP, Blender or your existing tools.
- **The unified interface.** It has to be built.

## What you build yourself

1. The home screen: inbox, department pages, search.
2. The glue: agents' skills for each system (how to post an invoice, qualify a lead, book a post).
3. The verification gates: a separate check before anything is reported done or sent outside.
4. Your own domain skills: the film pipeline, real-estate tools, CAD conventions.

## Build order

Do not deploy everything. Each phase should run real work for two weeks before the next starts.

| Phase | Stand up | Proves |
|---|---|---|
| 1. Minimum company | paperclip, two or three agents, sign-in, secrets, sandbox, model gateway | Agents take tasks, stay inside budgets, and ask for approval |
| 2. The books | ERPNext with India Compliance; a finance agent; one finance dashboard | An agent can raise an invoice and reconcile purchases, with a human approving |
| 3. Customers | Frappe CRM, Chatwoot, Typebot on WhatsApp; a sales agent and a support agent | Leads are captured, qualified and followed up without being dropped |
| 4. Memory | AnythingLLM and hindsight | Agents answer from company documents and stop repeating mistakes |
| 5. Marketing and PR | postiz, listmonk, open-seo, Umami; the monitoring pipeline | A weekly content cycle runs with one approval step |
| 6. Creative studio | hyperframes and ComfyUI first; then the craft tools in the browser | Agents draft, people finish |
| 7. HR and CAD | Frappe HRMS; the Atelier CAD worker, cadcraft, the building editor | |
| 8. Home screen | Your own interface over all of it | It feels like one app |

## Running it for free

Every pick is free software that you host yourself. These are the costs that remain, and the free route for each.

| What still costs money | Free route | What you give up |
|---|---|---|
| The models: Claude Code and Codex subscriptions | opencode with local models through Ollama | Weaker results; needs a machine with a strong GPU or a lot of memory |
| Servers | Run it on computers you own | The full engine is about 25 services; phases 1 to 3 fit on one good machine |
| GST e-invoice and e-waybill automation (paid India Compliance account) | Prepare in ERPNext, upload on the GST portal by hand | A manual step at each filing |
| SEO data (paid DataForSEO key for open-seo) | The claude-seo skills with Google Search Console data | No competitor or backlink data |
| WhatsApp messages the business starts | Reply only inside chats that customers start; use web chat and email for the rest | No outbound WhatsApp campaigns. Check Meta's current rates |
| Bulk email sending | A mail provider's free tier | Small monthly limits |
| Phone calls and SMS | None | Phone networks always charge |
| AI image and video from Higgsfield or Runway | ComfyUI with open models | Needs a GPU; lower quality |

**Paid tiers you can ignore.** DocuSeal, Metabase, Infisical, authentik, LiteLLM, Langfuse, Stirling-PDF and Activepieces each have a free core that covers this design. For tools with no paid tier at all, swap in Superset for Metabase, OpenBao for Infisical, Keycloak for authentik and agentgateway for LiteLLM.

**"Free" options to avoid.** Free-model pooling (freellmapi, dsh-our-free-model) and unofficial WhatsApp gateways cost nothing, but they break the providers' terms and get accounts banned.

## Licences

- **For running your own company:** every pick above is usable.
- **For selling the engine to others:** it changes. GPL and AGPL tools (ERPNext, Frappe apps, Metabase, listmonk, postiz, Lago, DocuSeal, ONLYOFFICE) can be hosted as separate services if you publish your changes to them. Tools with "source-available" terms forbid offering them as a service: n8n, Outline, Akaunting, Invoice Ninja, Directus, NocoDB, Phoenix, context-mode. FailproofAI and Typebot have their own limits. Get this reviewed before selling.

## How far to trust this

- 262 READMEs were read by Sonnet readers (top of each file); 60 entries are from descriptions and prior knowledge; 31 are description only; 15 were read earlier in the session.
- paperclip and rakazo were also checked directly: licence, release dates and activity.
- Maturity claims for the craft tools are the projects' own estimates.
- Star counts are as GitHub reports them and are a weak signal.
