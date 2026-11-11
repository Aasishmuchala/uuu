// Renders the composites' gallery (gallery-b.js) into gallery-b.html. Loaded as a module; no inline script.
import { html, render } from "../vendor/preact-htm.js";
import Gallery from "./gallery-b.js";

render(html`<${Gallery} />`, document.getElementById("gallery"));
