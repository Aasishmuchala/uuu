// The home screen: one front door to the company engine. No build step: plain modules, vendored Preact.
//
// How to add a page (T15 and later):
//   1. Write pages/<name>.js exporting a component `({ route }) => html`...``. Start it with
//      <PageHeader title="..."/> from components/page.js so the heading, the tab title and focus work.
//   2. Add it to PAGES below under its address (#/<name>); `route.parts` holds the address's parts and
//      `route.query` its ?query. If it should be in the rail, add it to NAV_GROUPS in components/shell.js.
//   3. Use api.get/api.post from lib/api.js (never fetch another host) and the honest states from
//      components/notice.js: <Loading/>, <ErrorNotice error onRetry/>, <NotConnected reason next/>.
import { html, render, useCallback, useEffect, useRef, useState } from "./vendor/preact-htm.js";
import { useResource } from "./lib/api.js";
import { AppContext } from "./lib/context.js";
import { useRoute } from "./lib/router.js";
import { GoalBox } from "./components/goal-box.js";
import { Notice } from "./components/notice.js";
import { PageHeader } from "./components/page.js";
import { Header, Rail } from "./components/shell.js";
import { InboxPage } from "./pages/inbox.js";
import { GoalsPage } from "./pages/goals.js";
import { GoalPage } from "./pages/goal.js";
import { CompanyPage } from "./pages/company.js";
import { HealthPage } from "./pages/health.js";
import { SearchPage } from "./pages/search.js";
import { DepartmentPage } from "./pages/department.js";

function KnowledgePage() {
  return html`
    <${PageHeader} title="Knowledge" lead="Company documents that agents read before they work, and that you can search." />
    <${Notice} title="Coming in the next step">
      <p>Here you will add documents, search them, and see what each agent has learned.</p>
    <//>`;
}

function NotFoundPage() {
  return html`
    <${PageHeader} title="There is no page here" />
    <p>The address may be old or mistyped. <a href="#/inbox">Go to the inbox</a>.</p>`;
}

const department = ({ route }) => html`<${DepartmentPage} id=${route.parts[0]} />`;

export const PAGES = {
  inbox: InboxPage,
  goals: ({ route }) => (route.parts[1] ? html`<${GoalPage} id=${route.parts[1]} />` : html`<${GoalsPage} route=${route} />`),
  company: CompanyPage,
  books: department,
  customers: department,
  support: department,
  people: department,
  marketing: department,
  studio: department,
  knowledge: KnowledgePage,
  health: HealthPage,
  search: SearchPage,
};

const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;

function App() {
  const route = useRoute();
  const page = route.parts[0];
  const state = useResource("/api/state", { every: 10000 });
  const [live, setLive] = useState("");
  const [goalBox, setGoalBox] = useState({ open: false, key: 0 });
  const firstRoute = useRef(true);

  const announce = useCallback((text) => {
    setLive("");
    setTimeout(() => setLive(text), 50);
  }, []);

  const openGoalBox = useCallback(() => {
    if (location.hash === "" || location.hash.startsWith("#/inbox")) {
      const box = document.getElementById("goal-box-text");
      if (box) {
        box.scrollIntoView({ block: "center" });
        box.focus();
        return;
      }
    }
    setGoalBox((g) => ({ open: true, key: g.key + 1 }));
  }, []);
  const closeGoalBox = useCallback(() => {
    setGoalBox((g) => ({ ...g, open: false }));
    setTimeout(() => document.querySelector(".header-tools .btn--primary")?.focus(), 0);
  }, []);

  // A new page: close the goal box, go to the top, and move focus to the page's heading.
  const routeKey = `${route.parts.join("/")}?${route.query.toString()}`;
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    setGoalBox((g) => ({ ...g, open: false }));
    window.scrollTo(0, 0);
    requestAnimationFrame(() => document.getElementById("page-title")?.focus({ preventScroll: true }));
  }, [routeKey]);

  // Keys: g gives a goal, / moves to search, Esc closes the goal box.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const typing = t && (TYPING.test(t.tagName) || t.isContentEditable);
      if (e.key === "Escape") {
        if (document.getElementById("goal-box-top")?.contains(t) || (!typing && goalBox.open)) closeGoalBox();
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        const s = document.getElementById("search");
        s?.focus();
        s?.select();
      } else if (e.key === "g") {
        e.preventDefault();
        openGoalBox();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goalBox.open, openGoalBox, closeGoalBox]);

  const ctx = {
    state: state.data,
    stateError: state.error,
    refreshState: state.refresh,
    announce,
    openGoalBox,
  };

  const Page = PAGES[page] || NotFoundPage;
  const skip = (e) => {
    e.preventDefault();
    document.getElementById("main")?.focus();
  };

  return html`
    <${AppContext.Provider} value=${ctx}>
      <a class="skip-link" href="#main" onClick=${skip}>Skip to content</a>
      <div class="layout">
        <${Rail} current=${page === "goals" ? "goals" : page} />
        <div class="main-column">
          <${Header} route=${route} goalBoxOpen=${goalBox.open} onGoalBox=${() => (goalBox.open ? closeGoalBox() : openGoalBox())} />
          ${goalBox.open && page !== "inbox" ? html`
            <div class="goal-box-top">
              <${GoalBox} id="goal-box-top" focusKey=${goalBox.key} onClose=${closeGoalBox} />
            </div>` : null}
          <main id="main" class="content" tabindex="-1">
            <${Page} route=${route} key=${page} />
          </main>
        </div>
      </div>
      <p class="visually-hidden" aria-live="polite" role="status">${live}</p>
    <//>`;
}

render(html`<${App} />`, document.getElementById("app"));
