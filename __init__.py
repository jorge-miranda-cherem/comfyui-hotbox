"""
Hotbox for ComfyUI
Open-source, context-aware hotbox with smart node auto-wiring, model swapping,
drag-to-pin bars, pro sliders, visual crop/paint editors (Alt+Z), label studio
(Alt+N), load-in-canvas (Alt+R) and a camera zoom toggle (.).
Frontend only: the extension lives in ./js and adds no Python nodes.
"""

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
