// The Checker's scores (CONTRACTS-V3 36.3): the start of a scored review's reason, in the form
// `scores: <slug> 9, <slug> 7;`. Pure. Only the numbers and the slugs are read; nothing else of the text.
//
// scoresOf(reason) -> [{ slug, score }] for exactly what the pinned pattern
//   ^scores:\s*((?:[a-z0-9-]{1,40} (?:10|[0-9])(?:, )?)+);
// matches, at most 20 kept; anything else gives []. The pattern itself is not run: "10" can be read as a
// score or as "1" followed by a slug starting "0", so a regular expression may try very many ways on a
// long text that does not match. The walk below tries the same ways in the same order (a score of 10
// before 1), remembers every place it has already found to lead nowhere, and so reads any text in
// linear time.

export const MAX_SCORES = 20;
const MAX_SLUG = 40;

// a-z, 0-9 and "-" by character code
const isSlugCode = (c) => (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45;
const isDigitCode = (c) => c >= 48 && c <= 57;
const SEMI = 59;

// The end of the slug that starts at p (the space after it), or -1 when no item can start at p.
function slugEnd(s, p) {
  let q = p;
  while (q < s.length && q - p <= MAX_SLUG && isSlugCode(s.charCodeAt(q))) q += 1;
  return q === p || q - p > MAX_SLUG || s.charCodeAt(q) !== 32 ? -1 : q;
}

// After the score that ends at `end`: the place the next item or the ";" must be, past an optional ", ".
const afterScore = (s, end) => (s.charCodeAt(end) === 44 && s.charCodeAt(end + 1) === 32 ? end + 2 : end);

export function scoresOf(reason) {
  if (typeof reason !== "string" || !reason.startsWith("scores:") || !reason.includes(";")) return [];
  const s = reason;
  let p = "scores:".length;
  while (p < s.length && /\s/.test(s[p])) p += 1;
  // A walk with a stack of items: for each, where it starts, where its slug ends and which way of reading
  // its score is being tried (0: "10", 1: one digit, 2: none left).
  const starts = [];
  const ends = [];
  const ways = [];
  const dead = new Set();               // item starts known to lead nowhere
  const push = (at) => {
    const q = slugEnd(s, at);
    if (q < 0) { dead.add(at); return; }
    starts.push(at); ends.push(q); ways.push(0);
  };
  push(p);
  while (starts.length) {
    const top = starts.length - 1;
    const q = ends[top];
    const way = ways[top];
    let scoreEnd = -1;
    if (way === 0) {
      ways[top] = 1;
      if (s.charCodeAt(q + 1) === 49 && s.charCodeAt(q + 2) === 48) scoreEnd = q + 3;
      else continue;
    } else if (way === 1) {
      ways[top] = 2;
      if (isDigitCode(s.charCodeAt(q + 1))) scoreEnd = q + 2;
      else continue;
    } else {
      dead.add(starts[top]);
      starts.pop(); ends.pop(); ways.pop();
      continue;
    }
    const next = afterScore(s, scoreEnd);
    const c = s.charCodeAt(next);
    if (c === SEMI) {
      const out = [];
      for (let i = 0; i < starts.length && i < MAX_SCORES; i += 1) {
        const slug = s.slice(starts[i], ends[i]);
        out.push({ slug, score: ways[i] === 1 ? 10 : Number(s[ends[i] + 1]) });
      }
      return out;
    }
    if (isSlugCode(c) && !dead.has(next)) push(next);
  }
  return [];
}
