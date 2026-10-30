"""
Where Hotbox keeps its preferences: <ComfyUI>/user/<user>/hotbox by default (the same folder on Windows,
macOS and Linux, since it lives inside ComfyUI), or any folder picked in Settings. The pick is remembered
in folder.json inside the default folder. Only Hotbox's own JSON files are ever read or written.

Shared libraries: other folders (a studio's shared drive, one per show) whose saved buttons show up beside
the user's own, one JSON file per button so a synced drive never has two people writing the same file. The
list is kept in libraries.json in the default folder, set from Settings or by a script (POST
/hotbox/libraries), plus any read-only folders in the HOTBOX_EXTRA_PATHS environment variable (separated
like PATH). Only folders on that list are read, and only <button id>.json files are ever written there.
"""
import json
import os
import re
import shutil
import sys

from aiohttp import web

NAME_RE = re.compile(r"^(?:hotbox(?:_v\d+)?|active)\.json$")
POINTER = "folder.json"
LIBS = "libraries.json"
BUTTON_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
MAX_BUTTON_BYTES = 8 * 1024 * 1024
MAX_BUTTONS = 400


def _server():
    from server import PromptServer
    return PromptServer.instance


def _same(a, b):
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def default_dir(request):
    path = _server().user_manager.get_request_user_filepath(request, "hotbox")
    if path is None:
        raise web.HTTPForbidden(text="No user folder for this request")
    os.makedirs(path, exist_ok=True)
    return path


def chosen_dir(base):
    """The folder picked in Settings, or '' for the default one."""
    try:
        with open(os.path.join(base, POINTER), encoding="utf-8") as f:
            return str(json.load(f).get("folder") or "")
    except (OSError, ValueError, AttributeError):
        return ""


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
    info = {"folder": cur, "default": base, "custom": not _same(cur, base), "missing": missing,
            "sep": os.sep, "platform": sys.platform}
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


def setup(routes):
    @routes.get("/hotbox/folder")
    async def get_folder(request):
        return _folder_info(request)

    @routes.post("/hotbox/folder")
    async def set_folder(request):
        """Use another folder. Hotbox files already there are used as they are; otherwise the current
        ones are copied in, so nothing changes but the location. An empty folder means the default."""
        try:
            body = await request.json()
        except ValueError:
            body = {}
        want = os.path.expanduser(str((body or {}).get("folder") or "").strip())
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
        if not _same(cur, target):
            for name in sorted(os.listdir(cur)):
                if NAME_RE.match(name) and not os.path.exists(os.path.join(target, name)):
                    try:
                        shutil.copy2(os.path.join(cur, name), os.path.join(target, name))
                        copied.append(name)
                    except OSError as e:
                        return web.json_response({"error": "Could not copy " + name + ": " + str(e)}, status=400)
        pointer = os.path.join(base, POINTER)
        if _same(target, base):
            if os.path.exists(pointer):
                os.remove(pointer)
        else:
            with open(pointer, "w", encoding="utf-8") as f:
                json.dump({"folder": target}, f, indent=2)
        return _folder_info(request, found=found, copied=copied)

    @routes.get("/hotbox/libraries")
    async def get_libraries(request):
        buttons = request.query.get("buttons", "") not in ("", "0", "false")
        return web.json_response({"libraries": [_library_info(l, buttons) for l in all_libraries(request)],
                                  "sep": os.sep, "platform": sys.platform})

    @routes.post("/hotbox/libraries")
    async def set_libraries(request):
        """{add: [{path, label, readOnly}], remove: [path], update: [{path, label, readOnly}]}: the folders set by
        the environment stay as they are"""
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
        if os.path.isfile(path):
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
