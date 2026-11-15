#!/usr/bin/env python3
"""The power tools browser's clips as text (base64).

Hotbox plays js/clips/<tool>.webm from the folder it was loaded from. Where Hotbox is baked into
another page and has no folder (a studio panel), the clips travel as text instead: a script that
sets window.__hotboxClips = { <tool>: 'data:video/webm;base64,...' }, which Hotbox reads when it
shows a clip. This writes that script from the clips in js/clips.

    python tools/clips_base64.py                 write extras/hotbox_clips.js
    python tools/clips_base64.py --check         say whether extras/hotbox_clips.js is up to date (exit 1 if not)
    python tools/clips_base64.py --one-file F    write F: hotbox.js with the clips after it, for a baker
                                                 that takes a single file

Only the Python standard library; the same on Windows and Linux.
"""
import argparse
import base64
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIPS = os.path.join(ROOT, "js", "clips")
HOTBOX = os.path.join(ROOT, "js", "hotbox.js")
OUT = os.path.join(ROOT, "extras", "hotbox_clips.js")
WIDTH = 120


def clips_js():
    names = sorted(f for f in os.listdir(CLIPS) if f.lower().endswith(".webm"))
    if not names:
        raise SystemExit("no .webm clips in " + CLIPS)
    lines = [
        "/* Hotbox: the power tools browser's clips as text (base64), for a page that carries Hotbox without its",
        "   folder. Made from js/clips by tools/clips_base64.py: do not edit, run it again when a clip changes.",
        "   Load it before or after Hotbox; Hotbox reads window.__hotboxClips when it shows a clip. */",
        "(function () {",
        "  var C = window.__hotboxClips = window.__hotboxClips || {};",
        "  var P = 'data:video/webm;base64,';",
    ]
    total = 0
    for name in names:
        raw = io.open(os.path.join(CLIPS, name), "rb").read()
        total += len(raw)
        b64 = base64.b64encode(raw).decode("ascii")
        lines.append("  C[%s] = P + [" % json.dumps(os.path.splitext(name)[0]))
        lines.extend("    '%s'," % b64[i:i + WIDTH] for i in range(0, len(b64), WIDTH))
        lines.append("  ].join('');")
    lines.append("})();")
    return "\n".join(lines) + "\n", names, total


def main():
    ap = argparse.ArgumentParser(description="The power tools browser's clips as base64 text.")
    ap.add_argument("--check", action="store_true", help="only say whether extras/hotbox_clips.js is up to date")
    ap.add_argument("--one-file", metavar="FILE", help="write hotbox.js with the clips after it to FILE")
    args = ap.parse_args()
    text, names, total = clips_js()
    data = text.encode("ascii")

    if args.check:
        have = io.open(OUT, "rb").read().replace(b"\r\n", b"\n") if os.path.exists(OUT) else b""
        ok = have == data
        print("extras/hotbox_clips.js is %s (%d clips)" % ("up to date" if ok else "OUT OF DATE: run tools/clips_base64.py", len(names)))
        return 0 if ok else 1

    if args.one_file:
        body = io.open(HOTBOX, "rb").read()
        with io.open(args.one_file, "wb") as f:
            f.write(body + b"\r\n" + data)
        print("wrote %s: hotbox.js (%d bytes) + %d clips as text (%d bytes)" % (args.one_file, len(body), len(names), len(data)))
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "wb") as f:
        f.write(data)
    print("wrote extras/hotbox_clips.js: %d clips, %d bytes of video as %d bytes of text" % (len(names), total, len(data)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
