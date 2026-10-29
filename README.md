<p align="center"><img src="docs/media/hotbox-logo.webp" alt="Hotbox" width="340"></p>

<h3 align="center">Press <kbd>`</kbd> on any node. What comes next is already there.</h3>

<p align="center">A Maya / Nuke-style hotbox for ComfyUI: the next nodes, the node's own actions and your saved buttons, around your cursor.<br>Free and open source · no dependencies · works with Nodes 2.0 and the classic canvas.</p>

<p align="center"><img src="docs/media/same-workflow.webp" alt="The same workflow built twice in real time: 37.9 s in ComfyUI, 23.8 s with Hotbox" width="900"></p>
<p align="center"><sub>The same workflow built twice, timed from the recordings: 37.9 s in ComfyUI, 23.8 s with Hotbox (played at 4×).</sub></p>

---

## 📦 Installation

**ComfyUI Manager:** search for **Hotbox** and install.

**Or by hand:**

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/jorge-miranda-cherem/comfyui-hotbox.git
```

Restart ComfyUI, refresh the browser, and press <kbd>`</kbd> over any node. The **H** in the top bar opens Settings.

> Upgrading from *Super Hotbox*? Your settings are picked up automatically. Remove the old `super_hotbox` folder from `custom_nodes`.

---

## 🧭 Three bars

<p align="center"><img src="docs/media/hotbox-bars.png" alt="The hotbox open on a Load Image: the Dock on top, the Context bar under it, the Bottom bar below" width="900"></p>

- **Dock**: the nodes that fit next, numbered. Press <kbd>1</kbd>–<kbd>5</kbd> and the node lands already wired.
- **Context bar**: the actions for the node you're on (Crop, Resize, Paint, Compare…).
- **Bottom bar**: tools, the nodes you pinned and your saved buttons. Drag any node onto it to pin it.

---

## ✨ See it

### Every action has a hotkey

<img src="docs/media/hotkeys.webp" alt="Open the hotbox on a Load Image, C to crop, pick 16:9, Shift+R to render" width="100%">

<kbd>`</kbd> opens it, a letter runs an action (<kbd>C</kbd> crops), <kbd>Shift</kbd>+<kbd>R</kbd> renders only what you selected.

### Swap the model, keep the prompt

<img src="docs/media/swap-image-models.webp" alt="Nano Banana 2 swapped to Nano Banana Pro, GPT Image 2 and Grok, the prompt carried over" width="100%">

On a model node the Dock's numbers swap it in place, and <kbd>A</kbd> finds any other model. The prompt and every shared setting come along.

### Video models too

<img src="docs/media/swap-video-models.webp" alt="A video model swapped to Kling, Seedance and Seedance 2.0, the prompt carried over" width="100%">

Video models swap only to video models, with the prompt and settings still on board.

### Save as Button

<img src="docs/media/save-as-button.webp" alt="Group with G, name it, X saves it as a button, one click brings it back in a new workflow" width="100%">

<kbd>G</kbd> groups and names, <kbd>X</kbd> saves it as a button. One click brings the nodes back anywhere, settings and wires included.

### Buttons snap together like modules

<img src="docs/media/modular-buttons.webp" alt="Saved buttons chained one after another onto a Load Image" width="100%">

Select a node and press a saved button: the block lands after it and plugs in. Small blocks chain into a whole pipeline.

### Set → Get, no wires

<img src="docs/media/set-get.webp" alt="S adds a Set, Paired Get carries it far away, a preview runs from the Get" width="100%">

<kbd>S</kbd> puts a node's output on a bus; a paired Get takes it anywhere without a wire across the graph. Needs [KJNodes](https://github.com/kijai/ComfyUI-KJNodes) or Easy-Use.

### Your button library

<img src="docs/media/button-library.webp" alt="Group two buttons, search the drawer for a saved button, drag it onto the canvas" width="100%">

Drop a button on another to group them, search the drawer for any saved button, drag one onto the canvas or onto a bar.

---

## 📚 Learn more

- **[Tutorial](TUTORIAL.md)**: nine short steps, including Visual Crop, Super Stitch and Paint Studio.
- **[Reference](docs/REFERENCE.md)**: every bar, shortcut and setting, and where your preferences are saved.
- **[Custom Bar](CUSTOM_BAR.md)**: put your own extension's controls in the hotbox.

## 📄 License

[MIT](LICENSE). The images in these recordings were generated through ComfyUI's partner nodes.
