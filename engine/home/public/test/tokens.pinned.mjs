// The design tokens' pinned names and values (PLAN-3D-ALL U1: dusk and golden morning; before it PLAN-COOK
// section 1). The only place token values are written in the tests: a changed colour, size or corner is
// one edit in styles/tokens.css and one here.

// The palette, [dark, light]. Light is chosen by data-theme="light", or by data-theme="auto" on a Mac set to
// light. PLAN-3D-ALL U1 (D3 to D5): the quiet look was rejected on 16 November 2026, so the cool greys, the blue
// accent and the white light panels are replaced by the studio's materials: a warm plaster ground (a near-black at
// dusk, an off-white in the morning), oak panels a step lighter with a warm 1 px edge and a real shadow, and the
// lamplight accent. In dark the steps stay in order, the sidebar (--side) under the stage (--stage) under the page
// ground (--bg) under the rail (--panel) under a card (--card), with --raise for what is raised or chosen. Every
// ink at 4.5 to 1 on every surface, one overlay surface for what floats.
export const THEMED = {
  "--bg": ["#151210", "#f3eee5"],
  "--stage": ["#100e0c", "#e9e2d6"],
  "--panel": ["#1b1815", "#fbf8f2"],
  "--side": ["#0d0b0a", "#ece6db"],
  "--card": ["#221e1a", "#fffdf8"],
  "--raise": ["#2a2520", "#ebe4d8"],
  "--sel": ["#322c26", "#e2dacc"],
  "--raise-2": ["#3a332c", "#ddd5c8"],
  "--ctl": ["rgba(255,236,214,.07)", "rgba(80,52,24,.06)"],
  // Fix round R5: the neutral chip's fill, opaque, so a chip reads on a card (at least 1.3 to 1 against it).
  "--chip": ["#3b342d", "#ddd4c5"],
  "--field": ["#181512", "#fffdf9"],
  // The 1 px edge of a raised thing: 9 percent warm white in dark, a warm grey in light (PLAN-3D-ALL U1).
  "--line": ["rgba(255,236,214,.09)", "#e5ddd0"],
  "--line-2": ["rgba(255,236,214,.14)", "#d8cfc1"],
  // What floats (a dialog, a menu, a popover): lighter than a card in dark, the card's warm white in light; its edge and shadow.
  "--overlay": ["#2b2621", "#fffdf8"],
  "--overlay-line": ["rgba(255,240,224,.16)", "#d3cabd"],
  "--ink": ["#f1ede6", "#1b1916"],
  "--ink-2": ["#c9c1b6", "#4d463d"],
  // Reads at 4.5 on every surface, the sidebar and the stage too, in both themes.
  "--ink-3": ["#a59c90", "#665e53"],
  "--accent": ["#f2c487", "#8a4f0c"],
  // PLAN-3D-ALL U1 (D5): the accent is lamplight, not blue. The filled primary is lamplight under dark ink in both
  // themes: in dark a little deeper than the link accent; in light deep enough to part 3 to 1 from the ground while
  // the dark ink still reads at 4.5 on it; and at least 15 apart from --warn in Lab, so a primary is never a warning.
  "--accent-fill": ["#e9b46f", "#bd772a"],
  "--accent-ink": ["#1d1a17", "#1d1a17"],
  // The info chip's tint: working is the lamp (D5), so the lamp at about 12 percent.
  "--info-bg": ["rgba(242,196,135,.12)", "#f6e9d5"],
  // States follow the lamps (D5): on or passed a muted green, waiting for you amber, a problem red.
  "--good": ["#8cc79b", "#2e6b3c"],
  "--good-bg": ["rgba(140,199,155,.14)", "#e3efe2"],
  "--warn": ["#ff9f45", "#a64b00"],
  "--warn-bg": ["rgba(255,159,69,.14)", "#fbead6"],
  "--warn-line": ["rgba(255,159,69,.34)", "#ebcaa0"],
  "--bad": ["#ff7a62", "#b3261e"],
  "--bad-bg": ["rgba(255,122,98,.12)", "#fbe4dc"],
  // A solid danger fill (a danger button under the pointer): the accent ink (dark, PLAN-3D-ALL U1) reads at 4.5 on it.
  "--bad-fill": ["#ef6f55", "#e5654a"],
  "--spent": ["#7d756b", "#a39a8e"],
  "--add-bg": ["rgba(140,199,155,.18)", "#d9ecd9"],
  "--del-bg": ["rgba(255,122,98,.18)", "#fadcd4"],
  // Dark: a 4 percent white inner top highlight, then the contact shadow and the soft drop.
  "--shadow-card": ["inset 0 1px 0 rgba(255,236,214,.04), 0 1px 2px rgba(0,0,0,.45), 0 8px 24px rgba(0,0,0,.35)", "0 1px 2px rgba(60,40,20,.07), 0 6px 16px rgba(60,40,20,.06)"],
  "--shadow-lift": ["0 2px 4px rgba(0,0,0,.45), 0 12px 32px rgba(0,0,0,.40)", "0 1px 3px rgba(60,40,20,.10), 0 10px 28px rgba(60,40,20,.14)"],
  // The filled button: a 1 px inner top highlight and a small drop, so it sits in place, not a flat slab.
  "--shadow-btn": ["inset 0 1px 0 rgba(255,255,255,.24), 0 1px 2px rgba(0,0,0,.40)", "inset 0 1px 0 rgba(255,255,255,.22), 0 1px 2px rgba(60,40,20,.20)"],
  "--float": ["0 0 0 1px rgba(255,236,214,.1), 0 2px 6px rgba(0,0,0,.30), 0 24px 64px rgba(0,0,0,.60)", "0 0 0 1px rgba(60,40,20,.08), 0 2px 6px rgba(60,40,20,.08), 0 24px 64px rgba(60,40,20,.20)"],
  "--overlay-shadow": ["inset 0 1px 0 rgba(255,236,214,.05), 0 2px 6px rgba(0,0,0,.30), 0 20px 60px rgba(0,0,0,.55)", "0 2px 6px rgba(60,40,20,.08), 0 24px 64px rgba(60,40,20,.20)"],
  "--paper-shadow": ["0 0 0 1px rgba(255,236,214,.06), 0 2px 4px rgba(0,0,0,.30), 0 18px 40px rgba(0,0,0,.45)", "0 0 0 1px rgba(60,40,20,.10), 0 2px 4px rgba(60,40,20,.06), 0 12px 28px rgba(60,40,20,.12)"],
  "--tip": ["#f1ede6", "#1b1916"],
  "--tip-ink": ["#1b1916", "#fffdf8"],
  // The dim behind a dialog or a sheet (a menu or a popover dims nothing).
  "--scrim": ["rgba(8,6,4,.6)", "rgba(27,22,16,.28)"],
  "--pin": ["#ecc068", "#f0bd4a"],
  "--pin-ink": ["#1d1503", "#1d1503"],
  "--pin-line": ["#ecc068", "#a8740a"],
  // PLAN-3D-ALL U1 (D4): paper, a cream sheet in both themes, read through [data-surface="paper"] (SURFACES below).
  "--paper": ["#efe9df", "#fdfbf6"],
  "--paper-2": ["#e6dfd3", "#f3eee5"],
  "--paper-ink": ["#211d18", "#1b1916"],
  "--paper-ink-2": ["#4f473e", "#4d463d"],
  "--paper-ink-3": ["#645b51", "#645b51"],
  "--paper-line": ["rgba(70,48,26,.16)", "rgba(70,48,26,.14)"],
  "--paper-accent": ["#7f480a", "#7f480a"],
  "--paper-field": ["#f8f4ed", "#fffefb"],
  // PLAN-3D-ALL U1 (D5, D6): the lamp glyph's tone (3 to 1 on the ground as a mark) and its pool on a row; the room
  // header's scrim, -0 under the title (at least 72 percent), -1 where the picture shows; a panel over a scene.
  "--lamp": ["#f2c487", "#b8742a"],
  "--lamp-pool": ["rgba(242,196,135,.08)", "rgba(184,116,42,.10)"],
  "--room-scrim-0": ["rgba(21,18,16,.86)", "rgba(243,238,229,.88)"],
  "--room-scrim-1": ["rgba(21,18,16,.2)", "rgba(243,238,229,.16)"],
  "--over": ["#1c1916", "#fbf8f2"],
  "--over-line": ["rgba(255,236,214,.14)", "#e2d9cb"],
  // Fix round R5: six quiet tints for identity on a small tile or an avatar (never a state), each its ink on its own
  // fill of about 14 percent, at 4.5 to 1 over a card, a panel and the overlay.
  "--tint-blue": ["#86b6fb", "#1e56d6"],
  "--tint-blue-bg": ["rgba(134,182,251,.14)", "rgba(30,86,214,.12)"],
  "--tint-green": ["#6fd99a", "#16703d"],
  "--tint-green-bg": ["rgba(111,217,154,.14)", "rgba(22,112,61,.12)"],
  "--tint-violet": ["#b8a4fb", "#6d34d8"],
  "--tint-violet-bg": ["rgba(184,164,251,.14)", "rgba(109,52,216,.12)"],
  "--tint-orange": ["#f5a66b", "#a8420e"],
  "--tint-orange-bg": ["rgba(245,166,107,.14)", "rgba(168,66,14,.12)"],
  "--tint-rose": ["#f892a4", "#b31440"],
  "--tint-rose-bg": ["rgba(248,146,164,.14)", "rgba(179,20,64,.12)"],
  "--tint-teal": ["#5ccfc0", "#0e6c64"],
  "--tint-teal-bg": ["rgba(92,207,192,.14)", "rgba(14,108,100,.12)"],
  // Compatibility (removed by T90): the graphite accent and the checker keep their values (the other five old
  // accents are the tints' aliases, below).
  "--accent-graphite": ["#f2f3f5", "#18181b"],
  "--checker-a": ["#d4d4d8", "#f4f4f5"],
  "--checker-b": ["#b4b4bc", "#e4e4e7"],
  "--avatar-backing": ["#b4b4bc", "#f4f4f5"],

  // PLAN-3D T7: the studio. The picture's palette (sky, forest, building, the fallback's lamps) is the dusk key in
  // both themes until T12 approves the golden morning (D5), so its two values are equal; the DOM over the stage
  // (the paper sheet and its ink, the scrim's two stops, a tag's ground, edge and inks) follows the theme.
  "--w-sky-0": ["#161c2c", "#161c2c"],
  "--w-sky-1": ["#4a3a4e", "#4a3a4e"],
  "--w-sky-2": ["#b77a5a", "#b77a5a"],
  "--w-glow": ["#f0a66a", "#f0a66a"],
  "--w-hill": ["#2a2530", "#2a2530"],
  "--w-trees-far": ["#1f2227", "#1f2227"],
  "--w-trees": ["#101512", "#101512"],
  "--w-ground": ["#181612", "#181612"],
  "--w-forecourt": ["#25211c", "#25211c"],
  "--w-deck": ["#5c4232", "#5c4232"],
  "--w-stone": ["#6d655c", "#6d655c"],
  "--w-shell": ["#b9b3aa", "#b9b3aa"],
  "--w-shell-2": ["#8f8981", "#8f8981"],
  "--w-frame": ["#1e1b19", "#1e1b19"],
  "--w-room": ["#2a2420", "#2a2420"],
  "--w-room-lit": ["#c8925f", "#c8925f"],
  "--w-glass": ["#2b3140", "#2b3140"],
  "--w-desk": ["#a9825e", "#a9825e"],
  "--w-door": ["#3a2f29", "#3a2f29"],
  "--w-door-light": ["#ffb36b", "#ffb36b"],
  "--w-shrub": ["#18211a", "#18211a"],
  "--w-lamp-on": ["#ffcf96", "#ffcf96"],
  "--w-lamp-amber": ["#ff9a36", "#ff9a36"],
  "--w-lamp-red": ["#ff5a3c", "#ff5a3c"],
  "--w-lamp-off": ["#8c7f73", "#8c7f73"],
  "--w-lamp-down": ["#6e635a", "#6e635a"],
  "--w-pool": ["#ffd2a0", "#ffd2a0"],
  // PLAN-3D-ALL U1 (D4): the paper and its ink are aliases of --paper and --paper-ink (in ALIASES below). Their
  // values stay here as they compute, for the world's tests that read them; the tokens test checks both.
  "--w-paper": ["#efe9df", "#fdfbf6"],
  "--w-paper-ink": ["#211d18", "#1b1916"],
  "--w-scrim-0": ["rgba(12,11,10,.88)", "rgba(243,243,245,.94)"],
  "--w-scrim-1": ["rgba(12,11,10,0)", "rgba(243,243,245,0)"],
  "--w-tag": ["rgba(20,17,15,.86)", "rgba(255,255,255,.94)"],
  "--w-tag-line": ["rgba(255,226,196,.16)", "rgba(16,24,40,.12)"],
  "--w-tag-ink": ["#f6f1ea", "#18181b"],
  "--w-tag-ink-2": ["#d9c9b8", "#4a4b53"],
};

