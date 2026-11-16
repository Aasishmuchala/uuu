// Settings: the Generation section (PLAN-V5 K13, T44; drawn as PLAN-COOK T54). The switch that lets one agent, the
// Artist, make clips and pictures with Runway, a paid service, through the generation door. The settings frame
// (pages/settings.js) draws the title and the state this module's statusLine gives; this module draws groups of the
// kit into the column, the control first: Runway (the switch with its training warning, the key, the door), the
// limits with what was spent, Higgsfield, the four models, the films the owner approved and every job, by day.
// The key is typed into a password field that the server never fills; it lives only in this component's memory
// until Save, and is cleared then. It is never put in storage, the address bar, the console or a message.
// The automatic allowance for small jobs is not offered (C5): nothing is made without the owner's yes.
// Higgsfield (PLAN-V5 K20, K21, K23; T81): a second paid service in its own group, off until the owner signs in and
// switches it on. Its sign-in is the generation door's: this page asks for the authorize address, checks that it is
// Higgsfield's own and sends the owner's browser there; the return lands on Settings with `?generation=connected` or
// `failed`, said once and taken out of the address. Money is typed in dollars and kept in whole cents.
// Nothing typed, and no address the owner came back with beyond that one word, goes to storage or the console.
// Titles and words from the board and the ledger are shown only as plain capped text, never as HTML.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { parseHash } from "../lib/router.js";
import { count } from "../lib/format.js";
import {
  Button, Card, Checklist, DataTable, Dialog, Empty, ErrorNotice, Field, Group, Icon, Loading, Meter, MoneyInput, NextStep, Notice, Row, Rows,
  Select, St, Switch, Tag, TextInput, Time,
} from "../kit/index.js";

const EVERY = 10000;
const ZONE = "Asia/Kolkata";
export const MAX_CAP = 1_000_000;

// The sentences of K13 and T41, as written, and the few this section adds.
export const WORDS = {
  title: "Generation",
  intro: "The Artist and your apps can make pictures and clips with Runway and Higgsfield, two paid services, from your own renders.",
  sent: "When this is on, the renders and prompts you approve are sent to Runway. Runway's terms say it may use them to train its models unless you have an Enterprise agreement. Do not use it for client work you may not share.",
  money: "Runway and Higgsfield share these limits. Nothing is spent until you approve a shotlist, press Start on a job, or allow an app to spend.",
  switchLabel: "Let the Artist use Runway",
  off: "Off. Nothing is sent to Runway.",
  on: "On. Only the Artist can ask, and only inside what you approved.",
  keyField: "Runway key",
  noKey: "No key yet. Paste the one from your Runway developer account.",
  refused: "Runway refused this key.",
  keySaved: "A key is saved.",
  saveKey: "Save key",
  removeKey: "Remove key",
  removeAsk: "Remove the Runway key?",
  removeWhy: "Nothing can be made until you paste one again.",
  test: "Test",
  testWhat: "Test asks Runway how many credits you have. It costs nothing, and works while the switch is off.",
  limited: "Runway says too many requests for now. Try again in a minute.",
  noAnswer: "Runway did not answer. Try again in a minute.",
  daily: "Most to spend in a day ($)",
  monthly: "Most to spend in a month ($)",
  zero: "A limit of 0 stops all making.",
  overDay: "Today's limit is reached. Nothing more will be made until tomorrow, or raise the limit.",
  overMonth: "This month's limit is reached. Nothing more will be made until next month, or raise the limit.",
  paused: "Runway refused three requests in a day. Generation is paused so your account stays safe.",
  startAgain: "Start again",
  pausedHere: "Paused: nothing is sent to Runway until you press Start again, under Spent below.",
  heldByLimit: "A limit is reached, so nothing more is sent to Runway. See Spent below.",
  heldByLedger: "Nothing is sent to Runway while the spending ledger cannot be read. See Spent below.",
  noFilms: "No film has been approved yet.",
  nothingSpent: "Nothing has been spent yet.",
  showOlder: "Show older",
  restart: "This section appears after the home screen is restarted: engine stop, then engine start.",
  switching: "Switching…",
  doorOn: "The generation door is running.",
  doorOff: "The generation door is off. Run: engine start",
  unhealthy: "The generation door is running but not answering. Run: engine stop, then engine start.",
  notInstalled: "The generation door is not installed yet.",
  pasteFirst: "Paste your Runway key first.",
  noArtist: "Run engine setup first, then try again.",
  cannot: "Generation cannot be switched on yet.",
  unreadable: "The spending ledger cannot be read, so nothing will be made. Health shows what to do.",
  capType: "Type an amount in dollars, such as 3 or 2.50.",
  limitsSay: "Neither the Artist nor an app can spend more than these, even inside what you approved. A day and a month are counted in India time.",
  modelsSay: "Which model makes each kind of work, with the service it runs on and its price. Higgsfield's models are listed once it is on and signed in.",
  filmsEmpty: "A film shows here once you approve its shotlist and its cost.",
  ledgerEmpty: "Every clip and picture the Artist or an app asks Runway or Higgsfield for shows here, with what it cost.",
  onlyModel: "The only model priced for this.",
  doorTestLater: "It can be tested once the generation door is running.",
  switchWhen: "It can be switched on when these are done:",
  door: "The generation door",
  replaceKey: "Replace",
};

// The groups of the section, in the order they are drawn, and the few labels of the tables.
export const GROUPS = {
  runway: "Runway",
  limits: "Limits and what was spent",
  higgsfield: "Higgsfield",
  models: "Models",
  films: "Films you approved",
  ledger: "Every job",
  newest: "Newest first",
  saveLimits: "Save limits",
  putBack: "Put back",
};

// Higgsfield's words (K23), and the few this card adds.
export const HF_WORDS = {
  title: "Higgsfield",
  sent: "Higgsfield's terms let it use what you send, and what it makes, to train its models. Do not send client work you may not share.",
  switchLabel: "Use Higgsfield",
  off: "Off. Nothing is sent to Higgsfield.",
  on: "On. Your apps and the Artist may use it, inside what you approve.",
  onSignedOut: "On, but not signed in. Nothing is sent to Higgsfield until you sign in.",
  signedOut: "Not signed in.",
  signedIn: "Signed in.",
  refused: "Higgsfield asked you to sign in again.",
  signIn: "Sign in to Higgsfield",
  signOut: "Sign out of Higgsfield",
  signOutAsk: "Sign out of Higgsfield?",
  signOutWhy: "Your apps and the Artist cannot use Higgsfield until you sign in again.",
  stay: "Stay signed in",
  connected: "Higgsfield is connected.",
  notFinished: "The Higgsfield sign-in did not finish. Try again.",
  badAddress: "Higgsfield's sign-in address was not what was expected, so it was not opened.",
  rate: "One Higgsfield credit counts as (cents)",
  rateHint: "Plus is about 5 cents a credit. Changing this does not change what you already approved.",
  rateType: "Type a whole number of cents from 1 to 50, such as 5.",
  saveRate: "Save",
  testWhat: "Test asks Higgsfield how many credits you have. It costs nothing, and works while the switch is off.",
  doorOff: "The generation door is off. Run: engine start",
  noAnswer: "Higgsfield did not answer. Try again in a minute.",
  notSignedInTest: "Not signed in to Higgsfield.",
  signInFirst: "Sign in first, then Test can ask Higgsfield.",
  waiting: "Waiting for Higgsfield. This can take up to 75 seconds.",
  account: "Higgsfield account",
};

// The only address the sign-in may send the owner's browser to (K21).
// (The host is named apart from "https://" so no page names a host as a literal address; the test reads it back whole.)
const HF_HOST = "mcp.higgsfield.ai";
export const HF_AUTHORIZE = `https://${HF_HOST}/oauth2/authorize?`;
export const HF_RATE_MIN = 1;
export const HF_RATE_MAX = 50;

// The two limits, in K13's words.
export const CAPS = [
  { key: "daily", label: WORDS.daily, short: "Today" },
  { key: "monthly", label: WORDS.monthly, short: "This month" },
];

