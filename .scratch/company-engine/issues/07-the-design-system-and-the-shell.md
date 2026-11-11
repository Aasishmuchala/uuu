# 07: The design system and the shell

**What to build:** One calm look for every screen, written by us in the manner of LobeHub: near-neutral surfaces, a near-black main button, colour only for state, light and dark, and one accent the owner can change. A kit of parts every page is built from. A frame with a soft grey sidebar (Search, Home, Tasks, Docs, the Team with an avatar per agent, the Departments, then Routines, Health and Settings), a main pane, a work panel at the right, a narrow-window layout and a command menu on ⌘K.

**Blocked by:** 05

**Status:** ready-for-agent

**Plan tasks:** V1, V2, V7, V10, V11, V59, V48

- [ ] Every colour, size, space and radius comes from one set of tokens, in light and dark, with six accents
- [ ] Text meets a contrast of 4.5 to 1 in both themes, checked by a test
- [ ] The font and the ten avatars are vendored with their licences, or the system font and coloured initials are used
- [ ] One approval card is used everywhere: it shows exactly what is being approved, one main action, Send back with a note, and Esc cancels
- [ ] A list item that waits for the owner shows a "waiting for you" mark; anything still working shows a live mark
- [ ] The sidebar lists every agent with its avatar and state
- [ ] A page that is not built yet says so instead of breaking
- [ ] The command menu finds pages, agents and anything search finds
- [ ] Below 860 px the sidebar becomes a drawer and every control is at least 44 px high
- [ ] What a page shows is in its address, so any state can be opened directly
- [ ] No code, logo or artwork is copied from another project
