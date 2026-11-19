// The body of an async function the probe runs in the page (webkit-probe --script): a shot's wait, its scene state's
// steps, its own style sheet, then the measure of checks/look.js. run-webkit.mjs puts the shot's values in place of
// the three markers below (as JSON) and the look's body in place of the last one. It returns
// { notes: [...], waited: true|false|null, look: {...} }.
// The steps are the cook harness's (run.mjs runSteps), done from inside the page, since WebKit has no input protocol
// here: a click is element.click(); a key is a KeyboardEvent on the focused element (an untrusted event: the web
// app's own shortcuts listen for it), and a letter or a space typed into a field goes in through insertText, which
// fires the field's input event as typing does.
const STEPS = /*STEPS*/[];
const WAIT = /*WAIT*/null;
const CSS = /*CSS*/null;
const notes = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), sleep(200)]);
async function quiet(max = 8000) {
  const p = window.__probe || { inflight: 0, last: 0 };
  const end = performance.now() + max;
  while (performance.now() < end) {
    if (p.inflight === 0 && performance.now() - p.last >= 400) break;
    await sleep(50);
  }
  await frame();
}
const KEYS = { Space: " ", Enter: "Enter", Escape: "Escape", Tab: "Tab", Backspace: "Backspace", ArrowDown: "ArrowDown", ArrowUp: "ArrowUp", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Home: "Home", End: "End" };
const CODES = { " ": "Space", "[": "BracketLeft", "]": "BracketRight", "/": "Slash", ".": "Period", ",": "Comma" };
const editable = (e) => e && (e.isContentEditable || /^(input|textarea)$/i.test(e.tagName));
function press(name) {
  const key = KEYS[name] || name;
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
  if (key.length === 1 && editable(document.activeElement)) {
    document.execCommand("insertText", false, key);
    return;
  }
  const code = CODES[key] || (key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : key);
  const init = { key, code, bubbles: true, cancelable: true, composed: true };
  const down = target.dispatchEvent(new KeyboardEvent("keydown", init));
  if (down && key.length === 1) target.dispatchEvent(new KeyboardEvent("keypress", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
}

let waited = null;
if (WAIT) {
  waited = false;
  const end = performance.now() + 30000;
  while (performance.now() < end) { if (document.querySelector(WAIT)) { waited = true; break; } await sleep(100); }
  if (!waited) notes.push(`${WAIT} did not appear in 30 s`);
}
for (const step of STEPS) {
  const [kind, a, b] = step;
  if (kind === "click") {
    const el = [...document.querySelectorAll(a)].find((e) => !b || `${e.textContent} ${e.getAttribute("aria-label") || ""}`.includes(b));
    if (!el) notes.push(`no ${a}${b ? ` "${b}"` : ""} to click`);
    else { el.scrollIntoView({ block: "center" }); el.click(); }
    await quiet(3000);
  } else if (kind === "key") { press(a); await quiet(2000); }
  else if (kind === "wait") await sleep(Number(a) || 0);
  else if (kind === "quiet") await quiet(Number(a) || 8000);
  else if (kind === "focus" || kind === "scroll") {
    const e = document.querySelector(innerWidth < 860 && b ? b : a);
    if (!e) notes.push(`no ${a} to ${kind}`);
    else if (kind === "focus") { e.scrollIntoView({ block: "center" }); e.focus(); }
    else { e.scrollIntoView({ block: "start" }); if (scrollY > 0) window.scrollBy(0, -(innerWidth < 500 ? 72 : 64)); }
    await quiet(1500);
  } else notes.push(`unknown step ${kind}`);
}
if (CSS) {
  const st = document.createElement("style");
  st.textContent = String(CSS);
  document.head.appendChild(st);
  await quiet(1500);
}
const look = await (async () => { /*LOOK*/ })();
return { notes, waited, look };
