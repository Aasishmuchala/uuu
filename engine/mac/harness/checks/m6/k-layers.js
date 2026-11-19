// (k) <dialog>, popover and inert with a panel open on the Map: what this engine offers, what the open panel is made
// of, whether the page behind it is made inert, and whether focus can go behind it.
if (INJ.wait) await waitFor(INJ.wait, 30000);
await quiet(8000);
// The scene state's own steps (the cook harness's clicks), as checks/steps.js does them.
for (const [kind, a, b] of INJ.steps || []) {
  if (kind === "click") { const el = [...document.querySelectorAll(a)].find((e) => !b || `${e.textContent} ${e.getAttribute("aria-label") || ""}`.includes(b)); if (el) { el.scrollIntoView({ block: "center" }); el.click(); } }
  await quiet(3000);
}
const out = { showModal: typeof HTMLDialogElement === "function" && typeof HTMLDialogElement.prototype.showModal === "function",
  popover: "popover" in HTMLElement.prototype, inert: "inert" in HTMLElement.prototype };
const panel = document.querySelector("[role=alertdialog], dialog[open], [role=dialog], [aria-modal=true], .p-map__side, [class*=door-panel], [class*=room-panel]");
out.panel = panel ? { el: label(panel), tag: panel.tagName.toLowerCase(), role: panel.getAttribute("role"), modal: panel.getAttribute("aria-modal"), text: text(panel, 80) } : null;
out.openDialogs = document.querySelectorAll("dialog[open]").length;
out.popoversOpen = (() => { try { return document.querySelectorAll(":popover-open").length; } catch { return "selector not known"; } })();
out.inertCount = document.querySelectorAll("[inert]").length;
out.inertOn = [...document.querySelectorAll("[inert]")].slice(0, 5).map(label);
const behind = [...document.querySelectorAll("a[href], button")].find((e) => visible(e) && panel && !panel.contains(e));
if (behind) { const was = document.activeElement; behind.focus(); out.focusBehind = { el: label(behind), took: document.activeElement === behind, insideInert: !!behind.closest("[inert]") }; if (was && was.focus) was.focus(); }
// A <dialog> and a popover of this engine's own, made and removed here: they open and close.
const d = document.createElement("dialog"); d.textContent = "m6"; document.body.appendChild(d);
try { d.showModal(); out.dialogOpens = d.open && d.matches(":modal"); d.close(); } catch (e) { out.dialogOpens = `threw ${e.name}`; }
d.remove();
const p = document.createElement("div"); p.setAttribute("popover", ""); p.textContent = "m6"; document.body.appendChild(p);
try { p.showPopover(); out.popoverOpens = p.matches(":popover-open"); p.hidePopover(); } catch (e) { out.popoverOpens = `threw ${e.name}`; }
p.remove();
return out;
