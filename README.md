# Hotbox for ComfyUI

A fast, Nuke/Maya-style **context-aware hotbox** for ComfyUI. Press <kbd>`</kbd> over any node and the actions that make sense for *that* node bloom around your cursor: add and auto-wire the next node, swap models in place, scrub numeric widgets, recolor, crop, pin your favorite nodes and more.

Zero dependencies and no Python nodes — it just makes the canvas faster to drive. (A tiny Python helper only serves its preferences folder.)

---

## ✨ Highlights

- **Three styles** (switch live with <kbd>Tab</kbd>):
  - **Fluid** (default) — frosted glass panels, spring motion that blooms from the cursor, sliding hover highlights and iOS-style sliders.
  - **Compact** — the same Fluid look and motion, bars only (no side cards).
  - **Quiet** — native ComfyUI panels, monospace key hints, fast fades (optional leader lines from the cursor to each zone).
- **The big blue `+`** sits right beside the bottom bar. Hover it and the four categories fan out (`All Nodes F` · `Image / Video Kit N` · `Models & APIs A` · `Subgraphs U`); click it for All Nodes. Drag any result onto any bar to pin it, or **drop it on the `+`** to pin it to the bottom bar.
- **A dock shortcut you choose.** The button at the end of the top dock opens one category (Models by default); its `▾` swaps it for the Kit, Subgraphs or All Nodes — or hides it.
- **Drag a node onto the bar to pin it.** Grab any node by its title while the hotbox is open and drop it on the bottom bar (or the `+`). The node stays where it was; its type becomes a one-click button for that context.
- **Save as Button.** Select any nodes (one or many, or a group) and press **Save as Button** (<kbd>X</kbd>): a copy of them melts into one button in the bottom bar, and the nodes themselves stay where they are. Click the button to add those nodes again by the cursor, or drag it onto the canvas to add them right there — settings and inner wires come back exactly as they were. The button is named after what the nodes do (`Flux · Text to Image`, `Wan · Image to Video`, `Upscale`…) and saved with the rest of your preferences.
- **Group with `G`.** Press <kbd>G</kbd> in the hotbox to group the selection (or the node under the cursor). It uses ComfyUI's own Group Selected Nodes, so the title editor opens right away, already holding a name read from the nodes, like a saved button's.
- **Swap Nodes.** Select two nodes and press **Swap Nodes** (<kbd>W</kbd>): they trade places and wires, like Ctrl+Shift-dragging a node in Nuke.
- **Customize every bar, iOS style.** Long-press any button (or click the ✎ icon) to enter edit mode: buttons jiggle, tap **×** or drag a button out to remove it, drag to reorder, tap a button to rename it. **Reset** restores the defaults, **Done** / <kbd>Esc</kbd> / a click on the canvas exits.
- **Works with both node renderers** — Nodes 2.0 (Vue) and the classic LiteGraph canvas.

---

## 🧭 Layout

| Zone | What lives there |
| :--- | :--- |
| **Top dock** | `[1]`–`[5]` smart suggestions for the node under the cursor (they add & auto-wire, or *swap* when an API/model node is selected) + your dock shortcut (`★ Models ▾` by default). |
| **Context bar** | Tools for the node type — e.g. on a crop node: **Visual Crop `Z`**, **Super Stitch** and an aspect-ratio switch (`Free · 1:1 · 16:9 · 9:16 · 4:3 · 3:4`). On a `Label (rgthree)` it becomes the **Label bar**: text, color, quick icon, top shine, corners, size, spacing and font, all live. Extensions can add their own controls here too ([CUSTOM_BAR.md](CUSTOM_BAR.md)). |
| **Left card** | `Rename F2` · `Add Label L` · `Magnifier / Visual Crop / Paint Z` · `Add Reroute R` · `Set / Get Bus S` · `Group G` + node color swatches and a custom color picker. On the bare canvas it lists a **Get** for every Set bus in the workflow, dropped where you opened the hotbox. |
| **Right card** | **Pro Sliders** for the node's numeric widgets (drag to scrub, <kbd>Shift</kbd> fine, <kbd>Ctrl</kbd>+click previous value, double-click default, wheel to nudge, click the value to type). Four show at once; more scroll inside the card. |
| **Custom Bar** | Controls other extensions hand to the hotbox, right above the bottom bar (see [Custom Bar](#-custom-bar-for-extension-authors)). Not there when nothing registered one. |
| **Bottom bar** | `Load in Canvas V` (on Preview, Save Image and Save Video nodes) · `Preview T` · `Seed mode P` · `Bypass B` · `Zoom .` · `Bypass All APIs K` (when the workflow has API nodes) · `Swap Nodes W` (two nodes selected) · `Save as Button X` · `Render Selected ⇧R` + your pinned nodes and saved buttons, the edit and settings buttons, and the `+` with its category dial. |

---

## 🧠 Context-aware behavior

- **Empty canvas** — quick spawners (`Load Image`, `Load Checkpoint`, `KSampler`, …) and labels.
- **Any node** — the dock suggests nodes that accept its outputs (multi-slot aware: a checkpoint loader suggests nodes for `MODEL` *and* `CLIP`) and wires them on click. It never offers the node you are standing on again, unless it is the kind that chains (LoRA loaders, ControlNet apply, conditioning combine…), and it never offers deprecated nodes. A **LoRA** added after a checkpoint or another LoRA joins the chain: it takes their `MODEL` and `CLIP`, and whatever they fed now hangs off the new LoRA. New nodes never land on another node: they step right or down, whichever is shorter.
- **API nodes and subgraphs** — saving comes first: **Save Video** when they output video, **Save Image** / Preview when they output images. Video and image generators keep separate bars, and a model only swaps to models of the same kind.
- **Image / video loaders** — `[1]`–`[5]` add the model to the right and auto-wire `IMAGE` / `VIDEO` / `MASK`. A `LoadImage` node also offers **Read PNG metadata** (load workflow, copy seed).
- **Two loaders selected** — the model is wired to both (reference + target / first + last frame), plus **Compare A/B**.
- **Model / API node selected** — `[1]`–`[5]` **swap the model in place** (the new node keeps the old one's spot), carrying over shared widgets (`prompt`, `seed`, `aspect_ratio`, …) and reconnecting links.
- **Crop node** — **Visual Crop editor** and **Super Stitch** (below).
- **Stitch node** — **Update Stitch** (re-read the crop) and **Swap FG / BG**.

### Super Stitch
Press it on a crop, on the plate it cuts, or on a result that came out of a crop. It adds a **fit** (`ImageScale`, bicubic, crop disabled) that sizes your result back to the crop box, and an `ImageCompositeMasked` that pastes it at the crop's `x / y` with the plate as destination. Several crops of one plate make **one chain**, a crop is never stitched twice, a preview closes the chain, an empty **apinode / localmodel** group marks where the model goes, and every stitch **keeps following its crop** when you move or resize it.

### Save as Button
The animation follows your style: **Fluid** pulls the nodes together into one card that falls into the bar, **Compact** shrinks the selection box into the button, **Quiet** dissolves the nodes into a soft bloom. Adding them back follows it too: **Fluid** springs the nodes out of the button one after another, **Compact** inflates them in place like little balloons with a soft bounce, **Quiet** just pops them in. Nothing is deleted: the nodes step aside while the button forms and come back once it lands. Every saved button is listed in **Settings → Saved Buttons** and under **Saved Buttons** in the Tools drawer, where it can be dragged onto any bar or onto the canvas, or deleted (two clicks on the trash). Rename one in edit mode.

### Image & Video Kit (`N`)
Crop (+ preview), Super Stitch, Resize (`ImageResizeKJv2`, `ImageResize+`, `ImageScaleBy`, `ImageScale`), Flip, Paint Mask/Plate, Compare A/B, Preview / Save Image, Framehold, Video → Frames, Create Video, Save Video, Set / Get nodes, Reroutes and labels — each spawned and wired to the current selection in one click.

---

## ⌨️ Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>`</kbd> | Open / close the hotbox (rebindable; toggle or hold-and-release mode). |
| <kbd>Tab</kbd> | Switch style (Fluid → Compact → Quiet) while the hotbox is open. |
| <kbd>1</kbd>–<kbd>9</kbd> | Run the matching dock button. |
| <kbd>+</kbd> / <kbd>F</kbd> · <kbd>N</kbd> · <kbd>A</kbd> · <kbd>U</kbd> | Add drawer: all nodes · image/video kit · models & APIs · subgraphs. |
| <kbd>G</kbd> | Group the selection (or the node under the cursor) and name it. |
| <kbd>Esc</kbd> | Leave edit mode, or close the hotbox. |
| <kbd>Alt</kbd>+<kbd>Z</kbd> | **Magnifier** — big live prompt editor · **Visual Crop editor** on crop nodes · **Paint Studio** on paint / `LoadImage` nodes. |
| <kbd>Alt</kbd>+<kbd>N</kbd> | **Label Studio** — rich canvas titles/notes (`Label (rgthree)` when installed, otherwise `MarkdownNote` / `Note` / `Group`). |
| <kbd>Alt</kbd>+<kbd>R</kbd> | **Load in Canvas** — hand the selected node's render to a new `Load Image` (or `Load Video` for videos). |
| <kbd>Shift</kbd>+<kbd>R</kbd> | **Render Selected** — queue only the selected output nodes (or the outputs downstream of the selection). Nothing selected renders nothing. |
| <kbd>.</kbd> | Frame the selected node(s); press again to return to the previous view. |

