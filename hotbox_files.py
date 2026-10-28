"""
Where Hotbox keeps its preferences: <ComfyUI>/user/<user>/hotbox by default (the same folder on Windows,
macOS and Linux, since it lives inside ComfyUI), or any folder picked in Settings. The pick is remembered
in folder.json inside the default folder. Only Hotbox's own JSON files are ever read or written.
"""
import json
import os
import re
import shutil
import sys

from aiohttp import web

NAME_RE = re.compile(r"^(?:hotbox(?:_v\d+)?|active)\.json$")
POINTER = "folder.json"


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
