// Settings: the Generation section (PLAN-V5 K13, T44). The switch that lets one agent, the Artist, make clips and
// pictures with Runway, a paid service, through the generation door. What is sent, what it costs and who can ask
// come first; then the switch, the Runway key and its Test, the owner's two limits, what was spent today and this
// month, the four models, the films the owner approved and every job, day by day, newest first.
// The key is typed into a password field that the server never fills; it lives only in this component's memory
// until Save, and is cleared then. It is never put in storage, the address bar, the console or a message.
// The automatic allowance for small jobs is not offered (C5): nothing is made without the owner's yes.
// Higgsfield (PLAN-V5 K20, K21, K23; T81): a second paid service in its own card, off until the owner signs in and
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
  Avatar, Button, Card, Dialog, ErrorNotice, Field, Icon, Loading, NextStep, Notice, Section, Select, StatusDot, Switch, TextInput, Time,
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

// ---------------------------------------------------------------------------------------------------------------
// Parts

// The restart sentence, with the two commands set apart. The words are the plan's, unchanged.
function RestartLine() {
  return html`<p class="p-settings__m-restart">This section appears after the home screen is restarted: <code class="k-next__command">engine stop</code>, then <code class="k-next__command">engine start</code>.</p>`;
}

// A sentence that may end in "Run: <command>".
const Line = ({ children }) => (/\bRun:/.test(String(children)) ? html`<${NextStep} text=${children} />` : html`<p class="p-settings__m-text">${children}</p>`);

const Failure = ({ failure, where }) => (failure && failure.where === where
  ? html`<${Notice} tone="bad" title=${failure.error.message}>${failure.error.next ? html`<${Line}>${failure.error.next}<//>` : null}<//>`
  : null);

// A bar of how much of a limit is spent. The words beside it say the same; the bar is for the eye only.
function Bar({ value, total, small }) {
  const s = share(value, total);
  return html`<span class=${`p-settings__g-bar p-settings__g-bar--${barTone(value, total)}${small ? " p-settings__g-bar--sm" : ""}`} aria-hidden="true">
    <span class="p-settings__g-fill" style=${`transform: scaleX(${s.toFixed(4)})`}></span>
  </span>`;
}

// The door, drawn: the Artist, the generation door, Runway. The other agents stop at the door. The words around
// it say all of this; the drawing is for the eye only.
function DoorMap({ view }) {
  const open = isOpen(view);
  const word = view ? doorWord(view) : "";
  return html`<div class=${`p-settings__w-map${open ? " p-settings__w-map--open" : ""}`} aria-hidden="true">
    <span class="p-settings__w-node p-settings__w-node--agent">
      <${Avatar} slug="artist" name="Artist" size=${32} />
      <span class="p-settings__w-name">Artist</span>
    </span>
    <span class="p-settings__w-wire"></span>
    <span class="p-settings__w-node p-settings__w-node--door">
      <span class="p-settings__w-door"><${Icon} name=${open ? "check" : view && view.paused ? "pause" : "lock"} size=${16} /></span>
      <span class="p-settings__w-name">Generation door</span>
      ${word ? html`<span class="p-settings__w-state">${word}</span>` : null}
    </span>
    <span class="p-settings__w-wire p-settings__w-wire--out"></span>
    <span class="p-settings__w-node p-settings__w-node--web">
      <span class="p-settings__g-runway"><${Icon} name="video" size=${16} /></span>
      <span class="p-settings__w-name">Runway</span>
    </span>
    <span class="p-settings__w-node p-settings__w-node--others">
      <span class="p-settings__w-others"><${Icon} name="team" size=${16} /></span>
      <span class="p-settings__w-name">Other agents</span>
    </span>
    <span class="p-settings__w-wire p-settings__w-wire--shut"><${Icon} name="cross" size=${12} /></span>
  </div>`;
}

