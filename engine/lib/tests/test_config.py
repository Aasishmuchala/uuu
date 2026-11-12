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
        self.assertEqual(c["ports"]["relay"], 3120)
        self.assertEqual(c["urls"], {
            "board": "http://127.0.0.1:3100", "gate": "http://127.0.0.1:3110",
            "relay": "http://127.0.0.1:3120", "home": "http://127.0.0.1:3200", "bench": "http://127.0.0.1:8120",
            "gateNarrow": "http://127.0.0.1:3111", "web": "http://127.0.0.1:3130",
            "generate": "http://127.0.0.1:3140", "viewer": "http://127.0.0.1:3150",
            "preview": "http://127.0.0.1:3160"})
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
                "proofLast fences claudeHome codexHome books benchOwnerKey models modelsState relayStatus "
                "providerSecrets providerKey relaySecret playbooks research sharedBrain doors doorsState "
                "doorSecrets webSecret generateSecret viewerSecret runwayKey searchKey webVisits ledger "
                "batches doorWork webStatus generateStatus viewerStatus").split()
        paths = config.load_config()["paths"]
        self.assertEqual(sorted(paths), sorted(keys))
        s = paths["state"]
        self.assertEqual(paths["modelsState"], os.path.join(s, "models", "state.json"))
        self.assertEqual(paths["relayStatus"], os.path.join(s, "models", "relay-status.json"))
        self.assertEqual(paths["providerKey"], os.path.join(s, "secrets", "provider", "omega-key"))
        self.assertEqual(paths["relaySecret"], os.path.join(s, "secrets", "provider", "relay-secret"))

    def test_door_paths_and_agents(self):
        c = config.load_config()
        paths = c["paths"]
        s = paths["state"]
        j = os.path.join
        self.assertEqual(paths["doorsState"], j(s, "doors", "state.json"))
        self.assertEqual(paths["webSecret"], j(s, "secrets", "doors", "web-secret"))
        self.assertEqual(paths["runwayKey"], j(s, "secrets", "doors", "runway-key"))
        self.assertEqual(paths["research"], j(s, "tasks", "research"))
        self.assertEqual(paths["sharedBrain"], j(s, "knowledge", "shared"))
        self.assertEqual(paths["ledger"], j(s, "doors", "generate-ledger.jsonl"))
        self.assertEqual(paths["viewerStatus"], j(s, "doors", "viewer-status.json"))
        self.assertEqual(c["doors"], {"web": {"agents": ["researcher"]}, "generate": {"agents": ["artist"]},
                                      "viewer": {"agents": ["builder", "art-director"]}})
        self.assertEqual(c["fence"]["policyPortsAllowed"], [8120])

    def test_missing_door_port_or_bad_doors(self):
        for k in ("gateNarrow", "web", "generate", "viewer", "preview"):
            c = real_cfg()
            del c["ports"][k]
            with self.assertRaises(config.ConfigError) as cm:
                config.load_config(self.write("p.json", c))
            self.assertIn("ports." + k, str(cm.exception))
        changes = [
            lambda c: c.pop("doors"),
            lambda c: c.update(doors=[]),
            lambda c: c["doors"].pop("viewer"),
            lambda c: c["doors"].update(other={"agents": []}),
            lambda c: c["doors"].update(web=["researcher"]),
            lambda c: c["doors"]["web"].update(agents="researcher"),
            lambda c: c["doors"]["web"].update(agents=["Researcher"]),
            lambda c: c["doors"]["generate"].update(agents=["../artist"]),
            lambda c: c["doors"]["viewer"].update(agents=[5]),
            lambda c: c["doors"]["viewer"].update(agents=["builder\n"]),
        ]
        for i, change in enumerate(changes):
            c = real_cfg()
            change(c)
            with self.assertRaises(config.ConfigError, msg=str(i)) as cm:
                config.load_config(self.write("d.json", c))
            self.assertTrue(str(cm.exception).startswith("engine config: "))
            self.assertIn("doors", str(cm.exception))

    def test_missing_relay_port(self):
        c = real_cfg()
        del c["ports"]["relay"]
        with self.assertRaises(config.ConfigError) as cm:
            config.load_config(self.write("r.json", c))
        self.assertIn("ports.relay", str(cm.exception))

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
        self.assertEqual(lines["CFG_PORT_RELAY"], "'3120'")
        self.assertEqual(lines["CFG_RELAY_URL"], "'http://127.0.0.1:3120'")
        s = config.load_config()["paths"]["state"]
        self.assertEqual(lines["CFG_MODELS_STATE"], "'%s/models/state.json'" % s)
        self.assertEqual(lines["CFG_PROVIDER_KEY"], "'%s/secrets/provider/omega-key'" % s)
        self.assertEqual(lines["CFG_RELAY_SECRET"], "'%s/secrets/provider/relay-secret'" % s)
        self.assertEqual(lines["CFG_PORT_GATE_NARROW"], "'3111'")
        self.assertEqual(lines["CFG_PORT_WEB"], "'3130'")
        self.assertEqual(lines["CFG_PORT_GENERATE"], "'3140'")
        self.assertEqual(lines["CFG_PORT_VIEWER"], "'3150'")
        self.assertEqual(lines["CFG_PORT_PREVIEW"], "'3160'")
        self.assertEqual(lines["CFG_GATE_NARROW_URL"], "'http://127.0.0.1:3111'")
        self.assertEqual(lines["CFG_WEB_URL"], "'http://127.0.0.1:3130'")
        self.assertEqual(lines["CFG_GENERATE_URL"], "'http://127.0.0.1:3140'")
        self.assertEqual(lines["CFG_VIEWER_URL"], "'http://127.0.0.1:3150'")
        self.assertEqual(lines["CFG_PREVIEW_URL"], "'http://127.0.0.1:3160'")
        self.assertEqual(lines["CFG_DOORS_STATE"], "'%s/doors/state.json'" % s)
        self.assertEqual(lines["CFG_PLAYBOOKS"], "'%s/playbooks'" % s)
        self.assertEqual(lines["CFG_RESEARCH"], "'%s/tasks/research'" % s)
        self.assertEqual(len(lines), 43)

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
