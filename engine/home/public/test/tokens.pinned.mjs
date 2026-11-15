// The design tokens' pinned names and values (PLAN-COOK section 1, the C3 mockup's c.css and the corrections
// after round 3). The only place token values are written in the tests: a changed colour, size or corner is
// one edit in styles/tokens.css and one here.

// The palette, [dark, light]. Light is chosen by data-theme="light", or by data-theme="auto" on a Mac set to
// light. Fix round A2 (T100): in dark four steps a screen tells apart, the sidebar (--side) under the stage
// (--stage) under the page ground (--bg) under the rail (--panel) under a card (--card), with --raise for what is
// raised or chosen; in light one cool neutral family, white panels and cards on a calm cool ground. Every raised
// thing has a 1 px edge and a real shadow in both themes. Fix round A3 (T110): a card at least 4 L* off the ground
// in both themes, every ink at 4.5 to 1 on every surface, one overlay surface for what floats, a lighter dim.
export const THEMED = {
  "--bg": ["#15171d", "#eef0f4"],
  "--stage": ["#111318", "#e4e7ec"],
  "--panel": ["#1b1e26", "#ffffff"],
  "--side": ["#0c0d10", "#e9ecf0"],
  "--card": ["#232630", "#ffffff"],
  "--raise": ["#2a2e3a", "#e8ebf0"],
  "--sel": ["#303342", "#e1e5eb"],
  "--raise-2": ["#393d4e", "#d6dae2"],
  "--ctl": ["rgba(255,255,255,.07)", "rgba(16,24,40,.06)"],
  "--field": ["#191b22", "#ffffff"],
  // The 1 px edge of a raised thing: 9 percent white in dark, a cool grey in light.
  "--line": ["rgba(255,255,255,.09)", "#dcdfe5"],
  "--line-2": ["rgba(255,255,255,.14)", "#ccd1d9"],
  // What floats (a dialog, a menu, a popover): lighter than a card in dark, white in light; its edge and shadow.
  "--overlay": ["#2f3240", "#ffffff"],
  "--overlay-line": ["rgba(255,255,255,.16)", "#d0d4dc"],
  "--ink": ["#f4f5f7", "#17181c"],
  "--ink-2": ["#c3c6cf", "#474a54"],
  // Reads at 4.5 on every surface, the sidebar and the stage too, in both themes.
  "--ink-3": ["#a3a7b3", "#5a5e69"],
  "--accent": ["#86adff", "#2459dd"],
  // Dark: a little deeper than the link accent, so the filled primary is not the brightest thing on a screen;
  // white words on it read at 4.5.
  "--accent-fill": ["#3760d0", "#2459dd"],
  "--accent-ink": ["#ffffff", "#ffffff"],
  // The info chip's tint: the accent at about 14 percent.
  "--info-bg": ["rgba(134,173,255,.12)", "#e6edfc"],
  "--good": ["#62d39d", "#17703f"],
  "--good-bg": ["rgba(98,211,157,.14)", "#e2f2e8"],
  "--warn": ["#ecc068", "#855600"],
  "--warn-bg": ["rgba(236,192,104,.14)", "#fbf1d8"],
  "--warn-line": ["rgba(236,192,104,.34)", "#e8d39a"],
  "--bad": ["#ff93a5", "#b4233f"],
  "--bad-bg": ["rgba(255,147,165,.14)", "#fde8ec"],
  // A solid danger fill (a danger button under the pointer): white words on it read at 4.5.
  "--bad-fill": ["#c93a55", "#c4304b"],
  "--spent": ["#7c808d", "#9d9da6"],
  "--add-bg": ["rgba(98,211,157,.18)", "#d9f0e2"],
  "--del-bg": ["rgba(255,147,165,.18)", "#fbe0e5"],
  // Dark: a 4 percent white inner top highlight, then the contact shadow and the soft drop.
  "--shadow-card": ["inset 0 1px 0 rgba(255,255,255,.04), 0 1px 2px rgba(0,0,0,.40), 0 8px 24px rgba(0,0,0,.32)", "0 1px 2px rgba(16,24,40,.07), 0 6px 20px rgba(16,24,40,.08)"],
  "--shadow-lift": ["0 2px 4px rgba(0,0,0,.45), 0 12px 32px rgba(0,0,0,.40)", "0 1px 3px rgba(16,24,40,.08), 0 10px 28px rgba(16,24,40,.12)"],
  // The filled button: a 1 px inner top highlight and a small drop, so it sits in place, not a flat slab.
  "--shadow-btn": ["inset 0 1px 0 rgba(255,255,255,.14), 0 1px 2px rgba(0,0,0,.40)", "inset 0 1px 0 rgba(255,255,255,.16), 0 1px 2px rgba(16,24,40,.16)"],
  "--float": ["0 0 0 1px rgba(255,255,255,.1), 0 2px 6px rgba(0,0,0,.30), 0 24px 64px rgba(0,0,0,.60)", "0 0 0 1px rgba(16,24,40,.08), 0 2px 6px rgba(24,24,27,.08), 0 24px 64px rgba(24,24,27,.22)"],
  "--overlay-shadow": ["0 2px 6px rgba(0,0,0,.30), 0 24px 64px rgba(0,0,0,.60)", "0 2px 6px rgba(24,24,27,.08), 0 24px 64px rgba(24,24,27,.22)"],
  "--paper-shadow": ["0 0 0 1px rgba(255,255,255,.08), 0 6px 20px rgba(0,0,0,.45)", "0 0 0 1px rgba(16,24,40,.10), 0 6px 18px rgba(16,24,40,.08)"],
  "--tip": ["#f4f4f5", "#18181b"],
  "--tip-ink": ["#0f0f11", "#ffffff"],
  // The dim behind a dialog or a sheet (a menu or a popover dims nothing).
  "--scrim": ["rgba(6,7,10,.64)", "rgba(238,240,244,.72)"],
  "--pin": ["#ecc068", "#f0bd4a"],
  "--pin-ink": ["#1d1503", "#1d1503"],
  "--pin-line": ["#ecc068", "#a8740a"],
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
};