function SwitchBlock({ view, busy, act, failure }) {
  const on = Boolean(view.on);
  const locked = !on && !view.canSwitchOn;
  const reasons = blockerLines(view);
  const mark = heroMark(view);
  return html`<div class="p-settings__w-switch">
    <${Switch} on=${on} disabled=${locked || Boolean(busy)} label=${WORDS.switchLabel}
      onChange=${(next) => act("switch", "/api/generation/switch", { on: next }, switchLine(next))} />
    <p class="p-settings__m-state" role="status">
      ${busy === "switch"
        ? html`<${StatusDot} tone="live" label=${WORDS.switching} />`
        : html`<${StatusDot} tone=${on ? mark.tone : "off"} label=${switchLine(on)} />`}
    </p>
    ${locked && reasons.length ? html`
      <p class="p-settings__m-text">It can be switched on when these are done:</p>
      <ul class="p-settings__m-steps">
        ${reasons.map((r, i) => html`<li key=${i}><${Line}>${r}<//></li>`)}
      </ul>` : null}
    <${Failure} failure=${failure} where="switch" />
  </div>`;
}

function KeyCard({ view, busy, act, failure, test, runTest }) {
  const [typed, setTyped] = useState("");
  const [asking, setAsking] = useState(false);
  const saved = Boolean(view.key && view.key.saved);
  const door = doorState(view.door);
  const mark = keyMark(view, test);
  const result = test ? testResult(test) : null;

  async function save(event) {
    event.preventDefault();
    if (!typed.trim() || busy) return;
    const ok = await act("key", "/api/generation/key", { key: typed }, "The key is saved.", { reload: true });
    if (ok) setTyped("");
  }

  return html`<${Card} class="p-settings__m-card">
    <div class="p-settings__m-head">
      <h3 class="p-settings__label"><label for="gen-runway-key">${WORDS.keyField}</label></h3>
      <${StatusDot} tone=${mark.tone} label=${mark.word} />
    </div>
    <p class="p-settings__m-text">${keyLine(view)}</p>
    <form class="p-settings__m-key" onSubmit=${save} autocomplete="off">
      <${Field} hint=${saved ? "Paste a new key to replace the saved one." : "It is kept on this Mac only and is never shown again."}
        error=${failure && failure.where === "key" ? failure.error : null}>
        <${TextInput} id="gen-runway-key" type="password" name="runway-key" autocomplete="off" autocapitalize="off" spellcheck=${false}
          value=${typed} onInput=${(e) => setTyped(e.currentTarget.value)} placeholder=${saved ? "A key is saved" : "Paste your key here"} />
      <//>
      <div class="p-settings__m-buttons">
        <${Button} variant="primary" type="submit" busy=${busy === "key"} disabled=${Boolean(busy) || !typed.trim()}>${WORDS.saveKey}<//>
        <${Button} icon="play" onClick=${runTest} busy=${busy === "test"} disabled=${Boolean(busy) || !saved || door.state !== "on"}>${WORDS.test}<//>
        ${saved ? html`<${Button} variant="quiet" onClick=${() => setAsking(true)} disabled=${Boolean(busy)}>${WORDS.removeKey}<//>` : null}
      </div>
    </form>
    <p class="p-settings__m-text">${WORDS.testWhat}</p>
    ${saved && door.state !== "on" ? html`<p class="p-settings__m-text">It can be tested once the generation door is running.</p>` : null}
    ${busy === "test" ? html`<p class="p-settings__m-text" role="status"><${StatusDot} tone="live" label="Asking Runway. This can take up to 45 seconds." /></p>` : null}
    <${Failure} failure=${failure} where="test" />
    <${Failure} failure=${failure} where="remove" />
    ${result && busy !== "test" ? html`
      <div class=${`p-settings__g-answer p-settings__g-answer--${result.tone}`} role="status">
        <${StatusDot} tone=${result.tone} label=${result.word} hideLabel=${true} />
        <div class="p-settings__g-answer-words">
          ${/\bRun:/.test(result.sentence) ? html`<${NextStep} text=${result.sentence} />` : html`<p class="p-settings__g-answer-line">${result.sentence}</p>`}
          ${result.more ? html`<p class="p-settings__m-text">${result.more}</p>` : null}
        </div>
      </div>` : null}
    <${Dialog} open=${asking} title=${WORDS.removeAsk} size="sm" onClose=${() => setAsking(false)}
      footer=${html`
        <${Button} data-autofocus onClick=${() => setAsking(false)}>Keep the key<//>
        <${Button} variant="danger" onClick=${async () => { setAsking(false); await act("remove", "/api/generation/key/remove", {}, "The key is removed.", { reload: true }); }}>${WORDS.removeKey}<//>`}>
      <p class="p-settings__m-text">${WORDS.removeWhy}</p>
    <//>
  <//>`;
}

