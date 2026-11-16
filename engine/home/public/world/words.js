// The new words of the Map and Needs you as the lit studio (PLAN-3D 2.5, revision R1), in one table so the tests pin
// them and no page writes its own. Every sentence about money or safety stays the server's or the Settings module's;
// these are labels only.

export const WORDS = Object.freeze({
  lightingStudio: "Lighting the studio",
  lightingDesk: "Lighting the desk",
  whoIsHere: "Who is here",
  switchOff: "Switch off",
  switchOn: "Switch on",
  stopTask: "Stop this task",
  openInSettings: "Open in Settings",
  openDoor: "Open this door",
  shutDoor: "Shut this door",
  yesOpenDoor: "Yes, open this door",
  cancel: "Cancel",
  appStudio: "App Studio",
  doors: "Doors",
  waiting: "Waiting",
  keys: "Keys: J and K move, Enter the story so far, A and D go to the buttons.",
});

// The Settings section each door's sentences live in: the addresses of pages/settings.js `sectionHref` (the Web
// section for the web door; Runway and Higgsfield share the Generation section). Kept here, not imported, so this
// file stays free of Preact; test/world/state.test.mjs checks them against settings.js.
const DOOR_SECTIONS = Object.freeze({ web: "#/settings?s=web", generation: "#/settings?s=generation", higgsfield: "#/settings?s=generation" });

// The address of a door's section in Settings; anything that is not one of the three doors is Settings itself.
export function doorSettingsHref(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(DOOR_SECTIONS, id) ? DOOR_SECTIONS[id] : "#/settings";
}
