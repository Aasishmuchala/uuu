// Loads a page's module the first time its address is opened (CONTRACTS-V2 14.1). While it loads the
// pane shows Loading; when the file is missing, fails to load, has no default export, or throws while
// drawing, the pane shows "This page is being built." The shell itself never breaks because of a page.
import { html, Component, useEffect, useState } from "../vendor/preact-htm.js";
import { BeingBuilt, Loading, PageHeader } from "../kit/index.js";

const cache = new Map();

// The address of a route's file ("./pages/home.js", relative to the public folder) from this folder.
export function pageUrl(file) {
  const rel = String(file || "").replace(/^\.\//, "");
  return new URL(`../${rel}`, import.meta.url).href;
}

// Resolves to the module's export `name` (a function), or null. Never rejects. A failed load is not
// remembered, so a page written while the home screen is open shows up on the next visit.
export function loadModule(file, name = "default") {
  const key = `${file}#${name}`;
  if (!cache.has(key)) {
    const p = import(pageUrl(file))
      .then((m) => (m && typeof m[name] === "function" ? m[name] : null))
      .catch(() => null)
      .then((c) => {
        if (!c) cache.delete(key);
        return c;
      });
    cache.set(key, p);
  }
  return cache.get(key);
}

function NotBuilt({ id, title }) {
  return html`
    <div class=${`p-${id}`}>
      <${PageHeader} title=${title} />
      <${BeingBuilt} />
    </div>`;
}

// Catches a page that throws while drawing, so the sidebar and the rest keep working.
class Guard extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  componentDidCatch() {
    this.setState({ failed: true });
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// `route` is the table's entry; `address` is { parts, query } from the router.
export function LazyPage({ route, address }) {
  const [s, setS] = useState({ file: null, Page: null, done: false });

  useEffect(() => {
    let live = true;
    setS({ file: route.file, Page: null, done: false });
    loadModule(route.file).then((Page) => {
      if (live) setS({ file: route.file, Page, done: true });
    });
    return () => { live = false; };
  }, [route.file]);

  const fallback = html`<${NotBuilt} id=${route.id} title=${route.title} />`;
  if (s.file !== route.file || !s.done) {
    return html`<div class=${`p-${route.id}`}><${Loading} label=${`Loading ${route.title}`} /></div>`;
  }
  if (!s.Page) return fallback;
  const Page = s.Page;
  const pageRoute = { id: route.id, parts: address.parts, query: address.query };
  return html`
    <${Guard} key=${route.id} fallback=${fallback}>
      <${Page} route=${pageRoute} />
    <//>`;
}