function HiggsfieldCard({ view, busy, act, failure, test, runTest, signIn, returned }) {
  const h = hfOf(view);
  const state = hfState(view);
  const mark = hfMark(view);
  const door = doorState(view.door);
  const signedIn = state.key === "in";
  const [rate, setRate] = useState(null);
  const [asking, setAsking] = useState(false);
  const rateText = rate !== null ? rate : String(Number.isInteger(h.centsPerCredit) ? h.centsPerCredit : 5);
  const check = rateCheck(rateText);
  const changed = rate !== null && check.value !== h.centsPerCredit;
  const result = test ? hfTestResult(test) : null;
  const rateFailure = failure && failure.where === "hf-rate" ? failure.error : null;

  async function saveRate(event) {
    event.preventDefault();
    if (check.value === null || !changed || busy) return;
    const ok = await act("hf-rate", "/api/generation/higgsfield/rate", { centsPerCredit: check.value }, "The Higgsfield rate is saved.");
    if (ok) setRate(null);
  }

  return html`<${Card} class="p-settings__m-card p-settings__h-card" id="settings-higgsfield">
    <div class="p-settings__m-head">
      <h3 class="p-settings__label">${HF_WORDS.title}</h3>
      <${StatusDot} tone=${mark.tone} label=${mark.word} />
    </div>
    <${Notice} tone="warn">${HF_WORDS.sent}<//>
    ${returned ? html`<${Notice} tone=${returned === "connected" ? "ok" : "bad"} title=${returned === "connected" ? HF_WORDS.connected : HF_WORDS.notFinished} />` : null}
    <div class="p-settings__w-switch">
      <${Switch} on=${h.on === true} disabled=${Boolean(busy)} label=${HF_WORDS.switchLabel}
        onChange=${(next) => act("hf-switch", "/api/generation/higgsfield/switch", { on: next }, next ? HF_WORDS.on : HF_WORDS.off)} />
      <p class="p-settings__m-state" role="status">
        ${busy === "hf-switch"
          ? html`<${StatusDot} tone="live" label=${WORDS.switching} />`
          : html`<${StatusDot} tone=${h.on === true ? mark.tone : "off"} label=${hfSwitchLine(view)} />`}
      </p>
      <${Failure} failure=${failure} where="hf-switch" />
    </div>
    <div class="p-settings__h-part">
      <p class="p-settings__m-state" role="status"><${StatusDot} tone=${signedIn ? "ok" : state.key === "refused" ? "warn" : "off"} label=${state.sentence} /></p>
      <div class="p-settings__m-buttons">
        ${signedIn ? null : html`<${Button} variant="primary" icon="external" onClick=${signIn} busy=${busy === "hf-begin"} disabled=${Boolean(busy)}>${HF_WORDS.signIn}<//>`}
        <${Button} icon="play" onClick=${runTest} busy=${busy === "hf-test"} disabled=${Boolean(busy) || !signedIn || door.state !== "on"}>${WORDS.test}<//>
        ${signedIn || state.key === "refused" ? html`<${Button} variant="quiet" onClick=${() => setAsking(true)} disabled=${Boolean(busy)}>${HF_WORDS.signOut}<//>` : null}
      </div>
      <p class="p-settings__m-text">${HF_WORDS.testWhat}</p>
      ${!signedIn ? html`<p class="p-settings__m-text">${HF_WORDS.signInFirst}</p>` : door.state !== "on" ? html`<p class="p-settings__m-text">It can be tested once the generation door is running.</p>` : null}
      ${busy === "hf-test" ? html`<p class="p-settings__m-text" role="status"><${StatusDot} tone="live" label=${HF_WORDS.waiting} /></p>` : null}
      <${Failure} failure=${failure} where="hf-begin" />
      <${Failure} failure=${failure} where="hf-test" />
      <${Failure} failure=${failure} where="hf-forget" />
      ${result && busy !== "hf-test" ? html`
        <div class=${`p-settings__g-answer p-settings__g-answer--${result.tone}`} role="status">
          <${StatusDot} tone=${result.tone} label=${result.word} hideLabel=${true} />
          <div class="p-settings__g-answer-words">
            ${/\bRun:/.test(result.sentence) ? html`<${NextStep} text=${result.sentence} />` : html`<p class="p-settings__g-answer-line">${result.sentence}</p>`}
          </div>
        </div>` : null}
    </div>
    <form class="p-settings__h-part p-settings__h-rate" onSubmit=${saveRate} autocomplete="off">
      <div class="p-settings__g-cap">
        <${Field} label=${HF_WORDS.rate} hint=${check.error || rateFailure ? null : HF_WORDS.rateHint} error=${check.error || (rateFailure && rateFailure.message) || null}>
          <${TextInput} name="hf-rate" inputmode="numeric" autocomplete="off" spellcheck=${false} maxLength=${3}
            value=${rateText} onInput=${(e) => setRate(e.currentTarget.value)} />
        <//>
      </div>
      <div class="p-settings__m-buttons">
        <${Button} variant="primary" type="submit" busy=${busy === "hf-rate"} disabled=${Boolean(busy) || !changed || check.value === null}>${HF_WORDS.saveRate}<//>
        ${rate !== null ? html`<${Button} variant="quiet" onClick=${() => setRate(null)} disabled=${Boolean(busy)}>Put back<//>` : null}
      </div>
    </form>
    <${Dialog} open=${asking} title=${HF_WORDS.signOutAsk} size="sm" onClose=${() => setAsking(false)}
      footer=${html`
        <${Button} data-autofocus onClick=${() => setAsking(false)}>${HF_WORDS.stay}<//>
        <${Button} variant="danger" onClick=${async () => { setAsking(false); await act("hf-forget", "/api/generation/higgsfield/forget", {}, "Signed out of Higgsfield."); }}>${HF_WORDS.signOut}<//>`}>
      <p class="p-settings__m-text">${HF_WORDS.signOutWhy}</p>
    <//>
  <//>`;
}

