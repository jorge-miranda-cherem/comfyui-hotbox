# Putting your own controls in the Hotbox

This is the contract for extensions (and for the agent maintaining one) that want their buttons inside the
Hotbox, drawn in the Hotbox style instead of their own. You hand the Hotbox a **description** of your
controls; it draws them, keeps them in the current style (Fluid, Compact, Quiet), and calls your functions.

You never touch the Hotbox DOM. Labels are escaped, colors are validated, and an item that is missing what it
needs is skipped instead of breaking the hotbox.

---

## 1. Register a bar

```js
window.__hotboxBars = window.__hotboxBars || {};
window.__hotboxBars['scene-manager'] = {
  name: 'Scene Manager',      // small tag at the start of your row (optional)
  where: 'bottom',            // 'bottom' (default) or 'context' — see below
  items: function (ctx) {     // called every time the hotbox paints
    if (!ctx.node) return [];  // nothing under the cursor: show nothing
    return [ /* items, see section 3 */ ];
  }
};
```

`window.__hotboxBars` is a plain object, so it can be filled before or after Hotbox loads. Once Hotbox is up,
`window.__hotbox.addBar(id, bar)` and `window.__hotbox.removeBar(id)` do the same and repaint an open
hotbox. `window.__hotbox.repaint()` repaints it after your own state changed.

### Where it shows

| `where` | Place | Use it for |
|---|---|---|
| `'bottom'` | **Custom Bar**, a row right above the bottom bar | Actions on the scene or the node: output, add node, swap, seed, local nodes |
| `'context'` | **Context bar**, the row under the numbered dock, before Hotbox's own tools for that node | Things that belong to *this kind* of node: rename / version an EXR write, a label's look |

One bar can only be in one place. Need both? Register two ids (`'scene-manager'` and
`'scene-manager-exr'`).

Return an empty list whenever your controls do not apply (wrong node type, nothing selected): the row then
disappears entirely.

---

## 2. What `ctx` holds

| Field | |
|---|---|
| `ctx.node` | The LiteGraph node the hotbox opened on, or `null` on the bare canvas |
| `ctx.nodes` | The current selection (array, may be empty) |
| `ctx.where` | `'bottom'` or `'context'` while painting; `''` inside a callback |
| `ctx.style` | `'fluid'`, `'compact'` or `'quiet'`, only if you want to adapt the wording |
| `ctx.repaint()` | Repaint the hotbox on the next tick (after you changed something it shows) |
| `ctx.close()` | Close the hotbox |

Every callback (`run`, `onChange`, `onCommit`) gets a fresh `ctx` as its last argument.

---

## 3. Items

Every item is a plain object with a `type` (default `'button'`). Common optional fields: `title` (tooltip),
`icon` (a Hotbox icon name, section 5), `color` (a CSS color shown as a small dot), `badge` (a count or short
tag shown as a pill: `85`, `×2`).

| `type` | Required | Optional | What the user gets |
|---|---|---|---|
| `button` | `label`, `run(ctx)` | `icon`, `color`, `badge`, `active`, `disabled`, `stayOpen` | A button. Closes the hotbox after `run` unless `stayOpen: true` (then the hotbox repaints, good for a fold or an on/off). |
| `group` | `items` (buttons, menus, selects, fields…) | `label`, `title` | A joined cluster with a small caption: `OUTPUT  ⇩ exr  ⇩ image  ×2`. No groups inside groups. |
| `menu` | `label`, `items` (array, or `function (ctx)` returning one) | `icon`, `badge`, `search`, `placeholder` | A button with ▾ that opens a list under it. Rows: `{ label, run, hint?, icon?, color?, active?, stayOpen? }`, plus `{ type: 'header', label }` and `{ type: 'sep' }`. A row closes the hotbox unless `stayOpen`. Lists with more than 10 rows get a filter field (force with `search: true/false`); Enter picks the first match. |
| `select` | `options`, `value`, `onChange(value, ctx)` | `label` (caption), `display` (text shown instead of the current option), `icon` | A field showing the current choice ▾; picking a row calls `onChange` and repaints (the hotbox stays open). `options`: strings, or `{ value, label, hint? }`. |
| `text` | `onChange(text, ctx)` and/or `onCommit(text, ctx)` | `value`, `label`, `placeholder`, `width` (px, default 150) | A text field. `onChange` fires on every keystroke (live), `onCommit` on Enter or when the field loses focus, only if the text changed. Esc puts the old text back. |
| `number` | `value`, `onChange(number, ctx)` | `label`, `min`, `max`, `step` (default 1), `pad` (zero-pad digits: `pad: 3` shows `002`), `prefix` (`'v'` shows `v002`), `width` | A number field with ▲ ▼ beside it. ▲ ▼, the arrow keys and Shift (×10) step it right away; typed text is applied on Enter or leaving the field. `onChange` gets a plain number. |
| `range` | `value`, `onChange(number, ctx)` | `label`, `min` (0), `max` (100), `step` (1), `unit` (`'px'`), `width` | A small slider with its value beside it; `onChange` fires live while dragging. |
| `swatches` | `colors`, `onChange(color, ctx)` | `value` (the current color), `label` | A row of color dots; the current one is ringed. |
| `segment` | `options`, `value`, `onChange(value, ctx)` | `label` | A segmented switch (`Square · Semi · Round`). |
| `toggle` | `label`, `value` (bool), `onChange(bool, ctx)` | `icon` | A button that stays lit while `value` is true. |
| `info` | `text` | `icon`, `title` (the full text, e.g. a path) | Muted text, cut with … when long. Not clickable. |
| `sep` | | | A thin divider. |

