// (c) follow-up: the <summary> heads whose marker the style sheets hide with ::-webkit-details-marker (a selector
// CSS.supports does not report in either engine) and list-style: none. Whether this engine draws a marker is read
// from the box: the summary's display and list-style, and how far its first text starts from its left edge
// compared with the same summary with the marker forced to show (list-style: disclosure-closed inside).
await quiet(8000);
const out = [];
for (const s of [...document.querySelectorAll("summary")].filter(visible).slice(0, 6)) {
  const cs = getComputedStyle(s);
  const r = document.createRange(); const t = [...s.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()) || s.firstElementChild;
  const left = () => { if (!t) return null; if (t.nodeType === 3) { r.selectNodeContents(t); return Math.round(r.getBoundingClientRect().left - s.getBoundingClientRect().left); } return Math.round(t.getBoundingClientRect().left - s.getBoundingClientRect().left); };
  const now = left();
  const keep = s.getAttribute("style") || "";
  s.setAttribute("style", `${keep};display:list-item;list-style:disclosure-closed inside`);
  const forced = left();
  s.setAttribute("style", keep);
  out.push({ el: label(s), text: text(s, 40), display: cs.display, listStyle: cs.listStyleType, textLeft: now, textLeftWithMarker: forced });
}
return { summaries: out };
