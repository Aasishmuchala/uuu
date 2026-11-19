import { LayoutGrid, Grid3x3, Search } from 'lucide-react';

import { lookLabel } from '../../looks.ts';
import { imageModelName, IMAGE_MODELS, videoModelName } from '../../models.ts';
import { Button, SegmentedControl, SegmentedControlItem, Switch, Text, TextInput, Token } from '../kit.ts';
import { isFiltering, NO_FILTER, type LibraryFilter } from '../lib/libraryFilter.ts';
import { OptionSelect } from './OptionSelect.tsx';
import styles from './FilterBar.module.css';

export type FilterBarProps = {
  value: LibraryFilter;
  onChange: (f: LibraryFilter) => void;
  models: readonly string[];
  looks: readonly string[];
  tags: ReadonlyArray<{ tag: string; count: number; own: boolean }>;
  density: 'large' | 'small';
  onDensity: (d: 'large' | 'small') => void;
  shown: number;
  total: number;
};

const ALL = '';

function modelName(id: string): string {
  return IMAGE_MODELS.some((m) => m.id === id) ? imageModelName(id) : videoModelName(id);
}

/** The Library's filters: kind, model, look, tag, favourites only, and search. */
export function FilterBar({ value, onChange, models, looks, tags, density, onDensity, shown, total }: FilterBarProps) {
  const set = (patch: Partial<LibraryFilter>) => onChange({ ...value, ...patch });
  const filtering = isFiltering(value);
  const tagChoices = tags.filter((t) => !value.tags.includes(t.tag));
  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <div className={styles.search}>
          <TextInput
            type="search"
            label="Search the library"
            isLabelHidden
            placeholder="Search, or type @tag"
            value={value.text}
            onChange={(text: string) => set({ text })}
            startIcon={Search}
            hasClear
            size="sm"
            width="100%"
          />
        </div>
        <SegmentedControl label="Show" value={value.kind} onChange={(kind: string) => set({ kind: kind as LibraryFilter['kind'] })} size="sm">
          <SegmentedControlItem value="all" label="All" />
          <SegmentedControlItem value="still" label="Images" />
          <SegmentedControlItem value="clip" label="Videos" />
        </SegmentedControl>
        <div className={styles.select}>
          <OptionSelect
            label="Model"
            labelHidden
            size="sm"
            showHint={false}
            options={[{ id: ALL, name: 'Every model' }, ...models.map((m) => ({ id: m, name: modelName(m) }))]}
            value={value.model}
            onChange={(model) => set({ model })}
          />
        </div>
        <div className={styles.select}>
          <OptionSelect
            label="Look"
            labelHidden
            size="sm"
            showHint={false}
            options={[{ id: ALL, name: 'Every look' }, ...looks.map((l) => ({ id: l, name: lookLabel(l) }))]}
            value={value.look}
            onChange={(look) => set({ look })}
          />
        </div>
        <div className={styles.select}>
          <OptionSelect
            label="Tag"
            labelHidden
            size="sm"
            showHint={false}
            placeholder="Filter by tag"
            options={tagChoices.map((t) => ({ id: t.tag, name: `@${t.tag}`, hint: `${t.count} ${t.count === 1 ? 'item' : 'items'}`, group: t.own ? 'Your tags' : 'Made with' }))}
            value=""
            onChange={(tag) => tag && set({ tags: [...value.tags, tag] })}
            disabled={tagChoices.length === 0}
            disabledMessage="No more tags to filter by."
          />
        </div>
        <Switch label="Favourites only" value={value.favouritesOnly} onChange={(on: boolean) => set({ favouritesOnly: on })} size="sm" />
        <div className={styles.end}>
          <SegmentedControl label="Picture size" value={density} onChange={(d: string) => onDensity(d === 'small' ? 'small' : 'large')} size="sm">
            <SegmentedControlItem value="large" label="Large" isLabelHidden icon={<LayoutGrid size={14} />} />
            <SegmentedControlItem value="small" label="Small" isLabelHidden icon={<Grid3x3 size={14} />} />
          </SegmentedControl>
        </div>
      </div>
      <div className={styles.row}>
        <Text type="supporting" hasTabularNumbers>
          {filtering ? `${shown} of ${total} ${total === 1 ? 'item' : 'items'}` : `${total} ${total === 1 ? 'item' : 'items'}`}
        </Text>
        {value.tags.map((t) => (
          <Token
            key={t}
            label={`@${t}`}
            size="sm"
            onRemove={() => set({ tags: value.tags.filter((x) => x !== t) })}
          />
        ))}
        {filtering && <Button label="Clear filters" variant="ghost" size="sm" onClick={() => onChange(NO_FILTER)} />}
      </div>
    </div>
  );
}