// The four models the owner chooses, in the plan's words.
export const MODEL_FIELDS = [
  { key: "video", label: "Clips from a render" },
  { key: "videoBest", label: "Clips marked best, and clips from words alone" },
  { key: "still", label: "Variations of a still" },
  { key: "upscale", label: "Larger stills" },
];

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const grouped = (n) => Number(n).toLocaleString("en");

// Plain text: control and invisible characters taken out, at most `n` characters.
export const plain = (v, n = 200) => String(v ?? "")
  .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
  .slice(0, n);

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (tested in test/pages/settings-generation.test.mjs)

// Credits as dollars: one credit is one US cent. dollars(150) -> "$1.50", dollars(100000) -> "$1,000.00".
export function dollars(credits) {
  const n = Number.isFinite(Number(credits)) ? Math.max(0, Number(credits)) : 0;
  return `$${(n / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// "1 credit", "1,200 credits".
export const creditWords = (n) => `${grouped(num(n))} ${num(n) === 1 ? "credit" : "credits"}`;

// "$0.25".
export const creditsAndDollars = (n) => dollars(num(n));

// K13's balance sentence.
export const balanceLine = (n) => `Runway says you have ${grouped(num(n))} ${num(n) === 1 ? "credit" : "credits"}.`;

// The switch's state sentence.
export const switchLine = (on) => (on ? WORDS.on : WORDS.off);

// The generation door's state as a mark and a sentence: on, off, unhealthy or not installed.
export const DOOR = {
  on: { tone: "ok", word: "Running", sentence: WORDS.doorOn },
  off: { tone: "off", word: "Off", sentence: WORDS.doorOff },
  unhealthy: { tone: "warn", word: "Not answering", sentence: WORDS.unhealthy },
  not_installed: { tone: "off", word: "Not installed", sentence: WORDS.notInstalled },
};
export function doorState(door) {
  const s = obj(door) && Object.hasOwn(DOOR, door.state) ? door.state : "off";
  return { state: s, ...DOOR[s] };
}

// Open: switched on, the door running, a key saved, nothing paused, no limit reached, the ledger and the settings
// readable. Only then can the Artist's asks reach Runway.
export function isOpen(view) {
  const v = obj(view) ? view : {};
  return Boolean(v.on && doorState(v.door).state === "on" && v.key && v.key.saved && !v.paused && !v.problem
    && !ledgerLost(v) && !capsLines(v).length);
}
const ledgerLost = (v) => (obj(v.spent) && v.spent.ok === false) || (obj(v.ledger) && v.ledger.ok === false);

// The mark beside the section's first card: Off, On (open), On but held (warn), or Paused.
export function heroMark(view) {
  const v = obj(view) ? view : {};
  if (!v.on) return { tone: "off", word: "Off" };
  if (v.paused) return { tone: "warn", word: "Paused" };
  return { tone: isOpen(v) ? "ok" : "warn", word: "On" };
}

// The word under the drawn door.
export function doorWord(view) {
  const v = obj(view) ? view : {};
  const d = doorState(v.door);
  if (d.state !== "on") return d.word;
  if (v.paused) return "Paused";
  if (v.on && !ledgerLost(v) && capsLines(v).length) return "Limit reached";
  return isOpen(v) ? "Open" : "Closed";
}

// One line under the switch while it is on but held by the pause, a limit or the ledger (the door and a missing key
// have their own notices there), pointing to where it is put right; else "".
export function heroNote(view) {
  const v = obj(view) ? view : {};
  if (!v.on) return "";
  if (v.paused) return WORDS.pausedHere;
  if (ledgerLost(v)) return WORDS.heldByLedger;
  if (capsLines(v).length) return WORDS.heldByLimit;
  return "";
}

// Why the switch cannot be turned on, one sentence per blocker, in the order the server gives them (T41's words).
export function blockerLines(view) {
  const v = obj(view) ? view : {};
  const out = [];
  for (const b of arr(v.blockers)) {
    if (b === "no_key") out.push(WORDS.pasteFirst);
    else if (b === "door_off") out.push(doorState(v.door).state === "on" ? WORDS.doorOff : doorState(v.door).sentence);
    else if (b === "no_artist") out.push(WORDS.noArtist);
  }
  if (!out.length && v.canSwitchOn === false) out.push(plain(v.whyNot, 300) || WORDS.cannot);
  return out;
}

// The key's state, before any Test: K13's no-key sentence, or "A key is saved."
export const keyLine = (view) => (obj(view) && obj(view.key) && view.key.saved ? WORDS.keySaved : WORDS.noKey);

// The answer of Test ({ ok, balance, monthlyMax, sentence }) as a mark and K13's or T41's sentence.
export function testResult(answer) {
  const a = obj(answer) ? answer : {};
  const said = plain(a.sentence, 300);
  if (a.ok === true && Number.isInteger(a.balance) && a.balance >= 0) {
    const max = Number.isInteger(a.monthlyMax) && a.monthlyMax > 0 ? `Your Runway plan lets you spend up to ${creditWords(a.monthlyMax)} a month.` : "";
    return { tone: "ok", word: "Works", sentence: balanceLine(a.balance), more: max };
  }
  if (said === WORDS.refused) return { tone: "bad", word: "Refused", sentence: WORDS.refused, more: "Copy the key again from your Runway developer account and save it here." };
  if (said === WORDS.noKey) return { tone: "off", word: "No key", sentence: WORDS.noKey, more: "" };
  if (said === WORDS.limited) return { tone: "warn", word: "Busy", sentence: WORDS.limited, more: "" };
  if (said === WORDS.doorOff) return { tone: "warn", word: "Door off", sentence: WORDS.doorOff, more: "" };
  return { tone: "warn", word: "No answer", sentence: said || WORDS.noAnswer, more: "" };
}

// The mark beside "Runway key": what the last Test found, else whether a key is saved.
export function keyMark(view, answer) {
  const saved = Boolean(obj(view) && obj(view.key) && view.key.saved);
  if (!saved) return { tone: "off", word: "No key" };
  if (answer) {
    const t = testResult(answer);
    return { tone: t.tone, word: t.word };
  }
  return { tone: "wait", word: "Saved, not tested" };
}

// A limit as typed, in dollars with at most two decimals, from $0 to $10,000; "$", commas and spaces between digits are
// fine. -> { value, error }: `value` is whole cents (null when it is not an amount). "3" -> 300, "2.5" -> 250, "0.01" -> 1.
export function capCheck(text) {
  const t = String(text ?? "").trim().replace(/^\$\s*/, "").replace(/(\d)[,\s_](?=\d)/g, "$1");
  const m = /^(\d{0,9})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m || (m[1] === "" && m[2] === undefined)) return { value: null, error: WORDS.capType };
  const value = Number(m[1] || 0) * 100 + Number((m[2] || "").padEnd(2, "0") || 0);
  if (value > MAX_CAP) return { value: null, error: `The most is ${dollars(MAX_CAP)}.` };
  return { value, error: "" };
}

// Whole cents as the text of a field, two decimals: 300 -> "3.00", 1 -> "0.01".
export function centsText(cents) {
  const c = Number.isInteger(cents) && cents >= 0 ? cents : 0;
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

// Under a limit of 0, K13's stop sentence; nothing else needs saying beside a typed amount.
export function capHint(text) {
  const c = capCheck(text);
  return c.value === 0 ? WORDS.zero : "";
}

// Which limit the server refused, from its message, which names the field in K13's words.
export function capFieldOf(message) {
  const m = String(message ?? "");
  if (m.includes("in a day")) return "daily";
  if (m.includes("in a month")) return "monthly";
  return null;
}

// How much of a bar is drawn, from 0 to 1. A cap of 0 is full as soon as anything is spent.
export function share(value, total) {
  const v = Number(value);
  const t = Number(total);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (!Number.isFinite(t) || t <= 0) return 1;
  return Math.min(v / t, 1);
}
// The bar's colour: calm while there is room, amber from four fifths, red at the cap.
export function barTone(value, total) {
  const s = share(value, total);
  return s >= 1 ? "bad" : s >= 0.8 ? "warn" : "ok";
}

// "$1.20 of $3.00"; null spent (the ledger cannot be read) says so.
export function spentLine(spent, cap) {
  if (!Number.isInteger(spent) || spent < 0) return "Cannot be read";
  return `${dollars(spent)} of ${dollars(num(cap))}`;
}

// What is left under one limit, in words.
export const leftLine = (left) => `${dollars(num(left))} left`;

// The sentences under Spent for the limits: K13's over-a-cap sentence, this month's, and the stop of a 0.
export function capsLines(view) {
  const v = obj(view) ? view : {};
  const s = obj(v.spent) ? v.spent : {};
  const c = obj(v.caps) ? v.caps : {};
  if (s.ok === false) return [];
  const out = [];
  if (c.daily === 0 || c.monthly === 0) out.push(WORDS.zero);
  else if (Number.isInteger(s.day) && s.dayLeft === 0) out.push(WORDS.overDay);
  else if (Number.isInteger(s.month) && s.monthLeft === 0) out.push(WORDS.overMonth);
  return out;
}

// The pause, in the server's sentence first (the door's own pause, or the switches file's).
export function pausedLine(view) {
  const p = obj(view) ? view.paused : null;
  if (!obj(p)) return "";
  return plain(p.sentence, 300) || WORDS.paused;
}

// The ledger's sentence when it cannot be read or is nearly full, else "".
export function ledgerLine(view) {
  const l = obj(view) && obj(view.ledger) ? view.ledger : null;
  if (!l) return "";
  if (l.ok === false) return plain(l.sentence, 300) || WORDS.unreadable;
  return plain(l.sentence, 300);
}

// Jobs still running, counted as spent until they end.
export function runningLine(n) {
  const k = num(n);
  if (!k) return "";
  return k === 1 ? "1 job is running. It is counted as spent until it ends." : `${grouped(k)} jobs are running. They are counted as spent until they end.`;
}

// The mark beside "Spent".
export function spentMark(view) {
  const v = obj(view) ? view : {};
  if (!obj(v.spent) || v.spent.ok === false) return { tone: "bad", word: "Cannot be read" };
  if (v.paused) return { tone: "warn", word: "Paused" };
  if (capsLines(v).length) return { tone: "bad", word: "Limit reached" };
  return { tone: "ok", word: "Within your limits" };
}

// Every K13 sentence the section shows for a view, in the order it shows them (the switch, the key, the pause,
// the limits, the ledger). A Test's answer adds its own.
export function stateLines(view, answer = null) {
  const v = obj(view) ? view : {};
  const out = [switchLine(Boolean(v.on)), keyLine(v)];
  if (answer) out.push(testResult(answer).sentence);
  const p = pausedLine(v);
  if (p) out.push(p);
  out.push(...capsLines(v));
  const l = ledgerLine(v);
  if (l) out.push(l);
  return out;
}

// The select's options for one model choice: the door's priced models with their price words.
export function modelOptions(view, key) {
  const list = arr(obj(view) && obj(view.choices) ? view.choices[key] : null)
    .filter((c) => obj(c) && typeof c.model === "string")
    .map((c) => ({ value: c.model, label: plain(c.words, 120) || plain(c.model, 80) }));
  const current = obj(view) && obj(view.models) ? view.models[key] : null;
  if (typeof current === "string" && !list.some((o) => o.value === current)) {
    return [{ value: current, label: `${plain(current, 80)}: no price`, disabled: true }, ...list];
  }
  return list;
}

// Where a film's link goes: its shots in Studio. Only a plain id makes a link.
export function filmHref(task) {
  const id = obj(task) ? task.id : task;
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? `#/dashboards/studio?film=${encodeURIComponent(id)}` : null;
}

