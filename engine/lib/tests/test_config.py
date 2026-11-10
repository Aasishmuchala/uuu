import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.dirname(HERE)
sys.path.insert(0, LIB)

import config  # noqa: E402

REAL = os.path.join(os.path.dirname(LIB), "config.json")


def real_cfg():
    with open(REAL) as fh:
        return json.load(fh)


class ConfigTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self._old = os.environ.pop("ENGINE_CONFIG", None)

    def tearDown(self):
        os.environ.pop("ENGINE_CONFIG", None)
        if self._old is not None:
            os.environ["ENGINE_CONFIG"] = self._old

    def write(self, name, content):
        p = os.path.join(self.tmp.name, name)
        with open(p, "w") as fh:
            fh.write(content if isinstance(content, str) else json.dumps(content))
        return p

    def test_ports_and_urls(self):
        c = config.load_config()
        self.assertEqual(c["ports"]["gate"], 3110)
        self.assertEqual(c["urls"], {
            "board": "http://127.0.0.1:3100", "gate": "http://127.0.0.1:3110",
            "home": "http://127.0.0.1:3200", "bench": "http://127.0.0.1:8120"})
        self.assertEqual(c["engineDir"], os.path.dirname(LIB))

    def test_tilde_expanded(self):
        c = config.load_config()
        home = os.path.expanduser("~")
        self.assertEqual(c["stateRoot"], os.path.join(home, ".paperclip/uuu-engine"))
        self.assertEqual(c["fence"]["realClaude"], os.path.join(home, ".local/bin/claude"))
        self.assertNotIn('"~', json.dumps(c))

    def test_paths_keys(self):
        keys = ("state logs run secrets agentSecrets policy ids tasks projectFolder agentFolders "
                "proofFolder quotaFolder knowledgeDocs lessons contentDrafts homeData cad cadPython "
                "proofLast fences claudeHome codexHome books benchOwnerKey").split()
        self.assertEqual(sorted(config.load_config()["paths"]), sorted(keys))

    def test_missing_key(self):
        c = real_cfg()
        del c["ports"]["gate"]
        with self.assertRaises(config.ConfigError) as cm:
            config.load_config(self.write("a.json", c))
        self.assertTrue(str(cm.exception).startswith("engine config: "))
        self.assertIn("ports.gate", str(cm.exception))

    def test_bad_json_and_missing_file(self):
        for p in (self.write("b.json", "{nope"), os.path.join(self.tmp.name, "none.json")):
            with self.assertRaises(config.ConfigError) as cm:
                config.load_config(p)
            self.assertTrue(str(cm.exception).startswith("engine config: "))

    def test_engine_config_env(self):
        c = real_cfg()
        c["ports"]["gate"] = 4999
        os.environ["ENGINE_CONFIG"] = self.write("c.json", c)
        self.assertEqual(config.load_config()["ports"]["gate"], 4999)

    def run_cli(self, mode, env_config=None):
        env = dict(os.environ)
        env.pop("ENGINE_CONFIG", None)
        if env_config:
            env["ENGINE_CONFIG"] = env_config
        return subprocess.run([sys.executable, os.path.join(LIB, "config.py"), mode],
                              capture_output=True, text=True, env=env)

    def test_shell_output(self):
        r = self.run_cli("--shell")
        self.assertEqual(r.returncode, 0)
        lines = dict(l.split("=", 1) for l in r.stdout.strip().splitlines())
        self.assertEqual(lines["CFG_PORT_GATE"], "'3110'")
        self.assertEqual(lines["CFG_GATE_URL"], "'http://127.0.0.1:3110'")
        self.assertEqual(len(lines), 25)

    def test_shell_quotes_apostrophes(self):
        c = real_cfg()
        c["stateRoot"] = "/tmp/it's here"
        r = self.run_cli("--shell", self.write("q.json", c))
        out = subprocess.run(["/bin/bash", "-c", r.stdout + '\nprintf %s "$CFG_STATE"'],
                             capture_output=True, text=True).stdout
        self.assertEqual(out, "/tmp/it's here")

    def test_cli_error(self):
        r = self.run_cli("--json", self.write("d.json", "{nope"))
        self.assertEqual(r.returncode, 1)
        self.assertTrue(r.stderr.startswith("engine config: "))


if __name__ == "__main__":
    unittest.main()
