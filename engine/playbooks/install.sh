#!/usr/bin/env bash
# Copies the craft playbooks named in engine/playbooks/manifest.json from the
# owner's own skill folders on this Mac (~/.claude/skills) into
# state/playbooks/<name>/, where every agent may read them and none may write.
# A playbook whose source is "own:<folder>" is read from engine/playbooks/own/<folder>/
# (the repo's own playbooks, .md files only) instead; that folder is only read, never removed.
# Downloads nothing. Only reading material is copied: the named files of each
# playbook (.md, .txt and .json only, at most 512 KB a file, 20 MB in all),
# never a whole folder, never scripts, a .venv, a site/ folder or a program.
# A link that leaves its playbook's folder is skipped and said.
#
# The site kit (PLAN-V5 K16, C18) is the one named exception: the five files of
# engine/site-kit/ beside this folder (reset.css, layout.css, reveal.js, gallery.js
# and README.md; .css, .js and .md only, at most 64 KB each, no link followed) are
# copied to state/playbooks/site-kit/ and listed in index.json as the engine's own.
# That folder is never removed as "not in the manifest".
#
# Usage: engine/playbooks/install.sh [--check-only]
#   --check-only   prints "Playbooks: <n> installed" (exit 0) or "Playbooks: not installed" (exit 1)
#
# Beside each copy: IN-THIS-ENGINE.md (the manifest's note) and, for a third
# party's playbook, its licence file. A playbook the manifest no longer names is
# removed. A missing skill folder is one plain line, never an error. Safe to run
# again: a copy that is already right is left alone, file for file.
#
# For tests only: ENGINE_PLAYBOOKS_SOURCE stands in for ~/.claude/skills,
# ENGINE_PLAYBOOKS_OWN for engine/playbooks/own, ENGINE_SITE_KIT_SOURCE for engine/site-kit
# and ENGINE_PLAYBOOKS_DEST for state/playbooks.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/config.sh" || { echo "engine config: could not be read" >&2; exit 1; }

MANIFEST="$HERE/manifest.json"
SOURCE_ROOT="${ENGINE_PLAYBOOKS_SOURCE:-$HOME/.claude/skills}"
OWN_ROOT="${ENGINE_PLAYBOOKS_OWN:-$HERE/own}"
SITE_KIT_ROOT="${ENGINE_SITE_KIT_SOURCE:-$HERE/../site-kit}"
DEST="${ENGINE_PLAYBOOKS_DEST:-${CFG_PLAYBOOKS:-$CFG_STATE/playbooks}}"

die() { echo "playbooks: $*" >&2; exit 1; }