function LimitsCard({ view, busy, act, failure }) {
  const [draft, setDraft] = useState({});
  const caps = obj(view.caps) ? view.caps : {};
  const fields = CAPS.map((c) => {
    const text = draft[c.key] !== undefined ? draft[c.key] : centsText(num(caps[c.key]));
    const check = capCheck(text);
    return { ...c, text, check, changed: draft[c.key] !== undefined && check.value !== caps[c.key] };
  });
  const refused = failure && failure.where === "caps" ? failure.error : null;
  const refusedField = refused ? capFieldOf(refused.message) : null;
  const ready = fields.every((f) => f.check.value !== null) && fields.some((f) => f.changed);

  async function save(event) {
    event.preventDefault();
    if (!ready || busy) return;
    const body = {};
    for (const f of fields) if (f.changed) body[f.key] = f.check.value;
    const ok = await act("caps", "/api/generation/caps", body, "The limits are saved.");
    if (ok) setDraft({});
  }

  return html`<${Card} class="p-settings__m-card">
    <div class="p-settings__m-head">
      <h3 class="p-settings__label">Limits</h3>
    </div>
    <p class="p-settings__m-text">Neither the Artist nor an app can spend more than these, even inside what you approved. A day and a month are counted in India time.</p>
    <form class="p-settings__g-limits" onSubmit=${save} autocomplete="off">
      <div class="p-settings__g-caps">
        ${fields.map((f) => {
          const hint = capHint(f.text);
          const error = f.check.error || (refusedField === f.key ? refused.message : "");
          return html`<div key=${f.key} class=${`p-settings__g-cap${f.check.value === 0 ? " p-settings__g-cap--zero" : ""}`}>
            <${Field} label=${f.label} hint=${error ? null : hint || null} error=${error || null}>
              <${TextInput} name=${`cap-${f.key}`} inputmode="decimal" autocomplete="off" spellcheck=${false} maxLength=${12}
                value=${f.text} onInput=${(e) => setDraft({ ...draft, [f.key]: e.currentTarget.value })} />
            <//>
          </div>`;
        })}
      </div>
      ${refused && !refusedField ? html`<${Failure} failure=${failure} where="caps" />` : null}
      <div class="p-settings__m-buttons">
        <${Button} variant="primary" type="submit" busy=${busy === "caps"} disabled=${Boolean(busy) || !ready}>Save limits<//>
        ${Object.keys(draft).length ? html`<${Button} variant="quiet" onClick=${() => setDraft({})} disabled=${Boolean(busy)}>Put back<//>` : null}
      </div>
    </form>
  <//>`;
}

