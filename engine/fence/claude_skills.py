#!/usr/bin/env python3
"""Finds the skill folders Claude must read for one --add-dir folder. Called by
the Claude wrapper, outside the fence. Kept in its own file for the same
reason as codex_home.py (bash 3.2 and quotes) and so it can be tested.

  claude_skills.py <add-dir folder> <instance root>

What paperclip does (read from its Claude adapter, 2026.1106.0): it builds a
prompt bundle under <instance>/companies/<company>/claude-prompt-cache/<key>/
and passes it with --add-dir. Its skills (the `paperclip` skill among them)
are links in <bundle>/.claude/skills/ pointing into paperclip's skills tree,
<instance>/skills/<company>/... Sharing the bundle alone lets Claude see the
links but not read what they point at, so it loads no skill at all.

Prints one real path per line: each skill folder a link points at, read only.
A link pointing outside paperclip's skills or company folders: one line on
stderr, exit 78, as for a Codex skill.
"""
import os
import sys


def inside(path, root):
    root = os.path.realpath(root)
    return path == root or path.startswith(root + "/")


def refuse(message):
    sys.stderr.write("fence: %s\n" % message)
    sys.exit(78)


def main(argv):
    if len(argv) != 2:
        refuse("claude_skills.py needs two arguments")
    add_dir, instance = argv
    skills = os.path.join(add_dir, ".claude", "skills")
    if not os.path.isdir(skills):
        return 0
    real_dir = os.path.realpath(add_dir)
    allowed = [os.path.join(instance, "skills"), os.path.join(instance, "companies")]
    out = []
    for name in sorted(os.listdir(skills)):
        link = os.path.join(skills, name)
        target = os.path.realpath(link)
        if not os.path.exists(target) or inside(target, real_dir):
            continue        # nothing there, or already shared with the folder
        if not any(inside(target, root) for root in allowed):
            refuse("the Claude skill %s points outside paperclip's folders" % name)
        if "\n" in target or "\t" in target:
            refuse("a path for the Claude fence has a line break or tab in it")
        out.append(target)
    for p in out:
        print(p)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
