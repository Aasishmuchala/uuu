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
import { NumberInput, SegmentedControl, SegmentedControlItem, Selector, Switch, Text, TextInput, ToggleButton } from '../kit.ts';
import { readable } from '../lib/words.ts';
import styles from './SettingsForm.module.css';

/**
 * A picture's settings. A choice is saved at once; typed words when the field
 * loses focus. Selective mode says, in words, what will be added.
 */
export function SettingsForm({
  settings,
  disabled,
  disabledWhy,
  saving,
  error,
  onSave,
}: {
  settings: ImageSettings;
  disabled: boolean;
  disabledWhy?: string | null | undefined;
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
  const why = disabled ? (disabledWhy ?? undefined) : undefined;

  return (
    <div className={styles.form} aria-busy={saving || undefined}>
      <div className={styles.field}>
        <Text type="label" as="div">
          Mode
        </Text>
        <SegmentedControl label="Mode" value={draft.mode} onChange={(v: string) => set('mode', v as ImageSettings['mode'])} layout="fill" size="sm" isDisabled={disabled} disabledMessage={why}>
          {FIDELITY_MODES.map((m) => (
            <SegmentedControlItem key={m} value={m} label={FIDELITY_LABELS[m]} />
          ))}
        </SegmentedControl>
        <Text type="supporting" color="secondary" as="p">
          {draft.mode === 'strict' ? 'Changes nothing but photographic quality.' : 'Adds only what you pick below.'}
        </Text>
      </div>

      <Selector
        label="Lighting"
        value={draft.lighting}
        options={LIGHTING_OPTIONS.map((o) => ({ value: o, label: LIGHTING_LABELS[o] }))}
        onChange={(v: string) => set('lighting', v as ImageSettings['lighting'])}
        isDisabled={disabled}
        disabledMessage={why}
        width="100%"
        size="sm"
      />
      {draft.lighting === 'custom' && (
        <div onBlur={blur}>
          <TextInput label="Custom lighting" value={draft.lightingCustom} onChange={(v: string) => type('lightingCustom', v)} onEnter={blur} isDisabled={disabled} size="sm" />
        </div>
      )}

      {draft.mode === 'selective' && (
        <>
          <Checks
            legend="People"
            options={PEOPLE_OPTIONS}
            labels={PEOPLE_LABELS}
            value={draft.people}
            disabled={disabled}
            onToggle={(v) => set('people', toggle(draft.people, v))}
          />
          {draft.people.includes('custom') && (
            <div onBlur={blur}>
              <TextInput label="Custom people" value={draft.peopleCustom} onChange={(v: string) => type('peopleCustom', v)} onEnter={blur} isDisabled={disabled} size="sm" />
            </div>
          )}
          <Checks
            legend="Activities"
            options={ACTIVITY_OPTIONS}
            labels={ACTIVITY_LABELS}
            value={draft.activities}
            disabled={disabled}
            onToggle={(v) => set('activities', toggle(draft.activities, v))}
          />
          {draft.activities.includes('custom') && (
            <div onBlur={blur}>
              <TextInput label="Custom activity" value={draft.activitiesCustom} onChange={(v: string) => type('activitiesCustom', v)} onEnter={blur} isDisabled={disabled} size="sm" />
            </div>
          )}
          <Checks
            legend="Additions"
            options={ADDITION_OPTIONS}
            labels={ADDITION_LABELS}
            value={draft.additions}
            disabled={disabled}
            onToggle={(v) => set('additions', toggle(draft.additions, v))}
          />
          {draft.additions.includes('other') && (
            <div onBlur={blur}>
              <TextInput label="Other addition" value={draft.additionsOther} onChange={(v: string) => type('additionsOther', v)} onEnter={blur} isDisabled={disabled} size="sm" />
            </div>
          )}
          <p className={styles.adds} role="status">
            {adds.length > 0 ? `Will add: ${adds.join('; ')}.` : 'Nothing will be added yet. Pick people, activities or additions.'}
          </p>
        </>
      )}

      <fieldset className={styles.group} disabled={disabled}>
        <legend className={styles.legend}>Enhancements</legend>
        <div className={styles.switches}>
          {ENHANCEMENT_KEYS.map((k) => (
            <Switch
              key={k}
              label={ENHANCEMENT_LABELS[k]}
              value={draft.enhancements[k] === true}
              onChange={(on: boolean) => set('enhancements', { ...draft.enhancements, [k]: on })}
              isDisabled={disabled}
              size="sm"
              labelPosition="start"
              labelSpacing="spread"
              width="100%"
            />
          ))}
        </div>
      </fieldset>

      <Selector
        label="Output size"
        value={draft.output}
        options={OUTPUT_OPTIONS.map((o) => ({ value: o, label: OUTPUT_LABELS[o] }))}
        onChange={(v: string) => set('output', v as ImageSettings['output'])}
        isDisabled={disabled}
        disabledMessage={why}
        width="100%"
        size="sm"
      />
      {draft.output === 'custom' && (
        <NumberInput
          label="Long edge"
          units="px"
          value={Number.isFinite(draft.customLongEdge) ? draft.customLongEdge : null}
          min={1024}
          max={8192}
          step={1}
          isIntegerOnly
          isDisabled={disabled}
          size="sm"
          onChange={(v: number | null) => commit({ ...draft, customLongEdge: typeof v === 'number' ? Math.round(v) : Number.NaN })}
        />
      )}

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
  options,
  labels,
  value,
  disabled,
  onToggle,
}: {
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T[];
  disabled: boolean;
  onToggle: (v: T) => void;
}) {
  return (
    <fieldset className={styles.group} disabled={disabled}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.checks}>
        {options.map((o) => (
          <ToggleButton key={o} label={labels[o]} isPressed={value.includes(o)} onPressedChange={() => onToggle(o)} isDisabled={disabled} size="sm" />
        ))}
      </div>
    </fieldset>
  );
}
