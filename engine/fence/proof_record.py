#!/usr/bin/env python3
"""Writes the result of a fence proof to state/proof/last.json (CONTRACTS 7.3).
Called by prove.sh. Kept in its own file because bash 3.2 miscounts quotes in a
heredoc inside "$( )".

  proof_record.py <lines file> <out file> <result>

The lines file holds one `STATUS<TAB>text` line per check.
"""
import datetime
import json
import os
import sys


def main(argv):
    lines_file, out, result = argv
    lines = []
    with open(lines_file, "r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            raw = raw.rstrip("\n")
            if "\t" not in raw:
                continue
            status, text = raw.split("\t", 1)
            lines.append({"status": status, "text": text})
    record = {
        "ranAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "result": result,
        "passed": sum(1 for l in lines if l["status"] == "PASS"),
        "failed": sum(1 for l in lines if l["status"] == "FAIL"),
        "skipped": sum(1 for l in lines if l["status"] == "SKIP"),
        "lines": lines,
    }
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = "%s.%d.tmp" % (out, os.getpid())
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2)
        fh.write("\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
