<p align="center"><img src="docs/media/hotbox-logo.webp" alt="Hotbox" width="340"></p>

<h3 align="center">Press <kbd>`</kbd> on any node. What comes next is already there.</h3>

<p align="center">A hotbox for ComfyUI · free and open source · no dependencies</p>

<p align="center"><img src="docs/media/same-workflow.webp" alt="The same workflow built twice: 37.9 s in ComfyUI, 23.8 s with Hotbox" width="900"></p>

## Installation

Search **Hotbox** in ComfyUI Manager, or:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/jorge-miranda-cherem/comfyui-hotbox.git
```

Restart ComfyUI and press <kbd>`</kbd> over any node.

<p align="center"><img src="docs/media/hotbox-bars.png" alt="The hotbox on a Load Image: the next nodes on top, the node's actions under them, your tools and pinned nodes below" width="900"></p>

## Key features

**Every action has a hotkey**

<img src="docs/media/hotkeys.webp" alt="Open the hotbox on a Load Image, C to crop, pick 16:9, Shift+R to render" width="100%">

**Find any node**

<img src="docs/media/find-any-node.webp" alt="F opens the search on a VAE Decode: upscale lists the nodes that take its IMAGE first, Enter adds and wires one, then a typo, previw, still finds Preview Image" width="100%">

It ranks like ComfyUI's own search: ComfyUI's nodes first, a check on the ones that fit the node's output,
the pack's name beside a custom node. Typos and short forms (`previw`, `load img`, `ckpt`) still find it.
<kbd>↑</kbd> <kbd>↓</kbd> pick one and <kbd>Enter</kbd> adds it, already wired.

**Swap the model, keep the prompt**

<img src="docs/media/swap-image-models.webp" alt="Nano Banana 2 swapped to other image models, the prompt carried over" width="100%">

Subgraphs with a model inside swap the same way: an API model to a local pipeline (your own subgraphs, or ComfyUI's
ready-made ones), and back.

**Swap a whole batch at once**

<img src="docs/media/swap-many-models.webp" alt="Three templates selected with Ctrl+A, the model swapped in all of them at once, each keeping its own prompt" width="100%">

**Save any chain as a button**

<img src="docs/media/save-as-button.webp" alt="Group with G, name it, X saves it as a button, one click brings it back" width="100%">

**Buttons snap together**

<img src="docs/media/modular-buttons.webp" alt="Saved buttons chained one after another onto a Load Image" width="100%">

Saved buttons can live in a shared folder too (a studio drive, one per show), so a team builds one library together.

**Make it yours**

<img src="docs/media/make-it-yours.webp" alt="Edit mode: buttons removed from every bar, Nano Banana pinned, a smaller hotbox" width="100%">

**Color your buttons**

<img src="docs/media/button-colors.webp" alt="Edit mode: Render Selected painted green, Bypass marked red, VAE Decode painted purple" width="100%">

In edit mode, tap a button to rename it or give it a color: on its mark only, or on the whole button.

**Put any tool anywhere**

<img src="docs/media/tools-anywhere.webp" alt="Zoom dragged from the bottom bar up into the top bar, then Arrange Nodes dragged from Settings into the bottom bar" width="100%">

Drag a button from one bar to another, or a power tool straight out of Settings. It stays where you put it, and
where it does not apply it is dimmed.

**One setup per project**

<img src="docs/media/projects.png" alt="Settings: the Night Shift project, its hotbox.json, Set Project with Spring Ad and Brand Film under Recent, and Backup & Share" width="460">

Everything you change is saved to a `hotbox.json`. **Set Project** points Hotbox at another folder (one per show,
a synced drive, a team folder), and your recent projects are one click away. **Download a Copy** and
**Load from File** take it to another computer or a teammate.

## More

[Tutorial](TUTORIAL.md) · [Reference](docs/REFERENCE.md) · [Custom Bar](CUSTOM_BAR.md) · [MIT License](LICENSE)