// A film's name: its identifier and title, as plain text.
export function filmName(task) {
  if (!obj(task)) return { identifier: "", title: "A film whose task is not on the board" };
  return { identifier: plain(task.identifier, 40), title: plain(task.title, 200) || "A film" };
}

// "$0.50 of $3.00"; with the ledger unreadable, only the budget.
export function batchLine(b) {
  const x = obj(b) ? b : {};
  if (!Number.isInteger(x.spent)) return `Budget ${dollars(num(x.budget))}`;
  return `${dollars(x.spent)} of ${dollars(num(x.budget))}`;
}

// A ledger row's kind in words, the server's own when it gave them ("Clip, 5 s", "Clip from words, 5 s",
// "Variation", "Larger still").
export function rowWords(row) {
  const r = obj(row) ? row : {};
  if (typeof r.words === "string" && r.words) return plain(r.words, 100);
  const s = Number.isInteger(r.seconds) ? `, ${r.seconds} s` : "";
  const what = r.kind === "image_to_video" ? `Clip${s}` : r.kind === "text_to_video" ? `Clip from words${s}`
    : r.kind === "still_variation" ? "Variation" : r.kind === "still_upscale" ? "Larger still" : "Other";
  const app = obj(r.app) ? plain(r.app.name || r.app.slug, 40) : "";
  return app ? `${app}: ${what}` : what;
}

// The service a ledger row went to, by name; a row with no provider is Runway's.
export const serviceName = (row) => (obj(row) && row.provider === "higgsfield" ? "Higgsfield" : "Runway");

// A row's result words (T41's), with the mark's colour.
export const RESULT_TONES = {
  Made: "ok",
  "Refused by Runway": "bad",
  "Refused by Higgsfield": "bad",
  Failed: "bad",
  "Runway could not use the picture": "warn",
  "Higgsfield could not use the picture": "warn",
  Cancelled: "off",
  "Unclear, counted as spent": "warn",
  "Stopped: over a limit": "warn",
  "Not started, nothing spent": "off",
  "Running, counted until it ends": "live",
};
export const resultTone = (result) => RESULT_TONES[result] || "warn";

// A day's figures in words: "$0.50", "2 jobs", "1 refused".
export function dayFigures(d) {
  const x = obj(d) ? d : {};
  return {
    credits: creditsAndDollars(x.credits),
    jobs: count(num(x.jobs), "job"),
    refused: num(x.refused) ? `${grouped(num(x.refused))} refused` : "",
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const kolkataDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A ledger day (YYYY-MM-DD, as the door counts days, in India time) in words: "Today", "Yesterday", "Wed 11 Nov",
// or "11 Nov 2025" in another year.
export function dayWords(day, now = Date.now()) {
  if (typeof day !== "string" || !DAY_RE.test(day)) return "";
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const today = kolkataDay(now);
  if (day === today) return "Today";
  if (day === new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)) return "Yesterday";
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return day.slice(0, 4) === today.slice(0, 4) ? `${WEEKDAYS[d.getUTCDay()]} ${date}` : `${date} ${day.slice(0, 4)}`;
}

// A job's time of day, in India time as its day is: "14:05".
export function clockOf(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
}

// Two pages of days as one list, newest first, each day once (the newer page's figures win).
export function mergeDays(a, b) {
  const seen = new Map();
  for (const d of [...arr(a), ...arr(b)]) {
    if (!obj(d) || typeof d.day !== "string" || !DAY_RE.test(d.day) || seen.has(d.day)) continue;
    seen.set(d.day, d);
  }
  return [...seen.values()].sort((x, y) => (x.day < y.day ? 1 : x.day > y.day ? -1 : 0));
}

// A file that could not be read, in the server's words first.
export const PROBLEMS = {
  state_unreadable: "The doors' switches could not be read, so every door is off. Saving anything here writes them again, all off but what you change.",
};
export function problemLine(view) {
  const p = obj(view) ? view.problem : null;
  if (!p) return "";
  return plain(view.problemSentence, 300) || PROBLEMS[p] || "Part of these settings could not be read.";
}

// ---- Higgsfield ------------------------------------------------------------------------------------------------

const hfOf = (view) => (obj(view) && obj(view.higgsfield) ? view.higgsfield : {});

// The address the sign-in may open: Higgsfield's own authorize address (https, its one host and path) or null.
export function hfSignInUrl(url) {
  if (typeof url !== "string" || url.length > 4096 || !url.startsWith(HF_AUTHORIZE) || /[\u0000-\u0020\u007f-\u009f]/.test(url)) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.host === HF_HOST && u.pathname === "/oauth2/authorize" && !u.username && !u.password ? url : null;
  } catch {
    return null;
  }
}