// Not themed: the scale, and the few fixed colours.
export const FIXED = {
  "--on-picture-bg": "rgba(9,9,11,.78)",
  "--on-picture-ink": "#ffffff",
  "--black": "#000000",
  "--played-dim": "rgba(0, 0, 0, 0.42)",

  "--fs-label": "12px", "--fs-note": "13px", "--fs-body": "14px", "--fs-ui": "13px", "--fs-fact": "14px",
  "--fs-section": "15px", "--fs-stat": "20px", "--fs-page": "24px", "--fs-figure": "36px",
  "--lh-label": "16px", "--lh-note": "18px", "--lh-body": "1.43", "--lh-ui": "18px", "--lh-fact": "20px",
  "--lh-section": "22px", "--lh-stat": "28px", "--lh-page": "30px", "--lh-figure": "42px", "--lh-tight": "1.3",
  "--fw-regular": "400", "--fw-medium": "500", "--fw-bold": "600", "--fw-page": "600",
  "--ls-page": "-.018em", "--ls-figure": "-.02em", "--ls-stat": "-.01em", "--ls-label": ".1px",
  "--s-1": "4px", "--s-2": "8px", "--s-3": "12px", "--s-4": "16px", "--s-5": "20px", "--s-6": "24px", "--s-7": "28px",
  "--s-8": "32px", "--s-10": "40px", "--s-12": "48px",
  "--r-xs": "4px", "--r-1": "6px", "--r-2": "8px", "--r-3": "12px", "--r-round": "999px",
  "--h-sm": "28px", "--h-md": "32px", "--h-lg": "40px",
  "--topbar-h": "48px", "--tabbar-h": "58px", "--side-w": "216px", "--side-w-icons": "56px", "--rail-w": "360px",
  "--band": "136px", "--sections-w": "264px", "--doc-max": "800px", "--column": "720px", "--content-max": "968px",
  "--queue-w": "328px", "--panel-w": "380px", "--pad": "24px",
  "--t-fast": "120ms", "--t-med": "200ms", "--t-slow": "320ms", "--ease": "cubic-bezier(.2,0,0,1)",
  "--blur-tag": "6px",
  "--font-sans": '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  "--font-mono": 'ui-monospace, "SF Mono", Menlo, monospace',
  // PLAN-3D-ALL U1 (D5): titles only; faces already on the Mac and the iPhone, then the system stack.
  "--font-display": '"Avenir Next", "Avenir", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',

  // Compatibility (removed by T90), values that are not a plain alias.
  "--primary-hover": "color-mix(in srgb, var(--accent-fill) 88%, #fff)",
  "--accept-hover": "color-mix(in srgb, var(--accent-fill) 88%, #fff)",
  "--fs-ghost": "clamp(72px, 14vw, 180px)",
  "--blur-chrome": "0px",
  "--t-zoom": "420ms",
  // The dock stays until T20's shell replaces it.
  "--dock-w": "56px",
};