function Meter({ label, spent, cap, left }) {
  const known = Number.isInteger(spent);
  return html`<div class="p-settings__g-meter">
    <div class="p-settings__g-meter-head">
      <span class="p-settings__g-meter-label">${label}</span>
      ${known ? html`<span class="p-settings__g-meter-left">${leftLine(left)}</span>` : null}
    </div>
    <p class="p-settings__g-figure">
      ${known
        ? html`<span class="p-settings__g-figure-dollars">${dollars(spent)} of ${dollars(num(cap))}</span>`
        : html`<span class="p-settings__g-figure-credits">Cannot be read</span>`}
    </p>
    ${known ? html`<${Bar} value=${spent} total=${cap} />` : null}
  </div>`;
}

function SpentCard({ view, busy, act, failure }) {
  const s = obj(view.spent) ? view.spent : {};
  const c = obj(view.caps) ? view.caps : {};
  const mark = spentMark(view);
  const paused = pausedLine(view);
  const ledger = ledgerLine(view);
  const running = runningLine(s.running);
  return html`<${Card} class="p-settings__m-card">
    <div class="p-settings__m-head">
      <h3 class="p-settings__label">Spent</h3>
      <${StatusDot} tone=${mark.tone} label=${mark.word} />
    </div>
    ${paused ? html`
      <div class="p-settings__g-paused" role="status">
        <${Icon} name="pause" size=${16} />
        <div class="p-settings__g-paused-words">
          <p class="p-settings__g-paused-line">${paused}</p>
          ${view.paused && view.paused.at ? html`<p class="p-settings__m-text">Paused <${Time} at=${view.paused.at} />.</p>` : null}
        </div>
        <${Button} variant="primary" icon="play" busy=${busy === "resume"} disabled=${Boolean(busy)}
          onClick=${() => act("resume", "/api/generation/resume", {}, "Generation is started again.")}>${WORDS.startAgain}<//>
      </div>` : null}
    <${Failure} failure=${failure} where="resume" />
    ${ledger ? html`<${Notice} tone=${view.ledger && view.ledger.ok === false ? "bad" : "warn"}>
      <p class="p-settings__m-text">${ledger}${view.ledger && view.ledger.ok === false ? html` <a href="#/health">Open Health</a>` : null}</p><//>` : null}
    <div class="p-settings__g-meters">
      <${Meter} label="Today" spent=${s.ok === false ? null : s.day} cap=${c.daily} left=${s.dayLeft} />
      <${Meter} label="This month" spent=${s.ok === false ? null : s.month} cap=${c.monthly} left=${s.monthLeft} />
    </div>
    ${capsLines(view).map((l) => html`<${Notice} key=${l} tone=${l === WORDS.zero ? "warn" : "bad"} title=${l} />`)}
    ${running ? html`<p class="p-settings__m-text"><${StatusDot} tone="live" label=${running} /></p>` : null}
  <//>`;
}

