// A menu of actions, a dialog and a side drawer. Each closes on Esc, keeps focus inside while open
// and gives focus back to whatever opened it.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { cx, nextId } from "./util.js";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusables = (root) => (root && root.querySelectorAll ? [...root.querySelectorAll(FOCUSABLE)] : []);
const activeElement = () => (typeof document === "undefined" ? null : document.activeElement);

// Focus moves in on open (to an element marked data-autofocus, else the first control of the body,
// else the panel), is kept inside on Tab, and goes back to the opener when the overlay goes away.
function useFocusTrap(panelRef, onClose) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const panel = panelRef.current;
    const opener = activeElement();
    if (panel) {
      const pick =
        (panel.querySelector && panel.querySelector("[data-autofocus]")) ||
        focusables(panel.querySelector && panel.querySelector("[data-overlay-body]"))[0] ||
        panel;
      if (pick && typeof pick.focus === "function") pick.focus();
    }
    return () => {
      if (opener && typeof opener.focus === "function" && opener.isConnected !== false) opener.focus();
    };
  }, []);
  return (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (close.current) close.current();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    const list = focusables(panel);
    if (!list.length) {
      event.preventDefault();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const now = activeElement();
    if (event.shiftKey && (now === first || now === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && now === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

function OverlayHead({ id, title, onClose, cls }) {
  return html`<div class=${`${cls}__head`}>
    <h2 class=${`${cls}__title`} id=${id}>${title}</h2>
    <${Button} variant="quiet" icon="cross" aria-label="Close" class=${`${cls}__close`} onClick=${() => onClose && onClose()} />
  </div>`;
}

const SIZES = ["sm", "md", "lg"];

function DialogPanel({ title, onClose, size, footer, children }) {
  const ref = useRef(null);
  const [id] = useState(() => nextId("k-dialog"));
  const onKeyDown = useFocusTrap(ref, onClose);
  return html`<div class="k-dialog">
    <div class="k-dialog__backdrop" aria-hidden="true" onClick=${() => onClose && onClose()}></div>
    <div
      ref=${ref}
      class=${cx("k-dialog__panel", `k-dialog__panel--${SIZES.includes(size) ? size : "md"}`)}
      role="dialog"
      aria-modal="true"
      aria-labelledby=${id}
      tabindex="-1"
      onKeyDown=${onKeyDown}
    >
      <${OverlayHead} id=${id} title=${title} onClose=${onClose} cls="k-dialog" />
      <div class="k-dialog__body" data-overlay-body>${children}</div>
      ${footer ? html`<div class="k-dialog__foot">${footer}</div>` : null}
    </div>
  </div>`;
}

export function Dialog({ open, title, onClose, size = "md", footer, children }) {
  if (!open) return null;
  return html`<${DialogPanel} title=${title} onClose=${onClose} size=${size} footer=${footer}>${children}<//>`;
}

function DrawerPanel({ side, title, onClose, children }) {
  const ref = useRef(null);
  const [id] = useState(() => nextId("k-drawer"));
  const onKeyDown = useFocusTrap(ref, onClose);
  return html`<div class=${cx("k-drawer", `k-drawer--${side === "left" ? "left" : "right"}`)}>
    <div class="k-drawer__backdrop" aria-hidden="true" onClick=${() => onClose && onClose()}></div>
    <div ref=${ref} class="k-drawer__panel" role="dialog" aria-modal="true" aria-labelledby=${id} tabindex="-1" onKeyDown=${onKeyDown}>
      <${OverlayHead} id=${id} title=${title} onClose=${onClose} cls="k-drawer" />
      <div class="k-drawer__body" data-overlay-body>${children}</div>
    </div>
  </div>`;
}

export function Drawer({ open, side = "right", title, onClose, children }) {
  if (!open) return null;
  return html`<${DrawerPanel} side=${side} title=${title} onClose=${onClose}>${children}<//>`;
}

// A button that opens a short list of actions. With an icon the button shows only the icon and
// `label` becomes its name for screen readers; without one it shows the label and a chevron.
export function Menu({ label = "More", icon, items }) {
  const [open, setOpen] = useState(false);
  const [id] = useState(() => nextId("k-menu"));
  const root = useRef(null);
  const trigger = useRef(null);
  const list = useRef(null);
  const entries = Array.isArray(items) ? items.filter(Boolean) : [];

  const itemsIn = () => (list.current && list.current.querySelectorAll ? [...list.current.querySelectorAll('[role="menuitem"]')] : []);
  const close = (refocus) => {
    setOpen(false);
    if (refocus && trigger.current) trigger.current.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const first = itemsIn()[0];
    if (first) first.focus();
    const outside = (event) => {
      if (root.current && root.current.contains && !root.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const onListKey = (event) => {
    const all = itemsIn();
    const at = all.indexOf(activeElement());
    const go = (i) => {
      event.preventDefault();
      if (all.length) all[(i + all.length) % all.length].focus();
    };
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(all.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") close(false);
  };
  const onTriggerKey = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
    }
  };
  const pick = (item) => {
    close(true);
    if (item.onSelect) item.onSelect(item);
  };

  return html`<div class=${cx("k-menu", open && "k-menu--open")} ref=${root}>
    <button
      ref=${trigger}
      type="button"
      class=${cx("k-btn", "k-btn--quiet", "k-btn--md", icon && "k-btn--icon", "k-menu__trigger")}
      aria-haspopup="menu"
      aria-expanded=${open ? "true" : "false"}
      aria-controls=${open ? id : undefined}
      aria-label=${icon ? label : undefined}
      title=${icon ? label : undefined}
      onClick=${() => setOpen(!open)}
      onKeyDown=${onTriggerKey}
    >
      ${icon
        ? html`<${Icon} name=${icon} size=${16} />`
        : html`<span class="k-btn__label">${label}</span><${Icon} name="chevron-down" size=${14} />`}
    </button>
    ${open
      ? html`<div class="k-menu__list" role="menu" id=${id} aria-label=${label} ref=${list} onKeyDown=${onListKey}>
          ${entries.map((item) => html`<button
            key=${item.id}
            type="button"
            role="menuitem"
            tabindex="-1"
            class=${cx("k-menu__item", item.danger && "k-menu__item--danger")}
            onClick=${() => pick(item)}
          >
            ${item.icon ? html`<${Icon} name=${item.icon} size=${16} />` : null}
            <span class="k-menu__label">${item.label}</span>
          </button>`)}
        </div>`
      : null}
  </div>`;
}
