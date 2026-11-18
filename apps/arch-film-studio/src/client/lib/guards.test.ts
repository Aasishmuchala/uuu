import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The page's own guards from the security review (REVIEW-AFS findings 2 and 4), held in its source: the
// page has no renderer in these tests, so what each screen wires up is read from the file.
const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(CLIENT, p), 'utf8');

test('"Write storyboard again" over kept clips asks first, with how many are dropped', () => {
  const page = read('stages/StoryboardStage.tsx');
  assert.match(page, /<ConfirmDialog\b/);
  assert.match(page, /const kept = keptClips\(shots\)/);
  assert.match(page, /onPress=\{\(\) => \(kept > 0 \? setAsking\(true\) : writeAgain\(\)\)\}/);
  assert.match(page, /\{droppedClipsWords\(kept\)\}/);
  assert.match(page, /onConfirm=\{writeAgain\}/);
});

test('the project page offers "Cancel waiting" while any job waits to be sent', () => {
  const app = read('App.tsx');
  assert.match(app, /trpc\.project\.cancelWaiting\.useMutation/);
  assert.match(app, /const n = waitingCount\(project\);\s*if \(n === 0\) return null;/);
  assert.match(app, />\s*Cancel waiting\s*</);
  assert.match(app, /<Waiting project=\{p\} \/>/);
});