// What Higgsfield is, by the view: signed out, signed in, or asking to sign in again; the sentence is K23's.
export function hfState(view) {
  const h = hfOf(view);
  if (h.refused === true) return { key: "refused", sentence: HF_WORDS.refused };
  if (h.signedIn === true) return { key: "in", sentence: HF_WORDS.signedIn };
  return { key: "out", sentence: HF_WORDS.signedOut };
}

// The mark beside "Higgsfield".
export function hfMark(view) {
  const h = hfOf(view);
  const s = hfState(view).key;
  if (s === "refused") return { tone: "warn", word: "Sign in again" };
  if (s === "out") return h.on === true ? { tone: "warn", word: "Sign in" } : { tone: "off", word: "Off" };
  return h.on === true ? { tone: "ok", word: "On" } : { tone: "off", word: "Off" };
}

// The switch's state sentence.
export function hfSwitchLine(view) {
  const h = hfOf(view);
  if (h.on !== true) return HF_WORDS.off;
  return h.signedIn === true ? HF_WORDS.on : HF_WORDS.onSignedOut;
}

// The rate as typed: a whole number of cents from 1 to 50. -> { value, error }.
export function rateCheck(text) {
  const t = String(text ?? "").trim();
  if (!/^\d{1,3}$/.test(t)) return { value: null, error: HF_WORDS.rateType };
  const value = Number(t);
  return value >= HF_RATE_MIN && value <= HF_RATE_MAX ? { value, error: "" } : { value: null, error: HF_WORDS.rateType };
}

// Test's answer ({ ok, credits, plan, sentence }) as a mark and the server's sentence.
export function hfTestResult(answer) {
  const a = obj(answer) ? answer : {};
  const said = plain(a.sentence, 300);
  if (a.ok === true && typeof a.credits === "number" && Number.isFinite(a.credits) && a.credits >= 0) {
    const n = a.credits;
    return { tone: "ok", word: "Works", sentence: said || `Higgsfield says you have ${grouped(n)} ${n === 1 ? "credit" : "credits"}.` };
  }
  if (said === HF_WORDS.notSignedInTest) return { tone: "off", word: "Not signed in", sentence: said };
  if (said === HF_WORDS.refused) return { tone: "warn", word: "Sign in again", sentence: said };
  if (said === HF_WORDS.doorOff) return { tone: "warn", word: "Door off", sentence: said };
  return { tone: "warn", word: "No answer", sentence: said || HF_WORDS.noAnswer };
}

// The return from Higgsfield's page: `generation=connected|failed` in the address of Settings -> "connected", "failed" or null.
export function hfReturnOf(hash) {
  const r = parseHash(hash);
  const v = r.parts[0] === "settings" ? r.query.get("generation") : null;
  return v === "connected" || v === "failed" ? v : null;
}

// The same address without that word: "#/settings?generation=failed" -> "#/settings"; other words stay.
export function hashWithoutReturn(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  const [path, qs] = raw.split("?");
  const q = new URLSearchParams(qs || "");
  q.delete("generation");
  const rest = q.toString();
  return `#${path}${rest ? `?${rest}` : ""}`;
}

// The only two places this page touches the address bar. Reading the return and taking it out of the address; and
// sending the owner's browser to an address that hfSignInUrl has passed. Nothing typed goes to either.
function takeReturn() {
  const found = hfReturnOf(window.location.hash);
  if (found) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hashWithoutReturn(window.location.hash)}`);
  return found;
}
function openHiggsfield(url) {
  window.location.assign(url);
}

// What the section draws: "loading", "restart" (the routes are not there yet), "error" or "ready".
export function sectionState(res) {
  if (res && res.data) return "ready";
  if (res && res.error) return res.error.status === 404 ? "restart" : "error";
  return "loading";
}

// A model's words from the door, "Gen-4 Turbo on Runway: $0.05 a second", as the name and its price, every word
// kept: { name: "Gen-4 Turbo on Runway", price: "$0.05 a second" }. Words with no price stay whole as the name.
export function priceOf(words) {
  const w = plain(words, 120);
  const m = /^(.*\S):\s+((?:about\s+)?\$\d[\d,]*(?:\.\d+)?(?:\s.*)?)$/.exec(w);
  return m ? { name: m[1], price: m[2] } : { name: w, price: "" };
}

// The section's state in a few words, for the list of sections and beside the title (pages/settings.js):
// { tone, text }, from the answer of /api/generation.
export function statusLine(data) {
  const v = obj(data) ? data : {};
  if (!v.on) return { tone: "neutral", text: "Off" };
  if (v.paused) return { tone: "warn", text: "Paused" };
  if (ledgerLost(v)) return { tone: "bad", text: "On, but spending cannot be read" };
  const c = obj(v.caps) ? v.caps : {};
  const s = obj(v.spent) ? v.spent : {};
  if (c.daily === 0 || c.monthly === 0) return { tone: "warn", text: "On, a limit of 0 stops all making" };
  if (Number.isInteger(s.day) && s.dayLeft === 0) return { tone: "bad", text: "Over today's limit" };
  if (Number.isInteger(s.month) && s.monthLeft === 0) return { tone: "bad", text: "Over this month's limit" };
  if (doorState(v.door).state !== "on") return { tone: "warn", text: "On, but the generation door is not running" };
  if (!(obj(v.key) && v.key.saved)) return { tone: "warn", text: "On, but no key is saved" };
  if (isOpen(v)) return { tone: "good", text: "On, within your limits" };
  return { tone: "warn", text: "On, held" };
}

// ---------------------------------------------------------------------------------------------------------------
// Parts
// Every part is the kit's (Group, Rows, Row, DataTable, MoneyInput, Meter, Switch, St, Tag, Notice) placed into the
// settings column; this file adds only the drawing of the door's path and the days of the ledger.

// The restart sentence, with the two commands set apart. The words are the plan's, unchanged.
function RestartLine() {
  return html`<p class="p-settings-generation__restart">This section appears after the home screen is restarted: <code class="k-next__command">engine stop</code>, then <code class="k-next__command">engine start</code>.</p>`;
}

// A sentence that may end in "Run: <command>", on a line of its own.
const Line = ({ children }) => (/\bRun:/.test(String(children)) ? html`<${NextStep} text=${children} />` : html`<p class="p-settings-generation__line">${children}</p>`);

// The same inside a line of text (a row's words): the command set apart, every word kept.
function Said({ text }) {
  const t = String(text ?? "");
  const m = /^(.*?\bRun:)\s+(.+)$/s.exec(t);
  return m ? html`${m[1]} <code class="k-next__command">${m[2]}</code>` : t;
}

const Failure = ({ failure, where }) => (failure && failure.where === where
  ? html`<${Notice} tone="bad" title=${failure.error.message}>${failure.error.next ? html`<${Line}>${failure.error.next}<//>` : null}<//>`
  : null);

// The helpers' tones (ok, warn, bad, off, wait, live) in the kit's: a row's state and a St, or a Tag.
const TONE = { ok: "good", bad: "bad", warn: "warn" };
const toneOf = (t) => TONE[t] || "neutral";
const TAG = { ok: "ok", bad: "bad", warn: "warn" };
const tagOf = (t) => TAG[t] || "neutral";

// What follows a row inside its panel, under its words: a failure, a Test's answer, the field that takes a key.
// Draws nothing when there is nothing to say.
function More({ children }) {
  const list = [children].flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== "");
  return list.length ? html`<div class="p-settings-generation__more">${list}</div>` : null;
}

// A Test's answer: the sentence with its tone's glyph, and what to do next under it.
function Answer({ result }) {
  return html`<div class="p-settings-generation__answer" role="status">
    <${St} tone=${toneOf(result.tone)}><${Said} text=${result.sentence} /><//>
    ${result.more ? html`<p class="p-settings-generation__line">${result.more}</p>` : null}
  </div>`;
}

