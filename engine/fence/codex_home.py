#!/usr/bin/env python3
"""Works out what the fence must allow around one Codex home. Called by the
Codex wrapper, outside the fence. Kept in its own file because bash 3.2 (the
macOS one) miscounts quotes in a heredoc inside "$( )".

  codex_home.py <codex home> <state> <instance root> <company id> <agent id>

What paperclip does around a Codex run (read from its adapter, 2026.1106.0):
  - it picks the Codex home itself: a generated folder per agent under
    <instance>/companies/<company>/codex-home/skill-runtimes/
  - auth.json in that home is a chain of links ending at the shared login file
  - skills are links pointing outside the home
  - its start-up check and its quota check use the server's own CODEX_HOME,
    which the engine sets to <state>/codex-home
So the fence allows: that one home (read and write), each link of the login
chain (read), the last file of the chain (write, so a token refresh works), the
skill folders the links point at (read), and this agent's instructions folder.
The home is writable inside the fence, so nothing in it is trusted: each link of
the login chain must be an auth.json in a place the login file is kept, and each
skill must lie in paperclip's skills folder for this company.

Prints lines `home<TAB>path`, `read<TAB>path`, `write<TAB>path`. On a home that
neither the engine nor paperclip made for an agent: one line on stderr, exit 78.
"""
import os
import pwd
import re
import sys

UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


def inside(path, root):
    root = os.path.realpath(root)
    return path == root or path.startswith(root + "/")


def refuse(message):
    sys.stderr.write("fence: %s\n" % message)
    sys.exit(78)


def owner_home():
    """The home folder macOS has on record for this user, as fence_inputs.py
    takes it: never $HOME, which whoever started us could have set."""
    return os.path.realpath(pwd.getpwuid(os.getuid()).pw_dir)


def located(path):
    """The path with its folder resolved and its own name kept as given."""
    return os.path.join(os.path.realpath(os.path.dirname(path)), os.path.basename(path))


def login_place_ok(path, real, state, instance):
    """Each link of the login chain and its last file must be a file named
    auth.json directly in one of the places paperclip and the engine keep it."""
    if os.path.basename(path) != "auth.json":
        return False
    folder = os.path.dirname(path)
    if folder in (real, os.path.join(os.path.realpath(state), "codex-home")):
        return True
    if re.fullmatch(r"%s/companies/%s/codex-home" % (re.escape(os.path.realpath(instance)), UUID), folder):
        return True
    return path == os.path.join(owner_home(), ".codex", "auth.json")


def main(argv):
    if len(argv) != 5:
        refuse("codex_home.py needs five arguments")
    codex_home, state, instance, company, agent = argv
    if not os.path.isabs(codex_home):
        refuse("refusing Codex home %s: it is not an absolute path" % codex_home)
    real = os.path.realpath(codex_home)
    managed = re.match(r"^%s/companies/%s/(agents/%s/)?codex-home(/|$)"
                       % (re.escape(os.path.realpath(instance)), UUID, UUID), real)
    if not (inside(real, os.path.join(state, "codex-home")) or managed):
        refuse("refusing Codex home %s: not one the engine or paperclip made for an agent" % codex_home)
    reads, writes = [], []
    # The login file: follow the chain of links, allow each link to be read and the last file to be written.
    hop, seen = os.path.join(real, "auth.json"), 0
    # Each link and the last file, as written and with its folder resolved, must be
    # in a place the login file is kept: a link planted in the home could otherwise
    # make this (unfenced) helper open any file to the agent.
    while True:
        for p in (hop, located(hop)):
            if not login_place_ok(p, real, state, instance):
                refuse("the Codex login file leads to a place it is never kept")
        if not os.path.islink(hop) or seen >= 8:
            break
        reads.append(hop)
        hop = os.path.normpath(os.path.join(os.path.dirname(hop), os.readlink(hop)))
        seen += 1
    if os.path.islink(hop):
        refuse("the Codex login file is a chain of more than 8 links")
    if os.path.exists(hop) and not inside(os.path.realpath(hop), real):
        writes.append(os.path.realpath(hop))
    # Skills: links pointing outside the home, read only, and only into paperclip's
    # skills tree (this company's part of it when the company is known). The home
    # is writable inside the fence, so a link planted there in one run must not
    # open the board's database or private files in the next.
    skills = os.path.join(real, "skills")
    skill_root = os.path.join(os.path.realpath(instance), "skills")
    if re.fullmatch(UUID, company):
        skill_root = os.path.join(skill_root, company)
    if os.path.isdir(skills):
        for name in sorted(os.listdir(skills)):
            target = os.path.realpath(os.path.join(skills, name))
            if os.path.exists(target) and not inside(target, real):
                if target == skill_root or not inside(target, skill_root):
                    refuse("the Codex skill %s points outside paperclip's skills folder" % name)
                reads.append(target)
    # The instructions folder of this agent.
    if re.fullmatch(UUID, company) and re.fullmatch(UUID, agent):
        path = os.path.join(instance, "companies", company, "agents", agent, "instructions")
        if os.path.isdir(path):
            reads.append(os.path.realpath(path))
    out = [("home", real)] + [("read", p) for p in reads] + [("write", p) for p in writes]
    for kind, p in out:
        if "\n" in p or "\t" in p:
            refuse("a path for the Codex fence has a line break or tab in it")
        print("%s\t%s" % (kind, p))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
