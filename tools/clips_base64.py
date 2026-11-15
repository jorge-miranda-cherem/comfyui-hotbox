#!/usr/bin/env python3
"""The power tools browser's clips as text (base64).

Hotbox plays js/clips/<tool>.webm from the folder it was loaded from. Where Hotbox is baked into
another page and has no folder (a studio panel), the clips get there as text, by one of two roads:

    extras/hotbox_clips.js             for the page: a script that sets window.__hotboxClips =
                                       { <tool>: 'data:video/webm;base64,...' }, which Hotbox reads
                                       when it shows a clip. The clips travel inside the page.
    extras/hotbox_clips_to_folder.py   for the other machine: a Python script that writes the clips
                                       back as files into a folder there (Nuke's Script Editor runs
                                       it). The page then only tells Hotbox where that folder is.

    python tools/clips_base64.py                 write both from the clips in js/clips
    python tools/clips_base64.py --check         say whether both are up to date (exit 1 if not)
    python tools/clips_base64.py --one-file F    write F: hotbox.js with the clips after it, for a baker
                                                 that takes a single file
    python tools/clips_base64.py --folder-script F --folder /a/place
                                                 write F: the folder script with its folder already set,
                                                 a copy for one place (keep it out of the repository)

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
OUT_PY = os.path.join(ROOT, "extras", "hotbox_clips_to_folder.py")
WIDTH = 120


def clips():
    names = sorted(f for f in os.listdir(CLIPS) if f.lower().endswith(".webm"))
    if not names:
        raise SystemExit("no .webm clips in " + CLIPS)
    out = []
    for name in names:
        raw = io.open(os.path.join(CLIPS, name), "rb").read()
        b64 = base64.b64encode(raw).decode("ascii")
        out.append((os.path.splitext(name)[0], len(raw), [b64[i:i + WIDTH] for i in range(0, len(b64), WIDTH)]))
    return out


def clips_js(found):
    lines = [
        "/* Hotbox: the power tools browser's clips as text (base64), for a page that carries Hotbox without its",
        "   folder. Made from js/clips by tools/clips_base64.py: do not edit, run it again when a clip changes.",
        "   Load it before or after Hotbox; Hotbox reads window.__hotboxClips when it shows a clip. */",
        "(function () {",
        "  var C = window.__hotboxClips = window.__hotboxClips || {};",
        "  var P = 'data:video/webm;base64,';",
    ]
    for name, _size, rows in found:
        lines.append("  C[%s] = P + [" % json.dumps(name))
        lines.extend("    '%s'," % row for row in rows)
        lines.append("  ].join('');")
    lines.append("})();")
    return "\n".join(lines) + "\n"


PY_HEAD = '''# -*- coding: utf-8 -*-
"""Hotbox: the power tools browser's clips, back as files.

Made from js/clips by tools/clips_base64.py: do not edit, run that again when a clip changes.

It carries the %(count)d clips as text (base64) and writes them as <tool>.webm into a folder, for a
machine where Hotbox is baked into a page and its files cannot be copied over. Python 2.7 or 3,
standard library only.

    In Nuke:        paste it into the Script Editor and run it (it asks for the folder)
    In a terminal:  python hotbox_clips_to_folder.py [FOLDER]
    From a script:  import hotbox_clips_to_folder
                    hotbox_clips_to_folder.write_clips('/some/folder')

