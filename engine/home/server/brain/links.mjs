// Links from files (brain plan B5): which known names a passage mentions. Pure; no file, no database.
// A mention is the alias as whole words, any letter case, spaces in the alias matching any run of white space.
// No pattern is built from an alias: the text and the alias are squeezed and compared with indexOf, so a
// hostile alias or passage cannot make the matcher slow.

export const MAX_ALIASES = 5000;
export const MAX_ENTITIES_PER_PASSAGE = 20;
export const MIN_ALIAS_LENGTH = 3;

const WORD = /[\p{L}\p{N}]/u;

function squeeze(s) {
  return String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function isWordAt(s, i) {
  if (i < 0 || i >= s.length) return false;
  const cp = s.codePointAt(i);
  // look at the whole code point; for a low surrogate step back one unit
  if (cp >= 0xdc00 && cp <= 0xdfff && i > 0) return WORD.test(s.slice(i - 1, i + 1));
  return WORD.test(String.fromCodePoint(cp));
}

function hasWholeWord(text, alias) {
  const first = isWordAt(alias, 0);
  const last = isWordAt(alias, alias.length - 1);
  let from = 0;
  for (;;) {
    const at = text.indexOf(alias, from);
    if (at < 0) return false;
    const end = at + alias.length;
    const okBefore = !first || !isWordAt(text, at - 1);
    const okAfter = !last || !isWordAt(text, end);
    if (okBefore && okAfter) return true;
    from = at + 1;
  }
}

export function findMentions(text, aliases) {
  const t = squeeze(text);
  if (!t || !Array.isArray(aliases)) return [];
  const out = [];
  const seen = new Set();
  const list = aliases.length > MAX_ALIASES ? aliases.slice(0, MAX_ALIASES) : aliases;
  for (const row of list) {
    if (!row || seen.has(row.entity)) continue;
    const alias = squeeze(row.alias);
    if (!alias || alias.length > t.length) continue;
    if (hasWholeWord(t, alias)) {
      seen.add(row.entity);
      out.push(row.entity);
      if (out.length >= MAX_ENTITIES_PER_PASSAGE) break;
    }
  }
  return out;
}

// entities: [{ id, aliases: [string] }] (a single `alias` or `name` string is taken too).
// Returns [{ entity, alias }], lower case, squeezed, 3 characters or more, longest first, at most 5,000.
export function aliasesOf(entities) {
  const rows = [];
  const seen = new Set();
  for (const e of Array.isArray(entities) ? entities : []) {
    if (!e) continue;
    const id = e.id ?? e.entity;
    const names = Array.isArray(e.aliases) ? e.aliases : [e.alias ?? e.name];
    for (const n of names) {
      if (typeof n !== "string") continue;
      const alias = squeeze(n);
      if (alias.length < MIN_ALIAS_LENGTH) continue;
      const k = `${id}\u0000${alias}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ entity: id, alias });
    }
  }
  rows.sort((a, b) => b.alias.length - a.alias.length || (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));
  return rows.slice(0, MAX_ALIASES);
}
