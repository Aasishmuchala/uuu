"""Tests for the words of an Astryx site's scripts (PLAN-ASTRYX T6b). Run with the Artist's own Python:

    ~/.paperclip/uuu-engine/art/venv/bin/python -m unittest discover -s engine/art/tests -p 'test_brandcheck*.py'

An Astryx page is drawn by its script, so on a site with astryx/ at its top the strings of the maker's own scripts
are read as the page's words by the can't-say and filler rules. The kit's files, passed over by their sha256, are
not. A site with no astryx/ is judged as before T6b, byte for byte.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    from test_brandcheck import codes  # noqa: E402
    from test_brandcheck_pages import REVEAL  # noqa: E402
    from test_brandcheck_astryx import AstryxBase, example, ART, REPO  # noqa: E402
except NameError:       # test_brandcheck.py names Pillow's colours at import: without Pillow it cannot be read
    raise unittest.SkipTest("the Artist's tools are not installed (run engine/art/install.sh); brand check tests "
                            "skipped")

# The check as PLAN-ASTRYX T6 left it, before its scripts' words were read.
BEFORE = "c9ff2ba"


class AstryxWordsTest(AstryxBase):
    def banned(self, p):
        return [e for e in p["hard"] if e["code"] == "banned_phrase"]

    def test_a_cant_say_phrase_in_app_js_is_caught(self):
        self.astryx_site(app__js=example("app.js") + "const note = h('p', null, 'The best in town, every day.');\n")
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["banned_phrase"]), json.dumps(p["hard"]))
        self.assertEqual(len(self.banned(p)), 1)
        self.assertIn("app.js", self.banned(p)[0]["where"])
        self.assertIn('"best in town"', self.banned(p)[0]["detail"])

    def test_a_phrase_across_a_line_break_escapes_and_templates_is_caught(self):
        cases = ["const a = 'best\\nin town';\n",
                 "const a = 'best in \\u0074own';\n",
                 "const a = `${n} guaranteed`;\n",
                 "const a = `Only ${n} left, ${'x'} cheap`;\n"]
        for extra in cases:
            shutil.rmtree(os.path.join(self.goal, "site"), ignore_errors=True)
            self.astryx_site(app__js=example("app.js") + extra)
            code, p = self.run_site()
            self.assertEqual((code, codes(p)), (1, ["banned_phrase"]), (extra, json.dumps(p["hard"])))

    def test_a_cant_say_phrase_in_a_json_or_txt_file_is_caught(self):
        """Fable's review (T12): a script may draw words it loads from the site's own .json or .txt files."""
        cases = [{"words__json": json.dumps({"hero": {"lines": ["Fresh bread.", "The best in town."]}})},
                 {"words__json": '{"best in town": 1}'},
                 {"words__json": '{"a": "best in \\u0074own"}'},
                 {"words__json": json.dumps({"a": [[[[[[[[["The best in town."]]]]]]]]]})},
                 {"words__json": "not json: the best in town"},
                 {"copy_x_hero__txt": "Fresh bread.\nThe best in town.\n"}]
        for files in cases:
            shutil.rmtree(os.path.join(self.goal, "site"), ignore_errors=True)
            self.astryx_site(**files)
            code, p = self.run_site()
            self.assertEqual((code, codes(p)), (1, ["banned_phrase"]), (files, json.dumps(p["hard"])))

    def test_a_filler_phrase_in_a_json_file_is_caught(self):
        self.astryx_site(words__json=json.dumps(["Elevate your mornings."]))
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["filler_phrase"]), json.dumps(p["hard"]))

    def test_plain_words_in_a_json_file_pass_and_the_kits_own_are_not_read(self):
        self.astryx_site(words__json=json.dumps({"hero": "Fresh bread every morning."}))
        code, p = self.run_site()
        self.assertEqual((code, p["hard"]), (0, []), json.dumps(p["hard"]))

    def test_a_filler_phrase_in_a_script_is_caught(self):
        self.astryx_site(app__js=example("app.js") + "const a = 'Elevate your mornings.';\n")
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["filler_phrase"]), json.dumps(p["hard"]))

    def test_a_phrase_in_the_pages_own_module_script_is_caught(self):
        index = example("index.html").replace(
            "</body>", "<script type=\"module\">document.title = 'Guaranteed results';</script>\n</body>")
        self.astryx_site(index__html=index)
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["banned_phrase"]), json.dumps(p["hard"]))

    def test_a_phrase_in_another_of_the_makers_scripts_is_caught(self):
        self.astryx_site(**{"parts_x_more__mjs": "export const line = 'cheap and cheerful';\n"})
        code, p = self.run_site()
        self.assertEqual((code, codes(p)), (1, ["banned_phrase"]), json.dumps(p["hard"]))
        self.assertIn("more.mjs", self.banned(p)[0]["where"])

    def test_a_modules_address_is_not_read_as_words(self):
        self.astryx_site(app__js="import './cheap.js';\nimport { a } from './guaranteed.js';\n" + example("app.js"),
                         cheap__js="export {};\n", guaranteed__js="export const a = 1;\n")
        code, p = self.run_site()
        self.assertEqual((code, p["hard"]), (0, []), json.dumps(p["hard"]))

    def test_the_same_phrase_in_the_hashed_kit_is_not_flagged(self):
        folder = self.astryx_site()
        text = b"export const note = 'The best in town, guaranteed and cheap.';\n"
        with open(os.path.join(folder, "astryx", "words.js"), "wb") as fh:
            fh.write(text)
        listed = os.path.join(self.bin, "astryx.lock.json")
        with open(listed, encoding="utf-8") as fh:
            kit = json.load(fh)
        kit["files"].append({"name": "words.js", "bytes": len(text), "sha256": hashlib.sha256(text).hexdigest()})
        kit["files"].sort(key=lambda f: f["name"])
        with open(listed, "w", encoding="utf-8") as fh:
            json.dump(kit, fh)
        code, p = self.run_site()
        self.assertEqual((code, p["hard"], p["soft"]), (0, [], []), json.dumps(p["hard"]))

    def test_the_kit_as_it_is_adds_no_word_lines(self):
        self.astryx_site()
        code, p = self.run_site()
        self.assertEqual((code, p["hard"], p["soft"]), (0, [], []), json.dumps(p["hard"]))


class PlainKitUnchangedTest(AstryxBase):
    """A site with no astryx/ gives the same answer as the check before T6b, byte for byte: its scripts' strings are
    not its words."""

    def before_tool(self):
        r = subprocess.run(["git", "-C", REPO, "show", BEFORE + ":engine/art/brandcheck.py"], capture_output=True,
                           timeout=30)
        if r.returncode != 0 or not r.stdout:
            self.skipTest("the check before T6b is not in this repo")
        old = os.path.join(self.root, "beforebin")
        os.makedirs(old)
        for f in os.listdir(self.bin):
            shutil.copy(os.path.join(self.bin, f), old)
        with open(os.path.join(old, "brandcheck.py"), "wb") as fh:
            fh.write(r.stdout)
        return old

    def answer(self, folder):
        r = subprocess.run([sys.executable, "-I", os.path.join(folder, "brandcheck.py"), "--json", "--state",
                            self.state, "STH-7"], cwd=self.work, capture_output=True, timeout=120)
        return r.returncode, r.stdout, r.stderr

    def test_a_phrase_in_a_plain_sites_script_is_not_read(self):
        self.site(reveal__js=REVEAL + "const note = 'The best in town, guaranteed.';\n")
        code, p = self.run_site()
        self.assertEqual((code, p["hard"]), (0, []), json.dumps(p["hard"]))

    def test_plain_sites_give_the_answer_before_t6b(self):
        old = self.before_tool()
        shutil.copy(os.path.join(ART, "brandcheck.py"), self.bin)
        self.site("good")
        self.site("wordy", reveal__js=REVEAL + "const a = 'best in town'; const b = `${x} cheap`;\n")
        self.site("loud", reveal__js=REVEAL + 'fetch("https://x.example/a"); const c = "elevate your";\n')
        new = self.answer(self.bin)
        self.assertEqual(new, self.answer(old))
        self.assertEqual(new[0], 1)


if __name__ == "__main__":
    unittest.main()
