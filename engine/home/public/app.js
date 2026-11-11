// The home screen: one front door to the company engine. No build step: plain modules, vendored Preact.
// This file only starts the shell. Frozen after V11.
//
// How to add a page: see the top of routes.js. In short, write pages/<file>.js with
// `export default function Page({ route })`, style it in styles/pages/<id>.css under `.p-<id>`, and
// use the kit through kit/index.js and the shell's context through lib/context.js (useApp()).
import { html, render } from "./vendor/preact-htm.js";
import { AppShell } from "./shell/app-shell.js";

if (typeof document !== "undefined") {
  const root = document.getElementById("app");
  root.textContent = "";
  render(html`<${AppShell} />`, root);
}