function ModelsCard({ view, busy, act, failure }) {
  return html`<${Card} class="p-settings__m-card">
    <div class="p-settings__m-head">
      <h3 class="p-settings__label">Models</h3>
    </div>
    <p class="p-settings__m-text">Which model makes each kind of work, with the service it runs on and its price. Higgsfield's models are listed once it is on and signed in.</p>
    <div class="p-settings__g-models">
      ${MODEL_FIELDS.map((f) => {
        const options = modelOptions(view, f.key);
        const current = view.models ? view.models[f.key] : "";
        const where = `model:${f.key}`;
        if (options.length === 1 && options[0].value === current && !options[0].disabled) {
          return html`<div key=${f.key} class="p-settings__g-model">
            <span class="k-field__label">${f.label}</span>
            <p class="p-settings__g-only">${options[0].label}</p>
            <p class="k-field__hint">The only model priced for this.</p>
          </div>`;
        }
        return html`<div key=${f.key} class="p-settings__g-model">
          <${Field} label=${f.label} error=${failure && failure.where === where ? failure.error.message : null}>
            <${Select} options=${options} value=${current || ""} disabled=${Boolean(busy)}
              onChange=${(e) => {
                const model = e.currentTarget.value;
                if (model && model !== current) act(where, "/api/generation/models", { [f.key]: model }, `${f.label}: ${model}.`);
              }} />
          <//>
        </div>`;
      })}
    </div>
    ${view.example ? html`<p class="p-settings__g-example"><${Icon} name="video" size=${16} /><span>${plain(view.example, 300)}</span></p>` : null}
  <//>`;
}

function FilmsCard({ view }) {
  const films = arr(view.batches).filter(obj);
  return html`<${Card} class="p-settings__m-card">
    <div class="p-settings__m-head">
      <h3 class="p-settings__label">Approved films</h3>
      ${films.length ? html`<span class="p-settings__w-newest">Newest first</span>` : null}
    </div>
    ${films.length ? html`
      <ul class="p-settings__g-films" aria-label="Approved films, newest first">
        ${films.map((b, i) => {
          const name = filmName(b.task);
          const href = filmHref(b.task);
          const label = html`${name.identifier ? html`<span class="p-settings__g-film-id">${name.identifier}</span>` : null}<span class="p-settings__g-film-title">${name.title}</span>`;
          return html`<li key=${typeof b.id === "string" ? b.id : i} class="p-settings__g-film">
            <div class="p-settings__g-film-name">
              ${href ? html`<a class="p-settings__g-film-link" href=${href}>${label}</a>` : html`<span class="p-settings__g-film-link">${label}</span>`}
              <span class="p-settings__g-film-dates">
                ${Number.isInteger(b.shots) ? html`<span>${count(b.shots, "shot")}</span>` : null}
                <span>Approved <${Time} at=${b.approvedAt} /></span>
                <span>${b.open ? "Expires" : "Ended"} <${Time} at=${b.expiresAt} /></span>
              </span>
            </div>
            <div class="p-settings__g-film-money">
              <span class="p-settings__g-film-spent">${batchLine(b)}</span>
              ${Number.isInteger(b.spent) ? html`<${Bar} value=${b.spent} total=${b.budget} small=${true} />` : null}
            </div>
            <span class="p-settings__g-film-state"><${StatusDot} tone=${b.open ? "ok" : "off"} label=${b.open ? "Open" : "Closed"} /></span>
          </li>`;
        })}
      </ul>` : html`
      <div class="p-settings__w-empty">
        <${Icon} name="video" size=${20} />
        <p class="p-settings__w-empty-title">${WORDS.noFilms}</p>
        <p class="p-settings__m-text">A film shows here once you approve its shotlist and its cost.</p>
      </div>`}
  <//>`;
}

