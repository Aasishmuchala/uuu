// The primitives' gallery: every component of CONTRACTS-V2 13.1 with the changes of CONTRACTS-V3 28, in every
// variant and state, on fixed sample data, over the canvas. "?open=dialog" or "?open=drawer" opens that overlay at
// once (for screenshots); "?theme=", "?accent=", "?backdrop=" and "?motion=" are read by lib/theme-boot.js.
import { html, useState } from "../vendor/preact-htm.js";
import {
  Avatar, BeingBuilt, Button, Card, Chip, Dialog, Drawer, Empty, ErrorNotice, Field, ICON_NAMES, Icon, Kbd, Live,
  Loading, Menu, Mono, NextStep, NotConnected, Notice, PageHeader, Section, Select, StateIcon, StatusDot, Switch,
  Tabs, Tag, TextArea, TextInput, Time, Waiting,
} from "./index.js";

const NOW = "2026-11-11T09:00:00.000Z";
const TEAM = [
  ["chief-of-staff", "Chief of staff"], ["builder", "Builder"], ["checker", "Checker"], ["bookkeeper", "Bookkeeper"],
  ["sales", "Sales"], ["support", "Support"], ["people", "People"], ["marketer", "Marketer"], ["drafter", "Drafter"], ["artist", "Artist"],
];

const DEPTS = [
  ["operations", "Operations"], ["sales", "Sales"], ["marketing", "Marketing"], ["studio", "Studio"],
  ["support", "Support"], ["people", "People"], ["books", "Books"], ["brain", "Company brain"],
];

const row = "display:flex;flex-wrap:wrap;align-items:center;gap:12px";
const grid = "display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px";

function Overlays() {
  const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("open");
  const [dialog, setDialog] = useState(asked === "dialog");
  const [drawer, setDrawer] = useState(asked === "drawer");
  const [side, setSide] = useState("right");
  return html`<div style=${row}>
    <${Menu} label="Actions" items=${[
      { id: "open", label: "Open the task", icon: "external", onSelect: () => {} },
      { id: "send", label: "Send back with a note", icon: "send", onSelect: () => {} },
      { id: "stop", label: "Stop this task", icon: "cross", danger: true, onSelect: () => {} },
    ]} />
    <${Menu} label="More actions" icon="menu" items=${[{ id: "a", label: "Copy the identifier" }, { id: "b", label: "Pause the agent" }]} />
    <${Button} onClick=${() => setDialog(true)}>Open a dialog<//>
    <${Button} onClick=${() => { setSide("right"); setDrawer(true); }}>Open the right drawer<//>
    <${Button} onClick=${() => { setSide("left"); setDrawer(true); }}>Open the left drawer<//>
    <${Dialog}
      open=${dialog}
      title="Stop this task?"
      onClose=${() => setDialog(false)}
      footer=${html`<${Button} onClick=${() => setDialog(false)}>Cancel<//><${Button} variant="danger" onClick=${() => setDialog(false)}>Stop the task<//>`}
    >
      <div class="u-stack">
        <p>The Builder stops at once. What it has written so far stays in the task's folder.</p>
        <${Field} label="A note for the Builder" hint="Optional."><${TextArea} autoGrow placeholder="Why it stops" /><//>
      </div>
    <//>
    <${Drawer} open=${drawer} side=${side} title="Files" onClose=${() => setDrawer(false)}>
      <div class="u-stack">
        <p>walker-sheet.png</p>
        <p class="u-caption">412 bytes</p>
      </div>
    <//>
  </div>`;
}

function Forms() {
  const [text, setText] = useState("Write the November newsletter");
  const [who, setWho] = useState("marketer");
  const [on, setOn] = useState(true);
  return html`<div style=${grid}>
    <div class="u-stack">
      <${Field} label="Title" hint="Say it the way you would say it to a person.">
        <${TextInput} value=${text} onInput=${(e) => setText(e.target.value)} />
      <//>
      <${Field} label="Due" error="Pick a date in the future.">
        <${TextInput} value="1 Nov 2026" />
      <//>
      <${Field} label="Disabled"><${TextInput} value="Cannot be changed" disabled /><//>
    </div>
    <div class="u-stack">
      <${Field} label="Who does it">
        <${Select} value=${who} onChange=${(e) => setWho(e.target.value)} options=${TEAM.map(([value, label]) => ({ value, label }))} />
      <//>
      <${Field} label="Notes" hint="Grows as you type.">
        <${TextArea} autoGrow placeholder="Anything the agent should know" />
      <//>
    </div>
    <div class="u-stack">
      <${Switch} on=${on} label="Daily brief" explain="The Chief of staff writes it every morning at 07:30." onChange=${setOn} />
      <${Switch} on=${false} label="Weekly content plan" onChange=${() => {}} />
      <${Switch} on=${false} disabled label="Local helper model" explain="Off: it would need about 5 GB of disk. See Health." />
    </div>
  </div>`;
}

function TabsDemo() {
  const [tab, setTab] = useState("r2");
  return html`<div class="u-stack">
    <${Tabs}
      label="Check rounds"
      current=${tab}
      onChange=${setTab}
      tabs=${[
        { id: "r1", label: "Round 1", tone: "bad" },
        { id: "r2", label: "Round 2", tone: "ok" },
        { id: "files", label: "Files", count: 4 },
        { id: "talk", label: "Conversation", count: 12 },
      ]}
    />
    <p class="u-muted">Showing: ${tab}</p>
  </div>`;
}

// The two themes, for this visit only (theme-boot.js keeps the remembered choice).
function ThemeSwitch() {
  const read = () => (typeof document === "undefined" ? "dark" : document.documentElement.getAttribute("data-theme") || "dark");
  const [theme, setTheme] = useState(read);
  const set = (t) => {
    document.documentElement.setAttribute("data-theme", t);
    setTheme(t);
  };
  return html`<${Button}
    variant="plain"
    icon=${theme === "light" ? "moon" : "sun"}
    onClick=${() => set(theme === "light" ? "dark" : "light")}
  >${theme === "light" ? "Dark" : "Light"}<//>`;
}

