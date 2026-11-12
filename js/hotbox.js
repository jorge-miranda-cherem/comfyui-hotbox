/**
 * Hotbox for ComfyUI
 * Open-source, standalone context-aware hotbox & smart node toolkit.
 * Zero studio/pipeline dependencies — pure ComfyUI utility.
 *
 * Default Hotkeys:
 *   ` (Backquote)  — Open / Hold the Hotbox around node under cursor (or selected)
 *   Alt + Z        — Magnifier (Large Live Prompt Editor / Visual Crop Editor / Fullscreen Painter)
 *   Alt + N        — Label Studio (Create / Edit Label, Note, or Group with style presets)
 *   Alt + R        — Load in Canvas (Freeze node output/preview into a new LoadImage node)
 *   . (Period)     — Zoom camera to selected node(s) and press again to return to previous view
 */
(function () {
  'use strict';

  if (window.__hotboxLoaded) return;
  window.__hotboxLoaded = true;

  var STORAGE_KEY = 'hotbox_config_v1';
  var LEGACY_STORAGE_KEY = 'super_hotbox_config_v1';
  var PANEL_ID = 'shb-root';

  /* ---------------------------------------------------------------------
   * 1. STATE & PERSISTENT SETTINGS
   * --------------------------------------------------------------------- */
  var DEFAULTS = {
    useHotbox: true,
    hbKey: '`',
    hbCode: 'Backquote',
    hbMods: '',
    hbHold: false,          /* false = toggle on press, true = hold & release */
    hbStyle: 'classic',     /* 'classic' (Compact: Fluid look, bars only), 'pro' (Fluid glass cards) or 'quiet' (native panels) */
    hbDockCat: 'models',    /* category shortcut at the end of the dock: 'models' | 'tools' | 'subs' | 'search' | 'none' */
    hbEditAnim: 'none',     /* edit-mode idle animation: 'none' (still) | 'outline' | 'tilt' | 'float' | 'jiggle' */
    hbScrim: true,          /* Fluid: soft canvas dim behind the hotbox (never blurred) */
    hbBlur: true,           /* Fluid & Compact: frosted glass behind bars and cards (costly without a GPU: off = plain panels) */
    hbLeaders: false,       /* Quiet: hairlines from the cursor to each zone (off: they cover the node) */
    hbScale: 1.0,
    hbGap: 28,              /* spacing in px between node/center and hotbox bars */
    showStatusPill: true,
    /* Power tools: Settings lists them as buttons to drag into the hotbox; false here (in hotbox.json) turns one off */
    useAltZ: true,          /* Alt+Z Magnifier / Visual Crop / Paint Studio */
    useAltN: true,          /* Alt+N Label Studio */
    useAltR: true,          /* Alt+R + [V] Load in Canvas */
    useShiftR: true,        /* Shift+R render only the selected output nodes */
    useStitch: true,        /* Super Stitch: put crops back into their plate (and keep them following) */
    useKillApi: true,       /* [K] Bypass All APIs: bypass / re-enable every API node */
    dotZoom: true,          /* . frame the selection, press again to go back */
    useArrange: true,       /* L arrange the selection along its wires, as Nuke's L does */
    lupaSize: 1,
    lupaBox: 1,
    lupaWH: '',
    favImage: [],
    favVideo: [],
    favBtn: ['crop', 'rsz', 'cmp', 'prev'],
    hotboxPins: {},         /* per-bucket custom node pins */
    customAddBar: null,     /* legacy global Add Bar uids */
    customAddBySig: {},     /* per-slot-signature custom Top Add Bar uids */
    customToolsBar: {},     /* per-bucket array of item uids for Tools Bar */
    customBotBar: null,     /* array of item uids for Bottom Bar */
    customLabels: {},       /* user custom short labels by uid */
    customColors: {},       /* user colors of bar buttons by uid: a swatch name (Red, Amber…) */
    customFill: {},         /* bar buttons painted whole by their color (uid: true); the others color only their mark */
    customKeys: {},         /* a key of its own for a bar button (uid: 'q'), set in its Edit Button box; it works while the button shows */
    hbKeep: {},             /* power tools the user placed on a bar ('bot:tool:zoom'): shown there, dimmed where they do not apply */
    templates: [],          /* Save as Button: saved node selections, each one a bar button ('tpl:<id>') */
    saveLib: '',            /* a writable shared library (its path) that Save as Button saves into, or '' for your own */
    hbGroups: {},           /* button groups: { id: { name, items: [uid…], keep? } }, each one a bar button ('grp:<id>'); keep = stays in its bar with one button or none */
    repN: 3,                /* Replicate: copies last asked for */
    repDir: 'down',         /* Replicate: 'down' (stacked below) or 'right' */
    repColors: true,        /* Replicate: each copy's groups and labels take its letter's color */
    cfgRev: 0,              /* config migrations already applied */
    lbLast: null
  };

  var S = {};
  /* Fills S from a saved config (raw settings, or an exported / on-disk file that wraps them); defaults fill the rest */
  function applyConfig(raw) {
    if (raw && raw.settings && typeof raw.settings === 'object') raw = raw.settings;
    if (!raw || typeof raw !== 'object') raw = {};
    for (var k in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) {
        S[k] = (raw[k] !== undefined) ? raw[k] : JSON.parse(JSON.stringify(DEFAULTS[k]));
      }
    }
    var rev = +S.cfgRev || 0;
    /* Migrate any legacy apibypass in customBotBar to normal node bypass (once: Bypass All APIs can be pinned now) */
    if (rev < 1 && Array.isArray(S.customBotBar)) {
      S.customBotBar = S.customBotBar.map(function (u) {
        return u === 'tool:apibypass' ? 'tool:bypass' : u;
      });
    }
    /* Swap Nodes and Save as Button ride in the bottom bar (they only show while they apply) */
    if (rev < 2 && Array.isArray(S.customBotBar)) {
      ['tool:swappair', 'tool:magic'].forEach(function (u) {
        if (S.customBotBar.indexOf(u) < 0) S.customBotBar.push(u);
      });
    }
    /* Load in Canvas and Render Selected ride in the bottom bar too; the leader lines start off */
    if (rev < 3) {
      if (Array.isArray(S.customBotBar)) {
        if (S.customBotBar.indexOf('tool:loadcanvas') < 0) S.customBotBar.unshift('tool:loadcanvas');
        if (S.customBotBar.indexOf('tool:render') < 0) {
          var at = S.customBotBar.indexOf('tool:magic');
          S.customBotBar.splice(at < 0 ? S.customBotBar.length : at + 1, 0, 'tool:render');
        }
      }
      S.hbLeaders = false;
    }
    /* Moving a button up into another bar (the bottom bar's into the dock, say) could empty the bar it left.
       Only the version that remembers placed tools (its files carry hbKeep) did it, so only its files are
       mended, once: a bottom bar that lost its everyday buttons gets back its own buttons (not one you moved to
       another bar), its groups, your saved buttons and, once the libraries load, the shared library's; an emptied
       context bar goes back to its default */
    HB_LIB_FIX = false;
    if (rev < 4 && Object.prototype.hasOwnProperty.call(raw, 'hbKeep')) {
      var keepM = (S.hbKeep && typeof S.hbKeep === 'object') ? S.hbKeep : {};
      var placed = {}, listed = {};
      var lists = function (m) {
        return Object.keys(m && typeof m === 'object' ? m : {}).map(function (k) { return Array.isArray(m[k]) ? m[k] : []; });
      };
      lists(S.customAddBySig).forEach(function (l) { l.forEach(function (u) { placed[u] = listed[u] = 1; }); });
      /* the context bars hold Preview of their own: only a tool you moved there counts as moved */
      lists(S.customToolsBar).forEach(function (l) {
        l.forEach(function (u) { listed[u] = 1; if (!/^tool:/.test(u) || keepM['tools:' + u]) placed[u] = 1; });
      });
      Object.keys(S.hbGroups && typeof S.hbGroups === 'object' ? S.hbGroups : {}).forEach(function (g) {
        ((S.hbGroups[g] || {}).items || []).forEach(function (u) { placed[u] = 1; });
      });
      var bot = S.customBotBar;
      var onBot = function (u) { return bot.indexOf(u) >= 0; };
      /* Render Selected shows everywhere, so it went every time */
      if (Array.isArray(bot) && (!onBot('tool:render') || !['tool:prev', 'tool:bypass', 'tool:magic'].some(onBot))) {
        var fixed = BOT_DEFAULTS.filter(function (u) { return onBot(u) || !placed[u]; });
        bot.forEach(function (u) { if (fixed.indexOf(u) < 0) fixed.push(u); });
        Object.keys(S.hbGroups && typeof S.hbGroups === 'object' ? S.hbGroups : {}).forEach(function (g) {
          if (!listed['grp:' + g] && fixed.indexOf('grp:' + g) < 0) fixed.push('grp:' + g);
        });
        (Array.isArray(S.templates) ? S.templates : []).forEach(function (t) {
          var tu = t && t.id ? 'tpl:' + t.id : '';
          if (tu && fixed.indexOf(tu) < 0 && !placed[tu]) fixed.push(tu);
        });
        S.customBotBar = fixed;
        HB_LIB_FIX = true;
      }
      if (S.customToolsBar && typeof S.customToolsBar === 'object') {
        Object.keys(S.customToolsBar).forEach(function (k) {
          if (Array.isArray(S.customToolsBar[k]) && !S.customToolsBar[k].length) delete S.customToolsBar[k];
        });
      }
    }
    if (!Array.isArray(S.templates)) S.templates = [];
    /* One name per button: a saved button or a group renamed on a bar used to keep that name beside its own
       (customLabels), so Settings went on showing the old one. The bar's name becomes its name. And the buttons
       that shook in edit mode stand still now (Settings → Edit Mode brings any of the motions back) */
    if (rev < 5) {
      var lbls = (S.customLabels && typeof S.customLabels === 'object') ? S.customLabels : {};
      S.templates.forEach(function (t) {
        var tu = t && t.id ? 'tpl:' + t.id : '';
        if (tu && lbls[tu]) { t.name = String(lbls[tu]); delete lbls[tu]; }
      });
      Object.keys(S.hbGroups && typeof S.hbGroups === 'object' ? S.hbGroups : {}).forEach(function (g) {
        if (S.hbGroups[g] && lbls['grp:' + g]) { S.hbGroups[g].name = String(lbls['grp:' + g]); delete lbls['grp:' + g]; }
      });
      if (S.hbEditAnim === 'jiggle') S.hbEditAnim = 'none';
    }
    /* Compact is the style Hotbox opens in now. A file saved before that carries Fluid, whether it was chosen
       or was just the default of its day, and nothing tells the two apart: it opens in Compact once. Tab (or
       Settings → UI Style) brings Fluid back, and from then on it stays */
    if (rev < 6 && S.hbStyle === 'pro') S.hbStyle = 'classic';
    S.cfgRev = 6;
    if (!S.customKeys || typeof S.customKeys !== 'object' || Array.isArray(S.customKeys)) S.customKeys = {};
    if (hbKeyRefused(S.hbKey, S.hbCode)) {
      S.hbKey = '`';
      S.hbCode = 'Backquote';
      S.hbMods = '';
    }
  }

  function loadConfig() {
    var raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY)
        || localStorage.getItem(LEGACY_STORAGE_KEY) || '{}');
    } catch (e) { raw = {}; }
    applyConfig(raw);
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) {}
    if (!CFG.ready) {
      if (CFG.hostWait) CFG.pending = true;
      return;
    }
    if (CFG.timer) clearTimeout(CFG.timer);
    CFG.state = 'saving';
    CFG.timer = setTimeout(cfgWrite, 400);
  }

  /* ---------------------------------------------------------------------
   * 1b. THE HOTBOX FILE: <ComfyUI>/user/<user>/hotbox/hotbox.json
   * Every preference (moved buttons, bars, labels, saved buttons, settings) is written there, so it
   * follows the user to any browser and survives cache clears. Settings can move it to any folder
   * (hotbox_files.py serves it); without that Python side, ComfyUI's user-data API is used.
   * localStorage keeps a copy for an instant start. hotbox.json is the original: an import never
   * overwrites it but becomes the next version (hotbox_v2.json, ...); active.json remembers which
   * one is in use.
   * A page that carries Hotbox on a ComfyUI shared by many people, where neither the Python side nor one
   * user-data folder can tell them apart, keeps the files itself: window.__hotboxFiles, set before Hotbox
   * loads (see docs/REFERENCE.md). Hotbox then never writes to ComfyUI's user folder.
   * --------------------------------------------------------------------- */
  var CFG_DIR = 'hotbox';
  var CFG_NAME_RE = /^hotbox(?:_v(\d+))?\.json$/;
  var CFG = { file: 'hotbox.json', ready: false, booted: false, timer: 0, state: 'local', err: '', savedAt: 0, versions: [], userDir: '', origin: 'browser',
    srv: false, dir: '', defDir: '', custom: false, missing: '', sep: '/', recent: [],
    host: null, hostWait: '', pending: false };
  /* Set once this browser has read or written the file. A browser without it still carries its preferences
     from before the file existed. */
  var CFG_SYNCED_KEY = 'hotbox_cfg_synced';

  function cfgMarkSynced() {
    try { localStorage.setItem(CFG_SYNCED_KEY, '1'); } catch (e) {}
  }

  function cfgUrl(name) {
    return CFG.srv ? '/hotbox/file/' + encodeURIComponent(name) : '/userdata/' + encodeURIComponent(CFG_DIR + '/' + name);
  }

  /* `origin: 'defaults'` marks a file that a fresh browser started from scratch */
  function cfgPayload() {
    return { hotbox_version: 2, saved_at: new Date().toISOString(), origin: CFG.origin, settings: JSON.parse(JSON.stringify(S)) };
  }

  function cfgVerNum(name) {
    var m = CFG_NAME_RE.exec(String(name || ''));
    return m ? (+m[1] || 1) : 0;
  }

  /* hotbox.json is the original; each import adds a numbered version beside it */
  function cfgVerLabel(name) {
    var n = cfgVerNum(name);
    return n <= 1 ? 'Original' : 'Version ' + n;
  }

  function cfgRead(name) {
    if (CFG.host) return Promise.resolve().then(function () { return CFG.host.read(name); });
    return apiFetch(cfgUrl(name), { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function cfgPut(name, obj) {
    if (CFG.host) return Promise.resolve().then(function () { return CFG.host.write(name, obj); });
    return apiFetch(cfgUrl(name) + (CFG.srv ? '' : '?overwrite=true'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj, null, 2)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
    });
  }

  function cfgWrite() {
    if (CFG.timer) { clearTimeout(CFG.timer); CFG.timer = 0; }
    CFG.state = 'saving';
    cfgShow();
    return cfgPut(CFG.file, cfgPayload()).then(function () {
      cfgMarkSynced();
      CFG.state = 'saved';
      CFG.err = '';
      CFG.savedAt = Date.now();
      if (CFG.versions.indexOf(CFG.file) < 0) CFG.versions.push(CFG.file);
      cfgShow();
    }).catch(function (err) {
      if (CFG.host) CFG.pending = true;
      CFG.state = 'error';
      CFG.err = msgOf(err);
      cfgShow();
    });
  }

  /* The folder on disk: the one the Python side reports, else the default layout as ComfyUI was started */
  function cfgFolder() {
    if (CFG.dir) return CFG.dir.replace(/[\\/]+$/, '');
    var app = getApp();
    var api = (app && app.api) || (window.comfyAPI && window.comfyAPI.api && window.comfyAPI.api.api);
    var base = CFG.userDir || 'ComfyUI/user';
    var sep = base.indexOf('\\') >= 0 ? '\\' : '/';
    return base.replace(/[\\/]+$/, '') + sep + ((api && api.user) || 'default') + sep + CFG_DIR;
  }

  function cfgPath(name) {
    var dir = cfgFolder();
    return dir + (CFG.dir ? CFG.sep : (dir.indexOf('\\') >= 0 ? '\\' : '/')) + (name || CFG.file);
  }

  function cfgCopy(text, what) {
    try {
      navigator.clipboard.writeText(text).then(function () { setStatus('ok', '✓ ' + what + ' copied'); }, function () { setStatus('ok', text); });
    } catch (e) { setStatus('ok', text); }
  }

  function cfgStateText() {
    if (CFG.state === 'saving') return 'Saving…';
    if (CFG.state === 'saved') return '✓ Saved ' + new Date(CFG.savedAt || Date.now()).toLocaleTimeString();
    if (CFG.state === 'new') return 'Created with your first change';
    if (CFG.state === 'error') return 'Could not write the file (' + CFG.err + ') · kept in this browser';
    return (CFG.hostWait || 'Waiting for ComfyUI') + ' · kept in this browser';
  }

  function cfgShow() {
    var el = document.querySelector('#' + PANEL_ID + '-settings [data-st-cfgstate]');
    if (!el) return;
    el.textContent = cfgStateText();
    el.className = 'shb-cfg-state shb-cfg-' + CFG.state;
  }

  /* A config came in from the file (start-up, version switch, import): redraw whatever shows it */
  function cfgApplied() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) {}
    /* the steps to undo belonged to the preferences that were in use until now */
    HB_UNDO = [];
    updateTopBarButtonState();
    hbRedrawAll();
  }

  function cfgListVersions() {
    var req = CFG.host
      ? Promise.resolve().then(function () { return CFG.host.list(); })
      : CFG.srv
      ? apiFetch('/hotbox/files', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) { return (j && j.files) || []; })
      : apiFetch('/userdata?dir=' + encodeURIComponent(CFG_DIR)).then(function (r) { return r.ok ? r.json() : []; });
    return req.then(function (list) {
      var names = (Array.isArray(list) ? list : []).map(function (f) {
        return String((f && f.path) || f).split(/[\\/]/).pop();
      }).filter(function (f) { return CFG_NAME_RE.test(f); });
      if (CFG.state === 'saved' && names.indexOf(CFG.file) < 0) names.push(CFG.file);
      CFG.versions = names.sort(function (a, b) { return cfgVerNum(a) - cfgVerNum(b); });
      if (document.getElementById(PANEL_ID + '-settings') && openSettingsModal._rerender) openSettingsModal._rerender();
    }).catch(function () {});
  }

  function cfgNewVersionName() {
    var n = 1;
    CFG.versions.concat([CFG.file]).forEach(function (f) { n = Math.max(n, cfgVerNum(f)); });
    return 'hotbox_v' + (n + 1) + '.json';
  }

  /* Switch to another saved version: the one in use is written first, so nothing is lost */
  function cfgSwitch(name, onDone) {
    var flush = CFG.timer ? cfgWrite() : Promise.resolve();
    flush.then(function () { return cfgRead(name); }).then(function (raw) {
      if (!raw) throw new Error(name + ' is missing');
      applyConfig(raw);
      CFG.origin = raw.origin || 'browser';
      CFG.file = name;
      CFG.state = 'saved';
      CFG.savedAt = Date.parse(raw.saved_at) || Date.now();
      cfgApplied();
      setStatus('ok', 'Now using ' + name);
      if (typeof onDone === 'function') onDone();
      return cfgPut('active.json', { file: name });
    }).catch(function (err) {
      setStatus('error', 'Could not switch: ' + msgOf(err));
    });
  }

  function cfgBoot() {
    if (CFG.booted) return;
    CFG.booted = true;
    apiFetch('/system_stats').then(function (r) { return r.json(); }).then(function (st) {
      var a = (st && st.system && st.system.argv) || [];
      var ud = a.indexOf('--user-directory'), bd = a.indexOf('--base-directory');
      if (ud >= 0 && a[ud + 1]) CFG.userDir = String(a[ud + 1]);
      else if (bd >= 0 && a[bd + 1]) {
        CFG.userDir = String(a[bd + 1]).replace(/[\\/]+$/, '') + (String(a[bd + 1]).indexOf('\\') >= 0 ? '\\' : '/') + 'user';
      }
    }).catch(function () {});
    cfgFolderInfo().then(cfgStart);
  }

  /* Reads the files, unless the page that keeps them cannot reach them yet */
  function cfgStart() {
    if (CFG.hostWait) {
      CFG.ready = false;
      CFG.state = 'local';
      cfgShow();
      return;
    }
    return cfgLoad(true);
  }

  /* Where the files live, from the page that keeps them or the Python side (hotbox_files.py). Without
     either, ComfyUI's user-data API is used */
  function cfgFolderInfo() {
    if (window.__hotboxFiles) return cfgHostInfo();
    return apiFetch('/hotbox/folder', { cache: 'no-store' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(cfgTakeFolder).catch(function () {});
  }

  function cfgHostInfo() {
    CFG.host = window.__hotboxFiles;
    CFG.hostWait = CFG.hostWait || 'Looking for your files';
    return Promise.resolve().then(function () { return CFG.host.folder(); }).catch(function (err) {
      return { why: msgOf(err) };
    }).then(function (j) {
      j = j || {};
      CFG.dir = String(j.folder || '');
      CFG.defDir = CFG.dir;
      CFG.sep = j.sep || (CFG.dir.indexOf('\\') >= 0 ? '\\' : '/');
      CFG.hostWait = j.ready ? '' : String(j.why || 'Waiting for your files');
    });
  }

  /* The page that keeps the files says they can be reached now, or no longer */
  function cfgFilesChanged() {
    if (!CFG.host) return Promise.resolve();
    return cfgFolderInfo().then(cfgStart).then(function () {
      if (document.getElementById(PANEL_ID + '-settings') && openSettingsModal._rerender) openSettingsModal._rerender();
    });
  }

  function cfgTakeFolder(j) {
    if (!j || !j.folder) return;
    CFG.srv = true;
    CFG.dir = String(j.folder);
    CFG.defDir = String(j.default || j.folder);
    CFG.custom = !!j.custom;
    CFG.missing = String(j.missing || '');
    CFG.sep = j.sep || (CFG.dir.indexOf('\\') >= 0 ? '\\' : '/');
    CFG.recent = Array.isArray(j.recent) ? j.recent.filter(function (r) { return r && r.path; }) : [];
  }

  /* A project is just the folder the Hotbox file lives in: it is named after the folder (MyShow/hotbox after
     MyShow), and the default folder is the Default project */
  function cfgProjectName(dir) {
    if (dir === undefined ? !CFG.custom : dir === CFG.defDir) return 'Default';
    var parts = String(dir === undefined ? CFG.dir : dir).replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
    var name = parts.pop() || String(dir);
    if (/^\.?hotbox$/i.test(name) && parts.length) name = parts.pop();
    return name;
  }

  /* The projects used last, as one-click buttons (attr: the attribute that carries the path) */
  function cfgRecentHTML(attr, tip) {
    if (!CFG.recent.length) return '';
    return '<div class="shb-cfg-recent"><span>Recent</span>' + CFG.recent.map(function (r) {
      return '<button type="button" class="shb-btn shb-btn-pri" ' + attr + '="' + esc(r.path) + '" ' + (tip || 'title') + '="' + esc(r.path) + '">' +
        ico('folder', 12) + '<span>' + esc(cfgProjectName(r.path)) + '</span></button>';
    }).join('') + '</div>';
  }

  /* Reads the file in use (active.json says which version) */
  function cfgLoad(boot) {
    CFG.file = 'hotbox.json';
    return cfgRead('active.json').catch(function () { return null; }).then(function (act) {
      if (act && CFG_NAME_RE.test(String(act.file || ''))) CFG.file = act.file;
      return cfgRead(CFG.file);
    }).then(function (raw) {
      CFG.ready = true;
      /* Changed while the files could not be reached: this browser has the newest copy */
      if (CFG.pending) {
        CFG.pending = false;
        CFG.origin = 'browser';
        cfgWrite();
        cfgListVersions();
        return;
      }
      var local = null, synced = false;
      if (boot) {
        try {
          local = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
          synced = !!localStorage.getItem(CFG_SYNCED_KEY);
        } catch (e) {}
      }
      if (raw && !(local && !synced && raw.origin === 'defaults')) {
        applyConfig(raw);
        CFG.origin = raw.origin || 'browser';
        CFG.state = 'saved';
        CFG.savedAt = Date.parse(raw.saved_at) || Date.now();
        cfgMarkSynced();
        cfgApplied();
      } else if (local || !boot) {
        /* This browser's preferences from before the file existed become the file. They also win over a
           file that a fresh browser started from scratch, so moved buttons are never lost. */
        CFG.origin = 'browser';
        cfgWrite();
      } else {
        CFG.origin = 'defaults';
        CFG.state = 'new';
      }
      cfgListVersions();
    }).catch(function (err) {
      CFG.state = 'error';
      CFG.err = msgOf(err);
      cfgShow();
    });
  }

  /* Points Hotbox at another folder ('' = back to the default one), after writing what is pending to the
     folder in use. `copy` false leaves a folder with no Hotbox files empty instead of copying the current ones */
  function cfgPostFolder(path, copy) {
    var flush = CFG.timer ? cfgWrite() : Promise.resolve();
    return flush.then(function () {
      return apiFetch('/hotbox/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: path, copy: copy !== false }) });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j;
      });
    }).then(function (j) {
      cfgTakeFolder(j);
      return j;
    });
  }

  /* Set Project: the preferences already in that folder load as they are; a folder without any starts with
     a copy of the current ones */
  function cfgSetFolder(path, onDone) {
    cfgPostFolder(path, true).then(function (j) {
      return cfgLoad(false).then(function () {
        setStatus('ok', !CFG.custom ? '✓ Back to the Default project'
          : j.found ? '✓ Project ' + cfgProjectName() + ': its preferences are loaded'
          : '✓ Project ' + cfgProjectName() + ' set up with a copy of your preferences');
      });
    }).catch(function (err) {
      setStatus('error', 'Could not set that project: ' + msgOf(err));
    }).then(function () {
      if (typeof onDone === 'function') onDone();
    });
  }

  /* The bottom bar's own buttons, in their order */
  var BOT_DEFAULTS = ['tool:loadcanvas', 'tool:prev', 'tool:seedtoggle', 'tool:bypass', 'tool:zoom', 'tool:apibypass',
    'tool:swappair', 'tool:magic', 'tool:render'];
  /* set when an emptied bottom bar was mended: the shared library's buttons go back once the libraries load */
  var HB_LIB_FIX = false;

  function hbKeyRefused(key, code) {
    var no = {
      Delete: 1, Backspace: 1, Escape: 1, Enter: 1, Tab: 1,
      ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
      Home: 1, End: 1, PageUp: 1, PageDown: 1
    };
    var k = String(key || '');
    if (no[k]) return k;
    if (String(code || '') === 'Delete' || String(code || '') === 'Backspace') {
      return String(code);
    }
    return '';
  }

  loadConfig();

  /* ---------------------------------------------------------------------
   * 2. DOM & COMFYUI HELPERS
   * --------------------------------------------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function owns(el) {
    if (el && el.setAttribute) el.setAttribute('data-shb-owned', '1');
    return el;
  }

  function listen(target, type, fn, opts) {
    try { target.addEventListener(type, fn, opts || false); } catch (e) {}
  }

  function every(ms, fn) {
    return setInterval(function () {
      try { fn(); } catch (e) {}
    }, ms);
  }

  function getApp() {
    return (window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app)
      || window.app || null;
  }

  function litegraph() {
    return window.LiteGraph
      || (window.comfyAPI && window.comfyAPI.litegraph && window.comfyAPI.litegraph.LiteGraph)
      || null;
  }

  function getCanvas() {
    var app = getApp();
    return (app && app.canvas) || null;
  }

  function getGraph() {
    var app = getApp();
    var c = app && app.canvas;
    return (c && c.graph) || (app && app.graph) || null;
  }

  function apiFetch(path, opts) {
    var app = getApp();
    var api = (app && app.api) || (window.comfyAPI && window.comfyAPI.api && window.comfyAPI.api.api);
    if (api && typeof api.fetchApi === 'function') {
      return api.fetchApi(path, opts);
    }
    return fetch(path, opts);
  }

  function viewURL(info) {
    if (!info || !info.filename) return '';
    var q = 'filename=' + encodeURIComponent(info.filename)
      + '&type=' + encodeURIComponent(info.type || 'output')
      + (info.subfolder ? '&subfolder=' + encodeURIComponent(info.subfolder) : '');
    var app = getApp();
    var api = (app && app.api) || null;
    if (api && typeof api.apiURL === 'function') {
      return api.apiURL('/view?' + q);
    }
    return '/view?' + q;
  }

  function msgOf(err) {
    if (!err) return 'unknown error';
    if (typeof err === 'string') return err;
    return String(err.message || err.statusText || err);
  }

  /* Toast notification + status pill update */
  var TOAST_TIMER = 0;
  function setStatus(kind, text) {
    if (!text) return;
    var t = document.getElementById(PANEL_ID + '-toast');
    if (!t) {
      t = owns(document.createElement('div'));
      t.id = PANEL_ID + '-toast';
      t.className = 'shb-toast';
      document.body.appendChild(t);
    }
    t.className = 'shb-toast shb-toast-' + (kind || 'ok') + ' shb-toast-on';
    t.textContent = text;
    if (TOAST_TIMER) clearTimeout(TOAST_TIMER);
    TOAST_TIMER = setTimeout(function () {
      if (t) t.className = 'shb-toast';
    }, 3400);
  }

  /* ---------------------------------------------------------------------
   * 3. NATIVE COMFYUI SVG ICONS & STYLESHEET INJECTION
   * --------------------------------------------------------------------- */
  var ICONS = {
    trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    collapse: '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>',
    bypass: '<path d="M4 15c2-5 6-7 11-7h5"/><path d="M16 4l4 4-4 4"/><circle cx="12" cy="15" r="1.5" fill="currentColor"/>',
    more: '<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>',
    chevDown: '<path d="M6 9l6 6 6-6"/>',
    chevRight: '<path d="M9 6l6 6-6 6"/>',
    chevUp: '<path d="M6 15l6-6 6 6"/>',
    group: '<rect x="3" y="4" width="18" height="16" rx="2" stroke-dasharray="3 2.6"/><path d="M3 9h18"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    stitch: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
    resize: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
    flip: '<path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/>',
    paint: '<path d="M18.37 2.63a2.12 2.12 0 0 1 3 3L14 13l-4 1 1-4Z"/><path d="M9 14c-2.5 0-4.5 1.5-4.5 4 0 1.3-.8 2-2 2 1.2 1.2 3 2 5 2 3.5 0 5.5-2.2 5.5-5"/>',
    compare: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
    preview: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    save: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    loadCanvas: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    lupa: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
    label: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    reroute: '<circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/>',
    set: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49"/><path d="M7.76 16.24a6 6 0 0 1 0-8.49"/>',
    seed: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
    video: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z"/>',
    model: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
    subgraph: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    arrange: '<rect x="2" y="4" width="7" height="5" rx="1.2"/><rect x="15" y="4" width="7" height="5" rx="1.2"/><rect x="15" y="15" width="7" height="5" rx="1.2"/><path d="M9 6.5h6"/><path d="M12 6.5v11h3"/>',
    zoom: '<circle cx="12" cy="12" r="8"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    swap: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    sync: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    layout: '<rect x="3" y="3" width="18" height="6" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    play: '<polygon points="7 4 20 12 7 20 7 4"/>',
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    pointer: '<path d="M9 9l5 12 1.8-5.2L21 14 9 9z"/><path d="M7.2 2.2 8 5.1"/><path d="M5.1 8l-2.9-.8"/><path d="M14 4.1 12 6"/><path d="M6 12l-1.9 2"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.8 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.7-1.7h2c3 0 5.5-2.5 5.5-5.5C22 6 17.5 2 12 2z"/>',
    sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z"/>',
    spacing: '<path d="M3 3v18"/><path d="M21 3v18"/><path d="M8 12h8"/><path d="M11 9l-3 3 3 3"/><path d="M13 9l3 3-3 3"/>',
    tools: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
    leaders: '<circle cx="12" cy="12" r="2"/><path d="M10.6 10.6 4 4"/><path d="M13.4 10.6 20 4"/><path d="M12 14v7"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    pipette: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
    zapOff: '<path d="M10.5 4.9 13.1 2.2a.5.5 0 0 1 .9.5l-1.4 4.3"/><path d="M15.7 10H20a1 1 0 0 1 .8 1.6l-1.7 1.8"/><path d="M16.3 16.3 10.9 21.8a.5.5 0 0 1-.9-.5l1.9-6A1 1 0 0 0 11 14H4a1 1 0 0 1-.8-1.6l4.5-4.6"/><path d="m2 2 20 20"/>',
    grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    wand: '<path d="M21.6 3.6 20.4 2.4a1.2 1.2 0 0 0-1.7 0L2.4 18.6a1.2 1.2 0 0 0 0 1.7l1.3 1.3a1.2 1.2 0 0 0 1.7 0L21.6 5.4a1.2 1.2 0 0 0 0-1.8"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/>'
  };

  function ico(name, size) {
    var s = size || 15;
    var body = ICONS[name] || ICONS.plus;
    return '<svg class="shb-ico" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  function injectStyles() {
    var st = document.getElementById(PANEL_ID + '-css');
    if (!st) {
      st = owns(document.createElement('style'));
      st.id = PANEL_ID + '-css';
      document.head.appendChild(st);
    }
    st.textContent = [
      /* Native ComfyUI Design Tokens */
      ':root{--shb-bg:var(--p-content-background,var(--comfy-menu-bg,#222222));--shb-bg-elev:#2a2a2a;--shb-bg-hover:#333333;--shb-bg-input:#1a1a1a;--shb-border:#3c3c3c;--shb-border-hover:#525252;--shb-fg:#e2e2e2;--shb-fg-muted:#9a9a9a;--shb-fg-dim:#6e6e6e;--shb-accent:#5c94f0;--shb-shadow:0 4px 16px rgba(0,0,0,.45)}',

      /* Topbar Logo Button — matches ImissNuke [N] button in ComfyUI top bar */
      '.shb-topbar-btn{display:inline-flex !important;align-items:center !important;justify-content:center !important;min-width:32px !important;height:32px !important;padding:0 4px !important;margin:0 3px !important;background:#2b2b34 !important;border:1px solid #3c3c46 !important;border-radius:8px !important;cursor:pointer !important;transition:background-color .15s ease,border-color .15s ease,color .15s ease !important;user-select:none !important;vertical-align:middle !important;box-sizing:border-box !important;box-shadow:none !important}',
      '.shb-topbar-btn.in-grouped{margin:0 0 0 3px !important}',
      '.shb-topbar-btn.shb-floating-fallback{position:fixed !important;top:8px !important;right:16px !important;z-index:99990 !important}',
      '.shb-topbar-btn:hover{background:#383844 !important;border-color:#4c4c58 !important}',
      '.shb-topbar-btn .shb-h-icon{display:flex;align-items:center;justify-content:center;color:#71717a !important}',
      '.shb-topbar-btn .shb-h-icon svg{display:block;width:24px;height:24px}',
      '.shb-topbar-btn:hover .shb-h-icon{color:#e2e8f0 !important}',
      /* on: the logo chip, Comfy yellow on plum */
      '.shb-topbar-btn.tool-on{background:#211927 !important;border-color:#3a2b45 !important}',
      '.shb-topbar-btn.tool-on .shb-h-icon{color:#F2FF59 !important}',
      '.shb-topbar-btn.tool-on:hover{background:#2d2236 !important;border-color:#5a4768 !important}',
      '.shb-topbar-btn.open{box-shadow:0 0 0 2px rgba(242,255,89,.4) !important}',

      /* Toast — matches ComfyUI PrimeVue toast */
      '.shb-toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(10px);z-index:2147483600;padding:8px 14px;border-radius:8px;background:var(--shb-bg);border:1px solid var(--shb-border);color:var(--shb-fg);font:500 12px/1.3 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:var(--shb-shadow);opacity:0;pointer-events:none;transition:opacity .15s,transform .15s;max-width:82vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.shb-toast-on{opacity:1;transform:translateX(-50%) translateY(0)}',
      '.shb-toast-ok{border-color:#4b4b4b}',
      '.shb-toast-error{border-color:#a94442;color:#f2b8b5}',
      '.shb-toast-busy{border-color:#8a6d3b;color:#f5d69b}',

      /* Fullscreen Hotbox Overlay (pointer-events:none on backdrop so canvas/nodes are never blocked) */
      '.shb-wrap{position:fixed;inset:0;z-index:2147482500;pointer-events:none;user-select:none;font:500 12.5px/1.3 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--shb-fg)}',
      '.shb-closing .shb-zone{pointer-events:none !important}',

      /* Zones are un-animated positioning wrappers: never put opacity/filter on them or the glass breaks */
      '.shb-zone{position:fixed;display:flex;flex-direction:column;gap:6px;width:max-content;pointer-events:auto;z-index:2}',
      '.shb-zone-top{transform:translate(-50%,-100%);align-items:center;gap:14px}',
      '.shb-zone-bot{transform:translate(-50%,0);align-items:center}',
      '.shb-zone-left{transform:translate(-100%,-50%);align-items:flex-end}',
      '.shb-zone-right{transform:translate(0,-50%);align-items:flex-start}',
      /* the bottom bar and its "+" ride one row, so the "+" stays centered on the bar when the Custom Bar sits above it */
      '.shb-botrow{position:relative;display:flex;justify-content:center}',
      '.shb-botrow > .shb-plus-wrap{position:absolute;left:100%;top:50%;margin-left:12px;transform:translateY(-50%);display:flex}',
      '.shb-zone-bot.shb-plus-left .shb-botrow > .shb-plus-wrap{left:auto;right:100%;margin-left:0;margin-right:12px}',
      /* Custom Bar: buttons other extensions hand to the hotbox (window.__hotboxBars), above the bottom bar */
      '.shb-cbar-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}',
      '.shb-editing .shb-cbar{opacity:.4;pointer-events:none}',
      '.shb-zone-drawer{transform:none;z-index:30}',
      '.shb-zone-catmenu{transform:none;z-index:31}',
      '.shb-bar,.shb-card,.shb-drawer,.shb-editbar,.shb-plus,.shb-dial-in,.shb-catmenu,.shb-wmenu{zoom:var(--shb-zoom,1)}',

      /* Shared structure (both themes) */
      '.shb-bar{display:flex;align-items:center;gap:3px;padding:5px 8px;flex-wrap:wrap;justify-content:center;max-width:84vw}',
      '.shb-card{display:flex;flex-direction:column;gap:2px;padding:7px;min-width:184px}',
      '.shb-card-hd{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.shb-card-hd .shb-hd-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.shb-sep{height:1px;background:#333333;margin:4px 2px}',
      '.shb-vsep{width:1px;height:18px;background:var(--shb-border);margin:0 4px;flex-shrink:0}',
      '.shb-bar-items{display:inline-flex;align-items:center;gap:2px;flex-wrap:wrap;justify-content:center}',
      '.shb-bar-items:empty{display:none}',
      '.shb-editing .shb-bar-items:empty,.shb-dropping .shb-bar-items:empty{display:inline-flex;min-width:28px;min-height:28px}',
      '.shb-wrap:not(.shb-editing):not(.shb-dropping) .shb-ctx:not(:has(.shb-item-wrap,.shb-segc,.shb-w-host)){display:none}',
      '.shb-rows{position:relative;display:flex;flex-direction:column}',
      '.shb-hl{position:absolute;left:0;right:0;top:0;height:34px;pointer-events:none;opacity:0}',
      '.shb-row{position:relative;display:flex;align-items:center;width:100%;border:0;background:transparent;cursor:pointer;text-align:left;box-sizing:border-box}',
      '.shb-row .shb-row-l{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.shb-lbl{white-space:nowrap}',

      /* Buttons, Icon Buttons & Key Badges (also used by the settings / label modals) */
      '.shb-ico{flex-shrink:0;color:#a8a8a8;transition:color .12s}',
      '.shb-btn{display:inline-flex;align-items:center;gap:7px;padding:6px 10px;border-radius:6px;border:1px solid transparent;background:transparent;color:#ededed;font:500 12.5px/1.2 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s,color .12s}',
      '.shb-btn:hover{background:var(--shb-bg-hover);color:#ffffff}',
      '.shb-btn:hover .shb-ico{color:#ffffff}',
      '.shb-btn:active{background:#3a3a3a}',
      '.shb-btn-ico{padding:5px 7px;justify-content:center;color:#a8a8a8}',
      '.shb-btn-ico:hover{color:#ffffff;background:var(--shb-bg-hover)}',
      '.shb-btn-row{width:100%;justify-content:space-between;padding:7px 9px;border-radius:6px;background:transparent;border-color:transparent}',
      '.shb-btn-row:hover{background:var(--shb-bg-hover);border-color:transparent}',
      '.shb-btn-row.shb-active{background:var(--shb-bg-hover);border-color:var(--shb-border-hover);color:#ffffff}',
      '.shb-btn-pri,.shb-btn-amber,.shb-btn-teal,.shb-btn-purple{background:var(--shb-bg-elev);border-color:var(--shb-border);color:#f0f0f0}',
      '.shb-btn-pri:hover,.shb-btn-amber:hover,.shb-btn-teal:hover,.shb-btn-purple:hover{background:var(--shb-bg-hover);border-color:var(--shb-border-hover);color:#ffffff}',
      '.shb-btn-on{background:#2d3542;border-color:var(--shb-accent);color:#ffffff}',
      '.shb-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:17px;padding:0 5px;border-radius:4px;background:#2b2b2b;border:1px solid #444444;color:#b0b0b0;font:600 10.5px/1 Inter,system-ui,sans-serif}',
      '.shb-ibtn{width:30px;height:28px;border-radius:6px;border:0;background:transparent;display:grid;place-items:center;color:#888;cursor:pointer;padding:0}',
      '.shb-ibtn .shb-ico{color:inherit}',
      '.shb-drawer .shb-btn-row.shb-qsel{background:var(--shb-bg-hover);box-shadow:inset 0 0 0 1px rgba(100,168,240,.55)}',
      '.shb-fluid .shb-drawer .shb-btn-row.shb-qsel{background:rgba(255,255,255,.1)}',
      '.shb-src{max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 10px/1 Inter,system-ui,sans-serif;color:#8a8a8a;opacity:.85}',
      '.shb-inbar{display:inline-grid;place-items:center;min-width:18px;height:18px;border-radius:6px;font:700 11px/1 Inter,system-ui,sans-serif;color:#64a8f0;background:rgba(100,168,240,.14)}',
      '.shb-drawer-sec{padding:6px 10px 4px;font:600 11px/1.2 Inter,system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase;color:#64a8f0}',
      '.shb-drawer-hint{padding:1px 4px 2px;font:500 10.5px/1.2 Inter,system-ui,sans-serif;color:#8e8e8e}',

      /* Bar items: × badges, removal collapse, drag source & edit-mode outline */
      '.shb-item-wrap{position:relative;display:inline-flex;align-items:center;max-width:320px}',
      /* Button groups (yours: drop one button on another) and folds (extension bars). A group opens a list
         under its button on hover; a row fold opens a second row under the whole bar */
      '.shb-grp{position:relative;display:inline-flex;align-items:center}',
      '.shb-item-wrap.shb-grp{max-width:none}',
      '.shb-gdrop{display:none;position:absolute;left:50%;top:calc(100% + 8px);translate:calc(-50% + var(--gx,0px)) 0;flex-direction:column;align-items:stretch;gap:2px;min-width:max(100%,172px);z-index:5;box-sizing:border-box;transform-origin:50% 0}',
      '.shb-gdrop.shb-gdrop-up{top:auto;bottom:calc(100% + 8px);transform-origin:50% 100%}',
      '.shb-grp-show > .shb-gdrop{display:flex}',
      '.shb-gdrop::before{content:"";position:absolute;left:0;right:0;top:-10px;height:10px}',
      '.shb-gdrop.shb-gdrop-up::before{top:auto;bottom:-10px}',
      '.shb-gdrop > .shb-item-wrap{max-width:none}',
      '.shb-gdrop > .shb-item-wrap > .shb-btn,.shb-gdrop > .shb-btn{width:100%;justify-content:flex-start;margin:0}',
      '.shb-gdrop .shb-x{left:auto;right:-5px}',
      '.shb-zone:has(.shb-grp-show){z-index:6}',
      '.shb-gtray{display:none;align-items:center;gap:2px;box-sizing:border-box}',
      '.shb-gtray.shb-gtray-on{display:inline-flex}',
      '.shb-gtray-anim{overflow:hidden;flex-wrap:nowrap}',
      '.shb-tray-row{flex-basis:100%;order:99;flex-wrap:wrap;justify-content:center}',
      '.shb-w-host:has(> .shb-tray-row.shb-gtray-on){flex-basis:100%}',
      '.shb-grp-chev{display:inline-grid;place-items:center;padding:3px;margin:-3px -4px -3px -2px;border-radius:6px;opacity:.55;transition:transform 170ms cubic-bezier(.2,.9,.1,1),opacity 80ms,background 60ms}',
      '.shb-grp-chev:hover{opacity:1;background:rgba(255,255,255,.12)}',
      '.shb-grp-chev .shb-ico{color:inherit}',
      '.shb-fold-on > .shb-grp-chev,.shb-grp-show > .shb-btn .shb-grp-chev{transform:rotate(180deg);opacity:.9}',
      '.shb-grp-pin > .shb-btn .shb-grp-chev{color:#5aa2f0;opacity:1}',
      '.shb-grp-drop > .shb-btn{box-shadow:inset 0 0 0 1.5px #5aa2f0 !important;background:rgba(90,162,240,.18) !important}',
      '.shb-item-wrap > .shb-btn{position:relative}',
      '.shb-item-wrap.shb-removing{max-width:0;opacity:0;transform:scale(.3);overflow:hidden;transition:max-width 120ms cubic-bezier(.2,.9,.1,1),opacity 90ms ease,transform 120ms cubic-bezier(.2,.9,.1,1)}',
      '.shb-item-wrap.shb-drag-src{pointer-events:none}',
      '.shb-item-wrap.shb-collapsed{max-width:0;opacity:0;overflow:hidden;transition:max-width 120ms cubic-bezier(.2,.9,.1,1),opacity 90ms}',
      '.shb-editing [data-hb-bar] .shb-btn{cursor:grab}',
      '.shb-btn.shb-outline{outline:1px dashed rgba(255,255,255,.3);outline-offset:1px}',
      '.shb-x{display:none;position:absolute;border-radius:50%;place-items:center;cursor:pointer;box-sizing:border-box;z-index:2}',
      '.shb-editing .shb-x{display:grid}',
      '.shb-editbar{display:none;align-items:center;white-space:nowrap}',
      '.shb-editing .shb-editbar{display:flex}',
      '.shb-editbar-b{border:0;background:transparent;cursor:pointer}',
      '.shb-editbar-b.shb-editbar-on{background:rgba(255,255,255,.14)}',
      '.shb-editbar{position:relative}',
      '.shb-editbar-b:disabled{opacity:.35;cursor:default;pointer-events:none}',
      /* edit mode says so quietly: "Editing" in the edit bar and a fine line around every bar */
      '.shb-editbar-tag{display:inline-flex;align-items:center;gap:6px;margin-right:8px;font:600 10.5px/1 Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#9cc2f5}',
      '.shb-editbar-tag i{width:6px;height:6px;border-radius:50%;background:#64a8f0}',
      '.shb-editing .shb-bar{outline:calc(1.5px / var(--shb-zoom,1)) solid rgba(100,168,240,.6);outline-offset:calc(-1.5px / var(--shb-zoom,1))}',
      /* while a button is dragged the edit bar is where it can be dropped to take it off its bar */
      '.shb-editbar-trash{position:absolute;inset:0;z-index:3;display:none;align-items:center;justify-content:center;gap:8px;border-radius:inherit;background:rgba(92,36,32,.97);color:#ffd9d3;font:600 12px/1 Inter,system-ui,sans-serif;box-shadow:inset 0 0 0 1px rgba(224,112,95,.55)}',
      '.shb-dragging .shb-editbar-trash{display:flex}',
      '.shb-editbar-trash.shb-hot{background:#a8433a;color:#fff;box-shadow:inset 0 0 0 2px #ffb3a6}',
      /* the place a dragged button will take: an empty slot, drawn where it lands */
      '.shb-item-wrap.shb-drag-src > .shb-btn{background:rgba(92,148,240,.16) !important;box-shadow:inset 0 0 0 1.5px rgba(110,165,245,.95) !important;border-color:transparent !important;outline:none !important}',
      '.shb-item-wrap.shb-drag-src > .shb-btn > *{visibility:hidden}',
      '.shb-item-wrap.shb-drag-gone > .shb-btn{background:rgba(224,112,95,.12) !important;box-shadow:inset 0 0 0 1.5px rgba(224,112,95,.75) !important}',
      /* ...and the button itself, lifted: a little bigger, with a shadow, under the pointer */
      '.shb-ghost.shb-lift,.shb-ghost.shb-lift.shb-fluid,.shb-ghost.shb-lift.shb-quiet,.shb-ghost.shb-lift.shb-fluid.shb-ghost-over,.shb-ghost.shb-lift.shb-fluid.shb-ghost-rm,.shb-ghost.shb-lift.shb-quiet.shb-ghost-rm{padding:0;border:0;background:none;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;flex-direction:column;gap:9px;transform:translate(-50%,-50%);transition:none}',
      '.shb-lift > .shb-btn{transform:scale(1.12);box-shadow:0 16px 36px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.22) !important;cursor:grabbing}',
      '.shb-lift.shb-ghost-rm > .shb-btn{box-shadow:0 16px 36px rgba(0,0,0,.6),0 0 0 2px #e0705f !important;opacity:.85}',
      '.shb-lift .shb-ghost-hint,.shb-ghost.shb-lift.shb-fluid .shb-ghost-hint,.shb-ghost.shb-lift.shb-quiet .shb-ghost-hint{padding:4px 8px;border-radius:8px;background:rgba(20,20,22,.9);color:#d8d8dc;font:500 11px/1 Inter,system-ui,sans-serif}',
      '.shb-lift .shb-ghost-hint:empty{display:none}',
      /* Glass Blur off (Settings → Effects): plain panels, for a browser without a GPU */
      '.shb-fluid.shb-noblur .shb-bar,.shb-fluid.shb-noblur .shb-card,.shb-fluid.shb-noblur .shb-drawer,.shb-fluid.shb-noblur .shb-editbar,.shb-fluid.shb-noblur .shb-dial-in,.shb-fluid.shb-noblur .shb-catmenu,.shb-fluid.shb-noblur .shb-wmenu,.shb-ghost.shb-fluid.shb-noblur{-webkit-backdrop-filter:none;backdrop-filter:none;background:#29292d}',
      /* edit mode shows an empty context bar as a place to drop buttons: it hangs under the dock instead of pushing it up, so the dock stays under the pointer */
      '.shb-editing .shb-zone-top > .shb-ctx:not(:has(.shb-item-wrap:not(.shb-drag-src),.shb-segc,.shb-w-host)){position:absolute;top:100%;left:50%;translate:-50% 0;margin-top:6px}',

      /* Ratio segmented control with sliding thumb */
      '.shb-segc{position:relative;display:flex}',
      '.shb-segc-b{position:relative;border:0;background:transparent;cursor:pointer;padding:0}',

      /* Bar widgets (Label bar, extension bars): groups, fields, steppers, sliders, swatches, segments, menus */
      '.shb-w-host{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;justify-content:center}',
      '.shb-w-wrap{display:inline-flex;align-items:center;gap:6px}',
      '.shb-w-cap{white-space:nowrap}',
      '.shb-w-grp{display:inline-flex;align-items:center;gap:2px}',
      '.shb-w-in{box-sizing:border-box;outline:none;user-select:text;min-width:0}',
      '.shb-w-num{display:inline-flex;align-items:center;gap:3px}',
      '.shb-w-nin{text-align:center;font-variant-numeric:tabular-nums}',
      '.shb-w-step{display:grid;place-items:center;border:0;cursor:pointer;padding:0}',
      '.shb-w-step .shb-ico{color:inherit}',
      '.shb-w-range{display:inline-flex;align-items:center;gap:7px}',
      '.shb-w-range input{-webkit-appearance:none;appearance:none;margin:0;height:16px;background:transparent;cursor:ew-resize}',
      '.shb-w-range input::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:var(--shb-w-track)}',
      '.shb-w-range input::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;background:var(--shb-w-thumb);box-shadow:0 1px 4px rgba(0,0,0,.45)}',
      '.shb-w-range input::-moz-range-track{height:4px;border-radius:2px;background:var(--shb-w-track)}',
      '.shb-w-range input::-moz-range-thumb{width:14px;height:14px;border:0;border-radius:50%;background:var(--shb-w-thumb)}',
      '.shb-w-val{min-width:40px;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.shb-w-sw,.shb-w-seg{display:inline-flex;align-items:center}',
      '.shb-w-segb{border:0;background:transparent;cursor:pointer;white-space:nowrap}',
      '.shb-w-field{display:inline-flex;align-items:center;gap:6px;border:0;cursor:pointer;white-space:nowrap}',
      '.shb-w-car{display:inline-grid;place-items:center;opacity:.6}',
      '.shb-w-car .shb-ico{color:inherit}',
      '.shb-w-badge{display:inline-grid;place-items:center;min-width:16px;height:16px;padding:0 5px;box-sizing:border-box;border-radius:8px;font:600 10px/1 Inter,system-ui,sans-serif}',
      '.shb-w-info{display:inline-flex;align-items:center;gap:6px;max-width:260px;padding:0 6px;white-space:nowrap;overflow:hidden;cursor:default}',
      '.shb-w-info span{overflow:hidden;text-overflow:ellipsis}',
      '.shb-zone-wmenu{transform:none;z-index:32}',
      '.shb-wmenu{display:flex;flex-direction:column;gap:4px;min-width:200px;max-width:340px;box-sizing:border-box}',
      '.shb-wmenu-list{display:flex;flex-direction:column;max-height:320px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}',
      '.shb-w-hint{padding-left:10px;white-space:nowrap;opacity:.55;font-size:11px}',
      '.shb-w-empty{padding:10px;opacity:.6;font-size:12px;white-space:nowrap}',
      '.shb-gets{max-height:206px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}',

      /* Color swatches & pipette */
      '.shb-colors{display:flex;align-items:center;flex-wrap:nowrap}',
      '.shb-cdot{display:block;border-radius:50%;cursor:pointer;flex-shrink:0;box-sizing:border-box}',
      '.shb-pipette{position:relative;margin-left:auto;display:grid;place-items:center;width:22px;height:22px;border-radius:6px;cursor:pointer}',
      '.shb-pipette input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:0;padding:0}',

      /* Pro sliders (iOS track in Fluid, hairline in Quiet) */
      '.shb-ps-track{position:relative;touch-action:none;cursor:ew-resize;display:flex;flex-direction:column}',
      '.shb-ps-txt{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;pointer-events:none}',
      '.shb-ps-lbl{pointer-events:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:ew-resize}',
      '.shb-ps-num{pointer-events:auto;width:64px;border:0;outline:none;background:transparent;color:inherit;font:inherit;text-align:right;padding:0;cursor:text;font-variant-numeric:tabular-nums}',
      '.shb-ps-fill{position:absolute;left:0;top:0;bottom:0;pointer-events:none}',
      '.shb-ps-list{display:flex;flex-direction:column;position:relative}',
      '.shb-ps-scroll{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}',
      '.shb-ps-scroll.shb-ps-more-dn{-webkit-mask-image:linear-gradient(#000 calc(100% - 22px),transparent);mask-image:linear-gradient(#000 calc(100% - 22px),transparent)}',
      '.shb-ps-scroll.shb-ps-more-up{-webkit-mask-image:linear-gradient(transparent,#000 22px);mask-image:linear-gradient(transparent,#000 22px)}',
      '.shb-ps-scroll.shb-ps-more-up.shb-ps-more-dn{-webkit-mask-image:linear-gradient(transparent,#000 22px,#000 calc(100% - 22px),transparent);mask-image:linear-gradient(transparent,#000 22px,#000 calc(100% - 22px),transparent)}',

      /* Standalone "+" button, drag ghost & remove poof */
      '.shb-plus{display:grid;place-items:center;border:0;cursor:pointer;padding:0;transition:transform 70ms cubic-bezier(.34,1.56,.64,1),box-shadow 80ms,background 60ms,border-color 60ms}',
      '.shb-plus .shb-ico{transition:transform 90ms cubic-bezier(.34,1.56,.64,1)}',
      '.shb-plus.shb-plus-on .shb-ico{transform:rotate(45deg)}',
      /* Speed dial: the categories fan out above the "+" on hover (the padding bridges the gap so hover holds) */
      '.shb-dial{position:absolute;right:0;bottom:100%;padding-bottom:10px;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(6px) scale(.97);transform-origin:100% 100%;transition:opacity 60ms ease,transform 90ms cubic-bezier(.34,1.4,.64,1),visibility 0s linear 90ms}',
      '.shb-plus-wrap:hover .shb-dial{opacity:1;visibility:visible;pointer-events:auto;transform:none;transition:opacity 60ms ease,transform 90ms cubic-bezier(.34,1.4,.64,1),visibility 0s}',
      '.shb-plus-wrap.shb-drawer-open .shb-dial,.shb-dropping .shb-dial,.shb-editing .shb-dial{display:none}',
      '.shb-dial-in{display:flex;flex-direction:column;width:212px;box-sizing:border-box}',
      '.shb-dial-hd{white-space:nowrap}',
      /* Swappable category shortcut at the end of the dock */
      '.shb-catpick{display:grid;place-items:center;border:0;background:transparent;cursor:pointer;padding:0;color:inherit}',
      '.shb-catmenu{display:flex;flex-direction:column;min-width:200px;box-sizing:border-box}',
      '.shb-catmenu .shb-row .shb-chk{width:14px;text-align:center;flex-shrink:0}',
      /* Floating tooltip (settings & hotbox) */
      '.shb-tip{position:fixed;z-index:2147483640;max-width:300px;padding:8px 10px;border-radius:8px;background:#111113;border:1px solid #3a3a3e;color:#dcdcdc;font:400 11.5px/1.45 Inter,system-ui,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.5);pointer-events:none;opacity:0;transform:translateY(-2px);transition:opacity 90ms ease,transform 90ms ease}',
      '.shb-tip.shb-tip-on{opacity:1;transform:none}',
      /* Power tools rows in settings */
      '.shb-pt{display:flex;flex-direction:column;gap:2px;width:100%}',
      '.shb-pt-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;border:1px solid transparent;background:transparent;cursor:grab;touch-action:none;user-select:none;text-align:left;width:100%;box-sizing:border-box;color:inherit}',
      '.shb-pt-row:hover{background:#262626;border-color:#333}',
      '.shb-pt-row:active{cursor:grabbing}',
      '.shb-pt-grip{display:inline-grid;place-items:center;color:#5a5a5a;flex-shrink:0}',
      '.shb-pt-row:hover .shb-pt-grip{color:#a0a0a0}',
      '.shb-st-dragging .shb-modal{opacity:.14;pointer-events:none !important;transition:opacity 90ms ease}',
      /* Nodes 2.0 seed menu replayed by Seed mode: it opens and closes without being seen */
      '.shb-seedsync [data-reka-popper-content-wrapper]{opacity:0 !important;pointer-events:none !important}',
      /* Where the preferences are saved */
      '.shb-cfg{display:flex;flex-direction:column;gap:5px;min-width:0}',
      '.shb-cfg-path{font:500 11px/1.4 "JetBrains Mono",ui-monospace,Consolas,monospace;color:#cfd6e0;background:#161616;border:1px solid #333;border-radius:6px;padding:6px 8px;word-break:break-all;user-select:text;cursor:text}',
      '.shb-cfg-row{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.shb-cfg-state{font-size:11px;color:#8a8a8a}',
      '.shb-cfg-saved{color:#7fbf8f}',
      '.shb-cfg-error{color:#e8735f}',
      '.shb-cfg-btns{display:flex;flex-wrap:wrap;gap:6px}',
      '.shb-cfg-warn{font-size:11px;color:#e8b45f;line-height:1.35}',
      '.shb-cfg-edit{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid #333;border-radius:6px;background:#1b1b1b}',
      '.shb-cfg-edit input{width:100%;box-sizing:border-box;font:500 11px/1.4 "JetBrains Mono",ui-monospace,Consolas,monospace;color:#e6e6e6;background:#111;border:1px solid #3a3a3a;border-radius:5px;padding:6px 8px;outline:none}',
      '.shb-cfg-edit input:focus{border-color:#64a8f0}',
      '.shb-cfg-edit small{font-size:11px;color:#8a8a8a;line-height:1.4}',
      '.shb-cfg-proj{display:inline-flex;align-items:center;gap:6px;min-width:0;font-size:12.5px;color:#e6e6e6}',
      '.shb-cfg-proj b{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.shb-cfg-recent{display:flex;flex-wrap:wrap;align-items:center;gap:5px}',
      '.shb-cfg-recent > span{font-size:11px;color:#8a8a8a;margin-right:2px}',
      '.shb-cfg-recent .shb-btn{padding:4px 8px;font-size:11.5px;gap:5px}',
      '.shb-cfg-note{font-size:11px;color:#8a8a8a;line-height:1.4}',
      /* Shared libraries in Settings */
      '.shb-lib-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 0;border-bottom:1px solid #2c2c2c}',
      '.shb-lib-main{flex:1 1 200px;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.shb-lib-main b{font-size:12px;font-weight:700}',
      '.shb-lib-main small{font:500 10.5px/1.35 "JetBrains Mono",ui-monospace,Consolas,monospace;color:#8a8a8a;word-break:break-all}',
      '.shb-lib-st{font-size:11px;color:#8a8a8a}',
      '.shb-lib-miss{color:#e8b45f}',
      '.shb-lib-tag{font-size:10.5px;color:#8a8a8a;border:1px solid #3a3a3a;border-radius:5px;padding:2px 6px}',
      '.shb-sb-lib{font-size:11px;font-weight:700;color:#8a8a8a;margin:8px 4px 2px}',
      /* Saved buttons in Settings: the same draggable rows as the power tools */
      '.shb-sb-list{max-height:260px;overflow-y:auto;scrollbar-width:thin}',
      '.shb-sb-empty{font-size:11.5px;color:#8a8a8a;padding:8px 4px;line-height:1.4}',
      '.shb-sb-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;padding-top:6px;border-top:1px solid #2c2c2c;font-size:11px;color:#8a8a8a;min-width:0}',
      '.shb-sb-foot span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.shb-imp-b{width:100%;justify-content:flex-start;text-align:left;padding:10px 12px;gap:10px;white-space:normal;height:auto}',
      '.shb-imp-b b{display:block;font-weight:600}',
      '.shb-imp-b small{display:block;font-weight:400;font-size:11px;color:#9a9a9a;margin-top:3px;line-height:1.35}',
      '.shb-pt-name{flex:1;min-width:0;font:500 12.5px/1.25 Inter,system-ui,sans-serif;color:#e6e6e6}',
      '.shb-pt-name small{display:block;font:400 11px/1.35 Inter,system-ui,sans-serif;color:#8a8a8a;margin-top:1px}',
      '.shb-pt-key{font:500 10.5px/1 "JetBrains Mono",ui-monospace,Consolas,monospace;color:#9a9a9a;background:#262626;border:1px solid #3a3a3a;border-radius:4px;padding:3px 5px;flex-shrink:0}',
      '.shb-grid label.shb-set-l{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}',
      '.shb-set-l .shb-ico{color:#7aa7e0}',
      '.shb-grid label.shb-set-top{align-self:start;padding-top:8px}',
      '.shb-cycle{gap:9px;min-width:168px;justify-content:space-between}',
      '.shb-cycle .shb-ico{color:#8a8a8a}',
      '.shb-cycle-v{flex:1;text-align:left;font-weight:600}',
      '.shb-cycle-dots{display:inline-flex;gap:3px}',
      '.shb-cycle-dots i{width:5px;height:5px;border-radius:50%;background:#4a4a4a}',
      '.shb-cycle-dots i.shb-on{background:#64a8f0}',
      '.shb-ptmenu{gap:8px;min-width:168px;justify-content:space-between}',
      '.shb-ptmenu .shb-ptmenu-v{flex:1;text-align:left}',
      '.shb-pt{margin-top:6px}',
      '.shb-pt-row > .shb-ico{color:#9aa4b2}',
      '.shb-pt-info{width:16px;height:16px;border-radius:50%;border:1px solid #555;color:#9a9a9a;font:600 10px/14px Inter,system-ui,sans-serif;text-align:center;flex-shrink:0;cursor:help}',
      '.shb-ghost{position:fixed;z-index:2147483550;pointer-events:none;display:flex;align-items:center;gap:8px;white-space:nowrap;transform:translate(-50%,-50%)}',
      '.shb-ghost-dot{flex-shrink:0}',
      '.shb-ghost.shb-ghost-rm .shb-ghost-dot{background:#e0705f !important}',
      '.shb-poof{position:fixed;width:0;height:0;pointer-events:none;z-index:2147483550}',
      '.shb-poof-ring{position:absolute;left:-24px;top:-24px;width:48px;height:48px;border-radius:50%;border:1.5px solid rgba(255,255,255,.55);box-sizing:border-box;opacity:0}',
      '.shb-poof-chip{position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap}',
      '.shb-leaders{position:fixed;left:0;top:0;pointer-events:none;z-index:1;overflow:visible}',
      '.shb-leaders line{stroke:rgba(255,255,255,.22);stroke-width:1;stroke-dasharray:1;stroke-dashoffset:0}',

      /* Save as Button: overlay, node ghosts, the flying pill and the saved buttons */
      '.shb-magic{position:fixed;inset:0;pointer-events:none;z-index:2147482600}',
      '.shb-mg-fx{position:absolute;inset:0;pointer-events:none}',
      '.shb-mg-ghost{position:absolute;pointer-events:none;transform-origin:50% 50%;will-change:transform,opacity,filter}',
      '.shb-mg-card{border-radius:8px;background:#2b2b2e;border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 30px rgba(0,0,0,.45);overflow:hidden;box-sizing:border-box}',
      '.shb-mg-card-t{padding:0 10px;display:flex;align-items:center;background:#36363a;color:#e8e8ec;font-weight:600;font-family:Inter,system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.shb-mg-sel{position:absolute;border:1.5px dashed rgba(170,190,255,.8);border-radius:16px;background:rgba(110,140,255,.07);box-sizing:border-box}',
      '.shb-mg-fly{position:absolute;left:0;top:0;opacity:0;display:flex;align-items:center;justify-content:center;white-space:nowrap;overflow:hidden;box-sizing:border-box;padding:8px 12px;border-radius:17px;background:rgba(48,48,54,.92);border:1px solid rgba(255,255,255,.16);box-shadow:0 14px 34px rgba(0,0,0,.5);color:#fff;font:500 13px/1 Inter,system-ui,sans-serif}',
      '.shb-mg-flyc{display:inline-flex;align-items:center;gap:7px}',
      '.shb-magic.shb-quiet .shb-mg-fly{border-radius:6px;padding:7px 10px;background:#262626;border-color:#3a3a3a;font-size:12.5px;color:#e6e6e6}',
      '.shb-mg-slot{display:inline-flex;flex:none;max-width:0;overflow:hidden;padding:4px 0;margin:-4px 0}',
      '.shb-tpl-ico{display:inline-grid;place-items:center}',
      /* a color given in edit mode marks the button's dot, icon or number; the button itself keeps its look */
      '.shb-tinted > .shb-pin-dot{background:var(--shb-tint) !important}',
      '.shb-tinted > .shb-ico,.shb-tinted > .shb-tpl-ico .shb-ico{color:var(--shb-tint) !important}',
      '.shb-tinted > .shb-num{color:var(--shb-tint) !important;box-shadow:inset 0 0 0 1.5px var(--shb-tint)}',
      /* Whole button: a soft wash of the color and a thin ring of it, so the label stays easy to read */
      '.shb-tinted.shb-filled{background:color-mix(in srgb,var(--shb-tint) 26%,transparent) !important;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--shb-tint) 60%,transparent) !important;color:#fff !important}',
      '.shb-tinted.shb-filled:hover{background:color-mix(in srgb,var(--shb-tint) 38%,transparent) !important}',
      '.shb-ebtn-seg.shb-off{opacity:.4;pointer-events:none}',
      /* a power tool you placed where it does not apply right now: it stays, dimmed, and says when it works */
      '.shb-btn.shb-na{opacity:.38}',
      '.shb-btn.shb-na:hover{opacity:.62}',
      '.shb-editing .shb-btn.shb-na{opacity:1}',
      /* Quiet's numbers are bare digits: the color alone marks them, a ring would sit on the digit */
      '.shb-quiet .shb-tinted > .shb-num{box-shadow:none !important}',
      '.shb-ebtn-prev{display:flex;justify-content:center;padding:14px 8px;border-radius:8px;background:#161616;border:1px solid #2c2c2c}',
      '.shb-ebtn-prev .shb-btn{pointer-events:none;gap:8px;padding:8px 13px;border-radius:10px;background:#262626;color:#e6e6e6;font:500 13px/1 Inter,system-ui,sans-serif}',
      '.shb-ebtn-prev .shb-pin-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#5aa2f0}',
      '.shb-ebtn-prev .shb-num{display:grid;place-items:center;width:18px;height:18px;border-radius:6px;background:rgba(255,255,255,.1);font:600 10.5px/1 Inter,system-ui,sans-serif;color:rgba(235,235,245,.7)}',
      '.shb-ebtn-prev .shb-ico{color:#b8b8b8}',
      '.shb-ebtn-row{display:flex;align-items:center;gap:10px}',
      '.shb-ebtn-row > span{min-width:42px;font-size:12px;color:#9a9a9a}',
      '.shb-ebtn-note{font-size:11px;color:#8a8a8a;line-height:1.4}',
      '.shb-tpl-ico .shb-ico{color:oklch(0.82 0.11 300) !important}',
      '.shb-tpl-n{display:inline-grid;place-items:center;min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:rgba(190,170,255,.18);color:#dcd2ff;font:600 10px/1 Inter,system-ui,sans-serif}',
      '.shb-quiet .shb-tpl-n{background:none;color:#a99be0;font-family:var(--shb-mono)}',
      '.shb-tpl-del{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;opacity:.45;cursor:pointer}',
      '.shb-tpl-del:hover{opacity:1;background:rgba(232,115,95,.18)}',
      '.shb-tpl-del.shb-armed{opacity:1;background:rgba(232,115,95,.32);color:#ffb3a6}',
      '.shb-btn.shb-armed{background:rgba(232,115,95,.28);border-color:#e0705f;color:#ffd0c8}',
      '.shb-ebtn-row{flex-wrap:wrap}',
      '.shb-ebtn-key{min-width:96px;justify-content:center;font-weight:600}',
      '.shb-ebtn-row .shb-btn.shb-na{opacity:.45}',
      /* The button browser */
      '.shb-modal.shb-brw{width:min(1040px,95vw);height:min(780px,90vh);max-height:90vh;padding:0;gap:0;overflow:hidden}',
      '.shb-brw > .shb-modal-t,.shb-ted > .shb-modal-t{padding:14px 18px 12px;gap:12px;flex-shrink:0}',
      '.shb-brw-title{display:inline-flex;align-items:center;gap:9px;min-width:0}',
      '.shb-brw-title > span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.shb-brw-title small{font:400 11.5px/1.2 Inter,system-ui,sans-serif;color:#8a8a8a;margin-left:4px;white-space:nowrap}',
      '.shb-brw-tools{display:inline-flex;align-items:center;gap:6px;flex-shrink:0}',
      '.shb-brw-tools .shb-btn:disabled,.shb-ted-foot .shb-btn:disabled{opacity:.4;pointer-events:none}',
      '.shb-brw-tools .shb-btn.shb-na{opacity:.5}',
      '.shb-brw-find{position:relative;display:inline-flex;align-items:center}',
      '.shb-brw-find .shb-ico{position:absolute;left:9px;color:#7d7d7d;pointer-events:none}',
      '.shb-brw-find .shb-input{width:200px;padding-left:28px}',
      '.shb-brw-body{flex:1;min-height:0;overflow-y:auto;padding:2px 18px 18px;scrollbar-width:thin}',
      '.shb-brw-sec{margin:16px 0 9px;font:600 11px/1 Inter,system-ui,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:#a9a9a9}',
      '.shb-brw-sec small{font-weight:400;letter-spacing:0;text-transform:none;color:#6e6e6e;margin-left:8px}',
      '.shb-brw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}',
      '.shb-brw-card{--shb-tint:#b9a6ff;position:relative;display:flex;flex-direction:column;gap:6px;padding:11px 12px 9px 14px;border-radius:10px;background:#262628;border:1px solid #34343a;cursor:pointer;user-select:none;touch-action:none;transition:border-color .12s,background .12s}',
      '.shb-brw-card:hover{border-color:#5a5a64;background:#2b2b2e}',
      '.shb-brw-card::before{content:"";position:absolute;left:0;top:11px;bottom:11px;width:3px;border-radius:0 3px 3px 0;background:var(--shb-tint)}',
      '.shb-brw-card.shb-brw-fill{background:color-mix(in srgb,var(--shb-tint) 18%,#262628)}',
      '.shb-brw-c1{display:flex;align-items:center;gap:8px;min-width:0}',
      '.shb-brw-c1 b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 13px/1.25 Inter,system-ui,sans-serif;color:#f0f0f0}',
      '.shb-brw-ico{display:inline-grid;place-items:center;color:var(--shb-tint);flex-shrink:0}',
      '.shb-brw-ico .shb-ico{color:inherit !important}',
      '.shb-brw-c2{font:400 11.5px/1.35 Inter,system-ui,sans-serif;color:#8f8f95;min-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.shb-brw-c3{display:flex;align-items:center;gap:6px;min-height:26px}',
      '.shb-brw-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border-radius:999px;background:#33333a;color:#cfcfd6;font:500 10.5px/1 Inter,system-ui,sans-serif;white-space:nowrap;max-width:140px;overflow:hidden}',
      '.shb-brw-chip > span{overflow:hidden;text-overflow:ellipsis}',
      '.shb-brw-chip-no{background:transparent;color:#66666c;padding-left:0}',
      '.shb-brw-acts{margin-left:auto;display:inline-flex;gap:2px;opacity:0;transition:opacity .12s}',
      '.shb-brw-card:hover .shb-brw-acts,.shb-brw-grp:hover .shb-brw-acts{opacity:1}',
      '.shb-brw .shb-key{font:600 10px/1 "JetBrains Mono",ui-monospace,Consolas,monospace;color:#d6d6d6;background:#1b1b1d;border:1px solid #45454c;border-radius:4px;padding:3px 5px;flex-shrink:0}',
      '.shb-brw-dragging{opacity:.4}',
      '.shb-brw-grps{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px}',
      '.shb-brw-grp{--shb-tint:#7aa7e0;display:flex;flex-direction:column;gap:9px;padding:10px 12px 12px;border-radius:10px;background:#1f1f21;border:1px dashed #3d3d44;transition:border-color .12s,background .12s}',
      '.shb-brw-grp.shb-brw-hot{border-color:#6ea5f5;border-style:solid;background:#222a36}',
      '.shb-brw-ghd{display:flex;align-items:center;gap:8px;cursor:pointer;min-width:0;min-height:28px}',
      '.shb-brw-ghd b{font:600 13px/1.25 Inter,system-ui,sans-serif;color:#f0f0f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.shb-brw-ghd small{font:400 11px/1 Inter,system-ui,sans-serif;color:#7d7d83;white-space:nowrap}',
      '.shb-brw-mems{display:flex;flex-wrap:wrap;gap:6px;min-height:30px;align-items:center}',
      '.shb-brw-mem{--shb-tint:#b0b0b8;display:inline-flex;align-items:center;gap:6px;padding:5px 6px 5px 8px;border-radius:8px;background:#2c2c30;border:1px solid #3a3a41;color:#e4e4e8;font:500 12px/1 Inter,system-ui,sans-serif;cursor:grab;user-select:none;touch-action:none}',
      '.shb-brw-mem:hover{border-color:#5a5a64}',
      '.shb-brw-out{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:50%;font:600 12px/1 Inter,system-ui,sans-serif;font-style:normal;color:#9a9aa2;cursor:pointer}',
      '.shb-brw-out:hover{background:rgba(232,115,95,.3);color:#fff}',
      '.shb-brw-none{font:400 11.5px/1.3 Inter,system-ui,sans-serif;color:#6e6e74}',
      '.shb-brw-foot{flex-shrink:0;padding:9px 18px;border-top:1px solid #2e2e32;font:400 11px/1.3 Inter,system-ui,sans-serif;color:#7d7d83}',
      /* The nodes of a saved button */
      '.shb-modal.shb-ted{width:min(920px,95vw);height:min(700px,90vh);max-height:90vh;padding:0;gap:0;overflow:hidden}',
      '.shb-select.shb-ted-hist{width:auto;max-width:210px}',
      '.shb-ted-main{flex:1;min-height:0;display:flex}',
      '.shb-ted-list{width:240px;flex-shrink:0;overflow-y:auto;padding:8px;border-right:1px solid #2e2e32;display:flex;flex-direction:column;gap:2px;scrollbar-width:thin}',
      '.shb-ted-n{display:flex;flex-direction:column;gap:2px;align-items:flex-start;text-align:left;padding:7px 9px;border-radius:7px;border:1px solid transparent;background:transparent;color:#dcdce0;cursor:pointer;min-width:0;flex-shrink:0}',
      '.shb-ted-n b{font:500 12.5px/1.25 Inter,system-ui,sans-serif;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.shb-ted-n small{font:400 10.5px/1.2 "JetBrains Mono",ui-monospace,Consolas,monospace;color:#77777d;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.shb-ted-n:hover{background:#27272a}',
      '.shb-ted-n.shb-on{background:#2d3542;border-color:var(--shb-accent);color:#fff}',
      '.shb-ted-pane{flex:1;min-width:0;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:8px;scrollbar-width:thin}',
      '.shb-ted-row{display:grid;grid-template-columns:150px minmax(0,1fr);align-items:start;gap:10px;flex-shrink:0}',
      '.shb-ted-row > label:first-child{padding-top:7px;font:500 12px/1.2 Inter,system-ui,sans-serif;color:#9a9aa0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.shb-input.shb-ted-ta{min-height:74px;resize:vertical;line-height:1.4}',
      '.shb-ted-mono{font:400 11.5px/1.45 "JetBrains Mono",ui-monospace,Consolas,monospace !important;white-space:pre;tab-size:2}',
      '.shb-ted-chk{display:inline-flex;align-items:center;gap:8px;padding-top:6px;color:#cfcfd4;cursor:pointer}',
      '.shb-ted-sec{flex-shrink:0;margin-top:6px;padding-top:11px;border-top:1px solid #2e2e32;font:600 10.5px/1 Inter,system-ui,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:#8a8a90}',
      '.shb-ted-rm{margin-top:auto;padding-top:12px;flex-shrink:0}',
      '.shb-ted-jbar{display:flex;align-items:center;gap:10px;flex-shrink:0}',
      '.shb-ted-jbar small{color:#7d7d83;font-size:11px}',
      '.shb-ted-raw{flex:1;min-height:240px;resize:none}',
      '.shb-ted-foot{flex-shrink:0;display:flex;align-items:center;gap:10px;padding:10px 18px;border-top:1px solid #2e2e32}',
      '.shb-ted-err{color:#f0a196;font-size:11.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      /* Settings → Saved Buttons: groups, and a button's own color on its row */
      '.shb-sb-grp > .shb-ico{color:var(--shb-tint,#7aa7e0)}',
      '.shb-pt-row[style*="--shb-tint"] .shb-tpl-ico .shb-ico{color:var(--shb-tint) !important}',
      '.shb-sb-top{display:flex;gap:6px;align-items:stretch}',
      '.shb-sb-top .shb-ptmenu{flex:1;min-width:0}',

      /* Drawer for Categories / Search / Models */
      '.shb-drawer{display:flex;flex-direction:column;gap:6px;width:320px;max-height:420px;overflow:hidden;box-sizing:border-box}',
      '.shb-search{width:100%;box-sizing:border-box;outline:none}',
      '.shb-list{display:flex;flex-direction:column;gap:1px;overflow-y:auto;max-height:290px;padding-right:2px}',

      /* ---------- 1a FLUID: frosted glass, spring motion, sliding highlights ---------- */
      '.shb-fluid{--shb-glass:rgba(38,38,42,.6);--shb-t1:#f2f2f5;--shb-t2:rgba(235,235,245,.7);--shb-t3:rgba(235,235,245,.5);--shb-blue:#2f86e0;--shb-blue2:#5aa2f0;--shb-danger:#e8735f}',
      '.shb-fluid .shb-bar,.shb-fluid .shb-card,.shb-fluid .shb-drawer,.shb-fluid .shb-editbar,.shb-fluid .shb-dial-in,.shb-fluid .shb-catmenu,.shb-fluid .shb-wmenu{background:var(--shb-glass);-webkit-backdrop-filter:blur(28px) saturate(170%);backdrop-filter:blur(28px) saturate(170%);border:1px solid rgba(255,255,255,.09);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 18px 50px rgba(0,0,0,.45);color:var(--shb-t1)}',
      '.shb-fluid .shb-scrim{position:fixed;inset:0;background:rgba(8,8,10,.16);pointer-events:none;z-index:0}',
      '.shb-fluid .shb-bar{gap:2px;padding:5px;max-width:92vw}',
      '.shb-fluid .shb-dock{border-radius:18px}',
      '.shb-fluid .shb-ctx{border-radius:15px;padding:4px;gap:6px}',
      '.shb-fluid .shb-botbar{border-radius:24px}',
      '.shb-fluid .shb-cbar{border-radius:22px}',
      '.shb-fluid .shb-bar.shb-drop-over{border-color:rgba(255,255,255,.35)}',
      '.shb-fluid .shb-vsep{height:20px;background:rgba(255,255,255,.12)}',
      '.shb-fluid .shb-btn{gap:8px;padding:9px 13px;border:0;border-radius:13px;background:transparent;color:var(--shb-t1);font:500 13px/1 Inter,system-ui,sans-serif;transition:transform 45ms cubic-bezier(.34,1.56,.64,1),background 26ms}',
      '.shb-fluid .shb-btn .shb-ico{color:var(--shb-t2)}',
      '.shb-fluid .shb-btn:hover{background:rgba(255,255,255,.1);color:#fff}',
      '.shb-fluid .shb-btn:hover .shb-ico{color:#fff}',
      '.shb-fluid .shb-btn:active{transform:scale(.95)}',
      '.shb-fluid .shb-btn-on{background:rgba(90,162,240,.22);color:#fff;box-shadow:inset 0 0 0 1px rgba(90,162,240,.55)}',
      '.shb-fluid .shb-fav{padding:9px 12px 9px 9px}',
      '.shb-fluid .shb-fav:hover{transform:translateY(-2px) scale(1.05)}',
      '.shb-fluid .shb-fav:active{transform:scale(.95)}',
      '.shb-fluid .shb-num{width:18px;height:18px;border-radius:6px;background:rgba(255,255,255,.1);display:grid;place-items:center;font:600 10.5px/1 Inter,system-ui,sans-serif;color:rgba(235,235,245,.7);flex-shrink:0}',
      '.shb-fluid .shb-models-btn{padding:9px 12px;gap:6px;color:rgba(235,235,245,.8)}',
      '.shb-fluid .shb-dock-mode{display:inline-flex;align-items:center;gap:6px;padding:0 6px 0 8px;font:600 11px/1 Inter,system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase;color:var(--shb-t3)}',
      /* Swap mode wears its own color, and so does each button that swaps, so they never pass for buttons that add */
      '.shb-fluid .shb-dock-swap{padding:6px 10px 6px 9px;margin-left:2px;border-radius:9px;color:#5fd6c6;background:rgba(95,214,198,.15);box-shadow:inset 0 0 0 1px rgba(95,214,198,.4)}',
      '.shb-fluid .shb-swapi:not(.shb-tinted) > .shb-num{color:#5fd6c6;background:rgba(95,214,198,.16)}',
      '.shb-swapi:not(.shb-tinted) > .shb-pin-dot{background:#5fd6c6}',
      '.shb-swapi:not(.shb-tinted) > .shb-ico{color:#5fd6c6}',
      '.shb-fluid .shb-key,.shb-fluid .shb-kbd{min-width:20px;height:20px;padding:0 6px;box-sizing:border-box;border:0;border-radius:6px;background:rgba(255,255,255,.08);display:inline-grid;place-items:center;font:600 10.5px/1 Inter,system-ui,sans-serif;color:rgba(235,235,245,.55);flex-shrink:0}',
      '.shb-fluid .shb-act{padding:9px 13px;border-radius:19px}',
      '.shb-fluid .shb-act .shb-key{background:none;min-width:0;padding:0;height:auto;color:rgba(235,235,245,.45)}',
      '.shb-fluid .shb-act:active{transform:scale(.93)}',
      '.shb-fluid .shb-tool{padding:8px 11px;border-radius:11px;font-size:12.5px}',
      '.shb-fluid .shb-danger .shb-ico{color:var(--shb-danger)}',
      '.shb-fluid .shb-btn-primary,.shb-fluid .shb-btn-primary:hover{background:var(--shb-blue);color:#fff;padding:8px 10px 8px 12px;border-radius:11px;font-weight:600;font-size:12.5px}',
      '.shb-fluid .shb-btn-primary:hover{background:#3b92ea}',
      '.shb-fluid .shb-btn-primary .shb-ico{color:#fff}',
      '.shb-fluid .shb-btn-primary:active{transform:scale(.94)}',
      '.shb-fluid .shb-btn-primary .shb-key{background:rgba(255,255,255,.22);color:#fff;min-width:0;height:auto;padding:2px 5px;border-radius:5px;font-size:10px}',
      '.shb-fluid .shb-pin{padding:8px 12px;gap:7px;margin:0 1px;border-radius:17px;background:rgba(255,255,255,.08);cursor:grab;touch-action:none}',
      '.shb-fluid .shb-pin:hover{background:rgba(255,255,255,.14)}',
      '.shb-fluid .shb-pin-dot{width:7px;height:7px;border-radius:50%;background:var(--shb-blue2);flex-shrink:0}',
      '.shb-fluid .shb-ibtn{width:36px;height:34px;border-radius:17px;color:var(--shb-t2);transition:background 26ms}',
      '.shb-fluid .shb-ibtn:hover{background:rgba(255,255,255,.1);color:#fff}',
      '.shb-fluid .shb-drop-gap{flex:none;width:0;height:32px;border-radius:16px;border:1px dashed rgba(255,255,255,.4);box-sizing:border-box;opacity:0;transition:width 90ms cubic-bezier(.34,1.4,.64,1),opacity 60ms,margin 90ms}',
      '.shb-fluid .shb-drop-gap.shb-gap-open{width:120px;opacity:1;margin:0 2px}',
      '.shb-fluid .shb-segc{padding:2px;border-radius:11px;background:rgba(0,0,0,.25)}',
      '.shb-fluid .shb-segc-thumb{position:absolute;left:2px;top:2px;width:52px;height:28px;border-radius:9px;background:rgba(255,255,255,.16);box-shadow:0 2px 8px rgba(0,0,0,.3);transform:translateX(calc(var(--i,0) * 52px));transition:transform 36ms cubic-bezier(.2,.9,.1,1);pointer-events:none}',
      '.shb-fluid .shb-segc-b{width:52px;height:28px;display:grid;place-items:center;font:600 12px/1 Inter,system-ui,sans-serif;color:var(--shb-t1)}',
      '.shb-fluid .shb-card{padding:8px;border-radius:20px;gap:0;min-width:0;box-sizing:border-box}',
      '.shb-fluid .shb-card-left{width:250px}',
      '.shb-fluid .shb-zone-right{gap:10px}',
      '.shb-fluid .shb-zone-right .shb-card{width:256px}',
      '.shb-fluid .shb-card-hd{padding:6px 10px 8px;font:600 11px/1 Inter,system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase;color:var(--shb-t3)}',
      '.shb-fluid .shb-hd-id{font:500 10.5px/1 "JetBrains Mono",ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:0;text-transform:none}',
      '.shb-fluid .shb-hd-note{font:500 10.5px/1 Inter,system-ui,sans-serif;letter-spacing:0;text-transform:none}',
      '.shb-fluid .shb-hl{border-radius:11px;background:rgba(255,255,255,.11);transition:transform 68ms cubic-bezier(.34,1.35,.64,1),opacity 30ms ease}',
      '.shb-fluid .shb-row{height:34px;gap:11px;padding:0 10px;border-radius:11px;font:500 13px/1 Inter,system-ui,sans-serif;color:var(--shb-t1)}',
      '.shb-fluid .shb-row .shb-ico{color:var(--shb-t2)}',
      '.shb-fluid .shb-row.shb-active{background:rgba(90,162,240,.18);color:#fff}',
      '.shb-fluid .shb-sep{background:rgba(255,255,255,.08);margin:6px 8px}',
      '.shb-fluid .shb-colors{gap:8px;padding:6px 10px 4px}',
      '.shb-fluid .shb-cdot{width:16px;height:16px;transition:transform 38ms cubic-bezier(.34,1.56,.64,1),box-shadow 30ms}',
      '.shb-fluid .shb-cdot:hover{transform:scale(1.25)}',
      '.shb-fluid .shb-cdot-on{box-shadow:0 0 0 2px rgba(30,30,34,.9),0 0 0 3.5px #fff}',
      '.shb-fluid .shb-pipette .shb-ico{color:rgba(235,235,245,.55)}',
      '.shb-fluid .shb-pipette:hover{background:rgba(255,255,255,.1)}',
      '.shb-fluid .shb-ps-card{padding:10px 12px 12px;gap:8px}',
      '.shb-fluid .shb-ps-card .shb-card-hd{padding:0 2px 2px}',
      '.shb-fluid .shb-ps-list{gap:8px}',
      '.shb-fluid .shb-ps-track{height:32px;border-radius:10px;overflow:hidden;isolation:isolate}',
      '.shb-fluid .shb-ps-line{position:absolute;inset:0;background:rgba(255,255,255,.08)}',
      '.shb-fluid .shb-ps-fill{background:rgba(255,255,255,.88);transition:width 45ms cubic-bezier(.2,.9,.1,1)}',
      '.shb-fluid .shb-ps-txt{height:100%;padding:0 12px;font:600 12px/1 Inter,system-ui,sans-serif;color:#fff;mix-blend-mode:difference}',
      '.shb-fluid .shb-ps-num:focus{outline:1px solid rgba(255,255,255,.6);border-radius:4px}',
      '.shb-fluid .shb-x{width:18px;height:18px;left:-5px;top:-6px;background:#5c5c63;border:1.5px solid rgba(20,20,22,.95);color:#fff;font:700 13px/1 Inter,system-ui,sans-serif}',
      '.shb-fluid .shb-editbar{gap:4px;padding:4px 4px 4px 14px;border-radius:16px;margin-bottom:8px;background:rgba(38,38,42,.72)}',
      '.shb-fluid .shb-editbar-t{font:500 12px/1 Inter,system-ui,sans-serif;color:rgba(235,235,245,.65);margin-right:6px}',
      '.shb-fluid .shb-editbar-b{padding:8px 11px;border-radius:12px;font:600 12px/1 Inter,system-ui,sans-serif;color:var(--shb-t1)}',
      '.shb-fluid .shb-editbar-b:hover{background:rgba(255,255,255,.1)}',
      '.shb-fluid .shb-editbar-done,.shb-fluid .shb-editbar-done:hover{background:var(--shb-blue);color:#fff;padding:8px 14px}',
      '.shb-fluid .shb-dial-in,.shb-fluid .shb-catmenu{padding:6px;border-radius:18px}',
      '.shb-fluid .shb-catmenu{background:rgba(38,38,42,.82)}',
      '.shb-fluid .shb-dial-hd{padding:6px 10px 6px;font:600 11px/1 Inter,system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase;color:var(--shb-t3)}',
      '.shb-fluid .shb-catpick{width:22px;height:34px;border-radius:11px;color:rgba(235,235,245,.6)}',
      '.shb-fluid .shb-catpick:hover{background:rgba(255,255,255,.1);color:#fff}',
      '.shb-fluid .shb-plus{width:48px;height:48px;border-radius:50%;background:var(--shb-blue);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 0 0 1px rgba(255,255,255,.12),0 12px 30px rgba(47,134,224,.45)}',
      '.shb-fluid .shb-plus .shb-ico{color:#fff;stroke-width:2.4}',
      '.shb-fluid .shb-plus:hover{transform:scale(1.08);background:#3b92ea}',
      '.shb-fluid .shb-plus:active{transform:scale(.94)}',
      '.shb-fluid .shb-plus.shb-plus-drop{transform:scale(1.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 0 0 4px rgba(90,162,240,.45),0 12px 30px rgba(47,134,224,.55)}',
      '.shb-fluid .shb-drawer{padding:8px;border-radius:20px}',
      '.shb-fluid .shb-drawer .shb-card-hd{padding:6px 8px 4px}',
      '.shb-fluid .shb-search{padding:9px 12px;border-radius:11px;border:1px solid rgba(255,255,255,.09);background:rgba(0,0,0,.25);color:var(--shb-t1);font:500 13px/1.2 Inter,system-ui,sans-serif}',
      '.shb-fluid .shb-search:focus{border-color:rgba(90,162,240,.7)}',
      '.shb-fluid .shb-drawer .shb-btn-row{width:100%;justify-content:space-between;padding:8px 10px;border-radius:11px;font-size:13px}',
      '.shb-fluid .shb-drawer .shb-seg{border:0;border-radius:11px;background:rgba(0,0,0,.25);padding:2px}',
      '.shb-fluid .shb-drawer .shb-seg button{border-radius:9px;color:var(--shb-t2);font:600 12px/1 Inter,system-ui,sans-serif;padding:7px 6px}',
      '.shb-fluid .shb-drawer .shb-seg button.shb-on{background:rgba(255,255,255,.16);color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3)}',
      '.shb-fluid .shb-drawer-hint{color:var(--shb-t3)}',
      '.shb-fluid{--shb-w-track:rgba(255,255,255,.16);--shb-w-thumb:#fff}',
      '.shb-fluid .shb-tray-row{margin:5px 0 1px;padding:4px;border-radius:14px;background:rgba(0,0,0,.2)}',
      '.shb-fluid .shb-fold-on,.shb-fluid .shb-grp-pin > .shb-btn{background:rgba(255,255,255,.13);color:#fff}',
      '.shb-fluid .shb-gdrop{padding:5px;border-radius:17px;background:rgba(34,34,38,.96);border:1px solid rgba(255,255,255,.1);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 18px 44px rgba(0,0,0,.5)}',
      '.shb-fluid .shb-gdrop .shb-btn{border-radius:12px}',
      '.shb-fluid .shb-gdrop .shb-pin{background:transparent}',
      '.shb-fluid .shb-gdrop .shb-pin:hover{background:rgba(255,255,255,.1)}',
      '.shb-fluid .shb-w-cap{font:600 11px/1 Inter,system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase;color:var(--shb-t3);padding-left:6px}',
      '.shb-fluid .shb-w-grp{padding:2px;border-radius:13px;background:rgba(0,0,0,.22)}',
      '.shb-fluid .shb-w-grp > .shb-w-cap{padding:0 6px 0 8px}',
      '.shb-fluid .shb-w-in{height:32px;padding:0 11px;border-radius:11px;border:1px solid rgba(255,255,255,.09);background:rgba(0,0,0,.25);color:var(--shb-t1);font:500 13px/1 Inter,system-ui,sans-serif}',
      '.shb-fluid .shb-w-in:focus{border-color:rgba(90,162,240,.7)}',
      '.shb-fluid .shb-w-step{width:26px;height:32px;border-radius:9px;background:rgba(255,255,255,.07);color:var(--shb-t2);transition:background 26ms}',
      '.shb-fluid .shb-w-step:hover{background:rgba(255,255,255,.14);color:#fff}',
      '.shb-fluid .shb-w-step:active{transform:scale(.92)}',
      '.shb-fluid .shb-w-val{font:500 11.5px/1 "JetBrains Mono",ui-monospace,Consolas,monospace;color:var(--shb-t2)}',
      '.shb-fluid .shb-w-sw{gap:7px;padding:0 6px}',
      '.shb-fluid .shb-w-seg{padding:2px;border-radius:11px;background:rgba(0,0,0,.25)}',
      '.shb-fluid .shb-w-segb{padding:8px 11px;border-radius:9px;color:var(--shb-t2);font:600 12px/1 Inter,system-ui,sans-serif;transition:background 30ms}',
      '.shb-fluid .shb-w-segb:hover{color:#fff}',
      '.shb-fluid .shb-w-segb.shb-on{background:rgba(255,255,255,.16);color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3)}',
      '.shb-fluid .shb-w-field{height:32px;padding:0 9px 0 11px;border-radius:11px;background:rgba(0,0,0,.25);color:var(--shb-t1);font:500 13px/1 Inter,system-ui,sans-serif}',
      '.shb-fluid .shb-w-field .shb-w-cap{padding:0}',
      '.shb-fluid .shb-w-field:hover,.shb-fluid .shb-w-open{background:rgba(255,255,255,.12)}',
      '.shb-fluid .shb-w-badge{background:rgba(255,255,255,.12);color:var(--shb-t2)}',
      '.shb-fluid .shb-w-info{font:500 12px/1 Inter,system-ui,sans-serif;color:var(--shb-t3)}',
      '.shb-fluid .shb-wmenu{padding:6px;border-radius:18px;background:rgba(38,38,42,.82)}',
      '.shb-fluid .shb-wmenu-hd{padding:8px 10px 4px;font:600 11px/1 Inter,system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase;color:var(--shb-t3)}',
      '.shb-ghost.shb-fluid{padding:9px 13px;border-radius:18px;background:rgba(48,48,54,.8);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.18);box-shadow:0 14px 34px rgba(0,0,0,.5);font:500 13px/1 Inter,system-ui,sans-serif;color:#fff;transform:translate(-50%,-50%) rotate(-3deg) scale(1.04);transition:transform 70ms cubic-bezier(.34,1.56,.64,1),background 60ms}',
      '.shb-ghost.shb-fluid .shb-ghost-dot{width:7px;height:7px;border-radius:50%;background:#64a8f0}',
      '.shb-ghost.shb-fluid .shb-ghost-hint{font:500 11px/1 Inter,system-ui,sans-serif;color:rgba(235,235,245,.6)}',
      '.shb-ghost.shb-fluid.shb-ghost-over{transform:translate(-50%,-50%) scale(1)}',
      '.shb-ghost.shb-fluid.shb-ghost-rm{transform:translate(-50%,-50%) scale(.9);background:rgba(120,40,36,.78)}',
      '.shb-poof.shb-fluid .shb-poof-chip{padding:9px 13px;border-radius:18px;background:rgba(120,40,36,.75);border:1px solid rgba(255,255,255,.18);font:500 13px/1 Inter,system-ui,sans-serif;color:#fff}',

      /* ---------- 1b QUIET: native ComfyUI panels, hairline leaders, monospace keys ---------- */
      '.shb-quiet{--shb-qbg:#1f1f1f;--shb-qbd:#303030;--shb-qhover:#2a2a2a;--shb-qmuted:#6f6f6f;--shb-qblue:#64a8f0;--shb-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Consolas,monospace}',
      '.shb-quiet .shb-bar,.shb-quiet .shb-card,.shb-quiet .shb-drawer,.shb-quiet .shb-editbar,.shb-quiet .shb-dial-in,.shb-quiet .shb-catmenu,.shb-quiet .shb-wmenu{background:var(--shb-qbg);border:1px solid var(--shb-qbd);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);color:#d6d6d6}',
      '.shb-quiet .shb-bar{padding:3px;gap:1px}',
      '.shb-quiet .shb-bar.shb-drop-over{border-color:#4a4a4a}',
      '.shb-quiet .shb-dial-in,.shb-quiet .shb-catmenu{padding:4px}',
      '.shb-quiet .shb-dial-hd{padding:7px 9px 4px;font:500 10.5px/1 var(--shb-mono);color:var(--shb-qmuted)}',
      '.shb-quiet .shb-catpick{width:18px;height:28px;border-radius:5px;color:#8a8a8a}',
      '.shb-quiet .shb-catpick:hover{background:var(--shb-qhover);color:#fff}',
      '.shb-quiet .shb-vsep{height:16px;background:#333;margin:0 3px}',
      '.shb-quiet .shb-bar-items{gap:1px}',
      '.shb-quiet .shb-btn{gap:7px;padding:7px 10px;border:0;border-radius:6px;background:transparent;color:#d6d6d6;font:500 12.5px/1 Inter,system-ui,sans-serif}',
      '.shb-quiet .shb-btn .shb-ico{color:#888}',
      '.shb-quiet .shb-btn:hover{background:var(--shb-qhover);color:#fff}',
      '.shb-quiet .shb-btn:hover .shb-ico{color:#fff}',
      '.shb-quiet .shb-btn-on{background:#24303d;color:#fff;box-shadow:inset 0 0 0 1px #3d5f86}',
      '.shb-quiet .shb-num,.shb-quiet .shb-key,.shb-quiet .shb-kbd{font:500 10.5px/1 var(--shb-mono);color:var(--shb-qmuted);background:none;border:0;padding:0;min-width:0;height:auto}',
      '.shb-quiet .shb-models-btn{color:#9a9a9a;gap:5px}',
      '.shb-quiet .shb-dock-mode{display:inline-flex;align-items:center;gap:5px;padding:0 6px;font:500 10.5px/1 var(--shb-mono);color:var(--shb-qmuted)}',
      '.shb-quiet .shb-dock-swap{color:#5fd6c6}',
      '.shb-quiet .shb-swapi:not(.shb-tinted) > .shb-num{color:#5fd6c6}',
      '.shb-quiet .shb-btn-primary{color:#fff}',
      '.shb-quiet .shb-btn-primary .shb-ico{color:var(--shb-qblue)}',
      '.shb-quiet .shb-danger .shb-ico{color:#e8735f}',
      '.shb-quiet .shb-pin{cursor:grab;touch-action:none}',
      '.shb-quiet .shb-pin-dot{width:5px;height:5px;background:var(--shb-qblue);flex-shrink:0}',
      '.shb-quiet .shb-cbar-dot{width:5px;height:5px}',
      '.shb-quiet .shb-ibtn:hover{background:var(--shb-qhover);color:#fff}',
      '.shb-quiet .shb-drop-gap{flex:none;width:0;height:26px;border-radius:5px;border:1px dashed #555;box-sizing:border-box;opacity:0;transition:width 100ms cubic-bezier(.2,0,0,1),opacity 80ms}',
      '.shb-quiet .shb-drop-gap.shb-gap-open{width:104px;opacity:1;margin:0 2px}',
      '.shb-quiet .shb-segc-thumb{position:absolute;left:12px;bottom:1px;width:20px;height:1.5px;border-radius:1px;background:var(--shb-qblue);transform:translateX(calc(var(--i,0) * 44px));transition:transform 32ms cubic-bezier(.2,0,0,1);pointer-events:none}',
      '.shb-quiet .shb-segc-b{width:44px;padding:6px 0;text-align:center;font:500 12px/1 var(--shb-mono);color:#7d7d7d;border-radius:6px}',
      '.shb-quiet .shb-segc-b:hover{background:var(--shb-qhover)}',
      '.shb-quiet .shb-segc-b.shb-on{color:#fff}',
      '.shb-quiet .shb-card{padding:4px;gap:0;min-width:0;box-sizing:border-box}',
      '.shb-quiet .shb-card-left{width:204px}',
      '.shb-quiet .shb-zone-right .shb-card{width:214px}',
      '.shb-quiet .shb-card-hd{padding:7px 9px 6px;font:500 10.5px/1 var(--shb-mono);color:var(--shb-qmuted)}',
      '.shb-quiet .shb-hl{display:none}',
      '.shb-quiet .shb-row{height:30px;gap:9px;padding:0 9px;border-radius:5px;font:500 12.5px/1 Inter,system-ui,sans-serif;color:#d6d6d6}',
      '.shb-quiet .shb-row .shb-ico{color:#888}',
      '.shb-quiet .shb-row:hover,.shb-quiet .shb-row.shb-active{background:var(--shb-qhover);color:#fff}',
      '.shb-quiet .shb-sep{background:#2c2c2c;margin:4px 6px}',
      '.shb-quiet .shb-colors{gap:7px;padding:6px 9px 5px}',
      '.shb-quiet .shb-cdot{width:11px;height:11px}',
      '.shb-quiet .shb-cdot-on{box-shadow:0 0 0 1.5px #1f1f1f,0 0 0 2.5px #e6e6e6}',
      '.shb-quiet .shb-pipette{width:18px;height:18px;color:#888}',
      '.shb-quiet .shb-pipette:hover{background:var(--shb-qhover);color:#fff}',
      '.shb-quiet .shb-pipette .shb-ico{color:inherit}',
      '.shb-quiet .shb-ps-track{padding:6px 9px;gap:6px}',
      '.shb-quiet .shb-ps-line{order:2;position:relative;height:2px;border-radius:1px;background:#333}',
      '.shb-quiet .shb-ps-fill{border-radius:1px;background:var(--shb-qblue);transition:width 36ms cubic-bezier(.2,0,0,1)}',
      '.shb-quiet .shb-ps-txt{font:500 12px/1 Inter,system-ui,sans-serif;color:#bdbdbd}',
      '.shb-quiet .shb-ps-num{font:500 11px/1 var(--shb-mono);color:#e6e6e6}',
      '.shb-quiet .shb-ps-num:focus{outline:1px solid var(--shb-qblue);border-radius:3px}',
      '.shb-quiet .shb-x{width:14px;height:14px;left:-4px;top:-5px;background:#3a3a3a;border:1px solid #1f1f1f;color:#ddd;font:500 11px/1 var(--shb-mono)}',
      '.shb-quiet .shb-btn.shb-outline{outline-color:#4a4a4a}',
      '.shb-quiet .shb-editbar{gap:2px;padding:3px 3px 3px 10px;border-radius:7px;margin-bottom:6px}',
      '.shb-quiet .shb-editbar-t{font:500 10.5px/1 var(--shb-mono);color:#7d7d7d;margin-right:6px}',
      '.shb-quiet .shb-editbar-b{padding:6px 9px;border-radius:5px;font:500 12px/1 Inter,system-ui,sans-serif;color:#cfcfcf}',
      '.shb-quiet .shb-editbar-b:hover{background:var(--shb-qhover);color:#fff}',
      '.shb-quiet .shb-editbar-done{color:var(--shb-qblue);font-weight:600}',
      '.shb-quiet .shb-plus{width:40px;height:40px;border-radius:8px;background:var(--shb-qbg);border:1px solid var(--shb-qbd);box-shadow:0 8px 24px rgba(0,0,0,.35)}',
      '.shb-quiet .shb-plus .shb-ico{color:var(--shb-qblue);stroke-width:2.2}',
      '.shb-quiet .shb-plus:hover{background:var(--shb-qhover);border-color:#3d5f86}',
      '.shb-quiet .shb-plus.shb-plus-drop{border-color:var(--shb-qblue);transform:scale(1.08)}',
      '.shb-quiet .shb-drawer{padding:4px;width:300px}',
      '.shb-quiet .shb-drawer .shb-card-hd{padding:7px 9px 4px}',
      '.shb-quiet .shb-search{padding:6px 9px;border-radius:5px;border:1px solid var(--shb-qbd);background:#161616;color:#e6e6e6;font:400 12px/1.2 Inter,system-ui,sans-serif}',
      '.shb-quiet .shb-search:focus{border-color:#3d5f86}',
      '.shb-quiet .shb-drawer .shb-btn-row{width:100%;justify-content:space-between;padding:0 9px;height:30px;border-radius:5px}',
      '.shb-quiet .shb-drawer .shb-seg{border:1px solid var(--shb-qbd);border-radius:6px;background:#161616}',
      '.shb-quiet .shb-drawer .shb-seg button{font:500 11px/1 var(--shb-mono);color:#7d7d7d;padding:6px 4px}',
      '.shb-quiet .shb-drawer .shb-seg button.shb-on{color:#fff;background:var(--shb-qhover)}',
      '.shb-quiet{--shb-w-track:#363636;--shb-w-thumb:#64a8f0}',
      '.shb-quiet .shb-tray-row{margin:3px 0 0;padding:3px 0 0;border-top:1px solid #2c2c2c}',
      '.shb-quiet .shb-fold-on,.shb-quiet .shb-grp-pin > .shb-btn{background:var(--shb-qhover);color:#fff}',
      '.shb-quiet .shb-gdrop{padding:3px;border-radius:7px;background:#1f1f1f;border:1px solid #303030;box-shadow:0 10px 26px rgba(0,0,0,.45)}',
      '.shb-quiet .shb-grp-chev:hover{background:#333}',
      '.shb-quiet .shb-w-cap{font:500 10.5px/1 var(--shb-mono);color:var(--shb-qmuted);padding-left:5px}',
      '.shb-quiet .shb-w-grp{padding:1px;border-radius:6px;background:#181818;border:1px solid #2a2a2a}',
      '.shb-quiet .shb-w-in{height:27px;padding:0 8px;border-radius:5px;border:1px solid var(--shb-qbd);background:#161616;color:#e6e6e6;font:400 12px/1 Inter,system-ui,sans-serif}',
      '.shb-quiet .shb-w-in:focus{border-color:#3d5f86}',
      '.shb-quiet .shb-w-nin{font-family:var(--shb-mono)}',
      '.shb-quiet .shb-w-step{width:22px;height:27px;border-radius:5px;background:transparent;color:#8a8a8a}',
      '.shb-quiet .shb-w-step:hover{background:var(--shb-qhover);color:#fff}',
      '.shb-quiet .shb-w-range input::-webkit-slider-runnable-track{height:2px;border-radius:1px}',
      '.shb-quiet .shb-w-range input::-webkit-slider-thumb{width:10px;height:10px;margin-top:-4px;box-shadow:none}',
      '.shb-quiet .shb-w-val{font:500 11px/1 var(--shb-mono);color:#bdbdbd}',
      '.shb-quiet .shb-w-sw{gap:6px;padding:0 5px}',
      '.shb-quiet .shb-w-seg{border:1px solid var(--shb-qbd);border-radius:6px;background:#161616}',
      '.shb-quiet .shb-w-segb{padding:6px 8px;font:500 11px/1 var(--shb-mono);color:#7d7d7d}',
      '.shb-quiet .shb-w-segb:hover{color:#fff}',
      '.shb-quiet .shb-w-segb.shb-on{color:#fff;background:var(--shb-qhover)}',
      '.shb-quiet .shb-w-field{height:27px;padding:0 7px 0 8px;border-radius:5px;background:#161616;border:1px solid var(--shb-qbd);color:#d6d6d6;font:500 12px/1 Inter,system-ui,sans-serif}',
      '.shb-quiet .shb-w-field:hover,.shb-quiet .shb-w-open{background:var(--shb-qhover);color:#fff}',
      '.shb-quiet .shb-w-badge{background:none;color:var(--shb-qmuted);font-family:var(--shb-mono);padding:0;min-width:0}',
      '.shb-quiet .shb-w-info{font:500 11px/1 var(--shb-mono);color:var(--shb-qmuted)}',
      '.shb-quiet .shb-wmenu{padding:4px}',
      '.shb-quiet .shb-wmenu-hd{padding:7px 9px 4px;font:500 10.5px/1 var(--shb-mono);color:var(--shb-qmuted)}',
      '.shb-ghost.shb-quiet{padding:7px 10px;border-radius:6px;background:#262626;border:1px solid #3a3a3a;box-shadow:0 8px 24px rgba(0,0,0,.45);font:500 12.5px/1 Inter,system-ui,sans-serif;color:#e6e6e6}',
      '.shb-ghost.shb-quiet .shb-ghost-dot{width:5px;height:5px;background:#64a8f0}',
      '.shb-ghost.shb-quiet .shb-ghost-hint{font:500 10.5px/1 var(--shb-mono);color:#7d7d7d}',
      '.shb-ghost.shb-quiet.shb-ghost-rm{background:#2a1e1d;border-color:#6a342e}',
      '.shb-poof.shb-quiet .shb-poof-chip{padding:7px 10px;border-radius:6px;background:#2a1e1d;border:1px solid #6a342e;font:500 12.5px/1 Inter,system-ui,sans-serif;color:#e7a39a}',

      /* Modals (Label Studio, Settings, Magnifier, Crop, Paint) */
      '.shb-modal-bg{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:400 12.5px/1.4 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--shb-fg)}',
      '.shb-modal{width:min(540px,94vw);max-height:90vh;overflow-y:auto;background:var(--shb-bg);border:1px solid var(--shb-border);border-radius:8px;padding:16px 18px;box-shadow:0 12px 36px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:12px}',
      '.shb-modal-t{font:600 14px/1.2 Inter,system-ui,sans-serif;color:var(--shb-fg);display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid #333333}',
      /* Replicate */
      '.shb-rep .shb-modal-t > span:first-child{display:inline-flex;align-items:center;gap:8px}',
      '.shb-rep-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.shb-rep-k{width:56px;color:var(--shb-fg-muted);font-size:12px;font-weight:500}',
      '.shb-rep-n{display:inline-flex;align-items:center;border:1px solid var(--shb-border);border-radius:6px;overflow:hidden;background:var(--shb-bg-input)}',
      '.shb-rep-n button{all:unset;cursor:pointer;width:26px;height:28px;display:grid;place-items:center;color:var(--shb-fg);font:600 14px/1 Inter,system-ui,sans-serif}',
      '.shb-rep-n button:hover{background:var(--shb-bg-hover)}',
      '.shb-rep-n input{width:34px;height:28px;border:0;background:none;color:var(--shb-fg);text-align:center;font:600 13px/1 Inter,system-ui,sans-serif;outline:none}',
      '.shb-rep-chips{display:flex;gap:4px;flex-wrap:wrap;margin-left:4px}',
      '.shb-rep-chip{min-width:22px;height:22px;padding:0 5px;box-sizing:border-box;border-radius:6px;display:grid;place-items:center;font:700 11.5px/1 Inter,system-ui,sans-serif;color:#fff}',
      '.shb-rep-L{width:34px !important;height:28px;text-align:center;text-transform:uppercase;font:700 13px/1 Inter,system-ui,sans-serif;padding:0}',
      '.shb-rep-col{display:inline-flex;align-items:center;gap:6px;margin-left:auto;color:var(--shb-fg-muted);font-size:12px;cursor:pointer}',
      '.shb-rep-col input,.shb-rep-row input{accent-color:#5fd6c6;margin:0;flex-shrink:0}',
      '.shb-rep-hd{color:var(--shb-fg-muted);font:600 10.5px/1 Inter,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.05em}',
      '.shb-rep-list{max-height:260px;overflow-y:auto;border:1px solid var(--shb-border);border-radius:6px;background:var(--shb-bg-input)}',
      '.shb-rep-row{display:flex;align-items:center;gap:9px;padding:7px 10px;border-bottom:1px solid #2a2a2a;cursor:pointer;font-size:12px}',
      '.shb-rep-row:last-child{border-bottom:0}',
      '.shb-rep-row:hover{background:var(--shb-bg-hover)}',
      '.shb-rep-w{color:var(--shb-fg-dim);flex:0 0 150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.shb-rep-ft{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--shb-fg-muted)}',
      '.shb-rep-ft b{color:#5fd6c6;font-weight:600}',
      '.shb-rep-note{color:var(--shb-fg-muted);font-size:11.5px}',
      '.shb-grid{display:grid;grid-template-columns:96px 1fr;align-items:center;gap:9px 12px}',
      '.shb-settings .shb-grid{grid-template-columns:128px minmax(0,1fr)}',
      '.shb-grid label{color:var(--shb-fg-muted);font-weight:500;font-size:12px}',
      '.shb-input,.shb-select{width:100%;box-sizing:border-box;padding:6px 10px;border-radius:6px;border:1px solid var(--shb-border);background:var(--shb-bg-input);color:var(--shb-fg);font:400 12px/1.2 Inter,system-ui,sans-serif;outline:none}',
      '.shb-input:focus,.shb-select:focus{border-color:var(--shb-accent)}',
      '.shb-seg{display:inline-flex;border-radius:6px;overflow:hidden;border:1px solid var(--shb-border);background:var(--shb-bg-input)}',
      '.shb-seg button{border:0;background:transparent;color:var(--shb-fg-muted);padding:5px 11px;font:500 11.5px/1.2 Inter,system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:5px}',
      '.shb-seg button:hover{color:var(--shb-fg);background:#262626}',
      '.shb-seg button.shb-on{background:#353535;color:#ffffff}',
      '.shb-lb-prev{border-radius:8px;padding:14px 18px;display:flex;align-items:center;justify-content:center;text-align:center;min-height:48px;overflow:hidden;border:1px solid var(--shb-border);background:var(--shb-bg-input)}',
      '.shb-swatches{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.shb-swatch{width:20px;height:20px;border-radius:50%;border:1.5px solid rgba(255,255,255,.22);cursor:pointer;box-sizing:border-box}',
      '.shb-swatch.shb-on{border-color:#ffffff;transform:scale(1.1);box-shadow:0 0 0 1.5px var(--shb-accent)}'
    ].join('\n');
  }

  /* ---------------------------------------------------------------------
   * 4. SERVER OBJECT_INFO & SUBGRAPH DISCOVERY
   * --------------------------------------------------------------------- */
  var SRV = {
    probed: false,
    probing: null,
    types: null,
    api: {},
    models: [],
    subgraphs: []
  };

  /* Popular model families ranked first when browsing or showing defaults */
  var ND_FRONT = [
    'nanobanana', 'nano banana', 'gemini', 'seedream', 'flux', 'kling',
    'seedance', 'veo', 'sora', 'runway', 'gen3', 'gen4', 'luma', 'ray',
    'minimax', 'hailuo', 'wan', 'ltx', 'hunyuan', 'mochi', 'cogvideo',
    'pika', 'vidu', 'pixverse', 'midjourney', 'ideogram', 'recraft',
    'qwen', 'bria', 'tripo', 'rodin', 'meshy', 'grok', 'sd3', 'ksampler'
  ];

  function ndRank(name, type) {
    var s = (String(name || '') + ' ' + String(type || '')).toLowerCase();
    for (var i = 0; i < ND_FRONT.length; i++) {
      if (s.indexOf(ND_FRONT[i]) >= 0) return i;
    }
    return 999;
  }

  function hasType(type) {
    if (!type) return false;
    try {
      if (SRV.types && SRV.types[type]) return true;
      var reg = (litegraph() || {}).registered_node_types;
      if (reg && reg[type]) return true;
    } catch (e) {}
    return false;
  }

  function canMake(type) {
    return hasType(type);
  }

  /* Deprecated nodes are never offered anywhere (they still load fine in old workflows) */
  function isDeprecatedType(type) {
    var def = SRV.types && SRV.types[type];
    if (def && (def.deprecated || /\bdeprecated\b|\(legacy\)/i.test(String(def.display_name || ''))
      || /(^|\/)_?(deprecated|legacy)(\/|$)/i.test(String(def.category || '')))) return true;
    try {
      var reg = (litegraph() || {}).registered_node_types;
      var nd = reg && reg[type] && reg[type].nodeData;
      if (nd && nd.deprecated) return true;
    } catch (e) {}
    return false;
  }

  /* ---- Older versions. A partner (API) node whose newer version is installed beside it is left out of the
     lists: Kling 4.0 Text to Video hides Kling 3.0 Omni, Kling 2.6 and the first Kling Text to Video; Vidu Q4
     hides Vidu2 and the first Vidu; Seedance 2.5 hides the first ByteDance video nodes. Within one partner:
     - the same name once the version (4.0, V3, Q4, Gen-2, Vidu2…) and the tier (Pro, Max, Turbo…) are out: the
       highest version stays;
     - the same job (text to video, image to video, edit video…): only the highest version number of that job
       stays, whatever else the name says (Omni, with Audio). A node with no version is held to that only when its
       name is nothing but the partner and the job (Kling Text to Video), so another product of the same partner
       with no version (HappyHorse under Wan) is never taken for an old one;
     - a node with no version gives way to a versioned one that only adds the model's name (Seedance).
     ComfyUI's ready-made subgraphs follow the first rule (Image to Video (LTX-2.5) hides the LTX-2.3 one). Local
     nodes are never hidden: an older model on disk needs its own nodes. A search with a version number in it
     still finds them all, and a button already pinned to a bar stays */
  var VER_TIER = /^(pro|max|turbo|ultra|fast|lite|flash|plus|standard|and|the|with|&)$/;
  var VER_FEAT = /^(audio|edit|reference|extend|extension|continuation|upscale|enhance|motion|lip|sync|avatar|vector|style|fusion|transition|multi|draft|final|layer|separation|precise|creative|inpainting|background|remove|replace|image|video|text|to|model|first|last|frame|keyframes|voice|speech)$/;
  var VER_JOBS = [
    [/\bfirst last frame to video\b|\bkeyframes to video\b/, 'flf2v'], [/\breference to video\b/, 'r2v'],
    [/\btext to video\b/, 't2v'], [/\bimage to video\b/, 'i2v'], [/\bvideo to video\b/, 'v2v'], [/\baudio to video\b/, 'a2v'],
    [/\bedit video\b|\bvideo edit\b/, 'vedit'], [/\bextend video\b|\bvideo extension\b|\bvideo continuation\b/, 'vext'],
    [/\btext to image\b/, 't2i'], [/\bimage to image\b/, 'i2i'], [/\bimage edit\b/, 'iedit'], [/\btext to speech\b/, 'tts'],
    [/\btext to model\b/, 't2m'], [/\bimage to model\b/, 'i2m'], [/\bmultiview to model\b/, 'mv2m']
  ];

  function verOf(type, def) {
    var s = String((def && def.display_name) || type).toLowerCase()
      .replace(/\s*\((?:api|google[^)]*|partner[^)]*|bytedance[^)]*|black forest[^)]*|openai[^)]*|stability[^)]*)\)/g, '')
      .replace(/\(first frame\)/g, ' ')
      .replace(/\bstart\s*[-\/ ]\s*end\b(\s*frame)?/g, 'first last frame')
      .replace(/first\s*(-|&)\s*last\s*-?\s*frame/g, 'first last frame')
      .replace(/\b(\d+)\s*([dk])\b/g, '$1$2_')            // 3D, 2K are not versions
      .replace(/([a-z])\.(\d)/g, '$1 $2')                 // Flux.2
      .replace(/\b(v|q|gen|h|p|uni)[-\s]?(\d)/g, ' $2')    // V3, Q4, Gen-2, H3, P1, UNI-1
      .replace(/([a-z]{2,})(\d)/g, '$1 $2')               // Vidu2, Wan2.1
      .replace(/[^a-z0-9_.& ]+/g, ' ');
    var vendor = String((def && def.category) || '').split('/').pop().toLowerCase().split(/[^a-z0-9]+/);
    var ver = 0, words = [], job = '', jobWords = [];
    s.split(/\s+/).forEach(function (w) {
      if (!w) return;
      if (/^\d+(\.\d+)?[a-z]?$/.test(w)) ver = Math.max(ver, parseFloat(w));
      else if (!VER_TIER.test(w) && vendor.indexOf(w) < 0) words.push(w);
    });
    var flat = words.join(' ');
    for (var i = 0; i < VER_JOBS.length && !job; i++) {
      var m = VER_JOBS[i][0].exec(flat);
      if (m) { job = VER_JOBS[i][1]; jobWords = m[0].split(' '); }
    }
    var tv = /V(\d+)$/.exec(type);
    return {
      ver: ver, tv: tv ? +tv[1] : 1, line: flat, words: words, job: job,
      /* nothing but the partner and the job: Kling Text to Video, Wan Image to Video */
      bare: !!job && words.every(function (w) { return jobWords.indexOf(w) >= 0; })
    };
  }

  function olderThan(a, b, byJob) {
    if (a.line === b.line && (b.ver > a.ver || (b.ver === a.ver && b.tv > a.tv))) return true;
    if (!byJob) return false;
    if (a.job && a.job === b.job && b.ver > a.ver && (a.ver || a.bare)) return true;
    if (!a.ver && b.ver && b.words.length === a.words.length + 1
      && a.words.every(function (w) { return b.words.indexOf(w) >= 0; })) {
      var extra = b.words.filter(function (w) { return a.words.indexOf(w) < 0; });
      if (extra.length === 1 && !VER_FEAT.test(extra[0])) return true;
    }
    return false;
  }

  function markOld(groups, byJob, old) {
    Object.keys(groups).forEach(function (c) {
      var L = groups[c];
      L.forEach(function (a) {
        for (var i = 0; i < L.length; i++) {
          if (L[i] !== a && olderThan(a, L[i], byJob)) { old[a.type] = L[i].name; return; }
        }
      });
    });
    return old;
  }

  function findOldVersions(types, subs) {
    var byCat = {}, blue = { '': [] };
    Object.keys(types || {}).forEach(function (t) {
      var d = types[t];
      if (!d || !d.api_node || isDeprecatedType(t)) return;
      var v = verOf(t, d);
      v.type = t; v.name = d.display_name || t;
      (byCat[d.category || ''] = byCat[d.category || ''] || []).push(v);
    });
    (subs || []).forEach(function (m) {
      var v = verOf(m.type, { display_name: m.name });
      v.type = m.type; v.name = m.name; v.tv = 1;
      blue[''].push(v);
    });
    return markOld(blue, false, markOld(byCat, true, {}));
  }

  function isOldVersion(type) {
    return !!(SRV.old && SRV.old[type]);
  }

  /* a search with a version number in it ("kling 2.6") finds the older versions too */
  function wantsOld(q) {
    return /\d/.test(String(q || ''));
  }

  function allTypes() {
    var seen = {}, out = [];
    function add(t) { if (t && !seen[t] && !isDeprecatedType(t)) { seen[t] = 1; out.push(t); } }
    try { Object.keys(SRV.types || {}).forEach(add); } catch (e) {}
    try {
      var reg = (litegraph() || {}).registered_node_types;
      if (reg) Object.keys(reg).forEach(add);
    } catch (e) {}
    return out.sort();
  }

  /* ---- Node search, ranked like ComfyUI's own search box. First how well the words match: the whole name, the
     start of it, a whole word, part of a word, every word typed (in any order, or as the start of words), the
     category; then a typo or a missing letter still finds a node, lower down. Among equally good matches:
     ComfyUI's own nodes before custom ones, then the ones that take the node's outputs, then the ones people use
     most (ComfyUI's frontend ships that list as assets/sorted-custom-node-map.json; its search sorts by it too). */
  var NS = { types: null, freq: null, old: null, nreg: -1, list: [] };
  var CORE_UI_TYPES = { Reroute: 1, Note: 1, MarkdownNote: 1, PrimitiveNode: 1 };

  function loadNodeFreq() {
    if (!SRV.freqLoading) {
      SRV.freqLoading = fetch('assets/sorted-custom-node-map.json')
        .then(function (r) { return r && r.ok ? r.json() : {}; })
        .catch(function () { return {}; })
        .then(function (m) {
          SRV.freq = (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
          return SRV.freq;
        });
    }
    return SRV.freqLoading;
  }

  /* '' for a node that comes with ComfyUI, the custom node pack's folder for any other, null when unknown */
  function nodePack(type) {
    var def = SRV.types && SRV.types[type];
    if (!def) return CORE_UI_TYPES[type] ? '' : null;
    var mod = String(def.python_module || 'nodes');
    if (!/^custom_nodes[.\/\\]/.test(mod)) return '';
    return mod.split(/[.\/\\]/)[1] || 'custom';
  }

  function isCoreType(type) {
    return nodePack(type) === '';
  }

  /* "ComfyUI-RMBG" → "RMBG": the short name of a custom node's pack, shown beside it like ComfyUI's badge */
  function packLabel(type) {
    var p = nodePack(type);
    if (!p) return '';
    return p.replace(/@.*$/, '').replace(/^comfy-?ui[-_ ]*/i, '').replace(/[-_ ]*comfy-?ui$/i, '') || p;
  }

  function nsNorm(q) {
    return String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /* "ImageScaleBy" → imagescaleby image scale by, "KSampler (Advanced)" → ksampler k sampler advanced */
  function nsWords(s) {
    var out = [];
    function add(w) { if (w && out.indexOf(w) < 0) out.push(w); }
    String(s || '').split(/[^A-Za-z0-9À-ɏ]+/).forEach(function (w) {
      add(w.toLowerCase());
      w.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(' ').forEach(add);
    });
    return out;
  }

  /* short forms people type: "load img", "i2v", "ckpt" */
  var NS_ABBR = {
    img: 'image', imgs: 'images', vid: 'video', vids: 'videos', txt: 'text', ckpt: 'checkpoint', cn: 'controlnet',
    cond: 'conditioning', lat: 'latent', msk: 'mask', i2v: 'image to video', t2v: 'text to video', t2i: 'text to image',
    i2i: 'image to image', v2v: 'video to video', flf: 'first last frame', tts: 'text to speech'
  };

  /* the search as typed, and once more with its short forms spelled out */
  function nsQueries(q) {
    var out = [q];
    var full = q.split(' ').map(function (k) { return NS_ABBR[k] || k; }).join(' ');
    if (full !== q) out.push(full);
    return out;
  }

  /* one letter changed, added, dropped, or two neighbours swapped */
  function nsNear1(a, b) {
    if (a === b) return true;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0;
    while (i < la && i < lb && a.charAt(i) === b.charAt(i)) i++;
    if (la === lb) {
      return a.slice(i + 1) === b.slice(i + 1)
        || (a.charAt(i) === b.charAt(i + 1) && a.charAt(i + 1) === b.charAt(i) && a.slice(i + 2) === b.slice(i + 2));
    }
    return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }

  /* every word typed is the start of a word in the name, one of them with a typo ("previw", "imgae") */
  function nsTypo(toks, words) {
    var fuzzy = false;
    for (var i = 0; i < toks.length; i++) {
      var k = toks[i], ok = false;
      for (var j = 0; j < words.length && !ok; j++) {
        var w = words[j];
        if (w.indexOf(k) === 0) ok = true;
        else if (k.length >= 4 && (nsNear1(k, w) || nsNear1(k, w.slice(0, k.length))
          || nsNear1(k, w.slice(0, k.length + 1)) || nsNear1(k, w.slice(0, k.length - 1)))) ok = fuzzy = true;
      }
      if (!ok) return false;
    }
    return fuzzy;
  }

  /* the letters typed, in order, close together ("ksadv" → KSampler (Advanced)): the span they cover, or -1 */
  function nsSubseq(q, s) {
    var j = 0, start = -1, i = 0;
    for (; i < s.length && j < q.length; i++) {
      if (s.charAt(i) === q.charAt(j)) { if (start < 0) start = i; j++; }
    }
    return j === q.length ? i - start : -1;
  }

  /* How one name matches, as ComfyUI's search box grades it: [tier, where, length], lower is better; null for
     no match. 0 the whole name, 1 its start, 2 a whole word, 3 part of a word, 4 every word typed is a word of
     the name (any order), 5 every word typed starts a word ("prev ima"), 6 every word typed is in it somewhere */
  function nsTier(q, toks, f, w) {
    if (!f) return null;
    if (f === q) return [0, 0, f.length];
    if (f.indexOf(q) === 0) return [1, 0, f.length];
    var at = f.indexOf(q);
    if (w.indexOf(q) >= 0) return [2, at, f.length];
    if (at >= 0) return [3, at, f.length];
    function first() { return Math.min.apply(null, toks.map(function (k) { return f.indexOf(k); })); }
    if (toks.length > 1 && toks.every(function (k) { return w.indexOf(k) >= 0; })) return [4, first(), f.length];
    if (toks.length > 1 && toks.every(function (k) { return w.some(function (x) { return x.indexOf(k) === 0; }); })) return [5, first(), f.length];
    if (toks.every(function (k) { return f.indexOf(k) >= 0; })) return [6, first(), f.length];
    return null;
  }

  /* The best grade of a few names (a tool's label and id, a model's name and type): the tier, or -1 */
  function hbMatchTier(q, names) {
    q = nsNorm(q);
    if (!q) return 0;
    var best = -1, words = [], all = '';
    (names || []).forEach(function (s) {
      words = words.concat(nsWords(s));
      all += ' ' + String(s || '').toLowerCase();
    });
    nsQueries(q).forEach(function (v) {
      var toks = v.split(' ');
      (names || []).forEach(function (s) {
        var r = nsTier(v, toks, String(s || '').toLowerCase(), nsWords(s));
        if (r && (best < 0 || r[0] < best)) best = r[0];
      });
      if (best < 0 && toks.every(function (k) { return all.indexOf(k) >= 0; })) best = 7;
    });
    if (best < 0 && nsTypo(q.split(' '), words)) best = 8;
    return best;
  }

  /* Filters a list by the search and puts the best matches first; ties keep the list's own order */
  function hbRankBy(list, q, namesOf) {
    if (!nsNorm(q)) return list.slice();
    return list.map(function (it, i) { return { it: it, i: i, t: hbMatchTier(q, namesOf(it)) }; })
      .filter(function (r) { return r.t >= 0; })
      .sort(function (a, b) { return a.t - b.t || a.i - b.i; })
      .map(function (r) { return r.it; });
  }

  function nsIndex() {
    var reg = null;
    try { reg = (litegraph() || {}).registered_node_types; } catch (e) {}
    var nreg = reg ? Object.keys(reg).length : 0;
    if (NS.types === SRV.types && NS.freq === SRV.freq && NS.old === SRV.old && NS.nreg === nreg) return NS.list;
    NS.types = SRV.types; NS.freq = SRV.freq; NS.old = SRV.old; NS.nreg = nreg;
    var freq = SRV.freq || {};
    NS.list = allTypes().map(function (t) {
      var def = (SRV.types && SRV.types[t]) || null;
      var title = '';
      try { title = (reg && reg[t] && reg[t].title) || ''; } catch (e) {}
      var disp = String((def && def.display_name) || title || t);
      var names = [disp, t];
      var al = (def && Array.isArray(def.search_aliases) ? def.search_aliases : []).map(function (a) { return String(a).toLowerCase(); });
      var ins = {};
      ['required', 'optional'].forEach(function (g) {
        var grp = (def && def.input && def.input[g]) || {};
        Object.keys(grp).forEach(function (k) {
          var spec = grp[k];
          var it = Array.isArray(spec) ? spec[0] : spec;
          if (typeof it === 'string' && it !== '*') ins[it.toUpperCase()] = 1;
        });
      });
      var low = names.map(function (s) { return s.toLowerCase(); });
      return {
        t: t, disp: disp, f: low, w: names.map(nsWords), al: al, alw: al.map(nsWords),
        all: low.concat(al).join(' ') + ' ' + String((def && def.category) || '').toLowerCase(),
        compact: disp.toLowerCase().replace(/[^a-z0-9]+/g, ''),
        ins: ins, core: isCoreType(t), freq: +freq[t] || 0, old: isOldVersion(t)
      };
    });
    return NS.list;
  }

  /* the whole name, its start, a word or part of one, anything looser: within one band ComfyUI's own nodes
     come first, so a custom node never pushes a core one down for matching a little better */
  function nsBand(tier) {
    return tier <= 1 ? tier : (tier <= 5 ? 2 : 3);
  }

  /* All the nodes that match `q`, best first: [{ t, disp, tier, fits }]. The display name and the internal
     name grade a node; its search aliases (PreviewImage: "show image") find it too, three tiers lower, since
     ComfyUI's own search box finds by them but never ranks by them */
  function nodeSearch(q, node) {
    q = nsNorm(q);
    if (!q) return [];
    var vars = nsQueries(q).map(function (v) { return { q: v, toks: v.split(' ') }; });
    var toks0 = vars[0].toks, withOld = wantsOld(q), qc = q.replace(/[^a-z0-9]+/g, '');
    var outs = {};
    nodeOutputSlotTypes(node).forEach(function (o) { outs[o] = 1; });
    function better(r, best) { return r && (!best || r[0] < best[0] || (r[0] === best[0] && r[1] < best[1])); }
    var hits = [];
    nsIndex().forEach(function (e) {
      if (e.old && !withOld) return;
      var best = null, r, i;
      vars.forEach(function (v) {
        for (i = 0; i < e.f.length; i++) {
          r = nsTier(v.q, v.toks, e.f[i], e.w[i]);
          if (better(r, best)) best = r;
        }
        for (i = 0; i < e.al.length; i++) {
          r = nsTier(v.q, v.toks, e.al[i], e.alw[i]);
          if (r) r = [r[0] + 3, 50 + r[1], e.disp.length];
          if (better(r, best)) best = r;
        }
        if (!best && v.toks.every(function (k) { return e.all.indexOf(k) >= 0; })) best = [7, 0, e.disp.length];
      });
      if (!best && nsTypo(toks0, [].concat.apply([], e.w))) best = [8, 0, e.disp.length];
      if (!best && qc.length >= 3) {
        var span = nsSubseq(qc, e.compact);
        if (span > 0 && span <= qc.length * 2.5) best = [9, span, e.disp.length];
      }
      if (!best) return;
      var fits = Object.keys(outs).some(function (o) { return e.ins[o]; });
      hits.push({ t: e.t, disp: e.disp, tier: best[0], pos: best[1], len: best[2], core: e.core, fits: fits, freq: e.freq });
    });
    hits.sort(function (a, b) {
      return (nsBand(a.tier) - nsBand(b.tier))
        || ((b.core ? 1 : 0) - (a.core ? 1 : 0))
        || (a.tier - b.tier)
        || ((b.fits ? 1 : 0) - (a.fits ? 1 : 0))
        || (b.freq - a.freq)
        || (a.pos - b.pos)
        || (a.len - b.len)
        || (a.disp < b.disp ? -1 : a.disp > b.disp ? 1 : 0);
    });
    return hits;
  }

  function classifyServerType(type, def) {
    if (!def || typeof def !== 'object' || isDeprecatedType(type)) return null;
    var cat = String(def.category || '').toLowerCase();
    var disp = String(def.display_name || type || '');
    if (/input\s*files?|config|options|credential|auth|key|settings/i.test(disp + ' ' + type)) return null;
    var isApi = !!(def.api_node || cat.indexOf('api') === 0 || cat.indexOf('api node') >= 0
      || /api$/i.test(cat) || /partner|cloud|external/i.test(cat));
    var outs = Array.isArray(def.output) ? def.output.map(String) : [];
    var makesVid = outs.some(function (o) { return /VIDEO|VHS_AUDIO|LATENT_VIDEO/i.test(o); })
      || /video|kling|seedance|veo|sora|runway|luma|minimax|wan|ltx|hunyuan|pika|vidu/i.test(disp + ' ' + cat);
    var makesImg = outs.some(function (o) { return /IMAGE|LATENT/i.test(o); });
    if (!isApi && !/sampling|generator|image\/generation|video/i.test(cat)) {
      if (ndRank(disp, type) >= 999) return null;
    }
    if (!makesImg && !makesVid) return null;
    var shortName = disp
      .replace(/\s*\((?:API|Google[^)]*|Partner[^)]*|ByteDance[^)]*|Black Forest[^)]*|OpenAI[^)]*|Stability[^)]*)\)\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim() || disp;
    return {
      type: type,
      name: shortName,
      fullName: disp,
      cat: String(def.category || ''),
      api: isApi,
      kind: makesVid ? 'video' : 'image',
      rank: ndRank(disp, type)
    };
  }

  function probe(force) {
    if (SRV.probed && !force) return Promise.resolve(SRV);
    if (SRV.probing && !force) return SRV.probing;
    loadNodeFreq();
    SRV.probing = apiFetch('/object_info')
      .then(function (r) { return r && r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (info) {
        SRV.types = info || {};
        SRV.old = findOldVersions(SRV.types);
        SRV.api = {};
        var models = [];
        Object.keys(SRV.types).forEach(function (t) {
          var def = SRV.types[t];
          var c = classifyServerType(t, def);
          if (c) {
            if (c.api) SRV.api[t] = c;
            models.push(c);
          }
        });
        models.sort(function (a, b) {
          if (a.api !== b.api) return a.api ? -1 : 1;
          if (a.rank !== b.rank) return a.rank - b.rank;
          return a.name.localeCompare(b.name);
        });
        SRV.models = models;
        SRV.probed = true;
        return apiFetch('/global_subgraphs')
          .then(function (r) { return r && r.ok ? r.json() : {}; })
          .catch(function () { return {}; });
      })
      .then(function (subs) {
        var list = [];
        if (subs && typeof subs === 'object') {
          Object.keys(subs).forEach(function (k) {
            var item = subs[k] || {};
            list.push({
              type: 'subgraph:' + k,
              subId: k,
              name: String(item.name || item.title || k),
              kind: 'image',
              gen: subGenKind(item.name || item.title || ''),
              api: false,
              isSub: true,
              rank: ndRank(item.name || k, k)
            });
          });
        }
        SRV.subgraphs = list;
        SRV.old = findOldVersions(SRV.types, list);
        return SRV;
      });
    return SRV.probing;
  }

  /* ---------------------------------------------------------------------
   * 5. NODE CLASSIFICATION, SLOTS & GRAPH HELPERS
   * --------------------------------------------------------------------- */
  function allNodes(graph) {
    var g = graph || getGraph();
    if (!g) return [];
    var a = g._nodes || g.nodes || [];
    return Array.prototype.slice.call(a);
  }

  function selNodes() {
    var c = getCanvas();
    if (!c) return [];
    var out = [];
    var sn = c.selected_nodes || {};
    Object.keys(sn).forEach(function (k) {
      if (sn[k] && out.indexOf(sn[k]) < 0) out.push(sn[k]);
    });
    if (!out.length && c.selectedItems && typeof c.selectedItems.forEach === 'function') {
      c.selectedItems.forEach(function (it) {
        if (it && it.pos && (it.type || it.comfyClass) && out.indexOf(it) < 0) {
          out.push(it);
        }
      });
    }
    return out;
  }

  function selectedOne() {
    var s = selNodes();
    return s.length === 1 ? s[0] : (s[0] || null);
  }

  function linkById(graph, id) {
    var g = graph || getGraph();
    if (!g || id == null) return null;
    var ls = g.links || g._links;
    if (!ls) return null;
    if (typeof ls.get === 'function') return ls.get(id) || null;
    return ls[id] || null;
  }

  function widgetNamed(node, name) {
    var ws = (node && node.widgets) || [];
    for (var i = 0; i < ws.length; i++) {
      if (ws[i] && ws[i].name === name) return ws[i];
    }
    return null;
  }

  function setWidgetVal(node, name, val) {
    var w = widgetNamed(node, name);
    if (!w) return false;
    var prev = w.value;
    try { w.value = val; } catch (e) { return false; }
    try { if (w.callback) w.callback(val, null, node); } catch (e) {}
    try { if (node.onWidgetChanged) node.onWidgetChanged(name, val, prev, w); } catch (e) {}
    return true;
  }

  function setWidgetNum(node, name, val) {
    return setWidgetVal(node, name, Math.round(+val || 0));
  }

  function nodeMoveTo(n, x, y) {
    if (!n) return false;
    x = Math.round(x); y = Math.round(y);
    try { n.pos = [x, y]; return true; } catch (e) {}
    try { n.pos[0] = x; n.pos[1] = y; return true; } catch (e) {}
    return false;
  }

  /* A node's body in graph units. A Vue node can be drawn bigger than its `size` (an image preview, a crop
     widget), so its element is measured too: offsetWidth/Height ignore the canvas zoom, and the height
     includes the title bar */
  function visBox(n) {
    var p = (n && n.pos) || [0, 0];
    var s = (n && n.size) || [240, 120];
    var collapsed = !!(n && n.flags && n.flags.collapsed);
    var w = collapsed ? 190 : Math.max(140, +s[0] || 240);
    var h = collapsed ? 32 : Math.max(60, +s[1] || 120);
    if (!collapsed && n && n.id != null) {
      var el = document.querySelector('.lg-node[data-node-id="' + cssEsc(n.id) + '"]');
      if (el && el.offsetWidth) {
        var LG = litegraph();
        w = Math.max(w, el.offsetWidth);
        h = Math.max(h, el.offsetHeight - ((LG && LG.NODE_TITLE_HEIGHT) || 30));
      }
    }
    return { x: +p[0] || 0, y: +p[1] || 0, w: w, h: h };
  }

  function pasteAnchor(canvas) {
    var c = canvas || getCanvas();
    try {
      var gm = c && (c.graph_mouse || c.canvas_mouse);
      if (gm && isFinite(gm[0]) && isFinite(gm[1])) {
        return [Math.round(gm[0]), Math.round(gm[1])];
      }
      var ds = c && c.ds;
      var el = c && c.canvas;
      if (ds && el) {
        var w = el.clientWidth || 1200, h = el.clientHeight || 800;
        return [
          Math.round(-ds.offset[0] + w / (2 * ds.scale) - 120),
          Math.round(-ds.offset[1] + h / (2 * ds.scale) - 60)
        ];
      }
    } catch (e) {}
    return [200, 200];
  }

  function slotType(slot) {
    return String((slot && slot.type) || '').toUpperCase();
  }

  function typeFits(outType, inType) {
    var o = String(outType || '').toUpperCase();
    var i = String(inType || '').toUpperCase();
    if (!o || !i) return false;
    if (o === '*' || i === '*' || o === i) return true;
    if (i.indexOf(',') >= 0) {
      return i.split(',').map(function (s) { return s.trim(); }).indexOf(o) >= 0;
    }
    return false;
  }

  function findOutSlot(node, typeRegex) {
    var outs = (node && node.outputs) || [];
    for (var i = 0; i < outs.length; i++) {
      if (typeRegex.test(slotType(outs[i]))) return i;
    }
    return -1;
  }

  function findInSlot(node, typeRegex, freeOnly) {
    var ins = (node && node.inputs) || [];
    for (var i = 0; i < ins.length; i++) {
      if (freeOnly && ins[i].link != null) continue;
      if (typeRegex.test(slotType(ins[i]))) return i;
    }
    return -1;
  }

  function imageOutSlot(node) { return findOutSlot(node, /^IMAGE$/i); }
  function videoOutSlot(node) { return findOutSlot(node, /^VIDEO|VHS_VIDEO$/i); }
  function maskOutSlot(node)  { return findOutSlot(node, /^MASK$/i); }

  function hasMediaInput(node) {
    var ins = (node && node.inputs) || [];
    for (var i = 0; i < ins.length; i++) {
      if (/^(IMAGE|VIDEO|MASK|LATENT|VHS_IMAGES)$/i.test(slotType(ins[i]))) {
        return true;
      }
    }
    return false;
  }

  function isLoader(node) {
    if (!node) return false;
    var t = String(node.type || node.comfyClass || '');
    if (/^(LoadImage|LoadImageMask|LoadVideo|VHS_LoadVideo|VHS_LoadImages|LoadEXR|OCIORead)$/i.test(t)) {
      return true;
    }
    if (/load/i.test(t) && !hasMediaInput(node) && (imageOutSlot(node) >= 0 || videoOutSlot(node) >= 0)) {
      return true;
    }
    return false;
  }

  function isPreviewNode(node) {
    if (!node) return false;
    var t = String(node.type || node.comfyClass || '');
    return /^(PreviewImage|PreviewAny|VHS_VideoCombine)$/i.test(t)
      || (/preview/i.test(t) && imageOutSlot(node) < 0 && videoOutSlot(node) < 0);
  }

  function outKind(node) {
    if (!node) return '';
    var t = String(node.type || node.comfyClass || '');
    if (/^(SaveImage|SaveAnimatedWEBP|SaveAnimatedPNG|SaveVideo|VHS_VideoCombine|SaveEXR|OCIOWrite)$/i.test(t)
        || /^Save/i.test(t)) {
      return 'save';
    }
    return '';
  }

  function isCropNode(node) {
    if (!node) return false;
    var t = String(node.type || node.comfyClass || '');
    return /^(ImageCropV2|ImageCrop|ImageCrop\+)$/i.test(t) || !!widgetNamed(node, 'crop_region');
  }

  function isStitchNode(node) {
    if (!node) return false;
    var t = String(node.type || node.comfyClass || '');
    return t === 'ImageCompositeMasked';
  }

  function isPainterNode(node) {
    if (!node) return false;
    var t = String(node.type || node.comfyClass || '');
    return t === 'Painter' || (!!widgetNamed(node, 'mask') && /paint/i.test(t));
  }

  function isSetNode(node) {
    if (!node) return false;
    var t = String(node.type || node.comfyClass || '');
    return /^(SetNode|easy setNode)$/i.test(t);
  }

  function isGetNode(node) {
    if (!node) return false;
    var t = String(node.type || node.comfyClass || '');
    return /^(GetNode|easy getNode)$/i.test(t);
  }

  function genOut(node) {
    if (!node) return 'image';
    if (videoOutSlot(node) >= 0) return 'video';
    var t = String(node.type || node.comfyClass || '') + ' ' + String(node.title || '');
    if (/video|kling|seedance|veo|sora|runway|luma|wan|ltx|hunyuan|minimax/i.test(t)) {
      return 'video';
    }
    return 'image';
  }

  function ndKind(node) {
    if (!node) return 'empty';
    if (isLoader(node)) return 'load';
    if (isCropNode(node)) return 'crop';
    if (isStitchNode(node)) return 'stitch';
    if (isPainterNode(node)) return 'paint';
    if (isSetNode(node)) return 'set';
    if (isGetNode(node)) return 'get';
    if (isPreviewNode(node)) return 'view';
    if (outKind(node)) return 'out';
    var t = String(node.type || node.comfyClass || '');
    if (SRV.api && SRV.api[t]) return 'api';
    if (imageOutSlot(node) >= 0 || videoOutSlot(node) >= 0 || findOutSlot(node, /^LATENT$/i) >= 0) {
      return 'gen';
    }
    return 'other';
  }

  function ndAdds(node) {
    /* API nodes and subgraphs that run a model default to Swap mode; all standard nodes use Add/Connect mode */
    return ndKind(node) !== 'api' && !isSwapSub(node);
  }

  /* ---------------------------------------------------------------------
   * 6. FAVORITES, SEEDS, BYPASS & GROUP HELPERS
   * --------------------------------------------------------------------- */
  function favKey(kind) {
    if (kind === 'video') return 'favVideo';
    if (kind === 'btn') return 'favBtn';
    return 'favImage';
  }

  function favList(kind) {
    var k = favKey(kind);
    return Array.isArray(S[k]) ? S[k].slice() : [];
  }

  function toggleFav(kind, id) {
    if (!id) return;
    var k = favKey(kind);
    var l = favList(kind);
    var idx = l.indexOf(id);
    if (idx >= 0) l.splice(idx, 1);
    else l.push(id);
    S[k] = l;
    save();
  }

  function hbBucket(node) {
    if (!node) return 'empty';
    var k = ndKind(node) || 'other';
    /* image and video generators keep separate bars: a video model's first tool is Save Video, not Crop */
    if ((k === 'api' || k === 'gen' || k === 'other') && genOut(node) === 'video') return k + '-video';
    return k;
  }

  function hbPinList(node) {
    var b = hbBucket(node);
    var m = (S.hotboxPins && typeof S.hotboxPins === 'object') ? S.hotboxPins : {};
    return Array.isArray(m[b]) ? m[b].slice() : [];
  }

  function hbPinAdd(type, node) {
    if (!type) return;
    var b = hbBucket(node);
    if (!S.hotboxPins || typeof S.hotboxPins !== 'object') S.hotboxPins = {};
    var l = hbPinList(node);
    if (l.indexOf(type) < 0) l.push(type);
    S.hotboxPins[b] = l;
    save();
  }

  function hbPinRemove(type, node) {
    var b = hbBucket(node);
    if (!S.hotboxPins || typeof S.hotboxPins !== 'object') return;
    S.hotboxPins[b] = hbPinList(node).filter(function (x) { return x !== type; });
    save();
  }

  /* Seed control helpers */
  var SEED_MODES = ['fixed', 'increment', 'decrement', 'randomize'];

  function seedControls(node) {
    var out = [];
    var ws = (node && node.widgets) || [];
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (!w) continue;
      var nm = String(w.name || '');
      if (nm === 'control_after_generate' || /seed.*control/i.test(nm)) {
        if (out.indexOf(w) < 0) out.push(w);
      } else if (w.linkedWidgets && w.linkedWidgets.length) {
        w.linkedWidgets.forEach(function (lw) {
          if (lw && lw.name === 'control_after_generate' && out.indexOf(lw) < 0) {
            out.push(lw);
          }
        });
      }
    }
    return out;
  }

  function seedModeOf(nodes) {
    var val = '';
    (nodes || []).forEach(function (n) {
      seedControls(n).forEach(function (w) {
        var v = String(w.value || '');
        if (!val) val = v;
        else if (val !== v) val = 'mixed';
      });
    });
    return val;
  }

  function actSeedMode(nodes, mode) {
    var list = (nodes && nodes.length) ? nodes : selNodes();
    var count = 0;
    list.forEach(function (n) {
      seedControls(n).forEach(function (w) {
        try {
          w.value = mode;
          if (w.callback) w.callback(mode, null, n);
          count++;
        } catch (e) {}
      });
    });
    var g = getGraph();
    if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
    if (count) {
      hbSyncSeedButtons(list, mode);
      setStatus('ok', 'Seed mode set to "' + mode + '" on ' + count + ' control' + (count === 1 ? '' : 's'));
    } else {
      setStatus('error', 'No seed control_after_generate widget found on this node');
    }
  }

  /* Nodes 2.0 draws a seed's mode button from a copy of the mode it takes once, so a mode set from here would
     run but not show. It is replayed through that button's own menu, kept invisible (.shb-seedsync), one
     button at a time. A node scrolled out of view needs nothing: it reads the mode again when it comes back. */
  function hbSyncSeedButtons(nodes, mode) {
    var btns = [];
    nodes.forEach(function (n) {
      var el = document.querySelector('.lg-node[data-node-id="' + cssEsc(n.id) + '"]');
      if (el) Array.prototype.push.apply(btns, el.querySelectorAll('[data-testid="value-control"]'));
    });
    if (!btns.length) return;
    document.body.classList.add('shb-seedsync');
    var i = 0;
    (function next() {
      var b = btns[i++];
      if (!b) {
        setTimeout(function () { document.body.classList.remove('shb-seedsync'); }, 60);
        return;
      }
      if (!b.isConnected) { next(); return; }
      b.click();
      var tries = 0;
      (function pick() {
        var r = document.querySelector('[data-reka-popper-content-wrapper] input[type="radio"][id="' + mode + '"]');
        if (!r && ++tries < 40) { setTimeout(pick, 25); return; }
        if (r && !r.checked) r.click();
        if (document.querySelector('[data-reka-popper-content-wrapper]')) b.click();
        setTimeout(next, 30);
      })();
    })();
  }

  /* Bypass helpers */
  var MODE_ON = 0, MODE_MUTE = 2, MODE_BYPASS = 4;
  function isBypassed(n) {
    try { return n && n.mode === MODE_BYPASS; } catch (e) { return false; }
  }

  function actBypass(node) {
    var list = selNodes();
    if (node && list.indexOf(node) < 0) list = [node];
    if (!list.length) return;
    var turnOn = list.some(function (n) { return !isBypassed(n); });
    list.forEach(function (n) {
      try { n.mode = turnOn ? MODE_BYPASS : MODE_ON; } catch (e) {}
    });
    var g = getGraph();
    if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
    setStatus('ok', (list.length === 1 ? (list[0].title || list[0].type) : list.length + ' nodes')
      + (turnOn ? ' bypassed' : ' active'));
  }

  function actMute(node) {
    var list = selNodes();
    if (node && list.indexOf(node) < 0) list = [node];
    if (!list.length) return;
    var turnMute = list.some(function (n) { return n.mode !== MODE_MUTE; });
    list.forEach(function (n) {
      try { n.mode = turnMute ? MODE_MUTE : MODE_ON; } catch (e) {}
    });
    var g = getGraph();
    if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
    setStatus('ok', (list.length === 1 ? (list[0].title || list[0].type) : list.length + ' nodes')
      + (turnMute ? ' muted' : ' unmuted'));
  }

  function actBypassApi() {
    var g = getGraph();
    var list = [];
    allNodes(g).forEach(function (n) {
      var t = String(n.type || n.comfyClass || '');
      if (SRV.api && SRV.api[t]) list.push(n);
    });
    if (!list.length) {
      if (!SRV.probed) {
        probe().then(actBypassApi);
        return;
      }
      setStatus('error', 'No API nodes found in this workflow');
      return;
    }
    var anyLive = list.some(function (n) { return !isBypassed(n); });
    list.forEach(function (n) {
      try { n.mode = anyLive ? MODE_BYPASS : MODE_ON; } catch (e) {}
    });
    if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
    setStatus('ok', list.length + ' API node' + (list.length === 1 ? '' : 's')
      + (anyLive ? ' bypassed (cost-free test mode)' : ' re-enabled'));
  }

  /* Shift+R — render only what is selected (ported from ImissNuke): the selected output nodes, or the
     output nodes downstream of the selection. Nothing selected renders nothing, so a stray key never
     spends API credits on the whole graph. rgthree's queue is used when it is installed. */
  function hbIsOutputNode(n) {
    if (!n || n.mode === MODE_MUTE || n.mode === MODE_BYPASS) return false;
    if ((n.constructor && n.constructor.nodeData && n.constructor.nodeData.output_node) || n.is_output_node) return true;
    return /save|preview|output|display/i.test(String(n.type || ''));
  }

  function actRenderSelected() {
    var app = getApp(), g = getGraph();
    if (!app || !g) return;
    var sel = selNodes();
    if (!sel.length) {
      setStatus('error', 'Render Selected: select the node(s) to render first');
      return;
    }
    var outs = sel.filter(hbIsOutputNode);
    if (!outs.length) {
      var seen = {}, queue = sel.slice();
      while (queue.length) {
        var cur = queue.shift();
        if (!cur || seen[cur.id]) continue;
        seen[cur.id] = 1;
        if (hbIsOutputNode(cur)) outs.push(cur);
        (cur.outputs || []).forEach(function (o) {
          ((o && o.links) || []).forEach(function (lid) {
            var l = linkById(g, lid);
            var t = (l && g.getNodeById) ? g.getNodeById(l.target_id) : null;
            if (t && !seen[t.id]) queue.push(t);
          });
        });
      }
    }
    if (!outs.length) {
      setStatus('error', 'Render Selected: no output node is selected or downstream of the selection');
      return;
    }
    var what = outs.length === 1 ? (outs[0].title || outs[0].type) : outs.length + ' output nodes';
    function done() { setStatus('ok', '▶ Rendering ' + what); }
    function failed(err) { setStatus('error', 'Render Selected failed: ' + msgOf(err)); }
    if (window.rgthree && typeof window.rgthree.queueOutputNodes === 'function') {
      Promise.resolve(window.rgthree.queueOutputNodes(outs)).then(done, failed);
      return;
    }
    var api = app.api || (window.comfyAPI && window.comfyAPI.api && window.comfyAPI.api.api);
    Promise.resolve(app.graphToPrompt()).then(function (p) {
      var full = p && p.output;
      if (!full || !api || !api.queuePrompt) throw new Error('the queue API is not available');
      var part = {};
      (function need(ids) {
        ids.forEach(function (id) {
          id = String(id);
          if (part[id] || !full[id]) return;
          part[id] = full[id];
          var ins = full[id].inputs || {};
          need(Object.keys(ins).filter(function (k) { return Array.isArray(ins[k]); })
            .map(function (k) { return ins[k][0]; }));
        });
      })(outs.map(function (n) { return n.id; }));
      if (!Object.keys(part).length) throw new Error('the selected outputs are not in the prompt (muted or bypassed?)');
      return api.queuePrompt(0, { output: part, workflow: p.workflow });
    }).then(done, failed);
  }

  /* Text to the clipboard. A ComfyUI opened by its network address (--listen, no https) has no clipboard API,
     so a hidden text field is copied there instead. */
  function hbClipText(text) {
    function viaField() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      return ok ? Promise.resolve() : Promise.reject(new Error('the browser did not allow the clipboard'));
    }
    try {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(viaField);
    } catch (e) {}
    return viaField();
  }

  /* Copy Workflow: the whole workflow, as Export saves it, on the clipboard */
  function actCopyWorkflow() {
    var app = getApp();
    if (!app || !app.graph) {
      setStatus('error', 'Copy Workflow: no workflow is open');
      return;
    }
    function plain() { return app.graph.serialize(); }
    var wf = typeof app.graphToPrompt === 'function'
      ? Promise.resolve(app.graphToPrompt()).then(function (p) { return (p && p.workflow) || plain(); }, plain)
      : Promise.resolve().then(plain);
    wf.then(function (w) {
      var n = (w && w.nodes && w.nodes.length) || 0;
      return hbClipText(JSON.stringify(w, null, 2)).then(function () {
        setStatus('ok', '⧉ Workflow copied (' + n + (n === 1 ? ' node' : ' nodes') + ')');
      });
    }).catch(function (err) { setStatus('error', 'Copy Workflow failed: ' + msgOf(err)); });
  }

  function outGroup(title, color, members) {
    var g = getGraph();
    var LG = litegraph();
    if (!g || !g.add || !LG || !LG.LGraphGroup || !members || !members.length) return null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    members.forEach(function (n) {
      if (!n || !n.pos) return;
      var b = visBox(n);
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    });
    if (!isFinite(x0)) return null;
    var PAD = 38, TOP = 62;
    var G = null;
    try {
      G = new LG.LGraphGroup();
      G.configure({
        title: String(title || 'Group'),
        font_size: 22,
        color: color || '#2b4562',
        bounding: [
          Math.round(x0 - PAD),
          Math.round(y0 - TOP),
          Math.round((x1 - x0) + PAD * 2),
          Math.round((y1 - y0) + TOP + PAD)
        ]
      });
      g.add(G);
      g.setDirtyCanvas(true, true);
    } catch (e) { G = null; }
    return G;
  }

  /* ---------------------------------------------------------------------
   * 7. SMART MODEL ADD, SWAP & AUTO-WIRING
   * --------------------------------------------------------------------- */
  function swapMates(node, kind, withOld) {
    var want = kind || genOut(node);
    var cur = node ? String(node.type || node.comfyClass || '') : '';
    /* a video model swaps to video models, an image model to image ones (their outputs differ) */
    var models = (SRV.models || []).filter(function (m) {
      return m.type !== cur && (!want || m.kind === want) && (withOld || !isOldVersion(m.type));
    });
    /* and to subgraphs that make the same: the workflow's own model subgraphs first on a subgraph, after the
       API models on an API node; ComfyUI's ready-made ones last */
    var subs = subMates(want, withOld).filter(function (m) { return m.type !== 'subgraph:' + cur; });
    var own = subs.filter(function (m) { return m.wf; }), global = subs.filter(function (m) { return !m.wf; });
    return isSubgraphNode(node) ? own.concat(models, global) : models.concat(own, global);
  }

  /* ---- Subgraphs as models. A subgraph with a model inside (an API node, or a loader of a local model) swaps
     like a model: to an API model, or to another such subgraph, and back. The workflow's own subgraphs can be
     made by type; a global one (ComfyUI's blueprints, a node pack's subgraphs) is pasted from its JSON, the way
     ComfyUI's own node library adds it, and fetched the first time it is used */
  var SUBDATA = {}, SUBDEF = {};   // a global subgraph's JSON, and the type it has in this workflow once pasted
  var SUB_GEN = [[/\bto video\b|video generation|video edit|video inpaint|motion transfer|character replacement|flf2v/i, 'video'],
    [/\bto image\b|image edit|edit image|inpainting|outpainting|style reference|^controlnet\b/i, 'image']];
  var MODEL_LOADER_RE = /checkpointloader|unetloader|unet_?loader|diffusersloader|loadcheckpoint|modelloader|gguf/i;

  function subGenKind(name) {
    for (var i = 0; i < SUB_GEN.length; i++) if (SUB_GEN[i][0].test(String(name || ''))) return SUB_GEN[i][1];
    return '';
  }

  /* does this subgraph (or one nested in it) run a model? */
  function subHasModel(sg, depth) {
    var nodes = (sg && (sg.nodes || sg._nodes)) || [];
    return Array.prototype.some.call(nodes, function (n) {
      var t = String((n && (n.type || n.comfyClass)) || '');
      if ((SRV.api && SRV.api[t]) || MODEL_LOADER_RE.test(t)) return true;
      return (depth || 0) < 3 && !!(n && n.subgraph) && subHasModel(n.subgraph, (depth || 0) + 1);
    });
  }

  function subOutKind(outs) {
    var t = (outs || []).map(function (o) { return String((o && o.type) || '').toUpperCase(); });
    return t.indexOf('VIDEO') >= 0 ? 'video' : t.indexOf('IMAGE') >= 0 ? 'image' : '';
  }

  /* the workflow's own subgraphs that make images or video with a model */
  function wfSubgraphs() {
    var g = getGraph(), root = g && (g.rootGraph || g), m = root && root.subgraphs, out = [];
    if (!m || typeof m.forEach !== 'function') return out;
    m.forEach(function (sg, id) {
      var kind = subOutKind(sg && sg.outputs);
      if (!kind || !subHasModel(sg)) return;
      out.push({ type: 'subgraph:' + ((sg && sg.id) || id), subId: (sg && sg.id) || id, name: String((sg && sg.name) || 'Subgraph'),
        kind: kind, api: false, isSub: true, wf: true });
    });
    return out;
  }

  /* every subgraph that swaps like a model, of one kind (or all); a global one already in the workflow shows once */
  function subMates(kind, withOld) {
    var own = wfSubgraphs(), names = {};
    own.forEach(function (m) { names[m.name] = 1; });
    var global = (SRV.subgraphs || []).filter(function (m) { return m.gen && !names[m.name] && (withOld || !isOldVersion(m.type)); }).map(function (m) {
      return { type: m.type, subId: m.subId, name: m.name, kind: m.gen, api: false, isSub: true, wf: false };
    });
    return own.concat(global).filter(function (m) { return !kind || m.kind === kind; });
  }

  function subNamed(type) {
    var id = String(type || '').replace(/^subgraph:/, ''), hit = '';
    wfSubgraphs().concat(SRV.subgraphs || []).forEach(function (m) { if (!hit && (m.subId === id || m.type === type)) hit = m.name; });
    if (!hit) {
      var g = getGraph(), root = g && (g.rootGraph || g), sg = root && root.subgraphs && root.subgraphs.get && root.subgraphs.get(id);
      if (sg && sg.name) hit = String(sg.name);
    }
    return hit;
  }

  /* a subgraph node that runs a model and makes images or video: it swaps instead of adding */
  function isSwapSub(node) {
    return isSubgraphNode(node) && (imageOutSlot(node) >= 0 || videoOutSlot(node) >= 0) && subHasModel(node.subgraph);
  }

  /* resolves once `type` can be made right away: a global subgraph's JSON is fetched the first time */
  function hbReady(type) {
    var id = String(type || '').indexOf('subgraph:') === 0 ? String(type).slice(9) : '';
    var LG = litegraph();
    if (!id || SUBDATA[id] || (LG && LG.registered_node_types && LG.registered_node_types[id])) return Promise.resolve();
    setStatus('ok', '… Loading ' + (subNamed(type) || 'subgraph'));
    return apiFetch('/global_subgraphs/' + encodeURIComponent(id))
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (e) {
        var d = e && e.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { d = null; } }
        if (d && d.nodes) SUBDATA[id] = d;
      })
      .catch(function () {});
  }

  /* a global subgraph, pasted at pos; returns its subgraph node */
  function subPaste(data, pos) {
    var c = getCanvas();
    if (!c || typeof c._deserializeItems !== 'function') return null;
    var res = null;
    try {
      res = c._deserializeItems(JSON.parse(JSON.stringify({ nodes: data.nodes || [], links: data.links || [],
        subgraphs: (data.definitions && data.definitions.subgraphs) || data.subgraphs || [] })), { position: pos });
    } catch (e) { res = null; }
    if (!res) return null;
    var made = null;
    try { if (res.nodes && res.nodes.values) made = res.nodes.values().next().value || null; } catch (e) {}
    if (!made && res.created) made = Array.prototype.filter.call(res.created, isGraphNode)[0] || null;
    if (made && made.pos) nodeMoveTo(made, pos[0], pos[1]);
    return made;
  }

  function ndMates(node, withOld) {
    var cur = node ? String(node.type || node.comfyClass || '') : '';
    return (SRV.models || []).filter(function (m) {
      return m.type !== cur && (withOld || !isOldVersion(m.type));
    });
  }

  function carryWidgets(fromNode, toNode) {
    if (!fromNode || !toNode) return 0;
    var src = (fromNode.widgets || []);
    var dst = (toNode.widgets || []);
    var count = 0;
    var aliases = {
      prompt: ['prompt', 'text', 'positive', 'positive_prompt'],
      negative_prompt: ['negative_prompt', 'negative'],
      seed: ['seed', 'noise_seed'],
      aspect_ratio: ['aspect_ratio', 'ratio'],
      resolution: ['resolution', 'size', 'image_size'],
      duration: ['duration', 'seconds', 'length']
    };
    /* newer API nodes nest their settings under a model picker (model.prompt, model.resolution…):
       a setting matches by its own name, whatever group it sits in */
    function leaf(name) { return String(name).split('.').pop(); }
    function findSrc(name) {
      for (var i = 0; i < src.length; i++) {
        if (src[i] && src[i].name === name) return src[i];
      }
      for (var i2 = 0; i2 < src.length; i2++) {
        if (src[i2] && src[i2].name && leaf(src[i2].name) === leaf(name)) return src[i2];
      }
      for (var k in aliases) {
        if (aliases[k].indexOf(leaf(name)) >= 0) {
          for (var j = 0; j < src.length; j++) {
            if (src[j] && src[j].name && aliases[k].indexOf(leaf(src[j].name)) >= 0) return src[j];
          }
        }
      }
      return null;
    }
    dst.forEach(function (dw) {
      if (!dw || !dw.name) return;
      var sw = findSrc(dw.name);
      if (!sw || sw.value === undefined) return;
      if (dw.options && Array.isArray(dw.options.values)) {
        if (dw.options.values.indexOf(sw.value) < 0) return;
      }
      try {
        dw.value = sw.value;
        if (dw.callback) dw.callback(sw.value, null, toNode);
        count++;
      } catch (e) {}
    });
    return count;
  }

  /* Upstream image origin when standing on a PreviewImage */
  function imageOrigin(graph, node) {
    var g = graph || getGraph();
    if (!g || !node) return null;
    var ins = node.inputs || [];
    for (var i = 0; i < ins.length; i++) {
      if (ins[i] && ins[i].link != null) {
        var l = linkById(g, ins[i].link);
        if (l) {
          var up = g.getNodeById ? g.getNodeById(l.origin_id) : null;
          if (up) return { node: up, slot: l.origin_slot };
        }
      }
    }
    return null;
  }

  function pickFeed(node) {
    if (!node) return null;
    var sImg = imageOutSlot(node);
    if (sImg >= 0) return { node: node, slot: sImg, type: 'IMAGE' };
    var sVid = videoOutSlot(node);
    if (sVid >= 0) return { node: node, slot: sVid, type: 'VIDEO' };
    var orig = imageOrigin(getGraph(), node);
    if (orig && orig.node) {
      return { node: orig.node, slot: orig.slot, type: 'IMAGE' };
    }
    if (node.outputs && node.outputs.length) {
      return { node: node, slot: 0, type: slotType(node.outputs[0]) };
    }
    return null;
  }

  function createNodeOrSubgraph(type, pos, keepPos) {
    var g = getGraph();
    var LG = litegraph();
    if (!g || !LG || !LG.createNode) return null;
    var realType = String(type || '');
    if (realType.indexOf('subgraph:') === 0) {
      realType = realType.slice(9);
    }
    var made = null, reg = LG.registered_node_types || {};
    /* a global subgraph already pasted once is made by its type in this workflow, so it is not defined twice */
    if (realType !== type && SUBDEF[realType] && reg[SUBDEF[realType]]) realType = SUBDEF[realType];
    if (realType !== type && SUBDATA[realType] && !reg[realType]) {
      /* a global subgraph: pasted, so it is in the graph already */
      made = subPaste(SUBDATA[realType], pos);
      if (!made) return null;
      SUBDEF[type.slice(9)] = made.type;
      if (!keepPos) hbAvoidOverlap(g, made);
      hbWiggleNode(made);
      return made;
    }
    try { made = LG.createNode(realType); } catch (e) { made = null; }
    if (!made && realType !== type) {
      try { made = LG.createNode(type); } catch (e) { made = null; }
    }
    if (!made) return null;
    made.pos = [Math.round(pos[0]), Math.round(pos[1])];
    g.add(made);
    /* a swap keeps the exact spot of the node it replaces */
    if (!keepPos) hbAvoidOverlap(g, made);
    hbWiggleNode(made);
    return made;
  }

  /* A new node (or a dropped block of nodes) never lands on top of another one: it slides right or down,
     whichever is the shorter way, until its spot (title bars included, plus a small gap) is free */
  function hbTitledBox(n) {
    var LG = litegraph();
    var TH = (LG && LG.NODE_TITLE_HEIGHT) || 30;
    var b = visBox(n);
    return { x: b.x, y: b.y - TH, w: b.w, h: b.h + TH };
  }

  /* How far the box `me` (graph units, title included) must slide, down (axis 1) or right (axis 0), to cover
     no node outside `skip` */
  function hbFreeShift(graph, me, skip, axis) {
    var GAP = 30;
    var others = allNodes(graph).filter(function (n) { return skip.indexOf(n) < 0 && n.pos; }).map(hbTitledBox);
    var x = me.x, y = me.y;
    for (var i = 0; i < 80; i++) {
      var hit = null;
      for (var k = 0; k < others.length && !hit; k++) {
        var o = others[k];
        if (x < o.x + o.w + GAP && x + me.w + GAP > o.x && y < o.y + o.h + GAP && y + me.h + GAP > o.y) hit = o;
      }
      if (!hit) break;
      if (axis) y = hit.y + hit.h + GAP;
      else x = hit.x + hit.w + GAP;
    }
    return axis ? y - me.y : x - me.x;
  }

  function hbFreeDy(graph, me, skip) { return hbFreeShift(graph, me, skip, 1); }

  /* The shorter way out: a node spawned beside a tall one only steps right instead of dropping below it */
  function hbFreeMove(graph, me, skip) {
    var dy = hbFreeShift(graph, me, skip, 1);
    if (!dy) return { dx: 0, dy: 0 };
    var dx = hbFreeShift(graph, me, skip, 0);
    return dx < dy ? { dx: dx, dy: 0 } : { dx: 0, dy: dy };
  }

  function hbAvoidOverlap(graph, made) {
    var list = (Array.isArray(made) ? made : [made]).filter(function (n) { return n && n.pos; });
    if (!graph || !list.length) return;
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    list.forEach(function (n) {
      var b = hbTitledBox(n);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    });
    var mv = hbFreeMove(graph, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, list);
    if (mv.dx || mv.dy) list.forEach(function (n) { nodeMoveTo(n, n.pos[0] + mv.dx, n.pos[1] + mv.dy); });
  }

  /* Connect all compatible slots between srcNode and dstNode (multi-slot aware, e.g. MODEL + CLIP) */
  /* ---- Which outputs a new node gets. A source often offers one picture several ways, plus its side data (OCIO
     Read: the frames as IMAGE and as a ComfyUI VIDEO, then alpha, fps, info, metadata). The picture is wired once:
     as VIDEO when the source holds a sequence or a clip and the new node takes video, as IMAGE when it is a still
     (or when it cannot tell). Side data (text, numbers, an alpha) goes only into an input of the same name: fps
     into fps and metadata into metadata on OCIO Write, never info into a prompt. A source with nothing but text or
     numbers (a prompt node) still wires them as before */
  var WIRE_SIDE = /^(STRING|INT|FLOAT|BOOLEAN|COMBO|NUMBER)$/;
  var VIDEO_FILE = /\.(mp4|mov|mxf|avi|mkv|webm|m4v|mpg|mpeg|wmv|gif)$/i;

  /* 'video' for a sequence or a clip, 'image' for a still, '' when it cannot tell */
  function srcMediaKind(node) {
    try {
      var k = node && node._ocioSeq && node._ocioSeq.kind;   // OCIO Read, once it has looked at its source
      if (k === 'still') return 'image';
      if (k === 'sequence' || k === 'video') return 'video';
    } catch (e) {}
    var fm = widgetNamed(node, 'frame_mode');
    var mode = fm ? String(fm.value || '') : '';
    if (mode === 'single') return 'image';
    if (mode === 'sequence' || mode === 'video') return 'video';
    var title = String((node && node.title) || '');
    if (/\bsingle image\b|\[\s*single\b|\[\s*still\b/i.test(title)) return 'image';
    if (/\[\s*(image\s*)?(sequence|video|clip)\b/i.test(title)) return 'video';
    var src = '';
    ['source', 'video', 'file', 'filename', 'path'].some(function (n) {
      var w = widgetNamed(node, n);
      if (w && typeof w.value === 'string' && w.value) { src = w.value; return true; }
      return false;
    });
    if (VIDEO_FILE.test(src) || /#{2,}|%0?\d*d|\$F\d*|@{2,}/.test(src)) return 'video';
    return '';
  }

  /* per output: 'any' (wire to a matching input), 'byName' (only into an input of the same name) or 'skip' */
  function wirePlan(node, made) {
    var outs = node.outputs || [], ins = made.inputs || [];
    function T(s) { return String((s && s.type) || '').toUpperCase(); }
    function free(type) { return ins.some(function (i) { return i && i.link == null && T(i) === type; }); }
    var outI = -1, outV = -1, picture = false;
    outs.forEach(function (o, k) {
      var t = T(o);
      if (t === 'IMAGE' && outI < 0) outI = k;
      if (t === 'VIDEO' && outV < 0) outV = k;
      if (t && t !== '*' && !WIRE_SIDE.test(t)) picture = true;
    });
    var skip = -1;
    if (outI >= 0 && outV >= 0 && free('IMAGE') && free('VIDEO')) skip = srcMediaKind(node) === 'video' ? outI : outV;
    return outs.map(function (o, k) {
      if (k === skip) return 'skip';
      var t = T(o);
      if (picture && t === 'MASK' && /^alpha$/i.test(slotName(o))) return 'skip';
      if (picture && WIRE_SIDE.test(t)) return 'byName';
      return 'any';
    });
  }

  function slotName(s) {
    return String((s && s.name) || '').toLowerCase().trim();
  }

  function wireNodesSmart(node, made, vb) {
    if (!node || !made) return '';
    var wiredList = [];
    var outs = node.outputs || [];
    var ins = made.inputs || [];
    var usedOut = {};
    var plan = wirePlan(node, made);

    /* Pass 1: Exact slot type matches from node.outputs -> made.inputs (connects MODEL + CLIP + VAE together!) */
    for (var o = 0; o < outs.length; o++) {
      var oType = String((outs[o] && outs[o].type) || '').toUpperCase();
      if (!oType || oType === '*' || plan[o] === 'skip') continue;
      for (var i = 0; i < ins.length; i++) {
        if (ins[i].link != null) continue;
        if (plan[o] === 'byName' && slotName(ins[i]) !== slotName(outs[o])) continue;
        var iType = String((ins[i] && ins[i].type) || '').toUpperCase();
        if (oType === iType) {
          try {
            if (node.connect(o, made, i)) {
              wiredList.push(ins[i].name || ins[i].type);
              usedOut[o] = 1;
              break;
            }
          } catch (e) {}
        }
      }
    }

    /* Pass 2: Flexible/wildcard matches if nothing matched or remaining outputs fit wildcard inputs */
    if (!wiredList.length) {
      for (var o2 = 0; o2 < outs.length; o2++) {
        if (usedOut[o2] || plan[o2] !== 'any') continue;
        for (var j = 0; j < ins.length; j++) {
          if (ins[j].link != null) continue;
          if (!typeFits(outs[o2] && outs[o2].type, ins[j] && ins[j].type)) continue;
          try {
            if (node.connect(o2, made, j)) {
              wiredList.push(ins[j].name || ins[j].type);
              usedOut[o2] = 1;
              break;
            }
          } catch (e) {}
        }
      }
    }

    /* Pass 3: Upstream feed passthrough (for PreviewImage / Reroute nodes with no direct outputs) */
    if (!wiredList.length) {
      var feed = pickFeed(node);
      if (feed && feed.node && feed.node !== node) {
        for (var k = 0; k < ins.length; k++) {
          if (ins[k].link != null) continue;
          if (typeFits(feed.type, ins[k].type)) {
            try {
              if (feed.node.connect(feed.slot, made, k)) {
                wiredList.push(ins[k].name || ins[k].type);
                break;
              }
            } catch (e) {}
          }
        }
      }
    }

    /* Pass 4: Reverse connection (made.outputs -> node.inputs) when spawning an upstream feeder node */
    if (!wiredList.length) {
      var mOuts = made.outputs || [];
      var nIns = node.inputs || [];
      for (var mo = 0; mo < mOuts.length; mo++) {
        var moType = String((mOuts[mo] && mOuts[mo].type) || '').toUpperCase();
        if (!moType) continue;
        for (var ni = 0; ni < nIns.length; ni++) {
          if (nIns[ni].link != null) continue;
          var niType = String((nIns[ni] && nIns[ni].type) || '').toUpperCase();
          if (moType === niType || typeFits(moType, niType)) {
            try {
              if (made.connect(mo, node, ni)) {
                wiredList.push('→ ' + (nIns[ni].name || nIns[ni].type));
                break;
              }
            } catch (e) {}
          }
        }
      }
      if (wiredList.length && vb && made.pos) {
        var mw = (made.size && made.size[0]) ? made.size[0] : 240;
        made.pos[0] = vb.x - mw - 60;
        made.pos[1] = vb.y;
      }
    }

    return wiredList.join(', ');
  }

  function addModel(node, type) {
    var g = getGraph(), c = getCanvas();
    if (!g) return null;
    var vb = node ? visBox(node) : { x: 200, y: 200, w: 260, h: 120 };
    var pos = node ? [vb.x + vb.w + 70, vb.y] : pasteAnchor(c);
    var made = createNodeOrSubgraph(type, pos);
    if (!made) {
      setStatus('error', 'Could not create node: ' + type);
      return null;
    }
    var wired = wireNodesSmart(node, made, vb);
    var chained = hbChainLora(g, node, made);
    try { if (c && c.selectNodes) c.selectNodes([made]); } catch (e) {}
    try { g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⊕ Added ' + (made.title || made.type) + (chained ? ' (chained · ' + chained + (chained === 1 ? ' wire moved' : ' wires moved') + ' after it)'
      : (wired ? ' (wired → ' + wired + ')' : '')));
    return made;
  }

  /* A LoRA added after a model source joins the chain instead of branching off it (like an insert in Nuke):
     it takes the source's MODEL / CLIP, and whatever the source fed through those slots now hangs off the LoRA */
  var LORA_CHAIN_TYPES = { MODEL: 1, CLIP: 1 };

  function hbChainLora(g, src, made) {
    if (!g || !src || !made || !/lora/i.test(nodeTypeOf(made))) return 0;
    var moved = 0;
    (made.inputs || []).forEach(function (inp) {
      var l = (inp && inp.link != null) ? linkById(g, inp.link) : null;
      var T = String((inp && inp.type) || '').toUpperCase();
      if (!l || String(l.origin_id) !== String(src.id) || !LORA_CHAIN_TYPES[T]) return;
      var mo = -1;
      (made.outputs || []).forEach(function (o, j) { if (mo < 0 && String((o && o.type) || '').toUpperCase() === T) mo = j; });
      var out = src.outputs && src.outputs[l.origin_slot];
      if (mo < 0 || !out) return;
      (out.links || []).slice().forEach(function (lid) {
        var dl = linkById(g, lid);
        var tgt = dl && String(dl.target_id) !== String(made.id) ? g.getNodeById(dl.target_id) : null;
        if (!tgt) return;
        try { if (made.connect(mo, tgt, dl.target_slot)) moved++; } catch (e) {}
      });
    });
    return moved;
  }

  function addModelPair(nodes, type) {
    var g = getGraph(), c = getCanvas();
    if (!g || !nodes || !nodes.length) return null;
    var first = nodes[0];
    var vb = visBox(first);
    var made = createNodeOrSubgraph(type, [vb.x + vb.w + 80, vb.y]);
    if (!made) return null;
    var wiredCount = 0;
    nodes.forEach(function (srcNode) {
      var feed = pickFeed(srcNode);
      if (!feed) return;
      var ins = made.inputs || [];
      for (var i = 0; i < ins.length; i++) {
        if (ins[i].link != null) continue;
        if (typeFits(feed.type, ins[i].type)) {
          try {
            if (feed.node.connect(feed.slot, made, i)) {
              wiredCount++;
              break;
            }
          } catch (e) {}
        }
      }
    });
    try { if (c && c.selectNodes) c.selectNodes([made]); } catch (e) {}
    try { g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⊕ Added ' + (made.title || made.type) + ' wired from ' + wiredCount + ' inputs');
    return made;
  }

  function swapNode(node, type) {
    var g = getGraph(), c = getCanvas();
    if (!g || !node) return null;
    var pos = node.pos ? [node.pos[0], node.pos[1]] : [200, 200];
    var made = createNodeOrSubgraph(type, pos, true);
    if (!made) {
      setStatus('error', 'Could not create node: ' + type);
      return null;
    }
    if (node.color) made.color = node.color;
    if (node.bgcolor) made.bgcolor = node.bgcolor;
    var carried = carryWidgets(node, made);

    /* Reconnect inputs */
    var oldIns = node.inputs || [];
    var newIns = made.inputs || [];
    oldIns.forEach(function (inp) {
      if (!inp || inp.link == null) return;
      var l = linkById(g, inp.link);
      if (!l) return;
      var orig = g.getNodeById ? g.getNodeById(l.origin_id) : null;
      if (!orig) return;
      var targetIdx = -1;
      for (var j = 0; j < newIns.length; j++) {
        if (newIns[j].link == null && newIns[j].name === inp.name && typeFits(inp.type, newIns[j].type)) {
          targetIdx = j; break;
        }
      }
      if (targetIdx < 0) {
        for (var j2 = 0; j2 < newIns.length; j2++) {
          if (newIns[j2].link == null && typeFits(inp.type, newIns[j2].type)) {
            targetIdx = j2; break;
          }
        }
      }
      if (targetIdx >= 0) {
        try { orig.connect(l.origin_slot, made, targetIdx); } catch (e) {}
      }
    });

    /* Reconnect outputs */
    var oldOuts = node.outputs || [];
    var newOuts = made.outputs || [];
    oldOuts.forEach(function (out) {
      var links = (out && out.links) ? out.links.slice() : [];
      if (!links.length) return;
      var srcIdx = -1;
      for (var j = 0; j < newOuts.length; j++) {
        if (typeFits(newOuts[j].type, out.type)) { srcIdx = j; break; }
      }
      if (srcIdx < 0 && newOuts.length) srcIdx = 0;
      if (srcIdx < 0) return;
      links.forEach(function (lid) {
        var l = linkById(g, lid);
        if (!l) return;
        var tgt = g.getNodeById ? g.getNodeById(l.target_id) : null;
        if (tgt) {
          try { made.connect(srcIdx, tgt, l.target_slot); } catch (e) {}
        }
      });
    });

    try { g.remove(node); } catch (e) {}
    try { if (c && c.selectNodes) c.selectNodes([made]); } catch (e) {}
    try { g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⇄ Swapped to ' + (made.title || made.type)
      + (carried ? ' (' + carried + ' settings carried)' : ''));
    return made;
  }

  /* Swap the model on the node under the hotbox and on every other selected node of the same type, in one go:
     select a whole batch of templates, swap once, and each keeps its own prompt, settings and wires */
  function swapSelected(node, type) {
    var c = getCanvas(), oldType = node && node.type, sel = selNodes(), made = [];
    var first = swapNode(node, type);
    if (first) made.push(first);
    sel.forEach(function (s) {
      if (!s || s === node || s.type !== oldType || ndAdds(s)) return;
      var m = swapNode(s, type);
      if (m) made.push(m);
    });
    if (made.length > 1) {
      try { if (c && c.selectNodes) c.selectNodes(made); } catch (e) {}
      setStatus('ok', '⇄ Swapped ' + made.length + ' nodes to ' + (made[0].title || made[0].type));
    }
    return first;
  }

  /* Swap Nodes: two selected nodes trade places and wires (Nuke's Ctrl+Shift drag). Each slot goes to the
     other node's slot with the same name, else the first free one of a fitting type, so two different
     models of one kind swap cleanly too. Wired or not, they always trade places. */
  function actSwapPair() {
    var g = getGraph();
    var sel = selNodes();
    if (!g || sel.length !== 2) {
      setStatus('error', 'Select exactly two nodes to swap them');
      return;
    }
    var a = sel[0], b = sel[1];
    function twin(n) { return n === a ? b : (n === b ? a : n); }
    function fits(x, y) { return typeFits(x, y) || typeFits(y, x); }
    function slotMap(from, to, key) {
      var src = from[key] || [], dst = to[key] || [], map = {}, used = {};
      src.forEach(function (sl, i) {
        if (!sl) return;
        var hit = -1;
        dst.forEach(function (d, j) { if (hit < 0 && !used[j] && d && d.name === sl.name && fits(sl.type, d.type)) hit = j; });
        dst.forEach(function (d, j) { if (hit < 0 && !used[j] && d && fits(sl.type, d.type)) hit = j; });
        if (hit >= 0) { map[i] = hit; used[hit] = 1; }
      });
      return map;
    }
    var maps = { ia: slotMap(a, b, 'inputs'), ib: slotMap(b, a, 'inputs'), oa: slotMap(a, b, 'outputs'), ob: slotMap(b, a, 'outputs') };
    function mapSlot(n, kind, i) {
      if (n === a) return kind === 'in' ? maps.ia[i] : maps.oa[i];
      if (n === b) return kind === 'in' ? maps.ib[i] : maps.ob[i];
      return i;
    }
    /* every wire that touches either node, read before anything changes */
    var wires = [];
    [a, b].forEach(function (n) {
      (n.inputs || []).forEach(function (inp, i) {
        var l = (inp && inp.link != null) ? linkById(g, inp.link) : null;
        var o = l && g.getNodeById(l.origin_id);
        if (o) wires.push({ o: o, os: l.origin_slot, t: n, ts: i });
      });
      (n.outputs || []).forEach(function (out, j) {
        ((out && out.links) || []).slice().forEach(function (lid) {
          var l = linkById(g, lid);
          var t = l && g.getNodeById(l.target_id);
          if (t && t !== a && t !== b) wires.push({ o: n, os: j, t: t, ts: l.target_slot });
        });
      });
    });
    try { if (g.beforeChange) g.beforeChange(); } catch (e) {}
    wires.forEach(function (w) { try { w.t.disconnectInput(w.ts); } catch (e) {} });
    var pa = [a.pos[0], a.pos[1]], pb = [b.pos[0], b.pos[1]];
    nodeMoveTo(a, pb[0], pb[1]);
    nodeMoveTo(b, pa[0], pa[1]);
    var lost = 0;
    wires.forEach(function (w) {
      var os = mapSlot(w.o, 'out', w.os), ts = mapSlot(w.t, 'in', w.ts), ok = null;
      if (os != null && ts != null) {
        try { ok = twin(w.o).connect(os, twin(w.t), ts); } catch (e) { ok = null; }
      }
      if (!ok) lost++;
    });
    try { if (g.afterChange) g.afterChange(); } catch (e) {}
    hbWiggleNode(a);
    hbWiggleNode(b);
    try { g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus(lost ? 'error' : 'ok', '⇄ Swapped ' + (a.title || a.type) + ' ↔ ' + (b.title || b.type)
      + (lost ? ' · ' + lost + (lost === 1 ? ' wire had' : ' wires had') + ' no matching slot' : ''));
  }

  function hbCreate(type, node) {
    var g = getGraph(), c = getCanvas();
    if (!g) return null;
    var vb = node ? visBox(node) : null;
    var pos = vb ? [vb.x + vb.w + 60, vb.y] : pasteAnchor(c);
    var made = createNodeOrSubgraph(type, pos);
    if (!made) {
      setStatus('error', 'Node type not installed: ' + type);
      return null;
    }
    var wired = wireNodesSmart(node, made, vb);
    try { if (c && c.selectNodes) c.selectNodes([made]); } catch (e) {}
    try { g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⊕ ' + (made.title || made.type) + (wired ? ' (wired → ' + wired + ')' : ' added'));
    return made;
  }

  /* ---------------------------------------------------------------------
   * 8. MODULAR IMAGE & VIDEO NODE KIT (CROP, STITCH, RESIZE, COMPARE...)
   * --------------------------------------------------------------------- */
  var PREVIEW_TYPE = 'PreviewImage';
  var VIDEO_IMG_TYPE = 'GetVideoComponents';
  var CREATE_VIDEO_TYPE = 'CreateVideo';

  function cropType() {
    if (canMake('ImageCropV2') || hasType('ImageCropV2')) return 'ImageCropV2';
    if (canMake('ImageCrop') || hasType('ImageCrop')) return 'ImageCrop';
    return 'ImageCropV2';
  }

  function paintType() {
    if (canMake('Painter') || hasType('Painter')) return 'Painter';
    return '';
  }

  function batchType() {
    if (canMake('ImageFromBatch') || hasType('ImageFromBatch')) return 'ImageFromBatch';
    return '';
  }

  function resizeKinds() {
    var candidates = [
      { type: 'ImageResizeKJv2', label: 'Resize Image v2 (KJ)', why: 'KJNodes resize with aspect/divisible options' },
      { type: 'ImageResize+', label: 'ImageResize+ (Essentials)', why: 'ComfyUI Essentials resize' },
      { type: 'ImageScaleBy', label: 'Upscale Image By', why: 'Core scale by factor' },
      { type: 'ImageScale', label: 'Upscale Image (Core)', why: 'Core exact width/height upscale' }
    ];
    return candidates.filter(function (c) { return (canMake(c.type) || hasType(c.type)) && !isDeprecatedType(c.type); });
  }

  /* Ensures an IMAGE output feed from node (splices GetVideoComponents if VIDEO) */
  function ensureImageFeed(node) {
    if (!node) return null;
    var sImg = imageOutSlot(node);
    if (sImg >= 0) return { node: node, slot: sImg };
    if (isPreviewNode(node)) {
      var orig = imageOrigin(getGraph(), node);
      if (orig && orig.node) return orig;
    }
    var sVid = videoOutSlot(node);
    if (sVid >= 0 && (canMake(VIDEO_IMG_TYPE) || hasType(VIDEO_IMG_TYPE))) {
      var vb = visBox(node);
      var gvc = createNodeOrSubgraph(VIDEO_IMG_TYPE, [vb.x + vb.w + 40, vb.y]);
      if (gvc) {
        try { node.connect(sVid, gvc, 0); } catch (e) {}
        try { gvc.flags = gvc.flags || {}; gvc.flags.collapsed = true; } catch (e) {}
        var gSlot = imageOutSlot(gvc);
        return { node: gvc, slot: gSlot >= 0 ? gSlot : 0 };
      }
    }
    return null;
  }

  function addPreview(node) {
    var feed = ensureImageFeed(node);
    if (!feed) {
      setStatus('error', 'This node has no IMAGE output to preview');
      return null;
    }
    var vb = visBox(node);
    var pv = createNodeOrSubgraph(PREVIEW_TYPE, [vb.x + vb.w + 60, vb.y]);
    if (!pv) return null;
    try { feed.node.connect(feed.slot, pv, 0); } catch (e) {}
    var c = getCanvas(), g = getGraph();
    try { if (c && c.selectNodes) c.selectNodes([pv]); } catch (e) {}
    try { if (g) g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⊞ PreviewImage added');
    return pv;
  }

  function addWiredWithPreview(node, type, label) {
    var feed = ensureImageFeed(node);
    if (!feed) {
      setStatus('error', 'No IMAGE output on this node for ' + (label || type));
      return null;
    }
    var vb = visBox(node);
    var made = createNodeOrSubgraph(type, [vb.x + vb.w + 60, vb.y]);
    if (!made) {
      setStatus('error', 'Node not available: ' + type);
      return null;
    }
    var inSlot = findInSlot(made, /^IMAGE$/i, true);
    if (inSlot >= 0) {
      try { feed.node.connect(feed.slot, made, inSlot); } catch (e) {}
    }
    var outSlot = imageOutSlot(made);
    if (outSlot >= 0 && (canMake(PREVIEW_TYPE) || hasType(PREVIEW_TYPE))) {
      var pv = createNodeOrSubgraph(PREVIEW_TYPE, [vb.x + vb.w + 380, vb.y]);
      if (pv) {
        try { made.connect(outSlot, pv, 0); } catch (e) {}
      }
    }
    var c = getCanvas(), g = getGraph();
    try { if (c && c.selectNodes) c.selectNodes([made]); } catch (e) {}
    try { if (g) g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⊕ ' + (label || made.title || made.type) + ' wired with Preview');
    return made;
  }

  function addCrop(node) {
    return addWiredWithPreview(node, cropType(), 'Crop');
  }

  function addResize(node, specificType) {
    var kinds = resizeKinds();
    var t = specificType || (kinds[0] && kinds[0].type) || 'ImageScale';
    return addWiredWithPreview(node, t, t);
  }

  function addFlip(node) {
    var t = (canMake('ImageFlip') || hasType('ImageFlip')) ? 'ImageFlip' : 'ImageFlip+';
    return addWiredWithPreview(node, t, 'ImageFlip');
  }

  function addPaint(node) {
    var t = paintType();
    if (!t) {
      setStatus('error', 'Painter node is not available on this ComfyUI');
      return null;
    }
    return addWiredWithPreview(node, t, 'Painter');
  }

  function addFromBatch(node) {
    var bt = batchType() || 'ImageFromBatch';
    return addWiredWithPreview(node, bt, 'Framehold (ImageFromBatch)');
  }

  function addVideoComponents(node) {
    if (!node || videoOutSlot(node) < 0) {
      setStatus('error', 'Select a node with a VIDEO output first');
      return null;
    }
    var vb = visBox(node);
    var gvc = createNodeOrSubgraph(VIDEO_IMG_TYPE, [vb.x + vb.w + 60, vb.y]);
    if (!gvc) return null;
    try { node.connect(videoOutSlot(node), gvc, 0); } catch (e) {}
    var c = getCanvas(), g = getGraph();
    try { if (c && c.selectNodes) c.selectNodes([gvc]); } catch (e) {}
    try { if (g) g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⊞ GetVideoComponents wired');
    return gvc;
  }

  function addCreateVideo(node) {
    var feed = ensureImageFeed(node);
    if (!feed) {
      setStatus('error', 'No IMAGE output to convert into video');
      return null;
    }
    var vb = visBox(node);
    var cv = createNodeOrSubgraph(CREATE_VIDEO_TYPE, [vb.x + vb.w + 60, vb.y]);
    if (!cv) {
      setStatus('error', 'CreateVideo node not available');
      return null;
    }
    var inSlot = findInSlot(cv, /^IMAGE$/i, true);
    if (inSlot >= 0) {
      try { feed.node.connect(feed.slot, cv, inSlot); } catch (e) {}
    }
    var c = getCanvas(), g = getGraph();
    try { if (c && c.selectNodes) c.selectNodes([cv]); } catch (e) {}
    try { if (g) g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⊞ CreateVideo wired');
    return cv;
  }

  function addSaveImage(node) {
    var feed = ensureImageFeed(node);
    if (!feed) {
      setStatus('error', 'No IMAGE output to save');
      return null;
    }
    var vb = visBox(node);
    var sv = createNodeOrSubgraph('SaveImage', [vb.x + vb.w + 60, vb.y]);
    if (!sv) return null;
    try { feed.node.connect(feed.slot, sv, 0); } catch (e) {}
    var c = getCanvas(), g = getGraph();
    try { if (c && c.selectNodes) c.selectNodes([sv]); } catch (e) {}
    try { if (g) g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⇩ SaveImage wired');
    return sv;
  }

  function addSaveVideo(node) {
    var g = getGraph(), c = getCanvas();
    if (!node || !g) return null;
    var vb = visBox(node);
    var vSlot = videoOutSlot(node);
    var srcNode = node;
    if (vSlot < 0 && imageOutSlot(node) >= 0 && (canMake(CREATE_VIDEO_TYPE) || hasType(CREATE_VIDEO_TYPE))) {
      var cv = addCreateVideo(node);
      if (cv) {
        srcNode = cv;
        vSlot = videoOutSlot(cv);
        vb = visBox(cv);
      }
    }
    var saveType = (canMake('SaveVideo') || hasType('SaveVideo')) ? 'SaveVideo' : 'VHS_VideoCombine';
    var sv = createNodeOrSubgraph(saveType, [vb.x + vb.w + 60, vb.y]);
    if (!sv) return null;
    if (vSlot >= 0) {
      var inV = findInSlot(sv, /^VIDEO$/i, true);
      if (inV >= 0) { try { srcNode.connect(vSlot, sv, inV); } catch (e) {} }
    } else if (imageOutSlot(node) >= 0) {
      var inI = findInSlot(sv, /^IMAGE$/i, true);
      if (inI >= 0) { try { node.connect(imageOutSlot(node), sv, inI); } catch (e) {} }
    }
    try { if (c && c.selectNodes) c.selectNodes([sv]); } catch (e) {}
    try { g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⇩ ' + saveType + ' wired');
    return sv;
  }

  function addCompare(node) {
    var sel = selNodes();
    var cmpTypes = ['ImageCompare', 'Image Comparer (rgthree)', 'ImageBlend'];
    var cType = '';
    for (var i = 0; i < cmpTypes.length; i++) {
      if (canMake(cmpTypes[i]) || hasType(cmpTypes[i])) { cType = cmpTypes[i]; break; }
    }
    if (!cType) {
      setStatus('error', 'No ImageCompare node found in this ComfyUI');
      return null;
    }
    var nA = null, nB = null;
    if (sel.length >= 2) {
      nA = sel[0]; nB = sel[1];
    } else if (node) {
      nB = node;
      var orig = imageOrigin(getGraph(), node);
      nA = (orig && orig.node) ? orig.node : node;
    }
    if (!nB) return null;
    var vb = visBox(nB);
    var cmp = createNodeOrSubgraph(cType, [vb.x + vb.w + 70, vb.y]);
    if (!cmp) return null;
    var fA = ensureImageFeed(nA);
    var fB = ensureImageFeed(nB);
    var ins = cmp.inputs || [];
    var imgSlots = [];
    for (var j = 0; j < ins.length; j++) {
      if (typeFits('IMAGE', ins[j].type)) imgSlots.push(j);
    }
    if (fA && imgSlots.length > 0) {
      try { fA.node.connect(fA.slot, cmp, imgSlots[0]); } catch (e) {}
    }
    if (fB && imgSlots.length > 1) {
      try { fB.node.connect(fB.slot, cmp, imgSlots[1]); } catch (e) {}
    }
    outGroup('Compare', '#2d4a43', [cmp]);
    var c = getCanvas(), g = getGraph();
    try { if (c && c.selectNodes) c.selectNodes([cmp]); } catch (e) {}
    try { if (g) g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⇄ ' + cType + ' wired');
    return cmp;
  }

  /* Crop & Stitch Helpers */
  var CROP_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
  var CROP_R = {
    '1:1': [1, 1], '16:9': [16, 9], '9:16': [9, 16],
    '4:3': [4, 3], '3:4': [3, 4], '3:2': [3, 2], '2:3': [2, 3], '21:9': [21, 9]
  };
  var CROP_SIZES = ['512px', '768px', '1024px', '1280px', '1536px', '2048px', '1k', '2k', '4k'];

  function cropBox(node) {
    if (!node) return null;
    var reg = widgetNamed(node, 'crop_region');
    if (reg && reg.value && typeof reg.value === 'object') {
      var v = reg.value;
      return {
        x: Math.round(+v.x || 0),
        y: Math.round(+v.y || 0),
        w: Math.max(16, Math.round(+v.width || +v.w || 512)),
        h: Math.max(16, Math.round(+v.height || +v.h || 512))
      };
    }
    var wx = widgetNamed(node, 'x'), wy = widgetNamed(node, 'y');
    var ww = widgetNamed(node, 'width'), wh = widgetNamed(node, 'height');
    if (ww && wh) {
      return {
        x: Math.round(+(wx && wx.value) || 0),
        y: Math.round(+(wy && wy.value) || 0),
        w: Math.max(16, Math.round(+ww.value || 512)),
        h: Math.max(16, Math.round(+wh.value || 512))
      };
    }
    return null;
  }

  function cropRatioOf(w, h) {
    if (!w || !h) return '';
    for (var k in CROP_R) {
      var r = CROP_R[k];
      if (Math.abs((w / h) - (r[0] / r[1])) < 0.02) return k;
    }
    return '';
  }

  function cropSet(node, aspect, sizePreset) {
    var b = cropBox(node);
    if (!b) return false;
    var w = b.w, h = b.h;
    var r = aspect && CROP_R[aspect] ? (CROP_R[aspect][0] / CROP_R[aspect][1]) : (w / h);
    if (sizePreset) {
      var map = { '1k': 1024, '2k': 2048, '4k': 4096 };
      var target = map[sizePreset] || parseInt(sizePreset, 10) || 1024;
      if (r >= 1) { w = target; h = Math.round(target / r); }
      else { h = target; w = Math.round(target * r); }
    } else if (aspect && CROP_R[aspect]) {
      var area = w * h;
      w = Math.round(Math.sqrt(area * r));
      h = Math.round(w / r);
    }
    var nb = { x: b.x, y: b.y, w: Math.max(16, w), h: Math.max(16, h) };
    cropRegionWrite(node, nb);
    setStatus('ok', 'Crop set to ' + nb.w + '×' + nb.h + (aspect ? ' (' + aspect + ')' : ''));
    return true;
  }

  /* ---------------------------------------------------------------------
   * SUPER STITCH (ported from the Nuke2Comfy Scene Manager)
   * One press puts processed crops back into the plate they were cut from:
   *   - a FIT (ImageScale, bicubic, crop disabled) sizes the result back to the crop box first,
   *     because what comes back from a model is the one thing whose size nobody can promise;
   *   - an ImageCompositeMasked pastes it at the crop's x / y with destination = the PLATE;
   *   - several crops of one plate make ONE chain (each stitch pastes into the one before it),
   *     a crop that already has its stitch is never stitched twice, and a preview closes the chain;
   *   - an empty "apinode / localmodel" group marks where the model goes, the rest is grouped "Stitch";
   *   - every stitch keeps following its crop: move or resize the crop and x / y / fit update.
   * Stitches made by the Scene Manager (`_n2c_stitch`) are recognised too.
   * --------------------------------------------------------------------- */
  var STITCH_TYPE = 'ImageCompositeMasked';
  var STITCH_FIT_TYPE = 'ImageScale';
  var STITCH_FIT_FILTER = 'bicubic';
  var STITCH_HOLE_W = 760;

  function inSlotNamed(node, name) {
    var ins = (node && node.inputs) || [];
    for (var i = 0; i < ins.length; i++) {
      if (ins[i] && ins[i].name === name) return i;
    }
    return -1;
  }

  /* The node / slot feeding input `slot` of `node`, or null */
  function inOrigin(graph, node, slot) {
    var inp = node && node.inputs && node.inputs[slot];
    if (!graph || !inp || inp.link == null) return null;
    var l = linkById(graph, inp.link);
    var up = (l && graph.getNodeById) ? graph.getNodeById(l.origin_id) : null;
    return up ? { node: up, slot: l.origin_slot } : null;
  }

  function widgetInt(node, name) {
    var w = widgetNamed(node, name);
    return w ? Math.round(+w.value || 0) : null;
  }

  /* The picture a crop cuts (a preview in between is skipped) */
  function cropPlate(graph, crop) {
    var o = imageOrigin(graph, crop);
    if (o && isPreviewNode(o.node)) o = imageOrigin(graph, o.node) || o;
    return o;
  }

  function stitchMarkOf(st) {
    var p = (st && st.properties) || {};
    if (p._shb_stitch && p._shb_stitch.crop != null) return p._shb_stitch.crop;
    if (p._n2c_stitch && p._n2c_stitch.crop != null) return p._n2c_stitch.crop;
    return p._shb_crop_id != null ? p._shb_crop_id : null;
  }

  /* The crop a stitch takes its box from, or null */
  function stitchCropOf(graph, st) {
    var id = stitchMarkOf(st);
    var c = (id != null && graph && graph.getNodeById) ? graph.getNodeById(id) : null;
    return (c && isCropNode(c)) ? c : null;
  }

  function stitchesOf(graph, crop) {
    return allNodes(graph).filter(function (st) {
      return isStitchNode(st) && String(stitchMarkOf(st)) === String(crop.id);
    });
  }

  /* The fit in front of a stitch's `source`, when it is ours */
  function stitchFitOf(graph, st) {
    var o = inOrigin(graph, st, inSlotNamed(st, 'source'));
    var f = o && o.node;
    if (!f || nodeTypeOf(f) !== STITCH_FIT_TYPE) return null;
    var p = f.properties || {};
    return (p._shb_fit || p._n2c_fit || /^↳ fit to box /.test(String(f.title || ''))) ? f : null;
  }

  /* The end of the chain that already pastes into `plate` (none of ours pastes into it), or null */
  function stitchTail(graph, plate) {
    if (!plate) return null;
    var mine = allNodes(graph).filter(function (st) {
      if (!isStitchNode(st)) return false;
      var c = stitchCropOf(graph, st);
      var o = c && cropPlate(graph, c);
      return !!o && o.node === plate;
    });
    var tails = mine.filter(function (st) {
      return !mine.some(function (o) {
        var d = inOrigin(graph, o, inSlotNamed(o, 'destination'));
        return !!d && d.node === st;
      });
    });
    tails.sort(function (a, b) { return (a.pos[1] - b.pos[1]) || (a.pos[0] - b.pos[0]); });
    return tails.length ? tails[tails.length - 1] : null;
  }

  /* The titles say which input is which: neither slot name tells you which one is the big picture */
  function stitchTitles(st, fit, b) {
    try {
      if (st) st.title = '↱ stitch @ ' + b.x + ',' + b.y + '  ·  destination = the PLATE, source = your result';
      if (fit) fit.title = '↳ fit to box ' + b.w + 'x' + b.h + '  ·  plug your result in here';
    } catch (e) {}
  }

  /* One fit + stitch for `crop`, pasting into `dest` (the plate when null); `src` (optional) feeds the fit */
  function stitchOne(graph, crop, dest, src) {
    var b = cropBox(crop);
    if (!b) return { why: (crop.title || crop.type) + ' has no box to read (no crop_region, no x/y)' };
    var cw = (crop.size && crop.size[0]) || 260;
    var made = createNodeOrSubgraph(STITCH_TYPE, [crop.pos[0] + cw + 340, crop.pos[1]]);
    if (!made) return { why: 'this ComfyUI has no ' + STITCH_TYPE + ' node' };
    made.properties = made.properties || {};
    made.properties._shb_stitch = { crop: crop.id };
    var fit = (canMake(STITCH_FIT_TYPE) || hasType(STITCH_FIT_TYPE))
      ? createNodeOrSubgraph(STITCH_FIT_TYPE, [made.pos[0] - 330, made.pos[1] + 150]) : null;
    if (fit) {
      fit.properties = fit.properties || {};
      fit.properties._shb_fit = { crop: crop.id };
      setWidgetNum(fit, 'width', b.w);
      setWidgetNum(fit, 'height', b.h);
      /* `disabled`, never `center`: cropping here would throw away the very edge the stitch is about */
      setWidgetVal(fit, 'crop', 'disabled');
      setWidgetVal(fit, 'upscale_method', STITCH_FIT_FILTER);
    }
    setWidgetNum(made, 'x', b.x);
    setWidgetNum(made, 'y', b.y);
    stitchTitles(made, fit, b);
    var plate = dest || cropPlate(graph, crop);
    var dslot = inSlotNamed(made, 'destination');
    var wired = false;
    if (plate && dslot >= 0) {
      try { wired = !!plate.node.connect(plate.slot, made, dslot); } catch (e) { wired = false; }
    }
    var sslot = inSlotNamed(made, 'source');
    if (fit && sslot >= 0) {
      try { fit.connect(Math.max(0, imageOutSlot(fit)), made, sslot); } catch (e) {}
    }
    if (src) {
      try {
        if (fit) src.node.connect(src.slot, fit, Math.max(0, findInSlot(fit, /^IMAGE$/i, false)));
        else if (sslot >= 0) src.node.connect(src.slot, made, sslot);
      } catch (e) {}
    }
    return { made: made, fit: fit, box: b, wired: wired, plate: plate };
  }

  /* What a press on `node` puts back: the selected crops, the crop itself, every crop cutting a plate,
     or — on a result fed (through anything) by a crop — that crop, with the result plugged into its fit */
  function stitchTargets(graph, node) {
    var sel = selNodes().filter(isCropNode);
    if (sel.length > 1) return { crops: sel };
    if (node && isCropNode(node)) return { crops: [node] };
    if (node) {
      var cutting = allNodes(graph).filter(function (c) {
        var o = isCropNode(c) && cropPlate(graph, c);
        return !!o && o.node === node;
      });
      if (cutting.length) return { crops: cutting };
      var at = node;
      for (var hops = 0; at && hops < 24; hops++) {
        var o = imageOrigin(graph, at);
        if (!o) break;
        if (isCropNode(o.node)) return { crops: [o.node], src: ensureImageFeed(node) };
        at = o.node;
      }
    }
    return { crops: [] };
  }

  function hasPreviewDownstream(graph, node) {
    var found = false;
    ((node && node.outputs) || []).forEach(function (o) {
      ((o && o.links) || []).forEach(function (lid) {
        var l = linkById(graph, lid);
        var t = (l && graph.getNodeById) ? graph.getNodeById(l.target_id) : null;
        if (t && isPreviewNode(t)) found = true;
      });
    });
    return found;
  }

  /* Lays a new chain out to the right of its crops and boxes it: an empty "apinode / localmodel" hole
     (where the model goes — the one part of the trip this tool cannot build) and "Stitch". When the
     result already exists (gp.src) there is no hole to keep: the chain sits right after that result. */
  function stitchLayout(graph, gp, view) {
    if (gp.tail && gp.tail.pos) {
      var tx = gp.tail.pos[0], ty = gp.tail.pos[1];
      gp.rs.forEach(function (r, i) {
        var y = ty + 420 * (i + 1);
        if (r.fit) nodeMoveTo(r.fit, tx - 360, y);
        nodeMoveTo(r.made, tx, y);
      });
      if (view) nodeMoveTo(view, tx + 360, ty + 420 * gp.rs.length);
      return;
    }
    var x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    gp.crops.forEach(function (c) {
      var b = visBox(c);
      x1 = Math.max(x1, b.x + b.w);
      y0 = Math.min(y0, b.y);
      y1 = Math.max(y1, b.y + b.h);
    });
    if (!isFinite(x1)) return;
    var res = gp.src && gp.src.node && gp.src.node.pos ? visBox(gp.src.node) : null;
    if (res) {
      x1 = Math.max(x1, res.x + res.w);
      y0 = res.y;
      y1 = res.y + res.h;
    }
    var gx = x1 + 120, sx = res ? gx : gx + STITCH_HOLE_W + 120;
    var blockH = Math.max(y1 - y0, gp.rs.length * 420);
    var members = [];
    gp.rs.forEach(function (r) {
      if (r.fit) members.push(r.fit);
      members.push(r.made);
    });
    if (view) members.push(view);
    /* the whole block (hole + fits + stitches + preview) slides down until it covers no other node */
    var others = allNodes(graph).filter(function (n) {
      return n.pos && members.indexOf(n) < 0 && gp.crops.indexOf(n) < 0;
    }).map(visBox);
    for (var guard = 0; guard < 60; guard++) {
      var bx = gx, by = y0 - 62, bw = sx + 720 + 300 - gx, bh = blockH + 62 + 38;
      var hit = null;
      others.forEach(function (o) {
        if (!hit && bx < o.x + o.w && bx + bw > o.x && by < o.y + o.h && by + bh > o.y - 30) hit = o;
      });
      if (!hit) break;
      y0 = hit.y + hit.h + 100;
    }
    gp.rs.forEach(function (r, i) {
      var y = y0 + i * 420;
      if (r.fit) nodeMoveTo(r.fit, sx, y);
      nodeMoveTo(r.made, sx + 360, y);
    });
    if (view) nodeMoveTo(view, sx + 720, y0);
    y1 = y0 + blockH;
    outGroup('Stitch', '#3b2e58', members);
    if (gp.had || res) return;
    var LG = litegraph();
    try {
      var hole = new LG.LGraphGroup();
      hole.configure({
        title: 'apinode / localmodel',
        font_size: 22,
        color: '#5b5f86',
        bounding: [Math.round(gx), Math.round(y0 - 62), STITCH_HOLE_W,
          Math.round(Math.max(y1 - y0, gp.rs.length * 420) + 62 + 38)]
      });
      graph.add(hole);
    } catch (e) {}
  }

  function actStitch(node) {
    var g = getGraph(), c = getCanvas();
    if (!g || !node) return null;
    var tg = stitchTargets(g, node);
    if (!tg.crops.length) {
      setStatus('error', 'Super Stitch: select the crop to put back, the plate it cuts, or the result that came out of it');
      return null;
    }
    if (!(canMake(STITCH_TYPE) || hasType(STITCH_TYPE))) {
      setStatus('error', 'This ComfyUI has no ' + STITCH_TYPE + ' (core node) — nothing was added');
      return null;
    }
    /* one chain per plate, in the order the crops sit on the canvas */
    var groups = [];
    tg.crops.forEach(function (cr) {
      var pl = (cropPlate(g, cr) || {}).node || cr;
      var gp = null;
      groups.forEach(function (x) { if (x.plate === pl) gp = x; });
      if (!gp) { gp = { plate: pl, crops: [], src: tg.src || null }; groups.push(gp); }
      gp.crops.push(cr);
    });
    var all = [], bad = [], had = 0, rewired = 0;
    groups.forEach(function (gp) {
      gp.crops.sort(function (a, b) { return (a.pos[1] - b.pos[1]) || (a.pos[0] - b.pos[0]); });
      gp.rs = [];
      gp.had = 0;
      gp.tail = stitchTail(g, gp.plate);
      var dest = gp.tail ? { node: gp.tail, slot: Math.max(0, imageOutSlot(gp.tail)) } : null;
      gp.crops.forEach(function (cr) {
        /* a crop that already has its stitch is not stitched twice; a result pressed on it is plugged in */
        var old = stitchesOf(g, cr)[0];
        if (old) {
          had++; gp.had++;
          var oldFit = stitchFitOf(g, old);
          if (tg.src && oldFit) {
            try { tg.src.node.connect(tg.src.slot, oldFit, Math.max(0, findInSlot(oldFit, /^IMAGE$/i, false))); rewired++; } catch (e) {}
          }
          if (!dest) dest = { node: old, slot: Math.max(0, imageOutSlot(old)) };
          return;
        }
        var r = stitchOne(g, cr, dest, tg.src);
        if (!r.made) { bad.push(r.why); return; }
        all.push(r);
        gp.rs.push(r);
        dest = { node: r.made, slot: Math.max(0, imageOutSlot(r.made)) };
      });
    });
    if (!all.length) {
      setStatus(rewired || (had && !bad.length) ? 'ok' : 'error', bad[0] || (rewired
        ? '↱ Result plugged into the existing stitch'
        : (had ? 'Already stitched — the stitch follows its crop when you move it' : 'Nothing was added')));
      try { g.setDirtyCanvas(true, true); } catch (e) {}
      return null;
    }
    /* a preview closes every chain */
    var shown = tg.src && tg.src.node ? [tg.src.node] : [];
    groups.forEach(function (gp) {
      if (!gp.rs.length) return;
      var last = gp.rs[gp.rs.length - 1].made;
      var view = null;
      if (!hasPreviewDownstream(g, last) && (canMake(PREVIEW_TYPE) || hasType(PREVIEW_TYPE))) {
        view = createNodeOrSubgraph(PREVIEW_TYPE, [last.pos[0] + 360, last.pos[1]]);
        if (view) {
          try { last.connect(Math.max(0, imageOutSlot(last)), view, 0); } catch (e) {}
          try { view.title = 'stitched · the plate with your result in'; } catch (e) {}
        }
      }
      try { stitchLayout(g, gp, view); } catch (e) {}
      gp.rs.forEach(function (r) { if (r.fit) shown.push(r.fit); shown.push(r.made); });
      if (view) shown.push(view);
    });
    var mades = all.map(function (r) { return r.made; });
    try { if (c && c.selectNodes) c.selectNodes(mades); } catch (e) {}
    try { g.setDirtyCanvas(true, true); } catch (e) {}
    /* the chain is laid out to the right, often past the edge of the screen: bring it (and the result
       it takes) into view, so what was just made is never selected out of sight. A beat later, once
       Nodes 2.0 has drawn the new nodes and their real width can be measured */
    setTimeout(function () { revealNodes(shown); }, 150);
    var b0 = all[0].box;
    setStatus(bad.length ? 'error' : 'ok',
      (all.length > 1 ? '↱ ' + all.length + ' stitches chained' : '↱ Stitch at ' + b0.x + ',' + b0.y)
      + (all[0].wired ? '' : ' · destination NOT wired — plug the plate in')
      + (tg.src ? ' · your result is plugged into the fit' : ' · plug your result into the fit (' + b0.w + '×' + b0.h + ')')
      + (had ? ' · ' + had + ' already stitched, chained after' : '')
      + ' · it follows the crop'
      + (bad.length ? ' · not made: ' + bad[0] : ''));
    return all[0].made;
  }

  /* A stitch (and its fit) set to its crop's box; `did` says whether anything changed */
  function stitchSync(graph, st, crop) {
    var b = cropBox(crop);
    if (!b) return null;
    var did = false;
    if (widgetInt(st, 'x') !== b.x) { setWidgetNum(st, 'x', b.x); did = true; }
    if (widgetInt(st, 'y') !== b.y) { setWidgetNum(st, 'y', b.y); did = true; }
    var fit = stitchFitOf(graph, st);
    if (fit && (widgetInt(fit, 'width') !== b.w || widgetInt(fit, 'height') !== b.h)) {
      setWidgetNum(fit, 'width', b.w);
      setWidgetNum(fit, 'height', b.h);
      stitchTitles(null, fit, b);
      did = true;
    }
    if (did && /^↱ stitch @ /.test(String(st.title || ''))) stitchTitles(st, null, b);
    return { did: did, box: b };
  }

  /* The stitch follows its crop — a few property reads per stitch, a write only when a number differs */
  function stitchFollow() {
    if (!S.useStitch) return;
    var g = getGraph();
    if (!g) return;
    var moved = 0;
    allNodes(g).forEach(function (st) {
      if (!isStitchNode(st)) return;
      var crop = stitchCropOf(g, st);
      var sy = crop ? stitchSync(g, st, crop) : null;
      if (sy && sy.did) moved++;
    });
    if (moved && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
  }
  every(1500, stitchFollow);

  function actStitchUpdate(node) {
    var g = getGraph();
    if (!g || !node) return false;
    var pairs = [];
    if (isStitchNode(node)) {
      var cr = stitchCropOf(g, node);
      if (cr) pairs.push([node, cr]);
    } else if (isCropNode(node)) {
      stitchesOf(g, node).forEach(function (st) { pairs.push([st, node]); });
    }
    if (!pairs.length) {
      setStatus('error', isCropNode(node) ? 'This crop has no stitch yet — Super Stitch makes it' : 'No crop is paired with this stitch');
      return false;
    }
    var did = 0, b = null;
    pairs.forEach(function (p) {
      var sy = stitchSync(g, p[0], p[1]);
      if (sy) { b = sy.box; if (sy.did) did++; }
    });
    try { g.setDirtyCanvas(true, true); } catch (e) {}
    if (!b) {
      setStatus('error', 'Update stitch: the crop has no box to read');
      return false;
    }
    setStatus('ok', did
      ? '⟳ Stitch updated to the crop: @ ' + b.x + ',' + b.y + ' · fit ' + b.w + '×' + b.h
      : 'The stitch already matched the crop (@ ' + b.x + ',' + b.y + ' · ' + b.w + '×' + b.h + ')');
    return true;
  }

  function actStitchSwap(stitch) {
    var g = getGraph();
    if (!g || !isStitchNode(stitch)) return false;
    var ins = stitch.inputs || [];
    if (ins.length < 2) return false;
    var l0 = ins[0].link != null ? linkById(g, ins[0].link) : null;
    var l1 = ins[1].link != null ? linkById(g, ins[1].link) : null;
    var n0 = l0 && g.getNodeById ? g.getNodeById(l0.origin_id) : null;
    var n1 = l1 && g.getNodeById ? g.getNodeById(l1.origin_id) : null;
    var s0 = l0 ? l0.origin_slot : 0, s1 = l1 ? l1.origin_slot : 0;
    try { stitch.disconnectInput(0); stitch.disconnectInput(1); } catch (e) {}
    try { if (n1) n1.connect(s1, stitch, 0); } catch (e) {}
    try { if (n0) n0.connect(s0, stitch, 1); } catch (e) {}
    try { g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⇄ Swapped destination & source on Stitch');
    return true;
  }

  /* Reroute, Set & Get */
  function addReroute(node) {
    var made = hbCreate('Reroute', node);
    if (made) setStatus('ok', 'KN Reroute added');
    return made;
  }

  function setGetName(node) {
    var w = (node && node.widgets && node.widgets[0]) || null;
    return w ? String(w.value || '') : '';
  }

  function setNameOn(node, val) {
    var w = (node && node.widgets && node.widgets[0]) || null;
    if (!w) return false;
    try {
      w.value = val;
      if (w.callback) w.callback(val, null, node);
      /* the node may have made the name unique (NAME_0): the title follows what it kept */
      node.title = (isSetNode(node) ? 'Set_' : 'Get_') + (w.value || val);
      return true;
    } catch (e) { return false; }
  }

  function setNames() {
    var out = [];
    allNodes(getGraph()).forEach(function (n) {
      if (isSetNode(n)) {
        var nm = setGetName(n);
        if (nm && out.indexOf(nm) < 0) out.push(nm);
      }
    });
    return out;
  }

  function addSetNode(node) {
    var t = (canMake('SetNode') || hasType('SetNode')) ? 'SetNode'
      : ((canMake('easy setNode') || hasType('easy setNode')) ? 'easy setNode' : '');
    if (!t) {
      setStatus('error', 'SetNode (KJNodes / Easy-Use) is not installed');
      return null;
    }
    var made = hbCreate(t, node);
    if (made && node) {
      var base = String(node.title || node.type || 'wire').replace(/\s+/g, '_');
      setNameOn(made, base);
    }
    return made;
  }

  function addGetNode(node) {
    var t = (canMake('GetNode') || hasType('GetNode')) ? 'GetNode'
      : ((canMake('easy getNode') || hasType('easy getNode')) ? 'easy getNode' : '');
    if (!t) {
      setStatus('error', 'GetNode (KJNodes / Easy-Use) is not installed');
      return null;
    }
    var made = hbCreate(t, null);
    if (made && node && isSetNode(node)) {
      var nm = setGetName(node);
      if (nm) setNameOn(made, nm);
    }
    return made;
  }

  /* Get for a bus by name, dropped where the hotbox was opened (the Canvas card lists every Set) */
  function addGetNamed(nm) {
    var t = (canMake('GetNode') || hasType('GetNode')) ? 'GetNode'
      : ((canMake('easy getNode') || hasType('easy getNode')) ? 'easy getNode' : '');
    if (!t) {
      setStatus('error', 'GetNode (KJNodes / Easy-Use) is not installed');
      return null;
    }
    var p = clientToGraph(HB.anchorX || HB_MX, HB.anchorY || HB_MY);
    var made = createNodeOrSubgraph(t, [p[0] - 60, p[1] - 15]);
    if (!made) return null;
    setNameOn(made, nm);
    var c = getCanvas(), g = getGraph();
    try { if (c && c.selectNodes) c.selectNodes([made]); } catch (e) {}
    try { if (g) g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⊕ Get_' + nm);
    return made;
  }

  /* The wire color of a Set's bus, for the dot beside its Get row */
  function setBusColor(nm) {
    var c = getCanvas(), LGC = window.LGraphCanvas || (window.comfyAPI && window.comfyAPI.litegraph && window.comfyAPI.litegraph.LGraphCanvas);
    var type = '';
    allNodes(getGraph()).forEach(function (n) {
      if (!type && isSetNode(n) && setGetName(n) === nm) type = String((n.inputs && n.inputs[0] && n.inputs[0].type) || '');
    });
    var map = (c && c.default_connection_color_byType) || (LGC && LGC.link_type_colors) || {};
    return (type && type !== '*' && map[type]) || '';
  }

  /* G: groups the selection (or the node under the hotbox) through ComfyUI's own Group Selected Nodes, so
     its padding setting and title editor apply; the group is named from what it holds, like a saved button */
  function actGroup(node) {
    var g = getGraph(), c = getCanvas(), app = getApp();
    if (!g || !c) return null;
    var list = selNodes();
    if (!list.length && node) {
      try { c.selectNodes([node]); } catch (e) {}
      list = [node];
    }
    if (!list.length) {
      setStatus('error', 'Select the nodes to group');
      return null;
    }
    var name = mgSmartName(list, list);
    var before = (g._groups || g.groups || []).slice();
    function fresh() {
      return (g._groups || g.groups || []).filter(function (gr) { return before.indexOf(gr) < 0; })[0] || null;
    }
    function named(gr) {
      try { gr.title = name; } catch (e) {}
      try { g.setDirtyCanvas(true, true); } catch (e) {}
      setStatus('ok', '▢ Grouped ' + list.length + (list.length === 1 ? ' node' : ' nodes') + ' · "' + name + '"');
      return gr;
    }
    function byHand() {
      var LG = litegraph();
      if (!LG || !LG.LGraphGroup) return null;
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, PAD = 10, HEAD = 46;
      list.forEach(function (n) {
        var b = hbTitledBox(n);
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
      });
      var gr = new LG.LGraphGroup();
      gr.configure({ title: name, bounding: [x0 - PAD, y0 - PAD - HEAD, x1 - x0 + PAD * 2, y1 - y0 + PAD * 2 + HEAD] });
      g.add(gr);
      try { gr.recomputeInsideNodes(); } catch (e) {}
      return named(gr);
    }
    var cmd = app && app.extensionManager && app.extensionManager.command;
    var run = null;
    try { if (cmd && cmd.execute) run = cmd.execute('Comfy.Graph.GroupSelectedNodes'); } catch (e) { run = null; }
    var made = fresh();
    if (made) return named(made);
    if (run && run.then) {
      run.then(function () { var gr = fresh(); if (gr) named(gr); else byHand(); });
      return null;
    }
    return byHand();
  }

  function actSetInherit(node) {
    if (!isSetNode(node)) return false;
    var orig = imageOrigin(getGraph(), node);
    if (!orig || !orig.node) {
      setStatus('error', 'Connect an input into this Set node first');
      return false;
    }
    var nm = String(orig.node.title || orig.node.type || 'wire').replace(/\s+/g, '_');
    setNameOn(node, nm);
    var g = getGraph();
    if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
    setStatus('ok', 'Set named "' + nm + '"');
    return true;
  }

  /* ---------------------------------------------------------------------
   * 9. LOAD IN CANVAS (Alt+R) & PNG METADATA READERS
   * --------------------------------------------------------------------- */
  function producedImages(node) {
    if (!node) return [];
    var app = getApp();
    var out = [];
    try {
      var no = app && app.nodeOutputs && app.nodeOutputs[node.id];
      if (no && Array.isArray(no.images)) {
        no.images.forEach(function (im) {
          if (im && im.filename) out.push(im);
        });
      }
    } catch (e) {}
    if (!out.length && Array.isArray(node.images)) {
      node.images.forEach(function (im) {
        if (im && im.filename) out.push(im);
      });
    }
    if (!out.length && isLoader(node)) {
      var w = widgetNamed(node, 'image');
      if (w && typeof w.value === 'string' && w.value) {
        out.push({ filename: w.value, type: 'input', subfolder: '' });
      }
    }
    return out;
  }

  /* The video a node is showing right now (Save Video, Video Combine, …), or null */
  var VIDEO_FILE_RE = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;
  function producedVideo(node) {
    if (!node) return null;
    var app = getApp();
    var out = null;
    try {
      var no = app && app.nodeOutputs && app.nodeOutputs[node.id];
      if (no) {
        (no.gifs || []).concat(no.videos || [], no.images || []).forEach(function (m) {
          if (!out && m && m.filename && VIDEO_FILE_RE.test(m.filename)) out = m;
        });
      }
    } catch (e) {}
    return out;
  }

  /* Load in Canvas just hands a render to a new loader: Save / Preview Image → Load Image,
     Save Video → Load Video. The file is copied into input/ so the new node owns its own copy. */
  function actLoadInCanvas(node) {
    var tgt = node || hbNode();
    if (!tgt) {
      setStatus('error', 'Select or point at a node holding an image or a video first');
      return Promise.resolve(null);
    }
    var vid = producedVideo(tgt);
    var loadType = 'LoadImage', loadWidget = 'image';
    if (vid) {
      if (canMake('LoadVideo') || hasType('LoadVideo')) { loadType = 'LoadVideo'; loadWidget = 'file'; }
      else if (canMake('VHS_LoadVideo') || hasType('VHS_LoadVideo')) { loadType = 'VHS_LoadVideo'; loadWidget = 'video'; }
      else {
        setStatus('error', 'This ComfyUI has no Load Video node');
        return Promise.resolve(null);
      }
    }
    var ims = vid ? [vid] : producedImages(tgt);
    var imgUrl = ims.length ? viewURL(ims[0]) : '';
    if (!imgUrl && tgt.imgs && tgt.imgs[0] && tgt.imgs[0].src) {
      imgUrl = tgt.imgs[0].src;
    }
    if (!imgUrl) {
      try {
        var domImgs = document.querySelectorAll('[data-node-id="' + tgt.id + '"] img');
        for (var di = 0; di < domImgs.length; di++) {
          if (domImgs[di].src && (domImgs[di].naturalWidth > 16 || domImgs[di].width > 16)) {
            imgUrl = domImgs[di].src;
            break;
          }
        }
      } catch (e) {}
    }
    if (!imgUrl) {
      setStatus('error', 'This node has no rendered/preview image yet — run the workflow first');
      return Promise.resolve(null);
    }
    var what = vid ? 'video' : 'image';
    setStatus('busy', 'Loading ' + what + ' into canvas…');
    return fetch(imgUrl)
      .then(function (r) {
        if (!r.ok) throw new Error('Could not read the ' + what + ' (HTTP ' + r.status + ')');
        return r.blob();
      })
      .then(function (blob) {
        var fd = new FormData();
        var base = (ims[0] && ims[0].filename)
          ? String(ims[0].filename).replace(/\.[^.]+$/, '')
          : String(tgt.title || tgt.type || 'canvas').replace(/\W+/g, '_');
        var ext = vid ? String(vid.filename).match(VIDEO_FILE_RE)[0] : '.png';
        fd.append('image', blob, base + '_' + Date.now() + ext);
        fd.append('type', 'input');
        return apiFetch('/upload/image', { method: 'POST', body: fd });
      })
      .then(function (r) {
        if (!r || !r.ok) throw new Error('Upload to /upload/image failed');
        return r.json();
      })
      .then(function (j) {
        var val = (j.subfolder ? j.subfolder + '/' : '') + j.name;
        var vb = visBox(tgt);
        var made = createNodeOrSubgraph(loadType, [vb.x, vb.y + vb.h + 90]);
        if (!made) throw new Error('Could not create a ' + loadType + ' node');
        setWidgetVal(made, loadWidget, val);
        var stem = String(j.name || '').replace(/\.[^.]+$/, '');
        var G = outGroup('INPUT  ' + stem, '#234264', [made]);
        var c = getCanvas(), g = getGraph();
        try {
          if (c && c.selectItems && G) c.selectItems([made, G]);
          else if (c && c.selectNodes) c.selectNodes([made]);
        } catch (e) {}
        try { if (g) g.setDirtyCanvas(true, true); } catch (e) {}
        setStatus('ok', '↓ Loaded in canvas (' + loadType + '): ' + j.name);
        return made;
      })
      .catch(function (err) {
        setStatus('error', 'Load in Canvas failed: ' + msgOf(err));
        return null;
      });
  }

  /* PNG tEXt Chunk Reader for Workflow / Seed / Rebuild Node */
  function readPngChunks(node) {
    var ims = producedImages(node);
    var url = ims.length ? viewURL(ims[0]) : '';
    if (!url && node && node.imgs && node.imgs[0] && node.imgs[0].src) url = node.imgs[0].src;
    if (!url) return Promise.reject(new Error('No image found on this node'));
    return fetch(url)
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) {
        var u8 = new Uint8Array(buf);
        var dv = new DataView(buf);
        if (u8[0] !== 0x89 || u8[1] !== 0x50) throw new Error('Not a PNG file');
        var out = {};
        var off = 8;
        var dec = new TextDecoder('utf-8');
        while (off + 8 <= u8.length) {
          var len = dv.getUint32(off);
          var type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
          var dataStart = off + 8;
          if (type === 'tEXt' && dataStart + len <= u8.length) {
            var nul = dataStart;
            while (nul < dataStart + len && u8[nul] !== 0) nul++;
            var key = dec.decode(u8.subarray(dataStart, nul));
            var val = dec.decode(u8.subarray(nul + 1, dataStart + len));
            try { out[key] = JSON.parse(val); } catch (e) { out[key] = val; }
          }
          off += 12 + len;
        }
        return out;
      });
  }

  function actExtractSeed(node) {
    readPngChunks(node).then(function (meta) {
      var prompt = meta.prompt || {};
      var found = [];
      Object.keys(prompt).forEach(function (k) {
        var ins = (prompt[k] && prompt[k].inputs) || {};
        ['seed', 'noise_seed'].forEach(function (sk) {
          if (ins[sk] !== undefined) found.push(ins[sk]);
        });
      });
      if (!found.length) {
        setStatus('error', 'No seed metadata found in this PNG');
        return;
      }
      var seedStr = String(found[0]);
      try { navigator.clipboard.writeText(seedStr); } catch (e) {}
      setStatus('ok', '◎ Seed ' + seedStr + ' copied to clipboard');
    }).catch(function (err) {
      setStatus('error', msgOf(err));
    });
  }

  function actImageWorkflow(node) {
    readPngChunks(node).then(function (meta) {
      if (!meta.workflow) {
        setStatus('error', 'No embedded ComfyUI workflow found in this PNG');
        return;
      }
      var app = getApp();
      if (app && typeof app.loadGraphData === 'function') {
        var blob = new Blob([JSON.stringify(meta.workflow, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'extracted_workflow_' + Date.now() + '.json';
        a.click();
        setStatus('ok', '⌗ Workflow JSON downloaded from PNG metadata');
      }
    }).catch(function (err) {
      setStatus('error', msgOf(err));
    });
  }

  /* ---------------------------------------------------------------------
   * 10. NODE COLOR PALETTE & NATIVE NODE ACTIONS
   * --------------------------------------------------------------------- */
  var NODE_PALETTE = [
    { name: 'Default',   color: '',        bgcolor: '',        dot: '#888888' },
    { name: 'Cyan',      color: '#223333', bgcolor: '#335555', dot: '#4da3a3' },
    { name: 'Teal Dark', color: '#0f2e2a', bgcolor: '#153d38', dot: '#2a9d8f' },
    { name: 'Blue',      color: '#222233', bgcolor: '#333355', dot: '#567bc4' },
    { name: 'Pale Blue', color: '#2a363b', bgcolor: '#3f5159', dot: '#6798b0' },
    { name: 'Green',     color: '#223322', bgcolor: '#335533', dot: '#4d9a60' },
    { name: 'Yellow',    color: '#443322', bgcolor: '#665533', dot: '#c4a64d' },
    { name: 'Brown',     color: '#332922', bgcolor: '#593930', dot: '#a87556' },
    { name: 'Red',       color: '#332222', bgcolor: '#553333', dot: '#c65a5a' },
    { name: 'Purple',    color: '#332233', bgcolor: '#553355', dot: '#9a5ca8' },
    { name: 'Black',     color: '#222222', bgcolor: '#000000', dot: '#444444' }
  ];

  /* Hotbox swatches: dot color + node header tint (first entry clears the color) */
  var HB_SWATCHES = [
    { name: 'Default', color: '',        bgcolor: '',        dot: '#9a9a9a' },
    { name: 'Red',     color: '#3d2523', bgcolor: '#4d302d', dot: '#d26b5f' },
    { name: 'Amber',   color: '#3b3121', bgcolor: '#4b3f2a', dot: '#d6a74c' },
    { name: 'Green',   color: '#213a2b', bgcolor: '#2a4a37', dot: '#5db07d' },
    { name: 'Blue',    color: '#20324a', bgcolor: '#29405e', dot: '#5f97d6' },
    { name: 'Purple',  color: '#2f2645', bgcolor: '#3c3158', dot: '#9378d6' },
    { name: 'Pink',    color: '#3d2335', bgcolor: '#4d2d44', dot: '#cc6ea9' }
  ];

  function barTint(uid) {
    var name = S.customColors && S.customColors[uid];
    for (var i = 1; name && i < HB_SWATCHES.length; i++) if (HB_SWATCHES[i].name === name) return HB_SWATCHES[i].dot;
    return '';
  }

  function barTintAttrs(uid) {
    var c = barTint(uid);
    var fill = c && S.customFill && S.customFill[uid];
    return c ? { cls: ' shb-tinted' + (fill ? ' shb-filled' : ''), style: ' style="--shb-tint:' + esc(c) + '"' } : { cls: '', style: '' };
  }

  function actCollapseNode(node) {
    var list = selNodes();
    if (node && list.indexOf(node) < 0) list = [node];
    if (!list.length) return;
    list.forEach(function (n) {
      try { if (typeof n.collapse === 'function') n.collapse(); } catch (e) {}
    });
    var g = getGraph();
    if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
  }

  function actDeleteNode(node) {
    var g = getGraph(), c = getCanvas();
    if (!g) return;
    var list = selNodes();
    if (node && list.indexOf(node) < 0) list = [node];
    if (!list.length) return;
    list.forEach(function (n) {
      try { g.remove(n); } catch (e) {}
    });
    if (c && c.deselectAllNodes) {
      try { c.deselectAllNodes(); } catch (e) {}
    }
    if (g.setDirtyCanvas) g.setDirtyCanvas(true, true);
    setStatus('ok', 'Deleted ' + list.length + ' node' + (list.length > 1 ? 's' : ''));
  }

  function applyNodeColor(node, swatch) {
    var list = selNodes();
    if (node && list.indexOf(node) < 0) list = [node];
    if (!list.length || !swatch) return;
    list.forEach(function (n) {
      try {
        if (!swatch.color) {
          delete n.color;
          delete n.bgcolor;
        } else {
          n.color = swatch.color;
          n.bgcolor = swatch.bgcolor || swatch.color;
        }
      } catch (e) {}
    });
    var g = getGraph();
    if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
    setStatus('ok', 'Node color: ' + (swatch.name || swatch.color));
  }

  function actRenameNode(node) {
    var tgt = node || hbNode();
    if (!tgt) {
      setStatus('error', 'Select or point at a node to rename');
      return;
    }
    var bg = owns(document.createElement('div'));
    bg.className = 'shb-modal-bg';
    var cur = String(tgt.title || tgt.type || '');
    bg.innerHTML =
      '<div class="shb-modal" style="width:min(380px,92vw)">' +
        '<div class="shb-modal-t"><span>Rename Node</span></div>' +
        '<input class="shb-input" data-rn-in value="' + esc(cur) + '" placeholder="Node title…">' +
        '<div style="display:flex;justify-content:flex-end;gap:8px">' +
          '<button class="shb-btn" data-rn-cancel>Cancel</button>' +
          '<button class="shb-btn shb-btn-pri" data-rn-ok>Rename</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bg);
    var inp = bg.querySelector('[data-rn-in]');
    function close() { if (bg.parentNode) bg.parentNode.removeChild(bg); }
    function commit() {
      var v = String(inp.value || '').trim();
      if (v) {
        try { tgt.title = v; } catch (e) {}
        var g = getGraph();
        if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
        setStatus('ok', 'Renamed to "' + v + '"');
      }
      close();
    }
    bg.addEventListener('mousedown', function (ev) { if (ev.target === bg) close(); });
    bg.querySelector('[data-rn-cancel]').onclick = close;
    bg.querySelector('[data-rn-ok]').onclick = commit;
    inp.onkeydown = function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    };
    try { inp.focus(); inp.select(); } catch (e) {}
  }

  /* ---------------------------------------------------------------------
   * 11. LABEL STUDIO (Alt+N) — rgthree / label node / MarkdownNote / Group
   * --------------------------------------------------------------------- */
  var LABEL_RG_TYPE = 'Label (rgthree)';
  var LABEL_PIX_TYPE = 'PixaromaLabel';
  var LABEL_PIX_FONT = "'Segoe UI Semibold', 'Segoe UI', 'Noto Sans', 'DejaVu Sans', sans-serif";
  var LABEL_FONTS = [LABEL_PIX_FONT, 'Arial', 'Helvetica', 'Verdana', 'Georgia', 'Courier New', 'Impact'];
  var LABEL_COLORS = [
    { bg: '#f66744', fg: '#ffffff' },
    { bg: '#3d7cc9', fg: '#ffffff' },
    { bg: '#2a9d8f', fg: '#ffffff' },
    { bg: '#8a5cc7', fg: '#ffffff' },
    { bg: '#3f9a4f', fg: '#ffffff' },
    { bg: '#c9921a', fg: '#ffffff' },
    { bg: '#c0392b', fg: '#ffffff' },
    { bg: '#252830', fg: '#ffffff' },
    { bg: '#EDEDED', fg: '#111111' }
  ];
  var LABEL_EDGES = [
    { k: 'square', label: 'Square', f: 0 },
    { k: 'semi',   label: 'Semi',   f: 0.4 },
    { k: 'round',  label: 'Round',  f: 1.0 }
  ];
  var LABEL_ICONS = [
    { g: '⬇', name: 'download' }, { g: '⚙︎', name: 'settings' }, { g: '◷', name: 'time' },
    { g: '✎', name: 'prompt' },   { g: '⊞', name: 'nodes' },    { g: 'ℹ︎', name: 'info' },
    { g: '⚠︎', name: 'warn' },     { g: '✓', name: 'done' },     { g: '★', name: 'star' },
    { g: '▶︎', name: 'render' },   { g: '▣', name: 'image' },    { g: '✦', name: 'idea' }
  ];

  var LB = {
    on: false, node: null, editing: null, text: '',
    size: 72, font: LABEL_PIX_FONT, ci: 0, pad: 20, edge: 'semi', shine: true
  };

  function labelIsRg(n) {
    return !!n && String(n.type || n.comfyClass || '') === LABEL_RG_TYPE;
  }

  function labelBox(o) {
    var pad = +o.pad >= 0 ? +o.pad : 20;
    var lines = String(o.text || '').split('\n');
    var w = 0;
    try {
      var c = labelBox._c || (labelBox._c = document.createElement('canvas'));
      var x = c.getContext('2d');
      x.font = Math.max(o.size || 40, 1) + 'px ' + (o.font || 'Arial');
      lines.forEach(function (s) { w = Math.max(w, x.measureText(s).width); });
    } catch (e) {
      w = (String(o.text || '').length || 1) * (o.size || 40) * 0.55;
    }
    return [Math.round(w + pad * 2), Math.round((o.size || 40) * lines.length + pad * 2)];
  }

  function labelShineDraw(n, ctx) {
    var p = n.properties || {};
    if (!p._shb_shine || !p.backgroundColor || p.backgroundColor === 'transparent') return;
    var w = +(n.size && n.size[0]) || 0, h = +(n.size && n.size[1]) || 0;
    if (!(w > 0 && h > 0)) return;
    var r = Math.min(Math.max(0, Number(p.borderRadius) || 0), h / 2);
    var lw = Math.max(1, h * 0.03);
    ctx.save();
    ctx.globalAlpha *= 0.18;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(Math.max(r, lw), lw / 2);
    ctx.lineTo(w - Math.max(r, lw), lw / 2);
    ctx.stroke();
    ctx.restore();
  }

  function labelShine(n) {
    if (!labelIsRg(n) || n._shbShine) return false;
    var base = n.draw;
    if (typeof base !== 'function') return false;
    n.draw = function (ctx) {
      var v = base.apply(this, arguments);
      try { labelShineDraw(this, ctx); } catch (e) {}
      return v;
    };
    n._shbShine = true;
    return true;
  }

  every(1500, function () {
    allNodes(getGraph()).forEach(function (n) {
      if (n && n.properties && n.properties._shb_shine) labelShine(n);
    });
  });

  function labelApplyRg(n, o) {
    try { n.title = String(o.text || ''); } catch (e) {}
    try {
      n.properties = n.properties || {};
      n.properties.fontSize = o.size;
      n.properties.fontFamily = o.font;
      n.properties.fontColor = o.fg;
      n.properties.backgroundColor = o.bg;
      if (n.properties.textAlign == null) n.properties.textAlign = 'center';
      if (n.properties.angle == null) n.properties.angle = 0;
      n.properties.padding = Math.round(+o.pad || 20);
      n.properties.borderRadius = Math.max(0, Math.round(+o.radius || 0));
      n.properties._shb_shine = o.shine === false ? 0 : 1;
    } catch (e) {}
    try { labelShine(n); } catch (e) {}
    try { n.color = '#fff0'; n.bgcolor = '#fff0'; } catch (e) {}
    try { n.flags = n.flags || {}; n.flags.allow_interaction = true; } catch (e) {}
    try { n.size = labelBox(o); } catch (e) {}
  }

  function labelFallback(o, refNode) {
    var g = getGraph(), c = getCanvas();
    if (!g) return;
    var pos = (refNode && refNode.pos) ? [refNode.pos[0], refNode.pos[1] - 110] : pasteAnchor(c);
    if (canMake(LABEL_PIX_TYPE)) {
      var pix = createNodeOrSubgraph(LABEL_PIX_TYPE, pos);
      if (pix) {
        var json = JSON.stringify({
          text: String(o.text || ''),
          fontSize: o.size, fontFamily: 'Arial', fontColor: o.fg,
          textAlign: 'left', backgroundColor: o.bg, padding: o.pad,
          borderRadius: o.radius, opacity: 1, fontWeight: 'bold', lineHeight: 1
        });
        setWidgetVal(pix, 'label_json', json);
        try { pix.flags = pix.flags || {}; pix.flags.no_title = true; pix.color = 'rgba(0,0,0,0)'; pix.bgcolor = 'rgba(0,0,0,0)'; } catch (e) {}
        g.setDirtyCanvas(true, true);
        setStatus('ok', 'Label added');
        return;
      }
    }
    var noteType = canMake('MarkdownNote') ? 'MarkdownNote' : (canMake('Note') ? 'Note' : '');
    if (noteType) {
      var nt = createNodeOrSubgraph(noteType, pos);
      if (nt) {
        var txt = noteType === 'MarkdownNote' ? ('# ' + o.text) : String(o.text);
        setWidgetVal(nt, 'text', txt);
        if (nt.widgets && nt.widgets[0]) nt.widgets[0].value = txt;
        nt.title = String(o.text);
        nt.color = o.bg;
        nt.bgcolor = o.bg;
        nt.size = [Math.max(280, o.text.length * 16), 95];
        g.setDirtyCanvas(true, true);
        setStatus('ok', 'Label added (' + noteType + ')');
        return;
      }
    }
    var LG = litegraph();
    if (LG && LG.LGraphGroup) {
      var G = new LG.LGraphGroup();
      G.configure({
        title: String(o.text),
        font_size: Math.min(64, o.size),
        color: o.bg,
        bounding: [pos[0], pos[1], Math.max(260, o.text.length * 22 + 60), 74]
      });
      g.add(G);
      g.setDirtyCanvas(true, true);
      setStatus('ok', 'Label added as Group Banner');
    }
  }

  function labelOpen(node) {
    var tgt = labelIsRg(node) ? node : null;
    if (!tgt) {
      selNodes().forEach(function (n) { if (!tgt && labelIsRg(n)) tgt = n; });
    }
    LB.editing = tgt;
    LB.node = node || selectedOne() || null;
    if (tgt) {
      var p = tgt.properties || {};
      LB.text = String(tgt.title || '');
      LB.size = +p.fontSize || 72;
      LB.font = String(p.fontFamily || LABEL_PIX_FONT);
      LB.pad = p.padding != null ? (+p.padding || 0) : 20;
      var bg = String(p.backgroundColor || '').toLowerCase();
      LABEL_COLORS.forEach(function (col, i) { if (col.bg.toLowerCase() === bg) LB.ci = i; });
      LB.shine = p._shb_shine == null ? true : !!p._shb_shine;
    } else if (S.lbLast) {
      LB.text = '';
      LB.size = S.lbLast.size || 72;
      LB.font = S.lbLast.font || LABEL_PIX_FONT;
      LB.ci = S.lbLast.ci || 0;
      LB.pad = S.lbLast.pad != null ? S.lbLast.pad : 20;
      LB.edge = S.lbLast.edge || 'semi';
      LB.shine = S.lbLast.shine !== false;
    } else {
      LB.text = '';
    }
    LB.on = true;

    var old = document.getElementById(PANEL_ID + '-lb');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var wrap = owns(document.createElement('div'));
    wrap.id = PANEL_ID + '-lb';
    wrap.className = 'shb-modal-bg';
    wrap.innerHTML =
      '<div class="shb-modal">' +
        '<div class="shb-modal-t">' +
          '<span>' + (LB.editing ? '✎ Edit Label' : '🏷️ Add Canvas Label (Alt+N)') + '</span>' +
          '<span style="font-size:11px;color:#8b949e" data-lb-dim></span>' +
        '</div>' +
        '<div class="shb-grid">' +
          '<label>Text</label>' +
          '<input class="shb-input" data-lb-text value="' + esc(LB.text) + '" placeholder="Section Title / Plate v01…">' +
          '<label>Size & Font</label>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<input type="range" min="14" max="260" step="2" value="' + LB.size + '" data-lb-size style="flex:1;accent-color:#2f81f7">' +
            '<span data-lb-sizev style="min-width:44px;font:11.5px monospace">' + LB.size + 'px</span>' +
            '<select class="shb-select" data-lb-font style="width:155px">' +
              LABEL_FONTS.map(function (f) {
                var nm = f === LABEL_PIX_FONT ? 'Segoe UI' : f;
                return '<option value="' + esc(f) + '"' + (f === LB.font ? ' selected' : '') + '>' + esc(nm) + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<label>Color</label>' +
          '<div class="shb-swatches" data-lb-colors>' +
            LABEL_COLORS.map(function (c, i) {
              return '<i class="shb-swatch' + (i === LB.ci ? ' shb-on' : '') + '" data-lbc="' + i + '" style="background:' + c.bg + '" title="' + c.bg + '"></i>';
            }).join('') +
          '</div>' +
          '<label>Corners</label>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<span class="shb-seg" data-lb-edges>' +
              LABEL_EDGES.map(function (e) {
                return '<button type="button" data-lbe="' + e.k + '"' + (e.k === LB.edge ? ' class="shb-on"' : '') + '>' + esc(e.label) + '</button>';
              }).join('') +
            '</span>' +
            '<button type="button" class="shb-btn' + (LB.shine ? ' shb-btn-pri' : '') + '" data-lb-shine>✦ Top Shine</button>' +
          '</div>' +
          '<label>Spacing</label>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<input type="range" min="0" max="80" step="2" value="' + LB.pad + '" data-lb-pad style="flex:1;accent-color:#2f81f7">' +
            '<span data-lb-padv style="min-width:44px;font:11.5px monospace">' + LB.pad + 'px</span>' +
          '</div>' +
          '<label>Quick Icon</label>' +
          '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap" data-lb-icons>' +
            '<button type="button" class="shb-btn" data-lbi="" style="padding:3px 7px">∅</button>' +
            LABEL_ICONS.map(function (ic) {
              return '<button type="button" class="shb-btn" data-lbi="' + esc(ic.g) + '" title="' + esc(ic.name) + '" style="padding:3px 7px">' + ic.g + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="shb-lb-prev" data-lb-prev><span></span></div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px">' +
          '<button class="shb-btn" data-lb-cancel>Cancel</button>' +
          '<button class="shb-btn shb-btn-pri" data-lb-ok>' + (LB.editing ? 'Apply' : 'Add Label') + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(wrap);

    function currentOpts() {
      var col = LABEL_COLORS[LB.ci] || LABEL_COLORS[0];
      var ef = 0.4;
      LABEL_EDGES.forEach(function (e) { if (e.k === LB.edge) ef = e.f; });
      var o = {
        text: LB.text, size: +LB.size || 72, font: LB.font,
        bg: col.bg, fg: col.fg, pad: +LB.pad || 0, edge: LB.edge, shine: LB.shine
      };
      var bx = labelBox(o);
      o.rmax = Math.max(1, Math.round(bx[1] / 2));
      o.radius = Math.round(o.rmax * ef);
      o.box = bx;
      return o;
    }

    function updatePreview() {
      var o = currentOpts();
      wrap.querySelector('[data-lb-sizev]').textContent = o.size + 'px';
      wrap.querySelector('[data-lb-padv]').textContent = o.pad + 'px';
      wrap.querySelector('[data-lb-dim]').textContent = o.box[0] + ' × ' + o.box[1] + ' px';
      var pv = wrap.querySelector('[data-lb-prev]');
      pv.style.background = o.bg;
      pv.style.boxShadow = o.shine ? 'inset 0 2px 0 rgba(255,255,255,.22)' : 'none';
      var fs = Math.max(13, Math.min(34, o.size / 2.4));
      var sp = pv.firstChild;
      sp.textContent = o.text || 'Preview Label';
      sp.style.cssText = 'color:' + o.fg + ';font-family:' + o.font + ';font-weight:700;font-size:' + fs + 'px;opacity:' + (o.text ? 1 : 0.45);
      pv.style.borderRadius = (o.edge === 'round' ? '999px' : (o.edge === 'semi' ? '12px' : '2px'));
    }

    function close() {
      LB.on = false;
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    function commit() {
      var o = currentOpts();
      if (!LB.editing && !String(o.text || '').trim()) {
        setStatus('error', 'Please enter text for the label');
        return;
      }
      S.lbLast = { size: o.size, font: o.font, ci: LB.ci, pad: o.pad, edge: o.edge, shine: o.shine };
      save();
      var editing = LB.editing, refNode = LB.node;
      close();
      if (editing) {
        labelApplyRg(editing, o);
        var g = getGraph();
        if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
        setStatus('ok', 'Label updated');
        return;
      }
      if (canMake(LABEL_RG_TYPE)) {
        var pos = (refNode && refNode.pos) ? [refNode.pos[0], refNode.pos[1] - 110] : pasteAnchor(getCanvas());
        var made = createNodeOrSubgraph(LABEL_RG_TYPE, pos);
        if (made) {
          labelApplyRg(made, o);
          var g2 = getGraph();
          if (g2 && g2.setDirtyCanvas) g2.setDirtyCanvas(true, true);
          setStatus('ok', 'Label added: "' + o.text + '"');
          return;
        }
      }
      labelFallback(o, refNode);
    }

    var inp = wrap.querySelector('[data-lb-text]');
    inp.oninput = function () { LB.text = inp.value; updatePreview(); };
    inp.onkeydown = function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    };
    wrap.querySelector('[data-lb-size]').oninput = function () { LB.size = +this.value; updatePreview(); };
    wrap.querySelector('[data-lb-pad]').oninput = function () { LB.pad = +this.value; updatePreview(); };
    wrap.querySelector('[data-lb-font]').onchange = function () { LB.font = this.value; updatePreview(); };
    wrap.querySelector('[data-lb-colors]').onclick = function (ev) {
      var sw = ev.target.closest('[data-lbc]');
      if (!sw) return;
      LB.ci = +sw.getAttribute('data-lbc');
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-lbc]'), function (el, i) {
        el.className = 'shb-swatch' + (i === LB.ci ? ' shb-on' : '');
      });
      updatePreview();
    };
    wrap.querySelector('[data-lb-edges]').onclick = function (ev) {
      var b = ev.target.closest('[data-lbe]');
      if (!b) return;
      LB.edge = b.getAttribute('data-lbe');
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-lbe]'), function (el) {
        el.className = el.getAttribute('data-lbe') === LB.edge ? 'shb-on' : '';
      });
      updatePreview();
    };
    var shBtn = wrap.querySelector('[data-lb-shine]');
    shBtn.onclick = function () {
      LB.shine = !LB.shine;
      shBtn.className = 'shb-btn' + (LB.shine ? ' shb-btn-pri' : '');
      updatePreview();
    };
    wrap.querySelector('[data-lb-icons]').onclick = function (ev) {
      var b = ev.target.closest('[data-lbi]');
      if (!b) return;
      var ic = b.getAttribute('data-lbi');
      var clean = String(LB.text || '').replace(/^[^\w\s]+\s*/, '');
      LB.text = ic ? (ic + ' ' + clean) : clean;
      inp.value = LB.text;
      updatePreview();
      inp.focus();
    };
    wrap.querySelector('[data-lb-cancel]').onclick = close;
    wrap.querySelector('[data-lb-ok]').onclick = commit;
    wrap.addEventListener('mousedown', function (ev) { if (ev.target === wrap) close(); });
    updatePreview();
    try { inp.focus(); inp.select(); } catch (e) {}
  }

  /* Label bar: with a Label (rgthree) under the hotbox, Label Studio's controls ride the Context bar and
     change the label live (the Nuke2Comfy builder's label strip) */
  function labelRead(n) {
    var p = n.properties || {};
    var o = {
      text: String(n.title || ''), size: +p.fontSize || 72, font: String(p.fontFamily || LABEL_PIX_FONT),
      bg: String(p.backgroundColor || LABEL_COLORS[0].bg), fg: String(p.fontColor || LABEL_COLORS[0].fg),
      pad: p.padding != null ? (+p.padding || 0) : 20, shine: p._shb_shine == null ? true : !!p._shb_shine
    };
    var half = Math.round(labelBox(o)[1] / 2), r = +p.borderRadius || 0;
    o.edge = r < 1 ? 'square' : (r >= half - 1 ? 'round' : 'semi');
    return o;
  }

  var LB_SAVE = 0;

  function labelWrite(n, o) {
    var ef = 0.4, ci = 0;
    LABEL_EDGES.forEach(function (e) { if (e.k === o.edge) ef = e.f; });
    o.radius = Math.round(Math.max(1, Math.round(labelBox(o)[1] / 2)) * ef);
    labelApplyRg(n, o);
    var g = getGraph();
    if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
    /* the next new label starts from this look */
    LABEL_COLORS.forEach(function (c, i) { if (c.bg.toLowerCase() === String(o.bg).toLowerCase()) ci = i; });
    S.lbLast = { size: o.size, font: o.font, ci: ci, pad: o.pad, edge: o.edge, shine: o.shine };
    clearTimeout(LB_SAVE);
    LB_SAVE = setTimeout(save, 700);
  }

  /* A quick icon is the label's leading symbol, as Label Studio writes it */
  function labelIconOf(text) {
    var m = String(text || '').match(/^([^\w\s]+)\s/);
    return m ? m[1] : '';
  }

  function hbLabelBarItems(node) {
    if (!labelIsRg(node)) return [];
    var o = labelRead(node);
    function set(k, v) {
      var cur = labelRead(node);
      cur[k] = v;
      labelWrite(node, cur);
    }
    var bgNow = o.bg.toLowerCase(), icon = labelIconOf(o.text);
    return [
      { type: 'text', label: 'Label', value: o.text, width: 160, placeholder: 'Label text', title: 'Label text (live) · Enter to finish',
        onChange: function (v) { set('text', v); } },
      { type: 'swatches', title: 'Label color', colors: LABEL_COLORS.map(function (c) { return c.bg; }),
        value: (LABEL_COLORS.filter(function (c) { return c.bg.toLowerCase() === bgNow; })[0] || {}).bg || '',
        onChange: function (bg) {
          var cur = labelRead(node);
          LABEL_COLORS.forEach(function (c) { if (c.bg === bg) { cur.bg = c.bg; cur.fg = c.fg; } });
          labelWrite(node, cur);
        } },
      { type: 'select', title: 'Quick icon at the start of the label', value: icon, display: (icon || '◇') + ' icon',
        options: [{ value: '', label: '∅  none' }].concat(LABEL_ICONS.map(function (ic) { return { value: ic.g, label: ic.g + '  ' + ic.name }; })),
        onChange: function (gl) {
          var clean = labelRead(node).text.replace(/^[^\w\s]+\s*/, '');
          set('text', gl ? gl + ' ' + clean : clean);
        } },
      { type: 'toggle', label: '✦', title: 'Top shine', value: o.shine, onChange: function (v) { set('shine', v); } },
      { type: 'segment', title: 'Corners', value: o.edge, options: LABEL_EDGES.map(function (e) { return { value: e.k, label: e.label }; }),
        onChange: function (v) { set('edge', v); } },
      { type: 'range', label: 'Size', min: 14, max: 260, step: 2, unit: 'px', value: o.size, onChange: function (v) { set('size', v); } },
      { type: 'range', label: 'Spacing', min: 0, max: 80, step: 2, unit: 'px', value: o.pad, onChange: function (v) { set('pad', v); } },
      { type: 'select', title: 'Font', value: o.font, display: 'Aa  ' + (o.font === LABEL_PIX_FONT ? 'Segoe UI' : o.font.split(',')[0].replace(/['"]/g, '')),
        options: LABEL_FONTS.map(function (f) { return { value: f, label: f === LABEL_PIX_FONT ? 'Segoe UI' : f }; }),
        onChange: function (f) { set('font', f); } }
    ];
  }

  /* ---------------------------------------------------------------------
   * 12. DOT CAMERA ZOOM ("." Hotkey)
   * --------------------------------------------------------------------- */
  var NZ = { prev: null, key: '' };

  function nzKey(nodes) {
    return (nodes || []).map(function (n) { return n.id; }).sort().join(',');
  }

  function nodesBounds(nodes) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    (nodes || []).forEach(function (node) {
      var b = null;
      try { b = node.boundingRect || (node.getBounding && node.getBounding()); } catch (e) { b = null; }
      if (!b || !(+b[2] > 0) || !(+b[3] > 0)) {
        var p = node.pos || [0, 0], sz = node.size || [300, 200];
        b = [p[0], p[1] - 30, sz[0], sz[1] + 30];
      }
      x0 = Math.min(x0, +b[0]); y0 = Math.min(y0, +b[1]);
      x1 = Math.max(x1, +b[0] + +b[2]); y1 = Math.max(y1, +b[1] + +b[3]);
    });
    return isFinite(x0) ? [x0, y0, x1 - x0, y1 - y0] : null;
  }

  /* Brings nodes into view after a tool lays them out. Nothing moves when they are already on screen; a pan
     when they fit at this zoom; a zoom-out, centered on them, only when they do not. */
  function revealNodes(nodes) {
    /* measured from pos and size (visBox), since a node that was just moved has not redrawn its bounds yet */
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    (nodes || []).forEach(function (n) {
      if (!n || !n.pos) return;
      var v = visBox(n);
      x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y - 32);
      x1 = Math.max(x1, v.x + v.w); y1 = Math.max(y1, v.y + v.h);
    });
    var c = getCanvas(), ds = c && c.ds, b = isFinite(x0) ? [x0, y0, x1 - x0, y1 - y0] : null;
    if (!c || !ds || !ds.offset || !b) return;
    var el = c.canvas;
    var W = (el && (el.clientWidth || el.width)) || window.innerWidth;
    var H = (el && (el.clientHeight || el.height)) || window.innerHeight;
    /* room for the side bar on the left and the top bar above */
    var mL = 90, mR = 50, mT = 110, mB = 70;
    var s0 = ds.scale, ox0 = ds.offset[0], oy0 = ds.offset[1];
    var l = (b[0] + ox0) * s0, t = (b[1] + oy0) * s0, r = l + b[2] * s0, bt = t + b[3] * s0;
    if (l >= mL && t >= mT && r <= W - mR && bt <= H - mB) return;
    var s1 = Math.min(s0, (W - mL - mR) / b[2], (H - mT - mB) / b[3]);
    var ox1 = ox0, oy1 = oy0;
    if (s1 < s0) {
      ox1 = (mL + (W - mL - mR) / 2) / s1 - (b[0] + b[2] / 2);
      oy1 = (mT + (H - mT - mB) / 2) / s1 - (b[1] + b[3] / 2);
    } else {
      if (l < mL) ox1 += (mL - l) / s0;
      else if (r > W - mR) ox1 -= (r - (W - mR)) / s0;
      if (t < mT) oy1 += (mT - t) / s0;
      else if (bt > H - mB) oy1 -= (bt - (H - mB)) / s0;
    }
    var t0 = 0, dur = 280;
    function step(now) {
      if (!t0) t0 = now;
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      ds.scale = s0 + (s1 - s0) * e;
      ds.offset[0] = ox0 + (ox1 - ox0) * e;
      ds.offset[1] = oy0 + (oy1 - oy0) * e;
      try { c.setDirty(true, true); } catch (er) {}
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function actDotZoom(explicitNode) {
    var sel = selNodes();
    if (!sel.length && explicitNode) sel = [explicitNode];
    var c = getCanvas();
    var ds = c && c.ds;
    if (!c || !ds || !ds.offset) return false;
    if (NZ.prev && (!sel.length || nzKey(sel) === NZ.key)) {
      var p = NZ.prev;
      NZ.prev = null; NZ.key = '';
      ds.scale = p.scale;
      ds.offset[0] = p.offset[0];
      ds.offset[1] = p.offset[1];
      try { c.setDirty(true, true); } catch (e) {}
      setStatus('ok', '⌖ Camera returned to previous view');
      return true;
    }
    if (!sel.length) return false;
    var b = nodesBounds(sel);
    if (!b) return false;
    var home = NZ.prev || { scale: ds.scale, offset: [ds.offset[0], ds.offset[1]] };
    var done = false;
    try {
      if (c.animateToBounds) {
        c.animateToBounds(b, { zoom: 0.90, duration: 220 });
        done = true;
      }
    } catch (e) { done = false; }
    if (!done) {
      var el = c.canvas;
      var vw = (el && (el.clientWidth || el.width)) || window.innerWidth;
      var vh = (el && (el.clientHeight || el.height)) || window.innerHeight;
      var sc = Math.min(vw * 0.88 / b[2], vh * 0.88 / b[3]);
      ds.scale = sc;
      ds.offset[0] = vw / (2 * sc) - (b[0] + b[2] / 2);
      ds.offset[1] = vh / (2 * sc) - (b[1] + b[3] / 2);
    }
    NZ.prev = home;
    NZ.key = nzKey(sel);
    try { c.setDirty(true, true); } catch (e) {}
    setStatus('ok', '⌖ Zoomed to ' + (sel.length === 1 ? (sel[0].title || sel[0].type) : sel.length + ' nodes')
      + ' — press "." again to return');
    return true;
  }

  /* L: arrange the selection as Nuke's L does. Wired nodes go into columns that follow the wires (each one a
     column right of the furthest node feeding it), in the order of what feeds them, each wire as straight as
     its column allows; nodes with no wires between them line up in a row or a column, whichever they are
     closer to already. The selection keeps its top-left corner. One node lines up with the node that feeds it
     (or, with nothing wired in, with the one it feeds). Pinned nodes stay put; Ctrl+Z undoes it */
  var ARR = { GX: 90, GY: 40, raf: 0 };

  /* how far below the node's top a slot sits, in graph units */
  function arrSlotY(n, isIn, slot) {
    try {
      var p = n.getConnectionPos ? n.getConnectionPos(isIn, slot)
        : (isIn ? n.getInputPos(slot) : n.getOutputPos(slot));
      if (p && isFinite(p[1])) return p[1] - n.pos[1];
    } catch (e) {}
    var LG = litegraph();
    return (slot + 0.7) * ((LG && LG.NODE_SLOT_HEIGHT) || 20);
  }

  function arrPlan(g, sel) {
    var LG = litegraph(), TH = (LG && LG.NODE_TITLE_HEIGHT) || 30;
    var ids = {}, box = {}, to = {}, wires = [];
    sel.forEach(function (n) { ids[n.id] = n; box[n.id] = visBox(n); });
    sel.forEach(function (t) {
      (t.inputs || []).forEach(function (inp, ts) {
        var l = (inp && inp.link != null) ? linkById(g, inp.link) : null;
        if (l && ids[l.origin_id] && ids[l.origin_id] !== t) wires.push({ o: ids[l.origin_id], os: l.origin_slot, t: t, ts: ts });
      });
    });
    var x0 = Math.min.apply(null, sel.map(function (n) { return n.pos[0]; }));
    var y0 = Math.min.apply(null, sel.map(function (n) { return n.pos[1]; }));

    if (sel.length === 1) {
      var n = sel[0], w = null;
      (n.inputs || []).some(function (inp, ts) {
        var l = (inp && inp.link != null) ? linkById(g, inp.link) : null, o = l && g.getNodeById(l.origin_id);
        if (o) w = { o: o, os: l.origin_slot, ts: ts };
        return !!w;
      });
      if (w) { to[n.id] = [n.pos[0], w.o.pos[1] + arrSlotY(w.o, false, w.os) - arrSlotY(n, true, w.ts)]; return to; }
      (n.outputs || []).some(function (out, os) {
        return ((out && out.links) || []).some(function (lid) {
          var l = linkById(g, lid), t = l && g.getNodeById(l.target_id);
          if (t) w = { t: t, ts: l.target_slot, os: os };
          return !!w;
        });
      });
      if (w) to[n.id] = [n.pos[0], w.t.pos[1] + arrSlotY(w.t, true, w.ts) - arrSlotY(n, false, w.os)];
      return to;
    }

    if (!wires.length) {
      /* a row or a column on the top (left) edge, each node where it was along it, pushed on only if it would overlap */
      var b = nodesBounds(sel), row = b[2] >= b[3], cur = -Infinity;
      sel.slice().sort(function (a, c) { return row ? a.pos[0] - c.pos[0] : a.pos[1] - c.pos[1]; }).forEach(function (n) {
        if (row) { cur = Math.max(n.pos[0], cur); to[n.id] = [cur, y0]; cur += box[n.id].w + ARR.GX; }
        else { cur = Math.max(n.pos[1], cur); to[n.id] = [x0, cur]; cur += box[n.id].h + TH + ARR.GY; }
      });
      return to;
    }

    var feeds = {}, depth = {};
    sel.forEach(function (n) { feeds[n.id] = []; });
    wires.forEach(function (w) { feeds[w.t.id].push(w); });
    function dep(n, path) {
      if (depth[n.id] != null) return depth[n.id];
      if (path[n.id]) return 0;
      path[n.id] = 1;
      var d = 0;
      feeds[n.id].forEach(function (w) { d = Math.max(d, dep(w.o, path) + 1); });
      delete path[n.id];
      return (depth[n.id] = d);
    }
    sel.forEach(function (n) { dep(n, {}); });
    var cols = [];
    sel.forEach(function (n) { (cols[depth[n.id]] = cols[depth[n.id]] || []).push(n); });
    var x = x0;
    cols.forEach(function (col, d) {
      if (!col) return;
      var want = {}, floor = d ? -Infinity : y0, wmax = 0;
      col.forEach(function (n) {
        /* straighten the wire from the nearest column that feeds it */
        var ws = feeds[n.id].slice().sort(function (a, c) { return depth[c.o.id] - depth[a.o.id] || a.ts - c.ts; });
        want[n.id] = ws.length && to[ws[0].o.id]
          ? to[ws[0].o.id][1] + arrSlotY(ws[0].o, false, ws[0].os) - arrSlotY(n, true, ws[0].ts)
          : n.pos[1];
      });
      col.sort(function (a, c) { return want[a.id] - want[c.id] || a.pos[1] - c.pos[1]; });
      col.forEach(function (n) {
        var y = d ? Math.max(want[n.id], floor) : floor;
        to[n.id] = [x, y];
        floor = y + box[n.id].h + TH + ARR.GY;
        wmax = Math.max(wmax, box[n.id].w);
      });
      x += wmax + ARR.GX;
    });
    return to;
  }

  function actArrange(explicitNode) {
    var g = getGraph();
    if (!g) return false;
    var sel = selNodes();
    if (!sel.length && explicitNode) sel = [explicitNode];
    sel = sel.filter(function (n) { return n && n.pos && !(n.flags && n.flags.pinned); });
    if (!sel.length) return false;
    var to = arrPlan(g, sel), moved = sel.filter(function (n) {
      var t = to[n.id];
      return t && (Math.abs(t[0] - n.pos[0]) > 0.5 || Math.abs(t[1] - n.pos[1]) > 0.5);
    });
    if (!moved.length) {
      setStatus('ok', sel.length === 1 && !to[sel[0].id] ? 'Nothing wired to line it up with' : '≡ Already arranged');
      return false;
    }
    var from = {}, c = getCanvas();
    moved.forEach(function (n) { from[n.id] = [n.pos[0], n.pos[1]]; });
    if (ARR.raf) return false;
    /* one change for undo however many frames it slides: the canvas event holds ComfyUI's history until the end */
    try { if (c && c.emitBeforeChange) c.emitBeforeChange(); } catch (e) {}
    try { if (g.beforeChange) g.beforeChange(); } catch (e) {}
    var t0 = performance.now(), D = 180;
    (function step(now) {
      var u = Math.min(1, Math.max(0, (now - t0) / D)), k = u * u * (3 - 2 * u);
      moved.forEach(function (n) {
        var a = from[n.id], b = to[n.id];
        nodeMoveTo(n, a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k);
      });
      try { g.setDirtyCanvas(true, true); } catch (e) {}
      if (u < 1) { ARR.raf = requestAnimationFrame(step); return; }
      ARR.raf = 0;
      try { if (g.afterChange) g.afterChange(); } catch (e) {}
      try { if (c && c.emitAfterChange) c.emitAfterChange(); } catch (e) {}
    })(t0);
    setStatus('ok', '≡ Arranged ' + (sel.length === 1 ? (sel[0].title || sel[0].type) : sel.length + ' nodes'));
    return true;
  }

  /* ---------------------------------------------------------------------
   * 13. ALT+Z POWER SUITE: LUPA (PROMPT), VISUAL CROP & PAINT STUDIO
   * --------------------------------------------------------------------- */
  var LUPA = { el: null, ta: null, src: null, w: null, node: null, drag: null };
  var LUPA_SIZES = [16, 20, 26, 34, 44];
  var LUPA_BOXES = [
    ['720px', '62vw', '460px', '60vh'],
    ['980px', '88vw', '640px', '74vh'],
    ['1400px', '94vw', '880px', '86vh'],
    ['9999px', '98vw', '9999px', '94vh']
  ];
  var LUPA_BOX_NAMES = ['Small', 'Medium', 'Large', 'Full Screen'];

  function lupaPx() {
    var i = parseInt(S.lupaSize, 10);
    return LUPA_SIZES[(i >= 0 && i < LUPA_SIZES.length) ? i : 1];
  }

  function lupaBoxIdx() {
    var i = parseInt(S.lupaBox, 10);
    return (i >= 0 && i < LUPA_BOXES.length) ? i : 1;
  }

  function lupaBoxSize(box) {
    var m = /^(\d+)x(\d+)$/.exec(String(S.lupaWH || ''));
    if (m) {
      box.style.width = 'min(' + m[1] + 'px,99vw)';
      box.style.height = 'min(' + m[2] + 'px,98vh)';
      return;
    }
    var b = LUPA_BOXES[lupaBoxIdx()];
    box.style.width = 'min(' + b[0] + ',' + b[1] + ')';
    box.style.height = 'min(' + b[2] + ',' + b[3] + ')';
  }

  function lupaWidget(node) {
    var ws = (node && node.widgets) || [];
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (!w || typeof w.value !== 'string') continue;
      var el = w.element || w.inputEl;
      if ((el && String(el.tagName || '').toUpperCase() === 'TEXTAREA')
          || w.type === 'customtext'
          || (w.options && w.options.multiline)
          || /prompt|text/i.test(w.name || '')) return w;
    }
    return null;
  }

  function lupaTarget() {
    var a = document.activeElement;
    if (a && String(a.tagName || '').toUpperCase() === 'TEXTAREA'
        && (!LUPA.el || !LUPA.el.contains(a))) {
      return { ta: a };
    }
    var u = null;
    try { u = document.elementFromPoint(HB_MX, HB_MY); } catch (e) { u = null; }
    var t = u && u.closest ? u.closest('textarea') : null;
    if (t && (!LUPA.el || !LUPA.el.contains(t))) return { ta: t };
    var n = hbNode();
    var w = lupaWidget(n);
    if (!w) return null;
    var el = w.element || w.inputEl;
    if (!(el && String(el.tagName || '').toUpperCase() === 'TEXTAREA')) {
      try {
        el = document.querySelector('[data-node-id="' + n.id + '"] textarea');
      } catch (e) { el = null; }
    }
    return { ta: el || null, w: w, node: n };
  }

  function lupaWrite(v) {
    var src = LUPA.src;
    if (src) {
      try {
        src.value = v;
        src.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (e) {}
    }
    if (LUPA.w && (!src || LUPA.w.value !== v)) {
      try { LUPA.w.value = v; } catch (e) {}
      try { if (LUPA.w.callback) LUPA.w.callback(v); } catch (e) {}
    }
    var g = getGraph();
    if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
  }

  function lupaClose() {
    var el = LUPA.el, src = LUPA.src, ta = LUPA.ta;
    var at = ta ? [ta.selectionStart, ta.selectionEnd] : null;
    LUPA.el = null; LUPA.ta = null; LUPA.src = null; LUPA.w = null; LUPA.node = null; LUPA.drag = null;
    try { if (el) el.remove(); } catch (e) {}
    if (src) {
      try {
        src.focus();
        if (at) src.setSelectionRange(at[0], at[1]);
      } catch (e) {}
    }
  }

  function lupaOpen(t) {
    if (!t) t = lupaTarget();
    if (!t || (!t.ta && !t.w)) {
      setStatus('error', 'No prompt or multiline text widget found on this node');
      return;
    }
    var src = t.ta || null;
    var text = src ? String(src.value || '') : String((t.w && t.w.value) || '');
    var who = t.node ? (t.node.title || t.node.type || '') : '';
    var wrap = owns(document.createElement('div'));
    wrap.className = 'shb-modal-bg';
    var box = document.createElement('div');
    box.style.cssText = 'position:relative;display:flex;flex-direction:column;background:var(--shb-bg,#222222);border:1px solid var(--shb-border,#3c3c3c);border-radius:8px;overflow:hidden;box-shadow:0 12px 36px rgba(0,0,0,.6)';
    lupaBoxSize(box);

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #333333;background:var(--shb-bg,#222222);font:500 12px/1.3 Inter,system-ui,sans-serif;color:var(--shb-fg-muted,#9a9a9a)';
    var cap = document.createElement('span');
    cap.style.cssText = 'flex:1;display:inline-flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--shb-fg,#e2e2e2)';
    cap.innerHTML = ico('lupa') + '<span>Magnifier' + (who ? ' · ' + esc(who) : '') + ' <span style="color:#777">(Alt+Z or Esc)</span></span>';

    var boxes = document.createElement('span');
    boxes.style.cssText = 'display:flex;align-items:center;gap:4px';
    var sizes = document.createElement('span');
    sizes.style.cssText = 'display:flex;align-items:center;gap:4px';

    var ta = document.createElement('textarea');
    ta.spellcheck = true;
    ta.value = text;
    ta.style.cssText = 'flex:1;border:0;outline:0;resize:none;margin:0;padding:18px 22px;background:#181818;color:var(--shb-fg,#e2e2e2);font:400 ' + lupaPx() + 'px/1.55 Inter,-apple-system,Segoe UI,sans-serif';

    function paintBoxes() {
      var custom = /^\d+x\d+$/.test(String(S.lupaWH || ''));
      Array.prototype.forEach.call(boxes.children, function (b, i) {
        var on = !custom && i === lupaBoxIdx();
        b.style.background = on ? '#383838' : '#262626';
        b.style.borderColor = on ? '#5c94f0' : '#3c3c3c';
        b.style.color = on ? '#ffffff' : '#9a9a9a';
      });
    }
    LUPA_BOX_NAMES.forEach(function (nm, i) {
      var b = document.createElement('button');
      b.textContent = nm.charAt(0);
      b.title = 'Window size: ' + nm;
      b.style.cssText = 'border:1px solid #3c3c3c;border-radius:5px;width:26px;height:24px;cursor:pointer;font:600 11px Inter,system-ui,sans-serif';
      b.onclick = function (ev) {
        ev.stopPropagation();
        S.lupaBox = i; S.lupaWH = ''; save();
        lupaBoxSize(box); paintBoxes();
        try { ta.focus(); } catch (e) {}
      };
      boxes.appendChild(b);
    });
    paintBoxes();

    function paintSizes() {
      Array.prototype.forEach.call(sizes.children, function (b, i) {
        var on = LUPA_SIZES[i] === lupaPx();
        b.style.background = on ? '#383838' : '#262626';
        b.style.borderColor = on ? '#5c94f0' : '#3c3c3c';
        b.style.color = on ? '#ffffff' : '#9a9a9a';
      });
    }
    LUPA_SIZES.forEach(function (px, i) {
      var b = document.createElement('button');
      b.textContent = 'A';
      b.title = 'Font size: ' + px + 'px';
      b.style.cssText = 'border:1px solid #3c3c3c;border-radius:5px;width:26px;height:24px;cursor:pointer;font:600 ' + (10 + i * 2.5) + 'px Inter,system-ui,sans-serif';
      b.onclick = function (ev) {
        ev.stopPropagation();
        S.lupaSize = i; save();
        ta.style.fontSize = px + 'px'; paintSizes();
        try { ta.focus(); } catch (e) {}
      };
      sizes.appendChild(b);
    });
    paintSizes();

    var done = document.createElement('button');
    done.className = 'shb-btn shb-btn-pri';
    done.textContent = 'Done';
    done.onclick = lupaClose;

    head.appendChild(cap);
    head.appendChild(boxes);
    head.appendChild(sizes);
    head.appendChild(done);
    box.appendChild(head);
    box.appendChild(ta);

    var grip = document.createElement('div');
    grip.title = 'Drag to resize window';
    grip.style.cssText = 'position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:2;background:linear-gradient(135deg,transparent 52%,#6e7681 52%,#6e7681 62%,transparent 62%,transparent 74%,#6e7681 74%,#6e7681 84%,transparent 84%)';
    grip.onmousedown = function (e) {
      e.preventDefault(); e.stopPropagation();
      var r = box.getBoundingClientRect();
      LUPA.drag = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    };
    box.appendChild(grip);

    wrap.addEventListener('mousemove', function (e) {
      var d = LUPA.drag;
      if (!d) return;
      var vw = window.innerWidth || 1600, vh = window.innerHeight || 900;
      var w = Math.max(420, Math.min(vw * 0.99, d.w + 2 * (e.clientX - d.x)));
      var h = Math.max(240, Math.min(vh * 0.98, d.h + 2 * (e.clientY - d.y)));
      box.style.width = Math.round(w) + 'px';
      box.style.height = Math.round(h) + 'px';
    });
    wrap.addEventListener('mouseup', function () {
      if (!LUPA.drag) return;
      LUPA.drag = null;
      var w = parseInt(box.style.width, 10), h = parseInt(box.style.height, 10);
      if (w > 0 && h > 0) { S.lupaWH = w + 'x' + h; save(); paintBoxes(); }
    });

    wrap.appendChild(box);
    document.body.appendChild(wrap);
    LUPA.el = wrap; LUPA.ta = ta; LUPA.src = src; LUPA.w = t.w || null; LUPA.node = t.node || null;

    ta.oninput = function () { lupaWrite(ta.value); };
    ta.onkeydown = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); lupaClose(); return; }
      e.stopPropagation();
    };
    wrap.addEventListener('mousedown', function (e) {
      if (!box.contains(e.target)) { e.preventDefault(); lupaClose(); }
    });
    try { ta.focus(); } catch (e) {}
  }

  /* Visual Crop Editor (Alt+Z on Crop Node) */
  var CE = { el: null, node: null, orig: null, box: null, W: 0, H: 0, lock: null, drag: null, fit: null };
  var CE_MIN = 16;

  function cropImgSrc(crop) {
    var best = null;
    try {
      var host = document.querySelector('[data-node-id="' + crop.id + '"]');
      var reg = widgetNamed(crop, 'crop_region');
      [host, reg && (reg.element || reg.inputEl)].forEach(function (r) {
        if (!r || !r.querySelectorAll) return;
        Array.prototype.forEach.call(r.querySelectorAll('img'), function (im) {
          if (im.src && im.naturalWidth > 0 && (!best || im.naturalWidth > best.naturalWidth)) best = im;
        });
      });
    } catch (e) { best = null; }
    if (best) return best.src;
    var orig = imageOrigin(getGraph(), crop);
    if (orig && orig.node) {
      var ims = producedImages(orig.node);
      if (ims.length) return viewURL(ims[0]);
      if (orig.node.imgs && orig.node.imgs[0] && orig.node.imgs[0].src) return orig.node.imgs[0].src;
    }
    return '';
  }

  function cropRegionWrite(node, b) {
    var reg = widgetNamed(node, 'crop_region');
    if (reg && reg.value && typeof reg.value === 'object') {
      var nv = { x: b.x, y: b.y, width: b.w, height: b.h };
      try { reg.value = nv; } catch (e) {}
      try { if (reg.callback) reg.callback(nv, null, node); } catch (e) {}
    }
    setWidgetNum(node, 'x', b.x);
    setWidgetNum(node, 'y', b.y);
    setWidgetNum(node, 'width', b.w);
    setWidgetNum(node, 'height', b.h);
    /* Auto-sync any paired Stitch node (and its fit) */
    var g = getGraph();
    stitchesOf(g, node).forEach(function (st) { stitchSync(g, st, node); });
    if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
  }

  function ceClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function ceResize(b0, dir, dx, dy, W, H, ratio) {
    var x0 = b0.x, y0 = b0.y, x1 = b0.x + b0.w, y1 = b0.y + b0.h;
    var hasW = dir.indexOf('w') >= 0, hasE = dir.indexOf('e') >= 0;
    var hasN = dir.indexOf('n') >= 0, hasS = dir.indexOf('s') >= 0;
    if (hasW) x0 = ceClamp(x0 + dx, 0, x1 - CE_MIN);
    if (hasE) x1 = ceClamp(x1 + dx, x0 + CE_MIN, W);
    if (hasN) y0 = ceClamp(y0 + dy, 0, y1 - CE_MIN);
    if (hasS) y1 = ceClamp(y1 + dy, y0 + CE_MIN, H);
    var w = x1 - x0, h = y1 - y0;
    if (ratio) {
      if ((hasN || hasS) && !hasW && !hasE) w = h * ratio;
      else h = w / ratio;
      var aw = hasW ? x1 : W - x0, ah = hasN ? y1 : H - y0;
      var k = Math.min(1, aw / w, ah / h);
      w *= k; h *= k;
      if (hasW) x0 = x1 - w;
      if (hasN) y0 = y1 - h;
    }
    return {
      x: Math.round(x0), y: Math.round(y0),
      w: Math.max(CE_MIN, Math.round(w)), h: Math.max(CE_MIN, Math.round(h))
    };
  }

  function ceMove(b0, dx, dy, W, H) {
    return {
      x: Math.round(ceClamp(b0.x + dx, 0, Math.max(0, W - b0.w))),
      y: Math.round(ceClamp(b0.y + dy, 0, Math.max(0, H - b0.h))),
      w: b0.w, h: b0.h
    };
  }

  function cropEditClose(keep) {
    var el = CE.el, node = CE.node, b = CE.box, o = CE.orig;
    CE.el = null; CE.drag = null;
    try { if (el) el.remove(); } catch (e) {}
    if (!node) return;
    if (!keep && o) cropRegionWrite(node, o);
    var fin = keep ? b : o;
    if (fin) {
      setStatus('ok', (keep ? 'Crop applied: ' : 'Crop restored: ') + fin.x + ', ' + fin.y + ' · ' + fin.w + '×' + fin.h);
    }
    CE.node = null;
  }

  function cropEditOpen(node) {
    var b = cropBox(node);
    if (!b) {
      setStatus('error', 'This Crop node has no crop box widgets');
      return false;
    }
    var src = cropImgSrc(node);
    if (!src) {
      setStatus('error', 'No upstream image found for this Crop node — run the plate/preview once');
      return false;
    }
    if (CE.el) cropEditClose(true);
    CE.node = node;
    CE.orig = { x: b.x, y: b.y, w: b.w, h: b.h };
    CE.box = { x: b.x, y: b.y, w: b.w, h: b.h };
    CE.lock = null; CE.W = 0; CE.H = 0; CE.fit = null;

    var wrap = owns(document.createElement('div'));
    wrap.className = 'shb-modal-bg';
    wrap.tabIndex = -1;
    wrap.innerHTML =
      '<div data-cepanel style="width:94vw;height:90vh;display:flex;flex-direction:column;background:var(--shb-bg,#222222);border:1px solid var(--shb-border,#3c3c3c);border-radius:8px;overflow:hidden;box-shadow:0 12px 36px rgba(0,0,0,.6)">' +
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #333333;background:var(--shb-bg,#222222)">' +
          '<span style="font-weight:600;color:var(--shb-fg,#e2e2e2);display:inline-flex;align-items:center;gap:6px">' + ico('crop') + '<span>Visual Crop Editor · ' + esc(node.title || node.type) + '</span></span>' +
          '<span data-ceread style="font:12px monospace;color:#9a9a9a;flex:1;margin-left:10px"></span>' +
          '<select class="shb-select" data-ceratio style="width:110px"><option value="">Ratio ▾</option><option value="free">Free</option>' +
            CROP_ASPECTS.map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join('') +
          '</select>' +
          '<button class="shb-btn" data-celock></button>' +
          '<select class="shb-select" data-cesize style="width:110px"><option value="">Size ▾</option>' +
            CROP_SIZES.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('') +
          '</select>' +
          '<button class="shb-btn" data-cecancel>Cancel</button>' +
          '<button class="shb-btn shb-btn-pri" data-cedone>Done</button>' +
        '</div>' +
        '<div data-cestage style="flex:1;position:relative;overflow:hidden;background:#141414;user-select:none">' +
          '<img data-ceimg draggable="false" style="position:absolute;pointer-events:none">' +
          '<div data-cebox style="position:absolute;box-sizing:border-box;border:1.5px solid #5c94f0;box-shadow:0 0 0 9999px rgba(0,0,0,.58);cursor:move">' +
            ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(function (d) {
              var l = d.indexOf('w') >= 0 ? '0%' : d.indexOf('e') >= 0 ? '100%' : '50%';
              var t = d.indexOf('n') >= 0 ? '0%' : d.indexOf('s') >= 0 ? '100%' : '50%';
              var cur = (d === 'n' || d === 's') ? 'ns' : (d === 'e' || d === 'w') ? 'ew' : (d === 'nw' || d === 'se') ? 'nwse' : 'nesw';
              return '<i data-ceh="' + d + '" style="position:absolute;left:' + l + ';top:' + t + ';width:10px;height:10px;margin:-5px 0 0 -5px;background:#e2e2e2;border:1.5px solid #222222;border-radius:2px;cursor:' + cur + '-resize"></i>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div style="padding:7px 14px;border-top:1px solid #333333;color:#888888;font-size:11.5px">' +
          'Drag inside box to move · Drag handles to resize · Arrow keys nudge 1px (Shift: 10px) · Enter/Done keeps changes · Any paired Stitch node updates automatically' +
        '</div>' +
      '</div>';

    document.body.appendChild(wrap);
    CE.el = wrap;
    var im = wrap.querySelector('[data-ceimg]');
    var panel = wrap.querySelector('[data-cepanel]');

    function cePaint() {
      var bx = CE.box, f = CE.fit;
      if (!bx) return;
      var ar = cropRatioOf(bx.w, bx.h);
      wrap.querySelector('[data-ceread]').textContent = 'x:' + bx.x + ' y:' + bx.y + ' · ' + bx.w + '×' + bx.h + (ar ? ' (' + ar + ')' : '');
      var lk = wrap.querySelector('[data-celock]');
      lk.textContent = CE.lock ? '🔒 Ratio Locked' : '🔓 Free Ratio';
      lk.className = 'shb-btn' + (CE.lock ? ' shb-btn-pri' : '');
      var fr = wrap.querySelector('[data-cebox]');
      if (!fr || !f) return;
      fr.style.left = Math.round(f.ox + bx.x * f.s) + 'px';
      fr.style.top = Math.round(f.oy + bx.y * f.s) + 'px';
      fr.style.width = Math.round(bx.w * f.s) + 'px';
      fr.style.height = Math.round(bx.h * f.s) + 'px';
    }

    function ceSet(nb) {
      CE.box = nb;
      cropRegionWrite(CE.node, nb);
      cePaint();
    }

    im.onload = function () {
      CE.W = im.naturalWidth || 1024;
      CE.H = im.naturalHeight || 1024;
      var st = wrap.querySelector('[data-cestage]');
      var sw = st.clientWidth || 1200, sh = st.clientHeight || 700;
      var s = Math.min(sw / CE.W, sh / CE.H) * 0.94;
      var ox = Math.round((sw - CE.W * s) / 2), oy = Math.round((sh - CE.H * s) / 2);
      CE.fit = { s: s, ox: ox, oy: oy };
      im.style.left = ox + 'px'; im.style.top = oy + 'px';
      im.style.width = Math.round(CE.W * s) + 'px'; im.style.height = Math.round(CE.H * s) + 'px';
      cePaint();
    };
    im.src = src;

    function stageOf(ev) {
      var r = wrap.querySelector('[data-cestage]').getBoundingClientRect();
      return [ev.clientX - r.left, ev.clientY - r.top];
    }

    wrap.addEventListener('pointerdown', function (ev) {
      if (!panel.contains(ev.target)) { cropEditClose(true); return; }
      var h = ev.target.closest('[data-ceh]');
      var bx = ev.target.closest('[data-cebox]');
      if (!h && !bx) return;
      ev.preventDefault();
      CE.drag = {
        mode: h ? h.getAttribute('data-ceh') : 'move',
        at: stageOf(ev),
        b0: { x: CE.box.x, y: CE.box.y, w: CE.box.w, h: CE.box.h }
      };
    });
    wrap.addEventListener('pointermove', function (ev) {
      var d = CE.drag, f = CE.fit;
      if (!d || !f) return;
      var p = stageOf(ev);
      var dx = (p[0] - d.at[0]) / f.s, dy = (p[1] - d.at[1]) / f.s;
      ceSet(d.mode === 'move'
        ? ceMove(d.b0, dx, dy, CE.W, CE.H)
        : ceResize(d.b0, d.mode, dx, dy, CE.W, CE.H, CE.lock));
    });
    wrap.addEventListener('pointerup', function () { CE.drag = null; });
    wrap.addEventListener('keydown', function (ev) {
      var step = ev.shiftKey ? 10 : 1;
      var mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (ev.key === 'Escape') { ev.preventDefault(); cropEditClose(false); }
      else if (ev.key === 'Enter') { ev.preventDefault(); cropEditClose(true); }
      else if (mv && CE.box) {
        ev.preventDefault();
        ceSet(ceMove(CE.box, mv[0], mv[1], CE.W || 1e9, CE.H || 1e9));
      }
      if (ev.key !== 'z' && ev.key !== 'Z') ev.stopPropagation();
    });

    wrap.querySelector('[data-ceratio]').onchange = function () {
      var a = this.value; this.value = '';
      if (!a) return;
      if (a === 'free') { CE.lock = null; cePaint(); return; }
      cropSet(node, a, '');
      var nb = cropBox(node);
      if (nb) {
        CE.lock = (CROP_R[a] || [1, 1])[0] / (CROP_R[a] || [1, 1])[1];
        ceSet(nb);
      }
    };
    wrap.querySelector('[data-cesize]').onchange = function () {
      var p = this.value; this.value = '';
      if (!p) return;
      cropSet(node, '', p);
      var nb = cropBox(node);
      if (nb) ceSet(nb);
    };
    wrap.querySelector('[data-celock]').onclick = function () {
      CE.lock = CE.lock ? null : (CE.box.w / CE.box.h);
      cePaint();
    };
    wrap.querySelector('[data-cecancel]').onclick = function () { cropEditClose(false); };
    wrap.querySelector('[data-cedone]').onclick = function () { cropEditClose(true); };
    cePaint();
    try { wrap.focus(); } catch (e) {}
    return true;
  }

  /* Fullscreen Paint Studio (Alt+Z on Painter Node) */
  var PE = {
    el: null, node: null, layer: null, W: 0, H: 0, view: null, fit: 1,
    drawing: false, last: null, pan: null, space: false, undo: [], changed: 0,
    tool: 'brush', size: 24, color: '#ffffff', opacity: 1
  };

  function paintEditClose(keep) {
    if (!PE.el) return;
    var el = PE.el, node = PE.node, layer = PE.layer, changed = PE.changed;
    PE.el = null; PE.node = null; PE.layer = null; PE.undo = [];
    try { if (el) el.remove(); } catch (e) {}
    if (!keep || !changed || !node || !layer) return;
    setStatus('busy', 'Uploading painted layer…');
    layer.toBlob(function (blob) {
      if (!blob) return;
      var fd = new FormData();
      fd.append('image', blob, 'painter_' + node.id + '_' + Date.now() + '.png');
      fd.append('type', 'input');
      apiFetch('/upload/image', { method: 'POST', body: fd })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.name) return;
          var v = (j.subfolder ? j.subfolder + '/' : '') + j.name + ' [input]';
          setWidgetVal(node, 'mask', v);
          try {
            var nc = document.querySelector('[data-node-id="' + node.id + '"] canvas[data-testid="painter-canvas"]');
            if (nc && nc.width > 0) {
              var ctx = nc.getContext('2d');
              ctx.clearRect(0, 0, nc.width, nc.height);
              ctx.drawImage(layer, 0, 0, nc.width, nc.height);
            }
          } catch (e) {}
          var g = getGraph();
          if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
          setStatus('ok', '✎ Paint saved to ' + (node.title || node.type));
        });
    }, 'image/png');
  }

  function paintEditOpen(node) {
    if (!isPainterNode(node)) return false;
    if (PE.el) paintEditClose(true);
    PE.node = node; PE.undo = []; PE.changed = 0;
    var wrap = owns(document.createElement('div'));
    wrap.className = 'shb-modal-bg';
    wrap.tabIndex = -1;
    wrap.innerHTML =
      '<div data-pepanel style="width:95vw;height:91vh;display:flex;flex-direction:column;background:var(--shb-bg,#222222);border:1px solid var(--shb-border,#3c3c3c);border-radius:8px;overflow:hidden;box-shadow:0 12px 36px rgba(0,0,0,.6)">' +
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #333333;background:var(--shb-bg,#222222)">' +
          '<span style="font-weight:600;color:var(--shb-fg,#e2e2e2);flex:1;display:inline-flex;align-items:center;gap:6px">' + ico('paint') + '<span>Paint Studio · ' + esc(node.title || node.type) + '</span></span>' +
          '<button class="shb-btn shb-btn-pri" data-petool="brush">Brush (B)</button>' +
          '<button class="shb-btn" data-petool="eraser">Eraser (E)</button>' +
          '<span style="color:#9a9a9a">Size</span>' +
          '<input type="range" min="1" max="300" value="' + PE.size + '" data-pesize style="width:110px;accent-color:#5c94f0">' +
          '<input type="color" value="' + PE.color + '" data-pecolor style="width:32px;height:26px;border:0;background:none;cursor:pointer">' +
          '<button class="shb-btn" data-peundo>Undo (Ctrl+Z)</button>' +
          '<button class="shb-btn" data-peclear>Clear</button>' +
          '<button class="shb-btn" data-pecancel>Cancel</button>' +
          '<button class="shb-btn shb-btn-pri" data-pedone>Done</button>' +
        '</div>' +
        '<div data-pestage style="flex:1;position:relative;overflow:hidden;background:#141414;display:flex;align-items:center;justify-content:center;user-select:none">' +
          '<div data-pebox style="position:relative;background:#000;box-shadow:0 8px 32px rgba(0,0,0,.6)">' +
            '<img data-peimg draggable="false" style="display:block;max-width:88vw;max-height:78vh;pointer-events:none">' +
            '<canvas data-pelayer style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair"></canvas>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    PE.el = wrap;
    var layer = wrap.querySelector('[data-pelayer]');
    var img = wrap.querySelector('[data-peimg]');
    PE.layer = layer;

    var orig = imageOrigin(getGraph(), node);
    var src = '';
    if (orig && orig.node) {
      var ims = producedImages(orig.node);
      if (ims.length) src = viewURL(ims[0]);
    }
    function initCanvas(w, h) {
      PE.W = w; PE.H = h;
      layer.width = w; layer.height = h;
      if (!src) {
        layer.style.position = 'relative';
        layer.style.width = Math.min(w, 800) + 'px';
        layer.style.height = Math.min(h, 600) + 'px';
        img.style.display = 'none';
      }
    }
    if (src) {
      img.onload = function () { initCanvas(img.naturalWidth || 1024, img.naturalHeight || 1024); };
      img.src = src;
    } else {
      initCanvas(1024, 1024);
    }

    function toPt(ev) {
      var r = layer.getBoundingClientRect();
      return {
        x: (ev.clientX - r.left) * (layer.width / (r.width || 1)),
        y: (ev.clientY - r.top) * (layer.height / (r.height || 1))
      };
    }

    var ctx = layer.getContext('2d');
    layer.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      try { PE.undo.push(ctx.getImageData(0, 0, layer.width, layer.height)); if (PE.undo.length > 15) PE.undo.shift(); } catch (e) {}
      PE.drawing = true;
      var p = toPt(ev);
      PE.last = p;
      ctx.save();
      ctx.globalCompositeOperation = PE.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.fillStyle = PE.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, PE.size / 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    layer.addEventListener('pointermove', function (ev) {
      if (!PE.drawing) return;
      var p = toPt(ev);
      ctx.save();
      ctx.globalCompositeOperation = PE.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = PE.color;
      ctx.lineWidth = PE.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(PE.last.x, PE.last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.restore();
      PE.last = p;
      PE.changed++;
    });
    window.addEventListener('pointerup', function () { PE.drawing = false; });

    function updateTools() {
      wrap.querySelector('[data-petool="brush"]').className = 'shb-btn' + (PE.tool === 'brush' ? ' shb-btn-pri' : '');
      wrap.querySelector('[data-petool="eraser"]').className = 'shb-btn' + (PE.tool === 'eraser' ? ' shb-btn-pri' : '');
    }
    wrap.querySelector('[data-petool="brush"]').onclick = function () { PE.tool = 'brush'; updateTools(); };
    wrap.querySelector('[data-petool="eraser"]').onclick = function () { PE.tool = 'eraser'; updateTools(); };
    wrap.querySelector('[data-pesize]').oninput = function () { PE.size = +this.value || 10; };
    wrap.querySelector('[data-pecolor]').oninput = function () { PE.color = this.value; PE.tool = 'brush'; updateTools(); };
    wrap.querySelector('[data-peundo]').onclick = function () {
      var u = PE.undo.pop();
      if (u) ctx.putImageData(u, 0, 0);
    };
    wrap.querySelector('[data-peclear]').onclick = function () {
      ctx.clearRect(0, 0, layer.width, layer.height);
      PE.changed++;
    };
    wrap.querySelector('[data-pecancel]').onclick = function () { paintEditClose(false); };
    wrap.querySelector('[data-pedone]').onclick = function () { paintEditClose(true); };
    wrap.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); paintEditClose(false); }
      else if (ev.key === 'Enter') { ev.preventDefault(); paintEditClose(true); }
      else if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'z' || ev.key === 'Z')) {
        ev.preventDefault();
        var u = PE.undo.pop();
        if (u) ctx.putImageData(u, 0, 0);
      } else if (ev.key === 'b' || ev.key === 'B') { PE.tool = 'brush'; updateTools(); }
      else if (ev.key === 'e' || ev.key === 'E') { PE.tool = 'eraser'; updateTools(); }
      ev.stopPropagation();
    });
    try { wrap.focus(); } catch (e) {}
    return true;
  }

  function actAltZ(explicitNode) {
    if (LUPA.el) { lupaClose(); return; }
    if (CE.el) { cropEditClose(true); return; }
    if (PE.el) { paintEditClose(true); return; }
    var n = explicitNode || hbNode();
    var t = lupaTarget();
    var typing = !!(t && t.ta && t.ta === document.activeElement);
    if (n && isCropNode(n) && !typing) { cropEditOpen(n); return; }
    if (n && isPainterNode(n) && !typing) { paintEditOpen(n); return; }
    if (t && (t.ta || t.w)) { lupaOpen(t); return; }
    if (n) {
      var w = lupaWidget(n);
      if (w) { lupaOpen({ w: w, node: n }); return; }
    }
    setStatus('error', 'Alt+Z: Point at a Prompt node (Magnifier), a Crop node (Visual Crop), or a Painter node');
  }

  /* ---------------------------------------------------------------------
   * 14. THE HOTBOX ENGINE (FLUID / QUIET RADIAL CARDS & COMPACT TOOLBAR)
   * --------------------------------------------------------------------- */
  var HB = {
    el: null,
    grpOpen: {},
    node: null,
    rect: null,
    x: 0,
    y: 0,
    top: 0,
    bot: 0,
    left: 0,
    right: 0,
    hub: false,
    drawer: '',        /* '' | 'addcustom' | 'tools' | 'models' | 'subs' | 'search' */
    customTarget: 'add', /* 'add' | 'tools' | 'bot' */
    customTab: 'nodes',  /* 'nodes' | 'tools' | 'models' | 'subs' */
    editMode: false,
    suppressClickUntil: 0,
    q: '',
    binding: false,
    keyMap: {}
  };
  var HB_MX = window.innerWidth ? Math.round(window.innerWidth / 2) : 600;
  var HB_MY = window.innerHeight ? Math.round(window.innerHeight / 2) : 400;

  listen(document, 'mousemove', function (e) {
    HB_MX = e.clientX;
    HB_MY = e.clientY;
  }, true);

  function hbTyping() {
    try {
      var a = document.activeElement;
      if (!a) return false;
      var t = String(a.tagName || '').toUpperCase();
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return true;
      if (a.isContentEditable) return true;
    } catch (e) {}
    return false;
  }

  function hbNode() {
    var c = getCanvas();
    var g = getGraph();
    /* Vue node mode: nodes are DOM elements, so the canvas never sees the pointer over them */
    try {
      var under = document.elementFromPoint(HB_MX, HB_MY);
      var vEl = under && under.closest && !under.closest('.shb-wrap') ? under.closest('.lg-node[data-node-id]') : null;
      if (vEl && g && g.getNodeById) {
        var vHit = g.getNodeById(vEl.getAttribute('data-node-id'));
        if (vHit) return vHit;
      }
    } catch (e) {}
    try {
      var gm = c && (c.graph_mouse || c.canvas_mouse);
      if (gm && g && g.getNodeOnPos) {
        var hit = g.getNodeOnPos(gm[0], gm[1]);
        if (hit) return hit;
      }
    } catch (e) {}
    return selectedOne();
  }

  function hbNodeRect(node) {
    if (!node) return null;
    try {
      var domEl = document.querySelector('[data-node-id="' + node.id + '"]');
      if (domEl && domEl.getBoundingClientRect) {
        var dr = domEl.getBoundingClientRect();
        if (dr && dr.width > 20 && dr.height > 20) {
          return { x: dr.left, y: dr.top, w: dr.width, h: dr.height };
        }
      }
    } catch (e) {}
    try {
      var c = getCanvas();
      var el = c && c.canvas;
      var ds = c && c.ds;
      if (!node.pos || !el || !el.getBoundingClientRect) return null;
      if (!ds || !ds.scale || !ds.offset) return null;
      var r = el.getBoundingClientRect();
      var s = ds.scale;
      var b = node.boundingRect;
      if (b && b[2] > 20 && b[3] > 20) {
        return {
          x: r.left + (b[0] + ds.offset[0]) * s,
          y: r.top + (b[1] + ds.offset[1]) * s,
          w: b[2] * s,
          h: b[3] * s
        };
      }
      var LG = litegraph();
      var th = ((LG && LG.NODE_TITLE_HEIGHT) || 30) * s;
      var w = ((node.size && node.size[0]) || 220) * s;
      var h = ((node.size && node.size[1]) || 80) * s;
      return {
        x: r.left + (node.pos[0] + ds.offset[0]) * s,
        y: r.top + (node.pos[1] + ds.offset[1]) * s - th,
        w: Math.max(80, w),
        h: Math.max(40, h + th)
      };
    } catch (e) { return null; }
  }

  var HB_AVOID = ['.selection-toolbox', '.comfyui-selection-toolbox', '[class*="selection-toolbox"]', '[class*="toolbox"]', '.p-toolbar', '[role="toolbar"]'];
  /* Asked two or three times as the hotbox opens, and each look makes the browser lay out the whole page (every
     node, on a graph drawn with Vue nodes): the answer is kept for a moment while the node stays put */
  var HB_AVOID_MEMO = { key: '', at: 0, r: null };
  function hbAvoidRect(nodeRect) {
    var key = nodeRect ? [nodeRect.x, nodeRect.y, nodeRect.w, nodeRect.h].map(Math.round).join(',') : '';
    var now = Date.now();
    if (HB_AVOID_MEMO.key === key && now - HB_AVOID_MEMO.at < 400) return HB_AVOID_MEMO.r;
    var r = hbAvoidRectNow(nodeRect);
    HB_AVOID_MEMO = { key: key, at: now, r: r };
    return r;
  }

  function hbAvoidRectNow(nodeRect) {
    var best = null;
    function consider(el) {
      if (!el || el === document.body || el === document.documentElement) return;
      if (HB.el && (el === HB.el || HB.el.contains(el))) return;
      if (el.tagName === 'CANVAS') return;
      var r = null;
      try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
      if (!r || r.width < 40 || r.width > 650 || r.height < 18 || r.height > 90) return;
      if (nodeRect) {
        if (r.bottom < nodeRect.y - 140 || r.top > nodeRect.y + 36) return;
        if (r.right < nodeRect.x - 120 || r.left > nodeRect.x + nodeRect.w + 120) return;
      }
      if (!best || r.top < best.top) best = r;
    }
    for (var i = 0; i < HB_AVOID.length; i++) {
      var els = [];
      try { els = document.querySelectorAll(HB_AVOID[i]); } catch (e) { els = []; }
      for (var j = 0; j < els.length; j++) consider(els[j]);
    }
    if (!best && nodeRect) {
      var cx = Math.round(nodeRect.x + nodeRect.w / 2);
      var probes = [20, 32, 44];
      for (var p = 0; p < probes.length; p++) {
        var py = Math.round(nodeRect.y - probes[p]);
        if (py < 0) continue;
        var hit = null;
        try { hit = document.elementFromPoint(cx, py); } catch (e) { hit = null; }
        var cur = hit;
        for (var depth = 0; cur && depth < 6; depth++, cur = cur.parentElement) {
          if (cur.tagName === 'CANVAS' || cur === document.body) break;
          consider(cur);
        }
      }
    }
    return best;
  }

  function hbTopModels(node, count) {
    var max = count || 5;
    var isAdd = ndAdds(node);
    var kind = isAdd ? '' : genOut(node);
    var favs = isAdd ? favList('image').concat(favList('video')) : favList(kind || 'image');
    var all = isAdd ? ndMates(node) : swapMates(node, kind);
    var chosen = [];
    if (favs.length) {
      /* a favorite stays even when it is an older version: it was picked on purpose */
      (isAdd ? ndMates(node, true) : swapMates(node, kind, true)).forEach(function (m) {
        if (favs.indexOf(m.type) >= 0) chosen.push(m);
      });
      chosen.sort(function (a, b) { return favs.indexOf(a.type) - favs.indexOf(b.type); });
    }
    if (chosen.length < max) {
      all.forEach(function (m) {
        if (chosen.length < max && chosen.indexOf(m) < 0) chosen.push(m);
      });
    }
    return chosen.slice(0, max);
  }

  /* Master registry of all built-in tools & actions so any tool can be placed in any bar */
  function getMasterTools(node) {
    var seedCtrls = node ? seedControls(node) : [];
    var curSeedMode = seedCtrls.length ? seedModeOf([node]) : '';
    var map = {
      crop:       { id: 'crop',       icon: 'crop',       label: 'Crop',           kbd: 'C', fn: function () { addCrop(node); } },
      rsz:        { id: 'rsz',        icon: 'resize',     label: 'Resize',         kbd: '',  fn: function () { addResize(node); } },
      flip:       { id: 'flip',       icon: 'flip',       label: 'Flip',           kbd: '',  fn: function () { addFlip(node); } },
      paint:      { id: 'paint',      icon: 'paint',      label: 'Paint',          kbd: '',  fn: function () { addPaint(node); } },
      cmp:        { id: 'cmp',        icon: 'compare',    label: 'Compare',        kbd: '',  fn: function () { addCompare(node); } },
      saveimg:    { id: 'saveimg',    icon: 'save',       label: 'Save Image',     kbd: '',  fn: function () { addSaveImage(node); } },
      prev:       { id: 'prev',       icon: 'preview',    label: 'Preview',        kbd: 'T', fn: function () { addPreview(node); } },
      loadcanvas: { id: 'loadcanvas', icon: 'loadCanvas', label: 'Load in Canvas', kbd: 'V', fn: function () { actLoadInCanvas(node); } },
      gvc:        { id: 'gvc',        icon: 'video',      label: 'Video → Frames', kbd: 'C', fn: function () { addVideoComponents(node); } },
      batch:      { id: 'batch',      icon: 'video',      label: 'Framehold',      kbd: '',  fn: function () { addFromBatch(node); } },
      mkvid:      { id: 'mkvid',      icon: 'video',      label: 'Create Video',   kbd: '',  fn: function () { addCreateVideo(node); } },
      savevid:    { id: 'savevid',    icon: 'save',       label: 'Save Video',     kbd: '',  fn: function () { addSaveVideo(node); } },
      wf:         { id: 'wf',         icon: 'subgraph',   label: 'PNG Workflow',   kbd: '',  fn: function () { actImageWorkflow(node); } },
      seed:       { id: 'seed',       icon: 'seed',       label: 'Copy Seed',      kbd: '',  fn: function () { actExtractSeed(node); } },
      cropedit:   { id: 'cropedit',   icon: 'lupa',       label: 'Visual Crop',    kbd: 'Z', fn: function () { cropEditOpen(node); } },
      paintedit:  { id: 'paintedit',  icon: 'paint',      label: 'Paint Studio',   kbd: 'Z', fn: function () { paintEditOpen(node); } },
      lupa:       { id: 'lupa',       icon: 'lupa',       label: 'Magnifier',      kbd: 'Z', fn: function () { actAltZ(node); } },
      label:      { id: 'label',      icon: 'label',      label: 'Add Label',      kbd: 'L', fn: function () { labelOpen(node); } },
      rename:     { id: 'rename',     icon: 'edit',       label: 'Rename Node',    kbd: 'F2', fn: function () { actRenameNode(node); } },
      reroute:    { id: 'reroute',    icon: 'reroute',    label: 'Add Reroute',    kbd: 'R', fn: function () { addReroute(node); } },
      set:        { id: 'set',        icon: 'set',        label: 'Set / Get Bus',  kbd: 'S', fn: function () { addSetNode(node); } },
      setinh:     { id: 'setinh',     icon: 'set',        label: 'Inherit Name',   kbd: 'C', fn: function () { actSetInherit(node); } },
      addget:     { id: 'addget',     icon: 'plus',       label: 'Paired Get',     kbd: '',  fn: function () { addGetNode(node); } },
      bypass:     { id: 'bypass',     icon: 'bypass',     label: 'Bypass',         kbd: 'B', cls: (node && node.mode === 4) ? 'shb-btn-on' : '', fn: function () { actBypass(node); } },
      mute:       { id: 'mute',       icon: 'bypass',     label: 'Mute Node',      kbd: 'M', cls: (node && node.mode === 2) ? 'shb-btn-on' : '', fn: function () { actMute(node); } },
      apibypass:  { id: 'apibypass',  icon: 'zapOff',     label: 'Bypass All APIs', kbd: 'K', fn: function () { actBypassApi(); } },
      zoom:       { id: 'zoom',       icon: 'zoom',       label: 'Zoom',           kbd: '.', fn: function () { actDotZoom(node); } },
      arrange:    { id: 'arrange',    icon: 'arrange',    label: 'Arrange',        kbd: '',  fn: function () { actArrange(node); } },
      copywf:     { id: 'copywf',     icon: 'copy',       label: 'Copy Workflow',  kbd: '',  fn: function () { actCopyWorkflow(); } },
      replicate:  { id: 'replicate',  icon: 'copy',       label: 'Replicate',      kbd: '',  fn: function () { actReplicate(node); } },
      render:     { id: 'render',     icon: 'play',       label: 'Render Selected', kbd: '⇧R', fn: function () { actRenderSelected(); } },
      stitch:     { id: 'stitch',     icon: 'stitch',     label: 'Super Stitch',   kbd: '',  fn: function () { actStitch(node); } },
      stitchupd:  { id: 'stitchupd',  icon: 'sync',       label: 'Update Stitch',  kbd: '',  fn: function () { actStitchUpdate(node); } },
      stitchswap: { id: 'stitchswap', icon: 'swap',       label: 'Swap FG / BG',   kbd: '',  fn: function () { actStitchSwap(node); } },
      swappair:   { id: 'swappair',   icon: 'swap',       label: 'Swap Nodes',     kbd: 'W', fn: function () { actSwapPair(); } },
      magic:      { id: 'magic',      icon: 'wand',       label: 'Save as Button', kbd: 'X', stayOpen: true, fn: function () { actMagic(node); } },
      seedtoggle: {
        id: 'seedtoggle',
        icon: 'seed',
        label: 'Seed: ' + (curSeedMode || 'set'),
        kbd: 'P',
        stayOpen: true,
        fn: function () {
          if (!node) return;
          var cur = seedModeOf([node]);
          var next = SEED_MODES[(SEED_MODES.indexOf(cur) + 1) % SEED_MODES.length] || 'fixed';
          actSeedMode([node], next);
          hbPaint();
        }
      },
      loadimg:    { id: 'loadimg',    icon: 'loadCanvas', label: 'Load Image',     kbd: 'C', fn: function () { hbCreate('LoadImage', null); } },
      ksamp:      { id: 'ksamp',      icon: 'model',      label: 'KSampler',       kbd: '',  fn: function () { hbCreate('KSampler', node); } },
      note:       { id: 'note',       icon: 'label',      label: 'Add Label',      kbd: 'L', fn: function () { labelOpen(null); } }
    };
    CROP_ASPECTS.forEach(function (ar) {
      map['ar_' + ar] = { id: 'ar_' + ar, icon: 'crop', label: ar, kbd: '', fn: function () { cropSet(node, ar, ''); } };
    });
    var curGet = (ndKind(node) === 'get') ? setGetName(node) : '';
    setNames().forEach(function (nm) {
      map['get_' + nm] = {
        id: 'get_' + nm,
        icon: 'set',
        label: nm,
        kbd: '',
        cls: nm === curGet ? 'shb-btn-on' : '',
        fn: function () { setNameOn(node, nm); var g = getGraph(); if (g) g.setDirtyCanvas(true, true); }
      };
    });
    return map;
  }

  /* Power tools are the user's own extras; each can be switched off in Settings, which hides its buttons too */
  var POWER_TOOL_OF = {
    cropedit: 'useAltZ', paintedit: 'useAltZ', lupa: 'useAltZ',
    label: 'useAltN', note: 'useAltN',
    loadcanvas: 'useAltR',
    render: 'useShiftR',
    stitch: 'useStitch', stitchupd: 'useStitch',
    apibypass: 'useKillApi',
    zoom: 'dotZoom',
    arrange: 'useArrange'
  };

  function hbToolOn(tid) {
    var k = POWER_TOOL_OF[tid];
    return !k || S[k] !== false;
  }

  /* Never offer the node you are standing on again — unless it is the kind that chains (LoRAs, ControlNet…) */
  var CHAINABLE_RE = /lora|controlnetapply|ipadapterapply|ipadapteradvanced|conditioning(combine|concat|average)|imagebatch|latentbatch|stringconcat|textconcat/i;
  var TOOL_SPAWNS = {
    saveimg: ['SaveImage'], savevid: ['SaveVideo', 'VHS_VideoCombine'], prev: ['PreviewImage'],
    gvc: ['GetVideoComponents'], mkvid: ['CreateVideo'], batch: ['ImageFromBatch'],
    flip: ['ImageFlip', 'ImageFlip+'], paint: ['Painter'], crop: ['ImageCropV2', 'ImageCrop', 'ImageCrop+'],
    cmp: ['ImageCompare', 'Image Comparer (rgthree)'],
    rsz: ['ImageResizeKJv2', 'ImageResize+', 'ImageScaleBy', 'ImageScale']
  };

  function hbSameNode(type, node) {
    if (!node || !type) return false;
    var cur = String(node.type || node.comfyClass || '');
    return String(type) === cur && !CHAINABLE_RE.test(cur);
  }

  function hbToolIsSelf(tid, node) {
    var ts = TOOL_SPAWNS[tid];
    return !!(ts && node && ts.some(function (t) { return hbSameNode(t, node); }));
  }

  function isSubgraphNode(node) {
    try { return !!(node && (typeof node.isSubgraphNode === 'function' ? node.isSubgraphNode() : node.subgraph)); }
    catch (e) { return false; }
  }

  /* Load in Canvas only makes sense on a node that is showing an image or a video right now */
  function hbHasImage(node) {
    if (!node || isLoader(node)) return false;
    if (node.imgs && node.imgs.length) return true;
    var app = getApp();
    var no = app && app.nodeOutputs && app.nodeOutputs[node.id];
    return !!(no && Array.isArray(no.images) && no.images.length) || !!producedVideo(node);
  }

  function hbContextTools(node) {
    var k = ndKind(node);
    var mt = getMasterTools(node);
    var ids = [];
    var hasImg = node && (imageOutSlot(node) >= 0 || isPreviewNode(node));
    var hasVid = node && videoOutSlot(node) >= 0;
    /* a plate that crops cut, or a result that came out of a crop, can be stitched back; on a result that
       is the next step, so it leads the bar (Super Stitch plugs the result in by itself) */
    var stT = hasImg && k !== 'crop' && k !== 'stitch' ? stitchTargets(getGraph(), node) : null;
    var stOn = !!(stT && stT.crops.length), stFirst = stOn && !!stT.src;

    if (k === 'crop') {
      ids.push('cropedit', 'stitch');
      if (stitchesOf(getGraph(), node).length) ids.push('stitchupd');
      CROP_ASPECTS.slice(0, 5).forEach(function (ar) { ids.push('ar_' + ar); });
    } else if (k === 'stitch') {
      ids.push('stitchupd', 'stitchswap', 'prev', 'saveimg');
    } else if (k === 'api' || isSubgraphNode(node)) {
      /* a generator's first question is "keep it": save comes first, video or image by what it outputs */
      if (hasVid || (k === 'api' && genOut(node) === 'video')) ids.push('savevid', 'gvc');
      if (stFirst) ids.unshift('stitch');
      if (hasImg) ids.push('saveimg', 'prev', 'crop', 'rsz', 'cmp');
      if (stOn && !stFirst) ids.push('stitch');
    } else if (k === 'paint') {
      /* painting comes first, then the paint goes back where its crop was cut */
      ids.push('paintedit');
      if (stFirst) ids.push('stitch');
      ids.push('prev', 'cmp', 'saveimg');
    } else if (k === 'set') {
      ids.push('setinh', 'addget');
    } else if (k === 'get') {
      setNames().forEach(function (nm) { ids.push('get_' + nm); });
    } else {
      if (stFirst) ids.push('stitch');
      if (hasImg) {
        ids.push('crop', 'rsz', 'flip');
        if (paintType()) ids.push('paint');
        ids.push('cmp', 'saveimg');
      }
      if (hasVid) {
        ids.push('savevid', 'gvc');
        if (batchType()) ids.push('batch');
      }
      if (hasImg && (canMake(CREATE_VIDEO_TYPE) || hasType(CREATE_VIDEO_TYPE))) {
        ids.push('mkvid');
      }
      if (stOn && !stFirst) ids.push('stitch');
      if (k === 'load') {
        ids.push('wf', 'seed');
      }
    }
    return ids.filter(function (id) {
      return hbToolOn(id) && !hbToolIsSelf(id, node);
    }).map(function (id) { return mt[id]; }).filter(Boolean);
  }

  /* When a tool cannot run on this node (or the canvas): a short line saying when it does, or '' */
  function hbToolWhy(tid, node, sel) {
    if (!node && /^(prev|loadcanvas|bypass|mute|seedtoggle|rename|reroute|set|addget|setinh|stitch|stitchupd|stitchswap)$/.test(tid)) {
      return 'works on a node: open the hotbox over one';
    }
    if (node && tid === 'prev' && imageOutSlot(node) < 0 && !isPreviewNode(node)) return 'works on nodes with an image output';
    if (node && tid === 'seedtoggle' && !seedControls(node).length) return 'works on nodes with a seed';
    if (tid === 'loadcanvas' && !(hbHasImage(node) || isPreviewNode(node) || outKind(node) === 'save')) {
      return 'works on Preview, Save Image and Save Video nodes, or a node showing an image';
    }
    if (hbToolIsSelf(tid, node)) return 'this node already is one';
    if (tid === 'swappair' && sel.length !== 2) return 'select two nodes to swap them';
    if (tid === 'magic' && !sel.length && !node) return 'select some nodes first';
    if (tid === 'replicate' && !sel.length && !node && !mgItems(null).length) return 'select a group or some nodes first';
    if (tid === 'apibypass' && !allNodes(getGraph()).some(function (n) {
      return !!(SRV.api && SRV.api[String(n.type || n.comfyClass || '')]);
    })) return 'works when the workflow has API nodes';
    return '';
  }

  /* kept per bar: a tool placed on the top bar stays there, and the bottom bar's own copy still hides where it
     does not apply */
  function hbKept(uid, bar) {
    return !!(bar && S.hbKeep && S.hbKeep[bar + ':' + uid]);
  }

  /* a power tool the user put on a bar themselves stays in that bar, dimmed where it does not apply */
  function hbKeepUid(uid, bar) {
    if (!bar || !/^tool:/.test(String(uid || ''))) return;
    if (!S.hbKeep || typeof S.hbKeep !== 'object') S.hbKeep = {};
    S.hbKeep[bar + ':' + uid] = true;
  }

  /* once it is in none of that bar's lists (one per kind of node) and in no group, it is forgotten there */
  function hbForgetIfGone(uid) {
    if (!S.hbKeep) return;
    var inGroup = Object.keys(S.hbGroups || {}).some(function (k) { return ((S.hbGroups[k] || {}).items || []).indexOf(uid) >= 0; });
    var byBar = { bot: [S.customBotBar || []], add: [], tools: [] };
    Object.keys(S.customAddBySig || {}).forEach(function (k) { byBar.add.push(S.customAddBySig[k] || []); });
    Object.keys(S.customToolsBar || {}).forEach(function (k) { byBar.tools.push(S.customToolsBar[k] || []); });
    Object.keys(byBar).forEach(function (bar) {
      var there = byBar[bar].some(function (l) { return Array.isArray(l) && l.indexOf(uid) >= 0; });
      if (!there && !inGroup) delete S.hbKeep[bar + ':' + uid];
    });
  }

  /* Resolve any bar item uid ('model:...', 'node:...', 'tool:...', 'tpl:...') into a unified renderable & executable
     item. `loose` (a power tool dragged in from Settings) skips the "only where it applies" filter. A tool the
     user placed on a bar themselves (hbKeep) is never hidden: where it does not apply it comes back with `off`,
     the reason, and the bar shows it dimmed. */
  function resolveBarItem(uid, node, loose, bar) {
    if (!uid) return null;
    var u = String(uid);
    var customLbl = (S.customLabels && S.customLabels[u]) || '';
    var isAdd = ndAdds(node);
    var sel = selNodes();
    var isPair = sel.length >= 2 && isAdd;

    if (u.indexOf('grp:') === 0) {
      var gid = u.slice(4), grp = grpById(gid);
      if (!grp) return null;
      var kids = (grp.items || []).map(function (k) { return /^grp:/.test(k) ? null : resolveBarItem(k, node, loose, bar); }).filter(Boolean);
      /* a group whose buttons do not apply here waits for "+N hidden here" in edit mode; so does an empty one,
         unless it was kept on purpose (grpAskKeep): that one stays in its bar, ready to be filled again */
      if (!kids.length && !hbAllBtns() && !(grp.keep && !(grp.items || []).length)) return null;
      return {
        uid: u, kind: 'group', id: gid,
        label: customLbl || grp.name,
        title: (customLbl || grp.name) + ' · ' + (kids.length ? kids.length + (kids.length === 1 ? ' button' : ' buttons') + ' · click to open · drop buttons on it to add them'
          : 'empty · drop buttons on it to fill it'),
        icon: 'folder', kbd: '', cls: '', count: kids.length, kids: kids, stayOpen: true,
        run: function () { hbGroupToggle(gid); }
      };
    }

    if (u.indexOf('tool:') === 0) {
      var tid = u.slice(5);
      /* A power tool switched off in Settings is gone everywhere */
      if (!hbToolOn(tid)) return null;
      /* a tool shows only where it applies (the bars stay short); one the user placed stays, dimmed */
      var why = (!hbAllBtns() && !loose) ? hbToolWhy(tid, node, sel) : '';
      if (why && !hbKept(u, bar)) return null;
      var mt = getMasterTools(node);
      var t = mt[tid];
      if (!t) return null;
      return {
        uid: u,
        kind: 'tool',
        id: tid,
        off: why,
        label: customLbl || t.label,
        title: t.label + (why ? ' · ' + why : ''),
        icon: t.icon || 'plus',
        kbd: t.kbd || '',
        cls: t.cls || '',
        stayOpen: !!t.stayOpen,
        run: t.fn
      };
    }

    if (u.indexOf('tpl:') === 0) {
      var tpl = tplById(u.slice(4));
      if (!tpl) return null;
      return {
        uid: u,
        kind: 'template',
        id: tpl.id,
        label: customLbl || tpl.name,
        title: 'Adds ' + tpl.count + (tpl.count === 1 ? ' node' : ' nodes') + ': ' + tpl.name + ' · click, or drag it onto the canvas',
        icon: 'sparkles',
        kbd: '',
        cls: '',
        count: tpl.count,
        stayOpen: true,
        run: function () { tplRunFromBar(u, tpl); }
      };
    }

    if (u.indexOf('model:') === 0) {
      var mType = u.slice(6);
      var mObj = null;
      for (var i = 0; i < (SRV.models || []).length; i++) {
        if (SRV.models[i].type === mType) { mObj = SRV.models[i]; break; }
      }
      var def = (SRV.types && SRV.types[mType]) || null;
      var mSub = mType.indexOf('subgraph:') === 0 ? subNamed(mType) : '';
      var rawName = mSub || (mObj && mObj.name) || (def && def.display_name) || mType;
      var shortName = customLbl || String(rawName)
        .replace(/\s*\((?:API|Google[^)]*|Partner[^)]*|ByteDance[^)]*|Black Forest[^)]*|OpenAI[^)]*|Stability[^)]*)\)\s*/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim() || mType;
      return {
        uid: u,
        kind: 'model',
        id: mType,
        label: shortName,
        title: (isAdd ? 'Add & wire ' : 'Swap to ') + ((mObj && mObj.fullName) || rawName),
        icon: isAdd ? 'plus' : 'swap',
        kbd: '',
        cls: isAdd ? 'shb-btn-pri' : 'shb-swapi',
        run: function () {
          hbReady(mType).then(function () {
            if (isPair) addModelPair(sel, mType);
            else if (isAdd) addModel(node, mType);
            else swapSelected(node, mType);
          });
        }
      };
    }

    if (u.indexOf('node:') === 0) {
      var nType = u.slice(5);
      if (!hbAllBtns() && (hbSameNode(nType, node) || isDeprecatedType(nType))) return null;
      var nDef = (SRV.types && SRV.types[nType]) || null;
      var subName = '';
      if (nType.indexOf('subgraph:') === 0) subName = subNamed(nType);
      var SHORT_NODE_NAMES = {
        LoraLoader: 'Load LoRA',
        LoraLoaderModelOnly: 'LoRA (Model Only)',
        CLIPTextEncode: 'CLIP Text Encode',
        CheckpointLoaderSimple: 'Load Checkpoint',
        KSamplerAdvanced: 'KSampler (Adv)',
        SamplerCustomAdvanced: 'Sampler Custom (Adv)',
        ControlNetApplyAdvanced: 'Apply ControlNet',
        VAEDecodeTiled: 'VAE Decode (Tiled)',
        VAEEncodeTiled: 'VAE Encode (Tiled)'
      };
      var disp = subName || SHORT_NODE_NAMES[nType] || (nDef && nDef.display_name) || nType;
      var shortDisp = customLbl || SHORT_NODE_NAMES[nType] || String(disp)
        .replace(/\s*\(Model and CLIP\)\s*/i, '')
        .replace(/\s*\(Prompt\)\s*/i, '')
        .replace(/\s*\(Advanced\)\s*/i, ' (Adv)')
        .trim() || disp;
      var matchSlots = matchingSlotsDesc(node, nType);
      return {
        uid: u,
        kind: 'node',
        id: nType,
        label: shortDisp,
        title: 'Add & auto-connect ' + disp + (matchSlots ? ' [' + matchSlots + ']' : ''),
        icon: subName ? 'subgraph' : 'plus',
        kbd: '',
        cls: 'shb-btn-pri',
        run: function () {
          hbReady(nType).then(function () {
            if (isPair) addModelPair(sel, nType);
            else addModel(node, nType);
          });
        }
      };
    }
    return null;
  }

  /* Curated priority nodes by ComfyUI slot type for instant, intelligent slot-aware suggestions */
  var CURATED_BY_SLOT = {
    MODEL: ['KSampler', 'LoraLoader', 'LoraLoaderModelOnly', 'KSamplerAdvanced', 'SamplerCustomAdvanced', 'ModelSamplingSD3', 'ModelSamplingFlux', 'CFGGuider', 'BasicGuider', 'FreeU_V2', 'PatchModelAddDownscale', 'ModelMergeSimple'],
    CLIP: ['CLIPTextEncode', 'LoraLoader', 'CLIPSetLastLayer', 'CLIPTextEncodeSDXL', 'CLIPTextEncodeFlux', 'ConditioningZeroOut'],
    VAE: ['VAEDecode', 'VAEEncode', 'VAEDecodeTiled', 'VAEEncodeTiled', 'InpaintModelConditioning'],
    CONDITIONING: ['KSampler', 'ControlNetApplyAdvanced', 'ConditioningCombine', 'ConditioningConcat', 'FluxGuidance', 'KSamplerAdvanced', 'ConditioningSetArea', 'ConditioningSetMask', 'ConditioningZeroOut', 'InpaintModelConditioning', 'CFGGuider', 'BasicGuider'],
    LATENT: ['VAEDecode', 'KSampler', 'LatentUpscale', 'LatentUpscaleBy', 'KSamplerAdvanced', 'SetLatentNoiseMask', 'VAEDecodeTiled', 'LatentComposite', 'RepeatLatentBatch'],
    IMAGE: ['PreviewImage', 'SaveImage', 'VAEEncode', 'ImageScale', 'ImageScaleBy', 'ImageInvert', 'ImageBatch', 'ImagePadForOutpaint', 'CLIPVisionEncode', 'ControlNetApplyAdvanced'],
    MASK: ['MaskToImage', 'InvertMask', 'FeatherMask', 'GrowMask', 'SolidMask', 'SetLatentNoiseMask', 'InpaintModelConditioning', 'MaskComposite'],
    VIDEO: ['SaveVideo', 'GetVideoComponents', 'CreateVideo', 'VHS_VideoCombine'],
    AUDIO: ['SaveAudio', 'PreviewAudio'],
    CONTROL_NET: ['ControlNetApplyAdvanced', 'ControlNetApply'],
    CLIP_VISION: ['CLIPVisionEncode', 'unCLIPConditioning'],
    STYLE_MODEL: ['StyleModelApply'],
    UPSCALE_MODEL: ['ImageUpscaleWithModel'],
    SIGMAS: ['SamplerCustomAdvanced', 'SamplerCustom', 'SplitSigmas'],
    SAMPLER: ['SamplerCustomAdvanced', 'SamplerCustom'],
    GUIDER: ['SamplerCustomAdvanced'],
    NOISE: ['SamplerCustomAdvanced']
  };

  /* Describe which output slots of `node` match inputs of `targetType` */
  function matchingSlotsDesc(node, targetType) {
    if (!node || !SRV.types || !SRV.types[targetType]) return '';
    var def = SRV.types[targetType];
    var inpGroups = (def && def.input) || {};
    var req = inpGroups.required || {};
    var opt = inpGroups.optional || {};
    var targetInTypes = {};
    Object.keys(req).concat(Object.keys(opt)).forEach(function (k) {
      var spec = req[k] || opt[k];
      var t = Array.isArray(spec) ? spec[0] : spec;
      if (typeof t === 'string') targetInTypes[t.toUpperCase()] = 1;
    });
    var matched = [];
    (node.outputs || []).forEach(function (o) {
      var ot = String((o && o.type) || '').toUpperCase();
      if (ot && targetInTypes[ot] && matched.indexOf(ot) < 0) matched.push(ot);
    });
    return matched.join(' + ');
  }

  /* Extract normalized output slot types for a node (or upstream feed if it has no outputs) */
  function nodeOutputSlotTypes(node) {
    if (!node) return [];
    var types = [];
    (node.outputs || []).forEach(function (o) {
      var t = String((o && o.type) || '').toUpperCase().trim();
      if (t && t !== '*' && types.indexOf(t) < 0) types.push(t);
    });
    if (!types.length) {
      var feed = pickFeed(node);
      if (feed && feed.type) {
        var ft = String(feed.type).toUpperCase().trim();
        if (ft && ft !== '*') types.push(ft);
      }
    }
    return types;
  }

  /* Compute slot signature for storing per-slot-type custom Top Bar buttons */
  function slotSig(node) {
    if (!node) return 'canvas';
    if (ndKind(node) === 'api') return 'api:' + genOut(node);
    var outs = nodeOutputSlotTypes(node);
    if (outs.length) return 'out:' + outs.join('+');
    var ins = [];
    (node.inputs || []).forEach(function (inp) {
      var t = String((inp && inp.type) || '').toUpperCase().trim();
      if (t && t !== '*' && ins.indexOf(t) < 0) ins.push(t);
    });
    if (ins.length) return 'in:' + ins.join('+');
    return 'kind:' + ndKind(node);
  }

  /* Dynamically suggest nodes that can connect to `node`'s outputs (or Swap models if API node) */
  function suggestNodesFor(node, count) {
    var max = count || 5;
    if (!node) {
      var canvasDefaults = ['LoadImage', 'CheckpointLoaderSimple', 'KSampler', 'CLIPTextEncode', 'EmptyLatentImage', 'LoraLoader', 'SaveImage'];
      var cOut = [];
      canvasDefaults.forEach(function (t) {
        if (cOut.length < max && (hasType(t) || !SRV.probed) && !isDeprecatedType(t)) cOut.push('node:' + t);
      });
      return cOut;
    }

    /* API nodes, and subgraphs that run a model, use Swap mode with the top models */
    if (ndKind(node) === 'api' || isSwapSub(node)) {
      var apiMods = hbTopModels(node, max).map(function (m) { return 'model:' + m.type; });
      if (apiMods.length) return apiMods;
    }

    var outTypes = nodeOutputSlotTypes(node);
    var bySlot = {};
    outTypes.forEach(function (st) {
      var list = [];
      var curated = CURATED_BY_SLOT[st] || [];
      curated.forEach(function (cand) {
        if ((hasType(cand) || !SRV.probed) && !isDeprecatedType(cand)) list.push(cand);
      });
      /* Supplement with any installed node from SRV.types that accepts `st` as input */
      if (SRV.types && list.length < max * 2) {
        Object.keys(SRV.types).forEach(function (tName) {
          if (list.indexOf(tName) >= 0) return;
          if (SRV.api && SRV.api[tName]) return;
          if (isDeprecatedType(tName)) return;
          var def = SRV.types[tName];
          var inp = (def && def.input) || {};
          var req = inp.required || {};
          var keys = Object.keys(req);
          for (var i = 0; i < keys.length; i++) {
            var spec = req[keys[i]];
            var inT = Array.isArray(spec) ? spec[0] : spec;
            if (typeof inT === 'string' && inT.toUpperCase() === st) {
              list.push(tName);
              break;
            }
          }
        });
      }
      bySlot[st] = list;
    });

    /* Interleave candidates across all output slots of `node` so e.g. MODEL + CLIP suggests nodes for both */
    var picked = [];
    var maxDepth = 20;
    for (var d = 0; d < maxDepth && picked.length < max; d++) {
      for (var s = 0; s < outTypes.length && picked.length < max; s++) {
        var arr = bySlot[outTypes[s]] || [];
        if (d < arr.length && !hbSameNode(arr[d], node)) {
          var candUid = 'node:' + arr[d];
          if (picked.indexOf(candUid) < 0) picked.push(candUid);
        }
      }
    }

    /* If node had no outputs (e.g. SaveImage), suggest nodes that feed its inputs or common nodes */
    if (!picked.length) {
      var fallback = ['PreviewImage', 'SaveImage', 'KSampler', 'CLIPTextEncode', 'VAEDecode'];
      fallback.forEach(function (t) {
        if (picked.length < max && (hasType(t) || !SRV.probed) && !hbSameNode(t, node) && !isDeprecatedType(t)) picked.push('node:' + t);
      });
    }
    return picked.slice(0, max);
  }

  function defaultBarUids(barName, node) {
    if (barName === 'add') {
      return suggestNodesFor(node, 5);
    }
    if (barName === 'tools') {
      var ctx = hbContextTools(node);
      /* a crop keeps all its ratio segments; other nodes show their first six tools */
      return (isCropNode(node) ? ctx : ctx.slice(0, 6)).map(function (t) { return 'tool:' + t.id; });
    }
    if (barName === 'bot') {
      /* Every action is listed and each one shows only where it applies (resolveBarItem), so the first
         customization, wherever it happens, keeps them all */
      var out = BOT_DEFAULTS.slice();
      hbPinList(node).forEach(function (t) {
        var u = 'node:' + t;
        if (out.indexOf(u) < 0) out.push(u);
      });
      (S.templates || []).forEach(function (t) { out.push('tpl:' + t.id); });
      var tl = libSaveTarget();
      if (tl) tl.buttons.forEach(function (t) { out.push('tpl:' + t.id); });
      return out;
    }
    return [];
  }

  function getBarUids(barName, node) {
    if (barName === 'add') {
      var sig = slotSig(node);
      if (S.customAddBySig && Array.isArray(S.customAddBySig[sig])) {
        return S.customAddBySig[sig].slice();
      }
      return defaultBarUids('add', node);
    }
    if (barName === 'tools') {
      var b = hbBucket(node);
      if (S.customToolsBar && Array.isArray(S.customToolsBar[b])) {
        return S.customToolsBar[b].slice();
      }
      return defaultBarUids('tools', node);
    }
    if (barName === 'bot') {
      if (Array.isArray(S.customBotBar)) return S.customBotBar.slice();
      return defaultBarUids('bot', node);
    }
    return [];
  }

  function setBarUids(barName, node, uids) {
    var clean = [];
    (uids || []).forEach(function (u) {
      if (u && clean.indexOf(u) < 0) clean.push(u);
    });
    if (barName === 'add') {
      var sig = slotSig(node);
      if (!S.customAddBySig || typeof S.customAddBySig !== 'object') S.customAddBySig = {};
      S.customAddBySig[sig] = clean;
    } else if (barName === 'tools') {
      var b = hbBucket(node);
      if (!S.customToolsBar || typeof S.customToolsBar !== 'object') S.customToolsBar = {};
      S.customToolsBar[b] = clean;
    } else if (barName === 'bot') {
      S.customBotBar = clean;
    }
    save();
  }

  function toggleBarItem(barName, node, uid) {
    var cur = getBarUids(barName, node);
    var idx = cur.indexOf(uid);
    if (idx >= 0) {
      cur.splice(idx, 1);
      setBarUids(barName, node, cur);
      setStatus('ok', 'Removed from ' + (barName === 'add' ? 'Top Add Bar' : (barName === 'tools' ? 'Tools Bar' : 'Bottom Bar')));
    } else {
      cur.push(uid);
      setBarUids(barName, node, cur);
      setStatus('ok', '＋ Added to ' + (barName === 'add' ? 'Top Add Bar' : (barName === 'tools' ? 'Tools Bar' : 'Bottom Bar')) + ' (Hold & drag any button to reorder)');
    }
  }

  /* A key of its own for a bar button (Edit Button → Key): one key, no Ctrl / Alt, kept by the button's uid.
     It works while the button shows, and takes the key over from whatever had it in the hotbox */
  function hbKeyFor(uid) {
    return (S.customKeys && typeof S.customKeys === 'object' && S.customKeys[uid]) || '';
  }

  function hbKeyName(k) {
    k = String(k || '');
    return k.length <= 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1);
  }

  var HB_KEY_BUILTIN = { f: 'opens Search', n: 'opens the image / video kit', a: 'opens Models & APIs', u: 'opens Subgraphs', '+': 'opens the + menu',
    '=': 'opens the + menu', p: 'steps the seed mode', l: 'adds a label', f2: 'renames the node', r: 'adds a reroute', s: 'adds a Set bus',
    g: 'groups the selection', v: 'is Load in Canvas', t: 'adds a preview', b: 'bypasses the node', m: 'mutes the node', k: 'bypasses every API node',
    z: 'opens the Magnifier', '.': 'frames the selection', w: 'swaps two nodes', x: 'is Save as Button', c: 'runs the first button of the context bar' };

  /* who has that key already, if anyone: another button's own key (it moves), or something the hotbox does with it */
  function hbKeyClash(k, uid) {
    var other = '';
    Object.keys(S.customKeys || {}).forEach(function (u) { if (u !== uid && S.customKeys[u] === k) other = u; });
    if (other) return hbKeyName(k) + ' is the key of "' + hbUidLabel(other) + '": it moves to this button';
    if (/^[1-9]$/.test(k)) return k + ' is also button ' + k + ' of the dock: this button takes the key while it shows';
    if (HB_KEY_BUILTIN[k]) return hbKeyName(k) + ' ' + HB_KEY_BUILTIN[k] + ' in the hotbox: this button takes the key while it shows';
    return '';
  }

  /* The one name a button shows everywhere (bars, drawer, Settings, the button browser). A saved button of your
     own and a group keep it in themselves; anything else (a tool, a node, a shared library's button) keeps the
     name you gave it in customLabels */
  function hbBtnName(uid, own) {
    return (S.customLabels && S.customLabels[uid]) || own || '';
  }

  function hbUidLabel(uid) {
    var u = String(uid || ''), it = null;
    try { it = resolveBarItem(u, HB.node, true); } catch (e) { it = null; }
    if (it) return it.label;
    if (/^grp:/.test(u)) { var g = grpById(u.slice(4)); return hbBtnName(u, g ? g.name : 'Group'); }
    if (/^tpl:/.test(u)) { var t = tplById(u.slice(4)); return hbBtnName(u, t ? t.name : 'Saved button'); }
    return hbBtnName(u, u.replace(/^[a-z]+:/, ''));
  }

  /* Edit Button: a click on a button in edit mode, or a right-click on it any time, opens this. Its name, a
     color (on its mark: the dot, icon or number at its start; or on the whole button, shown on a copy of the
     button as it changes), a key of its own and, for a saved button, its nodes. The color is for the button
     only: nodes keep theirs */
  function promptRenameBarItem(uid, node, btnEl) {
    var item = resolveBarItem(uid, node, true);
    if (!item) return;
    var ownTpl = /^tpl:/.test(uid) ? tplById(uid.slice(4)) : null;
    var canNodes = !!(ownTpl && (!ownTpl.lib || ownTpl.canDelete));
    var nSel = canNodes ? mgItems(null).filter(isGraphNode).length : 0;
    var key = hbKeyFor(uid), grabbing = false, keyNote = '';
    var defKey = '';
    try {
      var numEl = btnEl && btnEl.querySelector(':scope > .shb-num');
      defKey = key ? '' : ((numEl && numEl.textContent) || (item.kind === 'tool' && item.kbd) || '');
    } catch (e) { defKey = ''; }
    var lead = '';
    try {
      var src = btnEl && btnEl.querySelector(':scope > .shb-num, :scope > .shb-pin-dot, :scope > .shb-tpl-ico, :scope > .shb-ico');
      lead = src ? src.outerHTML : '';
    } catch (e) {}
    if (!lead) lead = /^grp:/.test(uid) ? ico('folder', 15) : (/^tpl:/.test(uid) ? '<span class="shb-tpl-ico">' + ico('sparkles', 15) + '</span>' : '<i class="shb-pin-dot"></i>');
    var cur = (S.customColors && S.customColors[uid]) || '';
    var fill = !!(S.customFill && S.customFill[uid]);
    var bg = owns(document.createElement('div'));
    bg.className = 'shb-modal-bg';
    bg.innerHTML =
      '<div class="shb-modal" style="width:min(430px,92vw)">' +
        '<div class="shb-modal-t"><span>Edit Button</span></div>' +
        '<div class="shb-ebtn-prev"><span class="shb-btn" data-rbi-prev>' + lead + '<span class="shb-lbl" data-rbi-plbl>' + esc(item.label) + '</span></span></div>' +
        '<div class="shb-ebtn-row"><span>Name</span><input class="shb-input" style="flex:1" data-rbi-in value="' + esc(item.label) + '" placeholder="Custom button name…"></div>' +
        '<div class="shb-ebtn-row"><span>Color</span><div class="shb-swatches">' +
          HB_SWATCHES.map(function (sw, i) {
            var on = i ? cur === sw.name : !cur;
            return '<i class="shb-swatch' + (on ? ' shb-on' : '') + '" data-rbi-col="' + (i ? esc(sw.name) : '') + '" style="background:' + sw.dot + '" title="' + esc(i ? sw.name : 'Default color') + '"></i>';
          }).join('') +
        '</div></div>' +
        '<div class="shb-ebtn-row"><span>Paint</span><span class="shb-seg shb-ebtn-seg" data-rbi-seg>' +
          '<button type="button" data-rbi-fill="0" title="Only its dot, icon or number">Mark</button>' +
          '<button type="button" data-rbi-fill="1" title="The whole button, in a soft shade of the color">Whole button</button>' +
        '</span></div>' +
        '<div class="shb-ebtn-note">Pick a color, then paint just the mark or the whole button, so you can find it at a glance. Nodes keep their own colors.</div>' +
        '<div class="shb-ebtn-row"><span>Key</span>' +
          '<button type="button" class="shb-btn shb-btn-pri shb-ebtn-key" data-rbi-key title="Click, then press the key that runs this button while the hotbox is open"></button>' +
          '<button type="button" class="shb-btn" data-rbi-keyclr title="No key of its own">Clear</button>' +
        '</div>' +
        '<div class="shb-ebtn-note" data-rbi-keynote></div>' +
        (canNodes ? '<div class="shb-ebtn-row"><span>Nodes</span>' +
          '<button type="button" class="shb-btn shb-btn-pri" data-rbi-nodes title="Open what this button holds: change a node\'s values or title, take a node out, or edit its JSON. It stays the same button">' + ico('edit', 13) + '<span>Edit its ' + esc(ownTpl.count) + (ownTpl.count === 1 ? ' node…' : ' nodes…') + '</span></button>' +
          '<button type="button" class="shb-btn shb-btn-pri' + (nSel ? '' : ' shb-na') + '" data-rbi-take title="' + (nSel ? 'The button takes the ' + nSel + ' selected ' + (nSel === 1 ? 'node' : 'nodes') + ' instead of the ones it holds, and stays the same button: same place, name, color and key'
            : 'Select nodes on the canvas first: the button takes them instead of the ones it holds') + '">' + ico('sync', 13) + '<span>Use selection' + (nSel ? ' (' + nSel + ')' : '') + '</span></button>' +
        '</div>' : '') +
        '<div style="display:flex;justify-content:space-between;gap:8px">' +
          '<button class="shb-btn" data-rbi-reset title="Back to its own name and color, and no key of its own">Reset</button>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="shb-btn" data-rbi-cancel>Cancel</button>' +
            '<button class="shb-btn shb-btn-pri" data-rbi-ok>Save</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bg);
    var inp = bg.querySelector('[data-rbi-in]');
    var prev = bg.querySelector('[data-rbi-prev]');
    function paintPrev() {
      var c = '';
      for (var i = 1; cur && i < HB_SWATCHES.length; i++) if (HB_SWATCHES[i].name === cur) c = HB_SWATCHES[i].dot;
      prev.classList.toggle('shb-tinted', !!c);
      prev.classList.toggle('shb-filled', !!c && fill);
      prev.style.setProperty('--shb-tint', c || '');
      Array.prototype.forEach.call(bg.querySelectorAll('[data-rbi-col]'), function (el) {
        el.classList.toggle('shb-on', el.getAttribute('data-rbi-col') === cur);
      });
      /* with the default color there is nothing to paint */
      bg.querySelector('[data-rbi-seg]').classList.toggle('shb-off', !c);
      Array.prototype.forEach.call(bg.querySelectorAll('[data-rbi-fill]'), function (el) {
        el.classList.toggle('shb-on', (el.getAttribute('data-rbi-fill') === '1') === fill);
      });
    }
    paintPrev();
    var keyBtn = bg.querySelector('[data-rbi-key]');
    function paintKey() {
      keyBtn.textContent = grabbing ? 'Press a key…' : (key ? hbKeyName(key) : (defKey ? defKey + ' (as it comes)' : 'None'));
      keyBtn.classList.toggle('shb-btn-on', grabbing);
      bg.querySelector('[data-rbi-keynote]').textContent = grabbing ? 'A letter, a number, a sign or F1–F12 · Esc keeps it as it is · Backspace clears it'
        : (keyNote || (key ? hbKeyClash(key, uid) || hbKeyName(key) + ' runs this button while the hotbox is open and the button shows.' : 'Click the key, then press the one that runs this button while the hotbox is open.'));
    }
    function grab(ev) {
      var k = String(ev.key || '');
      if (/^(Shift|Control|Alt|Meta|AltGraph|CapsLock)$/.test(k)) return;
      grabbing = false;
      HB.keyGrab = null;
      keyNote = '';
      var kl = k.toLowerCase();
      if (k === 'Backspace' || k === 'Delete') key = '';
      else if (k === 'Escape') keyNote = '';
      else if (ev.ctrlKey || ev.altKey || ev.metaKey || !((kl.length === 1 && kl !== ' ') || /^f([1-9]|1[0-2])$/.test(kl))) {
        keyNote = 'One key on its own, without Ctrl or Alt: a letter, a number, a sign or F1–F12.';
      } else if (hbIsKey(ev) && !S.hbMods) keyNote = hbKeyName(kl) + ' opens and closes the hotbox: pick another key.';
      else key = kl;
      paintKey();
    }
    paintKey();
    var done = false;
    function close() {
      if (done) return;
      done = true;
      if (HB.keyGrab === grab) HB.keyGrab = null;
      modalShut(close);
      if (bg.parentNode) bg.parentNode.removeChild(bg);
    }
    modalOpen(close);
    function saveBtn(val, col, whole, k) {
      hbUndoPush('editing "' + item.label + '"');
      if (!S.customLabels || typeof S.customLabels !== 'object') S.customLabels = {};
      if (!S.customColors || typeof S.customColors !== 'object') S.customColors = {};
      if (!S.customFill || typeof S.customFill !== 'object') S.customFill = {};
      if (!S.customKeys || typeof S.customKeys !== 'object') S.customKeys = {};
      var grp = /^grp:/.test(uid) ? grpById(uid.slice(4)) : null;
      /* a saved button of your own and a group carry their name themselves, so it is the same everywhere */
      if (ownTpl && !ownTpl.lib) { if (val) ownTpl.name = val; delete S.customLabels[uid]; }
      else if (grp) { if (val) grp.name = val; delete S.customLabels[uid]; }
      else if (val && val !== item.label || val && S.customLabels[uid]) S.customLabels[uid] = val;
      else if (!val) delete S.customLabels[uid];
      if (col) S.customColors[uid] = col;
      else delete S.customColors[uid];
      if (col && whole) S.customFill[uid] = true;
      else delete S.customFill[uid];
      if (k) {
        Object.keys(S.customKeys).forEach(function (u) { if (S.customKeys[u] === k) delete S.customKeys[u]; });
        S.customKeys[uid] = k;
      } else delete S.customKeys[uid];
      save();
      close();
      hbRedrawAll();
    }
    bg.addEventListener('mousedown', function (ev) { if (ev.target === bg) close(); });
    bg.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target : null;
      var sw = t && t.closest('[data-rbi-col]');
      var fb = t && t.closest('[data-rbi-fill]');
      if (sw) cur = sw.getAttribute('data-rbi-col');
      else if (fb) fill = fb.getAttribute('data-rbi-fill') === '1';
      else return;
      paintPrev();
    });
    inp.oninput = function () {
      bg.querySelector('[data-rbi-plbl]').textContent = String(inp.value || '').trim() || item.label;
    };
    keyBtn.onclick = function () {
      grabbing = !grabbing;
      HB.keyGrab = grabbing ? grab : null;
      try { keyBtn.focus(); } catch (e) {}
      paintKey();
    };
    bg.querySelector('[data-rbi-keyclr]').onclick = function () {
      grabbing = false;
      HB.keyGrab = null;
      key = '';
      keyNote = '';
      defKey = '';
      paintKey();
    };
    var nodesB = bg.querySelector('[data-rbi-nodes]'), takeB = bg.querySelector('[data-rbi-take]');
    if (nodesB) nodesB.onclick = function () { close(); tplEditOpen(ownTpl.id); };
    if (takeB) takeB.onclick = function () {
      var items = mgItems(null), nodes = items.filter(isGraphNode);
      if (!nodes.length) { setStatus('error', 'Select the nodes on the canvas first, then use them for this button'); return; }
      /* it replaces what the button holds, so it takes a second click */
      if (!takeB.classList.contains('shb-armed')) {
        takeB.classList.add('shb-armed');
        takeB.querySelector('span').textContent = 'Click again: replace its nodes';
        return;
      }
      var data = null;
      try { data = mgSerialize(items); } catch (e) { data = null; }
      if (!data || !data.nodes || !data.nodes.length) { setStatus('error', 'Could not read those nodes'); return; }
      close();
      tplSetData(ownTpl, data, 'replacing the nodes of "' + ownTpl.name + '"').then(function (ok) {
        if (ok) setStatus('ok', '✓ "' + ownTpl.name + '" now holds the ' + data.nodes.length + ' selected ' + (data.nodes.length === 1 ? 'node' : 'nodes') + ' · same button, same place · what it held before is kept in its versions');
      });
    };
    bg.querySelector('[data-rbi-cancel]').onclick = close;
    bg.querySelector('[data-rbi-reset]').onclick = function () { saveBtn('', '', false, ''); };
    bg.querySelector('[data-rbi-ok]').onclick = function () { saveBtn(String(inp.value || '').trim(), cur, fill, key); };
    inp.onkeydown = function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); saveBtn(String(inp.value || '').trim(), cur, fill, key); }
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    };
    try { inp.focus(); inp.select(); } catch (e) {}
  }

  /* ---------------------------------------------------------------------
   * BUTTON GROUPS: drop one bar button on the middle of another and the two become a group; drop more on it
   * to fill it. Hovering a group opens its buttons in a list under it; its arrow keeps it open (or closes it).
   * Stored as S.hbGroups[id] = { name, items: [uid…] } and placed in a bar like any button, as 'grp:<id>'.
   * A group kept open folds up again when the hotbox closes.
   * --------------------------------------------------------------------- */
  function grpById(id) {
    return (S.hbGroups && typeof S.hbGroups === 'object' && S.hbGroups[id]) || null;
  }

  function grpNew() {
    if (!S.hbGroups || typeof S.hbGroups !== 'object') S.hbGroups = {};
    var names = Object.keys(S.hbGroups).map(function (k) { return S.hbGroups[k].name; });
    var n = 1;
    while (names.indexOf('Group ' + n) >= 0) n++;
    var id = 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    S.hbGroups[id] = { name: 'Group ' + n, items: [] };
    return id;
  }

  /* A group leaving a bar hands its buttons back to that bar, in its place */
  function grpDissolve(barName, uid, node) {
    var gid = String(uid).slice(4), grp = grpById(gid);
    var list = getBarUids(barName, node), at = list.indexOf(uid);
    var kids = grp ? (grp.items || []).filter(function (k) { return list.indexOf(k) < 0; }) : [];
    if (at >= 0) Array.prototype.splice.apply(list, [at, 1].concat(kids));
    if (grp) delete S.hbGroups[gid];
    if (S.customLabels) delete S.customLabels[uid];
    if (S.customColors) delete S.customColors[uid];
    if (S.customFill) delete S.customFill[uid];
    if (S.customKeys) delete S.customKeys[uid];
    delete HB.grpOpen[gid];
    setBarUids(barName, node, list);
    return kids.length;
  }

  /* A group down to one button, or none, no longer unfolds by itself: it asks first, once. Kept, it stays in
     its bar with its name and color (empty too) until its × ungroups it; removed, it unfolds as it always did.
     The question waits for the next tick, so the click that ends a drag can never answer it */
  var GRP_ASK = null, GRP_ASK_T = 0;

  function grpAskLone(node) {
    if (GRP_ASK || GRP_ASK_T) return;
    GRP_ASK_T = setTimeout(function () {
      GRP_ASK_T = 0;
      if (GRP_ASK) return;
      var found = null;
      ['add', 'tools', 'bot'].forEach(function (barName) {
        getBarUids(barName, node).forEach(function (u) {
          var g = !found && /^grp:/.test(u) ? grpById(u.slice(4)) : null;
          if (g && !g.keep && (g.items || []).length < 2) found = { gid: u.slice(4), bar: barName };
        });
      });
      if (found) grpAskKeep(found.gid, found.bar, node);
    }, 0);
  }

  function grpAskKeep(gid, barName, node) {
    var grp = grpById(gid);
    if (!grp || grp.keep || GRP_ASK) return;
    var uid = 'grp:' + gid;
    var name = (S.customLabels && S.customLabels[uid]) || grp.name;
    var left = (grp.items || []).length;
    var bg = owns(document.createElement('div'));
    bg.className = 'shb-modal-bg';
    bg.innerHTML =
      '<div class="shb-modal" style="width:min(400px,92vw)">' +
        '<div class="shb-modal-t"><span>Keep the group "' + esc(name) + '"?</span></div>' +
        '<div class="shb-ebtn-note" style="font-size:12.5px">' +
          (left ? 'It has one button left. ' : 'It has no buttons left. ') +
          'Keep it in the bar, with its name and color, to fill it again; or remove it' +
          (left ? ' and its last button goes back to the bar.' : '.') +
        '</div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px">' +
          '<button class="shb-btn" data-gk-no>Remove group</button>' +
          '<button class="shb-btn shb-btn-pri" data-gk-yes>Keep group</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bg);
    function answer(keep) {
      if (!GRP_ASK) return;
      GRP_ASK = null;
      if (bg.parentNode) bg.parentNode.removeChild(bg);
      var g = grpById(gid);
      if (g && keep) {
        g.keep = true;
        save();
        setStatus('ok', 'Kept the group "' + name + '" · drop buttons on it to fill it · its × (edit mode) removes it');
      } else if (g) {
        hbUndoPush('removing the group "' + name + '"');
        var back = grpDissolve(barName, uid, node);
        setStatus('ok', 'Removed the group "' + name + '"' + (back ? ' · its button stays in the bar' : ''));
      }
      if (HB.el) hbPaint();
      /* another group may have been emptied by the same move */
      grpAskLone(node);
    }
    /* Enter and Esc keep it (the window key listener): closing the question never loses a group */
    GRP_ASK = { answer: answer };
    bg.addEventListener('mousedown', function (ev) { if (ev.target === bg) answer(true); });
    bg.querySelector('[data-gk-no]').onclick = function () { answer(false); };
    bg.querySelector('[data-gk-yes]').onclick = function () { answer(true); };
    try { bg.querySelector('[data-gk-yes]').focus(); } catch (e) {}
  }

  /* A button that already lives in a group of this bar is not drawn twice */
  function hbUngrouped(items) {
    var inGrp = {};
    items.forEach(function (it) {
      if (it.kind === 'group') it.kids.forEach(function (k) { inGrp[k.uid] = 1; });
    });
    return items.filter(function (it) { return it.kind === 'group' || !inGrp[it.uid]; });
  }

  function renderGroupHTML(item, barName, numKey) {
    var pin = !!HB.grpOpen[item.id];
    var isz = hbIsFluid() ? 15 : 13;
    var tint = barTintAttrs(item.uid);
    var cls = 'shb-btn ' + (barName === 'add' ? 'shb-fav' : (barName === 'bot' ? 'shb-act' : 'shb-tool')) + ' shb-grp-btn' + tint.cls;
    return '<span class="shb-item-wrap shb-grp' + (pin ? ' shb-grp-show shb-grp-pin' : '') + '" data-hb-uid="' + esc(item.uid) + '" data-hb-bar="' + esc(barName) + '" data-hb-gkey="' + esc(item.id) + '">' +
      '<button type="button" class="' + cls + '"' + tint.style + ' data-hb-run="' + esc(item.uid) + '" title="' + esc(item.title) + '">' +
        (numKey || hbKeyFor(item.uid) ? '<span class="shb-num">' + esc(hbKeyName(hbKeyFor(item.uid)) || numKey) + '</span>' : ico('folder', isz)) +
        '<span class="shb-lbl">' + esc(item.label) + '</span>' +
        '<span class="shb-w-badge">' + esc(item.count) + '</span>' +
        '<span class="shb-grp-chev" data-hb-grpchev title="Keep it open · click again to close it">' + ico('chevDown', 12) + '</span>' +
        '<span class="shb-x" data-hb-rm="' + esc(item.uid) + '" data-hb-rmbar="' + esc(barName) + '" title="Ungroup (the buttons stay in the bar)">×</span>' +
      '</button>' +
      '<span class="shb-gdrop" data-hb-gtray="' + esc(item.id) + '">' +
        item.kids.map(function (k) { return renderBarItemHTML(k, barName, 0, item.id); }).join('') +
      '</span>' +
    '</span>';
  }

  function hbGroupToggle(gid) {
    var wrap = HB.el && HB.el.querySelector('.shb-grp[data-hb-gkey="' + cssEsc(gid) + '"]');
    if (wrap) hbGrpClick(wrap);
  }

  function hbStyleName() {
    return !hbIsFluid() ? 'quiet' : (S.hbStyle === 'classic' ? 'compact' : 'fluid');
  }

  /* The arrow (or a click on the group): open and keep open, or close and stay closed until the pointer
     leaves */
  function hbGrpClick(wrap) {
    var key = wrap.getAttribute('data-hb-gkey');
    if (HB.grpOpen[key]) {
      delete HB.grpOpen[key];
      wrap.classList.remove('shb-grp-pin');
      wrap._mute = true;
      hbDropHide(wrap);
    } else {
      HB.grpOpen[key] = true;
      wrap.classList.add('shb-grp-pin');
      wrap._mute = false;
      hbDropShow(wrap);
    }
  }

  /* Hover opens a group (a beat later while dragging, so passing over does not flash it); leaving closes it
     unless it is kept open */
  function hbWireGroups(el) {
    el.addEventListener('mouseover', function (e) {
      var w = e.target && e.target.closest ? e.target.closest('.shb-grp[data-hb-gkey]') : null;
      if (!w || (e.relatedTarget && w.contains(e.relatedTarget))) return;
      clearTimeout(w._hideT);
      if (w._mute) return;
      var dragging = !!((LP_DRAG && LP_DRAG.active) || (DRAWER_DRAG && DRAWER_DRAG.active));
      clearTimeout(w._showT);
      w._showT = setTimeout(function () { hbDropShow(w); }, dragging ? 280 : 70);
    });
    el.addEventListener('mouseout', function (e) {
      var w = e.target && e.target.closest ? e.target.closest('.shb-grp[data-hb-gkey]') : null;
      if (!w || (e.relatedTarget && w.contains(e.relatedTarget))) return;
      clearTimeout(w._showT);
      w._mute = false;
      if (HB.grpOpen[w.getAttribute('data-hb-gkey')]) return;
      clearTimeout(w._hideT);
      w._hideT = setTimeout(function () { hbDropHide(w); }, 260);
    });
  }

  /* The list drops under its button, or above it when the screen ends, and slides sideways to stay on screen */
  function hbDropFit(drop) {
    drop.classList.remove('shb-gdrop-up');
    drop.style.setProperty('--gx', '0px');
    var W = window.innerWidth || 1600, H = window.innerHeight || 900, z = parseFloat(S.hbScale) || 1;
    var r = drop.getBoundingClientRect();
    if (r.bottom > H - 10) {
      var b = drop.parentNode.getBoundingClientRect();
      if (b.top - r.height - 8 > 10) drop.classList.add('shb-gdrop-up');
    }
    var dx = r.left < 10 ? 10 - r.left : (r.right > W - 10 ? (W - 10) - r.right : 0);
    if (dx) drop.style.setProperty('--gx', Math.round(dx / z) + 'px');
  }

  function hbDropAnims(drop) {
    (drop._anims || []).forEach(function (a) { try { a.cancel(); } catch (e) {} });
    drop._anims = [];
    return function (el, kf, op) {
      try { var a = el.animate(kf, op); drop._anims.push(a); return a; } catch (e) { return null; }
    };
  }

  /* Opening: the list unfolds from its button and its buttons fall in one after another — a soft spring in
     Fluid, little balloons in Compact, a quiet slide in Quiet */
  function hbDropShow(wrap) {
    if (!HB.el || !wrap || !wrap.isConnected || wrap.classList.contains('shb-grp-show') && !wrap._closing) return;
    var drop = wrap.querySelector(':scope > .shb-gdrop');
    if (!drop || !drop.children.length) return;
    wrap._closing = false;
    wrap.classList.add('shb-grp-show');
    hbDropFit(drop);
    var up = drop.classList.contains('shb-gdrop-up'), sg = up ? 1 : -1;
    var st = hbStyleName(), run = hbDropAnims(drop);
    var D = { fluid: [190, 300, 24], compact: [150, 210, 15], quiet: [110, 130, 8] }[st];
    run(drop, [{ opacity: 0, transform: 'translateY(' + (sg * 6) + 'px) scale(' + (st === 'quiet' ? 1 : 0.96) + ')' }, { opacity: 1, transform: 'none' }],
      { duration: D[0], easing: 'cubic-bezier(.2,.9,.1,1)' });
    var kids = Array.prototype.slice.call(drop.children);
    if (up) kids.reverse();
    kids.forEach(function (k, i) {
      var kf = st === 'compact'
        ? [{ opacity: 0, transform: 'scale(.45)' }, { opacity: 1, transform: 'scale(1.06)', offset: 0.6 }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 0, transform: 'translateY(' + (sg * (st === 'fluid' ? 10 : 4)) + 'px)' + (st === 'fluid' ? ' scale(.92)' : '') }, { opacity: 1, transform: 'none' }];
      run(k, kf, {
        duration: D[1], delay: Math.round(D[0] * 0.15) + i * D[2], fill: 'backwards',
        easing: st === 'fluid' ? 'cubic-bezier(.34,1.32,.64,1)' : (st === 'compact' ? 'cubic-bezier(.3,1.2,.5,1)' : 'cubic-bezier(.2,0,0,1)')
      });
    });
  }

  /* Closing runs it back, faster */
  function hbDropHide(wrap) {
    if (!wrap || !wrap.classList.contains('shb-grp-show') || wrap._closing) return;
    var drop = wrap.querySelector(':scope > .shb-gdrop');
    if (!drop) { wrap.classList.remove('shb-grp-show'); return; }
    wrap._closing = true;
    var st = hbStyleName(), run = hbDropAnims(drop);
    var up = drop.classList.contains('shb-gdrop-up');
    var fade = run(drop, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(' + (up ? 4 : -4) + 'px) scale(' + (st === 'quiet' ? 1 : 0.97) + ')' }],
      { duration: st === 'fluid' ? 130 : (st === 'compact' ? 110 : 80), easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    function done() {
      if (!wrap._closing) return;
      wrap._closing = false;
      wrap.classList.remove('shb-grp-show');
      (drop._anims || []).forEach(function (a) { try { a.cancel(); } catch (e) {} });
      drop._anims = [];
    }
    if (fade) fade.finished.then(done, function () {});
    else done();
  }

  /* A new group lands with a pop and a soft ring, then shows what it holds while the pointer is on it */
  function hbGrpPop(gid) {
    var w = HB.el && HB.el.querySelector('.shb-grp[data-hb-gkey="' + cssEsc(gid) + '"]');
    var b = w && w.querySelector(':scope > .shb-btn');
    if (!b) return;
    var st = hbStyleName();
    try {
      b.animate(st === 'quiet'
        ? [{ transform: 'scale(.92)', opacity: 0.5 }, { transform: 'none', opacity: 1 }]
        : [{ transform: 'scale(.55)', opacity: 0.3 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.55 }, { transform: 'none', opacity: 1 }],
        { duration: st === 'fluid' ? 380 : (st === 'compact' ? 240 : 150), easing: st === 'quiet' ? 'cubic-bezier(.2,0,0,1)' : 'cubic-bezier(.3,1.25,.5,1)' });
      if (st !== 'quiet') {
        b.animate([{ boxShadow: '0 0 0 0 rgba(90,162,240,.6)' }, { boxShadow: '0 0 0 12px rgba(90,162,240,0)' }],
          { duration: 520, easing: 'cubic-bezier(.2,.9,.1,1)' });
      }
    } catch (e) {}
    setTimeout(function () { if (w.isConnected && w.matches(':hover')) hbDropShow(w); }, 220);
  }

  /* Dropping one button on the middle of another: a new group takes the second one's place and holds both */
  function hbMergeTarget(overWrap, dragWrap, x, y) {
    if (!overWrap || overWrap === dragWrap || overWrap.classList.contains('shb-grp')) return null;
    if (!overWrap.parentNode || !overWrap.parentNode.hasAttribute('data-hb-bar')) return null;
    var r = overWrap.getBoundingClientRect();
    if (x < r.left + r.width * 0.25 || x > r.right - r.width * 0.25 || y < r.top || y > r.bottom) return null;
    return overWrap;
  }

  function hbMergeDom(targetWrap, dragWrap) {
    var gid = grpNew();
    var holder = document.createElement('span');
    holder.className = 'shb-item-wrap shb-grp';
    holder.setAttribute('data-hb-uid', 'grp:' + gid);
    var drop = document.createElement('span');
    drop.setAttribute('data-hb-gtray', gid);
    holder.appendChild(drop);
    targetWrap.parentNode.insertBefore(holder, targetWrap);
    drop.appendChild(targetWrap);
    drop.appendChild(dragWrap);
    return gid;
  }

  /* A group or a fold opening: the tray grows out of its button while the buttons inside spring in one after
     another (Fluid), pop in like little balloons (Compact) or slide in quietly (Quiet). Closing runs it back,
     faster. The hotbox is laid out for the open tray first, so it stays centered while the tray grows. */
  function hbTrayAnim(btn, tray, open) {
    if (!HB.el || !btn || !tray) return;
    var st = !hbIsFluid() ? 'quiet' : (S.hbStyle === 'classic' ? 'compact' : 'fluid');
    var row = tray.classList.contains('shb-tray-row');
    var wrap = btn.closest('.shb-grp');
    btn.classList.toggle('shb-fold-on', open);
    if (wrap) wrap.classList.toggle('shb-grp-open', open);
    (tray._anims || []).forEach(function (a) { try { a.cancel(); } catch (e) {} });
    tray._anims = [];
    tray.classList.remove('shb-gtray-anim');
    var kids = Array.prototype.slice.call(tray.children);
    var z = parseFloat(S.hbScale) || 1;
    var T = { fluid: { grow: 240, shrink: 170, step: 28, kid: 320 }, compact: { grow: 170, shrink: 130, step: 18, kid: 210 }, quiet: { grow: 120, shrink: 90, step: 10, kid: 140 } }[st];
    var ease = st === 'quiet' ? 'cubic-bezier(.2,0,0,1)' : 'cubic-bezier(.2,.9,.1,1)';
    function run(el, kf, op) {
      try { var a = el.animate(kf, op); tray._anims.push(a); return a; } catch (e) { return null; }
    }
    function size(v) {
      var o = { opacity: v ? 1 : 0.35 };
      o[row ? 'height' : 'width'] = v + 'px';
      return o;
    }
    if (open) {
      tray.classList.add('shb-gtray-on');
      hbPlace();
      var r = tray.getBoundingClientRect();
      var full = Math.round((row ? r.height : r.width) / z);
      tray.classList.add('shb-gtray-anim');
      var grow = run(tray, [size(0), size(full)], { duration: T.grow, easing: ease });
      kids.forEach(function (k, i) {
        var kf = st === 'compact'
          ? [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1.07)', offset: 0.6 }, { opacity: 1, transform: 'none' }]
          : [{ opacity: 0, transform: st === 'fluid' ? (row ? 'translateY(-9px) scale(.9)' : 'translateX(-14px) scale(.84)') : (row ? 'translateY(-4px)' : 'translateX(-6px)') },
             { opacity: 1, transform: 'none' }];
        run(k, kf, {
          duration: T.kid, delay: Math.round(T.grow * 0.18) + i * T.step, fill: 'backwards',
          easing: st === 'fluid' ? 'cubic-bezier(.34,1.32,.64,1)' : (st === 'compact' ? 'cubic-bezier(.3,1.2,.5,1)' : ease)
        });
      });
      if (grow) grow.finished.then(function () { tray.classList.remove('shb-gtray-anim'); }, function () {});
      else tray.classList.remove('shb-gtray-anim');
      return;
    }
    var r2 = tray.getBoundingClientRect();
    var cur = Math.round((row ? r2.height : r2.width) / z);
    tray.classList.add('shb-gtray-anim');
    kids.slice().reverse().forEach(function (k, i) {
      run(k, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: st === 'compact' ? 'scale(.55)' : (row ? 'translateY(-4px)' : 'translateX(-8px) scale(.94)') }],
        { duration: Math.round(T.shrink * 0.7), delay: i * Math.round(T.step / 3), easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    });
    var shrink = run(tray, [size(cur), size(0)], { duration: T.shrink, delay: Math.min(70, kids.length * 7), easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    function done() {
      (tray._anims || []).forEach(function (a) { try { a.cancel(); } catch (e) {} });
      tray._anims = [];
      tray.classList.remove('shb-gtray-on', 'shb-gtray-anim');
      if (HB.el) hbPlace();
    }
    if (shrink) shrink.finished.then(done, function () {});
    else done();
  }

  function renderBarItemHTML(item, barName, numKey, grpId) {
    if (item.kind === 'group') return renderGroupHTML(item, barName, numKey);
    /* a key of its own shows where the button's key always shows: in the dock's number, or as its key chip */
    var ownKey = hbKeyName(hbKeyFor(item.uid));
    if (ownKey && numKey) numKey = ownKey;
    var kbdStr = numKey ? String(numKey) : (ownKey || item.kbd || '');
    var isTpl = item.kind === 'template';
    var isPin = (barName === 'bot' && item.kind !== 'tool') || isTpl;
    var btnCls = 'shb-btn ' + (barName === 'add' ? 'shb-fav' : (isPin ? 'shb-pin' : (barName === 'bot' ? 'shb-act' : 'shb-tool'))) + (isTpl ? ' shb-tpl' : '');
    if (barName === 'tools' && /^(cropedit|paintedit|lupa)$/.test(item.id)) btnCls += ' shb-btn-primary';
    if (item.id === 'apibypass') btnCls += ' shb-danger';
    if (item.cls && item.cls !== 'shb-btn-pri') btnCls += ' ' + item.cls;
    if (item.off) btnCls += ' shb-na';
    var lead = numKey ? '<span class="shb-num">' + esc(kbdStr) + '</span>'
      : (isTpl ? '<span class="shb-tpl-ico">' + ico('sparkles', hbIsFluid() ? 15 : 13) + '</span>'
        : (isPin ? '<i class="shb-pin-dot"></i>' : ico(item.icon || 'plus', hbIsFluid() ? 15 : 13)));
    var hint = isTpl ? 'Drag onto the canvas to drop it there · Hold to edit'
      : (isPin ? 'Drag out of the bar to unpin · Hold to edit' : 'Hold to edit · Drag out of the bar to remove');
    var tint = barTintAttrs(item.uid);
    return '<span class="shb-item-wrap" data-hb-uid="' + esc(item.uid) + '" data-hb-bar="' + esc(barName) + '">' +
      '<button type="button" class="' + btnCls + tint.cls + '"' + tint.style + ' data-hb-run="' + esc(item.uid) + '" title="' + esc(item.title + ' (' + hint + ')') + '">' +
        lead +
        '<span class="shb-lbl">' + esc(item.label) + '</span>' +
        (isTpl ? '<span class="shb-tpl-n">' + esc(item.count) + '</span>' : '') +
        (!numKey && (ownKey || !isPin) && kbdStr ? '<span class="shb-key">' + esc(kbdStr) + '</span>' : '') +
        '<span class="shb-x" data-hb-rm="' + esc(item.uid) + '" data-hb-rmbar="' + esc(barName) + '"' + (grpId ? ' data-hb-rmgrp="' + esc(grpId) + '"' : '') + ' title="Remove">×</span>' +
      '</button>' +
    '</span>';
  }

  function buildDrawerHTML(node, tools) {
    var d = HB.drawer;
    if (!d) return '';
    if (d === 'addcustom') d = 'search';
    var q = String(HB.q || '').toLowerCase().trim();
    var isAdd = ndAdds(node);
    var allPinned = getBarUids('add', node)
      .concat(getBarUids('tools', node))
      .concat(getBarUids('bot', node));

    var drawerTabsHTML =
      '<div style="display:flex;flex-direction:column;gap:4px">' +
        '<span class="shb-seg" style="width:100%;display:flex">' +
          '<button type="button" data-hb-drawer-tab="search" style="flex:1;justify-content:center"' + (d === 'search' ? ' class="shb-on"' : '') + '>Nodes</button>' +
          '<button type="button" data-hb-drawer-tab="tools" style="flex:1;justify-content:center"' + (d === 'tools' ? ' class="shb-on"' : '') + '>Tools</button>' +
          '<button type="button" data-hb-drawer-tab="models" style="flex:1;justify-content:center"' + (d === 'models' ? ' class="shb-on"' : '') + '>Models</button>' +
          '<button type="button" data-hb-drawer-tab="subs" style="flex:1;justify-content:center"' + (d === 'subs' ? ' class="shb-on"' : '') + '>Subgraphs</button>' +
        '</span>' +
        '<div class="shb-drawer-hint">Drag onto any bar or the + to pin · Click to add</div>' +
      '</div>';

    if (d === 'tools') {
      var mt = getMasterTools(node);
      var allToolIds = [
        'crop', 'stitch', 'stitchupd', 'rsz', 'flip', 'paint', 'cmp', 'saveimg', 'prev', 'loadcanvas',
        'gvc', 'batch', 'mkvid', 'savevid', 'wf', 'seed', 'lupa', 'label',
        'rename', 'reroute', 'set', 'addget', 'bypass', 'mute', 'render', 'swappair', 'magic', 'apibypass', 'zoom', 'arrange', 'seedtoggle'
      ];
      var allToolsList = allToolIds.filter(hbToolOn).map(function (id) { return mt[id]; }).filter(Boolean);
      var filteredTools = hbRankBy(allToolsList, q, function (t) { return [t.label, t.id]; });
      var resizeList = resizeKinds();
      function tplRank(list) { return hbRankBy(list || [], q, function (tp) { return [tp.name]; }); }
      function tplRow(tp) {
        var uid = 'tpl:' + tp.id;
        var inBar = allPinned.indexOf(uid) >= 0;
        return '<button type="button" class="shb-btn shb-btn-row shb-tpl" data-hb-run="' + esc(uid) + '" data-drawer-uid="' + esc(uid) + '" title="Drag to any bar to pin · Click to add the nodes" style="cursor:grab">' +
          '<span style="display:inline-flex;align-items:center;gap:8px;min-width:0"><span class="shb-tpl-ico">' + ico('sparkles') + '</span>' +
            '<span style="overflow:hidden;text-overflow:ellipsis">' + esc(tp.name) + '</span><span class="shb-tpl-n">' + esc(tp.count) + '</span></span>' +
          '<span style="display:inline-flex;align-items:center;gap:4px">' +
            (inBar ? '<span class="shb-inbar">✓</span>' : '') +
            (!tp.lib || tp.canDelete ? '<span class="shb-tpl-del" data-hb-tpldel="' + esc(tp.id) + '" title="Delete this saved button for good">' + ico('trash', 13) + '</span>' : '') +
          '</span>' +
        '</button>';
      }
      var tplRows = tplRank(S.templates).map(tplRow).join('');
      var libRows = LIB.list.map(function (l) {
        var rows = tplRank(l.buttons).map(tplRow).join('');
        return rows ? '<div class="shb-sep"></div><div class="shb-drawer-sec" style="color:inherit;opacity:.6">' + esc(l.label) + '</div>' + rows : '';
      }).join('');
      return '<div class="shb-drawer">' +
        '<div class="shb-card-hd"><span>Tools & Actions</span><span>' + filteredTools.length + '</span></div>' +
        drawerTabsHTML +
        '<input class="shb-search" data-hb-q value="' + esc(HB.q) + '" placeholder="Filter tools & actions…">' +
        '<div class="shb-list">' +
          filteredTools.map(function (t) {
            var uid = 'tool:' + t.id;
            var inBar = allPinned.indexOf(uid) >= 0;
            return '<button type="button" class="shb-btn shb-btn-row" data-hb-run="' + esc(uid) + '" data-drawer-uid="' + esc(uid) + '" title="Drag to any bar to pin · Click to run" style="cursor:grab">' +
              '<span style="display:inline-flex;align-items:center;gap:8px">' + ico(t.icon || 'plus') + '<span>' + esc(t.label) + '</span></span>' +
              '<span style="display:inline-flex;align-items:center;gap:4px">' +
                (inBar ? '<span class="shb-inbar">✓</span>' : '') +
                (t.kbd ? '<span class="shb-kbd">' + esc(t.kbd) + '</span>' : '') +
              '</span>' +
            '</button>';
          }).join('') +
          (tplRows ? '<div class="shb-sep"></div><div class="shb-drawer-sec" style="color:inherit;opacity:.6">Saved Buttons</div>' + tplRows : '') +
          libRows +
          (resizeList.length > 1 ? '<div class="shb-sep"></div><div class="shb-drawer-sec" style="color:inherit;opacity:.6">Resizer Nodes</div>' +
            resizeList.map(function (r) {
              var rUid = 'node:' + r.type;
              var rIn = allPinned.indexOf(rUid) >= 0;
              return '<button type="button" class="shb-btn shb-btn-row" data-hb-rsz="' + esc(r.type) + '" data-drawer-uid="' + esc(rUid) + '" title="' + esc(r.why) + ' (Drag to bar to pin)" style="cursor:grab">' +
                '<span style="display:inline-flex;align-items:center;gap:8px">' + ico('resize') + '<span>' + esc(r.label) + '</span></span>' +
                (rIn ? '<span class="shb-inbar">✓</span>' : '') +
              '</button>';
            }).join('') : '') +
        '</div>' +
      '</div>';
    }

    if (d === 'models') {
      var allM = isAdd ? ndMates(node, wantsOld(q)) : swapMates(node, '', wantsOld(q));
      var hitM = hbRankBy(allM, q, function (m) { return [m.name, m.type]; });
      /* the models, then the subgraphs that swap like one in their own section, so a long model list never hides them */
      var listS = hitM.filter(function (m) { return m.isSub; }).slice(0, 40);
      var listM = hitM.filter(function (m) { return !m.isSub; }).slice(0, 60);
      if (listS.length) listM = listM.concat([{ sec: 'Subgraphs' }], listS);
      return '<div class="shb-drawer">' +
        '<div class="shb-card-hd"><span>' + (isAdd ? 'Models & APIs' : 'Swap Model') + '</span><span>' + allM.length + '</span></div>' +
        drawerTabsHTML +
        '<input class="shb-search" data-hb-q value="' + esc(HB.q) + '" placeholder="Search models…">' +
        '<div class="shb-list">' +
          (listM.length ? listM.map(function (m) {
            if (m.sec) return '<div class="shb-sep"></div><div class="shb-drawer-sec">' + esc(m.sec) + '</div>';
            var uid = 'model:' + m.type;
            var inBar = allPinned.indexOf(uid) >= 0;
            return '<button type="button" class="shb-btn shb-btn-row" data-hb-model="' + esc(m.type) + '" data-drawer-uid="' + esc(uid) + '" title="Drag to any bar to pin · Click to ' + (isAdd ? 'add' : 'swap') + '" style="cursor:grab">' +
              '<span style="overflow:hidden;text-overflow:ellipsis">' + esc(m.name) + '</span>' +
              '<span style="display:inline-flex;align-items:center;gap:4px">' +
                (inBar ? '<span class="shb-inbar">✓</span>' : '') +
                (m.isSub ? ico('subgraph', 13) : '') + '<span class="shb-kbd">' + (m.kind === 'video' ? 'VID' : 'IMG') + '</span>' +
              '</span>' +
            '</button>';
          }).join('') : '<div style="padding:10px;color:#888888">No matching models found</div>') +
        '</div>' +
      '</div>';
    }

    if (d === 'subs') {
      var subsOld = wantsOld(q);
      var subs = hbRankBy((SRV.subgraphs || []).filter(function (s) {
        return subsOld || !isOldVersion(s.type);
      }), q, function (s) { return [s.name]; });
      return '<div class="shb-drawer">' +
        '<div class="shb-card-hd"><span>Subgraphs</span><span>' + subs.length + '</span></div>' +
        drawerTabsHTML +
        '<input class="shb-search" data-hb-q value="' + esc(HB.q) + '" placeholder="Filter subgraphs…">' +
        '<div class="shb-list">' +
          (subs.length ? subs.map(function (s) {
            var uid = 'node:' + s.type;
            var inBar = allPinned.indexOf(uid) >= 0;
            return '<button type="button" class="shb-btn shb-btn-row" data-hb-model="' + esc(s.type) + '" data-drawer-uid="' + esc(uid) + '" title="Drag to any bar to pin · Click to add" style="cursor:grab">' +
              '<span style="display:inline-flex;align-items:center;gap:8px">' + ico('subgraph') + '<span>' + esc(s.name) + '</span></span>' +
              (inBar ? '<span class="shb-inbar">✓</span>' : '') +
            '</button>';
          }).join('') : '<div style="padding:10px;color:#888888">No global subgraphs found</div>') +
        '</div>' +
      '</div>';
    }

    if (d === 'search') {
      var sugUids = (!q && node) ? suggestNodesFor(node, 12) : [];
      var sugTypes = [];
      sugUids.forEach(function (u) {
        if (u.indexOf('node:') === 0) sugTypes.push(u.slice(5));
        else if (u.indexOf('model:') === 0) sugTypes.push(u.slice(6));
      });
      /* with a search: every node, best match first (nodeSearch); without one: the suggestions, then A to Z */
      var hits = q ? nodeSearch(q, node) : null;
      var types = hits ? hits.slice(0, 80).map(function (h) { return h.t; }) : allTypes().filter(function (t) {
        return !isOldVersion(t) && sugTypes.indexOf(t) < 0;
      }).slice(0, 70);
      var outSlotsLabel = nodeOutputSlotTypes(node).join(', ');
      return '<div class="shb-drawer">' +
        '<div class="shb-card-hd"><span>Add Node (Drag to Bar)</span><span>' + (hits ? hits.length : sugTypes.length + types.length) + '</span></div>' +
        drawerTabsHTML +
        '<input class="shb-search" data-hb-q value="' + esc(HB.q) + '" placeholder="Search any ComfyUI node…">' +
        '<div class="shb-list">' +
          (sugTypes.length ? '<div class="shb-drawer-sec">Suggested for ' + esc(outSlotsLabel || 'Node') + '</div>' +
            sugTypes.map(function (t) {
              var uid = (SRV.api && SRV.api[t]) ? ('model:' + t) : ('node:' + t);
              var inBar = allPinned.indexOf(uid) >= 0 || allPinned.indexOf('node:' + t) >= 0;
              var disp = (SRV.types && SRV.types[t] && SRV.types[t].display_name) || t;
              var mSlots = matchingSlotsDesc(node, t);
              return '<button type="button" class="shb-btn shb-btn-row" data-hb-create="' + esc(t) + '" data-drawer-uid="' + esc(uid) + '" title="Drag to any bar to pin · Click to add & auto-connect ' + esc(disp) + '" style="cursor:grab">' +
                '<span style="overflow:hidden;text-overflow:ellipsis">' + esc(disp) + '</span>' +
                '<span style="display:inline-flex;align-items:center;gap:4px">' +
                  (inBar ? '<span class="shb-inbar">✓</span>' : '') +
                  (mSlots ? '<span class="shb-kbd">' + esc(mSlots) + '</span>' : '') +
                '</span>' +
              '</button>';
            }).join('') + '<div class="shb-sep"></div><div class="shb-drawer-sec" style="color:inherit;opacity:.6">All Installed Nodes</div>' : '') +
          types.map(function (t) {
            var uid = 'node:' + t;
            var inBar = allPinned.indexOf(uid) >= 0;
            var disp = (SRV.types && SRV.types[t] && SRV.types[t].display_name) || t;
            var pack = packLabel(t);
            var mSlots = q && node ? matchingSlotsDesc(node, t) : '';
            return '<button type="button" class="shb-btn shb-btn-row" data-hb-create="' + esc(t) + '" data-drawer-uid="' + esc(uid) + '" title="' + esc(disp + (pack ? ' · from ' + nodePack(t) : ' · ComfyUI') + ' · Drag to any bar to pin · Click (or Enter) to add') + '" style="cursor:grab">' +
              '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(disp) + '</span>' +
              '<span style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0">' +
                (pack ? '<span class="shb-src">' + esc(pack) + '</span>' : '') +
                (inBar ? '<span class="shb-inbar">✓</span>' : '') +
                (mSlots ? '<span class="shb-kbd">' + esc(mSlots) + '</span>' : '') +
              '</span>' +
            '</button>';
          }).join('') +
          (hits && !hits.length ? '<div style="padding:10px;color:#888888">No node matches “' + esc(HB.q) + '”</div>' : '') +
        '</div>' +
      '</div>';
    }

    return '';
  }

  /* ---------------------------------------------------------------------
   * THEMES & MOTION (Fluid glass / Quiet panels) — CSS transitions + WAAPI only
   * --------------------------------------------------------------------- */
  function hbTheme() {
    return S.hbStyle === 'quiet' ? 'quiet' : (S.hbStyle === 'classic' ? 'classic' : 'fluid');
  }

  /* Compact wears the Fluid look and motion; it only leaves out the side cards */
  function hbThemeCls() {
    var t = hbTheme();
    return t === 'quiet' ? 'shb-quiet' : ((t === 'classic' ? 'shb-fluid shb-classic' : 'shb-fluid') + (S.hbBlur === false ? ' shb-noblur' : ''));
  }

  function hbIsFluid() { return hbTheme() !== 'quiet'; }

  var HB_STYLE_NAMES = { pro: 'Fluid', quiet: 'Quiet', classic: 'Compact' };
  function hbCycleStyle() {
    var order = ['pro', 'classic', 'quiet'];
    S.hbStyle = order[(order.indexOf(S.hbStyle) + 1) % order.length] || 'pro';
    save();
    if (HB.el) {
      hbPaint();
      hbAnimateOpen();
    }
    if (openSettingsModal._rerender) openSettingsModal._rerender();
    setStatus('ok', 'Hotbox style: ' + HB_STYLE_NAMES[S.hbStyle] + ' (Tab to switch)');
  }

  /* Wiggle amplitude in degrees (the "+" button itself uses twice this) */
  function hbAmp() { return hbIsFluid() ? 2.2 : 1.2; }

  function cssEsc(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&');
  }

  function hbWiggle(el, a) {
    if (!el || !el.animate) return;
    try {
      el.animate([
        { transform: 'rotate(0) scale(.96)', opacity: 0.4 },
        { transform: 'rotate(' + (-a) + 'deg) scale(1.02)', opacity: 1, offset: 0.3 },
        { transform: 'rotate(' + (a * 0.6) + 'deg)', offset: 0.6 },
        { transform: 'rotate(' + (-a * 0.25) + 'deg)', offset: 0.85 },
        { transform: 'rotate(0) scale(1)', opacity: 1 }
      ], { duration: 260, easing: 'ease-out' });
    } catch (e) {}
  }

  /* New nodes say hello with a subtle wiggle (Vue node mode only — canvas-drawn nodes have no DOM) */
  function hbWiggleNode(node) {
    if (!node) return;
    var tries = 0;
    (function look() {
      var el = document.querySelector('.lg-node[data-node-id="' + cssEsc(node.id) + '"]');
      var inner = el && (el.querySelector('[data-testid="node-inner-wrapper"]') || el.firstElementChild);
      if (inner) { hbWiggle(inner, hbAmp()); return; }
      if (++tries < 8) requestAnimationFrame(look);
    })();
  }

  /* Drag ghost chip that follows the pointer (body-level so it survives repaints) */
  var GHOST = null;
  function ghostShow(label, x, y) {
    ghostHide();
    GHOST = owns(document.createElement('div'));
    GHOST.className = 'shb-ghost ' + hbThemeCls();
    GHOST.innerHTML = '<i class="shb-ghost-dot"></i><span>' + esc(label) + '</span><span class="shb-ghost-hint"></span>';
    document.body.appendChild(GHOST);
    ghostMove(x, y, '', '');
  }

  function ghostMove(x, y, hint, state) {
    if (!GHOST) return;
    GHOST.style.left = x + 'px';
    GHOST.style.top = y + 'px';
    GHOST.classList.toggle('shb-ghost-over', state === 'over');
    GHOST.classList.toggle('shb-ghost-rm', state === 'rm');
    var h = GHOST.lastElementChild;
    if (h && h.textContent !== hint) h.textContent = hint;
  }

  function ghostHide() {
    if (GHOST && GHOST.parentNode) GHOST.parentNode.removeChild(GHOST);
    GHOST = null;
  }

  /* A bar button picked up: the ghost is the button itself, a little bigger and with a shadow, so it is plain
     which one is in the hand. It is a copy that carries its looks with it (the bar's own styles do not reach
     a copy outside the bar) */
  var LIFT_PROPS = ['display', 'alignItems', 'justifyContent', 'gap', 'padding', 'margin', 'border', 'borderRadius', 'backgroundColor',
    'backgroundImage', 'color', 'font', 'letterSpacing', 'textTransform', 'opacity', 'width', 'height', 'minWidth', 'boxSizing', 'whiteSpace',
    'flexShrink', 'placeItems'];
  function ghostLift(wrap, x, y) {
    ghostHide();
    var src = wrap && wrap.querySelector(':scope > .shb-btn');
    if (!src) { ghostShow('', x, y); return; }
    var copy = src.cloneNode(true);
    var a = [src].concat(Array.prototype.slice.call(src.querySelectorAll('*')));
    var b = [copy].concat(Array.prototype.slice.call(copy.querySelectorAll('*')));
    a.forEach(function (el, i) {
      if (!b[i] || !b[i].style || el.ownerSVGElement) return;
      var cs = getComputedStyle(el);
      LIFT_PROPS.forEach(function (p) { try { b[i].style[p] = cs[p]; } catch (e) {} });
    });
    Array.prototype.forEach.call(copy.querySelectorAll('.shb-x,.shb-grp-chev'), function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    copy.removeAttribute('data-hb-run');
    copy.removeAttribute('title');
    copy.style.animation = 'none';
    GHOST = owns(document.createElement('div'));
    GHOST.className = 'shb-ghost shb-lift ' + hbThemeCls();
    GHOST.style.zoom = String(parseFloat(S.hbScale) || 1);
    GHOST.appendChild(copy);
    var hint = document.createElement('span');
    hint.className = 'shb-ghost-hint';
    GHOST.appendChild(hint);
    document.body.appendChild(GHOST);
    ghostMove(x, y, '', '');
  }

  /* While a button is dragged in edit mode, the edit bar is the place to drop it to take it off its bar */
  function hbOverTrash(x, y) {
    var eb = HB.el && HB.editMode ? HB.el.querySelector('.shb-editbar') : null;
    var r = eb && eb.getBoundingClientRect();
    return !!(r && r.width && x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8);
  }

  function hbTrashHot(on) {
    var t = HB.el && HB.el.querySelector('.shb-editbar-trash');
    if (t) t.classList.toggle('shb-hot', !!on);
  }

  /* a dragged button that leaves the bars waits where it was picked up */
  function hbDragHome(lp) {
    var w = lp.wrap, h = lp.home;
    if (!w || !h || !h.parent || !h.parent.isConnected) return;
    var next = (h.next && h.next.parentNode === h.parent) ? h.next : null;
    if (w.parentNode === h.parent && w.nextSibling === next) return;
    h.parent.insertBefore(w, next);
  }

  /* Removal poof: Fluid expands a ring while the chip shrinks, Quiet just fades */
  function hbPoof(x, y, label) {
    var fl = hbIsFluid();
    var p = owns(document.createElement('div'));
    p.className = 'shb-poof ' + hbThemeCls();
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.innerHTML = (fl ? '<span class="shb-poof-ring"></span>' : '') + '<div class="shb-poof-chip">' + esc(label) + '</div>';
    document.body.appendChild(p);
    try {
      if (fl) {
        p.firstElementChild.animate([{ transform: 'scale(.3)', opacity: 0.9 }, { transform: 'scale(1.7)', opacity: 0 }],
          { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
      }
      p.lastElementChild.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: 'translate(-50%,-50%) scale(' + (fl ? 0.2 : 0.9) + ')', opacity: 0 }
      ], { duration: fl ? 150 : 110, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    } catch (e) {}
    setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 320);
  }

  /* ---------------------------------------------------------------------
   * UNDO, for edit mode and the button browser: every change to the bars, the groups, the saved buttons and
   * their names, colors and keys is taken back one step at a time (Ctrl+Z, or Undo in the edit bar)
   * --------------------------------------------------------------------- */
  var HB_UNDO = [];
  var HB_UNDO_KEYS = ['customAddBar', 'customAddBySig', 'customToolsBar', 'customBotBar', 'customLabels', 'customColors', 'customFill',
    'customKeys', 'hbKeep', 'hotboxPins', 'templates', 'hbGroups'];

  function hbUndoShot() {
    var o = {};
    HB_UNDO_KEYS.forEach(function (k) { o[k] = S[k] === undefined ? null : S[k]; });
    return JSON.stringify(o);
  }

  /* called right before a change; `what` names it in the status line */
  function hbUndoPush(what) {
    var shot = hbUndoShot();
    var top = HB_UNDO[HB_UNDO.length - 1];
    if (top && top.shot === shot && !top.libs.length) { top.what = what || top.what; return top; }
    top = { shot: shot, what: what || 'the last change', libs: [] };
    HB_UNDO.push(top);
    if (HB_UNDO.length > 40) HB_UNDO.shift();
    return top;
  }

  /* how many steps there are to take back (a step that changed nothing is dropped) */
  function hbUndoLeft() {
    var cur = hbUndoShot();
    while (HB_UNDO.length && HB_UNDO[HB_UNDO.length - 1].shot === cur && !HB_UNDO[HB_UNDO.length - 1].libs.length) HB_UNDO.pop();
    return HB_UNDO.length;
  }

  function hbUndo() {
    if (!hbUndoLeft()) { setStatus('ok', 'Nothing to undo'); return false; }
    var u = HB_UNDO.pop(), o = null;
    try { o = JSON.parse(u.shot); } catch (e) { o = null; }
    if (!o) return false;
    HB_UNDO_KEYS.forEach(function (k) { S[k] = o[k]; });
    if (!Array.isArray(S.templates)) S.templates = [];
    /* a button deleted from a shared library goes back into its folder */
    u.libs.forEach(function (d) {
      var l = libByKey(d.lib);
      if (l) libWriteButton(l, d.tpl).then(function () { return libRefresh(true); }).then(hbRedrawAll);
    });
    save();
    hbRedrawAll();
    setStatus('ok', '↶ Undid ' + u.what);
    return true;
  }

  /* whatever shows the buttons is drawn again: the hotbox, Settings and the button browser */
  function hbRedrawAll() {
    if (HB.el) hbPaint();
    if (document.getElementById(PANEL_ID + '-settings') && openSettingsModal._rerender) openSettingsModal._rerender();
    if (BRW.el) brwRender();
  }

  /* Hotbox windows on top of the page (the button browser, the node editor, Edit Button): Esc closes the top
     one, and no key reaches the hotbox or the canvas behind them */
  var HB_MODALS = [];
  function modalOpen(closeFn) { HB_MODALS.push(closeFn); return closeFn; }
  function modalShut(closeFn) {
    var i = HB_MODALS.indexOf(closeFn);
    if (i >= 0) HB_MODALS.splice(i, 1);
  }

  function hbEditBarHTML() {
    var fl = hbIsFluid();
    var hid = HB.editMode ? hbHiddenHere() : 0;
    var un = HB.editMode ? hbUndoLeft() : 0;
    return '<div class="shb-editbar">' +
      '<span class="shb-editbar-tag"><i></i>Editing</span>' +
      '<span class="shb-editbar-t">' + (fl ? 'Drag to move · rest on a button to group · click for name, color and key · × removes'
        : 'drag = move · rest on a button = group · click = name, color, key · × = remove') + '</span>' +
      '<span class="shb-editbar-trash" data-hb-trash>' + ico('trash', 14) + '<span>Drop here to remove</span></span>' +
      '<button type="button" class="shb-editbar-b" data-hb-act="editundo"' + (un ? '' : ' disabled') + ' title="Take back the last change (Ctrl+Z)">Undo</button>' +
      (hid ? '<button type="button" class="shb-editbar-b' + (HB.editAll ? ' shb-editbar-on' : '') + '" data-hb-act="editall" title="' +
        esc(hid + (hid === 1 ? ' button does' : ' buttons do') + ' not apply to this node, so ' + (hid === 1 ? 'it stays' : 'they stay') +
          ' hidden and the bars do not move when edit mode starts · show ' + (hid === 1 ? 'it' : 'them') + ' to move, rename or remove ' + (hid === 1 ? 'it' : 'them') + ' too') + '">' +
        (HB.editAll ? 'Hide ' + (hid === 1 ? 'that 1' : 'those ' + hid) : '+' + hid + ' hidden here') + '</button>' : '') +
      '<button type="button" class="shb-editbar-b" data-hb-act="editreset">Reset</button>' +
      '<button type="button" class="shb-editbar-b shb-editbar-done" data-hb-act="editdone">Done</button>' +
    '</div>';
  }

  /* Edit-mode idle animation on each bar button, desynced per index; cancelled on exit (zero cost outside edit mode) */
  var HB_ANIMS = [];
  function hbStopEditAnim() {
    HB_ANIMS.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    HB_ANIMS = [];
    if (HB.el) {
      Array.prototype.forEach.call(HB.el.querySelectorAll('.shb-outline'), function (b) { b.classList.remove('shb-outline'); });
    }
  }

  function hbSyncEditAnim() {
    hbStopEditAnim();
    if (!HB.el || !HB.editMode) return;
    var fl = hbIsFluid();
    var st = S.hbEditAnim || 'none';
    /* still by default: the fine line around the bars and "Editing" in the edit bar say it is edit mode */
    if (st === 'none') return;
    var btns = HB.el.querySelectorAll('[data-hb-bar] > .shb-item-wrap > .shb-btn, [data-hb-gtray] > .shb-item-wrap > .shb-btn');
    Array.prototype.forEach.call(btns, function (b, i) {
      if (st === 'outline') { b.classList.add('shb-outline'); return; }
      var kf, op, sg = i % 2 ? 1 : -1;
      if (st === 'tilt') {
        kf = [{ transform: 'rotate(0)' }, { transform: 'rotate(' + (sg * (fl ? 1.1 : 0.6)) + 'deg)' }];
        op = { duration: 110, fill: 'forwards', easing: 'cubic-bezier(.34,1.56,.64,1)' };
      } else if (st === 'float') {
        var fd = 1100 + ((i * 97) % 300);
        kf = [{ transform: 'translateY(0)' }, { transform: 'translateY(-1.5px)' }];
        op = { duration: fd, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', delay: -((i * 131) % fd) };
      } else {
        var a = fl ? 0.55 : 0.35, jd = 180 + ((i * 37) % 40);
        kf = [{ transform: 'rotate(-' + a + 'deg)' }, { transform: 'rotate(' + a + 'deg)' }];
        op = { duration: jd, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', delay: -((i * 53) % jd) };
      }
      try { HB_ANIMS.push(b.animate(kf, op)); } catch (e) {}
    });
  }

  /* Edit mode used to list, at once, every button a bar can hold: the ones that do not apply to this node came
     back in between the others, the bars grew, and the button under the pointer was somewhere else by the time
     you let go. Now it starts with the very same buttons, where they were, and those hidden ones wait behind
     "+N hidden here" in the edit bar (HB.editAll) */
  function hbAllBtns() {
    return !!(HB.editMode && HB.editAll);
  }

  /* How many buttons the bars hold that do not show on this node (a group counts with what is in it) */
  function hbHiddenHere() {
    var node = HB.node, was = HB.editAll, n = 0;
    function count() {
      var c = 0;
      ['add', 'tools', 'bot'].forEach(function (b) {
        hbUngrouped(getBarUids(b, node).map(function (u) { return resolveBarItem(u, node, false, b); }).filter(Boolean))
          .forEach(function (it) { c += it.kind === 'group' ? 1 + it.kids.length : 1; });
      });
      return c;
    }
    try {
      HB.editAll = false;
      var shown = count();
      HB.editAll = true;
      n = count() - shown;
    } catch (e) { n = 0; }
    HB.editAll = was;
    return Math.max(0, n);
  }

  function hbSetEdit(on) {
    on = !!on;
    var was = !!HB.editMode;
    if (on !== was) HB.editAll = false;
    HB.editMode = on;
    if (!HB.el) return;
    HB.el.classList.toggle('shb-editing', on);
    var tb = HB.el.querySelector('[data-hb-act="toggleedit"]');
    if (tb) tb.classList.toggle('shb-btn-on', on);
    hbSyncEditAnim();
    if (on === was) return;
    /* the edit bar needs its "+N hidden here"; leaving edit mode must drop the buttons that don't apply here */
    hbPaint();
    if (!on) return;
    var fl = hbIsFluid();
    try {
      Array.prototype.forEach.call(HB.el.querySelectorAll('.shb-x'), function (x) {
        x.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
          { duration: 120, easing: fl ? 'cubic-bezier(.34,1.56,.64,1)' : 'cubic-bezier(.2,0,0,1)' });
      });
      var eb = HB.el.querySelector('.shb-editbar');
      if (eb) {
        eb.animate([{ transform: fl ? 'translateY(10px) scale(.9)' : 'translateY(4px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
          { duration: fl ? 140 : 100, easing: fl ? 'cubic-bezier(.34,1.56,.64,1)' : 'cubic-bezier(.2,0,0,1)' });
      }
    } catch (e) {}
  }

  /* Glass panels and where they bloom from: [element, Fluid from-transform, Quiet from-transform, delays] */
  function hbPanels(el) {
    var out = [];
    function add(sel, fl, qt, dFl, dQt) {
      Array.prototype.forEach.call(el.querySelectorAll(sel), function (p, i) {
        out.push({ p: p, fl: fl, qt: qt, dFl: dFl + i * 50, dQt: dQt + i * 40 });
      });
    }
    add('[data-zone="left"] > .shb-card', 'translateX(80px) scale(.55)', 'translateX(5px)', 0, 0);
    add('[data-zone="top"] > .shb-dock', 'translateY(60px) scale(.55)', 'translateY(5px)', 20, 0);
    add('[data-zone="top"] > .shb-ctx', 'translateY(60px) scale(.55)', 'translateY(5px)', 60, 40);
    add('[data-zone="right"] > .shb-card', 'translateX(-80px) scale(.55)', 'translateX(-5px)', 30, 0);
    add('[data-zone="bot"] .shb-bar', 'translateY(-60px) scale(.55)', 'translateY(-5px)', 50, 40);
    add('[data-zone="bot"] .shb-plus', 'translateY(-40px) scale(.4)', 'translateY(-5px)', 70, 40);
    return out;
  }

  /* Open: Fluid = snappy spring bloom from the cursor (k = 0.15), Quiet = fast 5px fade (k = 0.2) */
  function hbAnimateOpen() {
    var el = HB.el;
    if (!el || !el.animate) return;
    var fl = hbIsFluid();
    var k = fl ? 0.15 : 0.2;
    var ease = fl ? 'cubic-bezier(.2,.9,.1,1)' : 'cubic-bezier(.2,0,0,1)';
    var d = (fl ? 300 : 150) * k;
    var z = parseFloat(S.hbScale) || 1;
    var cx = HB.anchorX || HB.x, cy = HB.anchorY || HB.y;
    hbPanels(el).forEach(function (it) {
      var p = it.p, dl = (fl ? it.dFl : it.dQt) * k;
      try {
        if (fl) {
          var r = p.getBoundingClientRect();
          p.style.transformOrigin = ((cx - r.left) / z).toFixed(1) + 'px ' + ((cy - r.top) / z).toFixed(1) + 'px';
        }
        var a = p.animate([{ transform: fl ? it.fl : it.qt }, { transform: 'none' }], { duration: d, easing: ease, delay: dl, fill: 'backwards' });
        p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fl ? d * 0.45 : d, easing: fl ? 'ease' : ease, delay: dl, fill: 'backwards' });
        if (fl) a.onfinish = function () { p.style.transformOrigin = ''; };
      } catch (e) {}
    });
    try {
      if (fl) {
        Array.prototype.forEach.call(el.querySelectorAll('.shb-card'), function (card) {
          Array.prototype.forEach.call(card.querySelectorAll('.shb-row, .shb-ps, .shb-colors'), function (row, j) {
            var rdl = (90 + j * 30) * k;
            row.animate([{ transform: 'translateY(8px)' }, { transform: 'none' }], { duration: d, easing: ease, delay: rdl, fill: 'backwards' });
            row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 * k, easing: 'ease', delay: rdl, fill: 'backwards' });
          });
        });
        var sc = el.querySelector('.shb-scrim');
        if (sc) sc.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320 * k, easing: 'ease' });
      } else {
        Array.prototype.forEach.call(el.querySelectorAll('.shb-leaders line'), function (ln) {
          ln.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 240 * k, easing: ease, delay: 60 * k, fill: 'backwards' });
        });
      }
    } catch (e) {}
  }

  /* Close: no stagger; the element is detached from HB state right away and removed once faded */
  function hbAnimateClose(el, cx, cy) {
    var fl = el.classList.contains('shb-fluid');
    var k = fl ? 0.15 : 0.2;
    var dur = (fl ? 180 : 100) * k;
    var z = parseFloat(S.hbScale) || 1;
    el.classList.add('shb-closing');
    try {
      hbPanels(el).forEach(function (it) {
        if (fl) {
          var r = it.p.getBoundingClientRect();
          it.p.style.transformOrigin = ((cx - r.left) / z).toFixed(1) + 'px ' + ((cy - r.top) / z).toFixed(1) + 'px';
        }
        it.p.animate([{ transform: 'none', opacity: 1 }, { transform: fl ? it.fl : it.qt, opacity: 0 }],
          { duration: dur, easing: fl ? 'cubic-bezier(.4,0,1,1)' : 'ease-in', fill: 'forwards' });
      });
      Array.prototype.forEach.call(el.querySelectorAll('.shb-scrim, .shb-leaders, [data-zone="drawer"], [data-zone="catmenu"]'), function (n) {
        n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: 'ease-in', fill: 'forwards' });
      });
    } catch (e) {}
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, Math.round(dur) + 30);
  }

  /* Quiet: hairline leaders from 16px outside the cursor to each zone's near edge */
  function hbDrawLeaders() {
    var el = HB.el;
    var svg = el && el.querySelector('.shb-leaders');
    if (!svg) return;
    var cx = HB.anchorX || HB.x, cy = HB.anchorY || HB.y, R = 16;
    svg.setAttribute('width', window.innerWidth || 1600);
    svg.setAttribute('height', window.innerHeight || 900);
    function rectOf(sel) {
      var n = el.querySelector(sel);
      var r = n && n.getBoundingClientRect();
      return (r && r.width && r.height) ? r : null;
    }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    var segs = [];
    var rt = rectOf('[data-zone="top"] > .shb-ctx') || rectOf('[data-zone="top"] > .shb-dock');
    if (rt && rt.bottom < cy - R) segs.push([cx, cy - R, clamp(cx, rt.left + 8, rt.right - 8), rt.bottom]);
    var rl = rectOf('[data-zone="left"] > .shb-card');
    if (rl && rl.right < cx - R) segs.push([cx - R, cy, rl.right, clamp(cy, rl.top + 8, rl.bottom - 8)]);
    var rr = rectOf('[data-zone="right"] > .shb-card');
    if (rr && rr.left > cx + R) segs.push([cx + R, cy, rr.left, clamp(cy, rr.top + 8, rr.bottom - 8)]);
    var rb = rectOf('[data-zone="bot"] .shb-bar');
    if (rb && rb.top > cy + R) segs.push([cx, cy + R, clamp(cx, rb.left + 8, rb.right - 8), rb.top]);
    svg.innerHTML = segs.map(function (s) {
      return '<line x1="' + s[0].toFixed(1) + '" y1="' + s[1].toFixed(1) + '" x2="' + s[2].toFixed(1) + '" y2="' + s[3].toFixed(1) + '" pathLength="1"></line>';
    }).join('');
  }

  /* Bottom bar + "+" button as one drop target for pins */
  function hbInRect(el, x, y, pad) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
  }

  function hbBotBarEl() {
    return HB.el ? HB.el.querySelector('[data-zone="bot"] .shb-botbar') : null;
  }

  function hbPlusEl() {
    return HB.el ? HB.el.querySelector('.shb-plus') : null;
  }

  function hbOverPlus(x, y, pad) { return hbInRect(hbPlusEl(), x, y, pad); }

  function hbOverBot(x, y, pad) { return hbInRect(hbBotBarEl(), x, y, pad) || hbOverPlus(x, y, pad); }

  function hbSetBotDrop(on, showGap) {
    var bar = hbBotBarEl();
    if (bar) bar.classList.toggle('shb-drop-over', !!on);
    var gap = HB.el && HB.el.querySelector('.shb-drop-gap');
    if (gap) gap.classList.toggle('shb-gap-open', !!(on && showGap));
    var p = hbPlusEl();
    if (p) p.classList.toggle('shb-plus-drop', !!on);
  }

  /* Pin a node type to the bottom bar (global custom bar if the user customized it, else per context bucket) */
  function hbPinType(type, node) {
    var uid = 'node:' + type;
    if (!type || getBarUids('bot', node).indexOf(uid) >= 0) return false;
    if (Array.isArray(S.customBotBar)) {
      S.customBotBar.push(uid);
      save();
    } else {
      hbPinAdd(type, node);
    }
    return true;
  }

  function hbFlashUid(uid) {
    if (!HB.el) return;
    var sel = '.shb-item-wrap[data-hb-uid="' + cssEsc(uid) + '"] > .shb-btn';
    var b = HB.el.querySelector('[data-hb-bar] > ' + sel + ', [data-hb-gtray] > ' + sel);
    if (b) hbWiggle(b, hbAmp());
  }

  /* The standalone "+" opens the Add drawer right beside itself. The "+" itself toggles (All Nodes);
     a category picked from its dial (or F / N / A / U) switches straight to that category. */
  function hbTogglePlus(which) {
    if (!HB.el) return;
    var wasOn = !!HB.drawer;
    var closing = which ? HB.drawer === which : wasOn;
    HB.drawerAnchor = { plus: true };
    HB.drawer = closing ? '' : (which || 'search');
    HB.q = '';
    HB.catMenu = false;
    hbPaint();
    var np = hbPlusEl();
    if (!np) return;
    hbWiggle(np, hbAmp() * 2);
    var ic = np.querySelector('.shb-ico');
    var isOn = !!HB.drawer;
    try {
      if (ic && isOn !== wasOn) {
        ic.animate([{ transform: 'rotate(' + (wasOn ? 45 : 0) + 'deg)' }, { transform: 'rotate(' + (isOn ? 45 : 0) + 'deg)' }],
          { duration: 120, easing: 'cubic-bezier(.34,1.56,.64,1)' });
      }
    } catch (e) {}
  }

  /* The result rows of the open drawer, and the one ↑ ↓ / Enter act on (the first, until an arrow moves it) */
  function hbQRows() {
    return HB.el ? Array.prototype.slice.call(HB.el.querySelectorAll('.shb-drawer .shb-list > .shb-btn-row')) : [];
  }

  function hbQMark(scroll) {
    var key = HB.drawer + '\u0000' + HB.q;
    if (HB.qKey !== key) { HB.qKey = key; HB.qi = 0; HB.qMoved = false; }
    var rows = hbQRows();
    if (HB.qi >= rows.length) HB.qi = Math.max(0, rows.length - 1);
    rows.forEach(function (r, i) { r.classList.toggle('shb-qsel', i === HB.qi && !!(HB.q || HB.qMoved)); });
    if (scroll && rows[HB.qi]) {
      try { rows[HB.qi].scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
  }

  function hbQMove(d) {
    var n = hbQRows().length;
    if (!n) return;
    HB.qMoved = true;
    HB.qi = ((HB.qi || 0) + d + n) % n;
    hbQMark(true);
  }

  function hbRefreshSliders() {
    if (!HB.el || !HB.node) return;
    Array.prototype.forEach.call(HB.el.querySelectorAll('.shb-ps[data-ps-row]'), function (row) {
      var info = findNumWidgetInfo(HB.node, +row.getAttribute('data-ps-row'));
      if (info) updateSliderRowDOM(row, info, info.val);
    });
  }

  function hbPaint() {
    var el = HB.el;
    if (!el) return;
    try {
      var node = HB.node;
      var tools = hbContextTools(node);
      var addItems = hbUngrouped(getBarUids('add', node).map(function (u) { return resolveBarItem(u, node, false, 'add'); }).filter(Boolean));
      var toolItems = hbUngrouped(getBarUids('tools', node).map(function (u) { return resolveBarItem(u, node, false, 'tools'); }).filter(Boolean));
      var botItems = hbUngrouped(getBarUids('bot', node).map(function (u) { return resolveBarItem(u, node, false, 'bot'); }).filter(Boolean));
      var isAdd = ndAdds(node);
      var sel = selNodes();
      var isPair = sel.length >= 2 && isAdd;
      HB.keyMap = {};
      HB.wItems = [];
      HB.wMenu = null;

      /* Register instant single-key shortcuts [1]..[9] for Top Add Bar items */
      addItems.slice(0, 9).forEach(function (it, idx) {
        var k = String(idx + 1);
        HB.keyMap[k] = function () {
          if (it.off) { setStatus('ok', it.label + ': ' + it.off); return; }
          if (!it.stayOpen) hbClose();
          if (it.run) it.run();
        };
      });
      if (hbToolOn('label')) HB.keyMap['l'] = function () { hbClose(); labelOpen(node); };
      HB.keyMap['f2'] = function () { hbClose(); actRenameNode(node); };
      HB.keyMap['r'] = function () { hbClose(); addReroute(node); };
      HB.keyMap['s'] = function () { hbClose(); addSetNode(node); };
      if (sel.length || node) HB.keyMap['g'] = function () { hbClose(); actGroup(node); };
      if (hbToolOn('loadcanvas')) HB.keyMap['v'] = function () { hbClose(); actLoadInCanvas(node); };
      HB.keyMap['t'] = function () { hbClose(); addPreview(node); };
      HB.keyMap['b'] = function () { hbClose(); actBypass(node); };
      HB.keyMap['m'] = function () { hbClose(); actMute(node); };
      if (hbToolOn('apibypass')) HB.keyMap['k'] = function () { hbClose(); actBypassApi(); };
      if (hbToolOn('lupa')) HB.keyMap['z'] = function () { hbClose(); actAltZ(node); };
      if (hbToolOn('zoom')) HB.keyMap['.'] = function () { hbClose(); actDotZoom(node); };
      if (sel.length === 2) HB.keyMap['w'] = function () { hbClose(); actSwapPair(); };
      if (sel.length || node) HB.keyMap['x'] = function () { actMagic(node); };
      if (toolItems[0] && toolItems[0].run && !toolItems[0].off) {
        HB.keyMap['c'] = function () {
          if (!toolItems[0].stayOpen) hbClose();
          toolItems[0].run();
        };
      }
      /* A button with a key of its own (Edit Button → Key) answers to it while it shows, in a bar or in a group
         of one; the key it came with (its number in the dock, a tool's letter) lets go of it */
      HB.custKeys = {};
      var ownKeyOf = function (it, num) {
        var k = hbKeyFor(it.uid);
        if (!k) return;
        HB.custKeys[k] = function () {
          if (it.off) { setStatus('ok', it.label + ': ' + it.off); return; }
          if (!it.stayOpen) hbClose();
          if (it.run) it.run();
        };
        if (num) delete HB.keyMap[String(num)];
        var dk = it.kind === 'tool' ? String(it.kbd || '').toLowerCase() : '';
        if (dk && dk !== 'c' && (dk.length === 1 || dk === 'f2')) delete HB.keyMap[dk];
      };
      [addItems, toolItems, botItems].forEach(function (list, li) {
        list.forEach(function (it, idx) {
          ownKeyOf(it, (!li && idx < 9) ? idx + 1 : 0);
          (it.kids || []).forEach(function (kid) { ownKeyOf(kid, 0); });
        });
      });

      el.className = 'shb-wrap ' + hbThemeCls() + (HB.editMode ? ' shb-editing' : '');
      hbPaintPro(el, node, tools, addItems, toolItems, botItems, isAdd, isPair, sel, S.hbStyle === 'classic');
      hbFitSliders(el);
      if (!HB.psSync) HB.psSync = setInterval(hbSyncSliders, 300);

      hbPlace();
      hbSyncEditAnim();
      var qIn = el.querySelector('[data-hb-q]');
      if (qIn && document.activeElement !== qIn) {
        try { qIn.focus(); qIn.setSelectionRange(qIn.value.length, qIn.value.length); } catch (e) {}
      }
      if (qIn) hbQMark(false);
    } catch (err) {
      console.error('[Hotbox] Paint error:', err);
      hbClose();
    }
  }

  /* ---------------------------------------------------------------------
   * PRO SLIDERS FOR NUMERIC NODE WIDGETS (IN PRO CARDS MODE)
   * --------------------------------------------------------------------- */
  function getNumericWidgets(node) {
    if (!node || !Array.isArray(node.widgets)) return [];
    var nType = String(node.type || node.comfyClass || '');
    var nDef = (SRV.types && SRV.types[nType]) || null;
    var reqDefs = (nDef && nDef.input && nDef.input.required) || {};
    var optDefs = (nDef && nDef.input && nDef.input.optional) || {};
    var list = [];

    node.widgets.forEach(function (w, idx) {
      if (!w || w.hidden || w.type === 'hidden' || w.type === 'converted-widget') return;
      var nm = String(w.name || '');
      if (/^(seed|noise_seed|extra_seed|control_after_generate)$/i.test(nm)) return;
      var wType = String(w.type || '').toLowerCase();
      var isNum = (typeof w.value === 'number' && !isNaN(w.value))
        || wType === 'number' || wType === 'slider' || wType === 'int' || wType === 'float';
      if (!isNum) return;

      var opts = w.options || {};
      var srvSpec = reqDefs[nm] || optDefs[nm] || null;
      var srvMeta = (Array.isArray(srvSpec) && srvSpec[1] && typeof srvSpec[1] === 'object') ? srvSpec[1] : {};
      var srvType = Array.isArray(srvSpec) ? String(srvSpec[0] || '').toUpperCase() : '';

      var curVal = Number(w.value);
      if (isNaN(curVal)) curVal = 0;

      var rawMin = (opts.min !== undefined) ? Number(opts.min) : ((srvMeta.min !== undefined) ? Number(srvMeta.min) : -1e9);
      var rawMax = (opts.max !== undefined) ? Number(opts.max) : ((srvMeta.max !== undefined) ? Number(srvMeta.max) : 1e9);
      var isInt = srvType === 'INT' || wType === 'int'
        || (opts.precision === 0)
        || (/^(steps|width|height|batch_size|clip_skip|stop_at_clip_layer|frames|fps|x|y|pad|feather|grow)$/i.test(nm));

      var sMin = rawMin, sMax = rawMax, step = isInt ? 1 : 0.05, fineStep = isInt ? 1 : 0.01, decimals = isInt ? 0 : 2;
      var defVal = (srvMeta.default !== undefined) ? Number(srvMeta.default) : curVal;

      if (/^denoise$/i.test(nm)) {
        sMin = 0; sMax = 1; step = 0.01; fineStep = 0.005; decimals = 2;
        if (srvMeta.default === undefined) defVal = 1.0;
      } else if (/strength|weight|lora|opacity|blend|influence/i.test(nm)) {
        sMin = (rawMin < 0 && curVal < 0) ? -1.0 : (rawMin < 0 ? -0.5 : 0.0);
        sMax = 1.5; step = 0.05; fineStep = 0.01; decimals = 2;
        if (srvMeta.default === undefined) defVal = 1.0;
      } else if (/^(cfg|cfg_scale|guidance|guidance_scale)$/i.test(nm)) {
        sMin = (rawMin <= 0 ? 0.0 : 1.0); sMax = 15.0; step = 0.5; fineStep = 0.1; decimals = 1;
        if (srvMeta.default === undefined) defVal = /guidance/i.test(nm) ? 3.5 : 7.0;
      } else if (/^steps$/i.test(nm)) {
        sMin = 1; sMax = 60; step = 1; fineStep = 1; decimals = 0; isInt = true;
        if (srvMeta.default === undefined) defVal = 20;
      } else if (/^(width|height)$/i.test(nm)) {
        sMin = 256; sMax = 2048; step = 64; fineStep = 8; decimals = 0; isInt = true;
        if (srvMeta.default === undefined) defVal = 1024;
      } else if (/^(batch_size|batch)$/i.test(nm)) {
        sMin = 1; sMax = 16; step = 1; fineStep = 1; decimals = 0; isInt = true;
        if (srvMeta.default === undefined) defVal = 1;
      } else if (/stop_at_clip_layer|clip_skip/i.test(nm)) {
        sMin = -12; sMax = -1; step = 1; fineStep = 1; decimals = 0; isInt = true;
        if (srvMeta.default === undefined) defVal = -1;
      } else if (/scale_by|upscale|factor|multiplier/i.test(nm)) {
        sMin = 0.25; sMax = 4.0; step = 0.05; fineStep = 0.01; decimals = 2;
        if (srvMeta.default === undefined) defVal = 1.5;
      } else {
        if (srvMeta.step !== undefined && srvMeta.step > 0) {
          step = Number(srvMeta.step);
        } else if (opts.step !== undefined && opts.step > 0) {
          var os = Number(opts.step);
          step = (!isInt && os >= 1) ? (os / 10) : os;
        }
        if (isInt) {
          step = Math.max(1, Math.round(step));
          fineStep = 1;
          decimals = 0;
          if (!isFinite(sMin) || sMin < -1000) sMin = Math.min(0, curVal);
          if (!isFinite(sMax) || sMax > 1000 || (sMax - sMin) > 500) {
            sMax = Math.max(100, Math.abs(curVal) * 2 || 100);
          }
        } else {
          fineStep = Math.max(0.001, +(step / 5).toFixed(4));
          decimals = (opts.precision !== undefined) ? Number(opts.precision) : (step < 0.01 ? 3 : 2);
          if (!isFinite(sMin) || sMin < -10) sMin = (rawMin < 0) ? -2.0 : 0.0;
          if (!isFinite(sMax) || sMax > 20 || (sMax - sMin) > 25) {
            sMax = Math.max(2.0, Math.abs(curVal) * 2 || 2.0);
          }
        }
      }

      if (isFinite(rawMin)) sMin = Math.max(rawMin, sMin);
      if (isFinite(rawMax)) sMax = Math.min(rawMax, sMax);
      if (curVal < sMin) sMin = curVal;
      if (curVal > sMax) sMax = curVal;
      if (sMax <= sMin) sMax = sMin + (isInt ? 10 : 1);

      list.push({
        wIdx: idx,
        widget: w,
        name: nm,
        label: String(w.label || nm),
        val: curVal,
        defVal: defVal,
        rawMin: isFinite(rawMin) ? rawMin : -1e9,
        rawMax: isFinite(rawMax) ? rawMax : 1e9,
        sMin: sMin,
        sMax: sMax,
        step: step,
        fineStep: fineStep,
        decimals: decimals,
        isInt: isInt
      });
    });

    return list.slice(0, 40);
  }

  /* Four Pro Sliders show at once; more scroll inside the card, which fades at the edge that has more */
  var PS_VISIBLE = 4;
  function hbFitSliders(el) {
    var list = el.querySelector('.shb-ps-list');
    var rows = list ? list.children : [];
    if (rows.length <= PS_VISIBLE) return;
    var last = rows[PS_VISIBLE - 1];
    list.style.maxHeight = (last.offsetTop + last.offsetHeight - rows[0].offsetTop) + 'px';
    list.classList.add('shb-ps-scroll');
    function edges() {
      list.classList.toggle('shb-ps-more-dn', list.scrollTop + list.clientHeight < list.scrollHeight - 2);
      list.classList.toggle('shb-ps-more-up', list.scrollTop > 2);
    }
    list.onscroll = edges;
    edges();
  }

  function formatSliderVal(info, v) {
    if (info.isInt) return String(Math.round(v));
    return Number(v).toFixed(info.decimals);
  }

  function applyNodeWidgetValue(node, info, nextVal) {
    if (!node || !info || !info.widget) return 0;
    var v = Number(nextVal);
    if (isNaN(v)) v = info.val;
    v = Math.max(info.rawMin, Math.min(info.rawMax, v));
    if (info.isInt) v = Math.round(v);
    else v = Number(v.toFixed(Math.max(info.decimals, 4)));
    try {
      info.widget.value = v;
      if (typeof info.widget.callback === 'function') {
        info.widget.callback(v, getCanvas(), node, node.pos, null);
      }
      if (typeof node.onWidgetChanged === 'function') {
        node.onWidgetChanged(info.widget.name, v, info.val, info.widget);
      }
    } catch (e) {}
    info.val = v;
    var g = getGraph();
    if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
    return v;
  }

  function buildProSlidersHTML(node) {
    var numWidgets = getNumericWidgets(node);
    if (!numWidgets.length) return '';
    var wheel = numWidgets.length > PS_VISIBLE ? 'Wheel on the number = nudge' : 'Wheel = nudge';
    return '<div class="shb-ps-list">' +
      numWidgets.map(function (it) {
        var span = (it.sMax - it.sMin) || 1;
        var pct = Math.max(0, Math.min(100, ((it.val - it.sMin) / span) * 100));
        return '<div class="shb-ps" data-ps-row="' + it.wIdx + '">' +
          '<div class="shb-ps-track" data-ps-track="' + it.wIdx + '" title="Drag to scrub · Shift = fine · Ctrl+Click = previous value · Double-click = default (' + esc(formatSliderVal(it, it.defVal)) + ') · ' + wheel + '">' +
            '<div class="shb-ps-line"><div class="shb-ps-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
            '<div class="shb-ps-txt">' +
              '<span class="shb-ps-lbl" data-ps-reset="' + it.wIdx + '">' + esc(it.label) + '</span>' +
              '<input type="text" class="shb-ps-num" data-ps-num="' + it.wIdx + '" value="' + esc(formatSliderVal(it, it.val)) + '" spellcheck="false" title="Type an exact value & press Enter">' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  /* A value changed on the node itself (or by another tool) shows in its slider while the hotbox is open; a number
     box being typed into is left alone */
  function hbSyncSliders() {
    if (!HB.el || !HB.node || PSLIDER_DRAG) return;
    var rows = HB.el.querySelectorAll('.shb-ps[data-ps-row]');
    if (!rows.length) return;
    var infos = {};
    getNumericWidgets(HB.node).forEach(function (it) { infos[it.wIdx] = it; });
    Array.prototype.forEach.call(rows, function (row) {
      var info = infos[+row.getAttribute('data-ps-row')];
      if (!info || row._v === info.val) return;
      row._v = info.val;
      updateSliderRowDOM(row, info, info.val);
    });
  }

  function updateSliderRowDOM(rowEl, info, val) {
    if (!rowEl || !info) return;
    var span = (info.sMax - info.sMin) || 1;
    var pct = Math.max(0, Math.min(100, ((val - info.sMin) / span) * 100));
    var fill = rowEl.querySelector('.shb-ps-fill');
    var numIn = rowEl.querySelector('.shb-ps-num');
    if (fill) fill.style.width = pct.toFixed(1) + '%';
    if (numIn && document.activeElement !== numIn) {
      numIn.value = formatSliderVal(info, val);
    }
  }

  /* ---------------------------------------------------------------------
   * BAR WIDGETS: what a Context bar or Custom Bar can hold besides Hotbox's own buttons. The Label bar is
   * built from them, and so is any bar an extension hands over:
   *   window.__hotboxBars['my-tool'] = { name: 'My Tool', where: 'bottom' | 'context', items: function (ctx) { return [...]; } };
   * (or the function alone, for the bottom). Items: button, group, menu, select, text, number, range,
   * swatches, segment, toggle, info, sep — CUSTOM_BAR.md has the whole contract. A plain object on window,
   * so it can be filled before or after Hotbox loads; it is read every time the hotbox paints, and each
   * paint registers the items in HB.wItems, which data-hb-w="<index>" points back into.
   * --------------------------------------------------------------------- */
  window.__hotboxBars = window.__hotboxBars || {};

  var W_TYPES = { button: 1, group: 1, fold: 1, menu: 1, select: 1, text: 1, number: 1, range: 1, swatches: 1, segment: 1, toggle: 1, info: 1, sep: 1 };

  function wType(it) {
    var t = (it && typeof it === 'object') ? String(it.type || 'button') : '';
    return W_TYPES[t] ? t : '';
  }

  function wFn(f) { return typeof f === 'function'; }

  function wHas(v) { return v != null && v !== ''; }

  /* Drops what a bar cannot draw (a button without run, a group inside a group…), so one bad item never
     takes the hotbox down */
  function wClean(list, inside) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (it) {
      var t = wType(it), ok = false;
      if (t === 'button') ok = wHas(it.label) && wFn(it.run);
      else if (t === 'group' || t === 'fold') {
        /* a group can sit in a fold, a fold only at the top, and neither inside a group */
        var nests = t === 'group' ? inside !== 'group' : !inside;
        var kids = nests ? wClean(it.items, t) : [];
        if (kids.length && (t === 'group' || wHas(it.label))) { it = Object.assign({}, it, { items: kids }); ok = true; }
      }
      else if (t === 'menu') ok = wHas(it.label) && (Array.isArray(it.items) || wFn(it.items));
      else if (t === 'select' || t === 'segment') ok = Array.isArray(it.options) && it.options.length > 0 && wFn(it.onChange);
      else if (t === 'swatches') ok = Array.isArray(it.colors) && it.colors.length > 0 && wFn(it.onChange);
      else if (t === 'text') ok = wFn(it.onChange) || wFn(it.onCommit);
      else if (t === 'number' || t === 'range') ok = wFn(it.onChange);
      else if (t === 'toggle') ok = wHas(it.label) && wFn(it.onChange);
      else if (t === 'info') ok = wHas(it.text);
      else if (t === 'sep') ok = true;
      if (ok) out.push(it);
    });
    return out;
  }

  function wOpts(it) {
    return (it.options || []).map(function (o) {
      return (o && typeof o === 'object')
        ? { value: o.value, label: String(wHas(o.label) ? o.label : o.value), hint: o.hint || '' }
        : { value: o, label: String(o), hint: '' };
    });
  }

  function wColor(c) {
    return /^[#a-z0-9(),.%\s-]{3,40}$/i.test(String(c || '')) ? String(c) : '';
  }

  function wNum(it, v) {
    var n = Number(v);
    if (!isFinite(n)) n = Number(it.value) || 0;
    if (wHas(it.min) && n < +it.min) n = +it.min;
    if (wHas(it.max) && n > +it.max) n = +it.max;
    return n;
  }

  function wNumText(it, v) {
    var s = String(v);
    for (var pad = +it.pad || 0; pad && /^\d+$/.test(s) && s.length < pad;) s = '0' + s;
    return (it.prefix || '') + s;
  }

  /* What a provider and every callback get: the node the hotbox opened on, the selection, and two helpers */
  function wCtx(where) {
    return {
      node: HB.node || null,
      nodes: selNodes(),
      where: where || '',
      style: !hbIsFluid() ? 'quiet' : (S.hbStyle === 'classic' ? 'compact' : 'fluid'),
      repaint: function () { setTimeout(function () { if (HB.el) hbPaint(); }, 0); },
      close: function () { hbClose(); }
    };
  }

  function wErr(it, err) {
    setStatus('error', (it.label || it.text || 'Hotbox bar') + ': ' + ((err && err.message) || err));
  }

  function wHTML(it, base) {
    var t = wType(it);
    if (t === 'sep') return '<span class="shb-vsep"></span>';
    if (t === 'group') {
      return '<span class="shb-w-grp"' + (it.title ? ' title="' + esc(it.title) + '"' : '') + '>' +
        (wHas(it.label) ? '<span class="shb-w-cap">' + esc(it.label) + '</span>' : '') +
        it.items.map(function (k) { return wHTML(k, 'shb-tool'); }).join('') +
      '</span>';
    }
    var i = HB.wItems.push(it) - 1, at = ' data-hb-w="' + i + '"';
    var isz = hbIsFluid() ? 14 : 13;
    if (t === 'fold') {
      /* remembered per bar and fold while ComfyUI runs; `open` is only the first state */
      it._key = 'x:' + W_BAR + ':' + (it.id || it.label);
      var fOpen = HB.grpOpen[it._key] != null ? !!HB.grpOpen[it._key] : !!it.open;
      var fCol = wColor(it.color);
      if (!it.row) {
        /* like your own groups: hover opens the list under it, the arrow keeps it open */
        return '<span class="shb-grp' + (fOpen ? ' shb-grp-show shb-grp-pin' : '') + '" data-hb-gkey="' + esc(it._key) + '">' +
          '<button type="button" class="shb-btn ' + base + ' shb-w-fold shb-grp-btn"' + at + ' title="' + esc(it.title || it.label) + '">' +
            (fCol ? '<i class="shb-cbar-dot" style="background:' + esc(fCol) + '"></i>' : '') +
            ((it.icon && ICONS[it.icon]) ? ico(it.icon, isz) : '') + '<span class="shb-lbl">' + esc(it.label) + '</span>' +
            (wHas(it.badge) ? '<span class="shb-w-badge">' + esc(it.badge) + '</span>' : '') +
            '<span class="shb-grp-chev" data-hb-grpchev title="Keep it open · click again to close it">' + ico('chevDown', 11) + '</span>' +
          '</button>' +
          '<span class="shb-gdrop">' + it.items.map(function (k) { return wHTML(k, 'shb-tool'); }).join('') + '</span>' +
        '</span>';
      }
      return '<button type="button" class="shb-btn ' + base + ' shb-w-fold' + (fOpen ? ' shb-fold-on' : '') + '"' + at +
          ' title="' + esc(it.title || it.label) + '">' +
          (fCol ? '<i class="shb-cbar-dot" style="background:' + esc(fCol) + '"></i>' : '') +
          ((it.icon && ICONS[it.icon]) ? ico(it.icon, isz) : '') + '<span class="shb-lbl">' + esc(it.label) + '</span>' +
          (wHas(it.badge) ? '<span class="shb-w-badge">' + esc(it.badge) + '</span>' : '') +
          '<span class="shb-grp-chev">' + ico(it.row ? 'chevDown' : 'chevRight', 11) + '</span>' +
        '</button>' +
        '<span class="shb-gtray' + (it.row ? ' shb-tray-row' : '') + (fOpen ? ' shb-gtray-on' : '') + '" data-hb-ftray="' + i + '">' +
          it.items.map(function (k) { return wHTML(k, 'shb-tool'); }).join('') +
        '</span>';
    }
    var tip = ' title="' + esc(it.title || it.label || it.text || '') + '"';
    var cap = wHas(it.label) ? '<span class="shb-w-cap">' + esc(it.label) + '</span>' : '';
    var icon = (it.icon && ICONS[it.icon]) ? ico(it.icon, isz) : '';
    var col = wColor(it.color);
    var dot = col ? '<i class="shb-cbar-dot" style="background:' + esc(col) + '"></i>' : '';
    var badge = wHas(it.badge) ? '<span class="shb-w-badge">' + esc(it.badge) + '</span>' : '';
    var car = '<span class="shb-w-car">' + ico('chevDown', 11) + '</span>';
    if (t === 'info') return '<span class="shb-w-info"' + at + tip + '>' + icon + '<span>' + esc(it.text) + '</span></span>';
    if (t === 'button' || t === 'toggle' || t === 'menu') {
      var on = t === 'toggle' ? !!it.value : !!it.active;
      return '<button type="button" class="shb-btn ' + base + (on ? ' shb-btn-on' : '') + '"' + at + tip + (it.disabled ? ' disabled' : '') + '>' +
        dot + icon + '<span class="shb-lbl">' + esc(it.label) + '</span>' + badge + (t === 'menu' ? car : '') +
      '</button>';
    }
    if (t === 'select') {
      var cur = null;
      wOpts(it).forEach(function (o) { if (!cur && o.value === it.value) cur = o; });
      var shown = wHas(it.display) ? String(it.display) : (cur ? cur.label : String(wHas(it.value) ? it.value : ''));
      return '<button type="button" class="shb-w-field"' + at + ' title="' + esc(it.title || it.label || 'Choose') + '">' +
        dot + icon + cap + '<span class="shb-w-v">' + esc(shown || '—') + '</span>' + car +
      '</button>';
    }
    if (t === 'text') {
      return '<label class="shb-w-wrap"' + tip + '>' + cap +
        '<input type="text" class="shb-w-in" spellcheck="false" autocomplete="off"' + at +
          ' value="' + esc(wHas(it.value) ? it.value : '') + '" placeholder="' + esc(it.placeholder || '') + '"' +
          ' style="width:' + Math.max(48, Math.min(420, +it.width || 150)) + 'px">' +
      '</label>';
    }
    if (t === 'number') {
      var nTxt = wNumText(it, wNum(it, it.value));
      return '<span class="shb-w-wrap"' + tip + '>' + cap +
        '<span class="shb-w-num">' +
          '<input type="text" inputmode="decimal" class="shb-w-in shb-w-nin" spellcheck="false" autocomplete="off"' + at +
            ' value="' + esc(nTxt) + '" style="width:' + Math.max(40, Math.min(140, +it.width || (nTxt.length * 9 + 24))) + 'px">' +
          '<button type="button" class="shb-w-step"' + at + ' data-hb-wstep="1" title="Up · Shift ×10">' + ico('chevUp', 12) + '</button>' +
          '<button type="button" class="shb-w-step"' + at + ' data-hb-wstep="-1" title="Down · Shift ×10">' + ico('chevDown', 12) + '</button>' +
        '</span>' +
      '</span>';
    }
    if (t === 'range') {
      var rv = wNum(it, it.value);
      return '<label class="shb-w-range"' + tip + '>' + cap +
        '<input type="range"' + at + ' min="' + esc(wHas(it.min) ? it.min : 0) + '" max="' + esc(wHas(it.max) ? it.max : 100) + '"' +
          ' step="' + esc(it.step || 1) + '" value="' + esc(rv) + '" style="width:' + Math.max(60, Math.min(260, +it.width || 96)) + 'px">' +
        '<span class="shb-w-val">' + esc(rv + (it.unit || '')) + '</span>' +
      '</label>';
    }
    if (t === 'swatches') {
      var sv = String(it.value || '').toLowerCase();
      return '<span class="shb-w-wrap"' + (it.title ? tip : '') + '>' + cap + '<span class="shb-w-sw">' +
        it.colors.map(function (c, k) {
          var cc = wColor(c);
          return cc ? '<i class="shb-cdot' + (cc.toLowerCase() === sv ? ' shb-cdot-on' : '') + '"' + at + ' data-hb-wv="' + k + '" style="background:' + esc(cc) + '" title="' + esc(cc) + '"></i>' : '';
        }).join('') +
      '</span></span>';
    }
    if (t === 'segment') {
      return '<span class="shb-w-wrap"' + (it.title ? tip : '') + '>' + cap + '<span class="shb-w-seg">' +
        wOpts(it).map(function (o, k) {
          return '<button type="button" class="shb-w-segb' + (o.value === it.value ? ' shb-on' : '') + '"' + at + ' data-hb-wv="' + k + '"' +
            (o.hint ? ' title="' + esc(o.hint) + '"' : '') + '>' + esc(o.label) + '</button>';
        }).join('') +
      '</span></span>';
    }
    return '';
  }

  /* Hotbox's own bars come first, then the extensions', each in the place it asked for:
     'context' (the Context bar, under the dock) or 'bottom' (the Custom Bar, above the bottom bar) */
  var HB_OWN_BARS = {
    'hotbox-label': { where: 'context', items: function (ctx) { return hbLabelBarItems(ctx.node); } },
    'hotbox-setname': { where: 'context', items: function (ctx) { return hbSetNameBarItems(ctx.node); } }
  };

  /* A Set node's name, typed right in its Context bar. It is applied on Enter or on leaving the field, never
     per letter: the Set node renames its Gets and makes the name unique on every change. */
  function hbSetNameBarItems(node) {
    if (!node || !isSetNode(node) || !(node.widgets && node.widgets[0])) return [];
    return [{
      type: 'text', label: 'Name', value: setGetName(node), width: 170, placeholder: 'Type a name',
      title: 'The Set name · Enter to apply, Esc to undo',
      onCommit: function (v, ctx) {
        var want = String(v || '').trim();
        if (!want || want === setGetName(node)) return;
        setNameOn(node, want);
        var got = setGetName(node);
        var g = getGraph();
        if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
        setStatus('ok', got === want ? 'Set named "' + got + '"' : 'Set named "' + got + '" ("' + want + '" was taken)');
        ctx.repaint();
      }
    }];
  }

  function hbBarGroups(where) {
    var groups = [];
    function take(id, p) {
      var fn = wFn(p) ? p : (p && p.items);
      if (!wFn(fn)) return;
      var pw = (p && typeof p === 'object' && p.where === 'context') ? 'context' : 'bottom';
      if (pw !== where) return;
      var list = [];
      try { list = wClean(fn(wCtx(where))); } catch (e) { console.warn('[Hotbox] bar "' + id + '" failed:', e); }
      if (list.length) groups.push({ id: id, name: (p && typeof p === 'object' && p.name) || '', items: list });
    }
    Object.keys(HB_OWN_BARS).forEach(function (id) { take(id, HB_OWN_BARS[id]); });
    var reg = window.__hotboxBars;
    if (reg && typeof reg === 'object') Object.keys(reg).forEach(function (id) { take(id, reg[id]); });
    return groups;
  }

  var W_BAR = '';

  function hbBarGroupsHTML(groups, base) {
    return groups.map(function (g, gi) {
      W_BAR = g.id;
      return (gi ? '<span class="shb-vsep"></span>' : '') +
        (g.name ? '<span class="shb-dock-mode">' + esc(g.name) + '</span>' : '') +
        g.items.map(function (it) { return wHTML(it, base); }).join('');
    }).join('');
  }

  function hbCustomBarHTML() {
    var groups = hbBarGroups('bottom');
    return groups.length ? '<div class="shb-bar shb-cbar">' + hbBarGroupsHTML(groups, 'shb-act') + '</div>' : '';
  }

  /* A menu or a select opens a small list under its button; a long one gets a filter field */
  function wMenuRows(it) {
    if (wType(it) === 'select') {
      return wOpts(it).map(function (o) {
        return { label: o.label, hint: o.hint, active: o.value === it.value, stayOpen: true, run: function (ctx) { it.onChange(o.value, ctx); } };
      });
    }
    var rows = [];
    try { rows = wFn(it.items) ? it.items(wCtx('menu')) : it.items; } catch (e) { wErr(it, e); }
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      return r && (r.type === 'header' || r.type === 'sep' || (wHas(r.label) && wFn(r.run)));
    });
  }

  function wMenuListHTML(rows, q) {
    var ql = String(q || '').trim().toLowerCase(), html = '', fl = hbIsFluid();
    rows.forEach(function (r) {
      if (r.type === 'sep') { if (!ql) html += '<div class="shb-sep"></div>'; return; }
      if (r.type === 'header') { if (!ql) html += '<div class="shb-wmenu-hd">' + esc(r.label || '') + '</div>'; return; }
      if (ql && (r.label + ' ' + (r.hint || '')).toLowerCase().indexOf(ql) < 0) return;
      var i = HB.wItems.push(r) - 1, col = wColor(r.color);
      html += '<button type="button" class="shb-row' + (r.active ? ' shb-active' : '') + '" data-hb-w="' + i + '" data-hb-wrow title="' + esc(r.title || r.label) + '">' +
        ((r.icon && ICONS[r.icon]) ? ico(r.icon, fl ? 15 : 13) : (col ? '<i class="shb-cbar-dot" style="background:' + esc(col) + '"></i>' : '')) +
        '<span class="shb-row-l">' + esc(r.label) + '</span>' +
        (r.hint ? '<span class="shb-w-hint">' + esc(r.hint) + '</span>' : '') +
        (r.active ? ico('check', 13) : '') +
      '</button>';
    });
    return html || '<div class="shb-w-empty">' + (ql ? 'Nothing matches “' + esc(q) + '”' : 'Nothing here') + '</div>';
  }

  function hbMenuClose() {
    if (!HB.wMenu) return;
    var z = HB.el && HB.el.querySelector('[data-zone="wmenu"]');
    if (z && z.parentNode) z.parentNode.removeChild(z);
    if (HB.wMenu.anchor) HB.wMenu.anchor.classList.remove('shb-w-open');
    HB.wMenu = null;
  }

  function hbMenuOpen(idx, anchor) {
    var it = HB.wItems[idx];
    if (!HB.el || !it) return;
    var rows = wMenuRows(it);
    var count = rows.filter(function (r) { return r.type !== 'header' && r.type !== 'sep'; }).length;
    var search = it.search === true || (it.search !== false && count > 10);
    var z = document.createElement('div');
    z.className = 'shb-zone shb-zone-wmenu';
    z.setAttribute('data-zone', 'wmenu');
    z.innerHTML = '<div class="shb-wmenu">' +
      (search ? '<input class="shb-search" data-hb-wq placeholder="' + esc(it.placeholder || ('Filter ' + count + '…')) + '" spellcheck="false" autocomplete="off">' : '') +
      '<div class="shb-wmenu-list" data-hb-wlist>' + wMenuListHTML(rows, '') + '</div>' +
    '</div>';
    HB.el.appendChild(z);
    HB.wMenu = { idx: idx, rows: rows, anchor: anchor };
    anchor.classList.add('shb-w-open');
    var W = window.innerWidth || 1600, H = window.innerHeight || 900;
    var r = anchor.getBoundingClientRect(), m = z.getBoundingClientRect();
    var y = r.bottom + 6;
    if (y + m.height > H - 10 && r.top - 6 - m.height > 10) y = r.top - 6 - m.height;
    z.style.left = Math.round(Math.max(10, Math.min(W - 10 - m.width, r.left))) + 'px';
    z.style.top = Math.round(Math.max(10, y)) + 'px';
    var q = z.querySelector('[data-hb-wq]');
    if (q) { try { q.focus(); } catch (e) {} }
    try {
      z.firstChild.animate([{ opacity: 0, transform: 'translateY(-4px) scale(.98)' }, { opacity: 1, transform: 'none' }],
        { duration: 110, easing: 'cubic-bezier(.2,.9,.1,1)' });
    } catch (e) {}
  }

  /* A click on any widget. Buttons and menu rows close the hotbox unless they say stayOpen; settings-like
     changes (a swatch, a segment, a toggle, a select row) keep it open and repaint it */
  function hbWClick(wEl, e) {
    var idx = +wEl.getAttribute('data-hb-w');
    var it = HB.wItems[idx];
    if (!it || HB.editMode || wEl.disabled) return;
    var t = wEl.hasAttribute('data-hb-wrow') ? 'row' : wType(it);
    if (t === 'text' || t === 'range' || t === 'info') return;
    if (t === 'number') {
      var st = +wEl.getAttribute('data-hb-wstep');
      if (st) wNumSet(it, wNum(it, (Number(it.value) || 0) + st * (+it.step || 1) * (e.shiftKey ? 10 : 1)), wEl.closest('.shb-w-num'));
      return;
    }
    if (t === 'fold') {
      hbMenuClose();
      var fWrap = it.row ? null : wEl.closest('.shb-grp');
      if (fWrap) {
        hbGrpClick(fWrap);
        if (wFn(it.onToggle)) { try { it.onToggle(!!HB.grpOpen[it._key], wCtx('')); } catch (err) { wErr(it, err); } }
        return;
      }
      var fOpen = !wEl.classList.contains('shb-fold-on');
      HB.grpOpen[it._key] = fOpen;
      hbTrayAnim(wEl, HB.el.querySelector('[data-hb-ftray="' + idx + '"]'), fOpen);
      if (wFn(it.onToggle)) { try { it.onToggle(fOpen, wCtx('')); } catch (err) { wErr(it, err); } }
      return;
    }
    if (t === 'menu' || t === 'select') {
      var again = HB.wMenu && HB.wMenu.idx === idx;
      hbMenuClose();
      if (!again) hbMenuOpen(idx, wEl);
      return;
    }
    if (t === 'swatches') return wSet(it, it.colors[+wEl.getAttribute('data-hb-wv')]);
    if (t === 'segment') return wSet(it, (wOpts(it)[+wEl.getAttribute('data-hb-wv')] || {}).value);
    if (t === 'toggle') return wSet(it, !it.value);
    hbMenuClose();
    var ctx = wCtx('');
    if (!it.stayOpen) hbClose();
    try { it.run(ctx); } catch (err) { wErr(it, err); }
    if (it.stayOpen && HB.el) hbPaint();
  }

  function wSet(it, v) {
    try { it.onChange(v, wCtx('')); } catch (err) { wErr(it, err); }
    if (HB.el) hbPaint();
  }

  function wNumSet(it, v, box) {
    it.value = v;
    var inp = box && box.querySelector('.shb-w-nin');
    if (inp) { inp.value = wNumText(it, v); inp.defaultValue = inp.value; }
    try { it.onChange(v, wCtx('')); } catch (err) { wErr(it, err); }
  }

  /* Typing: text fields and sliders report live; a number waits for Enter, the arrows or leaving the field */
  function hbWInput(inp) {
    var it = HB.wItems[+inp.getAttribute('data-hb-w')];
    var t = wType(it);
    if (t === 'text' && wFn(it.onChange)) {
      try { it.onChange(inp.value, wCtx('')); } catch (err) { wErr(it, err); }
    } else if (t === 'range') {
      var v = wNum(it, inp.value);
      it.value = v;
      var out = inp.parentNode.querySelector('.shb-w-val');
      if (out) out.textContent = v + (it.unit || '');
      try { it.onChange(v, wCtx('')); } catch (err) { wErr(it, err); }
    }
  }

  function wCommit(inp) {
    var it = HB.wItems[+inp.getAttribute('data-hb-w')];
    var t = wType(it);
    if (t === 'number') {
      var v = wNum(it, String(inp.value).replace(/[^\d.\-]/g, ''));
      if (v !== Number(it.value)) wNumSet(it, v, inp.closest('.shb-w-num'));
      else inp.value = wNumText(it, v);
    } else if (t === 'text' && wFn(it.onCommit) && inp.value !== inp.defaultValue) {
      try { it.onCommit(inp.value, wCtx('')); } catch (err) { wErr(it, err); }
    }
    inp.defaultValue = inp.value;
  }

  function hbWKey(inp, e) {
    var it = HB.wItems[+inp.getAttribute('data-hb-w')];
    var t = wType(it);
    if (t === 'range' || !it) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      inp.value = inp.defaultValue;
      if (t === 'text' && wFn(it.onChange)) { try { it.onChange(inp.value, wCtx('')); } catch (err) {} }
      inp.blur();
    } else if (t === 'number' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      wNumSet(it, wNum(it, (Number(it.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (+it.step || 1) * (e.shiftKey ? 10 : 1)), inp.closest('.shb-w-num'));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      wCommit(inp);
      inp.blur();
      setTimeout(function () { if (HB.el) hbPaint(); }, 0);
    }
  }

  /* hotbox:open / hotbox:close on window, so other tools can step aside while it is up */
  function hbEmit(what, node) {
    try { window.dispatchEvent(new CustomEvent('hotbox:' + what, { detail: { node: node || null } })); } catch (e) {}
  }

  /* The four Add categories: they fan out above the "+", and one of them can live at the end of the dock */
  var HB_CATS = {
    search: { icon: 'search', label: 'All Nodes', short: 'All Nodes', key: 'F' },
    tools: { icon: 'crop', label: 'Image / Video Kit', short: 'Kit', key: 'N' },
    models: { icon: 'star', label: 'Models & APIs', short: 'Models', key: 'A' },
    subs: { icon: 'subgraph', label: 'Subgraphs', short: 'Subgraphs', key: 'U' }
  };

  function hbDockCat() {
    if (S.hbDockCat === 'none') return '';
    return HB_CATS[S.hbDockCat] ? S.hbDockCat : 'models';
  }

  /* Fluid & Quiet draw every zone; Compact (`compact`) keeps the Fluid look but only the bars */
  function hbPaintPro(el, node, tools, addItems, toolItems, botItems, isAdd, isPair, sel, compact) {
    var fl = hbIsFluid();
    var icoSz = fl ? 15 : 13;
    var nodeTitle = node ? (node.title || node.type || 'Node') : 'Canvas';
    var hasMagnifier = !!(node && hbToolOn('lupa') && (lupaWidget(node) || isCropNode(node) || isPainterNode(node)));
    var slidersHTML = compact ? '' : buildProSlidersHTML(node);

    function rowHTML(attrs, icon, label, key, active) {
      return '<button type="button" class="shb-row' + (active ? ' shb-active' : '') + '" ' + attrs + '>' +
        ico(icon, icoSz) + '<span class="shb-row-l">' + esc(label) + '</span>' +
        (key ? '<span class="shb-key">' + esc(key) + '</span>' : '') +
      '</button>';
    }
    /* Rows share one sliding highlight pill (Fluid); Quiet uses plain hover */
    function rowsHTML(rows) {
      return '<div class="shb-rows" data-hl><div class="shb-hl"></div>' + rows.join('') + '</div>';
    }
    function headHTML(title, note) {
      return '<div class="shb-card-hd"><span class="shb-hd-t">' + esc(title) + '</span>' + (note || '') + '</div>';
    }

    /* TOP ZONE: edit toolbar (edit mode only) + favorites dock [1]..[N] + its category shortcut + context bar */
    var dc = hbDockCat();
    var dcInfo = HB_CATS[dc];
    var topHTML = '<div class="shb-zone shb-zone-top" data-zone="top">' + hbEditBarHTML() +
      '<div class="shb-bar shb-dock">' +
        ((!isAdd || isPair) ? '<span class="shb-dock-mode' + (isPair ? '' : ' shb-dock-swap') + '" title="' + (isPair ? 'Adds the model and wires both selected loaders' : 'The numbered buttons swap the selected model in place') + '">' +
          ico('swap', 13) + '<span>' + (isPair ? 'Wire ' + sel.length : 'Swap') + '</span>' +
        '</span><span class="shb-vsep"></span>' : '') +
        '<div class="shb-bar-items" data-hb-bar="add">' +
          addItems.map(function (it, idx) {
            return renderBarItemHTML(it, 'add', idx < 9 ? (idx + 1) : 0);
          }).join('') +
        '</div>' +
        '<span class="shb-vsep"></span>' +
        (dcInfo ? '<button type="button" class="shb-btn shb-models-btn' + (HB.drawer === dc ? ' shb-btn-on' : '') + '" data-hb-drawer="' + dc + '" title="' + esc(dcInfo.label) + ' (' + dcInfo.key + ')">' +
          ico(dcInfo.icon, 13) + '<span>' + esc(dcInfo.short) + '</span>' +
        '</button>' : '') +
        '<button type="button" class="shb-catpick' + (HB.catMenu ? ' shb-btn-on' : '') + '" data-hb-catpick title="Choose the category that lives here">' + ico('chevDown', 12) + '</button>' +
      '</div>';

    /* Crop nodes get the ratio segmented control (sliding thumb); every other tool stays a bar button */
    var crop = !!(node && isCropNode(node));
    var ratioItems = [], ctxItems = [];
    toolItems.forEach(function (it) {
      if (crop && it.kind === 'tool' && /^ar_/.test(it.id)) ratioItems.push(it);
      else ctxItems.push(it);
    });
    var ctxGroups = hbBarGroups('context');
    if (ctxItems.length || ratioItems.length || HB.editMode || ctxGroups.length) {
      var segHTML = '';
      if (ratioItems.length) {
        var cb = cropBox(node);
        var opts = ['Free'].concat(ratioItems.map(function (it) { return it.id.slice(3); }));
        var ri = Math.max(0, opts.indexOf((cb && cropRatioOf(cb.w, cb.h)) || 'Free'));
        segHTML = '<div class="shb-segc" data-hb-segc style="--i:' + ri + '"><div class="shb-segc-thumb"></div>' +
          opts.map(function (r, i) {
            return '<button type="button" class="shb-segc-b' + (i === ri ? ' shb-on' : '') + '" data-hb-ratio="' + esc(r) + '" data-hb-ri="' + i + '" title="' + (r === 'Free' ? 'Free aspect' : 'Set crop to ' + esc(r)) + '">' + esc(r) + '</button>';
          }).join('') +
        '</div>';
      }
      topHTML += '<div class="shb-bar shb-ctx">' +
        (ctxGroups.length ? '<span class="shb-w-host">' + hbBarGroupsHTML(ctxGroups, 'shb-tool') + '</span>' +
          (ctxItems.length || ratioItems.length ? '<span class="shb-vsep"></span>' : '') : '') +
        '<div class="shb-bar-items" data-hb-bar="tools">' +
          ctxItems.map(function (it) {
            return renderBarItemHTML(it, 'tools', 0);
          }).join('') +
        '</div>' +
        segHTML +
      '</div>';
    }
    topHTML += '</div>';

    /* LEFT ZONE: node utilities + color swatches */
    var leftHTML = '';
    if (!compact) {
      var leftRows = [];
      if (node) leftRows.push(rowHTML('data-hb-act="rename"', 'edit', 'Rename', 'F2'));
      if (hbToolOn('label')) leftRows.push(rowHTML('data-hb-act="label"', 'label', 'Add Label', 'L'));
      if (hasMagnifier) {
        leftRows.push(rowHTML('data-hb-act="lupa"',
          isCropNode(node) ? 'crop' : (isPainterNode(node) ? 'paint' : 'lupa'),
          isCropNode(node) ? 'Visual Crop' : (isPainterNode(node) ? 'Paint Studio' : 'Magnifier'), 'Z'));
      }
      if (node) {
        leftRows.push(rowHTML('data-hb-act="reroute"', 'reroute', 'Add Reroute', 'R'));
        leftRows.push(rowHTML('data-hb-act="set"', 'set', 'Set / Get Bus', 'S'));
      }
      if (node || sel.length) leftRows.push(rowHTML('data-hb-act="group"', 'group', sel.length > 1 ? 'Group ' + sel.length + ' Nodes' : 'Group', 'G'));
      /* On the bare canvas every Set bus offers its Get, dropped right where the hotbox opened */
      var getRows = node ? [] : setNames().map(function (nm) {
        var col = setBusColor(nm);
        return '<button type="button" class="shb-row" data-hb-getbus="' + esc(nm) + '" title="Add Get_' + esc(nm) + ' here">' +
          ico('set', icoSz) + '<span class="shb-row-l">Get ' + esc(nm) + '</span>' +
          (col ? '<i class="shb-cbar-dot" style="background:' + esc(col) + '"></i>' : '') +
        '</button>';
      });
      var hdTitle = fl ? nodeTitle : String(nodeTitle).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      leftHTML = '<div class="shb-zone shb-zone-left" data-zone="left">' +
        '<div class="shb-card shb-card-left">' +
          headHTML((hdTitle || 'node').slice(0, 28), node ? '<span class="shb-hd-id">#' + esc(node.id) + '</span>' : '') +
          rowsHTML(leftRows) +
          (getRows.length ? '<div class="shb-sep"></div>' + headHTML(fl ? 'Get Bus' : 'get_bus', '<span class="shb-hd-note">' + getRows.length + '</span>') +
            '<div class="shb-gets">' + rowsHTML(getRows) + '</div>' : '') +
          (node ? '<div class="shb-sep"></div>' +
            '<div class="shb-colors">' +
              HB_SWATCHES.map(function (sw, i) {
                var on = sw.color ? node.color === sw.color : !node.color;
                return '<i class="shb-cdot' + (on ? ' shb-cdot-on' : '') + '" data-hb-color="' + i + '" style="background:' + sw.dot + '" title="' + esc(sw.name) + '"></i>';
              }).join('') +
              '<label class="shb-pipette" title="Custom color">' + ico('pipette', 14) +
                '<input type="color" data-hb-customcolor value="' + esc(node.bgcolor || node.color || '#3a3a3a') + '">' +
              '</label>' +
            '</div>' : '') +
        '</div>' +
      '</div>';
    }

    /* RIGHT ZONE: Pro Sliders for the node's numeric widgets (the categories live on the "+") */
    var rightHTML = slidersHTML
      ? '<div class="shb-zone shb-zone-right" data-zone="right">' +
          '<div class="shb-card shb-ps-card">' +
            (fl ? headHTML('Pro Sliders', '<span class="shb-hd-note">⇧ fine · ⌃ prev</span>') : headHTML('sliders', '<span>⇧ fine</span>')) +
            slidersHTML +
          '</div>' +
        '</div>'
      : '';

    /* BOTTOM ZONE: action bar (actions, then pinned nodes, then the drop gap) + the standalone "+"
       with its category dial beside it */
    var actItems = botItems.filter(function (it) { return it.kind === 'tool'; });
    var pinItems = botItems.filter(function (it) { return it.kind !== 'tool'; });
    var dialHTML = '<div class="shb-dial"><div class="shb-dial-in">' +
      '<div class="shb-dial-hd">' + (fl ? 'Add & Customize' : 'add') + '</div>' +
      rowsHTML(['search', 'tools', 'models', 'subs'].map(function (c) {
        var k = HB_CATS[c];
        return rowHTML('data-hb-dial="' + c + '"', k.icon, k.label, k.key, HB.drawer === c);
      })) +
    '</div></div>';
    var botHTML = '<div class="shb-zone shb-zone-bot" data-zone="bot">' +
      hbCustomBarHTML() +
      '<div class="shb-botrow">' +
      '<div class="shb-bar shb-botbar">' +
        '<div class="shb-bar-items" data-hb-bar="bot">' +
          actItems.map(function (it) {
            return renderBarItemHTML(it, 'bot', 0);
          }).join('') +
          (actItems.length && pinItems.length ? '<span class="shb-vsep"></span>' : '') +
          pinItems.map(function (it) {
            return renderBarItemHTML(it, 'bot', 0);
          }).join('') +
        '</div>' +
        '<span class="shb-drop-gap"></span>' +
        '<span class="shb-vsep"></span>' +
        '<button type="button" class="shb-ibtn' + (HB.editMode ? ' shb-btn-on' : '') + '" data-hb-act="toggleedit" title="Edit bars (or long-press any button)">' + ico('edit', icoSz) + '</button>' +
        '<button type="button" class="shb-ibtn" data-hb-act="settings" title="Hotbox Settings">' + ico('settings', fl ? 16 : 14) + '</button>' +
      '</div>' +
      '<div class="shb-plus-wrap' + (HB.drawer ? ' shb-drawer-open' : '') + '">' +
        dialHTML +
        '<button type="button" class="shb-plus' + (HB.drawer ? ' shb-plus-on' : '') + '" data-hb-plus title="Add any node (+) · Hover for categories · Drop a node here to pin it">' + ico('plus', fl ? 22 : 18) + '</button>' +
      '</div>' +
      '</div>' +
    '</div>';

    /* Which category lives at the end of the dock */
    var catMenuHTML = HB.catMenu
      ? '<div class="shb-zone shb-zone-catmenu" data-zone="catmenu"><div class="shb-catmenu">' +
          '<div class="shb-dial-hd">' + (fl ? 'Dock shortcut' : 'dock shortcut') + '</div>' +
          rowsHTML(['models', 'tools', 'subs', 'search', 'none'].map(function (c) {
            var k = HB_CATS[c] || { icon: 'collapse', label: 'Hide shortcut' };
            return rowHTML('data-hb-catset="' + c + '"', k.icon, k.label, (c || 'none') === (dc || 'none') ? '✓' : '', (c || 'none') === (dc || 'none'));
          })) +
        '</div></div>'
      : '';

    /* Canvas scrim (Fluid look) and hairline leaders (Quiet); no cursor marker so the node stays readable */
    var decoHTML = fl
      ? (S.hbScrim !== false ? '<div class="shb-scrim"></div>' : '')
      : (S.hbLeaders !== false ? '<svg class="shb-leaders" xmlns="http://www.w3.org/2000/svg"></svg>' : '');

    var drawerHTML = HB.drawer
      ? '<div class="shb-zone shb-zone-drawer" data-zone="drawer">' + buildDrawerHTML(node, tools) + '</div>'
      : '';

    el.innerHTML = decoHTML + topHTML + leftHTML + rightHTML + botHTML + catMenuHTML + drawerHTML;
  }

  function hbUpdateBounds() {
    var r = HB.node ? hbNodeRect(HB.node) : null;
    var Z = parseFloat(S.hbScale) || 1;
    var gapBase = (S.hbGap !== undefined && S.hbGap !== null) ? Number(S.hbGap) : 28;
    var GAP = Math.round(gapBase * Z);

    if (r && r.w > 0 && r.h > 0) {
      HB.rect = r;
      HB.x = Math.round(r.x + r.w / 2);
      HB.y = Math.round(r.y + r.h / 2);
      HB.top = Math.round(r.y) - GAP;
      HB.bot = Math.round(r.y + r.h) + GAP;
      HB.left = Math.round(r.x) - GAP;
      HB.right = Math.round(r.x + r.w) + GAP;
      HB.hub = false;

      var av = hbAvoidRect(r);
      if (av) {
        HB.top = Math.min(HB.top, Math.round(av.top) - Math.max(12, Math.round(GAP * 0.6)));
      } else {
        /* Reserve breathing room for ComfyUI's native selection toolbar above selected node */
        HB.top = Math.min(HB.top, Math.round(r.y) - 44 - Math.round(GAP * 0.5));
      }
    } else {
      HB.rect = null;
      var ax = HB.anchorX || HB_MX;
      var ay = HB.anchorY || HB_MY;
      var spanX = Math.round((85 + gapBase * 1.6) * Z);
      var spanY = Math.round((46 + gapBase * 1.15) * Z);
      HB.x = ax;
      HB.y = ay;
      HB.top = ay - spanY;
      HB.bot = ay + spanY;
      HB.left = ax - spanX;
      HB.right = ax + spanX;
      HB.hub = true;
    }
  }

  function hbPlace() {
    var el = HB.el;
    if (!el) return;
    hbUpdateBounds();
    var z = parseFloat(S.hbScale) || 1;
    el.style.zoom = '';
    el.style.setProperty('--shb-zoom', z !== 1 ? String(z) : '1');
    var W = window.innerWidth || 1600, H = window.innerHeight || 900, EDGE = 14;
    var gapBase = (S.hbGap !== undefined && S.hbGap !== null) ? Number(S.hbGap) : 28;
    var vPad = Math.max(10, Math.round(gapBase * 0.5 * z));

    var zTop = el.querySelector('[data-zone="top"]');
    var zBot = el.querySelector('[data-zone="bot"]');
    var zLeft = el.querySelector('[data-zone="left"]');
    var zRight = el.querySelector('[data-zone="right"]');
    var zHub = el.querySelector('[data-zone="hub"]');
    var zDrawer = el.querySelector('[data-zone="drawer"]');

    var leftY = HB.y;
    var rightY = HB.y;

    function put(dx, dy) {
      if (zTop) {
        zTop.style.left = (HB.x + dx) + 'px';
        zTop.style.top = (HB.top + dy) + 'px';
      }
      if (zBot) {
        zBot.style.left = (HB.x + dx) + 'px';
        zBot.style.top = (HB.bot + dy) + 'px';
      }
      if (zLeft) {
        zLeft.style.left = (HB.left + dx) + 'px';
        zLeft.style.top = (leftY + dy) + 'px';
      }
      if (zRight) {
        zRight.style.left = (HB.right + dx) + 'px';
        zRight.style.top = (rightY + dy) + 'px';
      }
      if (zHub) {
        zHub.style.left = (HB.x + dx) + 'px';
        zHub.style.top = (HB.y + dy) + 'px';
      }
    }

    put(0, 0);

    /* 1. Never overlap ComfyUI's native selection toolbar above the node:
          push Left & Right cards down so their top edge starts below the native toolbar */
    var av = HB.rect ? hbAvoidRect(HB.rect) : null;
    var avoidTop = av ? Math.min(av.top, HB.rect.y - 8) : (HB.rect ? (HB.rect.y - 48) : -1e9);
    var avoidBot = av ? Math.max(av.bottom, HB.rect.y - 2) : (HB.rect ? (HB.rect.y - 2) : -1e9);
    var sideAdjusted = false;

    if (HB.rect) {
      var bL0 = zLeft ? zLeft.getBoundingClientRect() : null;
      var bR0 = zRight ? zRight.getBoundingClientRect() : null;
      var minCardTop = Math.round(avoidBot + 10);
      if (bL0 && bL0.height > 0 && bL0.top < minCardTop) {
        leftY += Math.ceil(minCardTop - bL0.top);
        sideAdjusted = true;
      }
      if (bR0 && bR0.height > 0 && bR0.top < minCardTop) {
        rightY += Math.ceil(minCardTop - bR0.top);
        sideAdjusted = true;
      }
      if (sideAdjusted) put(0, 0);
    }

    /* 2. Unconditional vertical reaction: Bottom Bar always steps below Left/Right cards (1, 2, 3+ sliders)
          and Top Bar always steps above both the native toolbar and Left/Right cards */
    var bLeft = zLeft ? zLeft.getBoundingClientRect() : null;
    var bRight = zRight ? zRight.getBoundingClientRect() : null;
    var bBot = zBot ? zBot.getBoundingClientRect() : null;
    var bTop = zTop ? zTop.getBoundingClientRect() : null;
    var adjusted = false;

    var maxSideBot = HB.rect ? (HB.rect.y + HB.rect.h) : -1e9;
    var minSideTop = (avoidTop > -1e8) ? avoidTop : 1e9;
    if (bLeft && bLeft.height > 0) {
      maxSideBot = Math.max(maxSideBot, bLeft.bottom);
      minSideTop = Math.min(minSideTop, bLeft.top);
    }
    if (bRight && bRight.height > 0) {
      maxSideBot = Math.max(maxSideBot, bRight.bottom);
      minSideTop = Math.min(minSideTop, bRight.top);
    }

    if (bBot && bBot.height > 0 && maxSideBot > -1e9) {
      if (bBot.top < maxSideBot + vPad) {
        HB.bot += Math.ceil((maxSideBot + vPad) - bBot.top);
        adjusted = true;
      }
    }
    if (bTop && bTop.height > 0 && minSideTop < 1e9) {
      var topClearance = Math.max(10, Math.round(vPad * 0.75));
      if (bTop.bottom > minSideTop - topClearance) {
        HB.top -= Math.ceil(bTop.bottom - (minSideTop - topClearance));
        adjusted = true;
      }
    }
    if (adjusted) put(0, 0);

    var L = 1e9, R = -1e9, T = 1e9, B = -1e9;
    [zTop, zBot, zLeft, zRight, zHub].forEach(function (n) {
      if (!n) return;
      var r = n.getBoundingClientRect();
      if (!r.width || !r.height) return;
      L = Math.min(L, r.left); R = Math.max(R, r.right);
      T = Math.min(T, r.top); B = Math.max(B, r.bottom);
    });
    if (L <= R) {
      var dx = 0, dy = 0;
      if (L < EDGE) dx = EDGE - L;
      else if (R > W - EDGE) dx = (W - EDGE) - R;
      if (B > H - EDGE) dy = (H - EDGE) - B;
      if (T + dy < EDGE) dy = EDGE - T;
      if (dx || dy) put(dx, dy);
    }

    /* The standalone "+" sits right of the bottom bar; flip it to the left side near the screen edge */
    if (zBot) {
      zBot.classList.remove('shb-plus-left');
      var pEl = zBot.querySelector('.shb-plus-wrap');
      if (pEl && pEl.getBoundingClientRect().right > W - EDGE) zBot.classList.add('shb-plus-left');
    }
    hbDrawLeaders();

    /* The dock's category menu opens under its ▾, right-aligned */
    var zCat = el.querySelector('[data-zone="catmenu"]');
    var pick = el.querySelector('[data-hb-catpick]');
    if (zCat && pick) {
      var kr = pick.getBoundingClientRect();
      var cw = zCat.getBoundingClientRect().width;
      zCat.style.left = Math.max(EDGE, Math.min(W - EDGE - cw, Math.round(kr.right - cw))) + 'px';
      zCat.style.top = Math.round(kr.bottom + 8) + 'px';
    }

    /* Position Drawer right next to the clicked (+) button or Add & Customize button */
    if (zDrawer) {
      var dX = 0, dY = 0;
      var anc = HB.drawerAnchor;
      var plusEl = (anc && anc.plus) ? hbPlusEl() : null;
      if (plusEl) {
        /* Beside the live "+" (bottom-aligned), on whichever side it has room */
        var pr = plusEl.getBoundingClientRect();
        var flipped = !!(zBot && zBot.classList.contains('shb-plus-left'));
        anc = flipped
          ? { x: Math.round(pr.left - 12), y: Math.round(pr.bottom), fromRight: true, fromBottom: true }
          : { x: Math.round(pr.right + 12), y: Math.round(pr.bottom), fromBottom: true };
        /* No room on that side: open above the "+" so the bottom bar stays free as a drop target */
        if (!flipped && pr.right + 12 + zDrawer.getBoundingClientRect().width > W - EDGE) {
          anc = { x: Math.round(pr.right), y: Math.round(pr.top - 12), fromRight: true, fromBottom: true };
        }
      }
      if (anc && typeof anc.x === 'number') {
        dX = anc.x;
        dY = anc.y;
        if (anc.fromRight || anc.fromBottom) {
          zDrawer.style.left = dX + 'px';
          zDrawer.style.top = dY + 'px';
          var dr0 = zDrawer.getBoundingClientRect();
          if (anc.fromRight) dX = Math.round(dX - dr0.width);
          if (anc.fromBottom) dY = Math.round(dY - dr0.height);
        }
      } else if (zRight) {
        var rr = zRight.getBoundingClientRect();
        dX = Math.round(rr.right + 8);
        dY = Math.round(rr.top);
      } else if (zTop) {
        var tr = zTop.getBoundingClientRect();
        dX = Math.round(tr.right + 8);
        dY = Math.round(tr.top);
      } else {
        dX = Math.round(HB.x + 60);
        dY = Math.round(HB.y - 100);
      }
      zDrawer.style.left = dX + 'px';
      zDrawer.style.top = dY + 'px';
      var dr = zDrawer.getBoundingClientRect();
      if (dr.right > W - EDGE) {
        dX = Math.max(EDGE, Math.round(dX - (dr.right - (W - EDGE))));
      }
      if (dr.left < EDGE) dX = EDGE;
      if (dr.bottom > H - EDGE) {
        dY = Math.max(EDGE, Math.round(dY - (dr.bottom - (H - EDGE))));
      }
      if (dr.top < EDGE) dY = EDGE;
      zDrawer.style.left = dX + 'px';
      zDrawer.style.top = dY + 'px';
    }
  }

  /* Read DOM order of [data-hb-uid] items inside each [data-hb-bar] and persist to localStorage.
     Stored items that are not drawn as buttons right now (hidden in this context, crop ratio segments…)
     are kept unless they were just removed or moved to another bar. */
  function commitDomBarsOrder(rootEl, node, removedUid) {
    if (!rootEl) return;
    var dom = {}, trays = {}, shown = [], inTrays = [];
    function uidsOf(box, noGroups) {
      var out = [];
      Array.prototype.forEach.call(box.children, function (el) {
        var u = el.getAttribute && el.getAttribute('data-hb-uid');
        if (u && out.indexOf(u) < 0 && !(noGroups && /^grp:/.test(u))) out.push(u);
      });
      return out;
    }
    ['add', 'tools', 'bot'].forEach(function (barName) {
      var container = rootEl.querySelector('.shb-bar-items[data-hb-bar="' + barName + '"]');
      if (!container) return;
      dom[barName] = uidsOf(container);
      shown = shown.concat(dom[barName]);
      /* a group's tray holds that group's buttons, in the order they sit there */
      Array.prototype.forEach.call(container.querySelectorAll('[data-hb-gtray]'), function (tr) {
        var k = uidsOf(tr, true);
        trays[tr.getAttribute('data-hb-gtray')] = k;
        shown = shown.concat(k);
        inTrays = inTrays.concat(k);
      });
    });
    Object.keys(trays).forEach(function (gid) {
      var grp = grpById(gid);
      if (!grp) return;
      var keep = trays[gid];
      (grp.items || []).forEach(function (u) {
        if (u !== removedUid && shown.indexOf(u) < 0 && keep.indexOf(u) < 0) keep.push(u);
      });
      grp.items = keep;
    });
    /* a group left with one button (or none) used to unfold into the bar by itself, like a folder on a phone,
       and its name and color went with it: now it stays where it is and asks first (grpAskLone) */
    Object.keys(dom).forEach(function (barName) {
      var keep = dom[barName];
      var old = getBarUids(barName, node);
      /* a button that does not show here goes back after the one it followed, so editing the bar on one node
         never reshuffles it for another */
      old.forEach(function (u, i) {
        if (u === removedUid || inTrays.indexOf(u) >= 0 || keep.indexOf(u) >= 0) return;
        /* in another bar now and it would show here: it was moved there. Anything else stays where it was */
        if (shown.indexOf(u) >= 0 && resolveBarItem(u, node, false, barName)) return;
        var at = 0;
        for (var j = i - 1; j >= 0; j--) {
          var k = keep.indexOf(old[j]);
          if (k >= 0) { at = k + 1; break; }
        }
        keep.splice(at, 0, u);
      });
      setBarUids(barName, node, keep);
    });
    grpAskLone(node);
  }

  /* While a button is dragged over the middle of a group's own button, the group lights up and takes it */
  function hbGrpHot(wrap) {
    if (HB.el) Array.prototype.forEach.call(HB.el.querySelectorAll('.shb-grp-drop'), function (w) { if (w !== wrap) w.classList.remove('shb-grp-drop'); });
    if (wrap) wrap.classList.add('shb-grp-drop');
  }

  function hbGrpTarget(overWrap, x, y) {
    if (!overWrap || !overWrap.classList.contains('shb-grp')) return null;
    var b = overWrap.querySelector(':scope > .shb-btn');
    var r = b && b.getBoundingClientRect();
    if (!r || x < r.left + r.width * 0.2 || x > r.right - r.width * 0.2 || y < r.top || y > r.bottom) return null;
    return overWrap.querySelector(':scope > [data-hb-gtray]');
  }

  /* Long-Press (420ms) Edit Mode, Bar Drags, Drawer Drag-to-Bar, Canvas Node Drag-to-Pin & Pro Slider Scrubbing */
  var LP_DRAG = null;
  var DRAWER_DRAG = null;
  var PSLIDER_DRAG = null;
  var NODE_DRAG = null;

  function clearLpDrag() {
    if (!LP_DRAG) return;
    hbGrpHot(null);
    if (LP_DRAG.timer) clearTimeout(LP_DRAG.timer);
    if (LP_DRAG.mergeT) clearTimeout(LP_DRAG.mergeT);
    if (LP_DRAG.wrap) {
      if (LP_DRAG.active) hbDragHome(LP_DRAG);
      LP_DRAG.wrap.classList.remove('shb-drag-src', 'shb-drag-gone', 'shb-collapsed');
    }
    if (LP_DRAG.active) ghostHide();
    hbDragEnd();
    LP_DRAG = null;
  }

  function hbDragEnd() {
    hbTrashHot(false);
    if (HB.el) HB.el.classList.remove('shb-dragging');
  }

  /* A pointerdown on a node's title bar (Vue node header or canvas-drawn title) can become a drag-to-pin */
  function nodeDragCandidate(e) {
    var t = e.target;
    var g = getGraph();
    if (!t || !t.closest || !g) return null;
    var hdr = t.closest('.lg-node-header');
    if (hdr) {
      var vEl = hdr.closest('.lg-node[data-node-id]');
      return (vEl && g.getNodeById) ? g.getNodeById(vEl.getAttribute('data-node-id')) : null;
    }
    var c = getCanvas();
    if (!c || t !== c.canvas || !c.ds || !g.getNodeOnPos) return null;
    try {
      var r = c.canvas.getBoundingClientRect();
      var s = c.ds.scale || 1;
      var gx = (e.clientX - r.left) / s - c.ds.offset[0];
      var gy = (e.clientY - r.top) / s - c.ds.offset[1];
      var n = g.getNodeOnPos(gx, gy);
      var LG = litegraph();
      var th = (LG && LG.NODE_TITLE_HEIGHT) || 30;
      if (n && n.pos && gy < n.pos[1] && gy >= n.pos[1] - th) return n;
    } catch (err) {}
    return null;
  }

  /* why a just-placed button is dimmed here, or '' */
  function dItem2Off(uid, bar) {
    var it = resolveBarItem(uid, HB.node, false, bar);
    return (it && it.off) || '';
  }

  function nodeTypeOf(node) {
    return node ? String(node.type || node.comfyClass || '') : '';
  }

  function clearDrawerDrag() {
    if (!DRAWER_DRAG) return;
    if (DRAWER_DRAG.st) DRAWER_DRAG.st.classList.remove('shb-st-dragging');
    if (DRAWER_DRAG.wrap && DRAWER_DRAG.wrap.parentNode) {
      DRAWER_DRAG.wrap.parentNode.removeChild(DRAWER_DRAG.wrap);
    }
    if (DRAWER_DRAG.active) ghostHide();
    if (HB.el) HB.el.classList.remove('shb-dropping');
    DRAWER_DRAG = null;
  }

  function clearPsliderDrag() {
    if (!PSLIDER_DRAG) return;
    if (PSLIDER_DRAG.trackEl) PSLIDER_DRAG.trackEl.classList.remove('shb-scrubbing');
    PSLIDER_DRAG = null;
  }

  function findNumWidgetInfo(node, wIdx) {
    var list = getNumericWidgets(node);
    for (var i = 0; i < list.length; i++) {
      if (list[i].wIdx === wIdx) return list[i];
    }
    return null;
  }

  function snapToStep(val, minVal, step, isInt) {
    if (!step || step <= 0) return isInt ? Math.round(val) : val;
    var snapped = Math.round((val - minVal) / step) * step + minVal;
    return isInt ? Math.round(snapped) : Number(snapped.toFixed(5));
  }

  /* Distance in px from point (px, py) to the nearest bar container inside rootEl */
  function distToNearestBar(rootEl, px, py) {
    if (!rootEl) return 0;
    /* an open group's list hangs outside its bar and counts as part of it: it is where its buttons are put in order */
    var bars = rootEl.querySelectorAll('.shb-bar, .shb-grp-show > .shb-gdrop');
    var minDist = 1e9;
    for (var i = 0; i < bars.length; i++) {
      var r = bars[i].getBoundingClientRect();
      if (!r.width || !r.height) continue;
      var dx = px < r.left ? (r.left - px) : (px > r.right ? (px - r.right) : 0);
      var dy = py < r.top ? (r.top - py) : (py > r.bottom ? (py - r.bottom) : 0);
      var d = Math.hypot(dx, dy);
      if (d < minDist) minDist = d;
    }
    return minDist === 1e9 ? 0 : minDist;
  }

  listen(document, 'pointermove', function (e) {
    /* 1. Pro Slider Scrubbing */
    if (PSLIDER_DRAG && HB.el && HB.node) {
      e.preventDefault();
      var ps = PSLIDER_DRAG;
      var info = ps.info;
      var rect = ps.rect;
      var span = (info.sMax - info.sMin) || 1;
      var nextVal;
      if (e.shiftKey) {
        /* Nuke-style fine relative scrubbing when holding Shift */
        var dPx = e.clientX - ps.lastX;
        var deltaVal = (dPx / Math.max(90, rect.width)) * span * 0.2;
        nextVal = snapToStep(ps.curVal + deltaVal, info.sMin, info.fineStep, info.isInt);
      } else {
        var t = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
        var raw = info.sMin + t * span;
        nextVal = snapToStep(raw, info.sMin, info.step, info.isInt);
      }
      nextVal = Math.max(info.sMin, Math.min(info.sMax, nextVal));
      ps.lastX = e.clientX;
      ps.curVal = applyNodeWidgetValue(HB.node, info, nextVal);
      updateSliderRowDOM(ps.rowEl, info, ps.curVal);
      return;
    }

    /* The button was released outside the window: drop any drag that never saw its pointerup */
    if (e.buttons === 0 && (NODE_DRAG || DRAWER_DRAG || (LP_DRAG && LP_DRAG.active))) {
      clearLpDrag();
      clearDrawerDrag();
      NODE_DRAG = null;
      ghostHide();
      if (HB.el) hbSetBotDrop(false);
      return;
    }

    /* 1b. Drag-and-Drop from Drawer into any Bar (or onto the "+", which pins to the bottom bar) */
    if (DRAWER_DRAG && HB.el) {
      var ddist = Math.hypot(e.clientX - DRAWER_DRAG.x0, e.clientY - DRAWER_DRAG.y0);
      if (!DRAWER_DRAG.active) {
        if (ddist < 6) return;
        var dItem = resolveBarItem(DRAWER_DRAG.uid, HB.node, DRAWER_DRAG.loose);
        if (!dItem) { clearDrawerDrag(); return; }
        DRAWER_DRAG.active = true;
        /* dragged in from Settings: the panel turns see-through so every bar is a target */
        if (DRAWER_DRAG.st) {
          tipHide();
          DRAWER_DRAG.st.classList.add('shb-st-dragging');
        }
        DRAWER_DRAG.item = dItem;
        var tmp = document.createElement('div');
        tmp.innerHTML = renderBarItemHTML(dItem, 'add', 0);
        DRAWER_DRAG.wrap = tmp.firstElementChild;
        DRAWER_DRAG.wrap.classList.add('shb-drag-src');
        HB.el.classList.add('shb-dropping');
        ghostShow(dItem.label, e.clientX, e.clientY);
      }
      e.preventDefault();
      var dWrap = DRAWER_DRAG.wrap;
      var px = e.clientX, py = e.clientY;
      var botC = HB.el.querySelector('.shb-bar-items[data-hb-bar="bot"]');
      var target = null, before = null;
      DRAWER_DRAG.merge = null;
      DRAWER_DRAG.tray = null;
      if (botC && hbOverPlus(px, py, 16)) {
        target = botC;
      } else if (distToNearestBar(HB.el, px, py) <= 34) {
        var underEl = null;
        try { underEl = document.elementFromPoint(px, py); } catch (err) { underEl = null; }
        if (underEl && underEl.closest) {
          var overWrapEl = underEl.closest('.shb-item-wrap[data-hb-uid]');
          var overBarBox = underEl.closest('.shb-bar');
          var dTray = /^grp:/.test(DRAWER_DRAG.uid) ? null : hbGrpTarget(overWrapEl, px, py);
          var dMerge = (dTray || /^grp:/.test(DRAWER_DRAG.uid)) ? null : hbMergeTarget(overWrapEl, dWrap, px, py);
          DRAWER_DRAG.merge = dMerge;
          if (dMerge) {
            if (dWrap.parentNode) dWrap.parentNode.removeChild(dWrap);
            DRAWER_DRAG.inBar = true;
            hbGrpHot(dMerge);
            hbSetBotDrop(false);
            ghostMove(px, py, 'Release to group them', 'over');
            return;
          }
          if (dTray) {
            /* it goes into the group on release: nothing in the bar moves while it hovers */
            DRAWER_DRAG.tray = dTray;
            DRAWER_DRAG.inBar = true;
            hbGrpHot(overWrapEl);
            hbSetBotDrop(false);
            ghostMove(px, py, 'Release to put it in ' + ((overWrapEl.querySelector('.shb-lbl') || {}).textContent || 'the group'), 'over');
            return;
          }
          if (overWrapEl && overWrapEl !== dWrap && overWrapEl.parentNode) {
            var wr = overWrapEl.getBoundingClientRect();
            target = overWrapEl.parentNode;
            before = px < (wr.left + wr.width / 2) ? overWrapEl : overWrapEl.nextSibling;
          } else {
            target = underEl.closest('[data-hb-bar]') || (overBarBox && overBarBox.querySelector('[data-hb-bar]'));
          }
        }
      }
      if (target) {
        if (before && before !== dWrap) target.insertBefore(dWrap, before);
        else if (!before && dWrap.parentNode !== target) target.appendChild(dWrap);
      } else if (dWrap.parentNode) {
        dWrap.parentNode.removeChild(dWrap);
      }
      DRAWER_DRAG.inBar = !!target;
      hbGrpHot(target && target.hasAttribute('data-hb-gtray') ? target.closest('.shb-grp') : null);
      hbSetBotDrop(!!(target && target === botC), false);
      ghostMove(px, py, target ? 'Release to pin' : (/^tpl:/.test(DRAWER_DRAG.uid) ? 'Release to add the nodes here' : 'Drag onto a bar or +'), target ? 'over' : '');
      return;
    }

    /* 1c. Canvas node dragged by its title bar: drop it on the bottom bar (or the "+") to pin its type */
    if (NODE_DRAG) {
      var nd = NODE_DRAG;
      if (!nd.active) {
        if (Math.abs(e.clientX - nd.x0) + Math.abs(e.clientY - nd.y0) <= 6) return;
        nd.active = true;
      }
      if (!HB.el) {
        nd.over = false;
        ghostHide();
        return;
      }
      var nType = nodeTypeOf(nd.node);
      var over = hbOverBot(e.clientX, e.clientY, 34);
      var pinned = getBarUids('bot', HB.node).indexOf('node:' + nType) >= 0;
      if (!GHOST) ghostShow(nd.node.title || nType, e.clientX, e.clientY);
      hbSetBotDrop(over, !pinned);
      ghostMove(e.clientX, e.clientY, over ? (pinned ? 'Already pinned' : 'Release to pin') : 'Drag to bar to pin', over ? 'over' : '');
      nd.over = over;
      return;
    }

    /* 2. Bar buttons: moved to any place in a bar or in a group's list (edit mode; pinned ones any time).
       Letting go away from the bars puts the button back where it was: only its × or the Remove strip (the
       edit bar, while a button is in the hand) takes it off its bar */
    if (!LP_DRAG || !HB.el) return;
    var dist = Math.hypot(e.clientX - LP_DRAG.x0, e.clientY - LP_DRAG.y0);
    if (!LP_DRAG.active) {
      /* a hand holding a press shakes a little: it stays a press until it clearly travels */
      if (dist <= (LP_DRAG.timer ? 14 : 9)) return;
      if (LP_DRAG.timer) { clearTimeout(LP_DRAG.timer); LP_DRAG.timer = 0; }
      if (!HB.editMode && !LP_DRAG.isPin) { clearLpDrag(); return; }
      LP_DRAG.active = true;
      LP_DRAG.home = { parent: LP_DRAG.wrap.parentNode, next: LP_DRAG.wrap.nextSibling };
      ghostLift(LP_DRAG.wrap, e.clientX, e.clientY);
      LP_DRAG.wrap.classList.add('shb-drag-src');
      if (HB.editMode) HB.el.classList.add('shb-dragging');
    }
    e.preventDefault();

    var dragWrap = LP_DRAG.wrap;
    var mx = e.clientX, my = e.clientY;
    var trash = hbOverTrash(mx, my);
    var out = !trash && distToNearestBar(HB.el, mx, my) > 34 && !hbOverPlus(mx, my, 16);
    /* outside edit mode, a saved button let go over the canvas drops its nodes there */
    var drop = /^tpl:/.test(dragWrap.getAttribute('data-hb-uid') || '') && !HB.editMode;
    LP_DRAG.trash = trash;
    LP_DRAG.outside = out;
    hbTrashHot(trash);
    dragWrap.classList.toggle('shb-drag-gone', trash);
    if (trash || out) {
      hbLpMerge(null);
      LP_DRAG.tray = null;
      hbGrpHot(null);
      hbDragHome(LP_DRAG);
      ghostMove(mx, my, trash ? 'Release to take it off the bar' : (drop ? 'Release to drop the nodes here' : 'Release to put it back'),
        trash ? 'rm' : (drop ? 'over' : ''));
      return;
    }

    LP_DRAG.tray = null;
    var under = null;
    try { under = document.elementFromPoint(mx, my); } catch (err) { under = null; }
    if (!under || !under.closest) { ghostMove(mx, my, '', ''); return; }

    var overWrap = under.closest('.shb-item-wrap[data-hb-uid]');
    if (overWrap && dragWrap.contains(overWrap)) { ghostMove(mx, my, '', ''); return; }
    var dragIsGrp = /^grp:/.test(dragWrap.getAttribute('data-hb-uid') || '');
    /* a group moves as a whole, never into another group */
    if (overWrap && dragIsGrp && overWrap.parentNode && overWrap.parentNode.hasAttribute('data-hb-gtray')) {
      overWrap = overWrap.parentNode.closest('.shb-item-wrap[data-hb-uid]');
    }
    var intoTray = dragIsGrp ? null : hbGrpTarget(overWrap, mx, my);
    if (intoTray) {
      /* it goes in on release: moving it into the list now would shift the bar under the pointer (a wide button
         next to the group pulled the group away, and the button bounced in and out). Waiting on the group opens
         its list, and there the button goes to any place in it, the first one too */
      hbLpMerge(null);
      LP_DRAG.tray = intoTray;
      hbGrpHot(overWrap);
      ghostMove(mx, my, 'Release to put it in ' + ((overWrap.querySelector('.shb-lbl') || {}).textContent || 'the group') + ' · wait, and pick its place', 'over');
      return;
    }
    /* resting on the middle of another button groups the two; passing over it only moves the button to that side */
    hbLpMerge(dragIsGrp ? null : hbMergeTarget(overWrap, dragWrap, mx, my));
    if (LP_DRAG.merge) {
      hbGrpHot(LP_DRAG.merge);
      ghostMove(mx, my, 'Release to group them', 'over');
      return;
    }
    hbGrpHot(null);
    ghostMove(mx, my, '', '');
    var overTray = under.closest('[data-hb-gtray]');
    if (overWrap && overWrap !== dragWrap && overWrap.parentNode) {
      var r = overWrap.getBoundingClientRect();
      /* inside a group's list the buttons stack, so the halves are top and bottom */
      var isBefore = overWrap.parentNode.hasAttribute('data-hb-gtray') ? my < (r.top + r.height / 2) : mx < (r.left + r.width / 2);
      var ref = isBefore ? overWrap : overWrap.nextSibling;
      if (ref !== dragWrap && !(isBefore && overWrap.previousSibling === dragWrap)) overWrap.parentNode.insertBefore(dragWrap, ref);
      return;
    }
    if (overTray && !dragIsGrp && !dragWrap.contains(overTray)) {
      /* on the list's own edge, or in a gap of it: its first place or its last, whichever end is nearer */
      var tr = overTray.getBoundingClientRect();
      if (my < tr.top + tr.height / 2) {
        if (overTray.firstElementChild !== dragWrap) overTray.insertBefore(dragWrap, overTray.firstElementChild);
      } else if (overTray.lastElementChild !== dragWrap) overTray.appendChild(dragWrap);
      return;
    }
    var overBar = under.closest('[data-hb-bar]');
    if (overBar && overBar !== dragWrap.parentNode && !overTray) {
      overBar.appendChild(dragWrap);
    }
  }, true);

  /* Grouping two buttons takes a short rest on the middle of the other one, which lights up; a button that is
     only passing over another on its way somewhere else just moves */
  function hbLpMerge(cand) {
    var lp = LP_DRAG;
    if (!lp || (lp.mergeCand || null) === (cand || null)) return;
    if (lp.mergeT) { clearTimeout(lp.mergeT); lp.mergeT = 0; }
    lp.mergeCand = cand || null;
    lp.merge = null;
    if (!cand) return;
    lp.mergeT = setTimeout(function () {
      lp.mergeT = 0;
      if (LP_DRAG !== lp || lp.mergeCand !== cand || !cand.isConnected) return;
      lp.merge = cand;
      hbGrpHot(cand);
      if (GHOST) ghostMove(parseFloat(GHOST.style.left) || 0, parseFloat(GHOST.style.top) || 0, 'Release to group them', 'over');
    }, 420);
  }

  listen(document, 'pointerup', function (e) {
    if (PSLIDER_DRAG) {
      HB.suppressClickUntil = Date.now() + 180;
      clearPsliderDrag();
      return;
    }
    if (DRAWER_DRAG) {
      var dd = DRAWER_DRAG;
      DRAWER_DRAG = null;
      ghostHide();
      if (dd.st) dd.st.classList.remove('shb-st-dragging');
      if (dd.active && HB.el) {
        HB.suppressClickUntil = Date.now() + 260;
        HB.el.classList.remove('shb-dropping');
        hbSetBotDrop(false);
        var dw = dd.wrap;
        hbGrpHot(null);
        /* the bar it lands in: a group's tray or the button it is grouped with sit in a bar too */
        var dLand = (dd.tray && dd.tray.isConnected && dd.tray.closest('[data-hb-bar]'))
          || (dd.merge && dd.merge.isConnected && dd.merge)
          || (dd.inBar && dw && dw.parentNode && dw.parentNode.closest && dw.parentNode.closest('[data-hb-bar]'));
        if (dLand) {
          hbUndoPush('adding "' + (dd.item ? dd.item.label : 'a button') + '"');
          hbKeepUid(dd.uid, dLand.getAttribute('data-hb-bar'));
        }
        if (dd.tray && dd.tray.isConnected && dw) {
          dw.classList.remove('shb-drag-src');
          dd.tray.appendChild(dw);
          var dtLbl = dd.tray.closest('.shb-grp') && dd.tray.closest('.shb-grp').querySelector(':scope > .shb-btn .shb-lbl');
          commitDomBarsOrder(HB.el, HB.node);
          hbPaint();
          setStatus('ok', 'Put "' + (dd.item ? dd.item.label : 'button') + '" in "' + (dtLbl ? dtLbl.textContent : 'the group') + '"');
        } else if (dd.merge && dd.merge.isConnected && dw) {
          dw.classList.remove('shb-drag-src');
          var dmGid = hbMergeDom(dd.merge, dw);
          commitDomBarsOrder(HB.el, HB.node);
          hbPaint();
          hbGrpPop(dmGid);
          setStatus('ok', 'Grouped with "' + (dd.item ? dd.item.label : 'button') + '" · drop more on it');
        } else if (dd.inBar && dw && dw.parentNode && (dw.parentNode.hasAttribute('data-hb-bar') || dw.parentNode.hasAttribute('data-hb-gtray'))) {
          dw.classList.remove('shb-drag-src');
          /* the bar it landed in (the dragged copy itself carries a bar name of its own) */
          var dBox = dw.parentNode && dw.parentNode.closest('[data-hb-bar]');
          var dBar = dBox && dBox.getAttribute('data-hb-bar');
          commitDomBarsOrder(HB.el, HB.node);
          hbPaint();
          hbFlashUid(dd.uid);
          /* where it went: the bottom bar is the same everywhere, the other two follow the kind of node */
          var dHere = dItem2Off(dd.uid, dBar);
          setStatus('ok', '📌 Pinned "' + (dd.item ? dd.item.label : 'button') + '"' +
            (dBar === 'bot' ? ' to the bottom bar (every node)'
              : ' to the ' + (dBar === 'add' ? 'top bar' : 'context bar') + ' of ' + (HB.node ? 'nodes like "' + (HB.node.title || nodeTypeOf(HB.node)) + '"' : 'the canvas')) +
            (dHere ? ' · dimmed here: ' + dHere : ''));
        } else {
          if (dw && dw.parentNode) dw.parentNode.removeChild(dw);
          /* a saved button let go over the canvas adds its nodes right there */
          var dTpl = /^tpl:/.test(dd.uid) && tplById(dd.uid.slice(4));
          if (dTpl) {
            hbClose();
            tplRun(dTpl, { x: e.clientX, y: e.clientY }, { x: e.clientX, y: e.clientY });
          }
        }
      }
      return;
    }
    if (NODE_DRAG) {
      var nd = NODE_DRAG;
      NODE_DRAG = null;
      ghostHide();
      if (HB.el) hbSetBotDrop(false);
      if (nd.active && nd.over && HB.el) {
        var nType = nodeTypeOf(nd.node);
        var nm = nd.node.title || nType;
        var added = hbPinType(nType, HB.node);
        var moved = nd.node, p0 = nd.pos0;
        /* The drop was a pin gesture, not a move: put the node back once the canvas has finished its own drag */
        setTimeout(function () {
          try { moved.pos = [p0[0], p0[1]]; } catch (err) {}
          var g = getGraph();
          if (g && g.setDirtyCanvas) g.setDirtyCanvas(true, true);
        }, 40);
        hbPaint();
        hbFlashUid('node:' + nType);
        setStatus('ok', added ? '📌 Pinned "' + nm + '" to the bottom bar' : '"' + nm + '" is already pinned');
        return;
      }
      if (nd.closeOnUp && HB.el) hbClose();
      return;
    }
    if (!LP_DRAG) return;
    var lp = LP_DRAG;
    LP_DRAG = null;
    if (lp.timer) clearTimeout(lp.timer);
    if (lp.mergeT) clearTimeout(lp.mergeT);
    if (!lp.active) {
      /* A long-press that only entered edit mode must not also run the button */
      if (lp.fired) HB.suppressClickUntil = Date.now() + 250;
      return;
    }
    ghostHide();
    hbDragEnd();
    HB.suppressClickUntil = Date.now() + 250;
    if (!HB.el) return;
    var w = lp.wrap;
    var uid = w.getAttribute('data-hb-uid');
    var lbl = w.querySelector('.shb-lbl');
    var name = lbl ? lbl.textContent : uid;
    w.classList.remove('shb-drag-src', 'shb-drag-gone', 'shb-collapsed');
    if (lp.outside && /^tpl:/.test(uid) && !HB.editMode) {
      hbDragHome(lp);
      var dropTpl = tplById(uid.slice(4));
      hbClose();
      tplRun(dropTpl, { x: e.clientX, y: e.clientY }, { x: e.clientX, y: e.clientY });
      return;
    }
    hbGrpHot(null);
    if (lp.trash) {
      /* dropped on the Remove strip */
      hbUndoPush('taking "' + name + '" off the bar');
      if (w.parentNode) w.parentNode.removeChild(w);
      hbPoof(e.clientX, e.clientY, name);
      if (/^grp:/.test(uid)) grpDissolve(w.getAttribute('data-hb-bar') || 'bot', uid, HB.node);
      else commitDomBarsOrder(HB.el, HB.node, uid);
      hbForgetIfGone(uid);
      hbPaint();
      setStatus('ok', (/^grp:/.test(uid) ? 'Ungrouped "' + name + '" · its buttons stay in the bar' : 'Took "' + name + '" off the bar') + ' · Ctrl+Z puts it back');
    } else if (lp.outside) {
      /* let go away from the bars: nothing is removed, it goes back where it was */
      hbDragHome(lp);
      hbPaint();
      setStatus('ok', '"' + name + '" is back where it was · ' + (HB.editMode ? 'its ×, or the Remove strip in the edit bar, takes it off' : 'hold it to edit, then its × takes it off the bar'));
    } else if (lp.tray && lp.tray.isConnected && !w.contains(lp.tray)) {
      hbUndoPush('moving "' + name + '"');
      lp.tray.appendChild(w);
      var tGrp = lp.tray.closest('.shb-grp'), tLbl = tGrp && tGrp.querySelector(':scope > .shb-btn .shb-lbl');
      commitDomBarsOrder(HB.el, HB.node);
      hbPaint();
      setStatus('ok', 'Put "' + name + '" in "' + (tLbl ? tLbl.textContent : 'the group') + '"');
    } else if (lp.merge && lp.merge.isConnected && !w.contains(lp.merge)) {
      hbUndoPush('grouping "' + name + '"');
      var mLbl = lp.merge.querySelector('.shb-lbl');
      var mGid = hbMergeDom(lp.merge, w);
      commitDomBarsOrder(HB.el, HB.node);
      hbPaint();
      hbGrpPop(mGid);
      setStatus('ok', 'Grouped "' + (mLbl ? mLbl.textContent : '') + '" + "' + name + '" · drop more on it · click it in edit mode to rename');
    } else {
      hbUndoPush('moving "' + name + '"');
      var toBar = w.parentNode && w.parentNode.getAttribute && w.parentNode.getAttribute('data-hb-bar');
      if (toBar && toBar !== w.getAttribute('data-hb-bar')) hbKeepUid(uid, toBar);
      commitDomBarsOrder(HB.el, HB.node);
      hbPaint();
    }
  }, true);

  listen(document, 'pointercancel', function () {
    clearLpDrag();
    clearDrawerDrag();
    NODE_DRAG = null;
    ghostHide();
    if (HB.el) hbSetBotDrop(false);
  }, true);

  function hbClose() {
    clearLpDrag();
    clearDrawerDrag();
    clearPsliderDrag();
    hbStopEditAnim();
    ghostHide();
    var old = HB.el;
    var cx = HB.anchorX || HB.x, cy = HB.anchorY || HB.y;
    if (HB.psSync) { clearInterval(HB.psSync); HB.psSync = 0; }
    /* a group kept open folds up again: the next hotbox opens with every group closed */
    Object.keys(S.hbGroups || {}).forEach(function (g) { delete HB.grpOpen[g]; });
    HB.el = null; HB.node = null; HB.rect = null; HB.drawer = ''; HB.drawerAnchor = null; HB.editMode = false; HB.q = ''; HB.keyMap = {}; HB.catMenu = false; HB.wItems = []; HB.wMenu = null;
    if (old) {
      old.removeAttribute('id');
      hbAnimateClose(old, cx, cy);
      hbEmit('close', null);
    }
  }

  function hbOpen() {
    hbClose();
    if (!SRV.probed) probe().then(function () { if (HB.el) hbPaint(); });
    var libAt = LIB.at;
    libRefresh().then(function () { if (HB.el && LIB.at !== libAt && !hbTyping()) hbPaint(); });
    var el = owns(document.createElement('div'));
    el.className = 'shb-wrap';
    el.id = PANEL_ID + '-hb';
    HB.el = el;
    HB.node = hbNode();
    HB.drawer = '';
    HB.editMode = false;
    HB.q = '';
    HB.anchorX = HB_MX;
    HB.anchorY = HB_MY;
    HB.initialVals = {};
    HB.prevVals = {};
    if (HB.node) {
      getNumericWidgets(HB.node).forEach(function (it) {
        HB.initialVals[it.wIdx] = it.val;
        HB.prevVals[it.wIdx] = it.val;
      });
    }

    hbUpdateBounds();

    document.body.appendChild(el);
    /* told before the first paint, so a tool that hides its own copy of the Custom Bar's buttons is gone by the bloom */
    hbEmit('open', HB.node);
    hbPaint();
    hbAnimateOpen();
    hbWireWidgetFields(el);
    hbWireGroups(el);

    /* One sliding highlight pill per card follows the hovered row (Fluid) */
    el.addEventListener('mouseover', function (e) {
      var row = e.target && e.target.closest ? e.target.closest('[data-hl] > .shb-row') : null;
      var hl = row && row.parentNode.querySelector(':scope > .shb-hl');
      if (!hl) return;
      hl.style.transform = 'translateY(' + row.offsetTop + 'px)';
      hl.style.height = row.offsetHeight + 'px';
      hl.style.opacity = '1';
    });
    el.addEventListener('mouseout', function (e) {
      var box = e.target && e.target.closest ? e.target.closest('[data-hl]') : null;
      if (!box || (e.relatedTarget && box.contains(e.relatedTarget))) return;
      var hl = box.querySelector(':scope > .shb-hl');
      if (hl) hl.style.opacity = '0';
    });

    /* Long-Press initiation on bar buttons & Pro Slider track scrubbing */
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-ps-num]')) return;

      /* Ctrl+Click on Pro Slider track or label -> restore previous value */
      var psCtrlTarget = (e.ctrlKey || e.metaKey) ? (t.closest('[data-ps-track]') || t.closest('[data-ps-reset]')) : null;
      if (psCtrlTarget && HB.node) {
        e.preventDefault();
        e.stopPropagation();
        HB.suppressClickUntil = Date.now() + 220;
        var cWIdx = +(psCtrlTarget.getAttribute('data-ps-track') || psCtrlTarget.getAttribute('data-ps-reset'));
        var cInfo = findNumWidgetInfo(HB.node, cWIdx);
        if (!cInfo) return;
        var prevCandidate = (HB.prevVals && HB.prevVals[cWIdx] !== undefined && HB.prevVals[cWIdx] !== cInfo.val)
          ? HB.prevVals[cWIdx]
          : ((HB.initialVals && HB.initialVals[cWIdx] !== undefined) ? HB.initialVals[cWIdx] : cInfo.defVal);
        if (!HB.prevVals) HB.prevVals = {};
        HB.prevVals[cWIdx] = cInfo.val;
        var restored = applyNodeWidgetValue(HB.node, cInfo, prevCandidate);
        var cRow = psCtrlTarget.closest('.shb-ps');
        updateSliderRowDOM(cRow, cInfo, restored);
        var cNum = cRow && cRow.querySelector('.shb-ps-num');
        if (cNum) cNum.value = formatSliderVal(cInfo, restored);
        setStatus('ok', '↺ ' + cInfo.label + ' → ' + formatSliderVal(cInfo, restored));
        return;
      }

      /* Pro Slider track scrubbing */
      var psTrack = t.closest('[data-ps-track]');
      if (psTrack && HB.node) {
        e.preventDefault();
        e.stopPropagation();
        /* a number box left focused (clicked or typed into earlier) would stop showing the value being scrubbed */
        var focusedNum = document.activeElement;
        if (focusedNum && focusedNum.hasAttribute && focusedNum.hasAttribute('data-ps-num') && el.contains(focusedNum)) focusedNum.blur();
        var wIdx = +psTrack.getAttribute('data-ps-track');
        var info = findNumWidgetInfo(HB.node, wIdx);
        if (!info) return;
        if (!HB.prevVals) HB.prevVals = {};
        HB.prevVals[wIdx] = info.val;
        var rect = psTrack.getBoundingClientRect();
        var rowEl = psTrack.closest('.shb-ps');
        var curVal = info.val;
        if (!e.shiftKey) {
          var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
          var raw = info.sMin + ratio * (info.sMax - info.sMin);
          var snapped = snapToStep(raw, info.sMin, info.step, info.isInt);
          curVal = applyNodeWidgetValue(HB.node, info, snapped);
          updateSliderRowDOM(rowEl, info, curVal);
        }
        psTrack.classList.add('shb-scrubbing');
        PSLIDER_DRAG = {
          wIdx: wIdx,
          info: info,
          trackEl: psTrack,
          rowEl: rowEl,
          rect: rect,
          lastX: e.clientX,
          curVal: curVal
        };
        return;
      }

      if (t.closest('[data-hb-rm]') || t.closest('[data-hb-ren]') || t.closest('[data-hb-tpldel]')) return;

      /* Drag item from Drawer into any Bar */
      var drwItem = t.closest('[data-drawer-uid]');
      if (drwItem) {
        clearDrawerDrag();
        DRAWER_DRAG = {
          uid: drwItem.getAttribute('data-drawer-uid'),
          x0: e.clientX,
          y0: e.clientY,
          active: false,
          inBar: false,
          wrap: null
        };
        return;
      }

      var wrap = t.closest('.shb-item-wrap[data-hb-uid]');
      if (!wrap) return;
      clearLpDrag();
      var wUid = wrap.getAttribute('data-hb-uid') || '';
      LP_DRAG = {
        wrap: wrap,
        x0: e.clientX,
        y0: e.clientY,
        active: false,
        fired: false,
        isPin: (wrap.getAttribute('data-hb-bar') === 'bot' && wUid.indexOf('tool:') !== 0) || wUid.indexOf('tpl:') === 0,
        timer: HB.editMode ? 0 : setTimeout(function () {
          if (!LP_DRAG || LP_DRAG.wrap !== wrap || !HB.el) return;
          LP_DRAG.timer = 0;
          LP_DRAG.fired = true;
          var lpBar = wrap.getAttribute('data-hb-bar') || '';
          var lpTray = (wrap.parentNode && wrap.parentNode.getAttribute && wrap.parentNode.getAttribute('data-hb-gtray')) || '';
          hbSetEdit(true);
          /* the bars were drawn again with the button still under the pointer: the press goes on with that new
             copy of it, so it can be dragged right away */
          var again = null;
          try {
            again = HB.el && HB.el.querySelector((lpTray ? '[data-hb-gtray="' + cssEsc(lpTray) + '"]' : '.shb-bar-items[data-hb-bar="' + cssEsc(lpBar) + '"]') +
              ' > .shb-item-wrap[data-hb-uid="' + cssEsc(wUid) + '"]');
          } catch (err) { again = null; }
          if (again && LP_DRAG) LP_DRAG.wrap = again;
        }, 420)
      };
    });

    /* Right-click on a bar button: its Edit Button box (name, color, key), the one a click opens in edit mode */
    el.addEventListener('contextmenu', function (e) {
      var w = e.target && e.target.closest ? e.target.closest('.shb-item-wrap[data-hb-uid]') : null;
      if (!w || !w.closest('[data-hb-bar]')) return;
      e.preventDefault();
      e.stopPropagation();
      clearLpDrag();
      promptRenameBarItem(w.getAttribute('data-hb-uid'), HB.node, w.querySelector(':scope > .shb-btn'));
    });

    /* Double-click on Pro Slider label/track to reset to default value */
    el.addEventListener('dblclick', function (e) {
      var t = e.target;
      if (!t || !t.closest || !HB.node) return;
      var rst = t.closest('[data-ps-reset]') || t.closest('[data-ps-track]');
      if (rst) {
        e.preventDefault();
        e.stopPropagation();
        var wIdx = +(rst.getAttribute('data-ps-reset') || rst.getAttribute('data-ps-track'));
        var info = findNumWidgetInfo(HB.node, wIdx);
        if (!info) return;
        var v = applyNodeWidgetValue(HB.node, info, info.defVal);
        var rowEl = rst.closest('.shb-ps');
        updateSliderRowDOM(rowEl, info, v);
        var numIn = rowEl && rowEl.querySelector('.shb-ps-num');
        if (numIn) numIn.value = formatSliderVal(info, v);
      }
    });

    /* Mouse wheel over a Pro Slider row nudges the value smoothly; when the sliders scroll, the wheel scrolls
       them and only nudges over the number itself */
    el.addEventListener('wheel', function (e) {
      var t = e.target;
      if (!t || !t.closest || !HB.node) return;
      var rowEl = t.closest('.shb-ps[data-ps-row]');
      if (!rowEl) return;
      e.stopPropagation();
      if (t.closest('.shb-ps-scroll') && !t.closest('.shb-ps-num')) return;
      e.preventDefault();
      var wIdx = +rowEl.getAttribute('data-ps-row');
      var info = findNumWidgetInfo(HB.node, wIdx);
      if (!info) return;
      var dir = e.deltaY < 0 ? 1 : -1;
      var stp = e.shiftKey ? info.fineStep : info.step;
      var nextVal = snapToStep(info.val + dir * stp, info.sMin, stp, info.isInt);
      var v = applyNodeWidgetValue(HB.node, info, nextVal);
      if (v < info.sMin) info.sMin = v;
      if (v > info.sMax) info.sMax = v;
      updateSliderRowDOM(rowEl, info, v);
      var numIn = rowEl.querySelector('.shb-ps-num');
      if (numIn) numIn.value = formatSliderVal(info, v);
    }, { passive: false });

    el.onclick = function (e) {
      if (Date.now() < HB.suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      var t = e.target;
      if (!t || !t.closest) return;
      if (t === el) { hbClose(); return; }

      var psStep = t.closest('[data-ps-step]');
      if (psStep && HB.node) {
        e.stopPropagation();
        var dir = +psStep.getAttribute('data-ps-step') || 1;
        var wIdx = +psStep.getAttribute('data-ps-widx');
        var info = findNumWidgetInfo(HB.node, wIdx);
        if (info) {
          var stp = e.shiftKey ? info.fineStep : info.step;
          var nextVal = snapToStep(info.val + dir * stp, info.sMin, stp, info.isInt);
          var v = applyNodeWidgetValue(HB.node, info, nextVal);
          if (v < info.sMin) info.sMin = v;
          if (v > info.sMax) info.sMax = v;
          var rowEl = psStep.closest('.shb-ps');
          updateSliderRowDOM(rowEl, info, v);
          var numIn = rowEl && rowEl.querySelector('.shb-ps-num');
          if (numIn) numIn.value = formatSliderVal(info, v);
        }
        return;
      }

      var tDel = t.closest('[data-hb-tpldel]');
      if (tDel) {
        e.stopPropagation();
        /* deleting a saved button is for good, so it takes a second click */
        if (!tDel.classList.contains('shb-armed')) {
          tDel.classList.add('shb-armed');
          tDel.title = 'Click again to delete';
          setStatus('error', 'Click the trash again to delete this saved button for good');
          return;
        }
        tplDelete(tDel.getAttribute('data-hb-tpldel'));
        hbPaint();
        return;
      }

      var rmBtn = t.closest('[data-hb-rm]');
      if (rmBtn) {
        e.stopPropagation();
        var rmUid = rmBtn.getAttribute('data-hb-rm');
        var rmBar = rmBtn.getAttribute('data-hb-rmbar') || 'add';
        var rmWrap = rmBtn.closest('.shb-item-wrap');
        if (rmWrap) rmWrap.classList.add('shb-removing');
        /* Collapse first (max-width -> 0, scale .3, fade), then drop it from the list */
        var rmGrp = rmBtn.getAttribute('data-hb-rmgrp');
        var rmLbl = rmWrap && rmWrap.querySelector('.shb-lbl');
        hbUndoPush('removing "' + (rmLbl ? rmLbl.textContent : 'a button') + '"');
        setTimeout(function () {
          var inGrp = rmGrp && grpById(rmGrp);
          if (inGrp) {
            inGrp.items = (inGrp.items || []).filter(function (u) { return u !== rmUid; });
            save();
          } else if (/^grp:/.test(rmUid)) {
            grpDissolve(rmBar, rmUid, HB.node);
          } else {
            setBarUids(rmBar, HB.node, getBarUids(rmBar, HB.node).filter(function (u) { return u !== rmUid; }));
          }
          hbForgetIfGone(rmUid);
          if (HB.el) hbPaint();
          if (inGrp) grpAskLone(HB.node);
        }, 130);
        return;
      }

      var renBtn = t.closest('[data-hb-ren]');
      if (renBtn) {
        e.stopPropagation();
        var renUid = renBtn.getAttribute('data-hb-ren');
        var renEl = HB.el && HB.el.querySelector('.shb-item-wrap[data-hb-uid="' + cssEsc(renUid) + '"] > .shb-btn');
        promptRenameBarItem(renUid, HB.node, renEl);
        return;
      }

      var dTabBtn = t.closest('[data-hb-drawer-tab]');
      if (dTabBtn) {
        HB.drawer = dTabBtn.getAttribute('data-hb-drawer-tab') || 'search';
        HB.q = '';
        hbPaint();
        return;
      }

      if (t.closest('[data-hb-plus]')) {
        hbTogglePlus();
        return;
      }

      var dialCat = t.closest('[data-hb-dial]');
      if (dialCat) {
        hbTogglePlus(dialCat.getAttribute('data-hb-dial'));
        return;
      }

      if (t.closest('[data-hb-catpick]')) {
        HB.catMenu = !HB.catMenu;
        hbPaint();
        return;
      }

      var catSet = t.closest('[data-hb-catset]');
      if (catSet) {
        S.hbDockCat = catSet.getAttribute('data-hb-catset') || 'models';
        save();
        HB.catMenu = false;
        hbPaint();
        setStatus('ok', S.hbDockCat === 'none' ? 'Dock shortcut hidden' : 'Dock shortcut: ' + HB_CATS[S.hbDockCat].label);
        return;
      }

      var segB = t.closest('[data-hb-ratio]');
      if (segB) {
        var segc = segB.closest('[data-hb-segc]');
        if (segc) {
          segc.style.setProperty('--i', segB.getAttribute('data-hb-ri') || '0');
          Array.prototype.forEach.call(segc.querySelectorAll('.shb-segc-b'), function (b) { b.classList.toggle('shb-on', b === segB); });
        }
        var ar = segB.getAttribute('data-hb-ratio');
        if (ar !== 'Free' && HB.node) {
          cropSet(HB.node, ar, '');
          hbRefreshSliders();
        }
        return;
      }

      var cTargetBtn = t.closest('[data-hb-ctarget]');
      if (cTargetBtn) {
        HB.customTarget = cTargetBtn.getAttribute('data-hb-ctarget') || 'add';
        hbPaint();
        return;
      }

      var togBar = t.closest('[data-hb-togglebar]');
      if (togBar) {
        toggleBarItem(HB.customTarget || 'add', HB.node, togBar.getAttribute('data-hb-togglebar'));
        hbPaint();
        return;
      }

      var drw = t.closest('[data-hb-drawer]');
      if (drw) {
        var which = drw.getAttribute('data-hb-drawer');
        var dRect = drw.getBoundingClientRect();
        /* from the dock: open under the button, right-aligned to it */
        HB.drawerAnchor = { x: Math.round(dRect.right), y: Math.round(dRect.bottom + 10), fromRight: true };
        HB.catMenu = false;
        HB.drawer = (HB.drawer === which) ? '' : which;
        HB.q = '';
        hbPaint();
        return;
      }

      /* An open widget menu folds away on any other click in the hotbox */
      if (HB.wMenu && !t.closest('[data-zone="wmenu"]') && !(HB.wMenu.anchor && HB.wMenu.anchor.contains(t))) hbMenuClose();
      var wEl = t.closest('[data-hb-w]');
      if (wEl) {
        e.stopPropagation();
        hbWClick(wEl, e);
        return;
      }

      var getBus = t.closest('[data-hb-getbus]');
      if (getBus) {
        var gName = getBus.getAttribute('data-hb-getbus');
        hbClose();
        addGetNamed(gName);
        return;
      }

      var grpChev = t.closest('[data-hb-grpchev]');
      if (grpChev) {
        e.stopPropagation();
        var gw = grpChev.closest('.shb-grp');
        if (gw) hbGrpClick(gw);
        return;
      }

      var runBtn = t.closest('[data-hb-run]');
      if (runBtn && HB.editMode && runBtn.closest('[data-hb-bar]')) {
        /* In edit mode a tap renames the button instead of running it */
        promptRenameBarItem(runBtn.getAttribute('data-hb-run'), HB.node, runBtn);
        return;
      }
      if (runBtn) {
        var rUid = runBtn.getAttribute('data-hb-run');
        var rWrap = runBtn.closest('[data-hb-bar]');
        var item = resolveBarItem(rUid, HB.node, false, rWrap && rWrap.getAttribute('data-hb-bar'));
        if (item && item.off) {
          setStatus('ok', item.label + ': ' + item.off);
          return;
        }
        if (item && item.run) {
          if (!item.stayOpen) hbClose();
          item.run();
        }
        return;
      }

      var cdot = t.closest('[data-hb-color]');
      if (cdot) {
        var sw = HB_SWATCHES[+cdot.getAttribute('data-hb-color')];
        if (sw) applyNodeColor(HB.node, sw);
        Array.prototype.forEach.call(el.querySelectorAll('.shb-cdot'), function (d) { d.classList.toggle('shb-cdot-on', d === cdot); });
        return;
      }

      var mod = t.closest('[data-hb-model]');
      if (mod) {
        var mType = mod.getAttribute('data-hb-model');
        var n = HB.node;
        var sel = selNodes();
        hbClose();
        hbReady(mType).then(function () {
          if (sel.length >= 2 && ndAdds(n)) addModelPair(sel, mType);
          else if (ndAdds(n)) addModel(n, mType);
          else swapSelected(n, mType);
        });
        return;
      }

      var rsz = t.closest('[data-hb-rsz]');
      if (rsz) {
        var rType = rsz.getAttribute('data-hb-rsz');
        var nR = HB.node;
        hbClose();
        addResize(nR, rType);
        return;
      }

      var cr = t.closest('[data-hb-create]');
      if (cr) {
        var cType = cr.getAttribute('data-hb-create');
        var nC = HB.node;
        hbClose();
        hbCreate(cType, nC);
        return;
      }

      var act = t.closest('[data-hb-act]');
      if (act) {
        var a = act.getAttribute('data-hb-act');
        var node = HB.node;
        if (a === 'toggleedit') {
          hbSetEdit(!HB.editMode);
          return;
        }
        if (a === 'editdone') {
          hbSetEdit(false);
          return;
        }
        if (a === 'editall') {
          HB.editAll = !HB.editAll;
          hbPaint();
          return;
        }
        if (a === 'editundo') {
          hbUndo();
          return;
        }
        if (a === 'editreset') {
          hbUndoPush('Reset');
          S.customKeys = {};
          S.hbGroups = {};
          S.customAddBar = null;
          S.customAddBySig = {};
          S.customToolsBar = {};
          S.customBotBar = null;
          S.customLabels = {};
          S.customColors = {};
          S.customFill = {};
          S.hbKeep = {};
          save();
          hbPaint();
          setStatus('ok', '↺ Hotbox bars restored to defaults');
          return;
        }
        if (a === 'style') {
          hbCycleStyle();
          return;
        }
        if (a === 'seedtoggle') {
          var cur = seedModeOf([node]);
          var next = SEED_MODES[(SEED_MODES.indexOf(cur) + 1) % SEED_MODES.length] || 'fixed';
          actSeedMode([node], next);
          hbPaint();
          return;
        }
        if (a === 'cyclecolor' && node) {
          var curIdx = 0;
          NODE_PALETTE.forEach(function (sw, i) {
            if (sw.color && (node.color === sw.color || node.bgcolor === sw.bgcolor)) curIdx = i;
          });
          var nextSw = NODE_PALETTE[(curIdx + 1) % NODE_PALETTE.length];
          applyNodeColor(node, nextSw);
          hbPaint();
          return;
        }
        if (a === 'collapse' && node) {
          actCollapseNode(node);
          hbClose();
          return;
        }
        if (a === 'delete' && node) {
          actDeleteNode(node);
          hbClose();
          return;
        }
        if (a === 'settings') {
          var exSet = document.getElementById(PANEL_ID + '-settings');
          if (exSet && exSet.parentNode) {
            exSet.parentNode.removeChild(exSet);
          } else {
            openSettingsModal();
          }
          return;
        }
        hbClose();
        if (a === 'rename') actRenameNode(node);
        else if (a === 'label') labelOpen(node);
        else if (a === 'lupa') actAltZ(node);
        else if (a === 'reroute') addReroute(node);
        else if (a === 'set') addSetNode(node);
        else if (a === 'group') actGroup(node);
        else if (a === 'loadcanvas') actLoadInCanvas(node);
        else if (a === 'preview') addPreview(node);
        else if (a === 'bypass') actBypass(node);
        else if (a === 'apibypass') actBypassApi();
        else if (a === 'zoom') actDotZoom(node);
      }
    };

    el.oninput = function (e) {
      var t = e.target;
      if (t && t.hasAttribute('data-hb-wq')) {
        var wl = HB.el && HB.el.querySelector('[data-hb-wlist]');
        if (wl && HB.wMenu) wl.innerHTML = wMenuListHTML(HB.wMenu.rows, t.value);
      } else if (t && t.hasAttribute('data-hb-w')) {
        hbWInput(t);
      } else if (t && t.hasAttribute('data-hb-q')) {
        HB.q = t.value || '';
        hbPaint();
      } else if (t && t.hasAttribute('data-hb-customcolor')) {
        applyNodeColor(HB.node, { name: t.value, color: t.value, bgcolor: t.value });
      } else if (t && t.hasAttribute('data-ps-num') && HB.node) {
        var rawStr = String(t.value || '').trim();
        if (rawStr === '' || rawStr === '-' || rawStr === '.' || rawStr === '-.' || /\.$/.test(rawStr)) return;
        var parsed = Number(rawStr);
        if (!isNaN(parsed)) {
          var wIdx = +t.getAttribute('data-ps-num');
          var info = findNumWidgetInfo(HB.node, wIdx);
          if (info) {
            var v = applyNodeWidgetValue(HB.node, info, parsed);
            if (v < info.sMin) info.sMin = v;
            if (v > info.sMax) info.sMax = v;
            updateSliderRowDOM(t.closest('.shb-ps'), info, v);
          }
        }
      }
    };

    el.addEventListener('keydown', function (e) {
      var t = e.target;
      /* the drawer search, as in ComfyUI's search box: ↑ ↓ pick a result, Enter adds it, Esc clears the search,
         then closes the drawer */
      if (t && t.tagName === 'INPUT' && t.hasAttribute('data-hb-q')) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          hbQMove(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          var pick = (HB.q || HB.qMoved) ? hbQRows()[HB.qi || 0] : null;
          if (pick) pick.click();
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          if (HB.q) { HB.q = ''; hbPaint(); }
          else hbTogglePlus();
        }
        return;
      }
      if (t && t.tagName === 'INPUT' && t.hasAttribute('data-hb-wq')) {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); hbMenuClose(); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          var first = HB.el && HB.el.querySelector('[data-zone="wmenu"] [data-hb-wrow]');
          if (first) first.click();
        }
        return;
      }
      if (t && t.tagName === 'INPUT' && t.hasAttribute('data-hb-w')) {
        e.stopPropagation();
        hbWKey(t, e);
        return;
      }
      if (t && t.hasAttribute && t.hasAttribute('data-ps-num') && HB.node) {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          var parsed = Number(String(t.value || '').trim());
          var wIdx = +t.getAttribute('data-ps-num');
          var info = findNumWidgetInfo(HB.node, wIdx);
          if (info && !isNaN(parsed)) {
            var v = applyNodeWidgetValue(HB.node, info, parsed);
            t.value = formatSliderVal(info, v);
            updateSliderRowDOM(t.closest('.shb-ps'), info, v);
          }
          try { t.blur(); } catch (err) {}
        } else if (e.key === 'Escape') {
          e.preventDefault();
          try { t.blur(); } catch (err) {}
        }
      }
    });
  }

  /* Leaving a widget field commits it; letting go of a widget slider re-seats the hotbox around the node */
  function hbWireWidgetFields(el) {
    el.addEventListener('focusout', function (e) {
      var t = e.target;
      if (t && t.tagName === 'INPUT' && t.type !== 'range' && t.hasAttribute('data-hb-w') && HB.wItems[+t.getAttribute('data-hb-w')]) wCommit(t);
    });
    el.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.type === 'range' && t.hasAttribute('data-hb-w')) hbPlace();
    });
  }

  /* Close Hotbox on any pointerdown outside .shb-zone and settings without blocking canvas/node drags.
     In edit mode the first click outside only leaves edit mode. A press on a node title bar waits for
     pointerup instead, because it may turn into a drag onto the bottom bar to pin that node. */
  listen(document, 'pointerdown', function (e) {
    var t = e.target;
    var inUi = !!(t && t.closest && (t.closest('.shb-zone') || t.closest('.shb-modal-bg')
      || t.closest('#' + PANEL_ID + '-settings') || t.closest('#' + PANEL_ID + '-topbar-btn')));
    NODE_DRAG = null;
    if (!inUi && e.button === 0) {
      var dn = nodeDragCandidate(e);
      if (dn && dn.pos) {
        NODE_DRAG = { node: dn, x0: e.clientX, y0: e.clientY, pos0: [dn.pos[0], dn.pos[1]], active: false, over: false, closeOnUp: !!HB.el };
      }
    }
    if (!HB.el || inUi) return;
    if (HB.editMode) {
      hbSetEdit(false);
      if (NODE_DRAG) NODE_DRAG.closeOnUp = false;
      return;
    }
    if (!NODE_DRAG) hbClose();
  }, true);

  /* ---------------------------------------------------------------------
   * 14b. SAVE AS BUTTON: a copy of the selection becomes one bar button that adds those nodes again
   * Saved buttons (`templates` in the settings) live in the Hotbox file with everything else. The motion
   * comes from the design handoff (Web Animations only): Fluid = gravity merge, Compact = shrinkwrap,
   * Quiet = clean dissolve. LiteGraph draws nodes on a <canvas>, so the animation moves ghosts (a clone of
   * each Vue node, or a snapshot of the canvas under a classic one) while the real nodes step aside, and
   * they come back once the button has landed: saving never removes anything.
   * --------------------------------------------------------------------- */
  var MG_SNAP = 'cubic-bezier(.2,.9,.1,1)';
  var MG_LAV = 'oklch(0.8 0.12 300 / .8)';
  var MG_PRESS = [{ transform: 'scale(1)' }, { transform: 'scale(.9)', offset: 0.35 }, { transform: 'scale(1.06)', offset: 0.7 }, { transform: 'scale(1)' }];
  var MG_WIGGLE = [
    { transform: 'rotate(0) scale(.96)' },
    { transform: 'rotate(-2.2deg) scale(1.02)', offset: 0.3 },
    { transform: 'rotate(1.3deg)', offset: 0.6 },
    { transform: 'rotate(-.55deg)', offset: 0.85 },
    { transform: 'rotate(0) scale(1)' }
  ];
  var MG_BUSY = false;

  function mgTR(p, sx, sy, r) {
    if (sx == null) sx = 1;
    if (sy == null) sy = sx;
    return 'translate(' + p.x + 'px,' + p.y + 'px) translate(-50%,-50%) rotate(' + (r || 0) + 'deg) scale(' + sx + ',' + sy + ')';
  }

  function mgCtr(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

  function mgKit(ctx, opts) {
    var pace = opts.pace == null ? 1 : opts.pace, delay = opts.delay || 0, anims = [], made = [];
    var rr = ctx.root.getBoundingClientRect();
    var sc = (rr.width / (ctx.root.offsetWidth || rr.width)) || 1;
    var K = {};
    K.rel = function (el) {
      var r = el.getBoundingClientRect();
      return { x: (r.left - rr.left) / sc, y: (r.top - rr.top) / sc, w: r.width / sc, h: r.height / sc };
    };
    K.A = function (el, kf, dur, dl, easing, fill) {
      if (!el || !el.animate) return null;
      var a = el.animate(kf, { duration: dur * pace, delay: (delay + (dl || 0)) * pace, easing: easing || 'linear', fill: fill || 'both' });
      anims.push(a);
      return a;
    };
    K.fx = function (css) {
      var el = document.createElement('div');
      el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;opacity:0;' + css;
      ctx.fx.appendChild(el);
      made.push(el);
      return el;
    };
    K.fade = function (el, dur, dl) { return K.A(el, [{ opacity: 1 }, { opacity: 0 }], dur, dl, 'ease-out', 'forwards'); };
    K.burst = function (p, n, dl, rad, up) {
      for (var i = 0; i < n; i++) {
        var a = (up ? Math.PI : 0) + (up ? Math.PI : Math.PI * 2) * (i + 0.5) / n;
        var dx = Math.cos(a) * rad, dy = Math.sin(a) * rad * (up ? 1 : 0.8);
        var el = K.fx('left:' + (p.x - 2) + 'px;top:' + (p.y - 2) + 'px;width:4px;height:4px;border-radius:50%;background:#fff;box-shadow:0 0 6px 2px ' + MG_LAV);
        K.A(el, [
          { transform: 'translate(0,0) scale(1)', opacity: 0 },
          { transform: 'translate(' + dx * 0.4 + 'px,' + dy * 0.4 + 'px) scale(1.2)', opacity: 1, offset: 0.2 },
          { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0)', opacity: 0 }
        ], 440, dl + i * 8, 'cubic-bezier(.2,.8,.3,1)');
      }
    };
    K.handle = function (total) {
      var ms = (delay + total) * pace;
      return {
        duration: ms,
        finished: new Promise(function (res) { setTimeout(res, ms); }),
        cancel: function () {
          anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
          made.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
        }
      };
    };
    return K;
  }

  function mgMeasure(ctx, K) {
    var NR = ctx.nodes.map(K.rel);
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    NR.forEach(function (r) {
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    });
    var sr = K.rel(ctx.slot);
    /* the bottom bar is centered, so it grows both ways: the slot's left edge is the new button's final center */
    return {
      NR: NR,
      G: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
      S: { x: sr.x, y: sr.y + sr.h / 2 },
      sr: sr,
      cw: ctx.chip.offsetWidth + 2,
      fw: ctx.fly.offsetWidth,
      fh: ctx.fly.offsetHeight
    };
  }

  function mgOpenSlot(ctx, K, cw, dl, dur) {
    return K.A(ctx.slot, [{ maxWidth: '0px' }, { maxWidth: cw + 'px' }], dur, dl, MG_SNAP);
  }

  function mgArc(K, el, p0, p1, dur, dl, lift) {
    var c = { x: p0.x + (p1.x - p0.x) * 0.15 - 40 * Math.sign((p1.x - p0.x) || 1), y: Math.min(p0.y, p1.y) - lift };
    var kf = [];
    for (var i = 0; i <= 12; i++) {
      var t = i / 12, k = Math.sin(Math.PI * t);
      var pt = {
        x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x,
        y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y
      };
      kf.push({ transform: mgTR(pt, 1 + 0.06 * k, 1 + 0.06 * k, -4 * k) });
    }
    K.A(el, kf, dur, dl, 'cubic-bezier(.5,0,.2,1)', 'forwards');
  }

  function mgLand(ctx, K, dl) {
    K.A(ctx.fly, [{ opacity: 1 }, { opacity: 0 }], 70, dl, 'linear', 'forwards');
    K.A(ctx.chip, [{ opacity: 0 }, { opacity: 1 }], 70, dl);
    K.A(ctx.chip, MG_WIGGLE, 280, dl + 30, 'ease-out', 'none');
  }

  /* 4b clean (Quiet): the nodes drift toward the center while dissolving, a soft bloom, then the pill swoops into the bar */
  function mgClean(ctx, K, m) {
    var G = m.G;
    K.fade(ctx.selection, 110, 30);
    ctx.nodes.forEach(function (n, i) {
      var c = mgCtr(m.NR[i]), dx = (G.x - c.x) * 0.35, dy = (G.y - c.y) * 0.35;
      K.A(n, [
        { transform: 'none', filter: 'blur(0px) brightness(1)', opacity: 1 },
        { transform: 'scale(1.03)', filter: 'blur(0px) brightness(1.35)', opacity: 1, offset: 0.25 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.9)', filter: 'blur(10px) brightness(1.6)', opacity: 0 }
      ], 240, 40 + i * 30, 'cubic-bezier(.4,0,.7,.2)', 'forwards');
    });
    var bloom = K.fx('left:' + (G.x - 60) + 'px;top:' + (G.y - 60) + 'px;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,rgba(235,230,255,.35) 0%,rgba(200,190,255,.12) 40%,rgba(200,190,255,0) 70%)');
    K.A(bloom, [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: 0.4 }, { transform: 'scale(1.4)', opacity: 0 }], 320, 200, 'ease-out');
    K.A(ctx.fly, [{ transform: mgTR(G, 0.2), opacity: 0 }, { transform: mgTR(G, 1.12), opacity: 1, offset: 0.6 }, { transform: mgTR(G, 1), opacity: 1 }], 200, 260, MG_SNAP);
    K.burst(G, 8, 280, 48);
    mgArc(K, ctx.fly, G, m.S, 300, 470, 60);
    mgOpenSlot(ctx, K, m.cw, 590, 120);
    mgLand(ctx, K, 760);
    return 1000;
  }

  /* 4c shrinkwrap (Compact): the dashed selection box shrinks into the button's footprint */
  function mgShrinkwrap(ctx, K, m) {
    ctx.nodes.forEach(function (n, i) {
      K.A(n, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.97)' }], 160, 40 + i * 25, 'ease-out', 'forwards');
    });
    var s0 = K.rel(ctx.selection);
    K.A(ctx.selection, [
      { left: s0.x + 'px', top: s0.y + 'px', width: s0.w + 'px', height: s0.h + 'px', borderRadius: '16px' },
      { left: (m.S.x - m.cw / 2) + 'px', top: (m.S.y - m.sr.h / 2 + 4) + 'px', width: m.cw + 'px', height: (m.sr.h - 8) + 'px', borderRadius: '17px' }
    ], 320, 140, MG_SNAP);
    mgOpenSlot(ctx, K, m.cw, 300, 120);
    K.A(ctx.chip, [{ opacity: 0 }, { opacity: 1 }], 120, 460);
    K.fade(ctx.selection, 120, 470);
    return 620;
  }

  /* 4d gravity (Fluid, the default): the nodes accelerate into each other and merge into one card with a squash,
     the card morphs into the pill and falls into the bar */
  function mgGravity(ctx, K, m) {
    var G = m.G, S = m.S, f = ctx.fly;
    K.fade(ctx.selection, 110, 30);
    ctx.nodes.forEach(function (n, i) {
      var c = mgCtr(m.NR[i]), dx = G.x - c.x, dy = G.y - c.y;
      K.A(n, [
        { transform: 'none' },
        { transform: 'translate(' + dx * 0.06 + 'px,' + dy * 0.06 + 'px) scale(.97)', offset: 0.35 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.5)' }
      ], 230, 40, 'cubic-bezier(.55,0,1,.45)', 'forwards');
      K.A(n, [{ opacity: 1 }, { opacity: 0 }], 50, 262, 'linear', 'forwards');
    });
    K.A(f, [
      { width: '100px', height: '116px', borderRadius: '12px', backgroundColor: 'rgb(36,36,36)' },
      { width: m.fw + 'px', height: m.fh + 'px', borderRadius: '17px', backgroundColor: 'rgba(48,48,54,.92)' }
    ], 160, 400, MG_SNAP);
    K.A(f, [
      { transform: mgTR(G, 1), opacity: 0 },
      { transform: mgTR(G, 1.16, 0.84), opacity: 1, offset: 0.25 },
      { transform: mgTR(G, 0.95, 1.06), opacity: 1, offset: 0.6 },
      { transform: mgTR(G, 1), opacity: 1 }
    ], 200, 262, 'ease-out');
    K.A(ctx.flyContent, [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], 160, 400);
    var kf = [];
    for (var i = 0; i <= 12; i++) {
      var t = i / 12;
      kf.push({ transform: mgTR({ x: G.x + (S.x - G.x) * (1 - (1 - t) * (1 - t)), y: G.y + (S.y - G.y) * t * t }, 1 - 0.06 * t, 1 + 0.1 * t) });
    }
    K.A(f, kf, 240, 570, 'linear', 'forwards');
    mgOpenSlot(ctx, K, m.cw, 690, 120);
    K.A(f, [{ opacity: 1 }, { opacity: 0 }], 60, 810, 'linear', 'forwards');
    K.A(ctx.chip, [{ opacity: 0 }, { opacity: 1 }], 60, 810);
    K.A(ctx.chip, [{ transform: 'scale(1.12,.84)' }, { transform: 'scale(.96,1.05)', offset: 0.5 }, { transform: 'scale(1)' }], 220, 810, 'ease-out', 'none');
    return 1030;
  }

  function mgPlay(variant, ctx, opts) {
    var K = mgKit(ctx, opts), m = mgMeasure(ctx, K);
    if (ctx.trigger) {
      K.A(ctx.trigger, MG_PRESS, 220, 0, 'ease-out', 'none');
      if (variant === 'clean') {
        var t = mgCtr(K.rel(ctx.trigger));
        K.burst({ x: t.x, y: t.y - 8 }, 5, 20, 26, true);
      }
    }
    var total = variant === 'shrinkwrap' ? mgShrinkwrap(ctx, K, m) : (variant === 'clean' ? mgClean(ctx, K, m) : mgGravity(ctx, K, m));
    return K.handle(total);
  }

  /* A saved button drops its nodes, in the style's own way. Fluid: each node springs out of the button (point `p`)
     to its place, one after another. Compact: they inflate in place like little balloons, faster and faster,
     with a soft bounce. Quiet: they just pop in, all at once. */
  function mgUnpack(ctx, p, variant) {
    var K = mgKit(ctx, { pace: ctx.pace });
    var n = ctx.nodes.length;
    if (variant === 'clean') {
      ctx.nodes.forEach(function (el) {
        K.A(el, [
          { transform: 'scale(.86)', opacity: 0 },
          { transform: 'scale(1.03)', opacity: 1, offset: 0.6 },
          { transform: 'scale(1)', opacity: 1 }
        ], 150, 0, 'ease-out');
      });
      return K.handle(170);
    }
    if (variant === 'shrinkwrap') {
      /* the gaps between balloons shrink as they go, so the cadence speeds up */
      var spread = Math.min(240, 45 * (n - 1));
      ctx.nodes.forEach(function (el, i) {
        el.style.transformOrigin = '50% 100%';
        K.A(el, [
          { transform: 'translateY(14px) scale(.2)', opacity: 0, borderRadius: '50%' },
          { transform: 'translateY(-4px) scale(1.06)', opacity: 1, borderRadius: '14px', offset: 0.55 },
          { transform: 'translateY(1px) scale(.98)', offset: 0.8 },
          { transform: 'none', opacity: 1, borderRadius: '8px' }
        ], 260, n > 1 ? spread * Math.sqrt(i / (n - 1)) : 0, 'cubic-bezier(.3,1.2,.5,1)');
      });
      return K.handle(spread + 280);
    }
    var D = 225, ST = 30;
    ctx.nodes.forEach(function (el, i) {
      var c = mgCtr(K.rel(el));
      K.A(el, [
        { transform: 'translate(' + (p.x - c.x) + 'px,' + (p.y - c.y) + 'px) scale(.12)', opacity: 0 },
        { transform: 'translate(0px,0px) scale(1)', opacity: 1 }
      ], D, i * ST, 'cubic-bezier(.34,1.3,.64,1)');
    });
    return K.handle(D + 40 + Math.max(0, n - 1) * ST);
  }

  /* Fluid = gravity (4d), Compact = shrinkwrap (4c), Quiet = clean (4b). Like the rest of the hotbox motion it
     plays even with the OS "reduce motion" switch on, so each style always shows its own animation. */
  function mgVariant() {
    var t = hbTheme();
    return { v: t === 'classic' ? 'shrinkwrap' : (t === 'quiet' ? 'clean' : 'gravity'), pace: 1 };
  }

  function mgOverlay() {
    var root = owns(document.createElement('div'));
    root.className = 'shb-magic ' + hbThemeCls();
    root.innerHTML = '<div class="shb-mg-fx"></div>';
    document.body.appendChild(root);
    return root;
  }

  function isGraphNode(it) {
    return !!(it && typeof it.connect === 'function' && it.pos);
  }

  function tplById(id) {
    var list = Array.isArray(S.templates) ? S.templates : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    /* a shared library's button: '<library key>:<id>' */
    if (String(id).indexOf(':') > 0) {
      var sh = libSharedButtons();
      for (var j = 0; j < sh.length; j++) if (sh[j].id === id) return sh[j];
    }
    return null;
  }

  /* ---------------------------------------------------------------------
   * SHARED LIBRARIES: other folders of saved buttons (a studio's shared drive, one per show), added in Settings or
   * by a script (window.__hotbox.addLibrary, or POST /hotbox/libraries). Their buttons sit beside your own, grouped
   * by library, with the uid 'tpl:<library key>:<id>'; they are read again each time the hotbox opens
   * --------------------------------------------------------------------- */
  var LIB = { list: [], at: 0, busy: null };

  function libKey(path) {
    var h = 5381, t = String(path || '').replace(/\\/g, '/').toLowerCase();
    for (var i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
    return 'L' + h.toString(36);
  }

  function libRefresh(force) {
    if (LIB.busy) return LIB.busy;
    if (!force && Date.now() - LIB.at < 4000) return Promise.resolve(LIB.list);
    LIB.busy = apiFetch('/hotbox/libraries?buttons=1')
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && Array.isArray(j.libraries)) {
          LIB.list = j.libraries.map(function (l) {
            var key = libKey(l.path), writable = !l.readOnly && !l.env && l.exists;
            l.key = key;
            l.buttons = (l.buttons || []).map(function (b) {
              return { id: key + ':' + b.id, rawId: b.id, name: b.name, count: b.count, at: b.at, data: b.data,
                lib: key, libLabel: l.label, canDelete: !!(writable && b.file) };
            });
            return l;
          });
          LIB.at = Date.now();
          if (HB_LIB_FIX) {
            HB_LIB_FIX = false;
            hbLibFix();
          }
        }
        return LIB.list;
      })
      .catch(function () { return LIB.list; })
      .then(function (l) { LIB.busy = null; return l; });
    return LIB.busy;
  }

  /* the second half of mending an emptied bottom bar: the buttons of the library you save into come back to it,
     unless they sit in a bar or a group already */
  function hbLibFix() {
    var tl = libSaveTarget();
    if (!tl || !Array.isArray(S.customBotBar)) return;
    var there = {};
    S.customBotBar.forEach(function (u) { there[u] = 1; });
    [S.customAddBySig, S.customToolsBar].forEach(function (m) {
      Object.keys(m && typeof m === 'object' ? m : {}).forEach(function (k) {
        (Array.isArray(m[k]) ? m[k] : []).forEach(function (u) { there[u] = 1; });
      });
    });
    Object.keys(S.hbGroups && typeof S.hbGroups === 'object' ? S.hbGroups : {}).forEach(function (g) {
      ((S.hbGroups[g] || {}).items || []).forEach(function (u) { there[u] = 1; });
    });
    var back = (tl.buttons || []).map(function (b) { return 'tpl:' + b.id; }).filter(function (u) { return !there[u]; });
    if (!back.length) return;
    S.customBotBar = S.customBotBar.concat(back);
    save();
  }

  function libByKey(key) {
    for (var i = 0; i < LIB.list.length; i++) if (LIB.list[i].key === key) return LIB.list[i];
    return null;
  }

  function libByPath(path) {
    return libByKey(libKey(path));
  }

  function libSharedButtons() {
    var out = [];
    LIB.list.forEach(function (l) { out = out.concat(l.buttons || []); });
    return out;
  }

  function libWritable(l) {
    return !!(l && !l.readOnly && !l.env && l.exists);
  }

  /* the library Save as Button saves into, while it is there and writable */
  function libSaveTarget() {
    var l = S.saveLib ? libByPath(S.saveLib) : null;
    return libWritable(l) ? l : null;
  }

  /* add / remove / update ({ add: [{ path, label, readOnly }], remove: [path], update: [...] }), then read them again */
  function libSet(body) {
    return apiFetch('/hotbox/libraries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (j) {
        if (!j) setStatus('error', 'Could not change the shared libraries');
        else if (j.errors && j.errors.length) setStatus('error', j.errors[0]);
        return libRefresh(true);
      });
  }

  function libButtonUrl(l, rawId) {
    return '/hotbox/library/button?path=' + encodeURIComponent(l.path) + '&id=' + encodeURIComponent(rawId);
  }

  function libWriteButton(l, tpl) {
    var body = JSON.stringify({ id: tpl.id, name: tpl.name, count: tpl.count, at: tpl.at, data: tpl.data });
    return apiFetch(libButtonUrl(l, tpl.id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body })
      .then(function (r) { return !!(r && r.ok); })
      .catch(function () { return false; });
  }

  function libDeleteButton(l, rawId) {
    return apiFetch(libButtonUrl(l, rawId), { method: 'DELETE' })
      .then(function (r) { return !!(r && r.ok); })
      .catch(function () { return false; });
  }

  function clientToGraph(x, y) {
    var c = getCanvas();
    var el = c && c.canvas, ds = c && c.ds;
    if (!el || !ds) return pasteAnchor(c);
    var r = el.getBoundingClientRect(), sc = ds.scale || 1;
    return [Math.round((x - r.left) / sc - ds.offset[0]), Math.round((y - r.top) / sc - ds.offset[1])];
  }

  function graphToClient(gx, gy) {
    var c = getCanvas();
    var el = c && c.canvas, ds = c && c.ds;
    if (!el || !ds) return { x: gx, y: gy, s: 1 };
    var r = el.getBoundingClientRect(), sc = ds.scale || 1;
    return { x: r.left + (gx + ds.offset[0]) * sc, y: r.top + (gy + ds.offset[1]) * sc, s: sc };
  }

  /* What Save as Button takes: the selection (a selected group brings what is inside it), else the node under the hotbox */
  function mgItems(node) {
    var c = getCanvas(), out = [];
    function add(it) { if (it && out.indexOf(it) < 0) out.push(it); }
    if (c && c.selectedItems && c.selectedItems.size) {
      c.selectedItems.forEach(function (it) {
        add(it);
        if (it && !isGraphNode(it) && it.children && typeof it.recomputeInsideNodes === 'function') {
          try { it.recomputeInsideNodes(); } catch (e) {}
          it.children.forEach(add);
        }
      });
    }
    if (!out.length) selNodes().forEach(add);
    if (!out.length && node) add(node);
    return out;
  }

  /* Nodes, inner wires, groups and subgraphs as plain JSON (the same format ComfyUI's own copy uses) */
  function mgSerialize(items) {
    var c = getCanvas();
    if (c && typeof c._serializeItems === 'function') return JSON.parse(JSON.stringify(c._serializeItems(items)));
    /* older frontends: borrow the clipboard, then put the user's own back */
    var KEY = 'litegrapheditor_clipboard', prev = null;
    try { prev = localStorage.getItem(KEY); } catch (e) {}
    try {
      c.copyToClipboard(items.filter(isGraphNode));
      return JSON.parse(localStorage.getItem(KEY));
    } finally {
      try { if (prev == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, prev); } catch (e) {}
    }
  }

  function mgPaste(data, pos) {
    var c = getCanvas();
    var copy = JSON.parse(JSON.stringify(data));
    if (c && typeof c._deserializeItems === 'function') {
      var res = c._deserializeItems(copy, { position: pos });
      var made = ((res && res.created) || []).filter(isGraphNode);
      mgRelink(data, made);
      return made;
    }
    var KEY = 'litegrapheditor_clipboard', prev = null;
    try { prev = localStorage.getItem(KEY); } catch (e) {}
    try {
      localStorage.setItem(KEY, JSON.stringify(copy));
      if (c.graph_mouse) { c.graph_mouse[0] = pos[0]; c.graph_mouse[1] = pos[1]; }
      c.pasteFromClipboard();
      return selNodes();
    } finally {
      try { if (prev == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, prev); } catch (e) {}
    }
  }

  /* A paste can miss links into inputs a node only grows once it is set up (the image slots of the newer API
     nodes, which appear a moment after the paste): every saved link whose input is still empty is made again,
     finding the input by its name, retried until that input exists */
  function mgRelink(data, made, tries) {
    var saved = (data && data.nodes) || [];
    if (made.length !== saved.length) return;
    /* the paste does not keep the saved order: each saved node pairs with the next pasted one of its type */
    var byId = {}, used = [], waiting = 0;
    for (var i = 0; i < saved.length; i++) {
      var m = null;
      for (var k = 0; k < made.length && !m; k++) {
        if (used.indexOf(k) < 0 && String(made[k].type) === String(saved[i].type)) { m = made[k]; used.push(k); }
      }
      if (!m) return;
      byId[saved[i].id] = { saved: saved[i], node: m };
    }
    var taken = {};
    (data.links || []).forEach(function (l) {
      var o = Array.isArray(l) ? { origin_id: l[1], origin_slot: l[2], target_id: l[3], target_slot: l[4], type: l[5] } : l;
      var a = byId[o.origin_id], b = byId[o.target_id];
      if (!a || !b) return;
      /* the saved inputs can be listed in another order than the one the link's slot number counted (dynamic
         inputs move), so a slot whose type does not take the wire gives way to the first free input that does */
      var sIns = b.saved.inputs || [], cand = sIns[o.target_slot];
      if (!cand || (o.type && !typeFits(o.type, cand.type))) {
        cand = null;
        for (var q = 0; q < sIns.length && !cand; q++) {
          if (sIns[q] && !sIns[q].widget && typeFits(o.type, sIns[q].type) && !taken[o.target_id + ':' + sIns[q].name]) cand = sIns[q];
        }
      }
      if (!cand) return;
      taken[o.target_id + ':' + cand.name] = 1;
      var name = cand.name;
      var ins = b.node.inputs || [], slot = -1;
      for (var j = 0; j < ins.length; j++) if (ins[j] && ins[j].name === name) { slot = j; break; }
      if (slot < 0) { waiting++; return; }
      if (ins[slot].link != null) return;
      try { a.node.connect(o.origin_slot, b.node, slot); } catch (e) {}
    });
    tries = tries || 0;
    if (waiting && tries < 10) setTimeout(function () { mgRelink(data, made, tries + 1); }, 120);
  }

  /* ---------------------------------------------------------------------
   * REPLICATE: the selection (a group and its label, a whole branch) copied as many times as you ask, stacked
   * under it or beside it. Each copy moves on one letter, A → B, C, D…, in its group titles, labels, Set / Get
   * names and file names (Save Video, Save EXR, OCIO Read / Write, a "Crop_A_v" text…), a file picked from a
   * list moves on when that file is there (jacket_A.png → jacket_B.png), and the wires coming in from outside
   * stay plugged into the same nodes.
   * --------------------------------------------------------------------- */
  var REP_GROUP_HUES = ['#b8912f', '#b86a2f', '#a83a32', '#a8326e', '#8a32a8', '#5e3ab0', '#3260a8', '#2f8a8a', '#3a8a3f', '#8a8a2f'];
  var REP_LABEL_HUES = ['#f5b400', '#ff7a00', '#e01b1b', '#d6186b', '#b100f5', '#6a1bf5', '#2d6cf5', '#14a3a3', '#2fa84f', '#a8a814'];

  /* A letter standing on its own between separators: Group_A, crop A, shot_a.exr, A01. Never one inside a code
     (the a of 4b7d-a13c) or the one that starts a sentence ("A woman…") */
  function repLetterRe(L) {
    var u = L.toUpperCase(), l = L.toLowerCase();
    return new RegExp('(^|[^A-Za-z0-9])([' + u + l + '])(?=\\d*(?:[^A-Za-z0-9]|$))(?!\\d* [A-Za-z])', 'g');
  }

  function repHasLetter(s, L) { return !!L && repLetterRe(L).test(String(s || '')); }

  function repSwapLetter(s, from, to) {
    return String(s).replace(repLetterRe(from), function (m, pre, ch) {
      return pre + (ch === ch.toUpperCase() ? to.toUpperCase() : to.toLowerCase());
    });
  }

  /* The last number standing on its own (IMAGE_1, take 02, plate_1.exr), never a version's (v001), a decimal (4.0)
     or one inside a code (4b7d) */
  function repNumAt(s) {
    var re = /(^|[^A-Za-z0-9.])(\d{1,4})(?=[^A-Za-z0-9]|$)(?!\.\d)/g, m, last = null;
    s = String(s || '');
    while ((m = re.exec(s))) last = { at: m.index + m[1].length, txt: m[2] };
    return last;
  }

  function repBump(s, k) {
    s = String(s);
    var t = repNumAt(s);
    if (!t) return s;
    var v = String(parseInt(t.txt, 10) + k);
    while (v.length < t.txt.length) v = '0' + v;
    return s.slice(0, t.at) + v + s.slice(t.at + t.txt.length);
  }

  /* a prompt rather than a name: long, or several words */
  function repProse(s) {
    s = String(s || '');
    return s.length > 60 || (s.match(/\s/g) || []).length >= 4;
  }

  function repIsGroup(it) {
    var LG = litegraph();
    if (LG && LG.LGraphGroup && it instanceof LG.LGraphGroup) return true;
    return !!(it && !isGraphNode(it) && typeof it.title === 'string' && typeof it.recomputeInsideNodes === 'function');
  }

  /* Every name in the selection a copy could move on */
  function repSpots(items) {
    var spots = [], setsInside = {};
    items.forEach(function (it) { if (isGraphNode(it) && isSetNode(it)) setsInside[setGetName(it)] = 1; });
    items.forEach(function (it) {
      if (repIsGroup(it)) {
        if (it.title) spots.push({ kind: 'group', src: it, text: String(it.title), where: 'Group' });
        return;
      }
      if (!isGraphNode(it)) return;
      var nm = String(it.title || it.type || '');
      if (isSetNode(it) || isGetNode(it)) {
        var v = setGetName(it);
        /* a Get of a Set that is copied too follows that Set */
        if (v && !(isGetNode(it) && setsInside[v])) spots.push({ kind: isSetNode(it) ? 'set' : 'get', src: it, text: v, where: isSetNode(it) ? 'Set' : 'Get' });
        return;
      }
      if (it.title) spots.push({ kind: 'title', src: it, text: String(it.title), where: labelIsRg(it) ? 'Label' : 'Title' });
      (it.widgets || []).forEach(function (w, wi) {
        if (!w || typeof w.value !== 'string' || !w.value || /^(button|toggle)$/.test(String(w.type))) return;
        var combo = String(w.type) === 'combo';
        /* from a list, only a file name can move on, and only to a file that is there */
        if (combo && !/\.[a-z0-9]{2,5}$/i.test(w.value)) return;
        spots.push({ kind: combo ? 'combo' : 'widget', src: it, wi: wi, text: w.value, where: nm + ' · ' + String(w.label || w.name || '') });
      });
    });
    return spots;
  }

  /* The letter the names carry now: the one in the group titles first, else the most common one */
  function repGuessLetter(spots) {
    var score = {}, best = '', bs = 0;
    spots.forEach(function (sp) {
      if (repProse(sp.text)) return;
      var re = /(^|[^A-Za-z0-9])([A-Z])(?=\d*(?:[^A-Za-z0-9]|$))(?!\d* [A-Za-z])/g, m;
      while ((m = re.exec(sp.text))) score[m[2]] = (score[m[2]] || 0) + (sp.kind === 'group' ? 10 : 1);
    });
    Object.keys(score).sort().forEach(function (k) { if (score[k] > bs) { best = k; bs = score[k]; } });
    return best;
  }

  /* What can move on in each copy: a letter is on unless it sits in a prompt; a number is offered off, except on
     a Set with no letter (a copied Set needs a name of its own) */
  function repRows(spots, L) {
    var rows = [];
    spots.forEach(function (sp, i) {
      var hasL = repHasLetter(sp.text, L), num = repNumAt(sp.text), prose = repProse(sp.text);
      if (hasL) rows.push({ id: i + ':L', spot: i, mode: 'L', on: !prose });
      if (num && !prose) rows.push({ id: i + ':N', spot: i, mode: 'N', on: !hasL && sp.kind === 'set' });
    });
    return rows;
  }

  function repMove(text, letterOn, numOn, L, k) {
    var t = String(text);
    if (letterOn) t = repSwapLetter(t, L, String.fromCharCode(L.charCodeAt(0) + k));
    if (numOn) t = repBump(t, k);
    return t;
  }

  /* The block's box in graph units: its nodes (title bars included) and its groups */
  function repBox(items) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    items.forEach(function (it) {
      var b = null;
      if (repIsGroup(it)) {
        var p = it.pos || [0, 0], s = it.size || [0, 0];
        b = { x: +p[0], y: +p[1], w: +s[0], h: +s[1] };
      } else if (isGraphNode(it)) b = hbTitledBox(it);
      if (!b) return;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    });
    return x0 === 1e9 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function repRun(items, spots, on, L, count, dir, colors) {
    var c = getCanvas(), g = getGraph();
    var nodes = items.filter(isGraphNode), groups = items.filter(repIsGroup);
    var box = repBox(items);
    if (!c || !g || !box || !nodes.length) return;
    /* each node carries a mark through the copy, so its copies are found again however the paste orders them */
    nodes.forEach(function (n) { n.properties = n.properties || {}; n.properties.__hbRep = String(n.id); });
    var data;
    try { data = mgSerialize(items); } finally {
      nodes.forEach(function (n) { try { delete n.properties.__hbRep; } catch (e) {} });
    }
    var ids = {}, outer = [];
    nodes.forEach(function (n) { ids[n.id] = 1; });
    nodes.forEach(function (n) {
      (n.inputs || []).forEach(function (inp) {
        var l = inp && inp.link != null ? linkById(g, inp.link) : null;
        if (!l || ids[l.origin_id]) return;
        var from = g.getNodeById ? g.getNodeById(l.origin_id) : null;
        if (from) outer.push({ src: String(n.id), input: inp.name, from: from, slot: l.origin_slot });
      });
    });
    /* the paste puts the block's top-left corner (nodes and groups) on the position it is given */
    var ox = 1e9, oy = 1e9;
    (data.nodes || []).forEach(function (n) { if (n.pos) { ox = Math.min(ox, +n.pos[0] || 0); oy = Math.min(oy, +n.pos[1] || 0); } });
    (data.groups || []).forEach(function (gr) { var b = gr.bounding; if (b) { ox = Math.min(ox, b[0]); oy = Math.min(oy, b[1]); } });
    var GAP = 60, right = dir === 'right';
    var step = right ? [box.w + GAP, 0] : [0, box.h + GAP];
    var all = right ? { x: box.x + box.w + GAP, y: box.y, w: count * (box.w + GAP) - GAP, h: box.h }
      : { x: box.x, y: box.y + box.h + GAP, w: box.w, h: count * (box.h + GAP) - GAP };
    /* the copies never land on other nodes: the whole stack slides on until it is clear */
    var extra = hbFreeShift(g, all, nodes, right ? 0 : 1);
    var t0 = Date.now(), plugs = [], made = [], missing = [], letters = [];
    try { if (c.emitBeforeChange) c.emitBeforeChange(); } catch (e) {}
    try { if (g.beforeChange) g.beforeChange(); } catch (e) {}
    for (var k = 1; k <= count; k++) {
      var to = String.fromCharCode(L.charCodeAt(0) + k);
      letters.push(to);
      var dx = step[0] * k + (right ? extra : 0), dy = step[1] * k + (right ? 0 : extra);
      var res = null;
      try { res = c._deserializeItems(JSON.parse(JSON.stringify(data)), { position: [ox + dx, oy + dy] }); } catch (e) {
        setStatus('error', 'Replicate: copy ' + to + ' failed: ' + msgOf(e));
        break;
      }
      var created = (res && res.created) || [];
      var cn = created.filter(isGraphNode), cg = created.filter(repIsGroup);
      var byOld = {};
      cn.forEach(function (n) {
        var p = n.properties || {};
        if (p.__hbRep != null) { byOld[p.__hbRep] = n; delete p.__hbRep; }
      });
      mgRelink(data, cn);
      /* groups come back in the order they were copied; the title confirms the pair */
      var gOf = function (src) {
        var i = groups.indexOf(src), cand = cg[i];
        if (cand && cand.title === src.title) return cand;
        for (var j = 0; j < cg.length; j++) if (cg[j].title === src.title) return cg[j];
        return null;
      };
      var setMap = {}, known = setNames();
      /* Sets first, so the Gets copied with them can follow */
      var order = spots.map(function (sp, i) { return i; }).sort(function (a, b) {
        return (spots[a].kind === 'set' ? 0 : 1) - (spots[b].kind === 'set' ? 0 : 1);
      });
      order.forEach(function (i) {
        var sp = spots[i], lOn = !!on[i + ':L'], nOn = !!on[i + ':N'];
        if (!lOn && !nOn) return;
        var nt = repMove(sp.text, lOn, nOn, L, k);
        if (nt === sp.text) return;
        if (sp.kind === 'group') { var cgp = gOf(sp.src); if (cgp) cgp.title = nt; return; }
        var cnode = byOld[String(sp.src.id)];
        if (!cnode) return;
        if (sp.kind === 'set') {
          setNameOn(cnode, nt);
          setMap[sp.text] = setGetName(cnode);
          known.push(setGetName(cnode));
        } else if (sp.kind === 'get') {
          if (known.indexOf(nt) >= 0) setNameOn(cnode, nt);
          else if (missing.indexOf(nt) < 0) missing.push(nt);
        } else if (sp.kind === 'title') {
          cnode.title = nt;
        } else {
          var w = cnode.widgets && cnode.widgets[sp.wi];
          if (!w) return;
          if (sp.kind === 'combo') {
            var vals = w.options && w.options.values;
            try { if (typeof vals === 'function') vals = vals(w, cnode); } catch (e) { vals = null; }
            if (!Array.isArray(vals) || vals.indexOf(nt) < 0) return;
          }
          w.value = nt;
          try { if (w.callback) w.callback(nt, c, cnode); } catch (e) {}
        }
      });
      cn.forEach(function (n) {
        if (isGetNode(n) && setMap[setGetName(n)]) setNameOn(n, setMap[setGetName(n)]);
      });
      if (colors) {
        var hue = (to.charCodeAt(0) - 65) % REP_GROUP_HUES.length;
        cg.forEach(function (gr) { gr.color = REP_GROUP_HUES[hue]; });
        cn.forEach(function (n) { if (labelIsRg(n)) { n.properties = n.properties || {}; n.properties.backgroundColor = REP_LABEL_HUES[hue]; } });
      }
      outer.forEach(function (o) { if (byOld[o.src]) plugs.push({ node: byOld[o.src], input: o.input, from: o.from, slot: o.slot }); });
      made = made.concat(cn);
    }
    try { g.setDirtyCanvas(true, true); } catch (e) {}
    var first = letters[0], last = letters[letters.length - 1];
    setStatus(made.length ? 'ok' : 'error', made.length
      ? '⧉ Replicated ' + L + ' → ' + (first === last ? first : first + '…' + last) + ' (' + letters.length + (letters.length === 1 ? ' copy, ' : ' copies, ') + made.length + ' nodes)' +
        (missing.length ? ' · no Set named ' + missing.join(', ') + ': those Gets kept their name' : '')
      : 'Replicate: nothing was copied');
    /* wires from outside go into the same inputs; an input a node grows after the paste gets a few tries, and the
       whole thing is one step for Ctrl+Z once the late wires are in */
    (function plug(tries) {
      var left = [];
      plugs.forEach(function (p) {
        var ins = p.node.inputs || [], idx = -1;
        for (var i = 0; i < ins.length; i++) if (ins[i] && ins[i].name === p.input) { idx = i; break; }
        if (idx < 0) { left.push(p); return; }
        if (ins[idx].link == null) { try { p.from.connect(p.slot, p.node, idx); } catch (e) {} }
      });
      plugs = left;
      if (plugs.length && tries < 12) { setTimeout(function () { plug(tries + 1); }, 120); return; }
      setTimeout(function () {
        try { if (g.afterChange) g.afterChange(); } catch (e) {}
        try { if (c.emitAfterChange) c.emitAfterChange(); } catch (e) {}
        try { g.setDirtyCanvas(true, true); } catch (e) {}
      }, Math.max(0, 1300 - (Date.now() - t0)));
    })(0);
  }

  /* The Replicate dialog: how many copies, the letter the names carry now, below or to the right, a color per
     copy, and every name that moves on (each one can be switched off) */
  function actReplicate(node) {
    var c = getCanvas();
    var items = mgItems(node);
    if (!items.filter(isGraphNode).length) {
      setStatus('error', 'Replicate: select the nodes or the group to copy first');
      return;
    }
    if (!c || typeof c._deserializeItems !== 'function') {
      setStatus('error', 'Replicate needs a newer ComfyUI frontend');
      return;
    }
    var spots = repSpots(items);
    var st = { L: repGuessLetter(spots) || 'A', n: +S.repN || 3, dir: S.repDir === 'right' ? 'right' : 'down', colors: S.repColors !== false, off: {} };
    var nN = items.filter(isGraphNode).length, nG = items.filter(repIsGroup).length;
    var bg = owns(document.createElement('div'));
    bg.className = 'shb-modal-bg';
    document.body.appendChild(bg);

    function maxN() { return Math.max(0, 90 - st.L.charCodeAt(0)); }
    function rowsNow() {
      return repRows(spots, st.L).map(function (r) {
        if (st.off[r.id] != null) r.on = !st.off[r.id];
        return r;
      });
    }
    function cut(s) { s = String(s); return s.length > 44 ? s.slice(0, 43) + '…' : s; }
    function paint() {
      st.n = Math.max(maxN() ? 1 : 0, Math.min(st.n, maxN()));
      var rows = rowsNow(), chips = '';
      for (var k = 1; k <= st.n; k++) {
        var ch = String.fromCharCode(st.L.charCodeAt(0) + k);
        var hue = st.colors ? REP_LABEL_HUES[(ch.charCodeAt(0) - 65) % REP_LABEL_HUES.length] : '#4a4a4a';
        chips += '<span class="shb-rep-chip" style="background:' + hue + '">' + ch + '</span>';
      }
      var list = rows.map(function (r) {
        var sp = spots[r.spot];
        var a = repMove(sp.text, r.mode === 'L', r.mode === 'N', st.L, 1);
        var z = st.n > 1 ? repMove(sp.text, r.mode === 'L', r.mode === 'N', st.L, st.n) : '';
        return '<label class="shb-rep-row" data-tip="' + esc(sp.where + ': ' + sp.text) + '">' +
          '<input type="checkbox" data-rep-row="' + esc(r.id) + '"' + (r.on ? ' checked' : '') + '>' +
          '<span class="shb-rep-w">' + esc(sp.where) + (r.mode === 'N' ? ' · #' : '') + '</span>' +
          '<span class="shb-rep-ft">' + esc(cut(sp.text)) + ' → <b>' + esc(cut(a)) + '</b>' + (z ? ' … <b>' + esc(cut(z)) + '</b>' : '') + '</span>' +
        '</label>';
      }).join('');
      bg.innerHTML =
        '<div class="shb-modal shb-rep" style="width:min(560px,94vw)">' +
          '<div class="shb-modal-t"><span>' + ico('copy', 15) + ' Replicate</span>' +
            '<span class="shb-rep-note">' + nN + (nN === 1 ? ' node' : ' nodes') + (nG ? ' · ' + nG + (nG === 1 ? ' group' : ' groups') : '') + '</span></div>' +
          '<div class="shb-rep-line">' +
            '<span class="shb-rep-k">Copies</span>' +
            '<span class="shb-rep-n"><button type="button" data-rep-n="-1">−</button>' +
              '<input data-rep-count value="' + st.n + '" inputmode="numeric">' +
              '<button type="button" data-rep-n="1">+</button></span>' +
            '<span class="shb-rep-chips">' + (chips || '<span class="shb-rep-note">Z is the last letter</span>') + '</span>' +
          '</div>' +
          '<div class="shb-rep-line">' +
            '<span class="shb-rep-k">Letter</span>' +
            '<input class="shb-input shb-rep-L" data-rep-letter maxlength="1" value="' + esc(st.L) + '" data-tip="The letter the names carry now; each copy moves it on one (A → B, C, D…)">' +
            '<span class="shb-rep-k" style="width:auto;margin-left:10px">Place</span>' +
            '<button type="button" class="shb-btn' + (st.dir === 'down' ? ' shb-btn-on' : '') + '" data-rep-dir="down">↓ Below</button>' +
            '<button type="button" class="shb-btn' + (st.dir === 'right' ? ' shb-btn-on' : '') + '" data-rep-dir="right">→ Right</button>' +
            '<label class="shb-rep-col" data-tip="Each copy\'s groups and labels take the color of its letter"><input type="checkbox" data-rep-colors' + (st.colors ? ' checked' : '') + '> A color per copy</label>' +
          '</div>' +
          (list
            ? '<div class="shb-rep-hd">Moves on in each copy</div><div class="shb-rep-list">' + list + '</div>'
            : '<div class="shb-rep-note">No "' + esc(st.L) + '" on its own in these names (Group_' + esc(st.L) + ', Crop_' + esc(st.L) + '_v…), so the copies keep the same names. Type the letter they carry, or add one first.</div>') +
          '<div class="shb-rep-note">Wires coming in from outside stay plugged into the same nodes.</div>' +
          '<div style="display:flex;justify-content:flex-end;gap:8px">' +
            '<button type="button" class="shb-btn" data-rep-cancel>Cancel</button>' +
            '<button type="button" class="shb-btn shb-btn-pri" data-rep-ok' + (st.n ? '' : ' disabled') + '>Replicate ×' + st.n + '</button>' +
          '</div>' +
        '</div>';
    }
    function close() { if (bg.parentNode) bg.parentNode.removeChild(bg); }
    function go() {
      if (!st.n) return;
      var on = {};
      rowsNow().forEach(function (r) { if (r.on) on[r.id] = 1; });
      S.repN = st.n; S.repDir = st.dir; S.repColors = st.colors;
      save();
      close();
      repRun(items, spots, on, st.L, st.n, st.dir, st.colors);
    }
    bg.addEventListener('mousedown', function (ev) { if (ev.target === bg) close(); });
    bg.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('button,input') : null;
      if (!t) return;
      if (t.hasAttribute('data-rep-cancel')) close();
      else if (t.hasAttribute('data-rep-ok')) go();
      else if (t.hasAttribute('data-rep-n')) { st.n += +t.getAttribute('data-rep-n'); paint(); }
      else if (t.hasAttribute('data-rep-dir')) { st.dir = t.getAttribute('data-rep-dir'); paint(); }
    });
    bg.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.hasAttribute('data-rep-row')) st.off[t.getAttribute('data-rep-row')] = !t.checked;
      else if (t.hasAttribute('data-rep-colors')) { st.colors = t.checked; paint(); }
      else if (t.hasAttribute('data-rep-count')) { st.n = parseInt(t.value, 10) || 1; paint(); }
    });
    bg.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t.hasAttribute('data-rep-letter')) return;
      var v = String(t.value || '').toUpperCase().replace(/[^A-Z]/g, '');
      if (!v) return;
      st.L = v; st.off = {};
      paint();
      var f = bg.querySelector('[data-rep-letter]');
      if (f) { f.focus(); f.select(); }
    });
    bg.addEventListener('keydown', function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
      else if (ev.key === 'Enter') {
        ev.preventDefault();
        var t = ev.target;
        if (t && t.hasAttribute && t.hasAttribute('data-rep-count')) { st.n = parseInt(t.value, 10) || 1; paint(); }
        go();
      }
    });
    paint();
    var okb = bg.querySelector('[data-rep-ok]');
    try { if (okb) okb.focus(); } catch (e) {}
  }

  /* Model families, read from the model file a loader holds (or from the node types) */
  var MG_FAMILIES = [
    [/kontext/i, 'Flux Kontext'], [/flux/i, 'Flux'], [/qwen/i, 'Qwen'], [/hidream/i, 'HiDream'], [/chroma/i, 'Chroma'],
    [/wan[_\-. ]?2|\bwan/i, 'Wan'], [/ltx/i, 'LTX'], [/hunyuan/i, 'Hunyuan'], [/cosmos/i, 'Cosmos'], [/mochi/i, 'Mochi'],
    [/lumina/i, 'Lumina'], [/sd3|sd_3/i, 'SD3'], [/sdxl|sd_xl|xl_base|pony|illustrious|noobai/i, 'SDXL'],
    [/sd15|sd_15|v1-5|sd1\.5/i, 'SD 1.5']
  ];
  var MG_MODEL_FILE = /\.(safetensors|ckpt|gguf|sft|pt|pth|bin)$/i;

  function mgFamilyOf(text) {
    for (var i = 0; i < MG_FAMILIES.length; i++) {
      if (MG_FAMILIES[i][0].test(text)) return MG_FAMILIES[i][1];
    }
    return '';
  }

  /* "Flux" from flux1-dev.safetensors; an unknown file gives its first word ("Anima" from animaOfficial_v3) */
  function mgFamily(nodes, types) {
    var file = '';
    nodes.forEach(function (n) {
      var t = nodeTypeOf(n);
      if (file || !/checkpoint|unet|diffusion|gguf|modelloader/i.test(t) || /upscale/i.test(t)) return;
      (n.widgets || []).forEach(function (w) {
        if (!file && typeof w.value === 'string' && MG_MODEL_FILE.test(w.value)) file = w.value;
      });
    });
    if (file) {
      var base = file.split(/[\\/]/).pop().replace(MG_MODEL_FILE, '');
      var fam = mgFamilyOf(base);
      if (fam) return fam;
      var word = base.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_\-.]+/)[0] || '';
      if (/^[a-z]{3,}$/i.test(word) && !/^(model|models|diffusion|unet|checkpoint|ckpt|base|final|v\d+)$/i.test(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
    }
    return mgFamilyOf(types.join(' '));
  }

  /* What a set of nodes does together, from their types: "Text to Image", "Image to Video", "Upscale"... */
  function mgJob(types, nodes) {
    function has(re) { return types.some(function (t) { return re.test(t); }); }
    function count(re) { return types.filter(function (t) { return re.test(t); }).length; }
    var samplers = count(/KSampler|SamplerCustom/i);
    var lora = count(/lora/i);
    var cnet = has(/controlnet/i);
    var upscale = has(/upscale/i);
    if (samplers) {
      var imgIn = has(/^LoadImage/i);
      var job = has(/video|ImageToVideo|LTXV|^Wan|EmptyMochi|CosmosImage/i) ? (imgIn ? 'Image to Video' : 'Text to Video')
        : has(/ImageEdit|ReferenceLatent|Kontext/i) ? 'Image Edit'
        : has(/inpaint|SetLatentNoiseMask/i) ? 'Inpaint'
        : (imgIn && has(/^VAEEncode/i)) ? 'Image to Image'
        : (samplers > 1 && upscale) ? 'Hires Fix'
        : 'Text to Image';
      return job + (cnet ? ' + ControlNet' : (lora ? ' + LoRA' : ''));
    }
    for (var i = 0; i < nodes.length; i++) {
      var def = SRV.api && SRV.api[types[i]] && SRV.types && SRV.types[types[i]];
      if (def) return { api: String(def.display_name || types[i]).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\bAPI\b/g, '').replace(/\s+/g, ' ').trim() };
    }
    if (upscale) return 'Upscale';
    if (cnet) return 'ControlNet';
    if (lora === types.length) return 'LoRA Stack';
    if (types.every(function (t) { return /loader|^Load(Checkpoint|Diffusion)/i.test(t); })) return 'Loaders';
    if (types.every(function (t) { return /TextEncode|prompt|conditioning/i.test(t); })) return 'Prompts';
    return '';
  }

  /* No known job: the chain, left to right ("Load Image → Crop → Preview") */
  function mgChain(nodes) {
    var names = [];
    nodes.forEach(function (n) {
      var t = String(n.title || n.type || '').trim();
      if (t && names.indexOf(t) < 0) names.push(t);
    });
    if (names.length <= 3) {
      var full = names.join(' → ');
      if (full.length <= 34) return full;
      var short = names.map(function (t, i) { return i ? (t.replace(/\s+(image|video|node)$/i, '') || t) : t; }).join(' → ');
      if (short.length <= 34) return short;
    }
    return names[0] + ' → ' + names[names.length - 1];
  }

  /* A saved button is named after what it holds: a titled group, the one node, or what the nodes do together
     ("Flux · Text to Image + LoRA") */
  function mgName(nodes, items) {
    var name = mgSmartName(nodes, items);
    var taken = (S.templates || []).map(function (t) { return t.name; });
    for (var k = 2, base = name; taken.indexOf(name) >= 0; k++) name = base + ' ' + k;
    return name;
  }

  /* A label on the canvas is a name someone already wrote: the text of a Label (rgthree) or a Pixaroma label,
     or of the note Label Studio leaves when neither is installed (its title and its text are the same). Its
     first line, without the quick icon Label Studio puts in front */
  function mgLabelText(n) {
    var t = nodeTypeOf(n), s = '';
    if (t === LABEL_RG_TYPE) s = n.title;
    else if (t === LABEL_PIX_TYPE) {
      try { s = JSON.parse(String((widgetNamed(n, 'label_json') || {}).value || '')).text; } catch (e) { s = ''; }
    } else if (t === 'MarkdownNote' || t === 'Note') {
      var body = String((widgetNamed(n, 'text') || (n.widgets || [])[0] || {}).value || '').replace(/^#+\s*/, '').trim();
      s = String(n.title || '').trim();
      if (!s || s !== body) s = '';
    }
    s = String(s || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean)[0] || '';
    for (var i = 0; i < LABEL_ICONS.length; i++) {
      var gl = LABEL_ICONS[i].g.replace(/[\uFE0E\uFE0F]/g, '');
      if (s.indexOf(gl) !== 0) continue;
      var rest = s.slice(gl.length);
      if (!rest || /^[\uFE0E\uFE0F]?(\s|$)/.test(rest)) s = rest.replace(/^[\uFE0E\uFE0F]/, '');
      break;
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  /* The label that names a set of nodes: the top one, then the leftmost. `picked` takes only the labels that
     are selected themselves, not the ones a selected group brought along */
  function mgLabelName(nodes, picked) {
    var sel = picked ? selNodes() : null, best = null, name = '';
    nodes.forEach(function (n) {
      if (sel && sel.indexOf(n) < 0) return;
      var txt = mgLabelText(n);
      if (!txt) return;
      var p = n.pos || [0, 0];
      if (!best || p[1] < best[1] || (p[1] === best[1] && p[0] < best[0])) { best = p; name = txt; }
    });
    return name;
  }

  /* The name alone, without the "2", "3"… that keeps saved buttons apart (groups made with G use it too) */
  function mgSmartName(nodes, items) {
    /* a label selected along with the nodes is the name already written for them, so it comes first; then a
       titled group; then a label that came inside a selected group */
    var name = mgLabelName(nodes, true);
    for (var i = 0; i < items.length && !name; i++) {
      var tt = String((!isGraphNode(items[i]) && items[i].children && items[i].title) || '').trim();
      if (tt && !/^group$/i.test(tt)) name = tt;
    }
    if (!name) name = mgLabelName(nodes, false);
    if (!name && nodes.length === 1) name = String(nodes[0].title || nodes[0].type || 'Node');
    if (!name) {
      var types = nodes.map(nodeTypeOf);
      var job = mgJob(types, nodes);
      if (job && job.api) name = job.api;
      else if (job) {
        var fam = mgFamily(nodes, types);
        name = fam ? fam + ' · ' + job : job;
      } else name = mgChain(nodes);
    }
    return name.slice(0, 40);
  }

  /* While the ghosts fly, the real nodes step aside; restore() fades them back in where they were */
  function mgHideNodes(nodes) {
    var c = getCanvas(), g = getGraph(), ids = {}, els = [], holds = [], alpha = 0, done = false;
    nodes.forEach(function (n) {
      ids[n.id] = 1;
      var el = document.querySelector('.lg-node[data-node-id="' + cssEsc(n.id) + '"]');
      if (el && el.animate) {
        els.push(el);
        holds.push(el.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 60000, fill: 'forwards' }));
      }
    });
    /* classic nodes are pixels on the canvas: skip drawing them, then draw them fading in */
    var own = c && Object.prototype.hasOwnProperty.call(c, 'drawNode') ? c.drawNode : null;
    var base = c && c.drawNode;
    if (base) {
      c.drawNode = function (node, ctx) {
        if (!ids[node.id]) return base.apply(this, arguments);
        if (alpha <= 0) return;
        var ga = ctx.globalAlpha;
        ctx.globalAlpha = ga * alpha;
        try { return base.apply(this, arguments); } finally { ctx.globalAlpha = ga; }
      };
      try { g.setDirtyCanvas(true, true); } catch (e) {}
    }
    var safety = setTimeout(restore, 4000);
    function restore() {
      if (done) return;
      done = true;
      clearTimeout(safety);
      els.forEach(function (el, i) {
        try {
          holds[i].cancel();
          el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: i * 35, easing: 'ease-out', fill: 'backwards' });
          var inner = el.querySelector('[data-testid="node-inner-wrapper"]') || el.firstElementChild;
          if (inner) inner.animate([{ transform: 'scale(.94)' }, { transform: 'scale(1)' }], { duration: 420, delay: i * 35, easing: 'cubic-bezier(.34,1.4,.64,1)', fill: 'backwards' });
        } catch (e) {}
      });
      if (!base) return;
      var t0 = performance.now();
      (function step() {
        alpha = Math.min(1, (performance.now() - t0) / 300);
        try { g.setDirtyCanvas(true, true); } catch (e) {}
        if (alpha < 1) { requestAnimationFrame(step); return; }
        if (own) c.drawNode = own;
        else delete c.drawNode;
      })();
    }
    return { restore: restore };
  }

  function mgCard(gh, title, color, sc) {
    var LG = litegraph();
    var th = Math.max(10, ((LG && LG.NODE_TITLE_HEIGHT) || 30) * (sc || 1));
    gh.classList.add('shb-mg-card');
    gh.innerHTML = '<div class="shb-mg-card-t" style="height:' + th + 'px;font-size:' + Math.max(8, Math.round(12 * (sc || 1))) + 'px' +
      (color ? ';background:' + esc(color) : '') + '">' + esc(title) + '</div>';
  }

  /* A ghost of a node on screen, at its exact spot: Vue nodes are DOM (a clone keeps their look), classic
     nodes are pixels on the canvas (a snapshot of that region) */
  function mgGhost(root, node) {
    var r = hbNodeRect(node);
    if (!r || !r.w || !r.h) return null;
    var gh = document.createElement('div');
    gh.className = 'shb-mg-ghost';
    gh.style.cssText = 'left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px';
    var vEl = document.querySelector('.lg-node[data-node-id="' + cssEsc(node.id) + '"]');
    try {
      if (vEl) {
        var cl = vEl.cloneNode(true);
        var w = vEl.offsetWidth || r.w, h = vEl.offsetHeight || r.h;
        cl.removeAttribute('data-node-id');
        cl.style.cssText += ';position:absolute;left:0;top:0;margin:0;width:' + w + 'px;height:' + h + 'px;transform:scale(' + (r.w / w) + ');transform-origin:0 0;pointer-events:none';
        gh.appendChild(cl);
      } else {
        var src = getCanvas().canvas;
        var cr = src.getBoundingClientRect(), k = src.width / (cr.width || 1);
        var snap = document.createElement('canvas');
        snap.width = Math.max(1, Math.round(r.w * k));
        snap.height = Math.max(1, Math.round(r.h * k));
        snap.getContext('2d').drawImage(src, (r.x - cr.left) * k, (r.y - cr.top) * k, r.w * k, r.h * k, 0, 0, snap.width, snap.height);
        snap.style.cssText = 'width:100%;height:100%;display:block';
        gh.appendChild(snap);
      }
    } catch (e) {
      gh.innerHTML = '';
      mgCard(gh, node.title || node.type, node.color, 1);
    }
    root.appendChild(gh);
    return gh;
  }

  /* Save as Button: a copy of the selected nodes melts into one button in the bottom bar, and the nodes
     themselves come back once it has landed */
  function actMagic(node) {
    var c = getCanvas(), g = getGraph();
    if (!c || !g || MG_BUSY) return;
    var items = mgItems(node);
    var nodes = items.filter(isGraphNode);
    if (!nodes.length) {
      setStatus('error', 'Select the nodes to save, or open the hotbox over one');
      return;
    }
    var data = null;
    try { data = mgSerialize(items); } catch (e) { data = null; }
    if (!data || !data.nodes || !data.nodes.length) {
      setStatus('error', 'Could not read those nodes');
      return;
    }
    nodes.sort(function (a, b) { return (a.pos[0] - b.pos[0]) || (a.pos[1] - b.pos[1]); });
    var tpl = {
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: mgName(nodes, items),
      count: nodes.length,
      at: new Date().toISOString(),
      data: data
    };
    /* with a shared library picked in Settings, the button is saved there for everyone who has it */
    var lib = libSaveTarget();
    var uid = 'tpl:' + (lib ? lib.key + ':' : '') + tpl.id;

    /* ghosts first, while the nodes are still on screen */
    var root = mgOverlay();
    var ghosts = nodes.map(function (n) { return mgGhost(root, n); }).filter(Boolean);
    var bar = HB.el && HB.el.querySelector('.shb-bar-items[data-hb-bar="bot"]');
    var slot = null, chip = null;
    if (bar && ghosts.length) {
      slot = document.createElement('span');
      slot.className = 'shb-mg-slot';
      slot.innerHTML = renderBarItemHTML({ uid: uid, kind: 'template', id: tpl.id, label: tpl.name, title: tpl.name, icon: 'sparkles', kbd: '', cls: '', count: tpl.count }, 'bot', 0);
      chip = slot.firstElementChild;
      chip.style.width = 'max-content';
      bar.appendChild(slot);
    }

    /* the button is saved right away (a bar that was never customized lists every saved button by itself) */
    if (lib) {
      var shared = { id: lib.key + ':' + tpl.id, rawId: tpl.id, name: tpl.name, count: tpl.count, at: tpl.at, data: tpl.data,
        lib: lib.key, libLabel: lib.label, canDelete: true };
      lib.buttons.push(shared);
      libWriteButton(lib, tpl).then(function (ok) {
        if (ok) return;
        /* the folder could not take it: it stays yours instead, so nothing is lost */
        lib.buttons = lib.buttons.filter(function (b) { return b !== shared; });
        S.templates.push(tpl);
        if (Array.isArray(S.customBotBar)) S.customBotBar.push('tpl:' + tpl.id);
        save();
        setStatus('error', 'Could not write to ' + lib.label + ' · "' + tpl.name + '" was saved as your own button instead');
        if (HB.el) hbPaint();
      });
    } else {
      S.templates.push(tpl);
    }
    if (Array.isArray(S.customBotBar) && S.customBotBar.indexOf(uid) < 0) S.customBotBar.push(uid);
    save();
    setStatus('ok', '✨ Saved ' + tpl.count + (tpl.count === 1 ? ' node' : ' nodes') + ' as "' + tpl.name + '"' + (lib ? ' in ' + lib.label : '')
      + ' · click it, or drag it onto the canvas, to add them again');

    if (!chip) {
      if (root.parentNode) root.parentNode.removeChild(root);
      if (HB.el) hbPaint();
      return;
    }
    var hidden = mgHideNodes(nodes);
    var fly = document.createElement('div');
    fly.className = 'shb-mg-fly';
    fly.innerHTML = '<span class="shb-mg-flyc"><span class="shb-tpl-ico">' + ico('sparkles', hbIsFluid() ? 15 : 13) + '</span>' +
      '<span>' + esc(tpl.name) + '</span><span class="shb-tpl-n">' + tpl.count + '</span></span>';
    root.appendChild(fly);
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    ghosts.forEach(function (gh) {
      var r = gh.getBoundingClientRect();
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    });
    var selBox = document.createElement('div');
    selBox.className = 'shb-mg-sel';
    selBox.style.cssText = 'left:' + (x0 - 10) + 'px;top:' + (y0 - 10) + 'px;width:' + (x1 - x0 + 20) + 'px;height:' + (y1 - y0 + 20) + 'px';
    root.insertBefore(selBox, root.firstChild);

    var mv = mgVariant();
    MG_BUSY = true;
    var h = mgPlay(mv.v, {
      root: root,
      nodes: ghosts,
      selection: selBox,
      slot: slot,
      chip: chip,
      fly: fly,
      flyContent: fly.firstElementChild,
      fx: root.querySelector('.shb-mg-fx'),
      trigger: HB.el && HB.el.querySelector('[data-hb-run="tool:magic"]')
    }, { pace: mv.pace });
    h.finished.then(function () {
      MG_BUSY = false;
      /* the real button takes the place of the one that just landed, and the nodes come back */
      if (HB.el) hbPaint();
      h.cancel();
      if (root.parentNode) root.parentNode.removeChild(root);
      hidden.restore();
    });
  }

  /* A template button was clicked: its nodes fly out of the button and land by the cursor */
  function tplRunFromBar(uid, tpl) {
    var b = HB.el && HB.el.querySelector('[data-hb-run="' + cssEsc(uid) + '"]');
    var r = b && b.getBoundingClientRect();
    var at = { x: HB.anchorX || HB_MX, y: HB.anchorY || HB_MY };
    /* a saved block is a module: with one node selected and an open input in the block that its output fits,
       the block lands right after that node and takes its output */
    var sel = selNodes(), src = sel.length === 1 ? sel[0] : null;
    if (src && tpl.data && tplEntry(tpl.data.nodes, src, tpl.data.links || [])) {
      var vb = visBox(src);
      at = graphToClient(vb.x + vb.w + 90, vb.y);
    } else src = null;
    hbClose();
    tplRun(tpl, (r && r.width) ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : at, at, src);
  }

  /* Where a block plugs in: the first open input (not a widget) of its leftmost head node — a node nothing in
     the block feeds — that one of `src`'s outputs fits. A block that starts with its own loader takes nothing.
     Saved data keeps its wires in `links`; nodes on the canvas carry them on their inputs. */
  function tplEntry(nodes, src, links) {
    var outs = (src && src.outputs) || [];
    var fed = {};
    (links || []).forEach(function (l) { fed[Array.isArray(l) ? l[3] : l.target_id] = 1; });
    var head = (nodes || []).filter(function (n) {
      return !fed[n.id] && (n.inputs || []).every(function (i) { return !i || i.widget || i.link == null; });
    }).sort(function (a, b) { return ((a.pos && a.pos[0]) || 0) - ((b.pos && b.pos[0]) || 0); })[0];
    var ins = (head && head.inputs) || [];
    for (var j = 0; j < ins.length; j++) {
      if (!ins[j] || ins[j].widget) continue;
      for (var k = 0; k < outs.length; k++) {
        if (outs[k] && typeFits(outs[k].type, ins[j].type)) return { node: head, input: j, out: k };
      }
    }
    return null;
  }

  /* Drops a template: the block's top-left lands at screen point `at` (sliding down to a free spot), its nodes
     springing out of screen point `from` */
  function tplRun(tpl, from, at, src) {
    var c = getCanvas(), g = getGraph();
    if (!tpl || !tpl.data || !c || !g) return;
    var data = tpl.data;
    var LG = litegraph();
    var TH = (LG && LG.NODE_TITLE_HEIGHT) || 30;
    var pos = clientToGraph(at.x, at.y);
    /* the paste puts the block's top-left corner (nodes and groups) on `pos` */
    var ox = 1e9, oy = 1e9;
    (data.nodes || []).forEach(function (n) {
      if (n.pos) { ox = Math.min(ox, +n.pos[0] || 0); oy = Math.min(oy, +n.pos[1] || 0); }
    });
    (data.groups || []).forEach(function (gr) {
      var b = gr.bounding;
      if (b) { ox = Math.min(ox, b[0]); oy = Math.min(oy, b[1]); }
    });
    if (ox === 1e9) { ox = 0; oy = 0; }
    var boxes = (data.nodes || []).map(function (n) {
      var collapsed = !!(n.flags && n.flags.collapsed);
      var w = collapsed ? 190 : ((n.size && +n.size[0]) || 240), h = collapsed ? 0 : ((n.size && +n.size[1]) || 120);
      var np = n.pos || [ox, oy];
      return { n: n, x: np[0] - ox + pos[0], y: np[1] - oy + pos[1] - TH, w: w, h: h + TH };
    });
    var u = { x: 1e9, y: 1e9, r: -1e9, b: -1e9 };
    boxes.forEach(function (b) {
      u.x = Math.min(u.x, b.x); u.y = Math.min(u.y, b.y);
      u.r = Math.max(u.r, b.x + b.w); u.b = Math.max(u.b, b.y + b.h);
    });
    var dy = boxes.length ? hbFreeDy(g, { x: u.x, y: u.y, w: u.r - u.x, h: u.b - u.y }, []) : 0;
    pos[1] += dy;

    var root = mgOverlay();
    var ghosts = boxes.map(function (b) {
      var p0 = graphToClient(b.x, b.y + dy);
      var gh = document.createElement('div');
      gh.className = 'shb-mg-ghost';
      gh.style.cssText = 'left:' + p0.x + 'px;top:' + p0.y + 'px;width:' + (b.w * p0.s) + 'px;height:' + (b.h * p0.s) + 'px';
      var def = SRV.types && SRV.types[b.n.type];
      mgCard(gh, b.n.title || (def && def.display_name) || b.n.type, b.n.color, p0.s);
      root.appendChild(gh);
      return gh;
    });
    var mv = mgVariant();
    var h = mgUnpack({ root: root, nodes: ghosts, fx: root.querySelector('.shb-mg-fx'), pace: mv.pace }, from, mv.v);
    /* the real nodes appear right under their ghosts just before the ghosts go */
    setTimeout(function () {
      var made = [];
      try { made = mgPaste(data, pos); } catch (e) {
        setStatus('error', 'Could not add the saved nodes: ' + msgOf(e));
        return;
      }
      var label = '✨ Added "' + tpl.name + '" (' + made.length + (made.length === 1 ? ' node)' : ' nodes)');
      try { g.setDirtyCanvas(true, true); } catch (e) {}
      setStatus('ok', label);
      /* the block's open input can be one a node grows a moment after the paste (newer API nodes), so a few tries */
      (function plug(tries) {
        var ent = src ? tplEntry(made, src) : null;
        if (ent) {
          try {
            src.connect(ent.out, ent.node, ent.input);
            setStatus('ok', label + ' · plugged into ' + (src.title || src.type));
            g.setDirtyCanvas(true, true);
          } catch (e) {}
        } else if (src && tries < 10) setTimeout(function () { plug(tries + 1); }, 120);
      })(0);
    }, Math.max(0, h.duration - 60));
    h.finished.then(function () {
      setTimeout(function () {
        h.cancel();
        if (root.parentNode) root.parentNode.removeChild(root);
      }, 80);
    });
  }

  function tplDelete(id) {
    var t = tplById(id);
    if (!t) return;
    var uid = 'tpl:' + id;
    function strip(list) { return Array.isArray(list) ? list.filter(function (u) { return u !== uid; }) : list; }
    var undo = null;
    if (t.lib) {
      var l = libByKey(t.lib);
      if (!l || !t.canDelete) {
        setStatus('error', '"' + t.name + '" is in a read-only library');
        return;
      }
      /* Undo writes it back into its folder */
      undo = hbUndoPush('deleting "' + t.name + '"');
      undo.libs.push({ lib: t.lib, tpl: { id: t.rawId, name: t.name, count: t.count, at: t.at, data: t.data } });
      l.buttons = l.buttons.filter(function (b) { return b !== t; });
      libDeleteButton(l, t.rawId).then(function (ok) {
        if (!ok) { setStatus('error', 'Could not delete "' + t.name + '" from ' + l.label); libRefresh(true); }
      });
    }
    if (!undo) hbUndoPush('deleting "' + t.name + '"');
    S.templates = S.templates.filter(function (x) { return x !== t; });
    S.customBotBar = strip(S.customBotBar);
    Object.keys(S.customToolsBar || {}).forEach(function (k) { S.customToolsBar[k] = strip(S.customToolsBar[k]); });
    Object.keys(S.customAddBySig || {}).forEach(function (k) { S.customAddBySig[k] = strip(S.customAddBySig[k]); });
    /* a group that held it lets go of it too, and asks before it goes if that was its last button but one */
    Object.keys(S.hbGroups && typeof S.hbGroups === 'object' ? S.hbGroups : {}).forEach(function (k) {
      if (S.hbGroups[k] && Array.isArray(S.hbGroups[k].items)) S.hbGroups[k].items = strip(S.hbGroups[k].items);
    });
    grpAskLone(HB.node);
    if (S.customLabels) delete S.customLabels[uid];
    if (S.customColors) delete S.customColors[uid];
    if (S.customFill) delete S.customFill[uid];
    if (S.customKeys) delete S.customKeys[uid];
    save();
    setStatus('ok', 'Deleted the saved button "' + t.name + '"');
  }

  /* "Load Image · Crop Image · Preview Image": what a saved button holds, in a line */
  function tplSummaryOf(tp) {
    var names = [];
    ((tp && tp.data && tp.data.nodes) || []).forEach(function (n) {
      var t = tedNodeName(n);
      if (t && names.indexOf(t) < 0) names.push(t);
    });
    return names.slice(0, 3).join(' · ') + (names.length > 3 ? ' +' + (names.length - 3) : '');
  }

  /* A saved button takes other nodes and stays the same button: its place in the bars and in its group, its
     name, its color and its key. What it held before waits behind it (the last five), so an older version can
     come back. A shared library's button is written back into its folder */
  function tplSetData(tpl, data, why) {
    var count = ((data && data.nodes) || []).length;
    if (!tpl || !count) return Promise.resolve(false);
    if (tpl.lib) {
      var l = libByKey(tpl.lib);
      if (!l || !tpl.canDelete) {
        setStatus('error', '"' + tpl.name + '" is in a read-only library');
        return Promise.resolve(false);
      }
      return libWriteButton(l, { id: tpl.rawId, name: tpl.name, count: count, at: tpl.at, data: data }).then(function (ok) {
        if (!ok) {
          setStatus('error', 'Could not write "' + tpl.name + '" to ' + l.label);
          return false;
        }
        tpl.data = data;
        tpl.count = count;
        hbRedrawAll();
        return true;
      });
    }
    hbUndoPush(why || 'changing the nodes of "' + tpl.name + '"');
    var hist = Array.isArray(tpl.history) ? tpl.history.slice() : [];
    hist.unshift({ at: tpl.edited || tpl.at, count: tpl.count, data: tpl.data });
    tpl.history = hist.slice(0, 5);
    tpl.data = data;
    tpl.count = count;
    tpl.edited = new Date().toISOString();
    save();
    hbRedrawAll();
    return Promise.resolve(true);
  }

  /* Every list of bar buttons there is: the bottom bar's, and a dock and a context one per kind of node */
  function hbBarLists() {
    var out = [];
    if (Array.isArray(S.customBotBar)) {
      out.push({ bar: 'bot', get: function () { return S.customBotBar; }, set: function (l) { S.customBotBar = l; } });
    }
    [['add', 'customAddBySig'], ['tools', 'customToolsBar']].forEach(function (p) {
      var m = S[p[1]];
      Object.keys(m && typeof m === 'object' ? m : {}).forEach(function (k) {
        if (Array.isArray(m[k])) out.push({ bar: p[0], get: function () { return m[k]; }, set: function (l) { m[k] = l; } });
      });
    });
    return out;
  }

  /* The bottom bar's own list takes these at its end (a bar never customized gets its list from what it shows) */
  function hbBotAppend(uids) {
    var list = Array.isArray(S.customBotBar) ? S.customBotBar.slice() : getBarUids('bot', HB.node || null);
    uids.forEach(function (u) { if (list.indexOf(u) < 0) list.push(u); });
    S.customBotBar = list;
  }

  /* A group gives its buttons back to every bar it sits in, in its place, and is gone */
  function grpUngroup(gid) {
    var uid = 'grp:' + gid, grp = grpById(gid);
    if (!grp) return;
    var items = (grp.items || []).slice(), found = false;
    hbBarLists().forEach(function (L) {
      var list = L.get().slice(), at = list.indexOf(uid);
      if (at < 0) return;
      found = true;
      Array.prototype.splice.apply(list, [at, 1].concat(items.filter(function (k) { return list.indexOf(k) < 0; })));
      L.set(list);
    });
    if (!found && items.length) hbBotAppend(items);
    delete S.hbGroups[gid];
    ['customLabels', 'customColors', 'customFill', 'customKeys'].forEach(function (k) { if (S[k]) delete S[k][uid]; });
    delete HB.grpOpen[gid];
  }

  /* A button leaves its group and goes back to the bar the group sits in, right after it */
  function grpTakeOut(gid, uid) {
    var grp = grpById(gid);
    if (!grp) return;
    grp.items = (grp.items || []).filter(function (u) { return u !== uid; });
    var placed = false;
    hbBarLists().forEach(function (L) {
      var list = L.get(), at = list.indexOf('grp:' + gid);
      if (at < 0) return;
      placed = true;
      if (list.indexOf(uid) >= 0) return;
      list = list.slice();
      list.splice(at + 1, 0, uid);
      L.set(list);
    });
    if (!placed) hbBotAppend([uid]);
  }

  /* A button goes into a group (before `before`, else at its end): one group at a time, and no longer beside
     it in a bar */
  function grpPutIn(gid, uid, before) {
    var grp = grpById(gid);
    if (!grp || /^grp:/.test(uid)) return;
    Object.keys(S.hbGroups).forEach(function (k) {
      var g = S.hbGroups[k];
      if (!g || !Array.isArray(g.items) || g.items.indexOf(uid) < 0) return;
      g.items = g.items.filter(function (u) { return u !== uid; });
      /* the group it left stays, even with one button or none: here a group only goes with Ungroup */
      if (k !== gid && g.items.length < 2) g.keep = true;
    });
    var items = (grp.items || []).slice();
    var at = before ? items.indexOf(before) : -1;
    if (at < 0) items.push(uid);
    else items.splice(at, 0, uid);
    grp.items = items;
    /* a bottom bar that was never customized lists every saved button by itself: it gets its own list, without this one */
    if (!Array.isArray(S.customBotBar) && /^tpl:/.test(uid)) S.customBotBar = getBarUids('bot', HB.node || null);
    hbBarLists().forEach(function (L) {
      if (L.get().indexOf(uid) >= 0) L.set(L.get().filter(function (u) { return u !== uid; }));
    });
  }

  /* ---------------------------------------------------------------------
   * 14b. THE BUTTON BROWSER (Settings → Saved Buttons → Browse): every saved button and every group on cards,
   * to rename, color and give a key to, to put into groups and take out of them, to edit the nodes of, and to
   * delete. Every change saves itself and can be taken back (Undo, Ctrl+Z)
   * --------------------------------------------------------------------- */
  var BRW = { el: null, q: '', drag: null, noClick: 0 };

  function brwOpen() {
    if (BRW.el) { brwRender(); return; }
    var bg = owns(document.createElement('div'));
    bg.className = 'shb-modal-bg';
    bg.innerHTML = '<div class="shb-modal shb-brw"></div>';
    document.body.appendChild(bg);
    BRW.el = bg;
    BRW.q = '';
    BRW.shut = modalOpen(function () { brwClose(); });
    bg.addEventListener('mousedown', function (ev) { if (ev.target === bg) brwClose(); });
    bg.addEventListener('click', brwClick);
    bg.addEventListener('pointerdown', brwDown);
    bg.addEventListener('input', function (ev) {
      if (!ev.target || !ev.target.hasAttribute || !ev.target.hasAttribute('data-brw-q')) return;
      BRW.q = ev.target.value;
      brwRenderBody();
    });
    bg.addEventListener('keydown', function (ev) {
      if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName || '')) ev.stopPropagation();
    });
    libRefresh(true).then(function () { if (BRW.el) brwRender(); });
    brwRender();
  }

  function brwClose() {
    var bg = BRW.el;
    if (!bg) return;
    BRW.el = null;
    BRW.drag = null;
    modalShut(BRW.shut);
    tipHide();
    if (bg.parentNode) bg.parentNode.removeChild(bg);
  }

  /* where a group sits: "in the bottom bar" */
  function brwWhere(uid) {
    var names = { bot: 'bottom bar', add: 'dock', tools: 'context bar' }, seen = [];
    hbBarLists().forEach(function (L) {
      if (L.get().indexOf(uid) >= 0 && seen.indexOf(names[L.bar]) < 0) seen.push(names[L.bar]);
    });
    return seen.length ? 'in the ' + seen.join(' and the ') : 'not on a bar';
  }

  function brwRender() {
    if (!BRW.el) return;
    var box = BRW.el.querySelector('.shb-brw');
    var nOwn = (S.templates || []).length, nGrp = Object.keys(S.hbGroups || {}).length, nSh = libSharedButtons().length;
    tipHide();
    box.innerHTML =
      '<div class="shb-modal-t shb-brw-hd">' +
        '<span class="shb-brw-title">' + hbLogoChip(20) + '<span>Buttons</span>' +
          '<small>' + nOwn + ' saved · ' + nGrp + (nGrp === 1 ? ' group' : ' groups') + (nSh ? ' · ' + nSh + ' shared' : '') + '</small></span>' +
        '<span class="shb-brw-tools">' +
          '<span class="shb-brw-find">' + ico('search', 13) + '<input type="text" class="shb-input" data-brw-q spellcheck="false" placeholder="Find a button…" value="' + esc(BRW.q) + '"></span>' +
          '<button type="button" class="shb-btn shb-btn-pri" data-brw-act="newgrp" data-tip="A new, empty group in the bottom bar: drag buttons onto it">' + ico('folder', 13) + '<span>New Group</span></button>' +
          '<button type="button" class="shb-btn shb-btn-pri" data-brw-act="undo"' + (hbUndoLeft() ? '' : ' disabled') + ' data-tip="Take back the last change (Ctrl+Z)">' + ico('history', 13) + '<span>Undo</span></button>' +
          '<button type="button" class="shb-btn shb-btn-on" data-brw-act="close">Done</button>' +
        '</span>' +
      '</div>' +
      '<div class="shb-brw-body" data-brw-body></div>' +
      '<div class="shb-brw-foot">Click a card for its name, color and key · drag a button onto a group to put it in, and out of it to take it out · the pencil opens its nodes · every change saves itself</div>';
    brwRenderBody();
  }

  function brwRenderBody() {
    var body = BRW.el && BRW.el.querySelector('[data-brw-body]');
    if (!body) return;
    var q = String(BRW.q || '').toLowerCase().trim();
    var gids = Object.keys(S.hbGroups && typeof S.hbGroups === 'object' ? S.hbGroups : {});
    var inGrp = {};
    gids.forEach(function (gid) { ((S.hbGroups[gid] || {}).items || []).forEach(function (u) { inGrp[u] = gid; }); });
    function hit(text) { return !q || String(text || '').toLowerCase().indexOf(q) >= 0; }
    function tintStyle(uid) { var t = barTint(uid); return t ? ' style="--shb-tint:' + esc(t) + '"' : ''; }
    function keyChip(uid) { var k = hbKeyName(hbKeyFor(uid)); return k ? '<span class="shb-key" title="Its key in the hotbox">' + esc(k) + '</span>' : ''; }

    function tplCard(tp) {
      var uid = 'tpl:' + tp.id, name = hbBtnName(uid, tp.name), sum = tplSummaryOf(tp), gid = inGrp[uid];
      if (!hit(name + ' ' + sum + ' ' + (gid ? S.hbGroups[gid].name : ''))) return '';
      var canEdit = !tp.lib || tp.canDelete;
      return '<div class="shb-brw-card' + (S.customFill && S.customFill[uid] && barTint(uid) ? ' shb-brw-fill' : '') + '" data-brw-uid="' + esc(uid) + '" data-brw-drag' + tintStyle(uid) + '>' +
        '<div class="shb-brw-c1"><span class="shb-brw-ico">' + ico('sparkles', 16) + '</span><b>' + esc(name) + '</b>' + keyChip(uid) +
          '<span class="shb-tpl-n" title="Nodes it holds">' + esc(tp.count) + '</span></div>' +
        '<div class="shb-brw-c2">' + esc(sum) + '</div>' +
        '<div class="shb-brw-c3">' +
          (gid ? '<span class="shb-brw-chip">' + ico('folder', 11) + '<span>' + esc(hbBtnName('grp:' + gid, S.hbGroups[gid].name)) + '</span></span>'
            : '<span class="shb-brw-chip shb-brw-chip-no">not in a group</span>') +
          (tp.lib ? '<span class="shb-brw-chip">' + esc(tp.libLabel || 'shared') + '</span>' : '') +
          '<span class="shb-brw-acts">' +
            (canEdit ? '<button type="button" class="shb-btn shb-btn-ico" data-brw-act="nodes" data-tip="Edit its nodes: change a value or a title, take a node out, or edit the JSON. It stays the same button">' + ico('edit', 13) + '</button>' +
              '<button type="button" class="shb-btn shb-btn-ico" data-brw-act="del" data-tip="Delete this saved button (Undo brings it back)">' + ico('trash', 13) + '</button>' : '') +
          '</span>' +
        '</div>' +
      '</div>';
    }

    function grpBox(gid) {
      var g = S.hbGroups[gid] || {}, uid = 'grp:' + gid, name = hbBtnName(uid, g.name), items = g.items || [];
      if (q && !hit(name) && !items.some(function (u) { return hit(hbUidLabel(u)); })) return '';
      return '<div class="shb-brw-grp" data-brw-grp="' + esc(gid) + '"' + tintStyle(uid) + '>' +
        '<div class="shb-brw-ghd" data-brw-uid="' + esc(uid) + '">' +
          '<span class="shb-brw-ico">' + ico('folder', 16) + '</span><b>' + esc(name) + '</b>' + keyChip(uid) +
          '<small>' + items.length + (items.length === 1 ? ' button' : ' buttons') + ' · ' + esc(brwWhere(uid)) + '</small>' +
          '<span class="shb-brw-acts"><button type="button" class="shb-btn" data-brw-act="ungroup" data-tip="The group goes, and its buttons go back to the bar it sits in">Ungroup</button></span>' +
        '</div>' +
        '<div class="shb-brw-mems">' +
          (items.length ? items.map(function (u) {
            return '<span class="shb-brw-mem" data-brw-uid="' + esc(u) + '" data-brw-in="' + esc(gid) + '" data-brw-drag' + tintStyle(u) + '>' +
              '<span class="shb-brw-ico">' + ico(/^tpl:/.test(u) ? 'sparkles' : (/^tool:/.test(u) ? 'tools' : 'plus'), 13) + '</span><span>' + esc(hbUidLabel(u)) + '</span>' + keyChip(u) +
              '<i class="shb-brw-out" data-brw-act="out" data-tip="Take it out of the group">×</i>' +
            '</span>';
          }).join('') : '<span class="shb-brw-none">Empty · drag a button here</span>') +
        '</div>' +
      '</div>';
    }

    var groupsHTML = gids.map(grpBox).join('');
    var ownHTML = (Array.isArray(S.templates) ? S.templates : []).map(tplCard).join('');
    var sharedHTML = LIB.list.map(function (l) {
      var cards = (l.buttons || []).map(tplCard).join('');
      return cards ? '<div class="shb-brw-sec">' + esc(l.label) + '<small>shared library' + (libWritable(l) ? '' : ' · read-only') + '</small></div><div class="shb-brw-grid">' + cards + '</div>' : '';
    }).join('');
    body.innerHTML =
      '<div class="shb-brw-sec">Groups<small>drop a button on a group to put it in</small></div>' +
      (groupsHTML ? '<div class="shb-brw-grps">' + groupsHTML + '</div>'
        : '<div class="shb-sb-empty">' + (q ? 'No group matches.' : 'No groups yet. New Group makes one; in edit mode, resting one bar button on another makes one too.') + '</div>') +
      '<div class="shb-brw-sec">Saved buttons<small>the sets of nodes you saved with X (Save as Button)</small></div>' +
      (ownHTML ? '<div class="shb-brw-grid">' + ownHTML + '</div>'
        : '<div class="shb-sb-empty">' + (q ? 'No saved button matches.' : 'Nothing saved yet. Select some nodes and press X (Save as Button) in the hotbox.') + '</div>') +
      sharedHTML;
  }

  function brwClick(ev) {
    if (Date.now() < BRW.noClick) return;
    var t = ev.target;
    if (!t || !t.closest) return;
    var actEl = t.closest('[data-brw-act]');
    var act = actEl ? actEl.getAttribute('data-brw-act') : '';
    var holder = t.closest('[data-brw-uid]');
    var uid = holder ? holder.getAttribute('data-brw-uid') : '';
    var gBox = t.closest('[data-brw-grp]');
    var gid = gBox ? gBox.getAttribute('data-brw-grp') : '';
    if (act === 'close') { brwClose(); return; }
    if (act === 'undo') { hbUndo(); return; }
    if (act === 'newgrp') {
      hbUndoPush('a new group');
      var nid = grpNew();
      S.hbGroups[nid].keep = true;
      hbBotAppend(['grp:' + nid]);
      save();
      hbRedrawAll();
      setStatus('ok', 'New group "' + S.hbGroups[nid].name + '" in the bottom bar · drag buttons onto it · click it to name it');
      return;
    }
    if (act === 'ungroup' && gid) {
      var gName = hbBtnName('grp:' + gid, (grpById(gid) || {}).name);
      hbUndoPush('ungrouping "' + gName + '"');
      grpUngroup(gid);
      save();
      hbRedrawAll();
      setStatus('ok', 'Ungrouped "' + gName + '" · its buttons are back in the bar');
      return;
    }
    if (act === 'out' && uid && holder.getAttribute('data-brw-in')) {
      brwTakeOut(holder.getAttribute('data-brw-in'), uid);
      return;
    }
    if (act === 'nodes' && uid) { tplEditOpen(uid.slice(4)); return; }
    if (act === 'del' && uid) {
      var dName = hbUidLabel(uid);
      tplDelete(uid.slice(4));
      hbRedrawAll();
      setStatus('ok', 'Deleted the saved button "' + dName + '" · Undo (Ctrl+Z) brings it back');
      return;
    }
    if (uid) promptRenameBarItem(uid, HB.node, null);
  }

  function brwTakeOut(gid, uid) {
    var g = grpById(gid);
    if (!g) return;
    var name = hbUidLabel(uid), gName = hbBtnName('grp:' + gid, g.name);
    hbUndoPush('taking "' + name + '" out of "' + gName + '"');
    grpTakeOut(gid, uid);
    /* here a group only goes with Ungroup, so one left with a button or none stays */
    if ((g.items || []).length < 2) g.keep = true;
    save();
    hbRedrawAll();
    setStatus('ok', 'Took "' + name + '" out of "' + gName + '" · it is back in the bar');
  }

  /* Dragging in the browser: a card or a group's button onto a group puts it in (at the place it is dropped);
     a group's button dropped anywhere else comes out of its group */
  function brwDown(ev) {
    if (ev.button !== 0) return;
    var t = ev.target;
    var d = t && t.closest ? t.closest('[data-brw-drag]') : null;
    if (!d || t.closest('[data-brw-act]')) return;
    BRW.drag = { uid: d.getAttribute('data-brw-uid'), from: d.getAttribute('data-brw-in') || '', el: d, x0: ev.clientX, y0: ev.clientY, active: false, over: '', before: '' };
  }

  listen(document, 'pointermove', function (e) {
    var d = BRW.drag;
    if (!d || !BRW.el) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 7) return;
      d.active = true;
      d.el.classList.add('shb-brw-dragging');
      tipHide();
      ghostShow(hbUidLabel(d.uid), e.clientX, e.clientY);
    }
    e.preventDefault();
    var under = null;
    try { under = document.elementFromPoint(e.clientX, e.clientY); } catch (err) { under = null; }
    var g = under && under.closest ? under.closest('[data-brw-grp]') : null;
    var mem = under && under.closest ? under.closest('.shb-brw-mem') : null;
    Array.prototype.forEach.call(BRW.el.querySelectorAll('.shb-brw-hot'), function (x) { if (x !== g) x.classList.remove('shb-brw-hot'); });
    if (g) g.classList.add('shb-brw-hot');
    d.over = g ? g.getAttribute('data-brw-grp') : '';
    d.before = '';
    if (g && mem && mem !== d.el) {
      var r = mem.getBoundingClientRect();
      var ref = e.clientX < r.left + r.width / 2 ? mem : mem.nextElementSibling;
      d.before = (ref && ref !== d.el && ref.getAttribute) ? (ref.getAttribute('data-brw-uid') || '') : '';
    }
    var gName = d.over ? hbBtnName('grp:' + d.over, (grpById(d.over) || {}).name) : '';
    ghostMove(e.clientX, e.clientY, d.over ? (d.over === d.from ? 'Release to move it here' : 'Release to put it in ' + gName)
      : (d.from ? 'Release to take it out of the group' : 'Drag it onto a group'), d.over ? 'over' : '');
  }, true);

  listen(document, 'pointerup', function () {
    var d = BRW.drag;
    if (!d) return;
    BRW.drag = null;
    if (!d.active) return;
    ghostHide();
    BRW.noClick = Date.now() + 250;
    if (!BRW.el) return;
    if (d.over && grpById(d.over)) {
      var name = hbUidLabel(d.uid), gName = hbBtnName('grp:' + d.over, grpById(d.over).name);
      hbUndoPush((d.over === d.from ? 'moving "' : 'putting "') + name + '" in "' + gName + '"');
      grpPutIn(d.over, d.uid, d.before);
      save();
      hbRedrawAll();
      setStatus('ok', d.over === d.from ? 'Moved "' + name + '" in "' + gName + '"' : 'Put "' + name + '" in "' + gName + '"');
    } else if (d.from) brwTakeOut(d.from, d.uid);
    else brwRender();
  }, true);

  listen(document, 'pointercancel', function () {
    if (!BRW.drag) return;
    if (BRW.drag.active) ghostHide();
    BRW.drag = null;
    if (BRW.el) brwRender();
  }, true);

  /* ---------------------------------------------------------------------
   * 14c. THE NODES OF A SAVED BUTTON (the pencil on its card in the browser, or Edit Button → Edit its nodes):
   * change a node's values, title or run mode, take a node out, edit the JSON itself, bring back an older
   * version, or have the button take the nodes selected on the canvas. Saving keeps it the same button
   * --------------------------------------------------------------------- */
  var TED = { el: null };

  function tedNodeName(n) {
    var def = SRV.types && n && SRV.types[n.type];
    return String((n && n.title) || (def && def.display_name) || (n && n.type) || 'Node');
  }

  function tedWhen(iso) {
    var t = Date.parse(iso);
    return t ? new Date(t).toLocaleString() : 'earlier';
  }

  /* The names (and the choices) of a saved node's values. They are kept as a plain list, in the order of the
     node's widgets: a node of that type on the canvas knows them by name; otherwise the server's description
     of the type does, when its count matches. With neither, they are "value 1", "value 2"… */
  function tedWidgetMeta(n, len) {
    var live = null;
    try {
      allNodes(getGraph()).some(function (x) {
        if (String(x.type) === String(n.type) && Array.isArray(x.widgets) && x.widgets.length === len) { live = x; return true; }
        return false;
      });
    } catch (e) { live = null; }
    if (live) {
      return live.widgets.map(function (w) {
        var vals = w && w.options && w.options.values;
        return { name: String((w && (w.label || w.name)) || ''), values: Array.isArray(vals) ? vals : null, skip: !!(w && w.type === 'button') };
      });
    }
    var def = SRV.types && SRV.types[n.type], list = [];
    if (!def || !def.input) return null;
    ['required', 'optional'].forEach(function (sec) {
      var m = def.input[sec] || {};
      var order = (def.input_order && Array.isArray(def.input_order[sec])) ? def.input_order[sec] : Object.keys(m);
      order.forEach(function (k) {
        var spec = m[k];
        if (!Array.isArray(spec)) return;
        var t = spec[0], o = (spec[1] && typeof spec[1] === 'object') ? spec[1] : {};
        var combo = Array.isArray(t) || t === 'COMBO';
        if (!(combo || /^(INT|FLOAT|STRING|BOOLEAN)$/.test(String(t))) || o.forceInput) return;
        list.push({ name: k, values: Array.isArray(t) ? t : (Array.isArray(o.options) ? o.options : null) });
        if (o.control_after_generate || (t === 'INT' && /^(seed|noise_seed)$/.test(k))) {
          list.push({ name: 'control after generate', values: ['fixed', 'increment', 'decrement', 'randomize'] });
        }
        if (o.image_upload || o.video_upload || o.audio_upload) list.push({ name: 'upload', skip: true });
      });
    });
    return list.length === len ? list : null;
  }

  function tedFields(n) {
    var wv = n && n.widgets_values, out = [];
    if (wv && typeof wv === 'object' && !Array.isArray(wv)) {
      Object.keys(wv).forEach(function (k) { out.push({ k: k, name: k, val: wv[k], opts: null }); });
      return out;
    }
    if (!Array.isArray(wv)) return out;
    var meta = tedWidgetMeta(n, wv.length);
    /* else the node's own inputs name the values that have a socket, when there is one for each */
    if (!meta) {
      var named = (n.inputs || []).filter(function (i) { return i && i.widget && i.widget.name; });
      if (named.length === wv.length) meta = named.map(function (i) { return { name: String(i.widget.name), skip: /UPLOAD$/.test(String(i.type || '')) }; });
      else if (named.length === 1 && wv[0] && typeof wv[0] === 'object') meta = [{ name: String(named[0].widget.name) }];
    }
    wv.forEach(function (v, i) {
      var m = meta && meta[i];
      out.push({ k: i, name: (m && m.name) || '', val: v, opts: (m && m.values) || null, skip: !!(m && m.skip) || v === null || v === undefined });
    });
    /* a box (a crop's region) is kept whole and then once more number by number: those numbers take the names
       they have in the box, and the two stay the same when either is changed */
    out.forEach(function (f, i) {
      if (!f.val || typeof f.val !== 'object' || Array.isArray(f.val)) return;
      Object.keys(f.val).forEach(function (key, j) {
        var g = out[i + 1 + j];
        if (!g || g.name || g.val !== f.val[key]) return;
        g.name = key;
        g.box = { k: f.k, key: key };
      });
    });
    out.forEach(function (f, i) { if (!f.name) f.name = 'value ' + (i + 1); });
    return out;
  }

  function tedFieldRow(f, i) {
    if (f.skip) return '';
    var v = f.val, at = 'data-ted-f="' + i + '"', ctl = '';
    if (typeof v === 'boolean') {
      ctl = '<label class="shb-ted-chk"><input type="checkbox" ' + at + (v ? ' checked' : '') + '><span>' + (v ? 'on' : 'off') + '</span></label>';
    } else if (typeof v === 'number') {
      ctl = '<input type="number" step="any" class="shb-input" ' + at + ' value="' + esc(v) + '">';
    } else if (typeof v === 'string' && f.opts && f.opts.length && f.opts.length <= 600 && f.opts.every(function (o) { return typeof o === 'string'; })) {
      var opts = f.opts.indexOf(v) < 0 ? [v].concat(f.opts) : f.opts;
      ctl = '<select class="shb-select" ' + at + '>' + opts.map(function (o) { return '<option value="' + esc(o) + '"' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    } else if (typeof v === 'string') {
      ctl = (v.length > 60 || v.indexOf('\n') >= 0)
        ? '<textarea class="shb-input shb-ted-ta" spellcheck="false" ' + at + '>' + esc(v) + '</textarea>'
        : '<input type="text" class="shb-input" spellcheck="false" ' + at + ' value="' + esc(v) + '">';
    } else {
      ctl = '<textarea class="shb-input shb-ted-ta shb-ted-mono" spellcheck="false" data-ted-json ' + at + '>' + esc(JSON.stringify(v, null, 2)) + '</textarea>';
    }
    return '<div class="shb-ted-row"><label title="' + esc(f.name) + '">' + esc(f.name) + '</label>' + ctl + '</div>';
  }

  function tedFieldsHTML(n, many) {
    if (!n) return '<div class="shb-sb-empty">This button holds no nodes.</div>';
    var rows = tedFields(n).map(tedFieldRow).join('');
    var mode = +n.mode || 0;
    return '<div class="shb-ted-row"><label>Title</label><input type="text" class="shb-input" spellcheck="false" data-ted-title value="' + esc(n.title || '') + '" placeholder="' + esc(tedNodeName({ type: n.type })) + '"></div>' +
      '<div class="shb-ted-row"><label>Runs</label><select class="shb-select" data-ted-mode>' +
        [[0, 'Normally'], [2, 'Muted'], [4, 'Bypassed']].map(function (m) { return '<option value="' + m[0] + '"' + (mode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') +
      '</select></div>' +
      (rows ? '<div class="shb-ted-sec">Values</div>' + rows : '<div class="shb-ted-sec">Values</div><div class="shb-sb-empty">This node keeps no values of its own, only wires.</div>') +
      (many ? '<div class="shb-ted-rm"><button type="button" class="shb-btn" data-ted-act="rmnode" data-tip="The node leaves the button, and so do the wires that reached it">' + ico('trash', 13) + '<span>Take this node out of the button</span></button></div>' : '');
  }

  function tedJsonHTML(n) {
    var T = TED;
    if (!T.rawDirty) T.rawText = JSON.stringify(T.whole ? T.work : n, null, 2);
    return '<div class="shb-ted-jbar"><span class="shb-seg">' +
        '<button type="button" data-ted-whole="0"' + (T.whole ? '' : ' class="shb-on"') + '>This node</button>' +
        '<button type="button" data-ted-whole="1"' + (T.whole ? ' class="shb-on"' : '') + '>The whole button</button>' +
      '</span><small>What the button keeps, as ComfyUI copies it. It is checked before it is kept.</small></div>' +
      '<textarea class="shb-input shb-ted-raw shb-ted-mono" spellcheck="false" data-ted-raw>' + esc(T.rawText) + '</textarea>';
  }

  function tplEditOpen(id) {
    var tpl = tplById(id);
    if (!tpl || !tpl.data) return;
    if (tpl.lib && !tpl.canDelete) { setStatus('error', '"' + tpl.name + '" is in a read-only library'); return; }
    tedClose();
    var bg = owns(document.createElement('div'));
    bg.className = 'shb-modal-bg';
    bg.innerHTML = '<div class="shb-modal shb-ted"></div>';
    document.body.appendChild(bg);
    TED = { el: bg, tpl: tpl, work: JSON.parse(JSON.stringify(tpl.data)), sel: 0, tab: 'fields', whole: false, dirty: false, rawDirty: false, rawText: '', err: '', armed: 0 };
    TED.shut = modalOpen(function () { tedAskClose(); });
    bg.addEventListener('mousedown', function (ev) { if (ev.target === bg) tedAskClose(); });
    bg.addEventListener('click', tedClick);
    bg.addEventListener('input', tedInput);
    bg.addEventListener('change', tedInput);
    bg.addEventListener('keydown', function (ev) {
      if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName || '')) ev.stopPropagation();
    });
    tedRender();
  }

  function tedClose() {
    var bg = TED.el;
    if (!bg) return;
    modalShut(TED.shut);
    TED = { el: null };
    tipHide();
    if (bg.parentNode) bg.parentNode.removeChild(bg);
  }

  /* closing with changes that were not saved takes a second go */
  function tedAskClose() {
    if (!TED.el) return;
    if (TED.dirty && Date.now() - TED.armed > 4000) {
      TED.armed = Date.now();
      tedErr('Not saved yet · close again to leave it as it was');
      return;
    }
    tedClose();
  }

  function tedErr(text) {
    TED.err = text || '';
    var e = TED.el && TED.el.querySelector('[data-ted-err]');
    if (e) e.textContent = TED.err;
  }

  function tedMark() {
    var T = TED;
    T.dirty = true;
    T.armed = 0;
    if (!T.el) return;
    var sv = T.el.querySelector('[data-ted-act="save"]'), note = T.el.querySelector('[data-ted-note]');
    if (sv) sv.disabled = false;
    if (note) note.textContent = tedNote();
  }

  function tedNote() {
    var n = ((TED.work && TED.work.nodes) || []).length;
    return n + (n === 1 ? ' node' : ' nodes') + (TED.dirty ? ' · changed, not saved yet' : '');
  }

  function tedRender() {
    var T = TED, box = T.el && T.el.querySelector('.shb-ted');
    if (!box) return;
    var nodes = (T.work && Array.isArray(T.work.nodes)) ? T.work.nodes : [];
    if (T.sel >= nodes.length) T.sel = Math.max(0, nodes.length - 1);
    var n = nodes[T.sel];
    var nSel = mgItems(null).filter(isGraphNode).length;
    var hist = (!T.tpl.lib && Array.isArray(T.tpl.history)) ? T.tpl.history : [];
    tipHide();
    box.innerHTML =
      '<div class="shb-modal-t">' +
        '<span class="shb-brw-title"><span class="shb-tpl-ico">' + ico('sparkles', 16) + '</span><span>' + esc(hbBtnName('tpl:' + T.tpl.id, T.tpl.name)) + '</span>' +
          '<small data-ted-note>' + esc(tedNote()) + '</small></span>' +
        '<span class="shb-brw-tools">' +
          (hist.length ? '<select class="shb-select shb-ted-hist" data-ted-hist data-tip="What this button held before. Pick one and it comes into the editor; it is kept once you save">' +
            '<option value="">Versions…</option>' + hist.map(function (h, i) {
              return '<option value="' + i + '">' + esc(tedWhen(h.at) + ' · ' + h.count + (h.count === 1 ? ' node' : ' nodes')) + '</option>';
            }).join('') + '</select>' : '') +
          '<button type="button" class="shb-btn shb-btn-pri' + (nSel ? '' : ' shb-na') + '" data-ted-act="take" data-tip="' + (nSel ? 'The ' + nSel + ' selected ' + (nSel === 1 ? 'node comes' : 'nodes come') + ' into the editor instead of these. Save keeps them in this button'
            : 'Select nodes on the canvas first: they come into the editor instead of these') + '">' + ico('sync', 13) + '<span>Use selection' + (nSel ? ' (' + nSel + ')' : '') + '</span></button>' +
          '<button type="button" class="shb-btn shb-btn-pri" data-ted-act="canvas" data-tip="Adds these nodes to the canvas, to change them there with ComfyUI itself. Then select them, right-click the button and choose Use selection">' + ico('plus', 13) + '<span>Put on canvas</span></button>' +
        '</span>' +
      '</div>' +
      '<div class="shb-ted-main">' +
        '<div class="shb-ted-list">' + nodes.map(function (m, i) {
          return '<button type="button" class="shb-ted-n' + (i === T.sel ? ' shb-on' : '') + '" data-ted-sel="' + i + '"><b>' + esc(tedNodeName(m)) + '</b><small>' + esc(m.type) + '</small></button>';
        }).join('') + '</div>' +
        '<div class="shb-ted-pane">' + (T.tab === 'json' ? tedJsonHTML(n) : tedFieldsHTML(n, nodes.length > 1)) + '</div>' +
      '</div>' +
      '<div class="shb-ted-foot">' +
        '<span class="shb-seg">' +
          '<button type="button" data-ted-tab="fields"' + (T.tab === 'fields' ? ' class="shb-on"' : '') + '>Values</button>' +
          '<button type="button" data-ted-tab="json"' + (T.tab === 'json' ? ' class="shb-on"' : '') + '>JSON</button>' +
        '</span>' +
        '<span class="shb-ted-err" data-ted-err>' + esc(T.err) + '</span>' +
        '<span style="flex:1"></span>' +
        '<button type="button" class="shb-btn" data-ted-act="cancel">Cancel</button>' +
        '<button type="button" class="shb-btn shb-btn-on" data-ted-act="save"' + (T.dirty ? '' : ' disabled') + '>' + ico('save', 13) + '<span>Save to this button</span></button>' +
      '</div>';
  }

  /* The JSON as typed goes into the work copy: checked first, and refused (with the reason) when it cannot be a
     button. One node keeps its id, since the wires hang on it */
  function tedApplyRaw() {
    var T = TED;
    if (!T.rawDirty) return true;
    var obj = null;
    try { obj = JSON.parse(T.rawText); } catch (e) { tedErr('That JSON does not read: ' + msgOf(e)); return false; }
    if (T.whole) {
      if (!obj || typeof obj !== 'object' || !Array.isArray(obj.nodes) || !obj.nodes.length) { tedErr('A button needs "nodes": a list with at least one node'); return false; }
      if (!obj.nodes.every(function (m) { return m && typeof m === 'object' && m.type; })) { tedErr('Every node needs its "type"'); return false; }
      T.work = obj;
    } else {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !obj.type) { tedErr('A node needs its "type"'); return false; }
      obj.id = T.work.nodes[T.sel].id;
      T.work.nodes[T.sel] = obj;
    }
    T.rawDirty = false;
    tedErr('');
    return true;
  }

  /* A node leaves the button, and with it the wires that reached it */
  function tedDropNode(data, idx) {
    var n = data.nodes[idx], gone = {};
    if (!n) return;
    data.links = (data.links || []).filter(function (l) {
      var arr = Array.isArray(l);
      var id = arr ? l[0] : l.id, a = arr ? l[1] : l.origin_id, b = arr ? l[3] : l.target_id;
      if (a !== n.id && b !== n.id) return true;
      gone[id] = 1;
      return false;
    });
    data.nodes.splice(idx, 1);
    data.nodes.forEach(function (m) {
      (m.inputs || []).forEach(function (i) { if (i && i.link != null && gone[i.link]) i.link = null; });
      (m.outputs || []).forEach(function (o) {
        if (o && Array.isArray(o.links)) o.links = o.links.filter(function (id) { return !gone[id]; });
      });
    });
  }

  function tedInput(ev) {
    var T = TED, t = ev.target;
    if (!T.el || !t || !t.hasAttribute) return;
    if (t.hasAttribute('data-ted-hist')) {
      var h = (T.tpl.history || [])[t.value === '' ? -1 : +t.value];
      if (ev.type !== 'change' || !h) return;
      T.work = JSON.parse(JSON.stringify(h.data));
      T.sel = 0;
      T.rawDirty = false;
      tedMark();
      tedErr('');
      tedRender();
      setStatus('ok', 'The version of ' + tedWhen(h.at) + ' is in the editor · Save to this button brings it back');
      return;
    }
    if (t.hasAttribute('data-ted-raw')) {
      T.rawText = t.value;
      T.rawDirty = true;
      tedMark();
      return;
    }
    var n = T.work && T.work.nodes && T.work.nodes[T.sel];
    if (!n) return;
    if (t.hasAttribute('data-ted-title')) {
      if (String(t.value).trim()) n.title = t.value;
      else delete n.title;
      var row = T.el.querySelector('[data-ted-sel="' + T.sel + '"] b');
      if (row) row.textContent = tedNodeName(n);
      tedMark();
      return;
    }
    if (t.hasAttribute('data-ted-mode')) {
      n.mode = +t.value || 0;
      tedMark();
      return;
    }
    if (!t.hasAttribute('data-ted-f')) return;
    var all = tedFields(n), f = all[+t.getAttribute('data-ted-f')];
    if (!f) return;
    function show(k, text) {
      for (var i = 0; i < all.length; i++) {
        var el = all[i].k === k ? T.el.querySelector('[data-ted-f="' + i + '"]') : null;
        if (el && el !== t) el.value = text;
      }
    }
    var v;
    if (typeof f.val === 'boolean') {
      v = !!t.checked;
      if (t.nextElementSibling) t.nextElementSibling.textContent = v ? 'on' : 'off';
    } else if (typeof f.val === 'number') {
      v = parseFloat(t.value);
      if (isNaN(v)) return;
    } else if (t.hasAttribute('data-ted-json')) {
      try { v = JSON.parse(t.value); } catch (e) { tedErr(f.name + ': that JSON does not read yet'); return; }
      tedErr('');
    } else v = t.value;
    n.widgets_values[f.k] = v;
    /* a number that is also kept inside a box goes into the box too; a box typed whole hands its numbers on */
    var box = f.box ? n.widgets_values[f.box.k] : null;
    if (box && typeof box === 'object') {
      box[f.box.key] = v;
      show(f.box.k, JSON.stringify(box, null, 2));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      all.forEach(function (g) {
        if (!g.box || g.box.k !== f.k || v[g.box.key] === undefined) return;
        n.widgets_values[g.k] = v[g.box.key];
        show(g.k, String(v[g.box.key]));
      });
    }
    tedMark();
  }

  function tedClick(ev) {
    var T = TED, t = ev.target;
    if (!T.el || !t || !t.closest) return;
    var selB = t.closest('[data-ted-sel]'), tabB = t.closest('[data-ted-tab]'), whB = t.closest('[data-ted-whole]'), actB = t.closest('[data-ted-act]');
    if (selB || tabB || whB) {
      if (!tedApplyRaw()) return;
      if (selB) T.sel = +selB.getAttribute('data-ted-sel') || 0;
      if (tabB) T.tab = tabB.getAttribute('data-ted-tab') === 'json' ? 'json' : 'fields';
      if (whB) T.whole = whB.getAttribute('data-ted-whole') === '1';
      tedRender();
      return;
    }
    if (!actB) return;
    var a = actB.getAttribute('data-ted-act');
    if (a === 'cancel') { tedClose(); return; }
    if (a === 'rmnode') {
      if (!tedApplyRaw() || T.work.nodes.length < 2) return;
      tedDropNode(T.work, T.sel);
      tedMark();
      tedRender();
      return;
    }
    if (a === 'take') {
      var items = mgItems(null), data = null;
      if (!items.filter(isGraphNode).length) { setStatus('error', 'Select the nodes on the canvas first'); return; }
      try { data = mgSerialize(items); } catch (e) { data = null; }
      if (!data || !data.nodes || !data.nodes.length) { setStatus('error', 'Could not read those nodes'); return; }
      T.work = data;
      T.sel = 0;
      T.rawDirty = false;
      tedMark();
      tedErr('');
      tedRender();
      setStatus('ok', 'The ' + data.nodes.length + ' selected ' + (data.nodes.length === 1 ? 'node is' : 'nodes are') + ' in the editor · Save to this button keeps them');
      return;
    }
    if (a === 'canvas') {
      if (!tedApplyRaw()) return;
      var like = { name: T.tpl.name, data: T.work };
      tedClose();
      brwClose();
      var st = document.getElementById(PANEL_ID + '-settings');
      if (st && st.parentNode) st.parentNode.removeChild(st);
      if (HB.el) hbClose();
      var cv = getCanvas(), cr = cv && cv.canvas ? cv.canvas.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth || 1600, height: window.innerHeight || 900 };
      var at = { x: Math.round(cr.left + cr.width * 0.38), y: Math.round(cr.top + cr.height * 0.3) };
      tplRun(like, at, at);
      setTimeout(function () {
        setStatus('ok', 'The nodes of "' + like.name + '" are on the canvas · change them, select them, then right-click the button → Use selection');
      }, 1200);
      return;
    }
    if (a === 'save') {
      if (!tedApplyRaw()) return;
      if (!T.work || !Array.isArray(T.work.nodes) || !T.work.nodes.length) { tedErr('A button needs at least one node'); return; }
      var tpl = T.tpl, work = T.work;
      tplSetData(tpl, work, 'changing the nodes of "' + tpl.name + '"').then(function (ok) {
        if (!ok) return;
        tedClose();
        setStatus('ok', '✓ Saved into "' + tpl.name + '" · the same button, in the same place' + (tpl.lib ? '' : ' · what it held before is in its Versions'));
      });
    }
  }

  /* ---------------------------------------------------------------------
   * 14d. SHARING BUTTONS FROM A PAGE (window.__hotbox.shareable / pack / addPack, see docs/REFERENCE.md): a
   * page picks groups and saved buttons, packs them as plain JSON, and another Hotbox adds the pack to what it
   * has, as its next version. Hotbox knows nothing of who carries the pack, or how
   * --------------------------------------------------------------------- */
  var HB_VERSION = '1.2.9';

  function hbShareable() {
    function colorOf(uid) { return (S.customColors && S.customColors[uid]) || ''; }
    function btn(t) {
      var uid = 'tpl:' + t.id;
      return { id: t.id, name: hbBtnName(uid, t.name), count: t.count, at: t.at, lib: t.lib ? (t.libLabel || t.lib) : '', color: colorOf(uid) };
    }
    return {
      groups: Object.keys(S.hbGroups && typeof S.hbGroups === 'object' ? S.hbGroups : {}).map(function (id) {
        var g = S.hbGroups[id] || {}, uid = 'grp:' + id;
        return { id: id, name: hbBtnName(uid, g.name), count: (g.items || []).length, color: colorOf(uid),
          items: (g.items || []).map(function (u) { return { uid: u, label: hbUidLabel(u) }; }) };
      }),
      buttons: (Array.isArray(S.templates) ? S.templates : []).map(btn).concat(libSharedButtons().map(btn))
    };
  }

  function hbPack(uids) {
    var pack = { hotbox_pack: 1, hotbox: HB_VERSION, groups: [], templates: [], labels: {}, colors: {}, fill: {}, keys: {} };
    var done = {};
    function meta(from, to, named) {
      if (!named && S.customLabels && S.customLabels[from]) pack.labels[to] = S.customLabels[from];
      if (S.customColors && S.customColors[from]) pack.colors[to] = S.customColors[from];
      if (S.customFill && S.customFill[from]) pack.fill[to] = true;
      if (S.customKeys && S.customKeys[from]) pack.keys[to] = S.customKeys[from];
    }
    /* a saved button travels with its nodes; one from a shared library becomes a button of one's own, since
       whoever gets it may not have that library */
    function tpl(uid) {
      var t = tplById(String(uid).slice(4));
      if (!t || !t.data) return '';
      var id = t.lib ? t.rawId : t.id, to = 'tpl:' + id;
      if (!done[to]) {
        done[to] = 1;
        pack.templates.push({ id: id, name: hbBtnName(uid, t.name), count: t.count, at: t.at, data: JSON.parse(JSON.stringify(t.data)) });
        meta(uid, to, true);
      }
      return to;
    }
    (Array.isArray(uids) ? uids : [uids]).forEach(function (u) {
      u = String(u || '');
      if (/^tpl:/.test(u)) { tpl(u); return; }
      var g = /^grp:/.test(u) ? grpById(u.slice(4)) : null;
      if (!g || done[u]) return;
      done[u] = 1;
      var items = [];
      (g.items || []).forEach(function (k) {
        if (/^grp:/.test(k)) return;
        var to = /^tpl:/.test(k) ? tpl(k) : k;
        if (!to || items.indexOf(to) >= 0) return;
        /* tools, nodes and models travel by name: every Hotbox has them */
        if (!/^tpl:/.test(k)) meta(k, k, false);
        items.push(to);
      });
      pack.groups.push({ id: u.slice(4), name: hbBtnName(u, g.name), items: items });
      meta(u, u, true);
    });
    return pack;
  }

  function hbAddPack(pack, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (!pack || typeof pack !== 'object' || !pack.hotbox_pack) { reject(new Error('this is not a Hotbox pack')); return; }
      var tpls = (Array.isArray(pack.templates) ? pack.templates : []).filter(function (t) {
        return t && t.id && t.data && Array.isArray(t.data.nodes) && t.data.nodes.length;
      });
      var grps = (Array.isArray(pack.groups) ? pack.groups : []).filter(function (g) { return g && g.id && Array.isArray(g.items); });
      if (!tpls.length && !grps.length) { reject(new Error('the pack holds no buttons and no groups')); return; }
      if (!CFG.ready || CFG.hostWait) {
        reject(new Error(CFG.hostWait || 'the Hotbox files cannot be reached yet'));
        return;
      }
      var before = JSON.stringify(S), prevFile = CFG.file, prevOrigin = CFG.origin;
      var next = '', added = { groups: 0, buttons: 0 }, replaced = { groups: 0, buttons: 0 }, label = '';
      /* whatever is pending goes to the file in use first: that file stays as it was before the pack */
      var flush = (CFG.timer || CFG.state === 'error') ? cfgWrite() : Promise.resolve();
      flush.then(function () {
        if (CFG.state === 'error') throw new Error('could not write ' + prevFile + ' (' + CFG.err + ')');
        var inGroup = {}, toBar = [];
        grps.forEach(function (g) { g.items.forEach(function (u) { inGroup[String(u)] = 1; }); });
        if (!Array.isArray(S.templates)) S.templates = [];
        tpls.forEach(function (t) {
          var fresh = { id: String(t.id), name: String(t.name || 'Button'), count: t.data.nodes.length, at: t.at || new Date().toISOString(),
            data: JSON.parse(JSON.stringify(t.data)) };
          var uid = 'tpl:' + fresh.id, at = -1;
          S.templates.forEach(function (x, i) { if (x && x.id === fresh.id) at = i; });
          if (at >= 0) {
            /* the same button sent again, changed: it takes the place of the one that was there, which stays
               behind it as a version */
            var old = S.templates[at];
            fresh.history = [{ at: old.edited || old.at, count: old.count, data: old.data }].concat(Array.isArray(old.history) ? old.history : []).slice(0, 5);
            fresh.edited = new Date().toISOString();
            S.templates[at] = fresh;
            replaced.buttons++;
          } else {
            S.templates.push(fresh);
            added.buttons++;
            if (!inGroup[uid]) toBar.push(uid);
          }
        });
        if (!S.hbGroups || typeof S.hbGroups !== 'object') S.hbGroups = {};
        grps.forEach(function (g) {
          var gid = String(g.id);
          var items = g.items.map(String).filter(function (u, i, all) {
            return all.indexOf(u) === i && !/^grp:/.test(u) && (!/^tpl:/.test(u) || tplById(u.slice(4)));
          });
          if (S.hbGroups[gid]) {
            S.hbGroups[gid].name = String(g.name || S.hbGroups[gid].name);
            S.hbGroups[gid].items = items;
            replaced.groups++;
          } else {
            S.hbGroups[gid] = { name: String(g.name || 'Group'), items: items, keep: true };
            added.groups++;
            toBar.push('grp:' + gid);
          }
        });
        /* new ones go to the end of the bottom bar. A bar that was never customized lists every saved button by
           itself, but not a group: it gets its own list now, so the group shows */
        if (toBar.length && !Array.isArray(S.customBotBar) && toBar.some(function (u) { return /^grp:/.test(u); })) {
          S.customBotBar = defaultBarUids('bot', null);
        }
        if (Array.isArray(S.customBotBar)) toBar.forEach(function (u) { if (S.customBotBar.indexOf(u) < 0) S.customBotBar.push(u); });
        /* names, colors and keys: a saved button's and a group's come with it; for a tool or a node, the ones
           you gave it yourself stay */
        [['labels', 'customLabels'], ['colors', 'customColors'], ['fill', 'customFill'], ['keys', 'customKeys']].forEach(function (p) {
          var src = pack[p[0]];
          if (!src || typeof src !== 'object') return;
          if (!S[p[1]] || typeof S[p[1]] !== 'object') S[p[1]] = {};
          Object.keys(src).forEach(function (uid) {
            var own = /^(tpl|grp):/.test(uid);
            if (own && p[0] === 'labels') return;
            if (!own && S[p[1]][uid] !== undefined) return;
            if (p[0] === 'keys' && Object.keys(S.customKeys).some(function (u) { return u !== uid && S.customKeys[u] === src[uid]; })) return;
            S[p[1]][uid] = src[uid];
          });
        });
        var loose = tpls.filter(function (t) { return !inGroup['tpl:' + t.id]; });
        var count = grps.length + loose.length;
        label = String((grps[0] && grps[0].name) || (loose[0] && loose[0].name) || tpls[0].name || 'Buttons') + (count > 1 ? ' +' + (count - 1) : '');
        next = cfgNewVersionName();
        CFG.origin = 'browser';
        CFG.file = next;
        cfgApplied();
        return cfgWrite();
      }).then(function () {
        if (CFG.state === 'error') throw new Error('could not write ' + next + ' (' + CFG.err + ')');
        return cfgPut('active.json', { file: next });
      }).then(function () {
        return cfgListVersions();
      }).then(function () {
        setStatus('ok', '✓ ' + label + (opts.from ? ' from ' + opts.from : '') + ' · now ' + cfgVerLabel(next));
        resolve({ file: next, version: cfgVerLabel(next), added: added, replaced: replaced });
      }).catch(function (err) {
        /* nothing stays half done: back to the preferences, and the file, that were in use */
        try { applyConfig(JSON.parse(before)); } catch (e) {}
        CFG.file = prevFile;
        CFG.origin = prevOrigin;
        cfgApplied();
        reject(err instanceof Error ? err : new Error(msgOf(err)));
      });
    });
  }

  /* ---------------------------------------------------------------------
   * 15. TOPBAR LOGO BUTTON (NEXT TO IMISSNUKE) & SETTINGS MODAL
   * --------------------------------------------------------------------- */
  function comboLabel(key, code, mods) {
    var c = String(code || ''), k = String(key || '');
    var base = c === 'Backquote' ? '`'
      : /^Key[A-Z]$/.test(c) ? c.slice(3)
      : /^Digit\d$/.test(c) ? c.slice(5)
      : (k === ' ') ? 'Space'
      : (k && k.length === 1) ? k.toUpperCase()
      : k || c || '`';
    var m = String(mods || '');
    return (m.indexOf('ctrl+') >= 0 ? 'Ctrl+' : '')
      + (m.indexOf('alt+') >= 0 ? 'Alt+' : '')
      + (m.indexOf('shift+') >= 0 ? 'Shift+' : '')
      + (m.indexOf('meta+') >= 0 ? 'Cmd+' : '') + base;
  }

  function hbKeyLabel() {
    return comboLabel(S.hbKey, S.hbCode, S.hbMods);
  }

  /* The Hotbox mark (assets/brand): the H with its scattered nodes, on a 32-unit grid */
  var HB_MARK = '<rect x="11.5" y="10.5" width="3" height="11" rx="1"/><rect x="17.5" y="10.5" width="3" height="11" rx="1"/><rect x="11.5" y="14.7" width="9" height="2.6"/>' +
    '<rect x="5.5" y="3.9" width="4.8" height="3.2" rx="1.2"/><rect x="20.8" y="3.5" width="2.6" height="2.6" rx="0.8"/><rect x="13.7" y="7.1" width="1.4" height="1.4" rx="0.45"/>' +
    '<rect x="22.2" y="9.2" width="1.2" height="1.2" rx="0.4"/><rect x="27.4" y="8.3" width="1.8" height="1.8" rx="0.55"/><rect x="2.8" y="10.5" width="1.6" height="1.6" rx="0.5"/>' +
    '<rect x="6.3" y="15.8" width="1.6" height="1.6" rx="0.5"/><rect x="26.8" y="12.7" width="3.2" height="4.8" rx="1.2"/><rect x="25.2" y="19" width="2.8" height="2.8" rx="0.85"/>' +
    '<rect x="28.2" y="22.8" width="1.6" height="1.6" rx="0.5"/><rect x="1.7" y="22.5" width="3" height="3" rx="0.9"/><rect x="10.5" y="23.9" width="1.4" height="1.4" rx="0.45"/>' +
    '<rect x="15.05" y="25.1" width="4.5" height="3" rx="1.1"/><rect x="11.5" y="27.9" width="1.8" height="1.8" rx="0.55"/><rect x="22.7" y="24.1" width="1.2" height="1.2" rx="0.4"/>';

  /* Logo colors: Alt Comfy from the brand kit, yellow on plum */
  var HB_LOGO = { bg: '#211927', edge: '', fg: '#F2FF59' };

  /* The bare mark in currentColor (the top-bar button paints the chip around it) */
  function hbMarkSVG(size) {
    return '<svg viewBox="0 0 32 32" width="' + size + '" height="' + size + '" fill="currentColor" aria-hidden="true">' + HB_MARK + '</svg>';
  }

  /* The full chip, as in assets/brand/svg/hotbox-*-chip.svg */
  function hbLogoChip(size) {
    var L = HB_LOGO;
    return '<svg viewBox="0 0 32 32" width="' + size + '" height="' + size + '" aria-hidden="true" style="display:block;flex:none">' +
      '<rect x="1" y="1" width="30" height="30" rx="6" fill="' + L.bg + '"' + (L.edge ? ' stroke="' + L.edge + '" stroke-width="2"' : '') + '/>' +
      '<g fill="' + L.fg + '" transform="translate(3.52 3.52) scale(0.78)">' + HB_MARK + '</g></svg>';
  }

  var TOPBAR_SELECTORS = '.comfyui-menu, .comfyui-body-top, .comfyui-top-menu, .comfy-menu, .comfyui-body-bottom';
  var TOPBAR_OBSERVER_MOUNTED = false;

  function isElemVisible(el) {
    return !!(el && el.getClientRects && el.getClientRects().length > 0);
  }

  function firstPillInBar(bar) {
    if (!bar || !isElemVisible(bar)) return null;
    var groups = bar.querySelectorAll('.comfyui-button-group');
    for (var i = 0; i < groups.length; i++) {
      if (isElemVisible(groups[i])) return groups[i];
    }
    return null;
  }

  /* Is the button still where it was put? Asked on every change to the page, so it measures nothing (a size
     read would force a layout each time): the button just has to sit beside ImissNuke's [N], or in the element
     it was put in. Newer frontends keep the bar's buttons in an action bar that none of the old menu classes
     name, so the check is by the element itself, not by class: by class, the button looked misplaced there,
     was put back, and putting it back was a change to the page, five times a second for good */
  var TOPBAR_HOME = null;
  function isTopBarBtnProperlyMounted(btn) {
    if (!btn || !btn.isConnected || !btn.parentNode) return false;
    var imissBtn = document.getElementById('imissnuke-topbar-btn');
    if (imissBtn && imissBtn.isConnected && imissBtn.parentNode) return btn.previousElementSibling === imissBtn;
    return btn.parentNode === TOPBAR_HOME && !btn.classList.contains('shb-floating-fallback');
  }

  function updateTopBarButtonState() {
    var btn = document.getElementById(PANEL_ID + '-topbar-btn');
    if (!btn) return;
    var isEnabled = !!S.useHotbox;
    btn.classList.toggle('tool-on', isEnabled);
    btn.title = 'Hotbox (' + (isEnabled ? 'Enabled · ' + hbKeyLabel() : 'Disabled') + ') - Settings (Right-click to toggle)';
    hbFitTopBarButton(btn);
  }

  /* The button is as tall as the bar's own buttons beside it (Run, the queue, the panel toggles), whatever the
     frontend version or theme: the most common height in its row, the icon a little smaller */
  function hbFitTopBarButton(btn) {
    if (!btn || !isElemVisible(btn) || btn.classList.contains('shb-floating-fallback')) return;
    var me = btn.getBoundingClientRect(), mid = me.top + me.height / 2, count = {}, best = 0, n = 0;
    /* only the bar's own buttons: the whole page would measure every button on every node too */
    var scope = btn.closest('.actionbar-container, .comfyui-menu, .comfy-menu, .comfyui-top-menu, header, nav')
      || (btn.parentNode && btn.parentNode.parentNode) || document;
    Array.prototype.forEach.call(scope.querySelectorAll('button, .comfyui-button'), function (b) {
      if (b === btn || b.id === 'imissnuke-topbar-btn' || !isElemVisible(b)) return;
      var r = b.getBoundingClientRect();
      if (Math.abs(r.top + r.height / 2 - mid) > 14 || r.width < 20 || r.height < 22 || r.height > 56) return;
      var h = Math.round(r.height);
      count[h] = (count[h] || 0) + 1;
    });
    Object.keys(count).forEach(function (h) { if (count[h] > n || (count[h] === n && +h > best)) { best = +h; n = count[h]; } });
    if (!best || btn._hbH === best) return;
    btn._hbH = best;
    btn.style.setProperty('height', best + 'px', 'important');
    btn.style.setProperty('min-width', best + 'px', 'important');
    btn.style.setProperty('width', best + 'px', 'important');
    btn.style.setProperty('padding', '0', 'important');
    var svg = btn.querySelector('.shb-h-icon svg'), ic = Math.max(18, best - 8);
    if (svg) { svg.style.width = ic + 'px'; svg.style.height = ic + 'px'; }
  }

  var TOPBAR_BTN = null;
  function mountTopBarButton() {
    var oldPill = document.getElementById(PANEL_ID + '-pill');
    if (oldPill && oldPill.parentNode) oldPill.parentNode.removeChild(oldPill);

    /* Keep exactly one button: the top bar can be re-rendered (or detached for a moment), so the
       element is kept by reference and any stray copy is removed instead of minting a new one */
    var btn = TOPBAR_BTN;
    Array.prototype.forEach.call(document.querySelectorAll('#' + PANEL_ID + '-topbar-btn'), function (b) {
      if (!btn) btn = b;
      else if (b !== btn && b.parentNode) b.parentNode.removeChild(b);
    });
    if (!btn) {
      btn = owns(document.createElement('button'));
      btn.id = PANEL_ID + '-topbar-btn';
      btn.type = 'button';
      btn.className = 'comfyui-button comfyui-menu-mobile-collapse shb-topbar-btn';
      btn.setAttribute('aria-label', 'Hotbox Settings');
      btn.innerHTML = '<span class="shb-h-icon">' + hbMarkSVG(24) + '</span>';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var existing = document.getElementById(PANEL_ID + '-settings');
        if (existing && existing.parentNode) {
          HB.binding = false;
          existing.parentNode.removeChild(existing);
          btn.classList.remove('open');
          return;
        }
        openSettingsModal(btn);
      });
      btn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        S.useHotbox = !S.useHotbox;
        save();
        updateTopBarButtonState();
        if (openSettingsModal._rerender) openSettingsModal._rerender();
        setStatus('ok', 'Hotbox ' + (S.useHotbox ? 'Enabled (' + hbKeyLabel() + ')' : 'Disabled'));
      });
    }
    TOPBAR_BTN = btn;

    if (isTopBarBtnProperlyMounted(btn)) {
      var imissNow = document.getElementById('imissnuke-topbar-btn');
      if (imissNow) {
        btn.classList.toggle('in-grouped', imissNow.classList.contains('in-grouped'));
      }
      return true;
    }
    var placed = hbPlaceTopBarButton(btn);
    TOPBAR_HOME = placed ? btn.parentNode : null;
    updateTopBarButtonState();
    return placed;
  }

  function hbPlaceTopBarButton(btn) {

    /* 1. Highest priority: Dock directly beside ImissNuke's [N] button in ComfyUI top bar */
    var imissBtn = document.getElementById('imissnuke-topbar-btn');
    if (imissBtn && imissBtn.parentNode && document.body.contains(imissBtn)) {
      if (imissBtn.nextElementSibling !== btn) {
        imissBtn.insertAdjacentElement('afterend', btn);
      }
      btn.classList.toggle('in-grouped', imissBtn.classList.contains('in-grouped'));
      btn.classList.remove('shb-floating-fallback');
      return true;
    }

    /* 2. Next priority: First button pill in the ComfyUI top bar */
    var bars = document.querySelectorAll(TOPBAR_SELECTORS);
    for (var b = 0; b < bars.length; b++) {
      var pill = firstPillInBar(bars[b]);
      if (pill) {
        pill.appendChild(btn);
        btn.classList.add('in-grouped');
        btn.classList.remove('shb-floating-fallback');
        return true;
      }
    }
    btn.classList.remove('in-grouped');

    /* 3. Next priority: Right after "Extensions" / "Extension" button in top bar */
    var candidates = document.querySelectorAll('button, .comfyui-button, [role="button"], .comfyui-menu-item, span');
    for (var i = 0; i < candidates.length; i++) {
      var txt = (candidates[i].textContent || '').trim();
      if (txt === 'Extensions' || txt.indexOf('Extension') === 0) {
        var extBtn = candidates[i].closest('button, .comfyui-button, [role="button"]') || candidates[i];
        if (extBtn && extBtn.parentNode) {
          extBtn.insertAdjacentElement('afterend', btn);
          btn.classList.remove('shb-floating-fallback');
          return true;
        }
      }
    }

    /* 4. Fallback: app.menu.settingsGroup or topMenu container */
    var app = getApp();
    if (app && app.menu && app.menu.settingsGroup && app.menu.settingsGroup.element) {
      var sg = app.menu.settingsGroup.element;
      if (sg.parentNode) {
        sg.parentNode.insertBefore(btn, sg);
        btn.classList.remove('shb-floating-fallback');
        return true;
      }
    }
    var topMenu = document.querySelector('.comfyui-menu-actions, .comfyui-menu, .comfyui-top-menu, .comfy-menu');
    if (topMenu) {
      topMenu.appendChild(btn);
      btn.classList.remove('shb-floating-fallback');
      return true;
    }

    /* 5. Last resort if topbar hasn't rendered yet */
    if (!document.body.contains(btn)) {
      btn.classList.add('shb-floating-fallback');
      document.body.appendChild(btn);
    }
    return false;
  }

  function setupTopBarMounting() {
    mountTopBarButton();
    window.addEventListener('resize', function () { hbFitTopBarButton(TOPBAR_BTN); });
    [50, 150, 300, 600, 1200, 2500, 5000].forEach(function (d) {
      setTimeout(function () { mountTopBarButton(); hbFitTopBarButton(TOPBAR_BTN); }, d);
    });
    if (window.MutationObserver && !TOPBAR_OBSERVER_MOUNTED) {
      TOPBAR_OBSERVER_MOUNTED = true;
      var throttleTimer = null, recent = [], restUntil = 0;
      var observer = new MutationObserver(function () {
        if (isTopBarBtnProperlyMounted(TOPBAR_BTN) || throttleTimer || Date.now() < restUntil) return;
        throttleTimer = setTimeout(function () {
          throttleTimer = null;
          /* if something else keeps moving the bar (another extension placing its own button), stop answering
             it for a while instead of trading places with it forever */
          var now = Date.now();
          recent = recent.filter(function (t) { return now - t < 5000; });
          if (recent.length >= 8) { recent = []; restUntil = now + 30000; return; }
          recent.push(now);
          mountTopBarButton();
        }, 200);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function renderStatusPill() {
    mountTopBarButton();
  }

  /* Export hands over the Hotbox file in use (the same content as on disk), named after its version and the
     moment it left: hotbox_original_2026-10-22_0915.json, hotbox_v2_..., so no two exports share a name */
  function exportName() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    var v = cfgVerNum(CFG.file);
    return 'hotbox_' + (v > 1 ? 'v' + v : 'original') + '_' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      '_' + p(d.getHours()) + p(d.getMinutes()) + '.json';
  }

  function exportCustomSettings() {
    try {
      var name = exportName();
      var jsonStr = JSON.stringify(cfgPayload(), null, 2);
      var blob = new Blob([jsonStr], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
      }, 250);
      setStatus('ok', '✓ Downloaded a copy: ' + name);
    } catch (err) {
      setStatus('error', 'Could not download a copy: ' + msgOf(err));
    }
  }

  /* Import reads a Hotbox file and adds it as the next version: the file in use (and the original) stay as they are */
  function importCustomSettings(onDone) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.style.display = 'none';
    inp.onchange = function () {
      var file = inp.files && inp.files[0];
      if (inp.parentNode) inp.parentNode.removeChild(inp);
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var parsed = JSON.parse(String(ev.target.result || '{}'));
          var src = (parsed && parsed.settings && typeof parsed.settings === 'object') ? parsed.settings : parsed;
          if (!src || typeof src !== 'object' || Array.isArray(src)) throw new Error('Invalid JSON format');
          var known = Object.keys(src).filter(function (k) { return Object.prototype.hasOwnProperty.call(DEFAULTS, k); });
          if (!known.length) throw new Error('this is not a Hotbox file');
          importAsVersion(src, file.name, onDone);
        } catch (err) {
          setStatus('error', 'Could not load that file: ' + msgOf(err));
        }
      };
      reader.readAsText(file);
    };
    document.body.appendChild(inp);
    inp.click();
  }

  /* Load from File never overwrites anything. The file either goes into this project as its next version, or
     gets a project of its own: Hotbox switches to that folder, where it becomes the preferences (or, in a
     folder that already has some, its next version) */
  function importAsVersion(src, fname, onDone) {
    if (!CFG.ready) {
      setStatus('error', CFG.hostWait ? CFG.hostWait + ' · loading a file needs your Hotbox folder' : 'Loading a file needs ComfyUI running, so it can be kept as a new version');
      return;
    }
    var next = cfgNewVersionName();
    var nTpl = Array.isArray(src.templates) ? src.templates.length : 0;
    var projOpen = false;
    var bg = owns(document.createElement('div'));
    bg.className = 'shb-modal-bg';
    function paint() {
      bg.innerHTML =
        '<div class="shb-modal" style="width:min(460px,92vw)">' +
          '<div class="shb-modal-t"><span>Load ' + esc(fname) + '</span></div>' +
          '<div style="font-size:12px;color:#9a9a9a;line-height:1.4">' + (nTpl ? nTpl + (nTpl === 1 ? ' saved button, ' : ' saved buttons, ') : '') +
            'bars, labels and settings. Nothing you have now is overwritten.</div>' +
          '<button type="button" class="shb-btn shb-btn-pri shb-imp-b" data-imp="version">' + ico('history', 15) +
            '<span><b>Use it in this project (' + esc(cfgProjectName()) + ')</b><small>Added as ' + esc(cfgVerLabel(next)) + ' (' + esc(next) + ') and used right away. ' +
            esc(cfgVerLabel(CFG.file)) + ' (' + esc(CFG.file) + ') stays as it is: Settings → Version switches back any time.</small></span></button>' +
          (CFG.srv ? '<button type="button" class="shb-btn ' + (projOpen ? 'shb-btn-on' : 'shb-btn-pri') + ' shb-imp-b" data-imp="project">' + ico('folder', 15) +
            '<span><b>Set a project for it…</b><small>Pick the folder these preferences belong to (one per show, a synced drive…). Hotbox switches to it and keeps them there. A folder that already has preferences keeps them too: the file is added as its next version.</small></span></button>' : '') +
          (projOpen ? '<div class="shb-cfg-edit">' +
              '<input type="text" data-imp-in spellcheck="false" placeholder="Full path of the project folder">' +
              cfgRecentHTML('data-imp-recent') +
              '<div class="shb-cfg-btns"><button type="button" class="shb-btn shb-btn-on" data-imp="go">' + ico('check', 13) + '<span>Use This Project</span></button></div>' +
              '<small>A path copied from Explorer or Finder works as it is, quotes and all.</small>' +
            '</div>' : '') +
          '<div style="display:flex;justify-content:flex-end"><button type="button" class="shb-btn" data-imp="cancel">Cancel</button></div>' +
        '</div>';
      var inp = bg.querySelector('[data-imp-in]');
      if (inp) {
        inp.onkeydown = function (ev) {
          ev.stopPropagation();
          if (ev.key === 'Enter') toProject(inp.value);
          else if (ev.key === 'Escape') close();
        };
        setTimeout(function () { try { inp.focus(); } catch (e) {} }, 0);
      }
    }
    paint();
    document.body.appendChild(bg);
    function close() { if (bg.parentNode) bg.parentNode.removeChild(bg); }
    function toProject(path) {
      path = String(path || '').trim();
      if (!path) { setStatus('error', 'Type or paste the full path of the project folder'); return; }
      close();
      importToProject(src, path, onDone);
    }
    bg.addEventListener('mousedown', function (ev) { if (ev.target === bg) close(); });
    bg.onclick = function (ev) {
      var rec = ev.target && ev.target.closest ? ev.target.closest('[data-imp-recent]') : null;
      if (rec) { toProject(rec.getAttribute('data-imp-recent')); return; }
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-imp]') : null;
      if (!b) return;
      var what = b.getAttribute('data-imp');
      if (what === 'project') { projOpen = !projOpen; paint(); return; }
      if (what === 'go') { var inp = bg.querySelector('[data-imp-in]'); toProject(inp && inp.value); return; }
      close();
      if (what !== 'version') return;
      /* whatever is pending goes to the file in use first, then the loaded one gets its own file */
      var flush = CFG.timer ? cfgWrite() : Promise.resolve();
      flush.then(function () {
        applyConfig(src);
        CFG.origin = 'browser';
        CFG.file = next;
        cfgApplied();
        return cfgWrite();
      }).then(function () {
        return cfgPut('active.json', { file: next });
      }).then(cfgListVersions, cfgListVersions).then(function () {
        if (typeof onDone === 'function') onDone();
        setStatus('ok', '✓ Loaded as ' + cfgVerLabel(next) + ' (' + next + ') · the Original (hotbox.json) is untouched');
      });
    };
  }

  /* Set a project for a loaded file: Hotbox moves to that folder without copying the current preferences in,
     then the file becomes its hotbox.json, or its next version when the folder already has preferences */
  function importToProject(src, path, onDone) {
    cfgPostFolder(path, false).then(function (j) {
      CFG.file = 'hotbox.json';
      CFG.versions = [];
      return cfgListVersions().then(function () {
        var name = j.found ? cfgNewVersionName() : 'hotbox.json';
        applyConfig(src);
        CFG.origin = 'browser';
        CFG.file = name;
        CFG.ready = true;
        cfgApplied();
        return cfgWrite().then(function () {
          return cfgPut('active.json', { file: name });
        }).then(cfgListVersions).then(function () {
          setStatus('ok', j.found
            ? '✓ Project ' + cfgProjectName() + ': loaded as ' + cfgVerLabel(name) + ' (' + name + '), its own preferences are kept'
            : '✓ Project ' + cfgProjectName() + ' set up with the loaded preferences');
        });
      });
    }).catch(function (err) {
      setStatus('error', 'Could not set that project: ' + msgOf(err));
    }).then(function () {
      if (typeof onDone === 'function') onDone();
    });
  }

  /* The user's own power tools. Settings lists them as buttons to drag onto any hotbox bar; a placed one stays
     there, dimmed on the nodes it does not work on (hbKeep). */
  var POWER_TOOLS = [
    { uid: 'tool:lupa', icon: 'lupa', name: 'Magnifier · Visual Crop · Paint Studio', keys: 'Alt+Z', desc: 'A big editor for the node under the cursor',
      tip: 'On a prompt / text node: Magnifier, a big live text editor (5 font sizes, box presets, corner resize). On a crop node: the Visual Crop editor (8 handles, ratios, size presets, arrow-key nudging; its stitch stays in sync). On a paint or LoadImage node: the fullscreen Paint Studio (brush, eraser, undo, uploads straight to ComfyUI). Also the Z row of the hotbox.' },
    { uid: 'tool:label', icon: 'label', name: 'Label Studio', keys: 'Alt+N', desc: 'Rich canvas titles and notes',
      tip: 'Creates or edits a canvas label: text, size, font, color, corners, top shine, spacing and quick icons. Uses Label (rgthree) or an installed label node when it can, otherwise MarkdownNote / Note / Group. Also the Add Label row (L) of the hotbox.' },
    { uid: 'tool:loadcanvas', icon: 'loadCanvas', name: 'Load in Canvas', keys: 'Alt+R · V', desc: 'Hand a render to a new Load Image / Load Video',
      tip: 'Takes what the node is showing (Save / Preview Image, Save Video…), copies it into input/ and drops a Load Image — or a Load Video for videos — with it right under the node, in its own INPUT group. The [V] button shows up in the bottom bar on Preview, Save Image and Save Video nodes, and on any node that is showing an image or a video.' },
    { uid: 'tool:render', icon: 'play', name: 'Render Selected', keys: 'Shift+R', desc: 'Queue only the selected outputs',
      tip: 'Renders only what you selected: the selected output nodes, or the output nodes downstream of the selection, with just the nodes they need. Nothing selected renders nothing, so a stray key never spends API credits on the whole graph. Uses rgthree\'s queue when it is installed.' },
    { uid: 'tool:stitch', icon: 'stitch', name: 'Super Stitch', keys: 'crop · result', desc: 'Put processed crops back into their plate',
      tip: 'On a crop, on the plate it cuts, or on a result that came out of a crop: adds a fit (ImageScale, bicubic) that sizes your result back to the crop box and an ImageCompositeMasked that pastes it at the crop\'s x / y. Several crops of one plate chain into one result, a preview closes the chain, an empty "apinode / localmodel" group marks where the model goes, and every stitch keeps following its crop when you move or resize it.' },
    { uid: 'tool:swappair', icon: 'swap', name: 'Swap Nodes', keys: 'W', desc: 'Two selected nodes trade places and wires',
      tip: 'Select two nodes and they trade places, each one taking over the other\'s connections. Wired or not, they always swap; slots are matched by name, then by type. Shows up in the bottom bar while exactly two nodes are selected.' },
    { uid: 'tool:magic', icon: 'wand', name: 'Save as Button', keys: 'X', desc: 'Keep a copy of the selection as a button',
      tip: 'Select any nodes (one or many, or a group) and a copy of them becomes one button in the bottom bar, saved in your Hotbox file; the nodes themselves stay where they are. Click the button to add them again by the cursor, or drag it onto the canvas: their settings and inner wires come back exactly as they were. The name says what they do (e.g. "Flux · Text to Image"); rename it in edit mode.' },
    { uid: 'tool:apibypass', icon: 'zapOff', name: 'Bypass All APIs', keys: 'K', desc: 'Bypass every API node at once',
      tip: 'Bypasses every paid API node in the workflow for a cost-free test run; press it again to bring them back. Shows up in the bottom bar when the workflow has API nodes.' },
    { uid: 'tool:zoom', icon: 'zoom', name: 'Zoom to Selection', keys: '.', desc: 'Frame the selection, press again to go back',
      tip: 'Smoothly frames the selected node(s). Press . again to return to exactly where you were.' },
    { uid: 'tool:arrange', icon: 'arrange', name: 'Arrange Nodes', keys: 'L', desc: 'Line up the selection along its wires, as in Nuke',
      tip: 'With the hotbox closed, select nodes and press L. Wired nodes go into columns that follow the wires, each wire as straight as it can be; nodes with no wires between them line up in a row or a column. One node lines up with the node that feeds it. The selection keeps its corner, and Ctrl+Z puts it back.' },
    { uid: 'tool:copywf', icon: 'copy', name: 'Copy Workflow', keys: 'click', desc: 'The whole workflow to the clipboard',
      tip: 'Copies the whole workflow, exactly as Export saves it, to the clipboard: paste it into a chat or a .json file, or press Ctrl+V on any ComfyUI canvas to open it there. Works from any node or from the bare canvas.' },
    { uid: 'tool:replicate', icon: 'copy', name: 'Replicate', keys: 'A → B, C…', desc: 'Copies of the selection, each with its own letter',
      tip: 'Select a group (with its label) or any nodes and choose how many copies: they stack below or to the right, and each one moves the letter on (A → B, C, D…) in its group titles, labels, Set / Get names, texts and file names (Save Video, Save EXR, OCIO Read / Write, Crop_A_v → Crop_B_v). A file picked from a list moves on when that file is there (jacket_A.png → jacket_B.png). Every name that moves is listed first and can be switched off; numbers (IMAGE_1 → IMAGE_2) can be switched on. Wires coming in from outside stay plugged into the same nodes, and one Ctrl+Z takes all the copies back.' }
  ];

  /* One floating tooltip for anything that carries data-tip (it lives on body, so a scrolling modal never clips it) */
  var TIP = null;
  function tipHide() {
    if (TIP) TIP.classList.remove('shb-tip-on');
  }
  listen(document, 'mouseover', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!t) return;
    if (!TIP) {
      TIP = owns(document.createElement('div'));
      TIP.className = 'shb-tip';
      document.body.appendChild(TIP);
    }
    TIP.textContent = t.getAttribute('data-tip') || '';
    TIP.style.left = '0px';
    TIP.style.top = '0px';
    var r = t.getBoundingClientRect(), tr = TIP.getBoundingClientRect();
    var y = r.bottom + 6;
    if (y + tr.height > (window.innerHeight || 900) - 10) y = r.top - tr.height - 6;
    TIP.style.left = Math.max(10, Math.min((window.innerWidth || 1600) - tr.width - 10, r.left)) + 'px';
    TIP.style.top = Math.max(10, y) + 'px';
    TIP.classList.add('shb-tip-on');
  }, true);
  listen(document, 'mouseout', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) tipHide();
  }, true);

  function openSettingsModal(anchorBtn) {
    var old = document.getElementById(PANEL_ID + '-settings');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var topBtn = anchorBtn || document.getElementById(PANEL_ID + '-topbar-btn');
    if (topBtn) topBtn.classList.add('open');

    var wrap = owns(document.createElement('div'));
    wrap.id = PANEL_ID + '-settings';
    wrap.className = 'shb-modal-bg';
    wrap.style.background = 'transparent';
    wrap.style.pointerEvents = 'none';

    function closeSettings() {
      HB.binding = false;
      tipHide();
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      var tb = document.getElementById(PANEL_ID + '-topbar-btn');
      if (tb) tb.classList.remove('open');
    }

    var mw = 460;
    var topPx = 46;
    var leftPx = Math.max(12, (window.innerWidth || 1600) - mw - 18);
    if (topBtn && isElemVisible(topBtn)) {
      var rect = topBtn.getBoundingClientRect();
      topPx = Math.round(rect.bottom + 8);
      leftPx = Math.round(rect.left - 16);
      if (leftPx + mw > window.innerWidth - 12) leftPx = window.innerWidth - mw - 12;
      if (leftPx < 10) leftPx = 10;
    }
    /* Keep Hotbox open (or open it if closed) so user sees live UI Scale & Bar Spacing changes. Opened from
       here, the pointer is on the settings button, so it opens in the middle of the canvas the panel leaves
       free instead of over the top bar */
    if (!HB.el) {
      var mx = HB_MX, my = HB_MY, vw = window.innerWidth || 1600, vh = window.innerHeight || 900;
      HB_MX = Math.round(leftPx > vw / 2 ? leftPx / 2 : (leftPx + mw + vw) / 2);
      HB_MY = Math.round((topPx + vh) / 2);
      hbOpen();
      HB_MX = mx;
      HB_MY = my;
    }

    var modalStyle = ' style="position:fixed;top:' + topPx + 'px;left:' + leftPx + 'px;width:min(' + mw + 'px,94vw);margin:0;pointer-events:auto"';

    /* Settings with several choices are one button that steps through them; the dots show where you are */
    var CYCLES = {
      hbHold: { opts: [false, true], names: ['Toggle on Press', 'Hold & Release'],
        tip: 'Toggle: press the hotkey to open, press again to close. Hold & Release: open while the key is held.' },
      hbStyle: { opts: ['pro', 'classic', 'quiet'], names: ['Fluid', 'Compact', 'Quiet'],
        tip: 'Fluid: frosted glass cards. Compact: the same look, bars only. Quiet: native ComfyUI panels, smaller and plainer. Tab also switches it.' },
      hbEditAnim: { opts: ['none', 'outline', 'tilt', 'float', 'jiggle'], names: ['Still', 'Outline', 'Tilt', 'Float', 'Jiggle'],
        tip: 'What the bar buttons do in edit mode (long-press any button). Still: nothing moves; a fine line around the bars and "Editing" in the edit bar say it. Clicking here previews it.' }
    };
    var ptOpen = false, sbOpen = false, dirEdit = false, libAdd = false;
    libRefresh(true).then(function () { if (wrap.parentNode) render(); });

    function cycleCur(key) {
      var c = CYCLES[key];
      var cur = key === 'hbHold' ? !!S.hbHold : S[key];
      return Math.max(0, c.opts.indexOf(cur));
    }

    function cycleBtn(key) {
      var c = CYCLES[key], i = cycleCur(key);
      return '<button type="button" class="shb-btn shb-btn-pri shb-cycle" data-st-cycle="' + key + '" data-tip="' + esc(c.tip) + '">' +
        '<span class="shb-cycle-v">' + esc(c.names[i]) + '</span>' +
        '<span class="shb-cycle-dots">' + c.opts.map(function (o, j) { return '<i' + (j === i ? ' class="shb-on"' : '') + '></i>'; }).join('') + '</span>' +
        ico('sync', 12) +
      '</button>';
    }

    /* The saved versions of the Hotbox file: one button that steps through them, like the other choices */
    function verBtn() {
      var i = Math.max(0, CFG.versions.indexOf(CFG.file));
      return '<button type="button" class="shb-btn shb-btn-pri shb-cycle" data-st-ver data-tip="Click to switch to the next version of your Hotbox file. The Original is hotbox.json; every import adds a version and never overwrites it.">' +
        '<span class="shb-cycle-v">' + esc(cfgVerLabel(CFG.file)) + ' <small style="font-weight:400;opacity:.6">' + esc(CFG.file) + '</small></span>' +
        '<span class="shb-cycle-dots">' + CFG.versions.map(function (v, j) { return '<i' + (j === i ? ' class="shb-on"' : '') + '></i>'; }).join('') + '</span>' +
        ico('sync', 12) +
      '</button>';
    }

    function setLabel(icon, text, top) {
      return '<label class="shb-set-l' + (top ? ' shb-set-top' : '') + '">' + ico(icon, 14) + '<span>' + esc(text) + '</span></label>';
    }

    /* "Load Image · Crop Image · Preview Image" for a saved button's row */
    function tplSummary(tp) {
      var names = [];
      ((tp.data && tp.data.nodes) || []).forEach(function (n) {
        var def = SRV.types && SRV.types[n.type];
        var t = String(n.title || (def && def.display_name) || n.type || '');
        if (t && names.indexOf(t) < 0) names.push(t);
      });
      return names.slice(0, 3).join(' · ') + (names.length > 3 ? ' +' + (names.length - 3) : '');
    }

    /* Every saved button, draggable into the hotbox like the power tools */
    function libsHTML() {
      var rows = LIB.list.map(function (l) {
        var st = !l.exists ? 'not there right now' : (l.count != null ? l.count + (l.count === 1 ? ' button' : ' buttons') : '…');
        var on = S.saveLib && libByPath(S.saveLib) === l;
        return '<div class="shb-lib-row" data-st-lib="' + esc(l.path) + '">' +
          '<span class="shb-lib-main"><b>' + esc(l.label) + '</b><small>' + esc(l.path) + '</small></span>' +
          '<span class="shb-lib-st' + (l.exists ? '' : ' shb-lib-miss') + '">' + esc(st) + '</span>' +
          (l.env ? '<span class="shb-lib-tag" data-tip="Set by the HOTBOX_EXTRA_PATHS environment variable: always read-only, and only removed there">Studio</span>'
            : '<button type="button" class="shb-btn' + (l.readOnly ? ' shb-btn-pri' : ' shb-btn-on') + '" data-st-librw data-tip="Read-only: its buttons are used, never changed. Writable: you can save buttons into it, and delete the ones in it">' +
              '<span>' + (l.readOnly ? 'Read-only' : 'Writable') + '</span></button>') +
          (libWritable(l) ? '<button type="button" class="shb-btn' + (on ? ' shb-btn-on' : ' shb-btn-pri') + '" data-st-libsave data-tip="Buttons you save with X go into this folder instead of your own file">' +
              ico('save', 13) + '<span>' + (on ? 'Saving Here' : 'Save Here') + '</span></button>' : '') +
          (l.env ? '' : '<button type="button" class="shb-btn shb-btn-pri" data-st-librm data-tip="Take it off the list (the folder and its files stay as they are)">' + ico('trash', 13) + '</button>') +
        '</div>';
      }).join('');
      return '<div class="shb-cfg">' +
        (rows || '<div class="shb-sb-empty">No shared folders yet. Add a studio or show folder, and its saved buttons show up in the hotbox beside your own.</div>') +
        (libAdd ? '<div class="shb-cfg-edit">' +
            '<input type="text" data-st-libin spellcheck="false" placeholder="Full path of a shared folder">' +
            '<div class="shb-cfg-btns"><button type="button" class="shb-btn shb-btn-on" data-st-libok>' + ico('check', 13) + '<span>Add Folder</span></button></div>' +
            '<small>It starts read-only; make it writable to save buttons into it. Each button is its own .json file there, so a synced drive never has two people writing the same file.</small>' +
          '</div>'
          : '<div class="shb-cfg-btns"><button type="button" class="shb-btn shb-btn-pri" data-st-libadd data-tip="Add a shared folder of saved buttons (a studio drive, a show folder…)">' + ico('plus', 13) + '<span>Add Folder</span></button></div>') +
      '</div>';
    }

    function savedButtonsHTML() {
      var list = Array.isArray(S.templates) ? S.templates : [];
      var shared = libSharedButtons();
      function sbRow(tp) {
        var when = Date.parse(tp.at);
        /* the name, the color and the key it has on the bars */
        var sbUid = 'tpl:' + tp.id, sbTint = barTint(sbUid), sbKey = hbKeyName(hbKeyFor(sbUid));
        return '<div class="shb-pt-row" data-st-ptuid="' + esc(sbUid) + '"' + (sbTint ? ' style="--shb-tint:' + esc(sbTint) + '"' : '') +
          ' data-tip="' + esc(tp.count + (tp.count === 1 ? ' node' : ' nodes') + ': ' + tplSummary(tp) + (when ? ' · saved ' + new Date(when).toLocaleString() : '')) + '">' +
          '<span class="shb-pt-grip">' + ico('grip', 13) + '</span>' +
          '<span class="shb-tpl-ico">' + ico('sparkles', 15) + '</span>' +
          '<span class="shb-pt-name">' + esc(hbBtnName(sbUid, tp.name)) + '<small>' + esc(tplSummary(tp)) + '</small></span>' +
          (sbKey ? '<span class="shb-pt-key">' + esc(sbKey) + '</span>' : '') +
          '<span class="shb-tpl-n">' + esc(tp.count) + '</span>' +
          (!tp.lib || tp.canDelete ? '<span class="shb-tpl-del" data-st-tpldel="' + esc(tp.id) + '" title="Delete this saved button for good">' + ico('trash', 13) + '</span>' : '') +
        '</div>';
      }
      var sharedHTML = LIB.list.map(function (l) {
        return (l.buttons || []).length ? '<div class="shb-sb-lib">' + esc(l.label) + '</div>' + l.buttons.map(sbRow).join('') : '';
      }).join('');
      /* the groups, each with what it holds: dragged into the hotbox like a button */
      var gids = Object.keys(S.hbGroups && typeof S.hbGroups === 'object' ? S.hbGroups : {});
      var groupsHTML = gids.length ? '<div class="shb-sb-lib">Groups</div>' + gids.map(function (gid) {
        var g = S.hbGroups[gid] || {}, gUid = 'grp:' + gid, gTint = barTint(gUid), gKey = hbKeyName(hbKeyFor(gUid));
        var names = (g.items || []).map(hbUidLabel);
        return '<div class="shb-pt-row shb-sb-grp" data-st-ptuid="' + esc(gUid) + '"' + (gTint ? ' style="--shb-tint:' + esc(gTint) + '"' : '') +
          ' data-tip="' + esc('A group of ' + names.length + (names.length === 1 ? ' button' : ' buttons') + (names.length ? ': ' + names.join(', ') : '') + ' · Browse opens it') + '">' +
          '<span class="shb-pt-grip">' + ico('grip', 13) + '</span>' +
          ico('folder', 15) +
          '<span class="shb-pt-name">' + esc(hbBtnName(gUid, g.name)) + '<small>' + esc(names.slice(0, 3).join(' · ') + (names.length > 3 ? ' +' + (names.length - 3) : '') || 'empty') + '</small></span>' +
          (gKey ? '<span class="shb-pt-key">' + esc(gKey) + '</span>' : '') +
          '<span class="shb-tpl-n">' + names.length + '</span>' +
        '</div>';
      }).join('') : '';
      return '<div class="shb-sb-top">' +
        '<button type="button" class="shb-btn shb-btn-pri shb-ptmenu" data-st-sbmenu data-tip="Every set of nodes saved with Save as Button (X), and every group of buttons. Drag one onto a hotbox bar to pin it, or a saved button onto the canvas to add its nodes there.">' +
          '<span class="shb-ptmenu-v">' + list.length + ' saved' + (gids.length ? ' · ' + gids.length + (gids.length === 1 ? ' group' : ' groups') : '') + (shared.length ? ' · ' + shared.length + ' shared' : '') + '</span>' +
          ico(sbOpen ? 'chevDown' : 'chevRight', 13) +
        '</button>' +
        '<button type="button" class="shb-btn shb-btn-on" data-st-browse data-tip="Every saved button and group on big cards: rename, color, key, put into groups, edit the nodes a button holds, delete (with Undo)">' + ico('search', 13) + '<span>Browse…</span></button>' +
        '</div>' +
        (sbOpen ? '<div class="shb-pt">' +
          (list.length || shared.length || gids.length ? '<div class="shb-sb-list">' + list.map(sbRow).join('') + groupsHTML + sharedHTML + '</div>'
          : '<div class="shb-sb-empty">Nothing saved yet. Select some nodes and press X (Save as Button) in the hotbox.</div>') +
          '<div class="shb-sb-foot"><span title="' + esc(cfgPath()) + '">Kept inside ' + esc(CFG.file) + ' · ' + esc(cfgFolder()) + '</span>' +
            '<button type="button" class="shb-btn shb-btn-pri" data-st-copydir data-tip="Copy the path of the folder these files live in">' + ico('folder', 13) + '<span>Copy Folder Path</span></button>' +
          '</div>' +
        '</div>' : '');
    }

    function render() {
      tipHide();
      var curScale = parseFloat(S.hbScale) || 1;
      var curGap = (S.hbGap !== undefined && S.hbGap !== null) ? Number(S.hbGap) : 28;
      wrap.innerHTML =
        '<div class="shb-modal shb-settings"' + modalStyle + '>' +
          '<div class="shb-modal-t">' +
            '<span style="display:inline-flex;align-items:center;gap:8px">' + hbLogoChip(20) + '<span>Hotbox Settings</span></span>' +
            '<button class="shb-btn shb-btn-ico" data-st-close>✕</button>' +
          '</div>' +
          '<div class="shb-grid">' +
            setLabel('power', 'Hotbox') +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<button class="shb-btn ' + (S.useHotbox ? 'shb-btn-on' : 'shb-btn-pri') + '" data-st-toggle="useHotbox" data-tip="Right-click the H in the top bar to switch it on or off any time">' + (S.useHotbox ? '● Enabled' : '○ Disabled') + '</button>' +
              '<button class="shb-btn shb-btn-pri" data-st-bind data-tip="Click, then press the key (or combination) that opens the hotbox">' + ico('keyboard', 13) + '<span>' + (HB.binding ? 'Press any key…' : 'Hotkey: ' + esc(hbKeyLabel())) + '</span></button>' +
            '</div>' +
            setLabel('pointer', 'Launch Mode') + '<div>' + cycleBtn('hbHold') + '</div>' +
            setLabel('palette', 'UI Style') + '<div>' + cycleBtn('hbStyle') + '</div>' +
            setLabel('edit', 'Edit Mode') + '<div>' + cycleBtn('hbEditAnim') + '</div>' +
            /* each style has its own effect, so only the one that shows is offered */
            setLabel('sparkles', 'Effects') +
            '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
              (hbTheme() === 'quiet'
                ? '<button class="shb-btn ' + (S.hbLeaders !== false ? 'shb-btn-on' : 'shb-btn-pri') + '" data-st-toggle="hbLeaders" data-tip="Quiet only: thin lines from the cursor to the top and bottom bars and the side cards (off by default: they cross the node)">' + ico('leaders', 13) + '<span>Leader Lines</span></button>'
                : '<button class="shb-btn ' + (S.hbScrim !== false ? 'shb-btn-on' : 'shb-btn-pri') + '" data-st-toggle="hbScrim" data-tip="Fluid & Compact: a soft dim behind the hotbox (never blurred)">' + ico('moon', 13) + '<span>Canvas Dim</span></button>' +
                  '<button class="shb-btn ' + (S.hbBlur !== false ? 'shb-btn-on' : 'shb-btn-pri') + '" data-st-toggle="hbBlur" data-tip="Fluid & Compact: frosted glass behind the bars and cards. It asks a lot of a browser without a graphics card (a remote desktop, some Linux machines): off, the bars are plain panels and the hotbox opens and moves faster there">' + ico('sparkles', 13) + '<span>Glass Blur</span></button>') +
            '</div>' +
            setLabel('resize', 'UI Scale') +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<input type="range" min="0.70" max="1.50" step="0.05" value="' + curScale + '" data-st-scale style="flex:1;accent-color:#4b6584;cursor:ew-resize">' +
              '<span data-st-scale-val style="min-width:46px;font:600 11.5px monospace;text-align:right">' + Math.round(curScale * 100) + '%</span>' +
            '</div>' +
            setLabel('spacing', 'Bar Spacing') +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<input type="range" min="8" max="110" step="2" value="' + curGap + '" data-st-gap style="flex:1;accent-color:#4b6584;cursor:ew-resize">' +
              '<span data-st-gap-val style="min-width:46px;font:600 11.5px monospace;text-align:right">' + curGap + 'px</span>' +
            '</div>' +
            setLabel('tools', 'Power Tools', true) +
            '<div>' +
              '<button type="button" class="shb-btn shb-btn-pri shb-ptmenu" data-st-ptmenu data-tip="Drag any of them onto any hotbox bar, and it stays there. On a node it does not work on it is dimmed, and a click says when it works (hover one to see what it does)">' +
                '<span class="shb-ptmenu-v">' + POWER_TOOLS.length + ' tools · drag into the hotbox</span>' +
                ico(ptOpen ? 'chevDown' : 'chevRight', 13) +
              '</button>' +
              (ptOpen ? '<div class="shb-pt">' +
                POWER_TOOLS.map(function (pt) {
                  return '<div class="shb-pt-row" data-st-ptuid="' + esc(pt.uid) + '" data-tip="' + esc(pt.tip) + '">' +
                    '<span class="shb-pt-grip">' + ico('grip', 13) + '</span>' +
                    ico(pt.icon, 15) +
                    '<span class="shb-pt-name">' + esc(pt.name) + '<small>' + esc(pt.desc) + '</small></span>' +
                    '<span class="shb-pt-key">' + esc(pt.keys) + '</span>' +
                  '</div>';
                }).join('') +
              '</div>' : '') +
            '</div>' +
            setLabel('wand', 'Saved Buttons', true) +
            '<div>' + savedButtonsHTML() + '</div>' +
            (CFG.srv ? setLabel('folder', 'Shared Libraries', true) + '<div>' + libsHTML() + '</div>' : '') +
            setLabel('folder', 'Project', true) +
            '<div class="shb-cfg">' +
              '<div class="shb-cfg-row">' +
                '<span class="shb-cfg-proj" data-tip="A project is the folder your Hotbox preferences live in. Set Project switches to another one (one per show, a synced drive, a team folder…)">' +
                  ico('folder', 14) + '<b>' + esc(cfgProjectName()) + '</b></span>' +
                '<span data-st-cfgstate class="shb-cfg-state shb-cfg-' + esc(CFG.state) + '">' + esc(cfgStateText()) + '</span>' +
              '</div>' +
              '<div class="shb-cfg-path" data-tip="Every change (moved or pinned buttons, bars, labels, saved buttons and these settings) is written to this file, so it follows you to any browser and survives clearing the cache. By default it sits in ~/comfyui/hotbox on Linux and in ComfyUI\'s user folder on Windows and macOS (the HOTBOX_DIR environment variable sets another default).">' + esc(cfgPath()) + '</div>' +
              (CFG.missing ? '<div class="shb-cfg-warn">The project folder is not there right now (' + esc(CFG.missing) + '), so the Default one is in use.</div>' : '') +
              '<div class="shb-cfg-btns">' +
                (CFG.srv ? '<button type="button" class="shb-btn' + (dirEdit ? ' shb-btn-on' : ' shb-btn-pri') + '" data-st-dir data-tip="Point Hotbox at a project folder. Preferences already there load right away; a folder without any starts with a copy of yours">' + ico('folder', 13) + '<span>Set Project…</span></button>' : '') +
                '<button type="button" class="shb-btn shb-btn-pri" data-st-copy data-tip="Copy the full path of the file">' + ico('copy', 13) + '<span>Copy Path</span></button>' +
                '<button type="button" class="shb-btn shb-btn-pri" data-st-copydir data-tip="Copy the path of the project folder">' + ico('copy', 13) + '<span>Copy Folder Path</span></button>' +
              '</div>' +
              (dirEdit ? '<div class="shb-cfg-edit">' +
                '<input type="text" data-st-dirin spellcheck="false" value="' + esc(CFG.dir) + '" placeholder="Full path of the project folder">' +
                cfgRecentHTML('data-st-recent', 'data-tip') +
                '<div class="shb-cfg-btns">' +
                  '<button type="button" class="shb-btn shb-btn-on" data-st-dirok>' + ico('check', 13) + '<span>Use This Project</span></button>' +
                  (CFG.custom ? '<button type="button" class="shb-btn shb-btn-pri" data-st-dirdef data-tip="' + esc(CFG.defDir) + '">' + ico('sync', 13) + '<span>Back to Default</span></button>' : '') +
                '</div>' +
                '<small>Preferences already in that folder load as they are; a folder without any starts with a copy of yours. A path copied from Explorer or Finder works as it is, quotes and all.</small>' +
              '</div>' : '') +
            '</div>' +
            (CFG.versions.length > 1 ? setLabel('history', 'Version') + '<div>' + verBtn() + '</div>' : '') +
            setLabel('save', 'Backup & Share', true) +
            '<div class="shb-cfg">' +
              '<div class="shb-cfg-btns">' +
                '<button type="button" class="shb-btn shb-btn-pri" data-st-export data-tip="Download a copy of the preferences in use (' + esc(exportName()) + '): a backup, or to give to someone. Nothing changes here">' + ico('save', 13) + '<span>Download a Copy</span></button>' +
                '<button type="button" class="shb-btn shb-btn-pri" data-st-import data-tip="Open a Hotbox .json (a backup, or one someone gave you): use it in this project as a new version, or set a project for it. Nothing you have is overwritten">' + ico('upload', 13) + '<span>Load from File…</span></button>' +
                '<button type="button" class="shb-btn" data-st-resetbars data-tip="Put every bar back to its default buttons (saved buttons stay saved)">' + ico('sync', 13) + '<span>Reset Bars</span></button>' +
              '</div>' +
              '<div class="shb-cfg-note">Your preferences already save themselves into the project. A copy is for another computer, a teammate or a backup.</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid #333333">' +
            '<span style="font-size:11px;color:#888888">Hotbox stays live while adjusting UI Scale & Spacing</span>' +
            '<button class="shb-btn shb-btn-pri" data-st-close>Done</button>' +
          '</div>' +
        '</div>';

      Array.prototype.forEach.call(wrap.querySelectorAll('[data-st-close]'), function (b) {
        b.onclick = closeSettings;
      });
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-st-toggle]'), function (b) {
        b.onclick = function () {
          var k = b.getAttribute('data-st-toggle');
          S[k] = !S[k];
          save();
          updateTopBarButtonState();
          if (HB.el) hbPaint();
          render();
        };
      });
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-st-cycle]'), function (b) {
        b.onclick = function () {
          var key = b.getAttribute('data-st-cycle');
          var c = CYCLES[key];
          S[key] = c.opts[(cycleCur(key) + 1) % c.opts.length];
          save();
          if (key === 'hbStyle' && HB.el) {
            hbPaint();
            hbAnimateOpen();
          } else if (key === 'hbEditAnim' && HB.el) {
            if (!HB.editMode) hbSetEdit(true);
            else hbSyncEditAnim();
          }
          render();
        };
      });
      var ptBtn = wrap.querySelector('[data-st-ptmenu]');
      if (ptBtn) {
        ptBtn.onclick = function () {
          ptOpen = !ptOpen;
          render();
        };
      }
      var verB = wrap.querySelector('[data-st-ver]');
      if (verB) {
        verB.onclick = function () {
          var i = CFG.versions.indexOf(CFG.file);
          cfgSwitch(CFG.versions[(i + 1) % CFG.versions.length], render);
        };
      }
      var copyB = wrap.querySelector('[data-st-copy]');
      if (copyB) {
        copyB.onclick = function () { cfgCopy(cfgPath(), 'Path'); };
      }
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-st-copydir]'), function (b) {
        b.onclick = function () { cfgCopy(cfgFolder(), 'Folder path'); };
      });
      var sbBtn = wrap.querySelector('[data-st-sbmenu]');
      if (sbBtn) {
        sbBtn.onclick = function () {
          sbOpen = !sbOpen;
          render();
        };
      }
      var brwBtn = wrap.querySelector('[data-st-browse]');
      if (brwBtn) brwBtn.onclick = function () { brwOpen(); };
      var dirB = wrap.querySelector('[data-st-dir]');
      if (dirB) {
        dirB.onclick = function () {
          dirEdit = !dirEdit;
          render();
          var inp = wrap.querySelector('[data-st-dirin]');
          if (inp) { inp.focus(); inp.select(); }
        };
      }
      var dirIn = wrap.querySelector('[data-st-dirin]');
      function useDir(path) {
        dirEdit = false;
        cfgSetFolder(path, render);
      }
      var dirOk = wrap.querySelector('[data-st-dirok]');
      if (dirOk && dirIn) {
        dirOk.onclick = function () { useDir(dirIn.value.trim()); };
        dirIn.onkeydown = function (ev) {
          ev.stopPropagation();
          if (ev.key === 'Enter') useDir(dirIn.value.trim());
          else if (ev.key === 'Escape') { dirEdit = false; render(); }
        };
      }
      var dirDef = wrap.querySelector('[data-st-dirdef]');
      if (dirDef) {
        dirDef.onclick = function () { useDir(''); };
      }
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-st-recent]'), function (b) {
        b.onclick = function () { useDir(b.getAttribute('data-st-recent')); };
      });
      /* Shared Libraries: + Add Folder, read-only / writable, Save Here, and off the list */
      function libsDone() { render(); if (HB.el) hbPaint(); }
      var libAddB = wrap.querySelector('[data-st-libadd]');
      if (libAddB) {
        libAddB.onclick = function () {
          libAdd = true;
          render();
          var inp = wrap.querySelector('[data-st-libin]');
          if (inp) inp.focus();
        };
      }
      var libIn = wrap.querySelector('[data-st-libin]');
      function addLib() {
        var v = libIn.value.trim();
        libAdd = false;
        if (!v) { render(); return; }
        libSet({ add: [{ path: v }] }).then(libsDone);
      }
      if (libIn) {
        wrap.querySelector('[data-st-libok]').onclick = addLib;
        libIn.onkeydown = function (ev) {
          ev.stopPropagation();
          if (ev.key === 'Enter') addLib();
          else if (ev.key === 'Escape') { libAdd = false; render(); }
        };
      }
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-st-lib]'), function (row) {
        var path = row.getAttribute('data-st-lib'), l = libByPath(path);
        var rw = row.querySelector('[data-st-librw]'), sv = row.querySelector('[data-st-libsave]'), rm = row.querySelector('[data-st-librm]');
        if (rw) rw.onclick = function () {
          var ro = !(l && l.readOnly);
          if (ro && S.saveLib && libByPath(S.saveLib) === l) { S.saveLib = ''; save(); }
          libSet({ update: [{ path: path, readOnly: ro }] }).then(libsDone);
        };
        if (sv) sv.onclick = function () {
          S.saveLib = (S.saveLib && libByPath(S.saveLib) === l) ? '' : path;
          save();
          libsDone();
        };
        if (rm) rm.onclick = function () {
          if (S.saveLib && libByPath(S.saveLib) === l) { S.saveLib = ''; save(); }
          libSet({ remove: [path] }).then(libsDone);
        };
      });
      /* deleting a saved button is for good, so it takes a second click */
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-st-tpldel]'), function (b) {
        b.onclick = function (ev) {
          ev.stopPropagation();
          if (!b.classList.contains('shb-armed')) {
            b.classList.add('shb-armed');
            b.title = 'Click again to delete';
            setStatus('error', 'Click the trash again to delete this saved button for good');
            return;
          }
          tplDelete(b.getAttribute('data-st-tpldel'));
          if (HB.el) hbPaint();
          render();
        };
      });
      var sc = wrap.querySelector('[data-st-scale]');
      var scVal = wrap.querySelector('[data-st-scale-val]');
      if (sc) {
        sc.oninput = function () {
          S.hbScale = parseFloat(sc.value) || 1;
          save();
          if (scVal) scVal.textContent = Math.round(S.hbScale * 100) + '%';
          if (!HB.el) hbOpen();
          else hbPlace();
        };
      }
      var gp = wrap.querySelector('[data-st-gap]');
      var gpVal = wrap.querySelector('[data-st-gap-val]');
      if (gp) {
        gp.oninput = function () {
          S.hbGap = parseInt(gp.value, 10);
          save();
          if (gpVal) gpVal.textContent = S.hbGap + 'px';
          if (!HB.el) hbOpen();
          else hbPlace();
        };
      }
      var bindBtn = wrap.querySelector('[data-st-bind]');
      if (bindBtn) {
        bindBtn.onclick = function () {
          HB.binding = !HB.binding;
          render();
        };
      }
      var expBtn = wrap.querySelector('[data-st-export]');
      if (expBtn) {
        expBtn.onclick = function () {
          exportCustomSettings();
        };
      }
      var impBtn = wrap.querySelector('[data-st-import]');
      if (impBtn) {
        impBtn.onclick = function () {
          importCustomSettings(render);
        };
      }
      var rstBarsBtn = wrap.querySelector('[data-st-resetbars]');
      if (rstBarsBtn) {
        rstBarsBtn.onclick = function () {
          hbUndoPush('Reset Bars');
          S.customKeys = {};
          S.customAddBar = null;
          S.customAddBySig = {};
          S.customToolsBar = {};
          S.customBotBar = null;
          S.customLabels = {};
          S.customColors = {};
          S.customFill = {};
          S.hbKeep = {};
          save();
          if (HB.el) hbPaint();
          setStatus('ok', '✓ Custom bars reset to defaults');
        };
      }
    }

    /* Power tools and saved buttons are dragged from here straight onto a hotbox bar */
    wrap.addEventListener('pointerdown', function (e) {
      var row = (e.button === 0 && e.target && e.target.closest) ? e.target.closest('[data-st-ptuid]') : null;
      if (!row || e.target.closest('[data-st-tpldel]')) return;
      e.preventDefault();
      if (!HB.el) hbOpen();
      clearDrawerDrag();
      DRAWER_DRAG = { uid: row.getAttribute('data-st-ptuid'), x0: e.clientX, y0: e.clientY, active: false, inBar: false, wrap: null, loose: true, st: wrap };
    });

    document.body.appendChild(wrap);
    render();
    openSettingsModal._rerender = render;
  }

  /* ---------------------------------------------------------------------
   * 16. GLOBAL KEYBOARD SHORTCUT LISTENERS
   * --------------------------------------------------------------------- */
  function keyMods(e) {
    return (e.ctrlKey ? 'ctrl+' : '') + (e.altKey ? 'alt+' : '')
      + (e.shiftKey ? 'shift+' : '') + (e.metaKey ? 'meta+' : '');
  }

  function hbIsKey(e) {
    var k = S.hbKey, c = S.hbCode;
    if (!k && !c) { k = '`'; c = 'Backquote'; }
    if (hbKeyRefused(k, c)) return false;
    return e.key === k || (!!c && e.code === c);
  }

  /* Rebinding capture listener */
  listen(document, 'keydown', function (e) {
    if (!HB.binding) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      HB.binding = false;
      if (openSettingsModal._rerender) openSettingsModal._rerender();
      return;
    }
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    var refused = hbKeyRefused(e.key, e.code);
    if (refused) {
      setStatus('error', refused + ' is reserved by ComfyUI — pick another key');
      HB.binding = false;
      if (openSettingsModal._rerender) openSettingsModal._rerender();
      return;
    }
    S.hbKey = /^(Dead|Unidentified)$/.test(e.key) ? '' : e.key;
    S.hbCode = e.code || '';
    S.hbMods = keyMods(e);
    save();
    HB.binding = false;
    updateTopBarButtonState();
    if (openSettingsModal._rerender) openSettingsModal._rerender();
    setStatus('ok', 'Hotbox key bound to ' + hbKeyLabel());
  }, true);

  /* A key the open Hotbox handles is fully consumed, so other extensions on the same key (e.g. a Tab node
     search) and ComfyUI's own keybindings never see it too */
  function hbEat(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  /* Main Hotbox Trigger & In-Hotbox Quick Keys (window capture runs before every document-level listener) */
  listen(window, 'keydown', function (e) {
    if (HB.binding) return;

    /* Edit Button is waiting for the key a button should answer to */
    if (HB.keyGrab) {
      hbEat(e);
      if (!e.repeat) HB.keyGrab(e);
      return;
    }

    /* "Keep the group?" is on screen: Enter and Esc keep it, and no other key reaches the hotbox behind it */
    if (GRP_ASK) {
      hbEat(e);
      if (!e.repeat && (e.key === 'Enter' || e.key === 'Escape')) GRP_ASK.answer(true);
      return;
    }

    var undoKey = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key || '').toLowerCase() === 'z';

    /* A Hotbox window is on top (the button browser, the node editor, Edit Button): Esc closes the top one,
       Ctrl+Z takes back the last change, and nothing else reaches the hotbox or the canvas behind it */
    if (HB_MODALS.length) {
      if (e.key === 'Escape') {
        hbEat(e);
        if (!e.repeat) HB_MODALS[HB_MODALS.length - 1]();
        return;
      }
      /* a field in that window takes its own keys (each one keeps them from the canvas itself) */
      if (hbTyping()) return;
      hbEat(e);
      if (undoKey && !e.repeat) hbUndo();
      return;
    }

    /* Edit mode: Ctrl+Z takes back the last change to the bars (never the canvas's own undo) */
    if (undoKey && HB.el && HB.editMode && !hbTyping()) {
      hbEat(e);
      if (!e.repeat) hbUndo();
      return;
    }

    /* When Hotbox is open and user is not typing in the drawer search box */
    if (HB.el && !hbTyping()) {
      if (e.key === 'Escape') {
        hbEat(e);
        if (HB.wMenu) hbMenuClose();
        else if (HB.editMode) hbSetEdit(false);
        else hbClose();
        return;
      }
      if (e.key === 'Tab') {
        hbEat(e);
        hbCycleStyle();
        return;
      }
      var kl = String(e.key || '').toLowerCase();
      /* Shift + a letter is someone else's shortcut (Shift+R renders), never a hotbox quick key */
      if (!e.ctrlKey && !e.altKey && !e.metaKey && !(e.shiftKey && /^[a-z]$/.test(kl))) {
        /* a button's own key comes first: it took the key over from whatever had it */
        if (!HB.editMode && HB.custKeys && HB.custKeys[kl]) {
          hbEat(e);
          HB.custKeys[kl]();
          return;
        }
        var cardDrawer = { f: 'search', n: 'tools', a: 'models', u: 'subs' }[kl];
        if (cardDrawer) {
          hbEat(e);
          hbTogglePlus(cardDrawer);
          return;
        }
        if (kl === '+' || kl === '=') { hbEat(e); hbTogglePlus(); return; }
        if (kl === 'p' && HB.node && seedControls(HB.node).length) {
          hbEat(e);
          var cur = seedModeOf([HB.node]);
          var next = SEED_MODES[(SEED_MODES.indexOf(cur) + 1) % SEED_MODES.length] || 'fixed';
          actSeedMode([HB.node], next);
          hbPaint();
          return;
        }
        if (HB.keyMap && HB.keyMap[kl]) {
          hbEat(e);
          HB.keyMap[kl]();
          return;
        }
      }
    }

    if (!S.useHotbox) return;
    if (!hbIsKey(e) || keyMods(e) !== String(S.hbMods || '')) return;
    if (hbTyping()) return;
    hbEat(e);
    if (S.hbHold) {
      if (e.repeat) return;
      if (!HB.el) hbOpen();
      return;
    }
    if (HB.el) hbClose();
    else hbOpen();
  }, true);

  listen(document, 'keyup', function (e) {
    if (!S.hbHold || !HB.el || HB.binding) return;
    if (!hbIsKey(e)) return;
    hbClose();
  }, true);

  /* Alt+Z: Magnifier / Visual Crop / Paint Studio */
  listen(document, 'keydown', function (e) {
    if (!S.useAltZ || HB.binding) return;
    if (e.code !== 'KeyZ' && String(e.key || '').toLowerCase() !== 'z') return;
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    actAltZ();
  }, true);

  /* Alt+N: Label Studio */
  listen(document, 'keydown', function (e) {
    if (!S.useAltN || HB.binding || hbTyping()) return;
    if (e.code !== 'KeyN' && String(e.key || '').toLowerCase() !== 'n') return;
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    labelOpen(hbNode());
  }, true);

  /* Alt+R: Load in Canvas */
  listen(document, 'keydown', function (e) {
    if (!S.useAltR || HB.binding || hbTyping()) return;
    if (e.code !== 'KeyR' && String(e.key || '').toLowerCase() !== 'r') return;
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    actLoadInCanvas(hbNode());
  }, true);

  /* Shift+R: Render only the selected output nodes. Listens at window capture and consumes the key, and
     steps aside when another tool already took it (ImissNuke has the same shortcut), so one press never
     queues the same render twice */
  listen(window, 'keydown', function (e) {
    if (e.defaultPrevented || !S.useShiftR || HB.binding || hbTyping()) return;
    if (e.code !== 'KeyR' && String(e.key || '').toLowerCase() !== 'r') return;
    if (!e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    hbEat(e);
    if (e.repeat) return;
    if (HB.el) hbClose();
    actRenderSelected();
  }, true);

  /* . (Period): Zoom to Selected Node(s) & Return */
  listen(document, 'keydown', function (e) {
    if (!S.dotZoom || HB.binding || hbTyping()) return;
    if (e.key !== '.' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (LUPA.el || CE.el || PE.el || LB.on) return;
    if (!selNodes().length && !NZ.prev) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    actDotZoom();
  }, true);

  /* L: Arrange the selection (Nuke's L). With the hotbox open, L is its Add Label row instead */
  listen(document, 'keydown', function (e) {
    if (!S.useArrange || HB.binding || HB.el || hbTyping()) return;
    if (e.code !== 'KeyL' && String(e.key || '').toLowerCase() !== 'l') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (LUPA.el || CE.el || PE.el || LB.on) return;
    if (!selNodes().length) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    actArrange();
  }, true);

  /* ---------------------------------------------------------------------
   * 17. BOOTSTRAP & COMFYUI EXTENSION REGISTRATION
   * --------------------------------------------------------------------- */
  function boot() {
    injectStyles();
    setupTopBarMounting();
    probe();
    cfgBoot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* Register with ComfyUI if app is ready or when it becomes ready */
  var regTimer = setInterval(function () {
    var app = getApp();
    if (app && typeof app.registerExtension === 'function') {
      clearInterval(regTimer);
      try {
        app.registerExtension({
          name: 'Hotbox',
          setup: function () {
            boot();
          }
        });
      } catch (e) {}
    }
  }, 500);

  window.__hotbox = {
    open: hbOpen,
    close: hbClose,
    settings: openSettingsModal,
    lupa: actAltZ,
    label: labelOpen,
    loadInCanvas: actLoadInCanvas,
    zoom: actDotZoom,
    arrange: actArrange,
    swapNodes: actSwapPair,
    mergeToButton: actMagic,
    copyWorkflow: actCopyWorkflow,
    replicate: actReplicate,
    configFile: function () { return cfgPath(); },
    filesChanged: cfgFilesChanged,
    /* shared libraries, for a tool that follows the shot you are on: addLibrary(path, { label, readOnly }) */
    libraries: function () {
      return libRefresh(true).then(function (list) {
        return list.map(function (l) { return { path: l.path, label: l.label, readOnly: l.readOnly, studio: !!l.env, found: l.exists, buttons: l.count }; });
      });
    },
    addLibrary: function (path, opts) {
      opts = opts || {};
      return libSet({ add: [{ path: path, label: opts.label || '', readOnly: opts.readOnly !== false }] }).then(function () { if (HB.el) hbPaint(); });
    },
    removeLibrary: function (path) {
      return libSet({ remove: [path] }).then(function () { if (HB.el) hbPaint(); });
    },
    /* Sharing buttons from a page (see docs/REFERENCE.md): what there is to share, a pack of the chosen
       groups and saved buttons as plain JSON, and a pack added to what is here, as the next version */
    shareable: hbShareable,
    pack: hbPack,
    addPack: hbAddPack,
    /* the button browser, and the nodes of one saved button (its id) */
    browseButtons: brwOpen,
    editButton: tplEditOpen,
    isOpen: function () { return !!HB.el; },
    /* Extension bars (see BAR WIDGETS and CUSTOM_BAR.md): addBar(id, { name, where, items(ctx) }) or addBar(id, items) */
    addBar: function (id, provider) {
      window.__hotboxBars = window.__hotboxBars || {};
      window.__hotboxBars[id] = provider;
      if (HB.el) hbPaint();
    },
    repaint: function () { if (HB.el) hbPaint(); },
    removeBar: function (id) {
      if (window.__hotboxBars) delete window.__hotboxBars[id];
      if (HB.el) hbPaint();
    }
  };
})();
