import { Selector } from '../kit.ts';

/** One choice of the app's own option lists (looks.ts, models.ts). */
export type Option = { id: string; name: string; hint?: string | undefined; group?: string | undefined };

export type OptionSelectProps = {
  label: string;
  options: readonly Option[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean | undefined;
  /** Why it is held, shown on hover and focus. */
  disabledMessage?: string | undefined;
  /** The chosen option's hint under the label. */
  showHint?: boolean | undefined;
  /** Hide the visible label (a toolbar or filter bar names it otherwise). */
  labelHidden?: boolean | undefined;
  placeholder?: string | undefined;
  size?: 'sm' | 'md' | undefined;
};

/** The kit's selector over the app's `{ id, name, hint, group }` lists; groups become sections. */
export function OptionSelect({
  label,
  options,
  value,
  onChange,
  disabled = false,
  disabledMessage,
  showHint = true,
  labelHidden = false,
  placeholder,
  size = 'md',
}: OptionSelectProps) {
  const groups: { title: string; options: Option[] }[] = [];
  for (const o of options) {
    const title = o.group ?? '';
    let g = groups.find((x) => x.title === title);
    if (!g) groups.push((g = { title, options: [] }));
    g.options.push(o);
  }
  const row = (o: Option) => ({ value: o.id, label: o.name, ...(o.hint ? { description: o.hint } : {}) });
  const items =
    groups.length > 1
      ? groups.map((g) => ({ type: 'section', title: g.title || 'Other', options: g.options.map(row) }))
      : options.map(row);
  const current = options.find((o) => o.id === value);
  return (
    <Selector
      label={label}
      isLabelHidden={labelHidden}
      options={items}
      value={value}
      onChange={(v: string | null) => {
        if (v != null) onChange(String(v));
      }}
      isDisabled={disabled}
      disabledMessage={disabled ? disabledMessage : undefined}
      description={showHint && current?.hint ? current.hint : undefined}
      placeholder={placeholder}
      size={size}
      width="100%"
      hasSearch={options.length > 12}
    />
  );
}
