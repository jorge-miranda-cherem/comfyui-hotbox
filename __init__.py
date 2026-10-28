"""
Hotbox for ComfyUI
Open-source, context-aware hotbox with smart node auto-wiring, model swapping,
drag-to-pin bars, pro sliders, visual crop/paint editors (Alt+Z), label studio
(Alt+N), load-in-canvas (Alt+R) and a camera zoom toggle (.).
The extension lives in ./js and adds no Python nodes; hotbox_files.py only serves
its preferences folder (the default one, or one picked in Settings).
"""

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./js"

try:
    from server import PromptServer
    from . import hotbox_files

    hotbox_files.setup(PromptServer.instance.routes)
except Exception as e:  # the frontend falls back to ComfyUI's own user-data API
    print("[Hotbox] folder routes not loaded:", e)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
