import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The page's own guards from the security review (REVIEW-AFS findings 2 and 4) and the money rules of
// PLAN-APPS-ASTRYX, held in its source: the page has no renderer in these tests, so what each screen
// wires up is read from the file.
const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(CLIENT, p), 'utf8');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(CLIENT, dir), { withFileTypes: true })) {
    const p = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...sources(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

test('"Write storyboard again" over kept clips asks first, with how many are dropped', () => {
  const page = read('screens/Storyboard.tsx');
  assert.match(page, /<AlertDialog\b/);
  assert.match(page, /const kept = keptClips\(shots\)/);
  assert.match(page, /onPress=\{\(\) => \(kept > 0 \? setAsking\(true\) : writeAgain\(\)\)\}/);
  assert.match(page, /droppedClipsWords\(kept\)/);
  assert.match(page, /onAction=\{writeAgain\}/);
  assert.match(page, /'Make clip again'/, '"Make clip again" keeps its words');
});

test('every screen of a project offers "Cancel waiting" while any job waits to be sent', () => {
  const strip = read('parts/WaitingStrip.tsx');
  assert.match(strip, /trpc\.project\.cancelWaiting\.useMutation/);
  assert.match(strip, /const n = waitingCount\(project\);\s*if \(n === 0\) return null;/);
  assert.match(strip, /label="Cancel waiting"/);
  const app = read('App.tsx');
  // Drawn once above the screen switch, so no screen is without it.
  assert.match(app, /<WaitingStrip project=\{project\} \/>\s*<\/div>\s*<ErrorBoundary key=\{screen\}/);
});

test('every spending call is behind a SpendButton, and no key or menu reaches one', () => {
  const spending = /\b(image\.enhance|image\.master|shot\.generate)\.useMutation\b/;
  const files = sources('').filter((f) => spending.test(read(f)));
  assert.deepEqual(files.sort(), ['screens/Enhance.tsx', 'screens/Masters.tsx', 'screens/Review.tsx', 'screens/Storyboard.tsx']);
  for (const f of files) assert.match(read(f), /<SpendButton\b/, f);
  for (const f of ['lib/reviewKeys.ts', 'parts/CommandMenu.tsx', 'parts/useSelection.ts', 'parts/ShotTimeline.tsx', 'App.tsx', 'screens/Overview.tsx']) {
    assert.doesNotMatch(read(f), /\b(enhance|master|generate)\.(mutate|mutateAsync)\(/, f);
  }
});

test('a batch sends at most 20, the ids its price was asked for', () => {
  for (const f of ['screens/Enhance.tsx', 'screens/Masters.tsx', 'screens/Storyboard.tsx']) {
    assert.match(read(f), /capForSpend\(/, f);
  }
  const enhance = read('screens/Enhance.tsx');
  assert.match(enhance, /asks=\{sent\.map\(\(i\) => enhanceAsk\(i, model\)\)\}/);
  assert.match(enhance, /imageIds: sent\.map\(\(i\) => i\.id\)/);
  const clips = read('screens/Storyboard.tsx');
  assert.match(clips, /asks=\{sent\.map\(shotAsk\)\}/);
  assert.match(clips, /shotIds: sent\.map\(\(s\) => s\.id\)/);
});

test('a spending button refuses a press while it is held or its call is in flight', () => {
  const money = read('money.tsx');
  assert.match(money, /if \(disabled \|\| loading\) return;\s*onPress\(\);/);
  assert.match(money, /isDisabled=\{disabled\}/);
});

test('batch approve goes one picture at a time and stops at the first refusal, naming it', () => {
  const review = read('screens/Review.tsx');
  assert.match(review, /for \(const image of approvable\) \{[\s\S]*?await decide\.mutateAsync\([\s\S]*?catch \(err\) \{[\s\S]*?\$\{image\.code\} was not approved[\s\S]*?return;/);
});
