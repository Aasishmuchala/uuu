// Form controls. A Field gives its label, hint and error to the control inside it (TextInput, TextArea, Select).
import { createContext, html, useContext, useLayoutEffect, useRef, useState } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";
import { cx, nextId } from "./util.js";

const FieldContext = createContext(null);

const errorText = (error) => (typeof error === "string" ? error : error && error.message ? String(error.message) : "");

export function Field({ label, hint, error, children }) {
  const [id] = useState(() => nextId("k-field"));
  const message = errorText(error);
  const hintId = hint ? `${id}-hint` : null;
  const errorId = message ? `${id}-error` : null;
  const ctx = { id, describedBy: cx(hintId, errorId) || undefined, invalid: Boolean(error) };
  return html`<div class=${cx("k-field", error && "k-field--error")}>
    ${label ? html`<label class="k-field__label" for=${id}>${label}</label>` : null}
    <${FieldContext.Provider} value=${ctx}>${children}<//>
    ${hint ? html`<p class="k-field__hint" id=${hintId}>${hint}</p>` : null}
    ${message ? html`<p class="k-field__error" id=${errorId}><${Icon} name="alert" size=${14} /><span>${message}</span></p>` : null}
  </div>`;
}

// The control's own props win over what the Field supplies.
function useFieldProps({ class: _drop, ...props }) {
  const ctx = useContext(FieldContext);
  if (!ctx) return props;
  return {
    id: ctx.id,
    "aria-describedby": ctx.describedBy,
    "aria-invalid": ctx.invalid ? "true" : undefined,
    ...props,
  };
}

export function TextInput(props) {
  const p = useFieldProps(props);
  return html`<input type="text" ...${p} class=${cx("k-input", props.class)} />`;
}

// `autoGrow` makes it as tall as its text (up to a limit set in the stylesheet).
export function TextArea({ autoGrow, ...props }) {
  const ref = useRef(null);
  const p = useFieldProps(props);
  const grow = () => {
    const el = ref.current;
    if (!autoGrow || !el || typeof el.scrollHeight !== "number") return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  useLayoutEffect(grow, [props.value, autoGrow]);
  const onInput = (event) => {
    grow();
    if (props.onInput) props.onInput(event);
  };
  return html`<textarea
    rows=${3}
    ...${p}
    ref=${ref}
    class=${cx("k-textarea", autoGrow && "k-textarea--grow", props.class)}
    onInput=${onInput}
  ></textarea>`;
}

export function Select({ options, ...props }) {
  const p = useFieldProps(props);
  const list = Array.isArray(options) ? options : [];
  return html`<span class=${cx("k-select", props.class)}>
    <select ...${p} class="k-select__control">
      ${list.map((o) => html`<option key=${o.value} value=${o.value} disabled=${o.disabled}>${o.label ?? o.value}</option>`)}
    </select>
    <${Icon} name="chevron-down" size=${16} class="k-select__chevron" />
  </span>`;
}

// An on/off switch with its label, the word On or Off, and an optional explanation under it.
// `onChange(nextOn)` is called on a click. A disabled switch stays reachable so its explanation can be read.
export function Switch({ on, disabled, label, explain, onChange }) {
  const [id] = useState(() => nextId("k-switch"));
  const isOn = Boolean(on);
  const click = () => {
    if (!disabled && onChange) onChange(!isOn);
  };
  return html`<div class=${cx("k-switch", isOn && "k-switch--on", disabled && "k-switch--disabled")}>
    <button
      type="button"
      role="switch"
      class="k-switch__control"
      aria-checked=${isOn ? "true" : "false"}
      aria-disabled=${disabled ? "true" : undefined}
      aria-describedby=${explain ? `${id}-explain` : undefined}
      onClick=${click}
    >
      <span class="k-switch__label">${label}</span>
      <span class="k-switch__state" aria-hidden="true">${isOn ? "On" : "Off"}</span>
      <span class="k-switch__track" aria-hidden="true"><span class="k-switch__thumb"></span></span>
    </button>
    ${explain ? html`<p class="k-switch__explain" id=${`${id}-explain`}>${explain}</p>` : null}
  </div>`;
}
