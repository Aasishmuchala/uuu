"""Tests for engine/cad/export.py. Run with the Drafter's own Python:

    ~/.paperclip/uuu-engine/cad/venv/bin/python -m unittest discover -s engine/cad/tests -p 'test_*.py'

Skipped, with a message, when CadQuery is not installed (engine/cad/install.sh).
The scripts here are our own, so running them outside the fence is fine.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

EXPORT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "export.py")

try:
    import cadquery  # noqa: F401
    HAVE_CQ = True
except ImportError:
    HAVE_CQ = False

PLATE = """import cadquery as cq

result = (
    cq.Workplane("XY")
    .box(60, 40, 5)
    .faces(">Z").workplane()
    .pushPoints([(-20, 0), (20, 0)])
    .hole(6)
)
"""


@unittest.skipUnless(HAVE_CQ, "the Drafter's tools are not installed (run engine/cad/install.sh); export tests skipped")
class ExportTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="uuu-cad-test-")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_export(self, name, text):
        with open(os.path.join(self.dir, name), "w", encoding="utf-8") as fh:
            fh.write(text)
        return subprocess.run([sys.executable, EXPORT, name], cwd=self.dir,
                              capture_output=True, text=True, timeout=300)

    def test_plate_with_two_holes(self):
        r = self.run_export("plate.py", PLATE)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(self.dir, "plate.json"), encoding="utf-8") as fh:
            rec = json.load(fh)
        self.assertEqual(set(rec), {"name", "units", "bbox", "volume_mm3", "script", "made_at"})
        self.assertEqual(rec["name"], "plate")
        self.assertEqual(rec["units"], "mm")
        self.assertEqual(rec["script"], "plate.py")
        self.assertAlmostEqual(rec["bbox"]["x"], 60, delta=0.01)
        self.assertAlmostEqual(rec["bbox"]["y"], 40, delta=0.01)
        self.assertAlmostEqual(rec["bbox"]["z"], 5, delta=0.01)
        self.assertAlmostEqual(rec["volume_mm3"], 11717.26, delta=0.5)
        self.assertRegex(rec["made_at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
        with open(os.path.join(self.dir, "plate.step"), encoding="utf-8", errors="replace") as fh:
            self.assertTrue(fh.read(20).startswith("ISO-10303-21"))
        self.assertEqual(r.stdout.strip(), "plate.step: 60 × 40 × 5 mm, volume 11717.26 mm³.")
        self.assertEqual([f for f in os.listdir(self.dir) if f.endswith(".tmp")], [])

    def test_no_result(self):
        r = self.run_export("empty.py", "import cadquery as cq\npart = cq.Workplane().box(1, 1, 1)\n")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stderr.strip(),
                         "export: the script left nothing in `result`. End it with: result = <your part>")
        self.assertEqual(len(r.stderr.strip().splitlines()), 1)
        self.assertFalse(os.path.exists(os.path.join(self.dir, "empty.step")))
        self.assertFalse(os.path.exists(os.path.join(self.dir, "empty.json")))

    def test_result_not_a_solid(self):
        r = self.run_export("flat.py", "import cadquery as cq\nresult = cq.Workplane().rect(10, 10)\n")
        self.assertEqual(r.returncode, 1)
        self.assertIn("holds no solid", r.stderr)
        self.assertEqual(len(r.stderr.strip().splitlines()), 1)
        r = self.run_export("number.py", "result = 7\n")
        self.assertEqual(r.returncode, 1)
        self.assertIn("not a CadQuery part", r.stderr)

    def test_script_error_is_one_line_with_its_line(self):
        r = self.run_export("broken.py", "import cadquery as cq\n\nresult = cq.Workplane().box(1, 1)\n")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(len(r.stderr.strip().splitlines()), 1)
        self.assertRegex(r.stderr, r"^export: the script failed on line 3: TypeError")

    def test_bad_name(self):
        r = self.run_export("my part.py", PLATE)
        self.assertEqual(r.returncode, 1)
        self.assertIn("may only use letters", r.stderr)
        r = subprocess.run([sys.executable, EXPORT, "missing.py"], cwd=self.dir, capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("no script named missing.py", r.stderr)


if __name__ == "__main__":
    unittest.main()
