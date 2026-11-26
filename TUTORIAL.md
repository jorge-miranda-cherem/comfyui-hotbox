# Hotbox tutorial

Nine short steps, from your first key press to saved buttons that snap together like modules. Every animation is a
real-time recording of Hotbox in ComfyUI (Nodes 2.0); nothing is sped up. Install Hotbox first ([README](README.md#-installation)).

The names used below: the **Dock** is the numbered row on top, the **Context bar** the row of actions under it, the
**Bottom bar** the row of power tools and saved buttons, and the blue **+** opens the drawers.

---

## 1. Open it, add nodes, render

![Open the hotbox, add a Load Image, crop it, render](docs/tutorial/01-open-dock-crop-render.gif)

1. Point at the empty canvas and press <kbd>`</kbd>. The Dock offers nodes to start with; press <kbd>1</kbd> for **Load Image**.
2. Point at the new node and press <kbd>`</kbd> again. The Context bar now holds the actions for an image: press
   <kbd>C</kbd> (its first action, **Crop**) and a crop with its preview is added, already wired.
3. Press <kbd>Shift</kbd>+<kbd>R</kbd> (**Render Selected**) to run only the selected node's outputs.
4. While the hotbox is open, <kbd>Tab</kbd> switches style (Compact, the one it starts with → Quiet → Fluid) and <kbd>.</kbd> frames the selection.

Every key works on the node under the cursor or the selected one, so a whole graph can be built without menus.

## 2. Crop visually

![Crop, a 16:9 ratio, Visual Crop](docs/tutorial/02-visual-crop.gif)

1. On a crop node, open the hotbox: the Context bar shows **Visual Crop** and the ratios (`Free · 1:1 · 16:9 · 9:16 · 4:3 · 3:4`).
2. Pick a ratio, then **Visual Crop** (<kbd>Alt</kbd>+<kbd>Z</kbd>): lock the ratio, drag a corner to resize, drag inside to move.
3. <kbd>Enter</kbd> (or **Done**) writes the box into the node. <kbd>Shift</kbd>+<kbd>R</kbd> renders it.

## 3. Put an edit back where it was cut — Super Stitch

![Super Stitch on the edit's result](docs/tutorial/03-super-stitch.gif)

1. Select the node that holds your edited crop (the output of any model or effect fed by a crop).
2. Open the hotbox: **Super Stitch** is the first button there. Press it.
3. It adds a fit that scales your result back to the crop's size and a composite that pastes it on the plate at the
   crop's `x / y`, plugs your result in, and brings the new nodes into view. Press **Run**.

The stitch keeps following its crop: move or resize the crop box and the paste position follows.

## 4. Paint, then hand it to any model

![Paint Studio, then Nano Banana 2 from the models drawer, prompt in the Magnifier](docs/tutorial/04-paint-studio-and-model.gif)

1. On a **Load Image**, press **Paint** in the Context bar: a Painter node, its preview and a preview of its mask are added.
2. With the Painter selected, <kbd>Alt</kbd>+<kbd>Z</kbd> opens **Paint Studio**: brush, eraser, size, color, undo. It opens with the strokes the Painter already has, and Done keeps them.
   <kbd>Enter</kbd> saves the paint into the node.
3. Open the hotbox on the Painter and press <kbd>A</kbd> (**Models & APIs**), type a name (`nano banana 2`) and click
   it: the model is added and wired to the Painter's image.
4. <kbd>Alt</kbd>+<kbd>Z</kbd> on the model opens the **Magnifier**, a big prompt editor. Write the prompt, <kbd>Esc</kbd>.
5. Open the hotbox on the model: **Save Image** comes first. Then **Run**.

## 5. Swap the model, keep the prompt

![Nano Banana 2 → Grok → GPT Image → Flux Kontext → Seedream](docs/tutorial/05-swap-models.gif)

On a model node, the Dock's numbers swap the model in place (<kbd>A</kbd> + a search reaches any other one). The new
node takes the old one's spot, its links, and every setting they share (`prompt`, `seed`, `aspect_ratio`…). Try the same
prompt on five models in a few seconds, then **Run** the one you like.

Subgraphs swap the same way. A subgraph with a model inside (an API node, or a loader of a local model) shows up under
**Subgraphs** in the <kbd>A</kbd> drawer: your own, then ComfyUI's ready-made ones (Text to Image, Image Edit, Image to
Video…). Swap an API model to a local pipeline and back, or one subgraph to another, prompt and links included. On such a
subgraph the hotbox opens in swap mode too.

## 6. Group it and save it as a button

![Group with G, name it, Save as Button with X, reuse it in a new tab](docs/tutorial/06-group-and-save-as-button.gif)

1. Click the canvas, <kbd>Ctrl</kbd>+<kbd>A</kbd>, open the hotbox and press <kbd>G</kbd>: the nodes are grouped and the
   title editor opens; type a name, <kbd>Enter</kbd>.
2. Click the group's title, open the hotbox and press <kbd>X</kbd> (**Save as Button**): the group melts into a button
   in the Bottom bar, named after the group. The nodes stay where they are. (Select a label along with the nodes
   and the button takes the label's text as its name instead.)
3. In any workflow, open the hotbox and click the button (or drag it onto the canvas): the nodes, their settings,
   their wires and the group come back.

## 7. Buttons are modules: they plug into the selected node

![Three saved modules chained onto a new plate](docs/tutorial/07-modular-buttons.gif)

Save small blocks as buttons — `Crop → Preview`, `Nano Banana 2 → Save`, `Upscale ×2 → Save` — then chain them:

1. Select a node (a **Load Image**), open the hotbox and press a saved button.
2. The block lands right after the selected node and its first open input takes that node's output
   (the status line says `plugged into …`).
3. Select the new block's node and press the next button. Build a whole pipeline this way, then **Run**.

A button whose block starts with its own loader (like a full workflow) is just added, not plugged in.

## 8. Send anything anywhere — Set / Get buses

![Set from a node, its paired Get far away, switching the Get to another bus](docs/tutorial/08-set-get-bus.gif)

Needs [KJNodes](https://github.com/kijai/ComfyUI-KJNodes) or Easy-Use (their Set / Get nodes).

1. Point at a node, open the hotbox and press <kbd>S</kbd>: a **Set** node is added, wired and named after it.
2. On the Set node, **Paired Get** adds a Get on the same bus. Put it anywhere; no wire crosses the graph.
3. On a Get node, the Context bar lists every bus in the workflow: click one to switch the Get to it.
4. On the bare canvas, the left card lists a Get for every bus, dropped where you opened the hotbox.

## 9. Your library of saved buttons

![Group two buttons, find one in the drawer, drag it onto the canvas](docs/tutorial/09-saved-buttons-library.gif)

- **Group buttons**: drag a button over the middle of another and rest there until it lights up, then let go. Hover the group to see its list; its arrow keeps it open until the hotbox closes. More in [section 10](#10-move-and-group-your-buttons).
- **Find any button**: press <kbd>N</kbd> and type — saved buttons have their own section in the drawer.
- **Drag a button onto the canvas** to add its nodes there, or **onto a bar** to pin it to that bar.
- **Share them**: **Settings → Shared Libraries → Add Folder** adds a team folder (a studio drive, one per show). Its
  buttons show up in the drawer beside yours; make it **Writable** and **Save Here** and the buttons you save go there
  for everyone. See [shared libraries](docs/REFERENCE.md#%EF%B8%8F-shared-libraries).

Saved buttons live in your preferences file (`hotbox.json`), so they survive restarts and can be shared.

## 10. Move and group your buttons

![Drag a button to a new place, into a group, onto another button; remove one and take it back](docs/tutorial/10-move-and-group-buttons.gif)

1. **Drag any button**, with no need to hold it first. It lifts from the point you took it by; nothing in the bars moves while it is in your hand, and a bright line marks where it will land.
2. **Into a group**: take it to the middle of the group, which lights up. Rest there and its list opens: pick the place in it, the first one too.
3. **Two buttons, one group**: rest a button on the middle of another until it lights up, and let go.
4. **Take one off the bar**: hold a button (or click the ✎) for edit mode, then drag it to the red **Remove** strip under the bottom bar. <kbd>Ctrl</kbd>+<kbd>Z</kbd> puts it back, and only that: the canvas keeps its own undo.
5. Let go away from the bars, or press <kbd>Esc</kbd>, and the button goes back where it was.

## 11. The button editor

![The button editor, with the hotbox itself drawn at the top: name, color, icon and key for a button in the panel that comes up on the right; drag it into a group; a new group; its place in the bar; Undo and Redo](docs/tutorial/11-button-editor.gif)

1. **Settings → Button Editor → Open Editor…** (the **H** in ComfyUI's top bar opens Settings).
2. The window has two parts. On top, **the hotbox itself** as it opens on a node: its dock, its context bar and its bottom bar, with the buttons they hold. The bar being edited (at first **your bottom bar**) is framed in amber, and its **+** opens **Add to this bar** right under it. Below, apart, **your saved buttons**: a lane for every group and one for the buttons in no group (drag their background to slide them along when there are many).
3. **Click a button**: a panel comes up on the right with its name, color, icon and hotkey, the group it is in and the nodes it adds. The hotkey warns when the key already does something. Its **×** (or <kbd>Esc</kbd>) puts the panel away, and the window is all hotbox and lanes again.
4. **Drag** a card to any place in a lane, onto a group in the bar, or onto **New group** (<kbd>G</kbd> makes one too). Drag a group or a button along the bar to move it there. Drag a **group off the bar** to take it off (it keeps its buttons), and hold it by **its name, at the head of its lane**, to drag it back up onto the bar.
5. Every change saves itself. <kbd>Ctrl</kbd>+<kbd>Z</kbd> takes it back, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> does it again, <kbd>/</kbd> finds one of your buttons by its name or by a node in it, <kbd>Del</kbd> deletes what is picked.
6. **A bar's own buttons**: the bar framed in amber is edited where it is. Drag a button along it to move it; drag it off the bar, or press the **×** that shows on it under the pointer, to take it off. Click the **Dock** or the **Context bar** in the picture to edit that one instead; the arrows on the node step through the kinds of node on your canvas, and the picture follows. On an API node the Dock is the **swap bar**: the models to change to.
7. **Add to this bar** opens by itself, out of the bar's **+**, a moment after the window does; that **+** (a **×** while it is open) closes it and opens it again. It holds what can go on the bar, as chips to **click** onto it or to **drag** to a place on it. Its tabs are what suits the bar (**Fits here**, **Models** or **Tools**) and **Power tools**, the fourteen; the ones already on the bar are lit, and a click takes one off. Type a name in its field and **Found** lists every tool and every node your ComfyUI has with that name; <kbd>Enter</kbd> puts the first one on the bar. **Reset** brings back what Hotbox proposes.

   ![The + of the bar being edited closes Add to this bar and opens it again under the bar: a power tool clicked onto the bottom bar, another dragged to a place on it, one taken off with its ×; then a group dragged off the bar and back onto it by its name](docs/tutorial/11-editor-bars-and-power-tools.gif)

8. **Any node's bars**: the node in the middle of the picture is a field, and it says **type to find a node**. Click it, type a node's name and pick one (<kbd>Enter</kbd> takes the first): the hotbox is drawn as it opens on that node, on your canvas or not, and its **Dock** is the bar being edited. Nothing is added to your graph. The arrows beside the field step through the nodes on the canvas and the bars you already changed.

   ![The node in the picture is a field: nano banana typed in it, the node picked, and the hotbox is drawn for it; its Dock, the swap bar of an image API node, gets two models from Add to this bar, one moved to the front, one taken off](docs/tutorial/11-editor-find-a-node.gif)

9. **A larger window**: the arrows beside **Done** fill the screen, and the corner at the bottom right stretches the window to any size (double-click it for the usual one). The four **A**'s beside them make its text and buttons larger, up to 200% for a 4K screen. Both are kept in this browser.

## 12. Send a button to someone

![Copy to share in the button editor, then Ctrl+V on the canvas: a card asks, and the button is in the bar](docs/tutorial/12-share-a-button.gif)

1. Pick a saved button or a group in the button editor (or right-click it in the hotbox) and press **Copy to share**. It is on your clipboard as text, nodes and all.
2. Paste it into any chat or mail.
3. Whoever gets it copies the whole message and presses <kbd>Ctrl</kbd>+<kbd>V</kbd> anywhere in ComfyUI. A card shows what it holds; **Add to my buttons** puts it at the end of their bottom bar.
4. Nothing they have is overwritten: what arrives is kept as the next version of their preferences. A group they already have keeps the buttons they put in it, and the new ones go after them. (In the recording one ComfyUI plays both sides: the button is deleted in between.)

## 13. A key of its own, and new nodes for the same button

![Right-click a button, give it the key Q, press Q; then change a value in its nodes and save it into the same button](docs/tutorial/13-button-key-and-nodes.gif)

1. **Right-click a button → Key**, and press the key that runs it while the hotbox is open. Here <kbd>Q</kbd> adds the button's nodes.
2. **Right-click → Edit its nodes…**: pick a node, change a value, a title or how it runs, and **Save to this button**. It stays where it is, with its name, color and key.
3. Or change the nodes on the canvas, select them, and choose **Use selection** in the same box.
4. Or give the button a canvas of its own: **Edit on a clean canvas** in the button editor opens a new tab with only its nodes, and a small bar stays there. Change them with ComfyUI itself, then **Save button**: the same button keeps them, the tab closes and you are back where you were.
5. What the button held before is kept behind it (the last five): **Versions…** in that editor brings one back.

## 14. Delete a saved button for good

![Desert sunrise dragged past Remove to Delete for good at the end of the strip: gone from the bar, and Undo, lit for 10 seconds, brings it back; deleted again, then Done](docs/tutorial/14-delete-for-good.gif)

1. Hold one of **your saved buttons** for edit mode and drag it: the red **Remove** strip under the bottom bar has a small, darker **Delete for good** at its right end.
2. Let go there: the saved button itself is deleted, from every bar and every group it was in, with no trip to Settings.
3. The edit bar says which one went, and its **Undo** stays lit for about 10 seconds, a line in it running out. **Undo** (or <kbd>Ctrl</kbd>+<kbd>Z</kbd>) brings it back with its place, its group, its name, its color and its key.
4. Only your own saved buttons get that section: a power tool, a node or a group is only taken off the bar.

## 15. Prompt History: the prompts you ran

![Up in an empty prompt box brings back the prompts you ran; one changed and run is first now; the history button in the box's corner finds one by a word; in the Magnifier the history is on the right, all of it or only this workflow's](docs/tutorial/15-prompt-history.gif)

1. Every run keeps the text of each prompt box it sends, newest first, in one list for all your prompt nodes.
2. In an **empty** prompt box, <kbd>↑</kbd> brings back the last prompt; <kbd>↑</kbd> and <kbd>↓</kbd> go on to older and newer ones. Type, click or press any other key and it stays there to edit.
3. The **history button** in the box's top-right corner lists them, with a field to find one by any word in it; a click puts it in.
4. In the **Magnifier** (<kbd>Alt</kbd>+<kbd>Z</kbd>) the history is on the right: **All**, or only the prompts run from this workflow (the button with its name).

## 16. Get the workflow back from an image

![Get Workflow on a Load Image that shows a PNG ComfyUI wrote: Open in a new canvas puts its workflow in a tab of its own; back in the first tab, Insert into this workflow adds its nodes beside the node](docs/tutorial/16-get-workflow.gif)

1. On a node that shows a picture or a clip ComfyUI made (Load Image, Preview / Save Image, Load Video, Save Video), open the hotbox and press **Get Workflow** in the bottom bar.
2. **Open in a new canvas** puts the workflow that made it in a tab of its own; yours stays as it is.
3. **Insert into this workflow** adds its nodes beside the node, at a free place, selected.

## 17. Find and replace in the Magnifier

![The Magnifier's search button: dusk found four times, Enter steps through them; Ctrl+H, first light, Replace, then All](docs/tutorial/17-find-and-replace.gif)

1. In the **Magnifier**, the search button in its head (or <kbd>Ctrl</kbd>+<kbd>F</kbd>) opens a row under it: type, and every match is lit. <kbd>Enter</kbd> and <kbd>Shift</kbd>+<kbd>Enter</kbd> step through them; **Aa** matches case and <u>ab</u> whole words.
2. <kbd>Ctrl</kbd>+<kbd>H</kbd> adds **Replace with**: **Replace** changes the lit one, **All** every one.
3. <kbd>Ctrl</kbd>+<kbd>Z</kbd> takes a replace back; <kbd>Esc</kbd> closes the row.

## 18. Paint Studio keeps the Painter's strokes

![A ring drawn in the Painter node; Alt+Z opens Paint Studio with it; a line added there, Enter, and the node has both](docs/tutorial/18-paint-keeps-strokes.gif)

1. Paint right in the **Painter** node, then <kbd>Alt</kbd>+<kbd>Z</kbd>: **Paint Studio** opens with those strokes.
2. Paint on top of them, and **Done** (<kbd>Enter</kbd>) keeps both in the node.

## 19. A power tool of your own

![Settings, Power Tools, New power tool: an icon, a name, Runs After a button adds nodes, its code pasted in, Test, Save; then Nano Banana 2 from the models drawer, and the tool puts a Save Image after it by itself](docs/tutorial/19-your-own-power-tool.gif)

1. **Settings → Power Tools → New power tool** (the first row of the list): an icon, a name, a key, when it runs, and a box to **paste code** into.
2. **Runs → When pressed** runs it from its button. **After a button adds nodes** also runs it by itself each time the hotbox adds nodes, with those nodes in `added`.
3. **Test** runs it as it stands; **Save** keeps it in your preferences. From then on it is a power tool like the others: drag its row onto any bar.
4. The one in the recording puts a **Save Image** after every API node a button brings in:

   ```js
   for (const n of added)
     if (hotbox.isApiNode(n))
       hotbox.addNode('SaveImage', { after: n });
   ```

   The code runs in your ComfyUI: paste only code you trust. More in [Your own power tools](docs/REFERENCE.md#your-own-power-tools).

---

## Keys at a glance

| Key | In the hotbox |
| :--- | :--- |
| <kbd>`</kbd> | Open / close (rebindable) |
| <kbd>1</kbd>–<kbd>9</kbd> | Dock buttons: add & wire the next node, or swap a model |
| <kbd>C</kbd> | The Context bar's first action |
| <kbd>F</kbd> · <kbd>N</kbd> · <kbd>A</kbd> · <kbd>U</kbd> | Drawers: all nodes · image/video kit · models & APIs · subgraphs |
| <kbd>T</kbd> · <kbd>S</kbd> · <kbd>R</kbd> · <kbd>L</kbd> · <kbd>F2</kbd> | Preview · Set bus · Reroute · Label · Rename |
| <kbd>G</kbd> · <kbd>X</kbd> · <kbd>W</kbd> | Group · Save as Button · Swap two selected nodes |
| <kbd>B</kbd> · <kbd>M</kbd> · <kbd>P</kbd> · <kbd>K</kbd> | Bypass · Mute · Seed mode · Bypass all API nodes |
| <kbd>Z</kbd> / <kbd>Alt</kbd>+<kbd>Z</kbd> | Magnifier · Visual Crop · Paint Studio |
| <kbd>.</kbd> | Frame the selection (again to return) |
| <kbd>Tab</kbd> · <kbd>Esc</kbd> | Switch style · close |
| <kbd>Shift</kbd>+<kbd>R</kbd> | Render only the selected outputs (works with the hotbox closed) |
| <kbd>L</kbd> (hotbox closed) | Arrange the selection along its wires, as Nuke's <kbd>L</kbd> does; on one node, line it up with what feeds it |
| <kbd>Alt</kbd>+<kbd>R</kbd> · <kbd>Alt</kbd>+<kbd>N</kbd> | Load in Canvas · Label Studio |
| <kbd>↑</kbd> · <kbd>↓</kbd> (in an empty prompt box) | The prompts you ran (Prompt History) |
| <kbd>Ctrl</kbd>+<kbd>F</kbd> · <kbd>Ctrl</kbd>+<kbd>H</kbd> (in the Magnifier) | Find · find and replace |

---

The plates in these recordings are a [Pexels](https://www.pexels.com/photo/endless-desert-highway-with-power-lines-33678776/)
photo (Pexels License) and images generated with Nano Banana 2 through ComfyUI's partner nodes.
