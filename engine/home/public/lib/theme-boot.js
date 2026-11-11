// Runs before the page paints, so a chosen theme never flashes the other one first.
// "?theme=light|dark|auto" in the address sets it for this visit only (used for screenshots).
(function () {
  var choice = null;
  try {
    var asked = new URLSearchParams(location.search).get("theme");
    choice = asked === "light" || asked === "dark" ? asked : asked === "auto" ? null : localStorage.getItem("home.theme");
  } catch (e) { choice = null; }
  if (choice === "light" || choice === "dark") document.documentElement.setAttribute("data-theme", choice);
})();
