// What every page can reach without passing it down (CONTRACTS-V2 14.3):
//   shell          the last answer of GET /api/shell, or null; refreshed every 10 seconds
//   shellError     an ApiError when /api/shell could not be read
//   refreshShell   read /api/shell again now (after an action, so counts are right at once)
//   announce       say one sentence through the aria-live line
//   openComposer   open the compose dialog, optionally filled: { text, to, planFirst, template }
//   openPanel      show content in the right-hand work panel: openPanel(content, { title })
//   closePanel     close it
//   settings       { theme, accent, accents, saved }
//   saveSettings   change the theme and the accent: saveSettings({ theme, accent })
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
  settings: { theme: "auto", accent: "graphite", accents: null, saved: false },
  saveSettings: async () => ({ theme: "auto", accent: "graphite", accents: null, saved: false }),
});

export const useApp = () => useContext(AppContext);