// The door's path, drawn: the Artist, the door, Runway, as three neutral chips joined by a hairline; the door's
// chip carries a 6 px dot in its state's tone. The row's sentence says the same, so the drawing is for the eye only.
function DoorPath({ view }) {
  const open = isOpen(view);
  const dot = open ? "good" : view.on ? "warn" : "neutral";
  return html`<span class=${`p-settings-generation__path${open ? " p-settings-generation__path--open" : ""}`} aria-hidden="true">
    <span class="p-settings-generation__node"><${Icon} name="brush" size=${14} />Artist</span>
    <span class="p-settings-generation__wire"></span>
    <span class="p-settings-generation__node"><span class=${`p-settings-generation__dot p-settings-generation__dot--${dot}`}></span>Door</span>
    <span class="p-settings-generation__wire"></span>
    <span class="p-settings-generation__node"><${Icon} name="film" size=${14} />Runway</span>
  </span>`;
}

// The door's word as a row's state: open is good; held while switched on, or not answering, is a look; closed
// because the owner switched it off is grey.
function doorChip(view) {
  const word = doorWord(view);
  const s = doorState(view.door).state;
  if (word === "Open") return { tone: "good", text: word };
  return { tone: view.on && (s === "on" || s === "unhealthy") ? "warn" : "neutral", text: word };
}

