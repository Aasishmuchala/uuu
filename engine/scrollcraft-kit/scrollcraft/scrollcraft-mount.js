/* The engine's own starter for scroll-craft on a page written in HTML (the plain site kit), PLAN-ASTRYX T13. Load it
   after scrollcraft.js, both with `defer`. An Astryx page does not load this file: its app.js mounts scroll-craft once
   the page is drawn. Never change it. */
(function () {
  'use strict';
  function go() {
    if (window.ScrollCraft && typeof window.ScrollCraft.mount === 'function') window.ScrollCraft.mount(document.body);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
  else go();
})();