The folder is FOLDER below; left empty it is hotbox_clips in your home folder. A clip that is already
there and identical is left alone. Only <tool>.webm files of these names and clips.json, the list of
them for whoever reads the folder, are ever written; all are left readable by everyone.
"""
import base64
import json
import os
import sys

FOLDER = %(folder)r

CLIPS = {
'''

PY_TAIL = '''}


def default_folder():
    return os.path.abspath(os.path.expanduser(FOLDER or os.path.join('~', 'hotbox_clips')))


def write_clips(folder=None):
    """Writes every clip into `folder`, made if it is missing, and clips.json, the list of them:
    {"hotbox_clips": 1, "clips": [{"id": "lupa", "file": "lupa.webm", "bytes": 106300}, ...]}.
    Returns (folder, written, unchanged), the last two being lists of clip names."""
    folder = os.path.abspath(os.path.expanduser(folder)) if folder else default_folder()
    if not os.path.isdir(folder):
        os.makedirs(folder)
        _readable(folder, 0o055)
    written, unchanged, listed = [], [], []
    for name in sorted(CLIPS):
        data = base64.b64decode(''.join(CLIPS[name].split()).encode('ascii'))
        listed.append({'id': name, 'file': name + '.webm', 'bytes': len(data)})
        (written if _put(os.path.join(folder, name + '.webm'), data) else unchanged).append(name)
    index = json.dumps({'hotbox_clips': 1, 'clips': listed}, indent=1, sort_keys=True) + '\\n'
    _put(os.path.join(folder, 'clips.json'), index.encode('ascii'))
    return folder, written, unchanged


def _put(path, data):
    """Writes the file unless it already holds exactly this. True when it was written."""
    old = None
    if os.path.isfile(path):
        with open(path, 'rb') as f:
            old = f.read()
    if old != data:
        with open(path, 'wb') as f:
            f.write(data)
    _readable(path, 0o044)
    return old != data


def _readable(path, bits):
    """Others on a shared disk can read what was written, whatever this session's umask is."""
    try:
        os.chmod(path, os.stat(path).st_mode | bits)
    except OSError:
        pass


def main():
    try:
        import nuke
    except ImportError:
        nuke = None
    folder = None
    if nuke is None:
        # Nuke's own arguments are not ours to read: only a terminal's are
        args = [a for a in sys.argv[1:] if not a.startswith('-')]
        folder = args[0] if args else None
    elif getattr(nuke, 'GUI', False):
        folder = nuke.getInput('Folder for the Hotbox clips', default_folder())
        if not folder:
            sys.stdout.write('Hotbox clips: nothing written\\n')
            return None
    folder, written, unchanged = write_clips(folder)
    said = 'Hotbox clips: %d written, %d already there, in %s' % (len(written), len(unchanged), folder)
    sys.stdout.write(said + '\\n')
    if nuke is not None and getattr(nuke, 'GUI', False):
        nuke.message(said)
    return folder


# run as a file, or as text (pasted into a Script Editor); not when another script imports it
if __name__ == '__main__' or '__file__' not in globals():
    main()
'''


def clips_py(found, folder=""):
    parts = [PY_HEAD % {"count": len(found), "folder": str(folder or "")}]
    for name, _size, rows in found:
        parts.append("%r: '''\n%s\n''',\n" % (str(name), "\n".join(rows)))
    parts.append(PY_TAIL)
    return "".join(parts)


def main():
    ap = argparse.ArgumentParser(description="The power tools browser's clips as base64 text.")
    ap.add_argument("--check", action="store_true", help="only say whether the files in extras are up to date")
    ap.add_argument("--one-file", metavar="FILE", help="write hotbox.js with the clips after it to FILE")
    ap.add_argument("--folder-script", metavar="FILE", help="write the folder script to FILE, with --folder as its folder")
    ap.add_argument("--folder", metavar="PATH", default="", help="the folder the script of --folder-script writes into")
    args = ap.parse_args()
    found = clips()
    total = sum(size for _name, size, _rows in found)
    data = clips_js(found).encode("ascii")
    outs = [(OUT, data), (OUT_PY, clips_py(found).encode("ascii"))]

    if args.check:
        stale = 0
        for path, want in outs:
            have = io.open(path, "rb").read().replace(b"\r\n", b"\n") if os.path.exists(path) else b""
            ok = have == want
            stale += not ok
            print("extras/%s is %s (%d clips)" % (os.path.basename(path), "up to date" if ok else "OUT OF DATE: run tools/clips_base64.py", len(found)))
        return 1 if stale else 0

    if args.one_file:
        body = io.open(HOTBOX, "rb").read()
        with io.open(args.one_file, "wb") as f:
            f.write(body + b"\r\n" + data)
        print("wrote %s: hotbox.js (%d bytes) + %d clips as text (%d bytes)" % (args.one_file, len(body), len(found), len(data)))
        return 0

    if args.folder_script:
        text = clips_py(found, args.folder).encode("ascii")
        with io.open(args.folder_script, "wb") as f:
            f.write(text)
        print("wrote %s: %d clips as text (%d bytes), for the folder %s" % (args.folder_script, len(found), len(text), args.folder or "(asked for)"))
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    for path, want in outs:
        with io.open(path, "wb") as f:
            f.write(want)
        print("wrote extras/%s: %d clips, %d bytes of video as %d bytes of text" % (os.path.basename(path), len(found), total, len(want)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