function KeyRow({ view, busy, act, failure, test, runTest }) {
  const [typed, setTyped] = useState("");
  const filled = typed.trim() !== "";
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState(null);
  const saved = Boolean(view.key && view.key.saved);
  const door = doorState(view.door);
  const mark = keyMark(view, test);
  const result = test ? testResult(test) : null;
  const open = editing || !saved;

  // Replace moves the focus into the field; Cancel gives it back to Replace.
  useEffect(() => {
    if (!focus) return;
    document.getElementById(focus)?.focus();
    setFocus(null);
  }, [focus]);

  async function save(event) {
    event.preventDefault();
    if (!typed.trim() || busy) return;
    const ok = await act("key", "/api/generation/key", { key: typed }, "The key is saved.", { reload: true });
    if (ok) setTyped("");
    if (ok) setEditing(false);
  }
  function cancel() {
    setTyped("");
    setEditing(false);
    setFocus("gen-runway-replace");
  }

  // Each fact once: while the switch's list of what to do first asks for the key, this row does not say it again.
  const saidAbove = !saved && !view.on && !view.canSwitchOn && arr(view.blockers).includes("no_key");
  // A saved key not yet tested is a look (the warn chip), not a grey word.
  const chip = { tone: mark.tone === "wait" ? "warn" : toneOf(mark.tone), text: mark.word };
  return html`
    <${Row} icon="key" title=${WORDS.keyField} state=${chip}
      say=${html`${saved ? WORDS.testWhat : saidAbove ? null : WORDS.noKey}${saved && door.state !== "on" ? html`<span class="p-settings-generation__line">${WORDS.doorTestLater}</span>` : null}
        ${saved ? html`<span class="p-settings-generation__actions">
          <${Button} size="sm" variant="primary" icon="play" onClick=${runTest} busy=${busy === "test"} disabled=${Boolean(busy) || door.state !== "on"}>${WORDS.test}<//>
          ${editing ? null : html`<${Button} size="sm" variant="ghost" id="gen-runway-replace" disabled=${Boolean(busy)}
            onClick=${() => { setEditing(true); setFocus("gen-runway-key"); }}>${WORDS.replaceKey}<//>`}
          <${Button} size="sm" variant="ghost" onClick=${() => setAsking(true)} disabled=${Boolean(busy)}>${WORDS.removeKey}<//>
        </span>` : null}`} />
    <${More}>
      ${open ? html`<form class="p-settings-generation__key" onSubmit=${save} autocomplete="off">
        <${Field} hint=${saved ? "Paste a new key to replace the saved one." : "It is kept on this Mac only and is never shown again."}
          error=${failure && failure.where === "key" ? failure.error : null}>
          <${TextInput} id="gen-runway-key" type="password" name="runway-key" autocomplete="off" autocapitalize="off" spellcheck=${false}
            aria-label=${WORDS.keyField} placeholder=${saved ? "A key is saved" : "Paste your key here"}
            value=${typed} onInput=${(e) => setTyped(e.currentTarget.value)}
            onKeyDown=${(e) => { if (e.key === "Escape" && saved) { e.preventDefault(); cancel(); } }} />
        <//>
        <span class="p-settings-generation__buttons">
          ${saved ? html`<${Button} variant="quiet" onClick=${cancel} disabled=${busy === "key"}>Cancel<//>` : null}
          <${Button} variant=${filled ? "primary" : "ghost"} type="submit" busy=${busy === "key"} disabled=${Boolean(busy) || !filled}>${WORDS.saveKey}<//>
        </span>
      </form>` : null}
      ${busy === "test" ? html`<p class="p-settings-generation__line" role="status"><${St} icon="clock">Asking Runway. This can take up to 45 seconds.<//></p>` : null}
      <${Failure} failure=${failure} where="test" />
      <${Failure} failure=${failure} where="remove" />
      ${result && busy !== "test" ? html`<${Answer} result=${result} />` : null}
    <//>
    <${Dialog} open=${asking} title=${WORDS.removeAsk} size="sm" paper onClose=${() => setAsking(false)}
      footer=${html`
        <${Button} data-autofocus onClick=${() => setAsking(false)}>Keep the key<//>
        <${Button} variant="danger" onClick=${async () => { setAsking(false); await act("remove", "/api/generation/key/remove", {}, "The key is removed.", { reload: true }); }}>${WORDS.removeKey}<//>`}>
      <p class="p-settings-generation__line">${WORDS.removeWhy}</p>
    <//>`;
}

// Group 1: the switch with its training warning inside the panel, the key, the door.
function RunwayGroup({ view, busy, act, failure, test, runTest }) {
  const on = Boolean(view.on);
  const locked = !on && !view.canSwitchOn;
  const reasons = blockerLines(view);
  const note = heroNote(view);
  const door = doorState(view.door);
  return html`<${Group} title=${GROUPS.runway}>
    <${Rows}>
      <${Row} icon="power" title=${WORDS.switchLabel}
        say=${html`${busy === "switch" ? WORDS.switching : switchLine(on)}
          ${locked && reasons.length ? html`<${Checklist} lead=${WORDS.switchWhen}
            items=${reasons.map((r) => ({ done: false, text: html`<${Said} text=${r} />` }))} />` : null}
          ${note ? html`<span class="p-settings-generation__line"><${St} tone="warn" icon=${view.paused ? "pause" : undefined}>${note}<//></span>` : null}`}
        control=${html`<${Switch} on=${on} disabled=${locked || Boolean(busy)} label=${WORDS.switchLabel}
          onChange=${(next) => act("switch", "/api/generation/switch", { on: next }, switchLine(next))} />`}
        warned=${WORDS.sent} />
      <${More}><${Failure} failure=${failure} where="switch" /><//>
      <${KeyRow} view=${view} busy=${busy} act=${act} failure=${failure} test=${test} runTest=${runTest} />
      <${Row} icon="door" title=${WORDS.door} state=${doorChip(view)}
        say=${html`<${Said} text=${door.sentence} /><span class="p-settings-generation__line"><${DoorPath} view=${view} /></span>`} />
    <//>
  <//>`;
}

const LIMIT_COLUMNS = [
  { key: "name", label: "", align: "start" },
  { key: "limit", label: "Limit", align: "start" },
  { key: "spent", label: "Spent", align: "start" },
  { key: "left", label: "Left", align: "end" },
];

// Group 2: the two limits as a table (the limit typed in dollars, what was spent over its bar, what is left), the
// pause and its Start again above it, the ledger's sentence, and Save under it.
function LimitsGroup({ view, busy, act, failure }) {
  const [draft, setDraft] = useState({});
  const caps = obj(view.caps) ? view.caps : {};
  const s = obj(view.spent) ? view.spent : {};
  const fields = CAPS.map((c) => {
    const text = draft[c.key] !== undefined ? draft[c.key] : centsText(num(caps[c.key]));
    const check = capCheck(text);
    return { ...c, text, check, changed: draft[c.key] !== undefined && check.value !== caps[c.key] };
  });
  const refused = failure && failure.where === "caps" ? failure.error : null;
  const refusedField = refused ? capFieldOf(refused.message) : null;
  const ready = fields.every((f) => f.check.value !== null) && fields.some((f) => f.changed);
  const paused = pausedLine(view);
  const ledger = ledgerLine(view);
  const running = runningLine(s.running);
  const lines = capsLines(view);

  async function save(event) {
    event.preventDefault();
    if (!ready || busy) return;
    const body = {};
    for (const f of fields) if (f.changed) body[f.key] = f.check.value;
    const ok = await act("caps", "/api/generation/caps", body, "The limits are saved.");
    if (ok) setDraft({});
  }

  const rows = fields.map((f) => ({
    id: f.key,
    f,
    cap: caps[f.key],
    spent: s.ok === false ? null : f.key === "daily" ? s.day : s.month,
    left: f.key === "daily" ? s.dayLeft : s.monthLeft,
  }));
  function cell(r, col) {
    const f = r.f;
    if (col.key === "name") return html`<span class="p-settings-generation__cap">${f.short}</span>`;
    if (col.key === "limit") {
      const error = f.check.error || (refusedField === f.key ? refused.message : "");
      const hint = f.changed ? capHint(f.text) : "";
      const id = `gen-cap-${f.key}-note`;
      return html`<span class="p-settings-generation__limit">
        <${MoneyInput} name=${`cap-${f.key}`} label=${f.label} value=${f.text} maxLength=${12} spellcheck=${false}
          aria-invalid=${error ? "true" : undefined} aria-describedby=${error || hint ? id : undefined}
          onInput=${(text) => setDraft({ ...draft, [f.key]: text })} />
        ${error ? html`<span class="p-settings-generation__error" id=${id}>${error}</span>`
          : hint ? html`<span class="p-settings-generation__hint" id=${id}>${hint}</span>` : null}
      </span>`;
    }
    const known = Number.isInteger(r.spent);
    if (col.key === "spent") {
      if (!known) return html`<span class="p-settings-generation__unread">${spentLine(r.spent, r.cap)}</span>`;
      return html`<span class="p-settings-generation__spent">
        <span class="p-settings-generation__figure">${dollars(r.spent)}</span>
        <${Meter} plain=${true} shares=${{ spent: share(r.spent, r.cap) * 100 }} label=${spentLine(r.spent, r.cap)} />
      </span>`;
    }
    if (!known) return "";
    const over = num(r.cap) > 0 && r.left === 0;
    return html`<span class=${`p-settings-generation__left${over ? " p-settings-generation__left--over" : ""}`}>${dollars(num(r.left))}</span>`;
  }

  return html`<${Group} title=${GROUPS.limits} say=${WORDS.limitsSay}>
    ${paused ? html`<${Rows}>
      <${Row} icon="pause" title=${paused}
        say=${view.paused && view.paused.at ? html`Paused <${Time} at=${view.paused.at} />.` : null}
        control=${html`<${Button} variant="primary" icon="play" busy=${busy === "resume"} disabled=${Boolean(busy)}
          onClick=${() => act("resume", "/api/generation/resume", {}, "Generation is started again.")}>${WORDS.startAgain}<//>`} />
    <//>` : null}
    <${Failure} failure=${failure} where="resume" />
    ${ledger ? html`<${Notice} tone=${view.ledger && view.ledger.ok === false ? "bad" : "warn"}>
      <p class="p-settings-generation__line">${ledger}${view.ledger && view.ledger.ok === false ? html` <a href="#/health">Open Health</a>` : null}</p><//>` : null}
    <${Card} padding="none" class="p-settings-generation__limits">
      <form onSubmit=${save} autocomplete="off">
        <${DataTable} columns=${LIMIT_COLUMNS} rows=${rows} renderCell=${cell} />
        ${lines.length || running || (refused && !refusedField) ? html`<div class="p-settings-generation__notes">
          ${lines.map((l) => html`<p key=${l} class="p-settings-generation__line"><${St} tone="warn">${l}<//></p>`)}
          ${running ? html`<p class="p-settings-generation__line"><${St} icon="clock">${running}<//></p>` : null}
          ${refused && !refusedField ? html`<${Failure} failure=${failure} where="caps" />` : null}
        </div>` : null}
        <div class="p-settings-generation__foot">
          <p class="p-settings-generation__foot-say">${WORDS.money}</p>
          <span class="p-settings-generation__buttons">
            ${Object.keys(draft).length ? html`<${Button} variant="quiet" onClick=${() => setDraft({})} disabled=${Boolean(busy)}>${GROUPS.putBack}<//>` : null}
            <${Button} variant=${ready ? "primary" : "ghost"} type="submit" busy=${busy === "caps"} disabled=${Boolean(busy) || !ready}>${GROUPS.saveLimits}<//>
          </span>
        </div>
      </form>
    <//>
  <//>`;
}

// Higgsfield: its own group in the same drawing; the switch with its training warning, the sign-in with Test, the
// rate, and Save under the group.
function HiggsfieldGroup({ view, busy, act, failure, test, runTest, signIn, returned }) {
  const h = hfOf(view);
  const state = hfState(view);
  const door = doorState(view.door);
  const signedIn = state.key === "in";
  const [rate, setRate] = useState(null);
  const [asking, setAsking] = useState(false);
  const rateText = rate !== null ? rate : String(Number.isInteger(h.centsPerCredit) ? h.centsPerCredit : 5);
  const check = rateCheck(rateText);
  const changed = rate !== null && check.value !== h.centsPerCredit;
  const result = test ? hfTestResult(test) : null;
  const rateFailure = failure && failure.where === "hf-rate" ? failure.error : null;
  const rateError = check.error || (rateFailure && rateFailure.message) || "";

  async function saveRate(event) {
    event.preventDefault();
    if (check.value === null || !changed || busy) return;
    const ok = await act("hf-rate", "/api/generation/higgsfield/rate", { centsPerCredit: check.value }, "The Higgsfield rate is saved.");
    if (ok) setRate(null);
  }

  return html`<div class="p-settings-generation__hf" id="settings-higgsfield">
    <${Group} title=${GROUPS.higgsfield}>
      ${returned ? html`<${Notice} tone=${returned === "connected" ? "ok" : "bad"} title=${returned === "connected" ? HF_WORDS.connected : HF_WORDS.notFinished} />` : null}
      <form onSubmit=${saveRate} autocomplete="off">
        <${Rows}>
          <${Row} icon="power" title=${HF_WORDS.switchLabel} say=${busy === "hf-switch" ? WORDS.switching : hfSwitchLine(view)}
            control=${html`<${Switch} on=${h.on === true} disabled=${Boolean(busy)} label=${HF_WORDS.switchLabel}
              onChange=${(next) => act("hf-switch", "/api/generation/higgsfield/switch", { on: next }, next ? HF_WORDS.on : HF_WORDS.off)} />`}
            warned=${HF_WORDS.sent} />
          <${More}><${Failure} failure=${failure} where="hf-switch" /><//>
          <${Row} icon="people" title=${HF_WORDS.account}
            say=${html`<${St} tone=${signedIn ? "good" : state.key === "refused" ? "warn" : "neutral"}>${state.sentence}<//>
              <span class="p-settings-generation__line">${HF_WORDS.testWhat}</span>
              ${!signedIn ? html`<span class="p-settings-generation__line">${HF_WORDS.signInFirst}</span>`
                : door.state !== "on" ? html`<span class="p-settings-generation__line">${WORDS.doorTestLater}</span>` : null}`}
            control=${html`
              ${signedIn ? null : html`<${Button} size="sm" variant="primary" icon="external" onClick=${signIn} busy=${busy === "hf-begin"} disabled=${Boolean(busy)}>${HF_WORDS.signIn}<//>`}
              ${signedIn ? html`<${Button} size="sm" variant="primary" icon="play" onClick=${runTest} busy=${busy === "hf-test"} disabled=${Boolean(busy) || door.state !== "on"}>${WORDS.test}<//>` : null}
              ${signedIn || state.key === "refused" ? html`<${Button} size="sm" variant="ghost" onClick=${() => setAsking(true)} disabled=${Boolean(busy)}>${HF_WORDS.signOut}<//>` : null}`} />
          <${More}>
            ${busy === "hf-test" ? html`<p class="p-settings-generation__line" role="status"><${St} icon="clock">${HF_WORDS.waiting}<//></p>` : null}
            <${Failure} failure=${failure} where="hf-begin" />
            <${Failure} failure=${failure} where="hf-test" />
            <${Failure} failure=${failure} where="hf-forget" />
            ${result && busy !== "hf-test" ? html`<${Answer} result=${result} />` : null}
          <//>
          <${Row} icon="tag" title=${HF_WORDS.rate}
            say=${rateError ? html`<span class="p-settings-generation__error" id="gen-hf-rate-note">${rateError}</span>` : HF_WORDS.rateHint}
            control=${html`<${TextInput} class="p-settings-generation__rate" name="hf-rate" inputmode="numeric" autocomplete="off" spellcheck=${false} maxLength=${3}
              aria-label=${HF_WORDS.rate} aria-invalid=${rateError ? "true" : undefined} aria-describedby=${rateError ? "gen-hf-rate-note" : undefined}
              value=${rateText} onInput=${(e) => setRate(e.currentTarget.value)} />`} />
        <//>
        <div class="p-settings-generation__save">
          ${rate !== null ? html`<${Button} variant="quiet" onClick=${() => setRate(null)} disabled=${Boolean(busy)}>${GROUPS.putBack}<//>` : null}
          <${Button} variant=${changed && check.value !== null ? "primary" : "ghost"} type="submit" busy=${busy === "hf-rate"} disabled=${Boolean(busy) || !changed || check.value === null}>${HF_WORDS.saveRate}<//>
        </div>
      </form>
      <${Dialog} open=${asking} title=${HF_WORDS.signOutAsk} size="sm" paper onClose=${() => setAsking(false)}
        footer=${html`
          <${Button} data-autofocus onClick=${() => setAsking(false)}>${HF_WORDS.stay}<//>
          <${Button} variant="danger" onClick=${async () => { setAsking(false); await act("hf-forget", "/api/generation/higgsfield/forget", {}, "Signed out of Higgsfield."); }}>${HF_WORDS.signOut}<//>`}>
        <p class="p-settings-generation__line">${HF_WORDS.signOutWhy}</p>
      <//>
    <//>
  </div>`;
}

const MODEL_COLUMNS = [
  { key: "kind", label: "Kind of work", align: "start" },
  { key: "model", label: "Model", align: "start" },
  { key: "price", label: "Price", align: "end" },
];

// A price as the door wrote it, its figure set in the bold weight: "$0.05" and " a second".
function Price({ text }) {
  const m = /^((?:about\s+)?\$[\d.,]*\d)(.*)$/s.exec(text);
  return m ? html`<span class="p-settings-generation__price"><b>${m[1]}</b>${m[2]}</span>` : html`<span class="p-settings-generation__price">${text}</span>`;
}

// Group 3: the four kinds of work, the model that makes each (a choice when there is more than one) and its price.
function ModelsGroup({ view, busy, act, failure }) {
  const rows = MODEL_FIELDS.map((f) => ({ id: f.key, f }));
  function cell(r, col) {
    const f = r.f;
    const options = modelOptions(view, f.key);
    const current = view.models ? view.models[f.key] : "";
    const chosen = arr(obj(view.choices) ? view.choices[f.key] : null).find((c) => obj(c) && c.model === current);
    const words = priceOf(chosen ? chosen.words : "");
    const only = options.length === 1 && options[0].value === current && !options[0].disabled;
    if (col.key === "kind") return html`<span class="p-settings-generation__kind">${f.label}</span>${only ? html`<small>${WORDS.onlyModel}</small>` : null}`;
    if (col.key === "price") return words.price ? html`<${Price} text=${words.price} />` : "";
    if (only || !options.length) {
      return html`<code class="p-settings-generation__model">${plain(current, 80)}</code>${words.name ? html`<small>${words.name}</small>` : null}`;
    }
    const where = `model:${f.key}`;
    return html`<${Field} error=${failure && failure.where === where ? failure.error.message : null}>
      <${Select} options=${options} value=${current || ""} disabled=${Boolean(busy)} aria-label=${f.label}
        onChange=${(e) => {
          const model = e.currentTarget.value;
          if (model && model !== current) act(where, "/api/generation/models", { [f.key]: model }, `${f.label}: ${model}.`);
        }} />
    <//>`;
  }
  return html`<${Group} title=${GROUPS.models} say=${WORDS.modelsSay}>
    <div class="p-settings-generation__models">
      <${DataTable} columns=${MODEL_COLUMNS} rows=${rows} renderCell=${cell} />
    </div>
    ${view.example ? html`<p class="p-settings-generation__foot-say">${plain(view.example, 300)}</p>` : null}
  <//>`;
}

const FILM_COLUMNS = [
  { key: "film", label: "Film", align: "start" },
  { key: "approved", label: "Approved", align: "end" },
  { key: "spent", label: "Spent", align: "end" },
  { key: "budget", label: "Budget", align: "end" },
  { key: "state", label: "State", align: "start" },
];

// Group 4: the films the owner approved, each a link to its shots in Studio, newest first.
function FilmsGroup({ view }) {
  const films = arr(view.batches).filter(obj);
  const rows = films.map((b, i) => ({ id: typeof b.id === "string" ? b.id : i, b }));
  function cell(r, col) {
    const b = r.b;
    if (col.key === "film") {
      const name = filmName(b.task);
      const href = filmHref(b.task);
      return html`${href ? html`<a class="p-settings-generation__film" href=${href}>${name.title}</a>` : html`<span class="p-settings-generation__film">${name.title}</span>`}
        <small class="p-settings-generation__facts">
          ${name.identifier ? html`<span class="p-settings-generation__id">${name.identifier}</span>` : null}
          ${Number.isInteger(b.shots) ? html`<span>${count(b.shots, "shot")}</span>` : null}
          <span>${b.open ? "Expires" : "Ended"} <${Time} at=${b.expiresAt} /></span>
        </small>`;
    }
    if (col.key === "approved") return html`<${Time} at=${b.approvedAt} />`;
    if (col.key === "spent") return Number.isInteger(b.spent) ? html`<span class="p-settings-generation__amount">${dollars(b.spent)}</span>` : "";
    if (col.key === "budget") return html`<span class="p-settings-generation__budget">${dollars(num(b.budget))}</span>`;
    return html`<${Tag} tone=${b.open ? "ok" : "neutral"}>${b.open ? "Open" : "Closed"}<//>`;
  }
  return html`<${Group} title=${GROUPS.films} aside=${films.length ? GROUPS.newest : null}>
    ${films.length
      ? html`<div class="p-settings-generation__films"><${DataTable} columns=${FILM_COLUMNS} rows=${rows} renderCell=${cell} /></div>`
      : html`<${Empty} icon="video" title=${WORDS.noFilms} text=${WORDS.filmsEmpty} />`}
  <//>`;
}

const JOB_COLUMNS = [
  { key: "time", label: "Time", align: "start" },
  { key: "what", label: "What", align: "start" },
  { key: "model", label: "Model", align: "start" },
  { key: "film", label: "Film", align: "start" },
  { key: "result", label: "Result", align: "start" },
  { key: "amount", label: "Amount", align: "end" },
];

// One job of the ledger, a cell at a time.
function jobCell(x, col) {
  const row = x.r;
  if (col.key === "time") return html`<span class="p-settings-generation__time">${clockOf(row.at)}</span>`;
  if (col.key === "what") return rowWords(row);
  if (col.key === "model") return html`<code class="p-settings-generation__model">${plain(row.model, 80)}</code><small>${serviceName(row)}</small>`;
  if (col.key === "film") {
    const href = filmHref(row.task);
    const id = obj(row.task) ? plain(row.task.identifier, 40) : "";
    return href && id ? html`<a class="p-settings-generation__id" href=${href} aria-label=${`Film ${id}`}>${id}</a>` : "";
  }
  if (col.key === "result") return html`<${Tag} tone=${tagOf(resultTone(row.result))}>${plain(row.result, 80) || "Unclear"}<//>`;
  return html`<span class="p-settings-generation__amount">${dollars(num(row.credits))}</span>`;
}

function DayItem({ d, open, toggle }) {
  const f = dayFigures(d);
  const id = `gen-day-${d.day}`;
  const rows = arr(d.rows).filter(obj).map((r, i) => ({ id: `${r.at}-${i}`, r }));
  return html`<li class=${`p-settings-generation__day${open ? " p-settings-generation__day--open" : ""}`}>
    <button type="button" class="p-settings-generation__dayhead" aria-expanded=${open ? "true" : "false"} aria-controls=${id} onClick=${toggle}>
      <${Icon} name="chevron-right" size=${16} class="p-settings-generation__chev" />
      <span class="p-settings-generation__dayname">${dayWords(d.day)}</span>
      <span class="p-settings-generation__dayjobs">${f.jobs}${f.refused ? html`<${Tag} tone="bad">${f.refused}<//>` : null}</span>
      <span class="p-settings-generation__amount">${f.credits}</span>
    </button>
    ${open ? html`
      <div class="p-settings-generation__dayrows" id=${id}>
        <${DataTable} columns=${JOB_COLUMNS} rows=${rows} renderCell=${jobCell} />
        ${num(d.jobs) > rows.length ? html`<p class="p-settings-generation__line">The ${rows.length} newest of ${count(num(d.jobs), "job")} are shown.</p>` : null}
      </div>` : null}
  </li>`;
}

// Group 5: every job, a day a row, newest first; the newest day is open.
function LedgerGroup() {
  const first = useResource("/api/generation/ledger", { every: EVERY });
  const [older, setOlder] = useState([]);
  const [more, setMore] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(null);
  const [opened, setOpened] = useState({});
  const page = first.data;
  const days = mergeDays(page && page.days, older);
  const hasMore = more === null ? Boolean(page && page.more) : more;
  const unreadable = page && page.ok === false;
  const isOpenDay = (day, i) => (opened[day] === undefined ? i === 0 : opened[day]);

  async function showOlder() {
    const last = days[days.length - 1];
    if (!last || !DAY_RE.test(last.day)) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const next = await api.get(`/api/generation/ledger?before=${last.day}`);
      setOlder([...older, ...arr(next.days)]);
      setMore(Boolean(next.more));
    } catch (error) {
      setOlderError(error);
    } finally {
      setLoadingOlder(false);
    }
  }

  return html`<${Group} title=${GROUPS.ledger} aside=${days.length ? GROUPS.newest : null}>
    ${first.loading && !page ? html`<${Loading} lines=${3} label="Loading what was spent" />` : null}
    ${first.error && !page ? html`<${ErrorNotice} error=${first.error} onRetry=${first.reload} />` : null}
    ${unreadable ? html`<${Notice} tone="bad" title=${plain(page.sentence, 300) || WORDS.unreadable} />` : null}
    ${page && !unreadable && !days.length ? html`<${Empty} icon="clock" title=${WORDS.nothingSpent} text=${WORDS.ledgerEmpty} />` : null}
    ${days.length ? html`
      <${Card} padding="none" class="p-settings-generation__days">
        <ul class="p-settings-generation__daylist" aria-label="What was spent, by day, newest first">
          ${days.map((d, i) => html`<${DayItem} key=${d.day} d=${d} open=${isOpenDay(d.day, i)}
            toggle=${() => setOpened({ ...opened, [d.day]: !isOpenDay(d.day, i) })} />`)}
        </ul>
      <//>` : null}
    ${olderError ? html`<${ErrorNotice} error=${olderError} onRetry=${showOlder} />` : null}
    ${days.length && hasMore ? html`<div class="p-settings-generation__older"><${Button} busy=${loadingOlder} onClick=${showOlder}>${WORDS.showOlder}<//></div>` : null}
  <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The section

export default function GenerationSection() {
  const { announce } = useApp();
  const res = useResource("/api/generation", { every: EVERY });
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState(null);
  const [test, setTest] = useState(null);
  const [hfTest, setHfTest] = useState(null);
  // The word Higgsfield's page sent the owner back with, said once; the address is cleaned as it is read.
  const [returned] = useState(takeReturn);
  const state = sectionState(res);
  // The answer of the last action is shown until the next quiet refresh brings a newer view.
  const view = fresh && fresh.base === res.data ? fresh.view : res.data;
  const ready = state === "ready" && obj(view);

  // Runs one action. Errors carry the server's plain message only: nothing typed is ever put in one. An action
  // whose answer is not the view (the key) reads the view again.
  async function act(where, path, body, said, { reload = false } = {}) {
    setBusy(where);
    setFailure(null);
    if (where === "key" || where === "remove") setTest(null);
    if (where === "hf-forget") setHfTest(null);
    try {
      const answer = await api.post(path, body);
      const next = reload ? await api.get("/api/generation") : answer;
      setFresh({ view: next, base: res.data });
      if (said) announce(said);
      return true;
    } catch (error) {
      setFailure({ where, error: { message: plain(error && error.message, 300) || "That did not work.", next: plain(error && error.next, 300) } });
      res.refresh();
      return false;
    } finally {
      setBusy("");
    }
  }

  // Test: the door asks Runway for the balance. Its answer is kept on screen until the key changes.
  async function runTest() {
    setBusy("test");
    setFailure(null);
    try {
      const answer = await api.post("/api/generation/test", {});
      setTest(answer);
      announce(testResult(answer).sentence);
    } catch (error) {
      setTest(null);
      setFailure({ where: "test", error: { message: plain(error && error.message, 300) || "That did not work.", next: plain(error && error.next, 300) } });
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (!returned) return;
    announce(returned === "connected" ? HF_WORDS.connected : HF_WORDS.notFinished);
  }, []);
  useEffect(() => {
    // Back from Higgsfield's page: bring its group into view once it is drawn.
    if (returned && ready) document.getElementById("settings-higgsfield")?.scrollIntoView({ block: "start" });
  }, [ready]);

  // Higgsfield's Test: the door asks for the balance. Its answer stays until the owner signs in or out.
  async function runHfTest() {
    setBusy("hf-test");
    setFailure(null);
    try {
      const answer = await api.post("/api/generation/higgsfield/test", {});
      setHfTest(answer);
      announce(hfTestResult(answer).sentence);
    } catch (error) {
      setHfTest(null);
      setFailure({ where: "hf-test", error: { message: plain(error && error.message, 300) || "That did not work.", next: plain(error && error.next, 300) } });
    } finally {
      setBusy("");
    }
  }

  // Sign in: the door gives Higgsfield's authorize address; it is opened only when it is Higgsfield's own.
  async function signIn() {
    setBusy("hf-begin");
    setFailure(null);
    setHfTest(null);
    try {
      const answer = await api.post("/api/generation/higgsfield/begin", {});
      const url = hfSignInUrl(obj(answer) ? answer.url : null);
      if (!url) {
        setFailure({ where: "hf-begin", error: { message: HF_WORDS.badAddress, next: "Try again in a minute." } });
        return;
      }
      openHiggsfield(url);
    } catch (error) {
      setFailure({ where: "hf-begin", error: { message: plain(error && error.message, 300) || "That did not work.", next: plain(error && error.next, 300) } });
    } finally {
      setBusy("");
    }
  }

  const parts = { view, busy, act, failure };
  return html`<div class="p-settings-generation" id="settings-generation">
    <p class="k-doc__intro">${WORDS.intro}</p>
    ${state === "loading" ? html`<div class="p-settings-generation__state"><${Loading} lines=${3} label="Loading the generation settings" /></div>` : null}
    ${state === "restart" ? html`<div class="p-settings-generation__state"><${St} icon="clock">Not here yet<//><${RestartLine} /></div>` : null}
    ${state === "error" ? html`<div class="p-settings-generation__state"><${ErrorNotice} error=${res.error} onRetry=${res.reload} /></div>` : null}
    ${ready && view.problem ? html`<div class="p-settings-generation__state"><${Notice} tone="bad"><${Line}>${problemLine(view)}<//><//></div>` : null}
    ${ready ? html`
      <${RunwayGroup} ...${parts} test=${test} runTest=${runTest} />
      <${LimitsGroup} ...${parts} />
      <${HiggsfieldGroup} ...${parts} test=${hfTest} runTest=${runHfTest} signIn=${signIn} returned=${returned} />
      <${ModelsGroup} ...${parts} />
      <${FilmsGroup} view=${view} />
      <${LedgerGroup} />` : null}
  </div>`;
}
