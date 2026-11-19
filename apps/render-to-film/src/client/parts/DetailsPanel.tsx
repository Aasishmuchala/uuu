import { Clapperboard, Download, Maximize2, RotateCcw, Scissors, Trash2 } from 'lucide-react';
import { useState, type CSSProperties } from 'react';

import { ANGLES, CROWDS, lookLabel, litFromReference } from '../../looks.ts';
import {
  imageModelName,
  imageResolutionName,
  motionLabel,
  upscalerName,
  videoModelName,
  videoResolutionName,
} from '../../models.ts';
import { MAX_TAGS, normalizeTag } from '../../tags.ts';
import {
  Banner,
  Button,
  Heading,
  IconButton,
  MetadataList,
  MetadataListItem,
  Text,
  TextInput,
  Token,
} from '../kit.ts';
import { isFavourite, visibleTags } from '../lib/favourites.ts';
import type { LibraryItem } from '../lib/libraryFilter.ts';
import { formatDate, fileSlug } from '../lib/titles.ts';
import { libraryUrl, stillThumbUrl, stillViewUrl } from '../lib/urls.ts';
import { useDownload } from '../lib/download.ts';
import { StarButton } from './StarButton.tsx';
import { useTagSaver } from './useTags.ts';
import styles from './DetailsPanel.module.css';

export type DetailsPanelProps = {
  item: LibraryItem;
  /** Opens the picture or clip large. */
  onView: () => void;
  /** Fills Stills or Video with how this was made; nothing is sent. */
  onReuse: () => void;
  /** A still: open Video with it picked. */
  onAnimate?: (() => void) | undefined;
  /** A clip: open Edit. */
  onOpenInEdit?: (() => void) | undefined;
  onDelete: () => void;
  /** A click on an automatic tag filters the Library by it. */
  onTag?: ((tag: string) => void) | undefined;
};

/** The inspector beside the Library: the picture, how it was made, its tags and what to do with it. */
export function DetailsPanel({ item, onView, onReuse, onAnimate, onOpenInEdit, onDelete, onTag }: DetailsPanelProps) {
  const saver = useDownload();
  const filename =
    item.kind === 'still' ? `film-still-${fileSlug(item.title)}.png` : `film-clip-${fileSlug(item.title)}.mp4`;
  const poster = item.kind === 'still' ? stillViewUrl(item.id) : item.still ? stillThumbUrl(item.still.id) : undefined;
  return (
    <div className={styles.panel}>
      <button
        type="button"
        className={styles.preview}
        style={{ '--r': item.ratio } as CSSProperties}
        onClick={onView}
        aria-label={`View ${item.title} large`}
        disabled={item.pending}
      >
        {item.kind === 'clip' && !item.pending ? (
          <video src={libraryUrl('clip', item.id)} poster={poster} muted loop playsInline preload="metadata" aria-hidden tabIndex={-1} />
        ) : (
          poster && !item.pending && <img src={poster} alt="" />
        )}
      </button>

      <div className={styles.head}>
        <div className={styles.titles}>
          <Heading level={3} maxLines={2}>
            {item.title}
          </Heading>
          <Text type="supporting">{item.detail}</Text>
        </div>
        {!item.pending && (
          <div className={styles.icons}>
            <StarButton kind={item.kind} id={item.id} />
            <IconButton
              label={saver.pending ? saver.label('Download') : 'Download'}
              tooltip={saver.pending ? saver.label('Download') : 'Download'}
              size="sm"
              variant="ghost"
              isLoading={saver.pending}
              icon={<Download size={16} />}
              onClick={() => saver.start(libraryUrl(item.kind, item.id), filename)}
            />
            <IconButton label="Delete" tooltip="Delete" size="sm" variant="ghost" icon={<Trash2 size={16} />} onClick={onDelete} />
          </div>
        )}
      </div>

      {!item.pending && (
        <div className={styles.actions}>
          <Button label="Reuse settings" variant="primary" size="sm" icon={<RotateCcw size={14} />} onClick={onReuse} />
          {onAnimate && <Button label="Animate" size="sm" icon={<Clapperboard size={14} />} onClick={onAnimate} />}
          {onOpenInEdit && <Button label="Open in Edit" size="sm" icon={<Scissors size={14} />} onClick={onOpenInEdit} />}
          <IconButton label="View large" tooltip="View large (F)" size="sm" variant="ghost" icon={<Maximize2 size={16} />} onClick={onView} />
        </div>
      )}
      {saver.error && <Banner status="error" title="The download did not finish" description={saver.error} />}
      {item.pending && (
        <Text type="supporting" as="p">
          Still being made. It lands here when it is ready.
        </Text>
      )}

      <MetadataList label={{ position: 'start', width: 104 }}>
        {madeWith(item).map(([label, value]) => (
          <MetadataListItem key={label} label={label}>
            <Text>{value}</Text>
          </MetadataListItem>
        ))}
      </MetadataList>

      {(item.kind === 'still' ? item.still.direction : item.clip.direction).trim() && (
        <section className={styles.section}>
          <Heading level={4}>Direction</Heading>
          <Text as="p">{item.kind === 'still' ? item.still.direction : item.clip.direction}</Text>
        </section>
      )}

      <TagEditor item={item} onTag={onTag} />
    </div>
  );
}

