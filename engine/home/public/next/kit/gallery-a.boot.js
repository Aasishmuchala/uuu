// Renders the primitives' gallery (gallery-a.js) into gallery-a.html. Loaded as a module; no inline script.
// "?accent=<name>" sets the accent for this visit; "?theme=" is read by lib/theme-boot.js before paint.
import { html, render } from "../vendor/preact-htm.js";
import Gallery from "./gallery-a.js";

const accent = new URLSearchParams(location.search).get("accent");
if (accent && /^[a-z]+$/.test(accent)) document.documentElement.setAttribute("data-accent", accent);

render(html`<${Gallery} />`, document.getElementById("gallery"));