# Everything that reads JSON, matches names or copies bytes is done here, by the
# system Python in isolated mode. Arguments: mode, manifest, source root, dest, own root, site kit.
run_py() {
  /usr/bin/python3 -I - "$@" <<'PY'
import errno, fnmatch, json, os, re, shutil, stat, sys

MODE, MANIFEST, SOURCE_ROOT, DEST, OWN_ROOT, SITE_KIT_ROOT = sys.argv[1:7]
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
SOURCE_RE = re.compile(r"^~/\.claude/skills/([A-Za-z0-9][A-Za-z0-9._-]{0,99})$")
OWN_RE = re.compile(r"^own:([a-z0-9][a-z0-9-]{0,39})$")
SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
LICENCE_RE = re.compile(r"^(?:(?:LICEN[CS]E|NOTICE|COPYING)(?:\.(?:md|txt))?|SKILL\.md)$")
KINDS = {"post", "newsletter", "carousel", "poster", "title-card", "film", "page", "still"}
ENDINGS = (".md", ".txt", ".json")
NEVER = {"scripts", "site", ".venv", "venv", "node_modules", ".git", "tests", "__pycache__"}
NOTE_FILE = "IN-THIS-ENGINE.md"
INDEX = "index.json"
FILE_MAX = 512 * 1024
TOTAL_MAX = 20 * 1024 * 1024
MANIFEST_MAX = 1024 * 1024
# The site kit (C18): the engine's own files for pages, copied beside the playbooks under this name.
SITE_KIT = "site-kit"
SITE_KIT_FILES = ("reset.css", "layout.css", "reveal.js", "gallery.js", "README.md")
SITE_KIT_ENDINGS = (".css", ".js", ".md")
SITE_KIT_MAX = 64 * 1024
SITE_KIT_ROW = {"origin": "own", "licence": "this engine's own", "roles": ["builder", "art-director"], "kinds": ["page"]}
SHOWN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


def say(msg):
    print("playbooks: " + msg)


def die(msg):
    sys.stderr.write("playbooks: " + msg + "\n")
    sys.exit(1)


def files(n):
    return "1 file" if n == 1 else "%d files" % n


def kb(n):
    return "%d KB" % max(1, (n + 1023) // 1024) if n < 1024 * 1024 else "%.1f MB" % (n / 1048576.0)


def read_capped(path, cap):
    """Opens a path without following a last link; returns bytes or None when not a
    regular file or over the cap."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        return None
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size > cap:
            return None
        chunks, left = [], cap + 1
        while left > 0:
            b = os.read(fd, min(left, 65536))
            if not b:
                break
            chunks.append(b)
            left -= len(b)
        data = b"".join(chunks)
        return None if len(data) > cap else data
    finally:
        os.close(fd)


def bad(msg):
    die("the manifest is not right: " + msg + ". Nothing was changed.")


def check_pattern(name, pat, licence=False, own=False):
    if not isinstance(pat, str) or not pat or len(pat) > 200:
        bad("%s has an empty or overlong file entry" % name)
    if pat.startswith("/") or "\\" in pat:
        bad("%s: %s is not a path inside its folder" % (name, pat))
    segs = pat.split("/")
    for s in segs:
        if s in ("", ".", "..") or s.lower() in NEVER:
            bad("%s: %s names a folder that is never copied" % (name, pat))
    if licence:
        if len(segs) != 1 or not LICENCE_RE.match(pat):
            bad("%s: %s is not a licence file name" % (name, pat))
    elif own and not segs[-1].lower().endswith(".md"):
        bad("%s: %s does not end in .md (an own playbook holds .md files only)" % (name, pat))
    elif not segs[-1].lower().endswith(ENDINGS):
        bad("%s: %s does not end in .md, .txt or .json" % (name, pat))


def load_manifest():
    data = read_capped(MANIFEST, MANIFEST_MAX)
    if data is None:
        die("the manifest (engine/playbooks/manifest.json) could not be read. Nothing was changed.")
    try:
        m = json.loads(data.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        bad("it is not JSON")
    if not isinstance(m, dict) or m.get("version") != 1 or not isinstance(m.get("playbooks"), list):
        bad("it needs version 1 and a list of playbooks")
    seen = set()
    for p in m["playbooks"]:
        if not isinstance(p, dict):
            bad("a playbook entry is not an object")
        name = p.get("name")
        if not isinstance(name, str) or not NAME_RE.match(name) or name in seen:
            bad("a playbook name is missing, repeated or not in plain lower-case letters")
        if name == SITE_KIT:
            bad("%s is the name of the engine's site kit, never of a playbook" % name)
        seen.add(name)
        if not isinstance(p.get("source"), str) or not (SOURCE_RE.match(p["source"]) or OWN_RE.match(p["source"])):
            bad("%s: the source must be ~/.claude/skills/<folder> or own:<folder>" % name)
        own = bool(OWN_RE.match(p["source"]))
        if p.get("origin") not in ("own", "third-party"):
            bad("%s: the origin must be own or third-party" % name)
        if not isinstance(p.get("licence"), str) or not p["licence"].strip():
            bad("%s has no licence" % name)
        for key in ("files", "licenceFiles", "roles", "kinds"):
            if not isinstance(p.get(key), list):
                bad("%s: %s must be a list" % (name, key))
        if not p["files"]:
            bad("%s names no files" % name)
        for pat in p["files"]:
            check_pattern(name, pat, own=own)
        for pat in p["licenceFiles"]:
            check_pattern(name, pat, licence=True)
        if not all(isinstance(r, str) and SLUG_RE.match(r) for r in p["roles"]):
            bad("%s: a role is not a plain slug" % name)
        if not all(k in KINDS for k in p["kinds"]):
            bad("%s: a kind is not one the engine knows" % name)
        note = p.get("note")
        if not isinstance(note, str) or not note.startswith("In this engine:") or not 60 <= len(note) <= 4000:
            bad("%s: the note must start with 'In this engine:' and hold 60 to 4000 characters" % name)
    return m["playbooks"]


def inside(path, root):
    return path == root or path.startswith(root + os.sep)


def expand(name, root, pat, licence, said, own=False):
    """The files under root that one pattern names, as (relative path, real path).
    '*' never crosses a '/', never matches a name starting with '.', and a link is
    followed only when it stays inside root."""
    segs = pat.split("/")
    found = []

    def walk(dirpath, rel, i):
        seg = segs[i]
        last = i == len(segs) - 1
        if any(c in seg for c in "*?["):
            try:
                names = sorted(os.listdir(dirpath))
            except OSError:
                return
            names = [n for n in names if not n.startswith(".") and fnmatch.fnmatchcase(n, seg)]
        else:
            names = [seg]
        for n in names:
            r = rel + [n]
            if n.lower() in NEVER:
                continue
            p = os.path.join(dirpath, n)
            try:
                st = os.lstat(p)
            except OSError:
                continue
            if stat.S_ISLNK(st.st_mode):
                real = os.path.realpath(p)
                if not inside(real, root):
                    key = "/".join(r)
                    if key not in said:
                        said.add(key)
                        say("%s: skipped %s: it is a link that leaves the playbook's folder." % (name, key))
                    continue
                try:
                    st = os.stat(real)
                except OSError:
                    continue
                p = real
            if last:
                if stat.S_ISREG(st.st_mode):
                    found.append(("/".join(r), p, st.st_size))
            elif stat.S_ISDIR(st.st_mode):
                walk(p, r, i + 1)

    walk(root, [], 0)
    if not licence:
        found = [f for f in found if f[0].lower().endswith(ENDINGS)]
        if own:
            found = [f for f in found if f[0].lower().endswith(".md")]
    return found


def note_text(p, count):
    who = "the owner's own playbook" if p["origin"] == "own" else "a third party's playbook"
    where = "the engine's own playbooks" if OWN_RE.match(p["source"]) else "the owner's skill folders on this Mac"
    return (
        "# %s: in this engine\n\n%s\n\nThis is %s (licence: %s), copied from %s: %s. "
        "It is read-only here, and the installer replaces this folder when the playbook changes.\n"
        % (p["name"], p["note"], who, p["licence"], where, files(count))
    ).encode("utf-8")


def plan_one(p):
    """Returns {relative path: bytes} for one playbook, or None when there is nothing to copy."""
    own = OWN_RE.match(p["source"])
    if own:
        src = os.path.join(OWN_ROOT, own.group(1))
        try:
            st = os.lstat(src)  # an own folder must be a real folder, never a link
        except OSError:
            st = None
        where = "in the engine"
    else:
        src = os.path.join(SOURCE_ROOT, SOURCE_RE.match(p["source"]).group(1))
        try:
            st = os.stat(src)
        except OSError:
            st = None
        where = "on this Mac"
    if st is None or not stat.S_ISDIR(st.st_mode):
        return None, "%s: skipped: its folder is not %s (%s)." % (p["name"], where, p["source"])
    root = os.path.realpath(src)
    want, said = {}, set()
    for licence, pats in ((False, p["files"]), (True, p["licenceFiles"] if p["origin"] == "third-party" else [])):
        for pat in pats:
            hits = expand(p["name"], root, pat, licence, said, bool(own))
            if not hits and not any(s.startswith(pat.split("*")[0]) for s in said):
                say("%s: %s matched nothing in its folder." % (p["name"], pat))
            for rel, real, size in hits:
                if rel in want:
                    continue
                if rel == NOTE_FILE:
                    say("%s: skipped %s: that name is the engine's own note." % (p["name"], rel))
                    continue
                if size > FILE_MAX:
                    say("%s: skipped %s: it is over 512 KB." % (p["name"], rel))
                    continue
                data = read_capped(real, FILE_MAX)
                if data is None:
                    say("%s: skipped %s: it could not be read as a plain file of at most 512 KB." % (p["name"], rel))
                    continue
                want[rel] = data
    if not want:
        return None, "%s: skipped: none of its named files are in %s." % (p["name"], p["source"])
    want[NOTE_FILE] = note_text(p, len(want))
    return want, None


def plan_site_kit():
    """Returns ({file name: bytes}, None) for the site kit, or (None, why) when there is nothing to copy. Only
    the five named files, each a plain file (never through a link) ending .css, .js or .md, of at most 64 KB."""
    try:
        st = os.lstat(SITE_KIT_ROOT)  # the kit's folder must be a real folder, never a link
    except OSError:
        st = None
    if st is None or not stat.S_ISDIR(st.st_mode):
        return None, "%s: skipped: its folder is not in the engine (engine/site-kit)." % SITE_KIT
    try:
        names = sorted(os.listdir(SITE_KIT_ROOT))
    except OSError:
        return None, "%s: skipped: its folder could not be listed." % SITE_KIT
    want = {}
    for n in names:
        shown = n if SHOWN_RE.match(n) else "a file with an unusual name"
        if n not in SITE_KIT_FILES:
            say("%s: skipped %s: the site kit holds only %s." % (SITE_KIT, shown, ", ".join(SITE_KIT_FILES)))
            continue
        try:
            st = os.lstat(os.path.join(SITE_KIT_ROOT, n))
        except OSError:
            continue
        if stat.S_ISLNK(st.st_mode):
            say("%s: skipped %s: it is a link, and the installer follows no link." % (SITE_KIT, shown))
            continue
        if not stat.S_ISREG(st.st_mode) or not n.endswith(SITE_KIT_ENDINGS):
            say("%s: skipped %s: it is not a plain .css, .js or .md file." % (SITE_KIT, shown))
            continue
        if st.st_size > SITE_KIT_MAX:
            say("%s: skipped %s: it is over 64 KB." % (SITE_KIT, shown))
            continue
        data = read_capped(os.path.join(SITE_KIT_ROOT, n), SITE_KIT_MAX)
        if data is None:
            say("%s: skipped %s: it could not be read as a plain file of at most 64 KB." % (SITE_KIT, shown))
            continue
        want[n] = data
    for n in SITE_KIT_FILES:
        if n not in want and n not in names:
            say("%s: %s is not in the engine's site kit." % (SITE_KIT, n))
    if not want:
        return None, "%s: skipped: none of its files are in the engine (engine/site-kit)." % SITE_KIT
    return want, None


def read_tree(top):
    """{relative path: bytes} of an installed copy, or None when anything in it is not
    a plain file or folder with the right mode."""
    out = {}
    try:
        st = os.lstat(top)
    except OSError:
        return None
    if not stat.S_ISDIR(st.st_mode) or stat.S_IMODE(st.st_mode) != 0o755:
        return None
    for dirpath, dirs, files in os.walk(top):
        for d in dirs:
            s = os.lstat(os.path.join(dirpath, d))
            if not stat.S_ISDIR(s.st_mode) or stat.S_IMODE(s.st_mode) != 0o755:
                return None
        for f in files:
            full = os.path.join(dirpath, f)
            s = os.lstat(full)
            if not stat.S_ISREG(s.st_mode) or stat.S_IMODE(s.st_mode) != 0o644:
                return None
            data = read_capped(full, FILE_MAX + 65536)
            if data is None:
                return None
            out[os.path.relpath(full, top).replace(os.sep, "/")] = data
    return out


def write_tree(top, want):
    os.mkdir(top, 0o755)
    os.chmod(top, 0o755)
    for rel in sorted(want):
        parts = rel.split("/")
        d = top
        for seg in parts[:-1]:
            d = os.path.join(d, seg)
            if not os.path.isdir(d):
                os.mkdir(d, 0o755)
                os.chmod(d, 0o755)
        fd = os.open(os.path.join(d, parts[-1]), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        try:
            os.fchmod(fd, 0o644)
            data = want[rel]
            while data:
                n = os.write(fd, data)
                data = data[n:]
        finally:
            os.close(fd)


def remove(path):
    try:
        st = os.lstat(path)
    except OSError:
        return
    if stat.S_ISDIR(st.st_mode):
        shutil.rmtree(path)
    else:
        os.unlink(path)


def ours(path):
    """A folder this installer made: a real folder holding a plain IN-THIS-ENGINE.md."""
    try:
        return stat.S_ISDIR(os.lstat(path).st_mode) and stat.S_ISREG(os.lstat(os.path.join(path, NOTE_FILE)).st_mode)
    except OSError:
        return False


def index_rows(playbooks):
    rows = []
    for p in playbooks:
        tree = read_tree(os.path.join(DEST, p["name"]))
        if not tree or NOTE_FILE not in tree:
            continue
        files = sorted(r for r in tree if r != NOTE_FILE)
        rows.append({
            "name": p["name"], "origin": p["origin"], "licence": p["licence"],
            "roles": p["roles"], "kinds": p["kinds"], "files": files,
            "bytes": sum(len(tree[r]) for r in files),
        })
    tree = read_tree(os.path.join(DEST, SITE_KIT))
    if tree:
        files = sorted(tree)
        rows.append(dict({"name": SITE_KIT}, **SITE_KIT_ROW, files=files, bytes=sum(len(tree[r]) for r in files)))
    return rows


def dest_usable():
    try:
        st = os.lstat(DEST)
    except OSError:
        return False
    return stat.S_ISDIR(st.st_mode)


def check_only():
    names = {p["name"] for p in load_manifest()}
    n = 0
    if dest_usable():
        data = read_capped(os.path.join(DEST, INDEX), 4 * 1024 * 1024)
        try:
            rows = json.loads(data.decode("utf-8")) if data is not None else {}
        except (ValueError, UnicodeDecodeError):
            rows = {}
        rows = rows.get("playbooks") if isinstance(rows, dict) else None
        for r in rows if isinstance(rows, list) else []:
            if isinstance(r, dict) and r.get("name") in names and NAME_RE.match(r["name"]) and ours(os.path.join(DEST, r["name"])):
                n += 1
    if n:
        print("Playbooks: %d installed" % n)
        return 0
    print("Playbooks: not installed")
    return 1


def install():
    playbooks = load_manifest()
    try:
        st = os.lstat(DEST)
        if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
            die("%s is a link or not a folder; remove it and run again. Nothing was changed." % DEST)
    except FileNotFoundError:
        if not os.path.isdir(os.path.dirname(DEST.rstrip("/")) or "/"):
            die("the engine's state folder is not there yet; run engine start once first. Nothing was changed.")
        os.mkdir(DEST, 0o755)
    os.chmod(DEST, 0o755)

    plans, total = [], 0
    for p in playbooks:
        want, why = plan_one(p)
        if want is None:
            say(why if not ours(os.path.join(DEST, p["name"])) else why + " The copy installed earlier is kept.")
            continue
        plans.append((p, want))
        total += sum(len(b) for b in want.values())
    kit, why = plan_site_kit()
    if kit is None:
        say(why if not os.path.isdir(os.path.join(DEST, SITE_KIT)) else why + " The copy installed earlier is kept.")
    else:
        total += sum(len(b) for b in kit.values())
    if total > TOTAL_MAX:
        die("the named files come to %s, over the 20 MB limit. Nothing was changed." % kb(total))

    for p, want in plans + ([({"name": SITE_KIT}, kit)] if kit else []):
        top = os.path.join(DEST, p["name"])
        count = len(want) if p["name"] == SITE_KIT else len(want) - 1   # the site kit has no note of the engine's
        if read_tree(top) == want:
            say("%s: already in place (%s)." % (p["name"], files(count)))
            continue
        new, old = os.path.join(DEST, ".new-" + p["name"]), os.path.join(DEST, ".old-" + p["name"])
        remove(new)
        remove(old)
        write_tree(new, want)
        existed = os.path.lexists(top)
        if existed:
            os.rename(top, old)
        os.rename(new, top)
        remove(old)
        say("%s: %s, %s (%s)." % (p["name"], "updated" if existed else "installed", files(count),
                                       kb(sum(len(b) for b in want.values()))))

    names = {p["name"] for p in playbooks}
    for entry in sorted(os.listdir(DEST)):
        full = os.path.join(DEST, entry)
        if entry == INDEX or entry in names or entry == SITE_KIT:
            continue        # the site kit's folder is the engine's own, never "not in the manifest" (C18)
        if entry.startswith(".new-") or entry.startswith(".old-"):
            remove(full)
        elif NAME_RE.match(entry) and (os.path.islink(full) or ours(full)):
            remove(full)
            say("%s: removed; the manifest no longer names it." % entry)
        else:
            say("left alone: %s is not a playbook folder this installer made." % entry)

    rows = index_rows(playbooks)
    body = (json.dumps({"version": 1, "playbooks": rows}, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    idx = os.path.join(DEST, INDEX)
    if read_capped(idx, 4 * 1024 * 1024) != body or stat.S_IMODE(os.lstat(idx).st_mode) != 0o644:
        tmp = idx + ".tmp"
        remove(tmp)
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        try:
            os.fchmod(fd, 0o644)
            os.write(fd, body)
        finally:
            os.close(fd)
        os.rename(tmp, idx)
    books = [r for r in rows if r["name"] != SITE_KIT]
    size = sum(r["bytes"] for r in books)
    say("%d of %d playbooks installed (%s of reading)." % (len(books), len(playbooks), kb(size)))
    return 0


sys.exit(check_only() if MODE == "check" else install())
PY
}

if [ "${1:-}" = "--check-only" ]; then
  [ $# -eq 1 ] || die "--check-only takes nothing else"
  run_py check "$MANIFEST" "$SOURCE_ROOT" "$DEST" "$OWN_ROOT" "$SITE_KIT_ROOT"
  exit $?
fi
[ $# -eq 0 ] || die "unknown option $1 (usage: engine/playbooks/install.sh [--check-only])"

run_py install "$MANIFEST" "$SOURCE_ROOT" "$DEST" "$OWN_ROOT" "$SITE_KIT_ROOT"
