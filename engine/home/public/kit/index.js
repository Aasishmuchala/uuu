// The whole kit. Pages import the kit only from here.

// Primitives (CONTRACTS-V2 13.1)
export * from "./button.js";
export * from "./icon.js";
export * from "./avatar.js";
export * from "./status.js";
export * from "./tag.js";
export * from "./card.js";
export * from "./tabs.js";
export * from "./fields.js";
export * from "./states.js";
export * from "./overlays.js";
export * from "./text.js";
export * from "./page.js";

// Composites (CONTRACTS-V2 13.2)
export * from "./decision.js";
export * from "./task-card.js";
export * from "./brief.js";
export * from "./composer.js";
export * from "./conversation.js";
export * from "./table.js";
export * from "./timeline.js";
export * from "./checks.js";
export * from "./doc.js";
export * from "./agent.js";

// New in version 3 (CONTRACTS-V3 28)
export * from "./creature.js";
export * from "./segmented.js";
export * from "./job.js";
export * from "./answer.js";
export * from "./ring.js";
export * from "./forms.js";
export * from "./upload.js";

// New in version 5 (PLAN-V5 K9, T20): the card of versions to pick from. DecisionCard is the one approval card
// for any Needs-you item, so it shows a card of versions as one (kit/pick.js DecisionOrPick; this explicit
// export wins over decision.js's own through the star export above).
export * from "./pick.js";

// Step 3 (PLAN-V5 K14, T45): a film's shotlist, where the owner approves its shots and their cost. DecisionCard
// now also shows a shotlist as one (kit/shotlist.js DecisionOrShotlist, which falls back to DecisionOrPick).
export * from "./shotlist.js";
export { DecisionOrShotlist as DecisionCard } from "./shotlist.js";

// Step 4 (PLAN-V5 K15, K16, T54): a site an agent built, on its task's page: the home server's own pictures of it
// at desktop and phone width, what the page viewer found, the preview and the zip.
export * from "./site.js";
