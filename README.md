# Hotbox for ComfyUI

A fast, Nuke/Maya-style **context-aware hotbox** for ComfyUI. Press <kbd>`</kbd> over any node and the actions that make sense for *that* node bloom around your cursor: add and auto-wire the next node, swap models in place, scrub numeric widgets, recolor, crop, pin your favorite nodes and more.

100% frontend, zero dependencies, no Python nodes — it just makes the canvas faster to drive.

---

## ✨ Highlights

- **Two looks, one layout** (switch live with <kbd>Tab</kbd>):
  - **Fluid** (default) — frosted glass panels, spring motion that blooms from the cursor, sliding hover highlights and iOS-style sliders.
  - **Quiet** — native ComfyUI panels, hairline leader lines from the cursor to each zone, monospace key hints, fast fades.
  - **Compact** — a minimal toolbar ring when you want the hotbox out of the way.
- **The big blue `+`** sits right beside the bottom bar. Click it (or press <kbd>+</kbd>) to search every installed node, tool, model and subgraph; drag any result onto any bar to pin it, or **drop it on the `+`** to pin it to the bottom bar.
- **Drag a node onto the bar to pin it.** Grab any node by its title while the hotbox is open and drop it on the bottom bar (or the `+`). The node stays where it was; its type becomes a one-click button for that context.
- **Customize every bar, iOS style.** Long-press any button (or click the ✎ icon) to enter edit mode: buttons jiggle, tap **×** or drag a button out to remove it, drag to reorder, tap a button to rename it. **Reset** restores the defaults, **Done** / <kbd>Esc</kbd> / a click on the canvas exits.
- **Works with both node renderers** — Nodes 2.0 (Vue) and the classic LiteGraph canvas.

---

## 🧭 Layout

| Zone | What lives there |
| :--- | :--- |
| **Top dock** | `[1]`–`[5]` smart suggestions for the node under the cursor (they add & auto-wire, or *swap* when an API/model node is selected) + `★ Models ▾`. |
| **Context bar** | Tools for the node type — e.g. on a crop node: **Visual Crop `Z`** and an aspect-ratio switch (`Free · 1:1 · 16:9 · 9:16 · 4:3 · 3:4`). |
| **Left card** | `Rename F2` · `Add Label L` · `Lupa / Visual Crop / Paint Z` · `Add Reroute R` · `Set / Get Bus S` + node color swatches and a custom color picker. |
| **Right column** | **Pro Sliders** for the node's numeric widgets (drag to scrub, <kbd>Shift</kbd> fine, <kbd>Ctrl</kbd>+click previous value, double-click default, wheel to nudge, click the value to type) + **Add & Customize** (`All Nodes F` · `Image / Video Kit N` · `Models & APIs A` · `Subgraphs G`). |
| **Bottom bar** | `Load in Canvas V` · `Preview T` · `Seed mode P` · `Bypass B` · `Zoom .` · `Kill APIs K` (when the workflow has API nodes) + your pinned nodes, the edit and settings buttons, and the `+`. |

---

## 🧠 Context-aware behavior

- **Empty canvas** — quick spawners (`Load Image`, `Load Checkpoint`, `KSampler`, …) and labels.
- **Any node** — the dock suggests nodes that accept its outputs (multi-slot aware: a checkpoint loader suggests nodes for `MODEL` *and* `CLIP`) and wires them on click.
- **Image / video loaders** — `[1]`–`[5]` add the model to the right and auto-wire `IMAGE` / `VIDEO` / `MASK`. A `LoadImage` node also offers **Read PNG metadata** (load workflow, copy seed).
- **Two loaders selected** — the model is wired to both (reference + target / first + last frame), plus **Compare A/B**.
- **Model / API node selected** — `[1]`–`[5]` **swap the model in place**, carrying over shared widgets (`prompt`, `seed`, `aspect_ratio`, …) and reconnecting links.
- **Crop node** — **Visual Crop editor** and **1-click Stitch Back** (`ImageScale` + `ImageCompositeMasked` onto the original plate).
- **Stitch node** — **Update coords from crop** and **Swap FG / BG**.

### Image & Video Kit (`N`)
Crop (+ preview), Stitch Back, Resize (`ImageResizeKJv2`, `ImageResize+`, `ImageScaleBy`, `ImageScale`), Flip, Paint Mask/Plate, Compare A/B, Preview / Save Image, Framehold, Video → Frames, Create Video, Save Video, Set / Get nodes, Reroutes and labels — each spawned and wired to the current selection in one click.

---

## ⌨️ Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>`</kbd> | Open / close the hotbox (rebindable; toggle or hold-and-release mode). |
| <kbd>Tab</kbd> | Switch style (Fluid → Quiet → Compact) while the hotbox is open. |
| <kbd>1</kbd>–<kbd>9</kbd> | Run the matching dock button. |
| <kbd>+</kbd> / <kbd>F</kbd> · <kbd>N</kbd> · <kbd>A</kbd> · <kbd>G</kbd> | Add drawer: all nodes · image/video kit · models & APIs · subgraphs. |
| <kbd>Esc</kbd> | Leave edit mode, or close the hotbox. |
| <kbd>Alt</kbd>+<kbd>Z</kbd> | **Lupa** big live prompt editor · **Visual Crop editor** on crop nodes · **Paint Studio** on paint / `LoadImage` nodes. |
| <kbd>Alt</kbd>+<kbd>N</kbd> | **Label Studio** — rich canvas titles/notes (`Label (rgthree)` when installed, otherwise `MarkdownNote` / `Note` / `Group`). |
| <kbd>Alt</kbd>+<kbd>R</kbd> | **Load in Canvas** — freeze the selected node's output into a new `LoadImage` node. |
| <kbd>.</kbd> | Frame the selected node(s); press again to return to the previous view. |

While the hotbox is open it owns these keys, so other extensions (or ComfyUI keybindings) on the same keys don't fire at the same time.

---

## 📦 Installation

**ComfyUI Manager / Comfy Registry:** search for **Hotbox**.

**Manual:**

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/jcherem/comfyui-hotbox.git
```

Restart ComfyUI and refresh the browser. Look for the **H** button in the top bar: click it for settings (hotkey, toggle vs. hold, style, edit-mode animation, canvas dim, leader lines, UI scale, bar spacing, power tools, import / export of your bars), right-click it to enable or disable the hotbox.

Settings live in the browser's `localStorage`. Use **Export / Import Settings** to move your bars between machines.

> Upgrading from *Super Hotbox*? Your settings are picked up automatically. Remove the old `super_hotbox` folder from `custom_nodes` so the two don't load side by side.

---

## 🛠️ Development

Everything is in [`js/hotbox.js`](js/hotbox.js): plain ES5-style JavaScript, DOM built from strings, styles injected as one stylesheet, motion done with CSS transitions and the Web Animations API. No build step — edit, refresh the browser.

---

## 📄 License

[MIT](LICENSE)