// Not themed: the scale, and the few fixed colours.
export const FIXED = {
  "--on-picture-bg": "rgba(9,9,11,.78)",
  "--on-picture-ink": "#ffffff",
  "--paper": "#fbfaf7",
  "--black": "#000000",
  "--played-dim": "rgba(0, 0, 0, 0.42)",

  "--fs-label": "12px", "--fs-note": "13px", "--fs-body": "14px", "--fs-ui": "14px", "--fs-fact": "15px",
  "--fs-section": "16px", "--fs-stat": "22px", "--fs-page": "28px", "--fs-figure": "40px",
  "--lh-label": "16px", "--lh-note": "18px", "--lh-body": "1.43", "--lh-ui": "20px", "--lh-fact": "22px",
  "--lh-section": "24px", "--lh-stat": "28px", "--lh-page": "34px", "--lh-figure": "46px", "--lh-tight": "1.3",
  "--fw-regular": "400", "--fw-medium": "500", "--fw-bold": "600",
  "--ls-page": "-.018em", "--ls-figure": "-.02em", "--ls-stat": "-.01em", "--ls-label": ".1px",
  "--s-1": "4px", "--s-2": "8px", "--s-3": "12px", "--s-4": "16px", "--s-5": "20px", "--s-6": "24px", "--s-7": "28px",
  "--s-8": "32px", "--s-10": "40px", "--s-12": "48px",
  "--r-xs": "4px", "--r-1": "6px", "--r-2": "8px", "--r-3": "12px", "--r-round": "999px",
  "--h-sm": "28px", "--h-md": "36px", "--h-lg": "40px",
  "--topbar-h": "48px", "--tabbar-h": "58px", "--side-w": "216px", "--side-w-icons": "56px", "--rail-w": "360px",
  "--band": "136px", "--sections-w": "264px", "--doc-max": "800px", "--column": "720px", "--content-max": "968px",
  "--queue-w": "328px", "--panel-w": "380px", "--pad": "24px",
  "--t-fast": "120ms", "--t-med": "200ms", "--t-slow": "320ms", "--ease": "cubic-bezier(.2,0,0,1)",
  "--blur-tag": "6px",
  "--font-sans": '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  "--font-mono": 'ui-monospace, "SF Mono", Menlo, monospace',

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
};
