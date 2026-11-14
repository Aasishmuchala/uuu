/* The site kit's scroll reveal: this engine's own, written for the pages the Builder makes, with no third
   party's text. Every element with a data-reveal attribute gets the class is-in as it comes onto the screen, once;
   layout.css fades it in. Every part is shown at once, with no effect, when the visitor asks for less motion
   and when the browser has no IntersectionObserver. The page viewer asks for less motion when it takes its
   pictures of the whole page (it never scrolls), as any visitor can: the page is never told a machine is
   looking. Nothing is fetched. Load it at the end of <body>, or with defer. */
(function () {
  "use strict";

  var root = document.documentElement;
  var stillQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  function parts() {
    return Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));
  }

  function showAll() {
    root.classList.remove("kit-reveal");
    parts().forEach(function (el) { el.classList.add("is-in"); });
  }

  function start() {
    var still = stillQuery !== null && stillQuery.matches;
    if (still || !("IntersectionObserver" in window)) {
      showAll();
      return;
    }
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          seen.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    root.classList.add("kit-reveal");
    parts().forEach(function (el) { seen.observe(el); });
    if (stillQuery !== null && typeof stillQuery.addEventListener === "function") {
      stillQuery.addEventListener("change", function (e) {
        if (e.matches) {
          seen.disconnect();
          showAll();
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
