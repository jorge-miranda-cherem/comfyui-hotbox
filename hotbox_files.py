"""
Where Hotbox keeps its preferences, by default:
- the folder in the HOTBOX_DIR environment variable, when it is set (any system);
- on Linux, ~/comfyui/hotbox in the home folder of whoever runs ComfyUI, outside ComfyUI so it survives
  reinstalling it (a ComfyUI shared by several users keeps one folder per user, below);
- otherwise ComfyUI's user folder, <ComfyUI>/user/<user>/hotbox.
Files already in ComfyUI's user folder are copied into the new default the first time it is used, so moving
to it loses nothing. Any other folder can be picked in Settings (Set Project): the pick is remembered in
folder.json inside the default folder, with the last projects used, so Settings switches back to one in a click.
Only Hotbox's own JSON files are ever read or written.

Shared libraries: other folders (a studio's shared drive, one per show) whose saved buttons show up beside
the user's own, one JSON file per button so a synced drive never has two people writing the same file. The
list is kept in libraries.json in the default folder, set from Settings or by a script (POST
/hotbox/libraries), plus any read-only folders in the HOTBOX_EXTRA_PATHS environment variable (separated
like PATH). Only folders on that list are read, and only <button id>.json files are ever written there,
and only over a file that is already a saved Hotbox button: any other JSON of the same name is left alone.

Which folders are used is decided on the computer running ComfyUI: Set Project (POST /hotbox/folder) and
the list of shared libraries (POST /hotbox/libraries) answer only requests from that computer (a loopback
address, or the address ComfyUI itself answers on). From any other computer, or through a proxy, they
answer 403, so a ComfyUI started with --listen never lets someone else point Hotbox at a folder. Everything
else keeps working from anywhere, inside the folders already set.

Get Workflow (GET /hotbox/workflow) reads the workflow that made a file given by its path: the _ui.json saved
beside EXR frames, the text of a PNG, the metadata of an MP4 / MOV. It only reads, only those, and only the
workflow in them, and like Set Project it answers only the computer running ComfyUI.
"""
import ipaddress
import json
import logging
import os
import re
import shutil
import struct
import sys
import zlib

from aiohttp import web

NAME_RE = re.compile(r"^(?:hotbox(?:_v\d+)?|active|prompt_history)\.json$")
POINTER = "folder.json"
LIBS = "libraries.json"
BUTTON_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
MAX_BUTTON_BYTES = 8 * 1024 * 1024
MAX_BUTTONS = 400
MAX_RECENT = 8


def _server():
    from server import PromptServer
    return PromptServer.instance


def _same(a, b):
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


PROXY_HEADERS = ("Forwarded", "X-Forwarded-For", "X-Real-IP")


def _ip(raw):
    try:
        ip = ipaddress.ip_address(str(raw or "").split("%")[0])
    except ValueError:
        return None
    if ip.version == 6 and ip.ipv4_mapped:
        return ip.ipv4_mapped
    return ip


def is_same_machine(request):
    """True for a request from the computer running ComfyUI: a loopback address, or the address ComfyUI
    itself answers on (the machine's own network address). A request that came through a proxy counts as
    another computer, since the proxy's own address says nothing about who is behind it."""
    if any(h in request.headers for h in PROXY_HEADERS):
        return False
    peer = _ip(request.remote)
    if peer is None:
        return False
    if peer.is_loopback:
        return True
    try:
        own = request.transport.get_extra_info("sockname") if request.transport else None
    except Exception:
        own = None
    return bool(own) and _ip(own[0]) == peer


def _only_here(request, what):
    """None on the computer running ComfyUI; from anywhere else, the 403 that says why"""
    if is_same_machine(request):
        return None
    msg = what + " can only be changed on the computer running ComfyUI"
    return web.json_response({"error": msg, "errors": [msg]}, status=403)


HOME_DIR = os.path.join("~", "comfyui", "hotbox")
_MOVED_IN = set()


def _comfy_dir(request):
    """ComfyUI's own user folder for Hotbox: <ComfyUI>/user/<user>/hotbox"""
    path = _server().user_manager.get_request_user_filepath(request, "hotbox")
    if path is None:
        raise web.HTTPForbidden(text="No user folder for this request")
    return path


