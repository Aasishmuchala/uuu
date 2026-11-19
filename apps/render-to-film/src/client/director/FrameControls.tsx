import { useMemo } from 'react';

import { ANGLES, type AngleId, CROWDS, type CrowdId, LOOKS, type LookId } from '../../looks.ts';
import type { FrameChoice, FramePlan } from '../../storyboard-api.ts';
import { TextInput } from '../kit.ts';
import { OptionSelect } from '../parts/OptionSelect.tsx';
import { BenchGroup, Note } from '../parts/Workbench.tsx';
import { withPick } from './shared.ts';

const NOTE_MAX = 400;

export type FrameControlsProps = {
  frame: FramePlan;
  choice: FrameChoice | undefined;
  disabled: boolean;
  onChoose: (image: number, patch: FrameChoice) => void;
};

/**
 * One frame's light, camera, people and direction, the planner's pick first in each. Pressing
 * Enter in the direction field does not shoot: shooting spends, so it takes the priced button.
 */
export function FrameControls({ frame, choice, disabled, onChoose }: FrameControlsProps) {
  const look = choice?.look ?? frame.look;
  // Like Stills: the image's own camera unless a move is picked.
  const angle = choice?.angle ?? 'as-rendered';
  const crowd = choice?.crowd ?? frame.crowd;
  const note = choice?.note ?? '';
  const lookOptions = useMemo(() => withPick(LOOKS, frame.look, frame.lookWhy, 'All lighting'), [frame.look, frame.lookWhy]);
  const crowdOptions = useMemo(() => withPick(CROWDS, frame.crowd, frame.crowdWhy, 'All people'), [frame.crowd, frame.crowdWhy]);
  return (
    <>
      <BenchGroup title="Lighting" description="The planner's pick for this moment of the story comes first.">
        <OptionSelect
          label="Lighting"
          labelHidden
          options={lookOptions}
          value={look}
          onChange={(id) => onChoose(frame.image, { look: id as LookId })}
          disabled={disabled}
        />
      </BenchGroup>
      <BenchGroup title="Camera" description="Small moves around the image's own viewpoint.">
        <OptionSelect
          label="Camera"
          labelHidden
          options={ANGLES}
          value={angle}
          onChange={(id) => onChoose(frame.image, { angle: id as AngleId })}
          disabled={disabled}
        />
      </BenchGroup>
      <BenchGroup title="People">
        <OptionSelect
          label="People"
          labelHidden
          options={crowdOptions}
          value={crowd}
          onChange={(id) => onChoose(frame.image, { crowd: id as CrowdId })}
          disabled={disabled}
        />
        {crowd !== 'none' && crowd === frame.crowd && frame.people && (
          <Note>Who: {frame.people}. Always real, photographed people.</Note>
        )}
      </BenchGroup>
      <BenchGroup title="Direction" description="Optional. Anything this frame should keep or change.">
        <TextInput
          label="Direction"
          isLabelHidden
          value={note}
          onChange={(v: string) => onChoose(frame.image, { note: v.slice(0, NOTE_MAX) })}
          isDisabled={disabled}
          placeholder="For example: keep the pool empty, a softer sky"
          width="100%"
        />
      </BenchGroup>
    </>
  );
}