function madeWith(item: LibraryItem): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (item.kind === 'still') {
    const s = item.still;
    const res = imageResolutionName(s.imageModel, s.resolution);
    rows.push(['Model', `${imageModelName(s.imageModel)}${res ? `, ${res}` : ''}`]);
    if (!s.location && !s.surroundings) rows.push(['Look', lookLabel(s.look, litFromReference(s))]);
    if (s.aspectRatio) rows.push(['Shape', s.aspectRatio]);
    const angle = ANGLES.find((a) => a.id === s.angle);
    if (angle && s.angle !== 'as-rendered') rows.push(['Camera', angle.name]);
    if (s.crowd !== 'none') rows.push(['People', CROWDS.find((c) => c.id === s.crowd)?.name ?? s.crowd]);
    if (s.upscaleOf) rows.push(['Upscaled', `${s.scale ?? ''}× with ${upscalerName(s.upscaler)}`]);
    if (s.maskKey) rows.push(['Edit', 'Only a marked area changed']);
    rows.push(['Size', `${s.width} × ${s.height} px render`]);
  } else {
    const c = item.clip;
    const res = videoResolutionName(c.videoModel, c.resolution);
    rows.push(['Model', `${videoModelName(c.videoModel)}${res ? `, ${res}` : ''}`]);
    rows.push(['Camera', motionLabel(c.motion, c.moveStyle, c.speed)]);
    if (c.seconds) rows.push(['Length', `${c.seconds} seconds`]);
    if (c.frameCount && c.frameCount > 1) rows.push(['Frames', `${c.frameCount} frames`]);
    if (c.refCount) rows.push(['Extra images', String(c.refCount)]);
    if (c.upscaleOf) rows.push(['Upscaled', `${c.scale ?? ''}× with ${upscalerName(c.upscaler)}`]);
  }
  rows.push(['Made', formatDate(item.createdAt)]);
  return rows;
}

/** The owner's own tags (the star's hidden), added with Enter, removed with a click. */
function TagEditor({ item, onTag }: { item: LibraryItem; onTag?: ((tag: string) => void) | undefined }) {
  const save = useTagSaver();
  const [draft, setDraft] = useState('');
  const own = visibleTags(item.tags);
  const starred = isFavourite(item);
  const room = MAX_TAGS - own.length - (starred ? 1 : 0);
  const commit = (tags: string[]) =>
    save.mutate({ kind: item.kind, id: item.id, tags: starred ? [...tags, 'favourite'] : tags });
  const add = () => {
    const tag = normalizeTag(draft);
    setDraft('');
    if (!tag || own.includes(tag) || tag === 'favourite' || room <= 0) return;
    commit([...own, tag]);
  };
  return (
    <section className={styles.section}>
      <Heading level={4}>Tags</Heading>
      {own.length > 0 && (
        <div className={styles.tokens}>
          {own.map((t) => (
            <Token key={t} label={`@${t}`} size="sm" onRemove={() => commit(own.filter((x) => x !== t))} />
          ))}
        </div>
      )}
      <TextInput
        label="Add a tag"
        isLabelHidden
        size="sm"
        placeholder={room > 0 ? 'Add a tag, then press Enter' : `This has ${MAX_TAGS} tags. Remove one to add another.`}
        value={draft}
        onChange={setDraft}
        onEnter={add}
        isDisabled={room <= 0 || item.pending}
      />
      {save.error && (
        <Text type="supporting" as="p">
          The tags could not be saved: {save.error.message}
        </Text>
      )}
      {item.auto.length > 0 && (
        <div className={styles.tokens} aria-label="Made with">
          {item.auto.map((t) => (
            <Token key={t} label={`@${t}`} size="sm" color="gray" onClick={onTag ? () => onTag(t) : undefined} description={`Show everything tagged @${t}`} />
          ))}
        </div>
      )}
    </section>
  );
}