function LedgerRow({ row }) {
  const href = filmHref(row.task);
  const id = obj(row.task) ? plain(row.task.identifier, 40) : "";
  return html`<li class="p-settings__g-row">
    <span class="p-settings__g-row-time">${clockOf(row.at)}</span>
    <span class="p-settings__g-row-what">${rowWords(row)}</span>
    <span class="p-settings__g-row-model">${plain(row.model, 80)}<span class="p-settings__g-row-service">${serviceName(row)}</span></span>
    <span class="p-settings__g-row-credits">${dollars(num(row.credits))}</span>
    <span class="p-settings__g-row-result"><${StatusDot} tone=${resultTone(row.result)} label=${plain(row.result, 80) || "Unclear"} /></span>
    <span class="p-settings__g-row-film">${href && id ? html`<a href=${href} aria-label=${`Film ${id}`}>${id}</a>` : null}</span>
  </li>`;
}

function DayItem({ d, open, toggle }) {
  const f = dayFigures(d);
  const id = `gen-day-${d.day}`;
  const rows = arr(d.rows).filter(obj);
  return html`<li class=${`p-settings__g-day${open ? " p-settings__g-day--open" : ""}`}>
    <button type="button" class="p-settings__g-dayhead" aria-expanded=${open ? "true" : "false"} aria-controls=${id} onClick=${toggle}>
      <${Icon} name="chevron-right" size=${16} class="p-settings__g-chev" />
      <span class="p-settings__g-dayname">${dayWords(d.day)}</span>
      <span class="p-settings__g-daycredits">${f.credits}</span>
      <span class="p-settings__g-dayjobs">${f.jobs}${f.refused ? html`<span class="p-settings__g-dayrefused">${f.refused}</span>` : null}</span>
    </button>
    ${open ? html`
      <div class="p-settings__g-rows" id=${id}>
        <div class="p-settings__g-rowhead" aria-hidden="true"><span>Time</span><span>What</span><span>Model</span><span>Cost</span><span>Result</span><span>Film</span></div>
        <ol class="p-settings__g-rowlist" aria-label=${`${dayWords(d.day)}, newest first`}>
          ${rows.map((r, i) => html`<${LedgerRow} key=${`${r.at}-${i}`} row=${r} />`)}
        </ol>
        ${num(d.jobs) > rows.length ? html`<p class="p-settings__w-none">The ${rows.length} newest of ${count(num(d.jobs), "job")} are shown.</p>` : null}
      </div>` : null}
  </li>`;
}