def _home_dir(request):
    """HOTBOX_DIR when set; on Linux ~/comfyui/hotbox for a ComfyUI with one user; '' to keep ComfyUI's folder"""
    env = str(os.environ.get("HOTBOX_DIR") or "").strip()
    if env and os.path.isabs(os.path.expanduser(env)):
        return _norm(env)
    if not sys.platform.startswith("linux"):
        return ""
    try:
        if _server().user_manager.get_request_user_id(request) != "default":
            return ""   # several users on one ComfyUI: one folder each, in ComfyUI's user folder
    except Exception:
        return ""
    return _norm(HOME_DIR)


def _hotbox_files(folder):
    try:
        return [n for n in sorted(os.listdir(folder)) if NAME_RE.match(n) or n in (POINTER, LIBS)]
    except OSError:
        return []


def _move_in(old, new):
    """the first time a new default folder is used, what Hotbox had in ComfyUI's user folder is copied there
    (copied, not moved: the old files stay as they were)"""
    key = (old, new)
    if key in _MOVED_IN or _same(old, new):
        return
    if not _hotbox_files(new):
        for name in _hotbox_files(old):
            shutil.copy2(os.path.join(old, name), os.path.join(new, name))
    _MOVED_IN.add(key)


def default_dir(request):
    old = _comfy_dir(request)
    home = _home_dir(request)
    if home:
        try:
            os.makedirs(home, exist_ok=True)
            _move_in(old, home)
            return home
        except OSError as e:
            if home not in _MOVED_IN:
                _MOVED_IN.add(home)
                logging.warning("[Hotbox] cannot use %s (%s), using %s", home, e, old)
    os.makedirs(old, exist_ok=True)
    return old


def _pointer(base):
    try:
        with open(os.path.join(base, POINTER), encoding="utf-8") as f:
            raw = json.load(f)
        return raw if isinstance(raw, dict) else {}
    except (OSError, ValueError):
        return {}


def chosen_dir(base):
    """The folder picked in Settings, or '' for the default one."""
    return str(_pointer(base).get("folder") or "")


def recent_dirs(base):
    """The project folders used last, newest first (never the default folder, which is always offered)"""
    out = []
    for p in _pointer(base).get("recent") or []:
        if isinstance(p, str) and os.path.isabs(p) and not _same(p, base) and not any(_same(p, o) for o in out):
            out.append(p)
    return out[:MAX_RECENT]


def _write_pointer(base, folder, recent):
    path = os.path.join(base, POINTER)
    if not folder and not recent:
        if os.path.exists(path):
            os.remove(path)
        return
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"folder": folder or "", "recent": recent[:MAX_RECENT]}, f, indent=2)
    os.replace(tmp, path)


def _clean_path(raw):
    """a path as people paste it: quoted (Windows' Copy as path), with ~, or the hotbox.json itself"""
    p = str(raw or "").strip()
    if len(p) > 1 and p[0] == p[-1] and p[0] in "\"'":
        p = p[1:-1].strip()
    p = os.path.expanduser(p)
    if p and NAME_RE.match(os.path.basename(p)) and not os.path.isdir(p):
        p = os.path.dirname(p)
    return p


def current_dir(request):
    """(folder in use, default folder, picked folder that is missing right now)"""
    base = default_dir(request)
    pick = chosen_dir(base)
    if pick and os.path.isdir(pick):
        return pick, base, ""
    return base, base, pick


def _file_path(request):
    name = request.match_info.get("name", "")
    if not NAME_RE.match(name):
        raise web.HTTPBadRequest(text="Not a Hotbox file name: " + name)
    return os.path.join(current_dir(request)[0], name)


def _folder_info(request, **extra):
    cur, base, missing = current_dir(request)
    recent = [{"path": p, "prefs": os.path.isfile(os.path.join(p, "hotbox.json"))}
              for p in recent_dirs(base) if not _same(p, cur) and os.path.isdir(p)]
    info = {"folder": cur, "default": base, "custom": not _same(cur, base), "missing": missing,
            "sep": os.sep, "platform": sys.platform, "recent": recent}
    info.update(extra)
    return web.json_response(info)


def _norm(path):
    return os.path.normpath(os.path.abspath(os.path.expanduser(str(path))))