// Names that point at another token, in both themes: the mockup's names for three steps, the focus ring, and
// the compatibility block (section 1.3; all but --focus removed by T90).
export const ALIASES = {
  "--card-2": "var(--raise)",
  "--track": "var(--raise-2)",
  "--accent-fg": "var(--accent)",
  "--sel-shadow": "var(--shadow-card)",
  "--focus": "var(--accent)",

  "--canvas": "var(--bg)",
  "--glass": "var(--card)",
  "--glass-strong": "var(--panel)",
  "--glass-soft": "var(--ctl)",
  "--hairline": "var(--line)",
  "--hairline-strong": "var(--line-2)",
  "--text": "var(--ink)",
  "--text-2": "var(--ink-2)",
  "--text-3": "var(--ink-3)",
  "--primary": "var(--accent-fill)",
  "--primary-text": "var(--accent-ink)",
  "--accept": "var(--accent-fill)",
  "--accept-text": "var(--accent-ink)",
  "--accent-text": "var(--accent-ink)",
  "--ok": "var(--good)",
  "--ok-bg": "var(--good-bg)",
  "--ok-text": "var(--good)",
  "--warn-text": "var(--warn)",
  "--bad-text": "var(--bad)",
  "--bg-warm": "var(--warn-bg)",
  "--border-warm": "var(--warn-line)",
  "--live": "var(--good)",
  "--live-text": "var(--good)",
  "--shadow-pop": "var(--float)",
  // The glass edge is the card shadow in both themes (never none, since sheets list it beside another shadow).
  "--highlight": "var(--shadow-card)",
  "--bg-card": "var(--card)",
  "--bg-sidebar": "var(--side)",
  "--bg-subtle": "var(--ctl)",
  "--border": "var(--line)",
  "--border-strong": "var(--line-2)",
  "--dept-operations": "var(--ink-2)",
  "--dept-sales": "var(--ink-2)",
  "--dept-marketing": "var(--ink-2)",
  "--dept-studio": "var(--ink-2)",
  "--dept-support": "var(--ink-2)",
  "--dept-people": "var(--ink-2)",
  "--dept-books": "var(--ink-2)",
  "--dept-brain": "var(--ink-2)",
  "--fs-over": "var(--fs-label)",
  "--fs-caption": "var(--fs-note)",
  "--fs-title": "var(--fs-section)",
  "--fs-heading": "var(--fs-page)",
  "--fs-display": "var(--fs-page)",
  "--fs-dept": "var(--fs-stat)",
  "--r-4": "var(--r-3)",
  "--r-5": "var(--r-3)",
  "--r-pill": "var(--r-2)",
  "--sidebar-w": "var(--side-w)",
  "--font-serif": "var(--font-sans)",
  // Fix round R5: the avatar's five hues are the tiles' tints.
  "--accent-blue": "var(--tint-blue)",
  "--accent-green": "var(--tint-green)",
  "--accent-violet": "var(--tint-violet)",
  "--accent-orange": "var(--tint-orange)",
  "--accent-rose": "var(--tint-rose)",
  // PLAN-3D-ALL U1 (D4): the studio's paper is the one paper.
  "--w-paper": "var(--paper)",
  "--w-paper-ink": "var(--paper-ink)",
};