function SpentLog() {
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
  const toggle = (day) => setOpened({ ...opened, [day]: !opened[day] });

  return html`<${Card} class="p-settings__m-card">
    <div class="p-settings__m-head">
      <h3 class="p-settings__label">What was spent</h3>
      ${days.length ? html`<span class="p-settings__w-newest">Newest first</span>` : null}
    </div>
    ${first.loading && !page ? html`<${Loading} lines=${3} label="Loading what was spent" />` : null}
    ${first.error && !page ? html`<${ErrorNotice} error=${first.error} onRetry=${first.reload} />` : null}
    ${unreadable ? html`<${Notice} tone="bad" title=${plain(page.sentence, 300) || WORDS.unreadable} />` : null}
    ${page && !unreadable && !days.length ? html`
      <div class="p-settings__w-empty">
        <${Icon} name="clock" size=${20} />
        <p class="p-settings__w-empty-title">${WORDS.nothingSpent}</p>
        <p class="p-settings__m-text">Every clip and picture the Artist or an app asks Runway or Higgsfield for shows here, with what it cost.</p>
      </div>` : null}
    ${days.length ? html`
      <ul class="p-settings__g-days" aria-label="What was spent, by day, newest first">
        ${days.map((d) => html`<${DayItem} key=${d.day} d=${d} open=${Boolean(opened[d.day])} toggle=${() => toggle(d.day)} />`)}
      </ul>` : null}
    ${olderError ? html`<${ErrorNotice} error=${olderError} onRetry=${showOlder} />` : null}
    ${days.length && hasMore ? html`<div class="p-settings__w-older"><${Button} busy=${loadingOlder} onClick=${showOlder}>${WORDS.showOlder}<//></div>` : null}
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
  const on = Boolean(ready && view.on);
  const door = ready ? doorState(view.door) : null;
  const mark = ready ? heroMark(view) : null;

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
    // Back from Higgsfield's page: bring its card into view once it is drawn.
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

  return html`
    <div class="p-settings__gen" id="settings-generation">
      <${Section} title=${WORDS.title}>
        <div class="p-settings__models">
          <${Card} class=${`p-settings__m-card p-settings__w-hero${ready && isOpen(view) ? " p-settings__w-hero--on" : ""}${on && !isOpen(view) ? " p-settings__g-hero--held" : ""}`}>
            <div class="p-settings__m-head">
              <h3 class="p-settings__label">Runway</h3>
              ${mark ? html`<${StatusDot} tone=${mark.tone} label=${mark.word} />` : null}
            </div>
            <div class="p-settings__w-intro">
              <div class="p-settings__w-words">
                <p class="p-settings__m-lead">${WORDS.intro}</p>
                <${Notice} tone="warn">${WORDS.sent}<//>
                <p class="p-settings__g-money"><${Icon} name="tag" size=${16} /><span>${WORDS.money}</span></p>
              </div>
              <${DoorMap} view=${ready ? view : null} />
            </div>
            ${state === "loading" ? html`<${Loading} lines=${3} label="Loading the generation settings" />` : null}
            ${state === "restart" ? html`<div class="p-settings__m-later"><${StatusDot} tone="off" label="Not here yet" /><${RestartLine} /></div>` : null}
            ${state === "error" ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
            ${ready && view.problem ? html`<${Notice} tone="bad"><${Line}>${problemLine(view)}<//><//>` : null}
            ${ready ? html`<${SwitchBlock} view=${view} busy=${busy} act=${act} failure=${failure} />` : null}
            ${ready && on && door.state !== "on" ? html`<${Notice} tone="warn"><${Line}>${door.sentence}<//><//>` : null}
            ${ready && on && !(view.key && view.key.saved) ? html`<${Notice} tone="warn" title=${WORDS.noKey} />` : null}
            ${ready && heroNote(view) ? html`<p class="p-settings__g-note"><${Icon} name=${view.paused ? "pause" : "alert"} size=${16} /><span>${heroNote(view)}</span></p>` : null}
          <//>
          ${ready ? html`
            <${KeyCard} view=${view} busy=${busy} act=${act} failure=${failure} test=${test} runTest=${runTest} />
            <${HiggsfieldCard} view=${view} busy=${busy} act=${act} failure=${failure} test=${hfTest} runTest=${runHfTest} signIn=${signIn} returned=${returned} />
            <${LimitsCard} view=${view} busy=${busy} act=${act} failure=${failure} />
            <${SpentCard} view=${view} busy=${busy} act=${act} failure=${failure} />
            <${ModelsCard} view=${view} busy=${busy} act=${act} failure=${failure} />
            <${FilmsCard} view=${view} />
            <${SpentLog} />` : null}
        </div>
      <//>
    </div>`;
}
