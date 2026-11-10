#!/usr/bin/env python3
# PROTOTYPE (fence trial). Works out the fence for one run and prints the path of
# its settings file. Called by fence-run, outside the fence. Kept in its own file
# because bash 3.2 (the macOS one) miscounts quotes in a heredoc inside "$( )".
import hashlib, json, os, shutil, sys
state, home, ws, agent_home, node_root, extra_read, extra_domains, inner_tmp, extra_write, model_domains, board = sys.argv[1:12]
uid = os.getuid()
deny = [home, '/private/tmp/claude-%d' % uid, '/tmp/claude-%d' % uid]
# Where agent task folders may live: the engine's own, and the two trees paperclip
# manages (a default folder per agent, and a folder per task when a task is given
# one of its own). Nothing else under the home folder can ever be a task folder.
task_roots = [os.path.join(state, 'workspaces'), os.path.join(state, 'proof-ws'),
              os.path.join(home, '.paperclip', 'instances', 'default', 'workspaces'),
              os.path.join(home, '.paperclip', 'instances', 'default', 'isolated-workspaces')]
def inside(path, root):
    root = os.path.realpath(root)
    return path == root or path.startswith(root.rstrip('/') + '/')
for d in deny:
    if inside(os.path.realpath(d), ws):
        sys.exit('fence-run: refusing to run in %s: it holds folders the fence protects' % ws)
    if inside(ws, d) and not any(inside(ws, r) for r in task_roots):
        sys.exit('fence-run: refusing to run in %s: it is not an agent task folder' % ws)
split = lambda s, sep: [p for p in s.split(sep) if p]
read = [ws, agent_home, inner_tmp, node_root, os.path.join(home, '.local', 'bin')]
claude = os.environ.get('UUU_REAL_CLAUDE') or shutil.which('claude')
if claude:
    read.append(os.path.dirname(os.path.realpath(claude)))
read += split(extra_read, ':') + split(extra_write, ':')
# Read-only views of other task folders, listed by the owner in "<task folder>.reads".
# That file sits beside the task folder, where no agent can write. This is how the
# Checker gets to see the work of the Builder without being able to change it.
if os.path.isfile(ws + '.reads'):
    for line in open(ws + '.reads'):
        path = os.path.realpath(line.strip()) if line.strip() else ''
        if path and inside(path, os.path.join(state, 'workspaces')):
            read.append(path)
write = [ws, agent_home, inner_tmp] + split(extra_write, ':')
domains = split(model_domains, ',') + split(board, ',') + split(extra_domains, ',')
text = json.dumps({
    'filesystem': {'denyRead': deny, 'allowRead': read, 'allowWrite': write, 'denyWrite': []},
    'network': {'allowedDomains': domains, 'deniedDomains': []},
}, indent=1)
out = os.path.join(state, 'fences', hashlib.sha256(text.encode()).hexdigest()[:20] + '.json')
if not os.path.exists(out):
    tmp = '%s.%d.tmp' % (out, os.getpid())
    with open(tmp, 'w') as f:
        f.write(text)
    os.replace(tmp, out)
print(out)