Fields that change things in place (`select`, `segment`, `swatches`, `toggle`) keep the hotbox open and
repaint it, so read the new value from your own state in `items(ctx)`. `text`, `number` and `range` do not
repaint while the user types or drags (the field would lose focus); Enter in a field repaints once.

---

## 4. Style rules (so it looks like the rest of the Hotbox)

- **Use `icon`, not glyphs in the label.** `{ label: 'exr', icon: 'save' }`, not `'⇩ exr'`.
- **One idea per row, about 6–10 controls.** Long lists go in a `menu` (swap 85 → one `swap ▾` button with
  `badge: 85`), never as 85 buttons.
- **Modes are a `select`, not one button per mode.** `seed fixed / increment / decrement / randomize` is one
  field showing `randomize ▾`.
- **Related actions share a `group`** with a short caption (`output`, `3 outputs`).
- **Short labels**, lowercase or Title Case, but the same everywhere in your bar.
- **No node picker.** The hotbox already opened on a node: use `ctx.node`.
- **Hide what does not apply** by leaving it out of the list, rather than showing it disabled.
- **`color`** only where it means something (a status, a wire type).

---

## 5. Icons

`save` (down arrow, good for "write out"), `upload` (up arrow, "send to"), `loadCanvas`, `preview`,
`play`, `swap`, `sync`, `plus`, `search`, `settings`, `edit`, `copy`, `folder`, `history`, `seed`,
`video`, `model`, `subgraph`, `layout`, `crop`, `resize`, `flip`, `paint`, `compare`, `stitch`, `label`,
`set`, `reroute`, `group`, `zoom`, `lupa`, `star`, `sparkles`, `wand`, `tools`, `check`, `info`, `trash`,
`bypass`, `zapOff`, `power`, `keyboard`, `pointer`, `palette`, `pipette`, `grip`, `more`, `chevDown`,
`chevUp`, `chevRight`, `collapse`, `moon`, `spacing`, `leaders`.

An unknown name is simply not drawn.

---

## 6. Example: the Scene Manager strip, translated

Today's strip sends every action as its own button (`⇩ output exr`, `⇩ save image`, `⇩ exr + image`, four
`⇄ <model>` swaps, four `seed …` modes, `⊕ add node 4 ▾`). The same actions, in the Hotbox style:

