// Runs before the page paints (a classic script in index.html), so a chosen look never flashes another
// first. "?theme=light|dark|auto", "?accent=<name>", "?backdrop=aurora|stars|plain" and "?motion=on|off"
// in the address set them for this visit only (used for screenshots); otherwise the choice remembered in
// this browser is used. With no choice the theme is dark, the backdrop the aurora, and motion on.
(function () {
  if (typeof document === "undefined" || typeof location === "undefined") return;
  var THEMES = ["light", "dark", "auto"];
  var ACCENTS = ["graphite", "blue", "green", "violet", "orange", "rose"];
  var BACKDROPS = ["aurora", "stars", "plain"];
  var MOTIONS = ["on", "off"];
  var root = document.documentElement;
  var q = null;
  try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
  var stored = function (key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  };
  var pick = function (name, key, allowed) {
    var asked = q ? q.get(name) : null;
    if (asked && allowed.indexOf(asked) !== -1) return asked;
    var kept = stored(key);
    return kept && allowed.indexOf(kept) !== -1 ? kept : null;
  };
  root.setAttribute("data-theme", pick("theme", "home.theme", THEMES) || "dark");
  var accent = pick("accent", "home.accent", ACCENTS);
  if (accent) root.setAttribute("data-accent", accent);
  root.setAttribute("data-backdrop", pick("backdrop", "home.backdrop", BACKDROPS) || "aurora");
  root.setAttribute("data-motion", pick("motion", "home.motion", MOTIONS) || "on");
})();