export default function Gallery() {
  const [busy, setBusy] = useState(false);
  return html`<main style="position:relative;z-index:1;max-width:var(--content-max);margin:0 auto;padding:var(--s-8) var(--s-4) var(--s-12)">
    <${PageHeader}
      over="Kit · Primitives"
      title="The company brain's parts"
      creature="brain"
      lead="Every primitive of the kit, in each variant and state, on fixed sample data."
      back=${{ href: "#", label: "All parts" }}
      chip=${{ label: ["Marketing", "A carousel from a concept"], href: "#" }}
      actions=${html`<${ThemeSwitch} /><${Button} icon="plus" variant="primary">New task<//>`}
    >
      <p class="u-muted">Add ?theme=light, ?accent=blue, ?backdrop=stars, ?motion=off or ?open=dialog to the address.</p>
    <//>

    <${Section} title="Buttons" hint="Every button is a pill. One solid primary per view; the green Accept only on a task's page.">
      <div class="u-stack">
        <div style=${row}>
          <${Button} variant="primary">Approve<//>
          <${Button}>Send back<//>
          <${Button} variant="quiet">Cancel<//>
          <${Button} variant="danger" icon="cross">Stop this task<//>
          <${Button} variant="accept" icon="check">Accept<//>
        </div>
        <div style=${row}>
          <${Button} variant="primary" size="sm">Small<//>
          <${Button} size="sm" icon="download">Download<//>
          <${Button} size="lg" icon="send">Large<//>
          <${Button} variant="quiet" icon="panel" aria-label="Show the work panel" />
          <${Button} href="#/tasks" icon="external">A link that looks like a button<//>
        </div>
        <div style=${row}>
          <${Button} variant="primary" busy>Saving<//>
          <${Button} busy=${busy} onClick=${() => { setBusy(true); setTimeout(() => setBusy(false), 1500); }}>Try busy<//>
          <${Button} disabled>Disabled<//>
          <${Button} variant="primary" disabled>Disabled primary<//>
        </div>
      </div>
    <//>

    <${Section} title="Icons" count=${ICON_NAMES.length}>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">
        ${ICON_NAMES.map((n) => html`<div style="display:flex;align-items:center;gap:8px" class="u-muted"><${Icon} name=${n} /><span class="u-caption">${n}</span></div>`)}
      </div>
      <div style=${`${row};margin-top:16px`}>
        ${["backlog", "in_progress", "pending_review", "done", "failed", "canceled"].map(
          (c) => html`<span style="display:inline-flex;align-items:center;gap:6px"><${StateIcon} column=${c} label="" /><span>${c.replace("_", " ")}</span></span>`)}
      </div>
    <//>

    <${Section} title="Avatars">
      <div class="u-stack">
        <div style=${row}>${[20, 24, 32, 48, 72].map((s) => html`<${Avatar} slug="artist" name="Artist" size=${s} />`)}</div>
        <div style=${row}>${TEAM.map(([slug, name]) => html`<${Avatar} slug=${slug} name=${name} size=${32} />`)}</div>
        <div style=${row}>
          ${TEAM.slice(0, 6).map(([slug, name]) => html`<${Avatar} slug=${`no-picture-${slug}`} name=${name} size=${32} />`)}
          <${Avatar} slug="you" name="You" size=${32} />
        </div>
        <div style=${row}>
          <${Avatar} slug="builder" name="Builder" size=${32} state="live" />
          <${Avatar} slug="checker" name="Checker" size=${32} state="warn" />
          <${Avatar} slug="sales" name="Sales" size=${48} state="bad" />
          <${Avatar} slug="no-picture" name="People" size=${24} state="ok" />
        </div>
      </div>
    <//>

    <${Section} title="State marks" hint="A small coloured mark and a word; never colour alone.">
      <div class="u-stack">
        <div style=${row}>
          <${Live} />
          <${Waiting} />
          <${StatusDot} tone="ok" label="Passed" />
          <${StatusDot} tone="wait" label="Queued" />
          <${StatusDot} tone="bad" label="Failed" />
          <${StatusDot} tone="off" label="Paused" />
        </div>
        <div style=${row}>
          <span>Bare dots with screen-reader words:</span>
          <${Live} hideLabel />
          <${Waiting} hideLabel />
          <${StatusDot} tone="bad" hideLabel />
        </div>
      </div>
    <//>

    <${Section} title="Tags and chips">
      <div style=${row}>
        <${Tag}>FYI<//>
        <${Tag} tone="ok">Passed<//>
        <${Tag} tone="warn">Waiting<//>
        <${Tag} tone="bad">Failed<//>
        <${Chip} icon="clock">Every day at 07:30<//>
        <${Chip} icon="layers">M<//>
        <${Chip}>No icon<//>
      </div>
      <div style=${`${row};margin-top:12px`}>
        ${DEPTS.map(([id, name]) => html`<${Chip} dot=${id}>${name}<//>`)}
      </div>
      <div style=${`${row};margin-top:12px`}>
        <span data-dept="studio" style="display:contents"><${Chip} dot>A dot from the nearest department<//></span>
        <${Chip} dot="live">Working<//>
        <${Chip} dot="ok">Passed<//>
        <${Chip} dot="warn">Waiting for you<//>
        <${Chip} dot="bad">Failed<//>
        <${Chip} dot="off">Idle · last active 2 hours ago<//>
      </div>
    <//>

    <${Section} title="Cards">
      <div style=${grid}>
        <${Card}>
          <div class="u-stack">
            <p class="u-over">Glass</p>
            <strong>A plain card</strong>
            <p class="u-muted">A translucent fill, a hairline edge and a faint top highlight.</p>
          </div>
        <//>
        <${Card} tone="warm">
          <div class="u-stack">
            <div class="u-spread"><strong>Needs you</strong><${Waiting} /></div>
            <p class="u-muted">A card that waits for the owner.</p>
          </div>
        <//>
        <${Card} tone="sunken" padding="sm"><p class="u-muted">A sunken card, small padding.</p><//>
        <${Card} tone="ghost">
          <div class="u-stack">
            <strong>A ghost card</strong>
            <p class="u-muted">No fill: the hairline alone, for quiet groups straight on the canvas.</p>
          </div>
        <//>
        <${Card} href="#/tasks/STH-8">
          <div class="u-stack">
            <div class="u-row"><${Live} /><${Mono}>STH-8<//></div>
            <strong>Make a walking sprite for the mascot</strong>
            <div class="u-spread"><${Chip} icon="layers">S<//><${Avatar} slug="artist" name="Artist" /></div>
          </div>
        <//>
        <${Card} onClick=${() => {}} padding="lg"><strong>A card that is one button</strong><//>
      </div>
    <//>

    <${Section} title="Tabs"><${TabsDemo} /><//>

    <${Section} title="Fields"><${Forms} /><//>

    <${Section} title="States">
      <div class="u-stack">
        <${Notice} title="Heads up">The books are read-only while the bench restarts.<//>
        <${Notice} tone="ok" title="Saved">Your settings are saved.<//>
        <${Notice} tone="warn" title="Waiting for you">Two plans wait for your Accept.<//>
        <${Notice} tone="bad" title="Could not send">The board did not answer.<//>
        <${ErrorNotice} error=${{ message: "The board did not answer in time." }} onRetry=${() => {}} />
        <${NotConnected} reason="The books are not running on this Mac." next="Start them, then reload. Run: engine start books" />
        <${NextStep} text="Run: engine setup" />
        <div style=${grid}>
          <${Empty} title="Nothing needs you" text="When an agent asks for a decision it shows up here.">
            <${Button} variant="primary" icon="plus">New task<//>
          <//>
          <${BeingBuilt} title="Routines" />
          <${Card}><${Loading} lines=${4} label="Loading the tasks" /><//>
        </div>
      </div>
    <//>

    <${Section} title="Overlays" hint="Esc closes; focus stays inside and returns to the button."><${Overlays} /><//>

    <${Section} title="Text">
      <div style=${row}>
        <${Time} at=${NOW} />
        <${Time} at=${NOW} prefix="Updated" />
        <${Mono}>STH-12<//>
        <span>Press <${Kbd}>⌘<//> <${Kbd}>K<//> to search, <${Kbd}>c<//> for a new task.</span>
      </div>
    <//>

    <${Section} title="Section with everything" hint="A hint under the title." count=${3} aside=${html`<${Button} size="sm" variant="quiet" icon="plus">Add<//>`}>
      <p class="u-muted">The body of the section.</p>
    <//>
  </main>`;
}
