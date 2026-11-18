import { useEffect, useState } from 'react';

import {
  ACTIVITY_LABELS,
  ACTIVITY_OPTIONS,
  ADDITION_LABELS,
  ADDITION_OPTIONS,
  ENHANCEMENT_KEYS,
  ENHANCEMENT_LABELS,
  FIDELITY_LABELS,
  FIDELITY_MODES,
  type ImageSettings,
  imageSettingsSchema,
  LIGHTING_LABELS,
  LIGHTING_OPTIONS,
  OUTPUT_LABELS,
  OUTPUT_OPTIONS,
  PEOPLE_LABELS,
  PEOPLE_OPTIONS,
} from '../../shared/project.ts';
import { selectedAdditions } from '../../server/prompts.ts';
import { readable } from '../lib/words.ts';
import { Select } from '../ui/Select.tsx';
import { Switch } from '../ui/Switch.tsx';
import styles from '../Stages.module.css';

/**
 * One image's settings. A choice is saved at once; a typed box when it loses
 * focus. Selective mode shows, in words, what will be added.
 */
export function SettingsPanel({
  idPrefix,
  settings,
  disabled,
  saving,
  error,
  onSave,
}: {
  idPrefix: string;
  settings: ImageSettings;
  disabled: boolean;
  saving: boolean;
  error: string | null;
  onSave: (next: ImageSettings) => void;
}) {
  const [draft, setDraft] = useState<ImageSettings>(settings);
  const [local, setLocal] = useState<string | null>(null);
  const saved = JSON.stringify(settings);
  useEffect(() => setDraft(JSON.parse(saved) as ImageSettings), [saved]);

  const commit = (next: ImageSettings) => {
    setDraft(next);
    const ok = imageSettingsSchema.safeParse(next);
    if (!ok.success) {
      setLocal(readable(ok.error.issues[0]?.message));
      return;
    }
    setLocal(null);
    if (JSON.stringify(next) !== saved) onSave(next);
  };
  const set = <K extends keyof ImageSettings>(k: K, v: ImageSettings[K]) => commit({ ...draft, [k]: v });
  const type = <K extends keyof ImageSettings>(k: K, v: ImageSettings[K]) => setDraft({ ...draft, [k]: v });
  const blur = () => commit(draft);

  const toggle = <T extends string>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const adds = draft.mode === 'selective' ? selectedAdditions(draft) : [];

  return (
    <div className={styles.settings} aria-busy={saving || undefined}>
      <fieldset className={styles.fieldset} disabled={disabled}>
        <legend className={styles.legend}>Mode</legend>
        <div className={styles.radios}>
          {FIDELITY_MODES.map((m) => (
            <label key={m} className={styles.radio}>
              <input type="radio" name={`${idPrefix}-mode`} checked={draft.mode === m} onChange={() => set('mode', m)} />
              {FIDELITY_LABELS[m]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.fieldRow}>
        <Select
          label="Lighting"
          value={draft.lighting}
          disabled={disabled}
          showHint={false}
          options={LIGHTING_OPTIONS.map((o) => ({ id: o, name: LIGHTING_LABELS[o] }))}
          onChange={(v) => set('lighting', v as ImageSettings['lighting'])}
        />
        {draft.lighting === 'custom' && (
          <label className={styles.textBox}>
            <span className={styles.fieldLabel}>Custom lighting</span>
            <input
              className={styles.input}
              value={draft.lightingCustom}
              maxLength={400}
              disabled={disabled}
              onChange={(e) => type('lightingCustom', e.target.value)}
              onBlur={blur}
            />
          </label>
        )}
      </div>

      {draft.mode === 'selective' && (
        <>
          <Checks
            legend="People"
            name={`${idPrefix}-people`}
            options={PEOPLE_OPTIONS}
            labels={PEOPLE_LABELS}
            value={draft.people}
            disabled={disabled}
            onToggle={(v) => set('people', toggle(draft.people, v))}
          />
          {draft.people.includes('custom') && (
            <TextBox label="Custom people" value={draft.peopleCustom} disabled={disabled} onChange={(v) => type('peopleCustom', v)} onBlur={blur} />
          )}
          <Checks
            legend="Activities"
            name={`${idPrefix}-activities`}
            options={ACTIVITY_OPTIONS}
            labels={ACTIVITY_LABELS}
            value={draft.activities}
            disabled={disabled}
            onToggle={(v) => set('activities', toggle(draft.activities, v))}
          />
          {draft.activities.includes('custom') && (
            <TextBox label="Custom activity" value={draft.activitiesCustom} disabled={disabled} onChange={(v) => type('activitiesCustom', v)} onBlur={blur} />
          )}
          <Checks
            legend="Additions"
            name={`${idPrefix}-additions`}
            options={ADDITION_OPTIONS}
            labels={ADDITION_LABELS}
            value={draft.additions}
            disabled={disabled}
            onToggle={(v) => set('additions', toggle(draft.additions, v))}
          />
          {draft.additions.includes('other') && (
            <TextBox label="Other addition" value={draft.additionsOther} disabled={disabled} onChange={(v) => type('additionsOther', v)} onBlur={blur} />
          )}
          <p className={styles.adds} role="status">
            {adds.length > 0 ? `Will add: ${adds.join('; ')}.` : 'Nothing will be added yet. Pick people, activities or additions.'}
          </p>
        </>
      )}

      <fieldset className={styles.fieldset} disabled={disabled}>
        <legend className={styles.legend}>Enhancements</legend>
        <div className={styles.switches}>
          {ENHANCEMENT_KEYS.map((k) => (
            <Switch
              key={k}
              label={ENHANCEMENT_LABELS[k]}
              checked={draft.enhancements[k] === true}
              disabled={disabled}
              onChange={(on) => set('enhancements', { ...draft.enhancements, [k]: on })}
            />
          ))}
        </div>
      </fieldset>

      <div className={styles.fieldRow}>
        <Select
          label="Output"
          value={draft.output}
          disabled={disabled}
          showHint={false}
          options={OUTPUT_OPTIONS.map((o) => ({ id: o, name: OUTPUT_LABELS[o] }))}
          onChange={(v) => set('output', v as ImageSettings['output'])}
        />
        {draft.output === 'custom' && (
          <label className={styles.textBox}>
            <span className={styles.fieldLabel}>Long edge, px</span>
            <input
              className={styles.input}
              type="number"
              inputMode="numeric"
              min={1024}
              max={8192}
              step={1}
              value={Number.isFinite(draft.customLongEdge) ? draft.customLongEdge : ''}
              disabled={disabled}
              onChange={(e) => type('customLongEdge', e.target.value === '' ? Number.NaN : Math.round(Number(e.target.value)))}
              onBlur={blur}
            />
          </label>
        )}
      </div>

      {(local || error) && (
        <p className={styles.error} role="alert">
          {local ?? error}
        </p>
      )}
    </div>
  );
}

function Checks<T extends string>({
  legend,
  name,
  options,
  labels,
  value,
  disabled,
  onToggle,
}: {
  legend: string;
  name: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T[];
  disabled: boolean;
  onToggle: (v: T) => void;
}) {
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.checks}>
        {options.map((o) => (
          <label key={o} className={styles.check}>
            <input type="checkbox" name={name} checked={value.includes(o)} onChange={() => onToggle(o)} />
            {labels[o]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TextBox({
  label,
  value,
  disabled,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <label className={styles.textBox}>
      <span className={styles.fieldLabel}>{label}</span>
      <input className={styles.input} value={value} maxLength={400} disabled={disabled} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </label>
  );
}