// PLAN-3D-ALL U1 (D4): the two surfaces as scopes. What [data-surface="paper"] and [data-surface="over"] set,
// exactly; the aliases of ALIASES are declared on [data-surface] too, so they follow. Paper is light in both themes:
// the names that point at the paper family take its themed values; the states, the tints and the filled primary
// are one light set (on paper the primary is a deep lamp-brown under cream words, as the approved e2 sheet).
export const SURFACES = {
  paper: {
    "--bg": "var(--paper)",
    "--stage": "var(--paper-2)",
    "--panel": "var(--paper)",
    "--card": "var(--paper)",
    "--raise": "var(--paper-2)",
    "--sel": "var(--paper-2)",
    "--raise-2": "#d9cfbf",
    "--overlay": "var(--paper)",
    "--field": "var(--paper-field)",
    "--ctl": "rgba(70,48,26,.06)",
    "--chip": "#d6cbb9",
    "--line": "var(--paper-line)",
    "--line-2": "rgba(70,48,26,.26)",
    "--ink": "var(--paper-ink)",
    "--ink-2": "var(--paper-ink-2)",
    "--ink-3": "var(--paper-ink-3)",
    "--accent": "var(--paper-accent)",
    "--accent-fill": "#8a5520",
    "--accent-ink": "#fffaf2",
    "--info-bg": "rgba(154,84,19,.10)",
    "--lamp-pool": "rgba(154,84,19,.08)",
    "--good": "#2e6b3c",
    "--good-bg": "#e3efe2",
    "--warn": "#9a4500",
    "--warn-bg": "#f6e2c8",
    "--warn-line": "#dfb98a",
    "--bad": "#a52a1c",
    "--bad-bg": "#f7dcd3",
    "--bad-fill": "#b3261e",
    "--spent": "#9d9387",
    "--add-bg": "#d6e8d4",
    "--del-bg": "#f5d6cc",
    "--tint-blue": "#1a4cc0",
    "--tint-blue-bg": "rgba(30,86,214,.12)",
    "--tint-green": "#146436",
    "--tint-green-bg": "rgba(22,112,61,.12)",
    "--tint-violet": "#6230c4",
    "--tint-violet-bg": "rgba(109,52,216,.12)",
    "--tint-orange": "#983b0c",
    "--tint-orange-bg": "rgba(168,66,14,.12)",
    "--tint-rose": "#a3123a",
    "--tint-rose-bg": "rgba(179,20,64,.12)",
    "--tint-teal": "#0c6159",
    "--tint-teal-bg": "rgba(14,108,100,.12)",
  },
  over: {
    "--bg": "var(--over)",
    "--panel": "var(--over)",
    "--line": "var(--over-line)",
  },
};
