// (m) Settings → Brain (pages/settings-brain.js) with the brain door's switch off: the switch is a real control
// (a <button role=switch>, in the tab order, aria-checked false, named); every other button of the section is
// pressed and what it answers is read (the stub home has no address for the brain door, so nothing leaves the home);
// every sentence of the section is wholly inside the window and not cut off.
const sec = await waitFor("#settings-brain .p-settings-viewer__row, #settings-brain [role=switch], #settings-brain .k-doc__intro", 20000);
await quiet(6000);
const root = document.querySelector("#settings-brain") || document.body;
const sw = root.querySelector("[role=switch]");
const out = { switch: sw ? { tag: sw.tagName.toLowerCase(), type: sw.getAttribute("type"), checked: sw.getAttribute("aria-checked"), disabled: sw.disabled || sw.getAttribute("aria-disabled") === "true",
  tabIndex: sw.tabIndex, name: text(sw.querySelector(".k-switch__label") || sw, 60), state: text(sw.querySelector(".k-switch__state"), 10) } : null };
const cut = [];
for (const e of root.querySelectorAll("p, span, b, label, h1, h2, h3, h4, li, button, a, div")) {
  if (!visible(e) || !text(e)) continue;
  if ([...e.childNodes].every((n) => n.nodeType !== 3 || !n.textContent.trim())) continue;
  const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
  const off = r.right > innerWidth + 1 || r.left < -1;
  const clipped = (cs.overflowX !== "visible" || cs.textOverflow === "ellipsis") && e.scrollWidth > e.clientWidth + 1;
  const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== "none" && e.scrollHeight > e.clientHeight + 1;
  if (off || clipped || clamped) cut.push({ el: label(e), text: text(e, 80), off, clipped, clamped: !!clamped });
}
out.sentences = root.querySelectorAll("p").length;
out.cut = cut.slice(0, 15);
out.wider = document.documentElement.scrollWidth > innerWidth;
if (INJ.press) {
  const pressed = [];
  const field = root.querySelector("input[type=text], input:not([type]), textarea, input[type=search]");
  if (field) typeInto(field, "refunds");
  for (const b of [...root.querySelectorAll("button:not([role=switch])")].filter(visible)) {
    const name = text(b, 40) || b.getAttribute("aria-label");
    const before = text(root, 4000);
    b.click();
    await quiet(6000); await sleep(400);
    const statuses = [...root.querySelectorAll("[role=status], .k-notice, .p-settings-viewer__answer")].map((e) => text(e, 160)).filter(Boolean);
    pressed.push({ button: name, changed: text(root, 4000) !== before, says: statuses.slice(0, 3) });
  }
  out.pressed = pressed;
  out.switchAfter = sw ? sw.getAttribute("aria-checked") : null;
}
return out;