While the hotbox is open it owns these keys, so other extensions (or ComfyUI keybindings) on the same keys don't fire at the same time.

### Power Tools
Magnifier / Visual Crop / Paint Studio, Label Studio, Load in Canvas, Render Selected, Super Stitch, Swap Nodes, Save as Button, Bypass All APIs and Zoom to Selection are listed in **Settings → Power Tools** (hover one for what it does). **Drag any of them straight onto a hotbox bar**; a pinned tool only shows up on the nodes it works on.

---

## 📦 Installation

**ComfyUI Manager / Comfy Registry:** search for **Hotbox**.

**Manual:**

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/jorge-miranda-cherem/comfyui-hotbox.git
```

Restart ComfyUI and refresh the browser. Look for the **H** button in the top bar: click it for settings (hotkey, toggle vs. hold, style, edit-mode animation, canvas dim or leader lines, UI scale, bar spacing, power tools, saved buttons, where your preferences are saved), right-click it to enable or disable the hotbox.

### Your preferences file
Everything you change — moved and pinned buttons, bars, labels, saved buttons and settings — is saved to one file in ComfyUI's user folder, the same place on Windows, macOS and Linux:

```
ComfyUI/user/default/hotbox/hotbox.json
```

**Settings → Saved In** shows its full path (**Copy Path** and **Copy Folder Path** put it on the clipboard), and **Change Folder** moves Hotbox to any other folder (a synced drive, a team folder…): Hotbox files already there are used as they are, otherwise yours are copied in. Because it lives with ComfyUI (not in the browser), your setup follows you to any browser and survives clearing the cache.

`hotbox.json` is your **Original** and an import never overwrites it: **Import .json** always adds a **new version** (`hotbox_v2.json`, `hotbox_v3.json`, …) and switches to it, and the **Version** button in Settings steps back to the Original any time. **Export .json** downloads a dated copy of the version in use (`hotbox_original_2026-10-22_0915.json`). A browser that still has preferences from an older Hotbox moves them into the file the first time it loads.

> Upgrading from *Super Hotbox*? Your settings are picked up automatically. Remove the old `super_hotbox` folder from `custom_nodes` so the two don't load side by side.

---

## 🧩 Custom Bar (for extension authors)

Any extension can put its own controls in the hotbox, drawn in the hotbox style: buttons, groups with a caption, menus with a filter, selects, text and number fields (with ▲ ▼), sliders, color swatches, segmented switches, toggles and info text. They go in the **Custom Bar** (right above the bottom bar) or in the **Context bar** (`where: 'context'`), and follow the current style.

```js
window.__hotboxBars = window.__hotboxBars || {};
window.__hotboxBars['my-tool'] = {
  name: 'My Tool',                       // small tag at the start of the row (optional)
  where: 'bottom',                       // or 'context'
  items: function (ctx) {                // asked every time the hotbox paints
    if (!ctx.node) return [];            // ctx.node: the node under the hotbox · ctx.nodes: the selection
    return [
      { type: 'group', label: 'output', items: [
        { label: 'exr', icon: 'save', run: function () { /* … */ } },
        { label: 'image', icon: 'save', run: function () { /* … */ } }
      ] },
      { type: 'select', icon: 'seed', value: 'randomize', options: ['fixed', 'increment', 'decrement', 'randomize'],
        onChange: function (mode) { /* … */ } }
    ];
  }
};
```

The whole contract (every item type, how each one behaves, icons, style rules and a worked example) is in **[CUSTOM_BAR.md](CUSTOM_BAR.md)**. Hotbox also fires `hotbox:open` and `hotbox:close` on `window`, so a tool that shows the same buttons elsewhere can step aside while the hotbox is up.

---

## 🛠️ Development

Everything is in [`js/hotbox.js`](js/hotbox.js): plain ES5-style JavaScript, DOM built from strings, styles injected as one stylesheet, motion done with CSS transitions and the Web Animations API. No build step — edit, refresh the browser. [`hotbox_files.py`](hotbox_files.py) serves the preferences folder (restart ComfyUI after changing it); without it Hotbox falls back to ComfyUI's user-data API.

---

## 📄 License

[MIT](LICENSE)
