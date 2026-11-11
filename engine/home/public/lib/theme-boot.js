// Runs before the page paints (a classic script in index.html), so a chosen theme or accent never
// flashes the other one first. "?theme=light|dark|auto" and "?accent=<name>" in the address set them
// for this visit only (used for screenshots); otherwise the choice remembered in this browser is used.
(function () {
  if (typeof document === "undefined" || typeof location === "undefined") return;
  var ACCENTS = ["graphite", "blue", "green", "violet", "orange", "rose"];
  var root = document.documentElement;
  var q = null;
  try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
  var stored = function (key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  };
  var asked = q ? q.get("theme") : null;
  var theme = asked === "light" || asked === "dark" ? asked : asked === "auto" ? null : stored("home.theme");
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  var accent = (q && q.get("accent")) || stored("home.accent");
  if (accent && ACCENTS.indexOf(accent) !== -1) root.setAttribute("data-accent", accent);
})();
