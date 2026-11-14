// The difference between two texts: what was approved against what was sent. Words only; every string is text.
import { html } from "../vendor/preact-htm.js";

const CAP = 2000;
const MAX_TOKENS = 400;

// Runs of non-space characters with the white space that follows them.
const tokens = (s) => s.match(/\S+\s*/g) || [];

// [{ t: "same" | "del" | "add", s }] by longest common subsequence over tokens; case-sensitive; neighbouring runs of
// one kind joined; where a removal and an addition meet, the removal comes first. null when either side has more
// than 400 tokens.
export function diffWords(a, b) {
  const x = tokens(String(a ?? "").slice(0, CAP));
  const y = tokens(String(b ?? "").slice(0, CAP));
  if (x.length > MAX_TOKENS || y.length > MAX_TOKENS) return null;
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let del = "", add = "", same = "";
  const flushChange = () => {
    if (del) out.push({ t: "del", s: del });
    if (add) out.push({ t: "add", s: add });
    del = add = "";
  };
  const flushSame = () => {
    if (same) out.push({ t: "same", s: same });
    same = "";
  };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { flushChange(); same += x[i]; i++; j++; }
    else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { flushSame(); del += x[i]; i++; }
    else { flushSame(); add += y[j]; j++; }
  }
  flushChange();
  flushSame();
  return out;
}

// a: what was approved, b: what was sent. labels: { a, b }, the two words of the key line (the caller's).
export function DiffText({ a, b, labels }) {
  const L = labels || {};
  const pieces = diffWords(a, b);
  if (!pieces) {
    return html`<div class="k-diff k-diff--plain">
      <div class="k-diff__block"><p class="k-diff__name">${L.a}</p><p class="k-diff__text">${String(a ?? "").slice(0, CAP)}</p></div>
      <div class="k-diff__block"><p class="k-diff__name">${L.b}</p><p class="k-diff__text">${String(b ?? "").slice(0, CAP)}</p></div>
    </div>`;
  }
  return html`<div class="k-diff">
    <p class="k-diff__key">
      <span><i class="k-diff__swatch k-diff__swatch--del" aria-hidden="true"></i>${L.a}</span>
      <span><i class="k-diff__swatch k-diff__swatch--add" aria-hidden="true"></i>${L.b}</span>
    </p>
    <p class="k-diff__text">${pieces.map((p) => (p.t === "del" ? html`<del class="k-diff__del">${p.s}</del>` : p.t === "add" ? html`<ins class="k-diff__add">${p.s}</ins>` : p.s))}</p>
  </div>`;
}
