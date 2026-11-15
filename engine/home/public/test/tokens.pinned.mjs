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
  "--bg": ["#121214", "#f1f2f5"],
  "--stage": ["#0e0e10", "#e7e9ed"],
  "--panel": ["#19191d", "#ffffff"],
  "--side": ["#0a0a0c", "#eceef1"],
  "--card": ["#1f1f24", "#ffffff"],
  "--raise": ["#27272d", "#eceef2"],
  "--sel": ["#2c2c32", "#e5e8ed"],
  "--raise-2": ["#34343b", "#dcdfe5"],
  "--ctl": ["rgba(255,255,255,.07)", "rgba(16,24,40,.06)"],
  "--field": ["#16161a", "#ffffff"],
  // The 1 px edge of a raised thing: 9 percent white in dark, a cool grey in light.
  "--line": ["rgba(255,255,255,.09)", "#dfe2e7"],
  "--line-2": ["rgba(255,255,255,.14)", "#d0d4db"],
  // What floats (a dialog, a menu, a popover): lighter than a card in dark, white in light; its edge and shadow.
  "--overlay": ["#26262c", "#ffffff"],
  "--overlay-line": ["rgba(255,255,255,.14)", "#d5d8de"],
  "--ink": ["#f4f4f5", "#18181b"],
  "--ink-2": ["#c0c0c7", "#4a4b53"],
  // Reads at 4.5 on every surface, the sidebar and the stage too, in both themes.
  "--ink-3": ["#a1a1aa", "#5d5f68"],
  "--accent": ["#86adff", "#2459dd"],
  // Dark: a little deeper than the link accent, so the filled primary is not the brightest thing on a screen;
  // white words on it read at 4.5.
  "--accent-fill": ["#3760d0", "#2459dd"],
  "--accent-ink": ["#ffffff", "#ffffff"],
  // The info chip's tint: the accent at about 14 percent.
  "--info-bg": ["rgba(134,173,255,.14)", "#e6edfc"],
  "--good": ["#62d39d", "#17703f"],
  "--good-bg": ["rgba(98,211,157,.14)", "#e2f2e8"],
  "--warn": ["#ecc068", "#855600"],
  "--warn-bg": ["rgba(236,192,104,.14)", "#fbf1d8"],
  "--warn-line": ["rgba(236,192,104,.34)", "#e8d39a"],
  "--bad": ["#ff93a5", "#b4233f"],
  "--bad-bg": ["rgba(255,147,165,.14)", "#fde8ec"],
  // A solid danger fill (a danger button under the pointer): white words on it read at 4.5.
  "--bad-fill": ["#c93a55", "#c4304b"],
  "--spent": ["#7b7b85", "#9d9da6"],
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
  "--scrim": ["rgba(0,0,0,.5)", "rgba(15,17,21,.22)"],
  "--pin": ["#ecc068", "#f0bd4a"],
  "--pin-ink": ["#1d1503", "#1d1503"],
  "--pin-line": ["#ecc068", "#a8740a"],
  // Compatibility (removed by T90): the six old accents and the checker keep their values.
  "--accent-graphite": ["#f2f3f5", "#18181b"],
  "--accent-blue": ["#60a5fa", "#2563eb"],
  "--accent-green": ["#4ade80", "#15803d"],
  "--accent-violet": ["#a78bfa", "#7c3aed"],
  "--accent-orange": ["#fb923c", "#c2410c"],
  "--accent-rose": ["#fb7185", "#be123c"],
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
};
