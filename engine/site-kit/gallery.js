/* The site kit's lightbox: this engine's own, written for the pages the Builder makes, with no third party's
   text. A link with a data-gallery attribute that points at a picture of this site opens that picture large in a
   <dialog>, with the alt text of the picture inside the link as its caption. The links with the same
   data-gallery value are one gallery: the left and right arrow keys (and the Back and Next buttons) go through
   them, Escape (or Close) closes it, and focus goes back to the link that opened it. A link to anything else, or
   to another site, is left as an ordinary link. Nothing is fetched but the picture the link already names.
   Load it at the end of <body>, or with defer. */
(function () {
  "use strict";

  var PICTURE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
  var SCHEME = /^[a-z][a-z0-9+.-]*:/i;

  var dialog = null;
  var picture = null;
  var caption = null;
  var back = null;
  var next = null;
  var group = [];
  var at = 0;
  var opener = null;

  /* The link's address as written: a picture inside this site, never another site's. */
  function ownPicture(link) {
    var href = (link.getAttribute("href") || "").trim();
    var bare = href.split("#")[0].split("?")[0];
    if (bare === "" || SCHEME.test(bare)) return false;
    if (bare.charAt(0) === "/" || bare.charAt(0) === "\\") return false;
    return PICTURE.test(bare);
  }

  function words(link) {
    var img = link.querySelector("img");
    var alt = img ? (img.getAttribute("alt") || "") : "";
    return alt.trim() || (link.getAttribute("aria-label") || "").trim() || link.textContent.trim();
  }

  function button(label, text, onPress) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.textContent = text;
    b.addEventListener("click", onPress);
    return b;
  }

  function make() {
    dialog = document.createElement("dialog");
    dialog.className = "kit-lightbox";
    dialog.setAttribute("aria-label", "Picture");

    var top = document.createElement("div");
    top.className = "kit-lightbox-bar";
    top.appendChild(document.createElement("span"));
    top.appendChild(button("Close", "×", function () { dialog.close(); }));

    var figure = document.createElement("figure");
    picture = document.createElement("img");
    picture.decoding = "async";
    caption = document.createElement("figcaption");
    figure.appendChild(picture);
    figure.appendChild(caption);

    var bottom = document.createElement("div");
    bottom.className = "kit-lightbox-bar";
    back = button("Back", "←", function () { show(at - 1); });
    next = button("Next", "→", function () { show(at + 1); });
    bottom.appendChild(back);
    bottom.appendChild(next);

    dialog.appendChild(top);
    dialog.appendChild(figure);
    dialog.appendChild(bottom);

    dialog.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); show(at - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); show(at + 1); }
    });
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", function () {
      picture.removeAttribute("src");
      if (opener && typeof opener.focus === "function") opener.focus();
      opener = null;
    });
    document.body.appendChild(dialog);
  }

  function show(i) {
    if (group.length === 0) return;
    at = (i + group.length) % group.length;
    var link = group[at];
    var said = words(link);
    picture.setAttribute("src", link.getAttribute("href").trim());
    picture.setAttribute("alt", said);
    caption.textContent = said;
    caption.hidden = said === "";
    back.hidden = group.length < 2;
    next.hidden = group.length < 2;
  }

  function openFrom(link) {
    if (dialog === null) make();
    var name = link.getAttribute("data-gallery");
    group = Array.prototype.slice.call(document.querySelectorAll("a[data-gallery]")).filter(function (a) {
      return a.getAttribute("data-gallery") === name && ownPicture(a);
    });
    opener = link;
    show(Math.max(0, group.indexOf(link)));
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var link = e.target && e.target.closest ? e.target.closest("a[data-gallery]") : null;
    if (!link || !ownPicture(link) || typeof HTMLDialogElement !== "function") return;
    e.preventDefault();
    openFrom(link);
  });
})();
