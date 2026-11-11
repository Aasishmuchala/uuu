// The right-hand work panel (CONTRACTS-V2 14.2). A page opens it through the context:
// openPanel(content, { title }). It has a title and a close button, and Esc closes it while focus is
// inside. In a narrow window it is a full-width sheet over the page.
import { html, useEffect, useRef } from "../vendor/preact-htm.js";
import { Icon } from "../kit/index.js";

export function WorkPanel({ panel, onClose, narrow }) {
  const ref = useRef(null);
  const opener = useRef(null);

  useEffect(() => {
    if (!panel) return undefined;
    opener.current = document.activeElement;
    // In a sheet the panel takes focus, so the keyboard is where the eyes are.
    if (narrow) requestAnimationFrame(() => ref.current?.querySelector(".s-panel-close")?.focus());
    return () => {
      const back = opener.current;
      if (back && back.isConnected && ref.current?.contains(document.activeElement)) back.focus();
    };
  }, [!!panel]);

  if (!panel) return null;
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };
  return html`
    <aside class=${`s-panel${narrow ? " s-panel--sheet" : ""}`} aria-label=${panel.title || "Work panel"} ref=${ref} onKeyDown=${onKey}>
      <div class="s-panel-head">
        <h2 class="s-panel-title u-truncate">${panel.title || ""}</h2>
        <button type="button" class="s-icon-btn s-panel-close" onClick=${onClose} aria-label="Close the panel">
          <${Icon} name="cross" />
        </button>
      </div>
      <div class="s-panel-body">${panel.content}</div>
    </aside>`;
}
