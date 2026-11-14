// What every page can reach without passing it down (CONTRACTS-V2 14.3, CONTRACTS-V3 26.3):
//   shell          the last answer of GET /api/shell, or null; refreshed every 10 seconds
//   shellError     an ApiError when /api/shell could not be read
//   refreshShell   read /api/shell again now (after an action, so counts are right at once)
//   announce       say one sentence through the aria-live line
//   openComposer   open the compose dialog, optionally filled: { text, to, planFirst, template }
//   openPanel      show content in the right-hand work panel: openPanel(content, { title })
//   closePanel     close it
//   openQueue      open the queue (what needs the owner), optionally for one department: openQueue({ department })
//   openNeeds      the same as openQueue (kept for the pages that call it)
//   closeNeeds     close it
//   setTop         what the top bar shows for this page: setTop({ crumbs, pager, links }), where crumbs is
//                  [{ label, href? }] (the last is the page), pager is { label: "3 of 21", prev, next } and
//                  links is at most two [{ label, href }]; every href a "#/" address. Cleared on a page change.
//   side           the sidebar's width: "open" | "icons" | "none" (below 860 px)
//   sideChoice     what the owner chose: "open" | "icons", or null for automatic
//   setSide        choose it: setSide("open" | "icons"), or setSide(null) for automatic; kept in this browser
//   dock           the last shell.dock (the brain and the seven departments), or []
//   settings       { theme, accent, backdrop, motion, accents, backdrops, saved }
//   saveSettings   change the look: saveSettings({ theme, accent, backdrop, motion })
import { createContext, useContext } from "../vendor/preact-htm.js";

const nothing = () => {};

export const AppContext = createContext({
  shell: null,
  shellError: null,
  refreshShell: nothing,
  announce: nothing,
  openComposer: nothing,
  openPanel: nothing,
  closePanel: nothing,
  openQueue: nothing,
  openNeeds: nothing,
  closeNeeds: nothing,
  setTop: nothing,
  side: "open",
  sideChoice: null,
  setSide: nothing,
  dock: [],
  settings: { theme: "dark", accent: "graphite", backdrop: "aurora", motion: "on", accents: null, backdrops: null, saved: false },
  saveSettings: async () => ({ theme: "dark", accent: "graphite", backdrop: "aurora", motion: "on", accents: null, backdrops: null, saved: false }),
});

export const useApp = () => useContext(AppContext);