def _env_libraries():
    out = []
    for p in str(os.environ.get("HOTBOX_EXTRA_PATHS") or "").split(os.pathsep):
        p = p.strip()
        if p and os.path.isabs(os.path.expanduser(p)):
            out.append({"path": _norm(p), "label": os.path.basename(_norm(p)) or p, "readOnly": True, "env": True})
    return out


def _saved_libraries(base):
    try:
        with open(os.path.join(base, LIBS), encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, ValueError):
        return []
    out = []
    for l in (raw.get("libraries") if isinstance(raw, dict) else raw) or []:
        if isinstance(l, dict) and l.get("path"):
            path = _norm(l["path"])
            out.append({"path": path, "label": str(l.get("label") or os.path.basename(path) or path),
                        "readOnly": bool(l.get("readOnly", True)), "env": False})
    return out


def _write_libraries(base, libs):
    keep = [{"path": l["path"], "label": l["label"], "readOnly": l["readOnly"]} for l in libs if not l.get("env")]
    tmp = os.path.join(base, LIBS + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"libraries": keep}, f, indent=2)
    os.replace(tmp, os.path.join(base, LIBS))


def all_libraries(request):
    """the folders set by the environment first, then the user's own; a folder is listed once"""
    out = []
    for l in _env_libraries() + _saved_libraries(default_dir(request)):
        if not any(_same(l["path"], o["path"]) for o in out):
            out.append(l)
    return out


def _library(request):
    path = request.query.get("path", "")
    for l in all_libraries(request):
        if path and _same(l["path"], path):
            return l
    raise web.HTTPForbidden(text="Not a Hotbox library: " + path)


def _button(raw, fallback_id):
    """a saved button as Settings and the bars use it, or None for any other JSON"""
    if not isinstance(raw, dict) or not isinstance(raw.get("data"), dict) or not isinstance(raw["data"].get("nodes"), list):
        return None
    bid = str(raw.get("id") or fallback_id)
    if not BUTTON_ID_RE.match(bid):
        bid = re.sub(r"[^A-Za-z0-9_-]", "_", bid)[:80] or "button"
    nodes = raw["data"]["nodes"]
    return {"id": bid, "name": str(raw.get("name") or bid), "count": int(raw.get("count") or len(nodes)),
            "at": str(raw.get("at") or ""), "data": raw["data"]}


def _is_button_file(path):
    """True when path is a saved Hotbox button: the only kind of file a library write or delete may touch"""
    if os.path.islink(path) or not os.path.isfile(path):
        return False
    try:
        if os.path.getsize(path) > MAX_BUTTON_BYTES:
            return False
        with open(path, encoding="utf-8") as f:
            return _button(json.load(f), "button") is not None
    except (OSError, ValueError):
        return False


def library_buttons(folder):
    """every saved button in a library folder: one <id>.json per button, and the saved buttons of a hotbox.json"""
    out, seen = [], set()
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        return out
    for name in names:
        if len(out) >= MAX_BUTTONS:
            break
        full = os.path.join(folder, name)
        if not name.lower().endswith(".json") or name in (POINTER, LIBS) or not os.path.isfile(full):
            continue
        if NAME_RE.match(name) and name != "hotbox.json":
            continue
        try:
            if os.path.getsize(full) > MAX_BUTTON_BYTES:
                continue
            with open(full, encoding="utf-8") as f:
                raw = json.load(f)
        except (OSError, ValueError):
            continue
        if name == "hotbox.json":
            cfg = raw.get("settings", raw) if isinstance(raw, dict) else {}
            found = [(_button(t, "t%d" % i), False) for i, t in enumerate(cfg.get("templates") or [])]
        else:
            found = [(_button(raw, name[:-5]), True)]
        for b, own_file in found:
            if b and b["id"] not in seen:
                seen.add(b["id"])
                b["file"] = own_file
                out.append(b)
    return out


def _library_info(l, buttons):
    exists = os.path.isdir(l["path"])
    info = {"path": l["path"], "label": l["label"], "readOnly": l["readOnly"], "env": l.get("env", False), "exists": exists}
    if buttons:
        info["buttons"] = library_buttons(l["path"]) if exists else []
        info["count"] = len(info["buttons"])
    return info


