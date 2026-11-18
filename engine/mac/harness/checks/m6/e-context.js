// (e) isSecureContext; navigator.clipboard.writeText from inside a click handler (the probe's click is a script
// click, not a person's: WebKit asks for a real gesture, so "NotAllowedError" here says nothing about a person's
// click; the app's own Copy is checked by hand, M5); localStorage written here and read back; the key is left for
// run-m6.mjs to find on disk after the probe has ended (the probe's own website data folder, listed, not read).
await quiet(4000);
const out = { isSecureContext: window.isSecureContext, origin: location.origin, hasClipboard: !!(navigator.clipboard && navigator.clipboard.writeText) };
const b = document.createElement("button");
b.textContent = "m6";
document.body.appendChild(b);
out.clipboardInClick = await new Promise((done) => {
  b.addEventListener("click", () => {
    try { navigator.clipboard.writeText("m6 check").then(() => done("written"), (e) => done(`refused: ${e && e.name}`)); } catch (e) { done(`threw: ${e && e.name}`); }
  });
  b.click();
  setTimeout(() => done("no answer in 3 s"), 3000);
});
b.remove();
const key = "m6.kept"; const val = INJ.mark;
try { localStorage.setItem(key, val); out.localStorage = localStorage.getItem(key) === val ? "written and read back" : "read back something else"; } catch (e) { out.localStorage = `threw: ${e && e.name}`; }
out.storageEstimate = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().then((x) => ({ usage: x.usage }), () => null) : null;
out.persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => null) : null;
return out;
