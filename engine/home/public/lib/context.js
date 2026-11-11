// What every page can reach without passing it down: the shell's state and its helpers.
//   state         the last answer of GET /api/state, or null
//   stateError    an ApiError when /api/state could not be read
//   refreshState  read /api/state again now (after an action, so counts are right at once)
//   announce      say one sentence through the page's aria-live line
//   openGoalBox   open the "Give a goal" box (on the inbox it moves to the box at the top)
import { createContext, useContext } from "../vendor/preact-htm.js";

export const AppContext = createContext({
  state: null,
  stateError: null,
  refreshState: () => {},
  announce: () => {},
  openGoalBox: () => {},
});

export const useApp = () => useContext(AppContext);