```js
window.__hotboxBars['scene-manager'] = {
  name: 'Scene Manager',
  where: 'bottom',
  items: function (ctx) {
    var n = ctx.node;
    if (!n) return [];
    var out = [];

    // OUTPUT  ⇩ exr  ⇩ image  ×2  ⊞ bundle
    if (SM.canOutput(n)) out.push({
      type: 'group', label: 'output', items: [
        { label: 'exr', icon: 'save', title: 'Add an EXR write', run: function () { SM.addOutput(n, 'exr'); } },
        { label: 'image', icon: 'save', title: 'Add a Save Image', run: function () { SM.addOutput(n, 'image'); } },
        { label: '×2', title: 'EXR + image', run: function () { SM.addOutput(n, 'both'); } },
        { label: 'bundle', icon: 'layout', run: function () { SM.addBundle(n); } }
      ]
    });

    // ⊕ add node 8 ▾
    var adds = SM.addableNodes(n);                          // [{ name, type, why }]
    if (adds.length) out.push({
      type: 'menu', label: 'add node', icon: 'plus', badge: adds.length,
      items: adds.map(function (a) {
        return { label: a.name, hint: a.why, run: function () { SM.addNode(n, a.type); } };
      })
    });

    // seed: randomize ▾
    if (SM.hasSeed(n)) out.push({
      type: 'select', icon: 'seed', value: SM.seedMode(n),
      options: ['fixed', 'increment', 'decrement', 'randomize'],
      onChange: function (mode) { SM.setSeedMode(n, mode); }
    });

    // ⇄ swap 85 ▾  (filter field appears on its own: more than 10 rows)
    var swaps = SM.swapTargets(n);                          // [{ name, type, family }]
    if (swaps.length) out.push({
      type: 'menu', label: 'swap', icon: 'swap', badge: swaps.length, placeholder: 'Swap to…',
      items: swaps.map(function (s) {
        return { label: s.name, hint: s.family, active: s.type === n.type, run: function () { SM.swap(n, s.type); } };
      })
    });

    // ⊕ local nodes ▾
    out.push({
      type: 'menu', label: 'local nodes', icon: 'tools',
      items: function () {
        return SM.localKits().map(function (k) {
          return { label: k.name, run: function () { SM.insertKit(n, k.id); } };
        });
      }
    });

    // copy to nuke / load in canvas, when the node has something to send
    if (SM.hasResult(n)) {
      out.push({ type: 'sep' });
      out.push({ label: 'copy to nuke', icon: 'upload', run: function () { SM.copyToNuke(n); } });
    }
    return out;
  }
};
```

`SM.*` stands for your own functions; keep whatever you already call today.

### Rename and version an EXR write (Context bar)

The `3 OUTPUTS · test · 2 ▲▼ · settings ▾ · …2.%04d.exr and 2 more · load 3 in canvas · open 3 in RV` row, on
the node itself:

```js
window.__hotboxBars['scene-manager-exr'] = {
  where: 'context',
  items: function (ctx) {
    var n = ctx.node;
    if (!n || !SM.isExrWrite(n)) return [];
    var o = SM.outputsOf(n);                                // { count, name, version, path, more }
    return [
      { type: 'group', label: o.count + ' outputs', items: [
        { type: 'text', value: o.name, width: 140, placeholder: 'name',
          onCommit: function (name) { SM.rename(n, name); } },
        { type: 'number', value: o.version, min: 1, pad: 3, prefix: 'v',
          onChange: function (v) { SM.setVersion(n, v); } },
        { type: 'menu', label: 'settings', icon: 'settings', items: SM.exrSettingsRows(n) }
      ] },
      { type: 'info', text: o.path + (o.more ? ' · and ' + o.more + ' more' : ''), title: o.fullPath },
      { label: 'load ' + o.count + ' in canvas', icon: 'loadCanvas', run: function () { SM.loadInCanvas(n); } },
      { label: 'open ' + o.count + ' in RV', icon: 'play', run: function () { SM.openInRV(n); } }
    ];
  }
};
```

Rename only on `onCommit` (Enter or leaving the field), so the files are not renamed on every keystroke.
The version steps commit right away; return the new value from `SM.outputsOf` on the next paint.

---

## 7. Stepping aside while the Hotbox is open

Hotbox fires `hotbox:open` and `hotbox:close` on `window` (`event.detail.node` is the node it opened on),
`hotbox:open` before its first paint. A tool that shows the same buttons in its own panel can hide it there:

```js
window.addEventListener('hotbox:open', function () { myPanel.style.visibility = 'hidden'; });
window.addEventListener('hotbox:close', function () { myPanel.style.visibility = ''; });
```

`window.__hotbox.isOpen()` tells you the current state.

---

## 8. Checklist before you ship

- [ ] Nothing under the cursor, or the wrong node type → `items` returns `[]`.
- [ ] No unicode arrows in labels; icons via `icon`.
- [ ] Lists longer than ~6 are a `menu`; modes are a `select`.
- [ ] Callbacks never throw on a stale node (it may have been deleted while the hotbox was open).
- [ ] Try it in all three styles (Tab cycles Fluid → Compact → Quiet while the hotbox is open).
- [ ] Hotbox's own keys still work: your bar has no hotkeys, so 1–9, letters and Esc stay the Hotbox's.
