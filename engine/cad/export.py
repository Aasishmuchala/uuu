#!/usr/bin/env python3
"""Turns one CadQuery script into a STEP file with its measured size.

SAFETY: this runs code an agent wrote. Run it only inside the fence, in the
Drafter's task folder, the way the Drafter does:

    cd <goal>/cad && "$UUU_CAD_PYTHON" "$UUU_CAD_EXPORT" <name>.py

Never run it on an agent's script outside the fence, and never from the home
server: the home server only lists and serves the files this writes.

    export.py <name>.py

Runs the script, takes the CadQuery object it leaves in the name `result`, and
writes beside the script:
  <name>.step   the part
  <name>.json   {"name", "units": "mm", "bbox": {"x", "y", "z"}, "volume_mm3",
                 "script": "<name>.py", "made_at"}   (CONTRACTS 5.1)
Prints one plain line, such as
  wall-bracket.step: 60 × 40 × 5 mm, volume 11717.26 mm³.
On a problem it prints one plain line starting `export:` and exits 1.

Installed by engine/cad/install.sh as state/cad/tools/export.py and run with the
Drafter's own Python (state/cad/venv).
"""
import datetime
import json
import os
import re
import runpy
import sys
import traceback

NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")


class Problem(Exception):
    pass


def number(x):
    """60.0 -> "60", 11717.2566 -> "11717.26"."""
    text = "%.2f" % x
    return text.rstrip("0").rstrip(".") if "." in text else text


def where_in_script(script):
    """The line of the script where the last error happened, or None."""
    _, _, tb = sys.exc_info()
    line = None
    for frame, lineno in traceback.walk_tb(tb):
        if os.path.abspath(frame.f_code.co_filename) == script:
            line = lineno
    return line


def run_script(script):
    try:
        return runpy.run_path(script, run_name="__main__")
    except SystemExit as e:
        raise Problem("the script stopped itself (exit %s) before making a part" % (e.code,))
    except BaseException as e:   # the script's own error, shown in one line
        line = where_in_script(script)
        at = " on line %d" % line if line else ""
        msg = str(e).strip().splitlines()[0] if str(e).strip() else ""
        raise Problem("the script failed%s: %s%s" % (at, type(e).__name__, ": " + msg if msg else ""))


def solid_of(result):
    """The one shape to export: every solid the result holds, as one solid or a compound."""
    import cadquery as cq

    if isinstance(result, cq.Workplane):
        items = result.vals()
    elif isinstance(result, cq.Shape):
        items = [result]
    elif isinstance(result, cq.Assembly):
        items = [result.toCompound()]
    else:
        raise Problem("`result` is a %s, not a CadQuery part. Leave the finished solid in `result`."
                      % type(result).__name__)
    solids = []
    for item in items:
        if isinstance(item, cq.Shape):
            solids.extend(item.Solids())
    if not solids:
        raise Problem("`result` holds no solid (only flat shapes, lines or points). "
                      "Make it a solid, for example with extrude or box.")
    return solids[0] if len(solids) == 1 else cq.Compound.makeCompound(solids)


def write_atomic(path, write):
    tmp = "%s.%d.tmp" % (path, os.getpid())
    try:
        write(tmp)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def export(script_arg):
    if not script_arg.endswith(".py"):
        raise Problem("give the script's file name, ending in .py")
    script = os.path.abspath(script_arg)
    folder, base = os.path.split(script)
    name = base[:-3]
    if not NAME.match(name):
        raise Problem("the script's name may only use letters, digits, - and _ (got %r)" % base)
    if not os.path.isfile(script):
        raise Problem("there is no script named %s here" % base)

    space = run_script(script)
    if "result" not in space:
        raise Problem("the script left nothing in `result`. End it with: result = <your part>")
    shape = solid_of(space["result"])

    import cadquery as cq

    volume = shape.Volume()
    if not volume or volume <= 0:
        raise Problem("`result` has no volume. Check that the solid is closed.")
    box = shape.BoundingBox()
    bbox = {"x": round(box.xlen, 3), "y": round(box.ylen, 3), "z": round(box.zlen, 3)}

    step = os.path.join(folder, name + ".step")
    write_atomic(step, lambda p: cq.exporters.export(shape, p, exportType="STEP"))
    if not os.path.isfile(step) or os.path.getsize(step) == 0:
        raise Problem("the STEP file could not be written")

    record = {
        "name": name,
        "units": "mm",
        "bbox": bbox,
        "volume_mm3": round(volume, 2),
        "script": base,
        "made_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
    }

    def write_json(p):
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=2)
            fh.write("\n")
    write_atomic(os.path.join(folder, name + ".json"), write_json)

    return "%s.step: %s × %s × %s mm, volume %s mm³." % (
        name, number(bbox["x"]), number(bbox["y"]), number(bbox["z"]), number(record["volume_mm3"]))


def main(argv):
    if len(argv) != 1:
        sys.stderr.write("export: give one script, for example: export.py wall-bracket.py\n")
        return 1
    try:
        line = export(argv[0])
    except Problem as e:
        sys.stderr.write("export: %s\n" % e)
        return 1
    except Exception as e:   # CadQuery itself failed; still one line
        msg = str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__
        sys.stderr.write("export: the part could not be exported: %s\n" % msg)
        return 1
    sys.stdout.write(line + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