# ---- Get Workflow: the workflow that made a file, read by its path
WF_VIDEO = (".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mxf")
WF_ISO = (".mp4", ".mov", ".m4v")
WF_MAX = 64 * 1024 * 1024
FRAME_RE = re.compile(r"%0?(\d*)d|#+|\$F(\d*)")


def _wf_json(path):
    """A _ui.json: the workflow (and prompt) ComfyUI saved beside the frames"""
    name = os.path.basename(path)
    if os.path.getsize(path) > WF_MAX:
        raise ValueError(name + " is too big to be a workflow")
    with open(path, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except ValueError:
            raise ValueError(name + " is not readable JSON")
    if isinstance(data, dict) and (data.get("workflow") or data.get("prompt")):
        return name, data.get("workflow"), data.get("prompt")
    if isinstance(data, dict) and data.get("nodes"):
        return name, data, None
    raise ValueError(name + " carries no nodes: it is not a workflow")


def _wf_png(path):
    """A PNG's text chunks (tEXt, iTXt): ComfyUI's save keeps workflow and prompt there. None without them"""
    found = {}
    with open(path, "rb") as f:
        if f.read(8) != b"\x89PNG\r\n\x1a\n":
            raise ValueError(os.path.basename(path) + " is not a PNG")
        while True:
            head = f.read(8)
            if len(head) < 8:
                break
            size, kind = struct.unpack(">I", head[:4])[0], head[4:8]
            if kind in (b"tEXt", b"iTXt") and size <= WF_MAX:
                body = f.read(size)
                f.seek(4, 1)
                cut = body.find(b"\x00")
                key, text = body[:cut].decode("latin-1"), body[cut + 1:]
                if kind == b"iTXt":
                    packed = text[:1] == b"\x01"
                    text = text[2:]
                    text = text[text.find(b"\x00") + 1:]
                    text = text[text.find(b"\x00") + 1:]
                    if packed:
                        text = zlib.decompress(text)
                if key in ("workflow", "prompt"):
                    found[key] = text.decode("utf-8", "replace")
            elif kind == b"IEND":
                break
            else:
                f.seek(size + 4, 1)
    out = {}
    for k, v in found.items():
        try:
            out[k] = json.loads(v)
        except ValueError:
            pass
    return (out.get("workflow"), out.get("prompt")) if out else None


def _iso_boxes(b, s, e):
    p = s
    while p + 8 <= e:
        size, head = struct.unpack(">I", b[p:p + 4])[0], 8
        if size == 1:
            if p + 16 > e:
                return
            size, head = struct.unpack(">Q", b[p + 8:p + 16])[0], 16
        elif size == 0:
            size = e - p
        if size < head or p + size > e:
            return
        yield b[p + 4:p + 8], p + head, p + size, p
        p += size


def _wf_iso(path):
    """An MP4 / MOV's metadata: the keys and ilst items under moov (a comment may hold both). None without them"""
    moov = None
    with open(path, "rb") as f:
        f.seek(0, 2)
        end, p = f.tell(), 0
        while p + 8 <= end:
            f.seek(p)
            head = f.read(16)
            if len(head) < 8:
                break
            size, kind, hs = struct.unpack(">I", head[:4])[0], head[4:8], 8
            if size == 1 and len(head) >= 16:
                size, hs = struct.unpack(">Q", head[8:16])[0], 16
            elif size == 0:
                size = end - p
            if size < hs:
                break
            if kind == b"moov":
                if size > WF_MAX:
                    raise ValueError(os.path.basename(path) + ": its metadata is too big to read")
                f.seek(p)
                moov = f.read(size)
                break
            p += size
    if not moov:
        return None
    recs = []

    def meta(s, e):
        st = s + 4 if (s + 12 <= e and moov[s + 4:s + 8] != b"hdlr") else s
        keys = []
        for kind, cs, ce, _ in _iso_boxes(moov, st, e):
            if kind == b"keys" and cs + 8 <= ce:
                n, q = struct.unpack(">I", moov[cs + 4:cs + 8])[0], cs + 8
                for _i in range(n):
                    if q + 8 > ce:
                        break
                    ks = struct.unpack(">I", moov[q:q + 4])[0]
                    if ks < 8 or q + ks > ce:
                        break
                    keys.append(moov[q + 8:q + ks].decode("utf-8", "replace"))
                    q += ks
            elif kind == b"ilst":
                for item, ics, ice, ip in _iso_boxes(moov, cs, ce):
                    idx = struct.unpack(">I", moov[ip + 4:ip + 8])[0]
                    for dk, dcs, dce, _ in _iso_boxes(moov, ics, ice):
                        if dk == b"data" and dce >= dcs + 8:
                            key = keys[idx - 1] if 1 <= idx <= len(keys) else item.decode("latin-1")
                            recs.append((key, moov[dcs + 8:dce].decode("utf-8", "replace")))

    hs = 16 if struct.unpack(">I", moov[:4])[0] == 1 else 8
    for kind, cs, ce, _ in _iso_boxes(moov, hs, len(moov)):
        if kind == b"meta":
            meta(cs, ce)
        elif kind == b"udta":
            for k3, cs3, ce3, _ in _iso_boxes(moov, cs, ce):
                if k3 == b"meta":
                    meta(cs3, ce3)
    out = {}

    def take(k, v):
        if out.get(k) or not v:
            return
        try:
            out[k] = json.loads(v) if isinstance(v, str) else v
        except ValueError:
            pass

    for key, val in recs:
        k = key.lower()
        if k in ("workflow", "prompt"):
            take(k, val)
        elif k in ("comment", "\u00a9cmt"):
            try:
                j = json.loads(val)
            except ValueError:
                continue
            if isinstance(j, dict):
                take("workflow", j.get("workflow"))
                take("prompt", j.get("prompt"))
    return (out.get("workflow"), out.get("prompt")) if out else None


def _newest(folder, rx):
    """The newest file in folder whose name matches rx"""
    try:
        names = [n for n in os.listdir(folder) if rx.match(n)]
    except OSError:
        return ""
    paths = [os.path.join(folder, n) for n in names]
    paths = [p for p in paths if os.path.isfile(p)]
    return max(paths, key=os.path.getmtime) if paths else ""


def _ui_json_near(path):
    """A _ui.json of the same frames, whichever frame it sits beside: shot.%04d.exr, shot.####.exr, shot.1001.exr"""
    folder, base = os.path.split(path)
    m = re.match(r"^(.*?)(%0?\d*d|#+|\$F\d*)(.*?)\.[^.]+$", base)
    if m:
        rx = re.compile("^" + re.escape(m.group(1)) + r"\d+" + re.escape(m.group(3)) + r"_ui\.json$", re.I)
    else:
        f = re.match(r"^(.*?[._])\d+$", os.path.splitext(base)[0])
        if not f:
            return ""
        rx = re.compile("^" + re.escape(f.group(1)) + r"\d+_ui\.json$", re.I)
    return _newest(folder, rx)


def _at_frame(path, frame):
    def num(m):
        tok = m.group(0)
        if tok.startswith("#"):
            width = len(tok)
        else:
            pad = m.group(1) if tok.startswith("%") else m.group(2)
            width = int(pad) if pad and pad.isdigit() else 1
        return str(frame).zfill(width)
    return FRAME_RE.sub(num, path, count=1)


def workflow_of(raw, frame=None):
    """(file name, workflow, prompt) of what made the file at raw (a path, or one relative to ComfyUI's input
    folder: a still, a numbered frame, a sequence pattern, a folder of frames, a clip); ValueError says why not"""
    p = str(raw or "").strip()
    if not p:
        raise ValueError("No path given")
    if not os.path.isabs(p):
        import folder_paths
        p = os.path.join(folder_paths.get_input_directory(), p)
    p = os.path.normpath(p)
    if os.path.isdir(p):
        side = _newest(p, re.compile(r"^.+_ui\.json$", re.I))
        if side:
            return _wf_json(side)
        raise ValueError("No workflow: there is no _ui.json in " + os.path.basename(p) + ", so ComfyUI did not render these frames")
    base = os.path.basename(p)
    ext = os.path.splitext(base)[1].lower()
    if ext in WF_VIDEO:
        side = os.path.splitext(p)[0] + "_ui.json"
        if os.path.isfile(side):
            return _wf_json(side)
        if not os.path.isfile(p):
            raise ValueError("There is no " + base)
        got = _wf_iso(p) if ext in WF_ISO else None
        if got:
            return (base,) + got
        raise ValueError("No workflow: ComfyUI did not render this clip (no " + os.path.basename(side) + ", nothing in its metadata)")
    solid = p
    if FRAME_RE.search(base):
        solid = _at_frame(p, frame) if frame is not None else ""
    if solid and os.path.isfile(solid):
        if ext == ".png":
            got = _wf_png(solid)
            if got:
                return (os.path.basename(solid),) + got
        side = os.path.splitext(solid)[0] + "_ui.json"
        if os.path.isfile(side):
            return _wf_json(side)
    side = _ui_json_near(p)
    if side:
        return _wf_json(side)
    if ext == ".png" and solid and os.path.isfile(solid):
        raise ValueError(os.path.basename(solid) + " carries no workflow: it was not written by a ComfyUI save, or the metadata was stripped")
    if not os.path.isdir(os.path.dirname(p)):
        raise ValueError("There is no folder " + os.path.dirname(p))
    raise ValueError("No workflow: ComfyUI did not render " + base + " (no _ui.json of it in that folder)")


def setup(routes):
    @routes.get("/hotbox/workflow")
    async def get_workflow(request):
        """Get Workflow, for a file given by its path: what made it. Only on the computer running ComfyUI"""
        if not is_same_machine(request):
            msg = "A workflow is read by its path only on the computer running ComfyUI"
            return web.json_response({"ok": False, "error": msg}, status=403)
        frame = request.query.get("frame")
        try:
            frame = int(frame) if frame not in (None, "") else None
        except ValueError:
            frame = None
        try:
            name, wf, prompt = workflow_of(request.query.get("path"), frame)
        except (OSError, ValueError, zlib.error, struct.error) as e:
            return web.json_response({"ok": False, "error": str(e)})
        return web.json_response({"ok": True, "name": name, "workflow": wf, "prompt": prompt})

    @routes.get("/hotbox/folder")
    async def get_folder(request):
        return _folder_info(request)

    @routes.post("/hotbox/folder")
    async def set_folder(request):
        """Set Project: use another folder. Hotbox files already there are used as they are; otherwise the
        current ones are copied in, so nothing changes but the location ({copy: false} leaves it empty, for
        preferences loaded from a file to start it). An empty folder means the default. Only on the computer
        running ComfyUI."""
        refused = _only_here(request, "The project folder")
        if refused:
            return refused
        try:
            body = await request.json()
        except ValueError:
            body = {}
        want = _clean_path((body or {}).get("folder"))
        copy = (body or {}).get("copy", True) is not False
        cur, base, _ = current_dir(request)
        if want and not os.path.isabs(want):
            return web.json_response({"error": "Use a full path, like " + base}, status=400)
        target = os.path.abspath(want) if want else base
        if not os.path.isdir(target):
            if not os.path.isdir(os.path.dirname(target)):
                return web.json_response({"error": "That folder's parent does not exist: " + os.path.dirname(target)}, status=400)
            try:
                os.makedirs(target, exist_ok=True)
            except OSError as e:
                return web.json_response({"error": "Could not create the folder: " + str(e)}, status=400)
        found = os.path.isfile(os.path.join(target, "hotbox.json"))
        copied = []
        if copy and not _same(cur, target):
            for name in sorted(os.listdir(cur)):
                if NAME_RE.match(name) and not os.path.exists(os.path.join(target, name)):
                    try:
                        shutil.copy2(os.path.join(cur, name), os.path.join(target, name))
                        copied.append(name)
                    except OSError as e:
                        return web.json_response({"error": "Could not copy " + name + ": " + str(e)}, status=400)
        recent = [p for p in [target, cur] + recent_dirs(base) if not _same(p, base)]
        recent = [p for i, p in enumerate(recent) if not any(_same(p, q) for q in recent[:i])]
        _write_pointer(base, "" if _same(target, base) else target, recent)
        return _folder_info(request, found=found, copied=copied)

    @routes.get("/hotbox/libraries")
    async def get_libraries(request):
        buttons = request.query.get("buttons", "") not in ("", "0", "false")
        return web.json_response({"libraries": [_library_info(l, buttons) for l in all_libraries(request)],
                                  "sep": os.sep, "platform": sys.platform})

    @routes.post("/hotbox/libraries")
    async def set_libraries(request):
        """{add: [{path, label, readOnly}], remove: [path], update: [{path, label, readOnly}]}: the folders set by
        the environment stay as they are. Only on the computer running ComfyUI."""
        refused = _only_here(request, "The shared libraries")
        if refused:
            return refused
        try:
            body = await request.json()
        except ValueError:
            body = {}
        base = default_dir(request)
        libs = _saved_libraries(base)
        errors = []
        for p in (body or {}).get("remove") or []:
            libs = [l for l in libs if not _same(l["path"], str(p))]
        for u in (body or {}).get("update") or []:
            for l in libs:
                if isinstance(u, dict) and u.get("path") and _same(l["path"], u["path"]):
                    if "label" in u:
                        l["label"] = str(u["label"] or os.path.basename(l["path"]) or l["path"])
                    if "readOnly" in u:
                        l["readOnly"] = bool(u["readOnly"])
        for a in (body or {}).get("add") or []:
            a = a if isinstance(a, dict) else {"path": a}
            raw = os.path.expanduser(str(a.get("path") or "").strip())
            if not raw or not os.path.isabs(raw):
                errors.append("Use a full path: " + (raw or "(empty)"))
                continue
            path = _norm(raw)
            if any(_same(l["path"], path) for l in libs):
                continue
            libs.append({"path": path, "label": str(a.get("label") or os.path.basename(path) or path),
                         "readOnly": bool(a.get("readOnly", True)), "env": False})
        _write_libraries(base, libs)
        return web.json_response({"libraries": [_library_info(l, False) for l in all_libraries(request)], "errors": errors})

    @routes.post("/hotbox/library/button")
    async def write_library_button(request):
        lib = _library(request)
        bid = request.query.get("id", "")
        if lib["readOnly"] or lib.get("env"):
            return web.json_response({"error": "That library is read-only"}, status=403)
        if not BUTTON_ID_RE.match(bid):
            return web.json_response({"error": "Not a button id: " + bid}, status=400)
        if not os.path.isdir(lib["path"]):
            return web.json_response({"error": "That folder is not there right now: " + lib["path"]}, status=404)
        text = await request.text()
        try:
            raw = json.loads(text)
        except ValueError:
            return web.json_response({"error": "Not valid JSON"}, status=400)
        if not _button(raw, bid):
            return web.json_response({"error": "Not a saved button"}, status=400)
        path = os.path.join(lib["path"], bid + ".json")
        if os.path.lexists(path) and not _is_button_file(path):
            return web.json_response({"error": "Another file is already called " + bid + ".json there"}, status=409)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
        return web.json_response({"ok": True})

    @routes.delete("/hotbox/library/button")
    async def delete_library_button(request):
        lib = _library(request)
        bid = request.query.get("id", "")
        if lib["readOnly"] or lib.get("env"):
            return web.json_response({"error": "That library is read-only"}, status=403)
        if not BUTTON_ID_RE.match(bid):
            return web.json_response({"error": "Not a button id: " + bid}, status=400)
        path = os.path.join(lib["path"], bid + ".json")
        if os.path.lexists(path):
            if not _is_button_file(path):
                return web.json_response({"error": bid + ".json there is not a Hotbox button"}, status=409)
            os.remove(path)
        return web.json_response({"ok": True})

    @routes.get("/hotbox/files")
    async def list_files(request):
        cur = current_dir(request)[0]
        return web.json_response({"files": sorted(n for n in os.listdir(cur) if NAME_RE.match(n))})

    @routes.get("/hotbox/file/{name}")
    async def read_file(request):
        path = _file_path(request)
        if not os.path.isfile(path):
            return web.Response(status=404)
        with open(path, encoding="utf-8") as f:
            return web.Response(text=f.read(), content_type="application/json")

    @routes.post("/hotbox/file/{name}")
    async def write_file(request):
        path = _file_path(request)
        text = await request.text()
        try:
            json.loads(text)
        except ValueError:
            return web.json_response({"error": "Not valid JSON"}, status=400)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
        return web.json_response({"ok": True})
