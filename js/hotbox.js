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
    hbStyle: 'pro',         /* 'pro' (Fluid glass cards), 'quiet' (native panels) or 'classic' (Compact: Fluid look, bars only) */
    hbDockCat: 'models',    /* category shortcut at the end of the dock: 'models' | 'tools' | 'subs' | 'search' | 'none' */
    hbEditAnim: 'jiggle',   /* edit-mode idle animation: 'jiggle' | 'tilt' | 'float' | 'outline' */
    hbScrim: true,          /* Fluid: soft canvas dim behind the hotbox (never blurred) */
    hbLeaders: true,        /* Quiet: hairlines from the cursor to each zone */
    hbScale: 1.0,
    hbGap: 28,              /* spacing in px between node/center and hotbox bars */
    showStatusPill: true,
    /* Power tools (each one can be switched off in Settings) */
    useAltZ: true,          /* Alt+Z Magnifier / Visual Crop / Paint Studio */
    useAltN: true,          /* Alt+N Label Studio */
    useAltR: true,          /* Alt+R + [V] Load in Canvas */
    useShiftR: true,        /* Shift+R render only the selected output nodes */
    useStitch: true,        /* Super Stitch: put crops back into their plate (and keep them following) */
    useKillApi: true,       /* [K] Bypass All APIs: bypass / re-enable every API node */
    dotZoom: true,          /* . frame the selection, press again to go back */
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
    lbLast: null
  };

  var S = {};
  function loadConfig() {
    var raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY)
        || localStorage.getItem(LEGACY_STORAGE_KEY) || '{}');
    } catch (e) { raw = {}; }
    if (!raw || typeof raw !== 'object') raw = {};
    for (var k in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) {
        S[k] = (raw[k] !== undefined) ? raw[k] : JSON.parse(JSON.stringify(DEFAULTS[k]));
      }
    }
    /* Migrate any legacy apibypass in customBotBar to normal node bypass */
    if (Array.isArray(S.customBotBar)) {
      S.customBotBar = S.customBotBar.map(function (u) {
        return u === 'tool:apibypass' ? 'tool:bypass' : u;
      });
    }
    if (hbKeyRefused(S.hbKey, S.hbCode)) {
      S.hbKey = '`';
      S.hbCode = 'Backquote';
      S.hbMods = '';
    }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) {}
  }

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
    grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>'
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
      '.shb-topbar-btn{display:inline-flex !important;align-items:center !important;justify-content:center !important;min-width:32px !important;height:28px !important;padding:0 8px !important;margin:0 3px !important;background:#2b2b34 !important;border:1px solid #3c3c46 !important;border-radius:6px !important;cursor:pointer !important;transition:background-color .15s ease,border-color .15s ease,color .15s ease !important;user-select:none !important;vertical-align:middle !important;box-sizing:border-box !important;box-shadow:none !important}',
      '.shb-topbar-btn.in-grouped{margin:0 0 0 3px !important}',
      '.shb-topbar-btn.shb-floating-fallback{position:fixed !important;top:8px !important;right:16px !important;z-index:99990 !important}',
      '.shb-topbar-btn:hover{background:#383844 !important;border-color:#4c4c58 !important}',
      '.shb-topbar-btn .shb-h-icon{display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif !important;font-weight:800 !important;font-size:17.5px !important;line-height:1 !important;transform:translateY(0.5px) scale(0.90,1.22) !important;transform-origin:center center !important;color:#71717a !important;text-shadow:none !important}',
      '.shb-topbar-btn:hover .shb-h-icon{color:#e2e8f0 !important}',
      '.shb-topbar-btn.tool-on{background:#e58c2c !important;border-color:#d97706 !important}',
      '.shb-topbar-btn.tool-on .shb-h-icon{color:#ffffff !important}',
      '.shb-topbar-btn.tool-on:hover{background:#f59e0b !important;border-color:#e58c2c !important}',
      '.shb-topbar-btn.open{box-shadow:0 0 0 2px rgba(229,140,44,.45) !important}',

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
      '.shb-zone-top{transform:translate(-50%,-100%);align-items:center}',
      '.shb-zone-bot{transform:translate(-50%,0);align-items:center}',
      '.shb-zone-left{transform:translate(-100%,-50%);align-items:flex-end}',
      '.shb-zone-right{transform:translate(0,-50%);align-items:flex-start}',
      '.shb-zone-bot > .shb-plus-wrap{position:absolute;left:100%;top:50%;margin-left:12px;transform:translateY(-50%);display:flex}',
      '.shb-zone-bot.shb-plus-left > .shb-plus-wrap{left:auto;right:100%;margin-left:0;margin-right:12px}',
      '.shb-zone-drawer{transform:none;z-index:30}',
      '.shb-zone-catmenu{transform:none;z-index:31}',
      '.shb-bar,.shb-card,.shb-drawer,.shb-editbar,.shb-plus,.shb-dial-in,.shb-catmenu{zoom:var(--shb-zoom,1)}',

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
      '.shb-wrap:not(.shb-editing):not(.shb-dropping) .shb-ctx:not(:has(.shb-item-wrap,.shb-segc)){display:none}',
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
      '.shb-inbar{display:inline-grid;place-items:center;min-width:18px;height:18px;border-radius:6px;font:700 11px/1 Inter,system-ui,sans-serif;color:#64a8f0;background:rgba(100,168,240,.14)}',
      '.shb-drawer-sec{padding:6px 10px 4px;font:600 11px/1.2 Inter,system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase;color:#64a8f0}',
      '.shb-drawer-hint{padding:1px 4px 2px;font:500 10.5px/1.2 Inter,system-ui,sans-serif;color:#8e8e8e}',

      /* Bar items: × badges, removal collapse, drag source & edit-mode outline */
      '.shb-item-wrap{position:relative;display:inline-flex;align-items:center;max-width:320px}',
      '.shb-item-wrap > .shb-btn{position:relative}',
      '.shb-item-wrap.shb-removing{max-width:0;opacity:0;transform:scale(.3);overflow:hidden;transition:max-width 120ms cubic-bezier(.2,.9,.1,1),opacity 90ms ease,transform 120ms cubic-bezier(.2,.9,.1,1)}',
      '.shb-item-wrap.shb-drag-src{opacity:.35;pointer-events:none}',
      '.shb-item-wrap.shb-collapsed{max-width:0;opacity:0;overflow:hidden;transition:max-width 120ms cubic-bezier(.2,.9,.1,1),opacity 90ms}',
      '.shb-editing [data-hb-bar] .shb-btn{cursor:grab}',
      '.shb-btn.shb-outline{outline:1px dashed rgba(255,255,255,.3);outline-offset:1px}',
      '.shb-x{display:none;position:absolute;border-radius:50%;place-items:center;cursor:pointer;box-sizing:border-box;z-index:2}',
      '.shb-editing .shb-x{display:grid}',
      '.shb-editbar{display:none;align-items:center;white-space:nowrap}',
      '.shb-editing .shb-editbar{display:flex}',
      '.shb-editbar-b{border:0;background:transparent;cursor:pointer}',

      /* Ratio segmented control with sliding thumb */
      '.shb-segc{position:relative;display:flex}',
      '.shb-segc-b{position:relative;border:0;background:transparent;cursor:pointer;padding:0}',

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
      '.shb-ps-list{display:flex;flex-direction:column}',

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
      '.shb-pt-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;border:0;background:transparent;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;color:inherit}',
      '.shb-pt-row:hover{background:#262626}',
      '.shb-pt-sw{position:relative;width:28px;height:16px;border-radius:8px;background:#3a3a3a;flex-shrink:0;transition:background .12s}',
      '.shb-pt-sw::after{content:"";position:absolute;left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#bdbdbd;transition:transform .12s,background .12s}',
      '.shb-pt-row.shb-on .shb-pt-sw{background:#2f86e0}',
      '.shb-pt-row.shb-on .shb-pt-sw::after{transform:translateX(12px);background:#fff}',
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

      /* Drawer for Categories / Search / Models */
      '.shb-drawer{display:flex;flex-direction:column;gap:6px;width:320px;max-height:420px;overflow:hidden;box-sizing:border-box}',
      '.shb-search{width:100%;box-sizing:border-box;outline:none}',
      '.shb-list{display:flex;flex-direction:column;gap:1px;overflow-y:auto;max-height:290px;padding-right:2px}',

      /* ---------- 1a FLUID: frosted glass, spring motion, sliding highlights ---------- */
      '.shb-fluid{--shb-glass:rgba(38,38,42,.6);--shb-t1:#f2f2f5;--shb-t2:rgba(235,235,245,.7);--shb-t3:rgba(235,235,245,.5);--shb-blue:#2f86e0;--shb-blue2:#5aa2f0;--shb-danger:#e8735f}',
      '.shb-fluid .shb-bar,.shb-fluid .shb-card,.shb-fluid .shb-drawer,.shb-fluid .shb-editbar,.shb-fluid .shb-dial-in,.shb-fluid .shb-catmenu{background:var(--shb-glass);-webkit-backdrop-filter:blur(28px) saturate(170%);backdrop-filter:blur(28px) saturate(170%);border:1px solid rgba(255,255,255,.09);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 18px 50px rgba(0,0,0,.45);color:var(--shb-t1)}',
      '.shb-fluid .shb-scrim{position:fixed;inset:0;background:rgba(8,8,10,.16);pointer-events:none;z-index:0}',
      '.shb-fluid .shb-bar{gap:2px;padding:5px;max-width:92vw}',
      '.shb-fluid .shb-dock{border-radius:18px}',
      '.shb-fluid .shb-ctx{border-radius:15px;padding:4px;gap:6px}',
      '.shb-fluid .shb-botbar{border-radius:24px}',
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
      '.shb-ghost.shb-fluid{padding:9px 13px;border-radius:18px;background:rgba(48,48,54,.8);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.18);box-shadow:0 14px 34px rgba(0,0,0,.5);font:500 13px/1 Inter,system-ui,sans-serif;color:#fff;transform:translate(-50%,-50%) rotate(-3deg) scale(1.04);transition:transform 70ms cubic-bezier(.34,1.56,.64,1),background 60ms}',
      '.shb-ghost.shb-fluid .shb-ghost-dot{width:7px;height:7px;border-radius:50%;background:#64a8f0}',
      '.shb-ghost.shb-fluid .shb-ghost-hint{font:500 11px/1 Inter,system-ui,sans-serif;color:rgba(235,235,245,.6)}',
      '.shb-ghost.shb-fluid.shb-ghost-over{transform:translate(-50%,-50%) scale(1)}',
      '.shb-ghost.shb-fluid.shb-ghost-rm{transform:translate(-50%,-50%) scale(.9);background:rgba(120,40,36,.78)}',
      '.shb-poof.shb-fluid .shb-poof-chip{padding:9px 13px;border-radius:18px;background:rgba(120,40,36,.75);border:1px solid rgba(255,255,255,.18);font:500 13px/1 Inter,system-ui,sans-serif;color:#fff}',

      /* ---------- 1b QUIET: native ComfyUI panels, hairline leaders, monospace keys ---------- */
      '.shb-quiet{--shb-qbg:#1f1f1f;--shb-qbd:#303030;--shb-qhover:#2a2a2a;--shb-qmuted:#6f6f6f;--shb-qblue:#64a8f0;--shb-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Consolas,monospace}',
      '.shb-quiet .shb-bar,.shb-quiet .shb-card,.shb-quiet .shb-drawer,.shb-quiet .shb-editbar,.shb-quiet .shb-dial-in,.shb-quiet .shb-catmenu{background:var(--shb-qbg);border:1px solid var(--shb-qbd);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);color:#d6d6d6}',
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
      '.shb-quiet .shb-btn-primary{color:#fff}',
      '.shb-quiet .shb-btn-primary .shb-ico{color:var(--shb-qblue)}',
      '.shb-quiet .shb-danger .shb-ico{color:#e8735f}',
      '.shb-quiet .shb-pin{cursor:grab;touch-action:none}',
      '.shb-quiet .shb-pin-dot{width:5px;height:5px;background:var(--shb-qblue);flex-shrink:0}',
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
      '.shb-ghost.shb-quiet{padding:7px 10px;border-radius:6px;background:#262626;border:1px solid #3a3a3a;box-shadow:0 8px 24px rgba(0,0,0,.45);font:500 12.5px/1 Inter,system-ui,sans-serif;color:#e6e6e6}',
      '.shb-ghost.shb-quiet .shb-ghost-dot{width:5px;height:5px;background:#64a8f0}',
      '.shb-ghost.shb-quiet .shb-ghost-hint{font:500 10.5px/1 var(--shb-mono);color:#7d7d7d}',
      '.shb-ghost.shb-quiet.shb-ghost-rm{background:#2a1e1d;border-color:#6a342e}',
      '.shb-poof.shb-quiet .shb-poof-chip{padding:7px 10px;border-radius:6px;background:#2a1e1d;border:1px solid #6a342e;font:500 12.5px/1 Inter,system-ui,sans-serif;color:#e7a39a}',

      /* Modals (Label Studio, Settings, Magnifier, Crop, Paint) */
      '.shb-modal-bg{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:400 12.5px/1.4 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--shb-fg)}',
      '.shb-modal{width:min(540px,94vw);max-height:90vh;overflow-y:auto;background:var(--shb-bg);border:1px solid var(--shb-border);border-radius:8px;padding:16px 18px;box-shadow:0 12px 36px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:12px}',
      '.shb-modal-t{font:600 14px/1.2 Inter,system-ui,sans-serif;color:var(--shb-fg);display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid #333333}',
      '.shb-grid{display:grid;grid-template-columns:96px 1fr;align-items:center;gap:9px 12px}',
      '.shb-settings .shb-grid{grid-template-columns:128px 1fr}',
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
    if (def && (def.deprecated || /\(deprecated\)/i.test(String(def.display_name || '')))) return true;
    try {
      var reg = (litegraph() || {}).registered_node_types;
      var nd = reg && reg[type] && reg[type].nodeData;
      if (nd && nd.deprecated) return true;
    } catch (e) {}
    return false;
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
    SRV.probing = apiFetch('/object_info')
      .then(function (r) { return r && r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (info) {
        SRV.types = info || {};
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
              api: false,
              isSub: true,
              rank: ndRank(item.name || k, k)
            });
          });
        }
        SRV.subgraphs = list;
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

  function visBox(n) {
    var p = (n && n.pos) || [0, 0];
    var s = (n && n.size) || [240, 120];
    var collapsed = !!(n && n.flags && n.flags.collapsed);
    return {
      x: +p[0] || 0,
      y: +p[1] || 0,
      w: collapsed ? 190 : Math.max(140, +s[0] || 240),
      h: collapsed ? 32 : Math.max(60, +s[1] || 120)
    };
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
    /* Only API nodes default to Swap mode; all standard nodes use Add/Connect mode */
    return ndKind(node) !== 'api';
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
    return ndKind(node) || 'other';
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
        out.push(w);
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
      setStatus('ok', 'Seed mode set to "' + mode + '" on ' + count + ' control' + (count === 1 ? '' : 's'));
    } else {
      setStatus('error', 'No seed control_after_generate widget found on this node');
    }
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
  function swapMates(node, kind) {
    var want = kind || genOut(node);
    var cur = node ? String(node.type || node.comfyClass || '') : '';
    return (SRV.models || []).filter(function (m) {
      return m.type !== cur && (!want || m.kind === want || m.api);
    });
  }

  function ndMates(node) {
    var cur = node ? String(node.type || node.comfyClass || '') : '';
    return (SRV.models || []).filter(function (m) {
      return m.type !== cur;
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
    function findSrc(name) {
      for (var i = 0; i < src.length; i++) {
        if (src[i] && src[i].name === name) return src[i];
      }
      for (var k in aliases) {
        if (aliases[k].indexOf(name) >= 0) {
          for (var j = 0; j < src.length; j++) {
            if (src[j] && aliases[k].indexOf(src[j].name) >= 0) return src[j];
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

  function createNodeOrSubgraph(type, pos) {
    var g = getGraph();
    var LG = litegraph();
    if (!g || !LG || !LG.createNode) return null;
    var realType = String(type || '');
    if (realType.indexOf('subgraph:') === 0) {
      realType = realType.slice(9);
    }
    var made = null;
    try { made = LG.createNode(realType); } catch (e) { made = null; }
    if (!made && realType !== type) {
      try { made = LG.createNode(type); } catch (e) { made = null; }
    }
    if (!made) return null;
    made.pos = [Math.round(pos[0]), Math.round(pos[1])];
    g.add(made);
    hbAvoidOverlap(g, made);
    hbWiggleNode(made);
    return made;
  }

  /* A new node never lands on top of another one: it slides down, past whatever it would cover,
     until its spot (title bar included, plus a small gap) is free */
  function hbAvoidOverlap(graph, made) {
    if (!graph || !made || !made.pos) return;
    var LG = litegraph();
    var TH = (LG && LG.NODE_TITLE_HEIGHT) || 30, GAP = 30;
    function box(n) {
      var b = visBox(n);
      return { x: b.x, y: b.y - TH, w: b.w, h: b.h + TH };
    }
    var others = allNodes(graph).filter(function (n) { return n !== made && n.pos; }).map(box);
    var me = box(made), y0 = me.y;
    for (var i = 0; i < 80; i++) {
      var hit = null;
      for (var k = 0; k < others.length && !hit; k++) {
        var o = others[k];
        if (me.x < o.x + o.w + GAP && me.x + me.w + GAP > o.x && me.y < o.y + o.h + GAP && me.y + me.h + GAP > o.y) hit = o;
      }
      if (!hit) break;
      me.y = hit.y + hit.h + GAP;
    }
    if (me.y !== y0) nodeMoveTo(made, made.pos[0], made.pos[1] + (me.y - y0));
  }

  /* Connect all compatible slots between srcNode and dstNode (multi-slot aware, e.g. MODEL + CLIP) */
  function wireNodesSmart(node, made, vb) {
    if (!node || !made) return '';
    var wiredList = [];
    var outs = node.outputs || [];
    var ins = made.inputs || [];
    var usedOut = {};

    /* Pass 1: Exact slot type matches from node.outputs -> made.inputs (connects MODEL + CLIP + VAE together!) */
    for (var o = 0; o < outs.length; o++) {
      var oType = String((outs[o] && outs[o].type) || '').toUpperCase();
      if (!oType || oType === '*') continue;
      for (var i = 0; i < ins.length; i++) {
        if (ins[i].link != null) continue;
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
        if (usedOut[o2]) continue;
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
    try { if (c && c.selectNodes) c.selectNodes([made]); } catch (e) {}
    try { g.setDirtyCanvas(true, true); } catch (e) {}
    setStatus('ok', '⊕ Added ' + (made.title || made.type) + (wired ? ' (wired → ' + wired + ')' : ''));
    return made;
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
    var made = createNodeOrSubgraph(type, pos);
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
     (where the model goes — the one part of the trip this tool cannot build) and "Stitch" */
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
    var gx = x1 + 120, sx = gx + STITCH_HOLE_W + 120;
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
    if (gp.had) return;
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
      if (!gp) { gp = { plate: pl, crops: [] }; groups.push(gp); }
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
    });
    var mades = all.map(function (r) { return r.made; });
    try { if (c && c.selectNodes) c.selectNodes(mades); } catch (e) {}
    try { g.setDirtyCanvas(true, true); } catch (e) {}
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
      node.title = (isSetNode(node) ? 'Set_' : 'Get_') + val;
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
  function hbAvoidRect(nodeRect) {
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
      all.forEach(function (m) {
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
      addget:     { id: 'addget',     icon: 'plus',       label: 'Paired Get',     kbd: 'G', fn: function () { addGetNode(node); } },
      bypass:     { id: 'bypass',     icon: 'bypass',     label: 'Bypass',         kbd: 'B', cls: (node && node.mode === 4) ? 'shb-btn-on' : '', fn: function () { actBypass(node); } },
      mute:       { id: 'mute',       icon: 'bypass',     label: 'Mute Node',      kbd: 'M', cls: (node && node.mode === 2) ? 'shb-btn-on' : '', fn: function () { actMute(node); } },
      apibypass:  { id: 'apibypass',  icon: 'zapOff',     label: 'Bypass All APIs', kbd: 'K', fn: function () { actBypassApi(); } },
      zoom:       { id: 'zoom',       icon: 'zoom',       label: 'Zoom',           kbd: '.', fn: function () { actDotZoom(node); } },
      render:     { id: 'render',     icon: 'play',       label: 'Render Selected', kbd: '⇧R', fn: function () { actRenderSelected(); } },
      stitch:     { id: 'stitch',     icon: 'stitch',     label: 'Super Stitch',   kbd: '',  fn: function () { actStitch(node); } },
      stitchupd:  { id: 'stitchupd',  icon: 'sync',       label: 'Update Stitch',  kbd: '',  fn: function () { actStitchUpdate(node); } },
      stitchswap: { id: 'stitchswap', icon: 'swap',       label: 'Swap FG / BG',   kbd: '',  fn: function () { actStitchSwap(node); } },
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
    zoom: 'dotZoom'
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

    if (k === 'crop') {
      ids.push('cropedit', 'stitch');
      if (stitchesOf(getGraph(), node).length) ids.push('stitchupd');
      CROP_ASPECTS.slice(0, 5).forEach(function (ar) { ids.push('ar_' + ar); });
    } else if (k === 'stitch') {
      ids.push('stitchupd', 'stitchswap', 'prev', 'saveimg');
    } else if (k === 'api' || isSubgraphNode(node)) {
      /* a generator's first question is "keep it": save comes first, video or image by what it outputs */
      if (hasVid || (k === 'api' && genOut(node) === 'video')) ids.push('savevid', 'gvc');
      if (hasImg) ids.push('saveimg', 'prev', 'crop', 'rsz', 'cmp');
      if (hasImg && stitchTargets(getGraph(), node).crops.length) ids.push('stitch');
    } else if (k === 'paint') {
      ids.push('paintedit', 'prev', 'cmp', 'saveimg');
    } else if (k === 'set') {
      ids.push('setinh', 'addget');
    } else if (k === 'get') {
      setNames().forEach(function (nm) { ids.push('get_' + nm); });
    } else {
      if (hasImg) {
        ids.push('crop', 'rsz', 'flip');
        if (paintType()) ids.push('paint');
        ids.push('cmp', 'saveimg');
      }
      if (hasVid) {
        ids.push('gvc');
        if (batchType()) ids.push('batch');
        ids.push('savevid');
      }
      if (hasImg && (canMake(CREATE_VIDEO_TYPE) || hasType(CREATE_VIDEO_TYPE))) {
        ids.push('mkvid');
      }
      /* a plate that crops cut, or a result that came out of a crop, can be stitched back */
      if (hasImg && stitchTargets(getGraph(), node).crops.length) ids.push('stitch');
      if (k === 'load') {
        ids.push('wf', 'seed');
      }
    }
    return ids.filter(function (id) {
      return hbToolOn(id) && !hbToolIsSelf(id, node);
    }).map(function (id) { return mt[id]; }).filter(Boolean);
  }

  /* Resolve any bar item uid ('model:...', 'node:...', 'tool:...') into a unified renderable & executable item */
  function resolveBarItem(uid, node) {
    if (!uid) return null;
    var u = String(uid);
    var customLbl = (S.customLabels && S.customLabels[u]) || '';
    var isAdd = ndAdds(node);
    var sel = selNodes();
    var isPair = sel.length >= 2 && isAdd;

    if (u.indexOf('tool:') === 0) {
      var tid = u.slice(5);
      /* A power tool switched off in Settings is gone everywhere */
      if (!hbToolOn(tid)) return null;
      /* Hide node-specific tools on empty canvas (unless in edit mode) to prevent bottom bar clutter */
      if (!HB.editMode) {
        if (!node && /^(prev|loadcanvas|bypass|mute|seedtoggle|rename|reroute|set|addget|setinh|stitch|stitchupd|stitchswap)$/.test(tid)) {
          return null;
        }
        if (node && tid === 'prev' && imageOutSlot(node) < 0 && !isPreviewNode(node)) {
          return null;
        }
        if (node && tid === 'seedtoggle' && !seedControls(node).length) {
          return null;
        }
        if (tid === 'loadcanvas' && !hbHasImage(node)) {
          return null;
        }
        if (hbToolIsSelf(tid, node)) {
          return null;
        }
      }
      var mt = getMasterTools(node);
      var t = mt[tid];
      if (!t) return null;
      return {
        uid: u,
        kind: 'tool',
        id: tid,
        label: customLbl || t.label,
        title: t.label,
        icon: t.icon || 'plus',
        kbd: t.kbd || '',
        cls: t.cls || '',
        stayOpen: !!t.stayOpen,
        run: t.fn
      };
    }

    if (u.indexOf('model:') === 0) {
      var mType = u.slice(6);
      var mObj = null;
      for (var i = 0; i < (SRV.models || []).length; i++) {
        if (SRV.models[i].type === mType) { mObj = SRV.models[i]; break; }
      }
      var def = (SRV.types && SRV.types[mType]) || null;
      var rawName = (mObj && mObj.name) || (def && def.display_name) || mType;
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
        cls: 'shb-btn-pri',
        run: function () {
          if (isPair) addModelPair(sel, mType);
          else if (isAdd) addModel(node, mType);
          else swapNode(node, mType);
        }
      };
    }

    if (u.indexOf('node:') === 0) {
      var nType = u.slice(5);
      if (!HB.editMode && (hbSameNode(nType, node) || isDeprecatedType(nType))) return null;
      var nDef = (SRV.types && SRV.types[nType]) || null;
      var subName = '';
      if (nType.indexOf('subgraph:') === 0) {
        var sid = nType.slice(9);
        (SRV.subgraphs || []).forEach(function (sg) { if (sg.subId === sid || sg.type === nType) subName = sg.name; });
      }
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
          if (isPair) addModelPair(sel, nType);
          else addModel(node, nType);
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

    /* API nodes use Swap mode with top API models */
    if (ndKind(node) === 'api') {
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
      var out = [];
      if (hbHasImage(node)) out.push('tool:loadcanvas');
      if (node && (imageOutSlot(node) >= 0 || isPreviewNode(node))) out.push('tool:prev');
      if (node && seedControls(node).length) out.push('tool:seedtoggle');
      if (node) out.push('tool:bypass');
      out.push('tool:zoom');
      var hasApi = allNodes(getGraph()).some(function (n) {
        return !!(SRV.api && SRV.api[String(n.type || n.comfyClass || '')]);
      });
      if (hasApi) out.push('tool:apibypass');
      hbPinList(node).forEach(function (t) {
        var u = 'node:' + t;
        if (out.indexOf(u) < 0) out.push(u);
      });
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

  function promptRenameBarItem(uid, node) {
    var item = resolveBarItem(uid, node);
    if (!item) return;
    var bg = owns(document.createElement('div'));
    bg.className = 'shb-modal-bg';
    bg.innerHTML =
      '<div class="shb-modal" style="width:min(360px,92vw)">' +
        '<div class="shb-modal-t"><span>Rename Button Label</span></div>' +
        '<input class="shb-input" data-rbi-in value="' + esc(item.label) + '" placeholder="Custom button name…">' +
        '<div style="display:flex;justify-content:space-between;gap:8px">' +
          '<button class="shb-btn" data-rbi-reset>Default Name</button>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="shb-btn" data-rbi-cancel>Cancel</button>' +
            '<button class="shb-btn shb-btn-pri" data-rbi-ok>Save</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bg);
    var inp = bg.querySelector('[data-rbi-in]');
    function close() { if (bg.parentNode) bg.parentNode.removeChild(bg); }
    function saveLbl(val) {
      if (!S.customLabels || typeof S.customLabels !== 'object') S.customLabels = {};
      if (val) S.customLabels[uid] = val;
      else delete S.customLabels[uid];
      save();
      close();
      hbPaint();
    }
    bg.addEventListener('mousedown', function (ev) { if (ev.target === bg) close(); });
    bg.querySelector('[data-rbi-cancel]').onclick = close;
    bg.querySelector('[data-rbi-reset]').onclick = function () { saveLbl(''); };
    bg.querySelector('[data-rbi-ok]').onclick = function () { saveLbl(String(inp.value || '').trim()); };
    inp.onkeydown = function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); saveLbl(String(inp.value || '').trim()); }
      if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    };
    try { inp.focus(); inp.select(); } catch (e) {}
  }

  function renderBarItemHTML(item, barName, numKey) {
    var kbdStr = numKey ? String(numKey) : (item.kbd || '');
    var isPin = barName === 'bot' && item.kind !== 'tool';
    var btnCls = 'shb-btn ' + (barName === 'add' ? 'shb-fav' : (isPin ? 'shb-pin' : (barName === 'bot' ? 'shb-act' : 'shb-tool')));
    if (barName === 'tools' && /^(cropedit|paintedit|lupa)$/.test(item.id)) btnCls += ' shb-btn-primary';
    if (item.id === 'apibypass') btnCls += ' shb-danger';
    if (item.cls && item.cls !== 'shb-btn-pri') btnCls += ' ' + item.cls;
    var lead = numKey ? '<span class="shb-num">' + esc(kbdStr) + '</span>'
      : (isPin ? '<i class="shb-pin-dot"></i>' : ico(item.icon || 'plus', hbIsFluid() ? 15 : 13));
    var hint = isPin ? 'Drag out of the bar to unpin · Hold to edit' : 'Hold to edit · Drag out of the bar to remove';
    return '<span class="shb-item-wrap" data-hb-uid="' + esc(item.uid) + '" data-hb-bar="' + esc(barName) + '">' +
      '<button type="button" class="' + btnCls + '" data-hb-run="' + esc(item.uid) + '" title="' + esc(item.title + ' (' + hint + ')') + '">' +
        lead +
        '<span class="shb-lbl">' + esc(item.label) + '</span>' +
        (!numKey && !isPin && kbdStr ? '<span class="shb-key">' + esc(kbdStr) + '</span>' : '') +
        '<span class="shb-x" data-hb-rm="' + esc(item.uid) + '" data-hb-rmbar="' + esc(barName) + '" title="Remove">×</span>' +
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
        'rename', 'reroute', 'set', 'addget', 'bypass', 'mute', 'render', 'apibypass', 'zoom', 'seedtoggle'
      ];
      var allToolsList = allToolIds.filter(hbToolOn).map(function (id) { return mt[id]; }).filter(Boolean);
      var filteredTools = allToolsList.filter(function (t) {
        return !q || t.label.toLowerCase().indexOf(q) >= 0 || t.id.toLowerCase().indexOf(q) >= 0;
      });
      var resizeList = resizeKinds();
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
      var allM = isAdd ? ndMates(node) : swapMates(node, '');
      var listM = allM.filter(function (m) {
        return !q || m.name.toLowerCase().indexOf(q) >= 0 || m.type.toLowerCase().indexOf(q) >= 0;
      }).slice(0, 60);
      return '<div class="shb-drawer">' +
        '<div class="shb-card-hd"><span>' + (isAdd ? 'Models & APIs' : 'Swap Model') + '</span><span>' + allM.length + '</span></div>' +
        drawerTabsHTML +
        '<input class="shb-search" data-hb-q value="' + esc(HB.q) + '" placeholder="Search models…">' +
        '<div class="shb-list">' +
          (listM.length ? listM.map(function (m) {
            var uid = 'model:' + m.type;
            var inBar = allPinned.indexOf(uid) >= 0;
            return '<button type="button" class="shb-btn shb-btn-row" data-hb-model="' + esc(m.type) + '" data-drawer-uid="' + esc(uid) + '" title="Drag to any bar to pin · Click to ' + (isAdd ? 'add' : 'swap') + '" style="cursor:grab">' +
              '<span style="overflow:hidden;text-overflow:ellipsis">' + esc(m.name) + '</span>' +
              '<span style="display:inline-flex;align-items:center;gap:4px">' +
                (inBar ? '<span class="shb-inbar">✓</span>' : '') +
                '<span class="shb-kbd">' + (m.kind === 'video' ? 'VID' : 'IMG') + '</span>' +
              '</span>' +
            '</button>';
          }).join('') : '<div style="padding:10px;color:#888888">No matching models found</div>') +
        '</div>' +
      '</div>';
    }

    if (d === 'subs') {
      var subs = (SRV.subgraphs || []).filter(function (s) {
        return !q || s.name.toLowerCase().indexOf(q) >= 0;
      });
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
      var types = allTypes().filter(function (t) {
        if (!q) return sugTypes.indexOf(t) < 0;
        var disp = (SRV.types && SRV.types[t] && SRV.types[t].display_name) || '';
        return t.toLowerCase().indexOf(q) >= 0 || disp.toLowerCase().indexOf(q) >= 0;
      }).slice(0, 70);
      var outSlotsLabel = nodeOutputSlotTypes(node).join(', ');
      return '<div class="shb-drawer">' +
        '<div class="shb-card-hd"><span>Add Node (Drag to Bar)</span><span>' + (sugTypes.length + types.length) + '</span></div>' +
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
            return '<button type="button" class="shb-btn shb-btn-row" data-hb-create="' + esc(t) + '" data-drawer-uid="' + esc(uid) + '" title="Drag to any bar to pin · Click to add ' + esc(disp) + '" style="cursor:grab">' +
              '<span style="overflow:hidden;text-overflow:ellipsis">' + esc(disp) + '</span>' +
              (inBar ? '<span class="shb-inbar">✓</span>' : '') +
            '</button>';
          }).join('') +
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
    return t === 'quiet' ? 'shb-quiet' : (t === 'classic' ? 'shb-fluid shb-classic' : 'shb-fluid');
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

  function hbEditBarHTML() {
    var fl = hbIsFluid();
    return '<div class="shb-editbar">' +
      '<span class="shb-editbar-t">' + (fl ? 'Tap × or drag out to remove · tap to rename' : 'edit · × or drag out · tap = rename') + '</span>' +
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
    var st = S.hbEditAnim || 'jiggle';
    var btns = HB.el.querySelectorAll('[data-hb-bar] > .shb-item-wrap > .shb-btn');
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

  function hbSetEdit(on) {
    on = !!on;
    var was = !!HB.editMode;
    HB.editMode = on;
    if (!HB.el) return;
    HB.el.classList.toggle('shb-editing', on);
    var tb = HB.el.querySelector('[data-hb-act="toggleedit"]');
    if (tb) tb.classList.toggle('shb-btn-on', on);
    hbSyncEditAnim();
    if (on === was) return;
    hbPlace();
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
    add('[data-zone="bot"] > .shb-bar', 'translateY(-60px) scale(.55)', 'translateY(-5px)', 50, 40);
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
    var rb = rectOf('[data-zone="bot"] > .shb-bar');
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
    return HB.el ? HB.el.querySelector('[data-zone="bot"] > .shb-bar') : null;
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
    var b = HB.el.querySelector('[data-hb-bar] > .shb-item-wrap[data-hb-uid="' + cssEsc(uid) + '"] > .shb-btn');
    if (b) hbWiggle(b, hbAmp());
  }

  /* The standalone "+" opens the Add drawer right beside itself. The "+" itself toggles (All Nodes);
     a category picked from its dial (or F / N / A / G) switches straight to that category. */
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
      var addItems = getBarUids('add', node).map(function (u) { return resolveBarItem(u, node); }).filter(Boolean);
      var toolItems = getBarUids('tools', node).map(function (u) { return resolveBarItem(u, node); }).filter(Boolean);
      var botItems = getBarUids('bot', node).map(function (u) { return resolveBarItem(u, node); }).filter(Boolean);
      var isAdd = ndAdds(node);
      var sel = selNodes();
      var isPair = sel.length >= 2 && isAdd;
      HB.keyMap = {};

      /* Register instant single-key shortcuts [1]..[9] for Top Add Bar items */
      addItems.slice(0, 9).forEach(function (it, idx) {
        var k = String(idx + 1);
        HB.keyMap[k] = function () {
          if (!it.stayOpen) hbClose();
          if (it.run) it.run();
        };
      });
      if (hbToolOn('label')) HB.keyMap['l'] = function () { hbClose(); labelOpen(node); };
      HB.keyMap['f2'] = function () { hbClose(); actRenameNode(node); };
      HB.keyMap['r'] = function () { hbClose(); addReroute(node); };
      HB.keyMap['s'] = function () { hbClose(); addSetNode(node); };
      if (hbToolOn('loadcanvas')) HB.keyMap['v'] = function () { hbClose(); actLoadInCanvas(node); };
      HB.keyMap['t'] = function () { hbClose(); addPreview(node); };
      HB.keyMap['b'] = function () { hbClose(); actBypass(node); };
      HB.keyMap['m'] = function () { hbClose(); actMute(node); };
      if (hbToolOn('apibypass')) HB.keyMap['k'] = function () { hbClose(); actBypassApi(); };
      if (hbToolOn('lupa')) HB.keyMap['z'] = function () { hbClose(); actAltZ(node); };
      if (hbToolOn('zoom')) HB.keyMap['.'] = function () { hbClose(); actDotZoom(node); };
      if (toolItems[0] && toolItems[0].run) {
        HB.keyMap['c'] = function () {
          if (!toolItems[0].stayOpen) hbClose();
          toolItems[0].run();
        };
      }

      el.className = 'shb-wrap ' + hbThemeCls() + (HB.editMode ? ' shb-editing' : '');
      hbPaintPro(el, node, tools, addItems, toolItems, botItems, isAdd, isPair, sel, S.hbStyle === 'classic');

      hbPlace();
      hbSyncEditAnim();
      var qIn = el.querySelector('[data-hb-q]');
      if (qIn && document.activeElement !== qIn) {
        try { qIn.focus(); qIn.setSelectionRange(qIn.value.length, qIn.value.length); } catch (e) {}
      }
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

    return list.slice(0, 8);
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
    return '<div class="shb-ps-list">' +
      numWidgets.map(function (it) {
        var span = (it.sMax - it.sMin) || 1;
        var pct = Math.max(0, Math.min(100, ((it.val - it.sMin) / span) * 100));
        return '<div class="shb-ps" data-ps-row="' + it.wIdx + '">' +
          '<div class="shb-ps-track" data-ps-track="' + it.wIdx + '" title="Drag to scrub · Shift = fine · Ctrl+Click = previous value · Double-click = default (' + esc(formatSliderVal(it, it.defVal)) + ') · Wheel = nudge">' +
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

  /* The four Add categories: they fan out above the "+", and one of them can live at the end of the dock */
  var HB_CATS = {
    search: { icon: 'search', label: 'All Nodes', short: 'All Nodes', key: 'F' },
    tools: { icon: 'crop', label: 'Image / Video Kit', short: 'Kit', key: 'N' },
    models: { icon: 'star', label: 'Models & APIs', short: 'Models', key: 'A' },
    subs: { icon: 'subgraph', label: 'Subgraphs', short: 'Subgraphs', key: 'G' }
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
        ((!isAdd || isPair) ? '<span class="shb-dock-mode" title="' + (isPair ? 'Adds the model and wires both selected loaders' : 'Swaps the selected model in place') + '">' +
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
    if (ctxItems.length || ratioItems.length || HB.editMode) {
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
      var hdTitle = fl ? nodeTitle : String(nodeTitle).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      leftHTML = '<div class="shb-zone shb-zone-left" data-zone="left">' +
        '<div class="shb-card shb-card-left">' +
          headHTML((hdTitle || 'node').slice(0, 28), node ? '<span class="shb-hd-id">#' + esc(node.id) + '</span>' : '') +
          rowsHTML(leftRows) +
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
      var pEl = zBot.querySelector(':scope > .shb-plus-wrap');
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
    var dom = {}, shown = [];
    ['add', 'tools', 'bot'].forEach(function (barName) {
      var container = rootEl.querySelector('[data-hb-bar="' + barName + '"]');
      if (!container) return;
      var uids = [];
      Array.prototype.forEach.call(container.querySelectorAll('[data-hb-uid]'), function (el) {
        var u = el.getAttribute('data-hb-uid');
        if (u && uids.indexOf(u) < 0) uids.push(u);
      });
      dom[barName] = uids;
      shown = shown.concat(uids);
    });
    Object.keys(dom).forEach(function (barName) {
      var keep = dom[barName];
      getBarUids(barName, node).forEach(function (u) {
        if (u !== removedUid && shown.indexOf(u) < 0) keep.push(u);
      });
      setBarUids(barName, node, keep);
    });
  }

  /* Long-Press (420ms) Edit Mode, Bar Drags, Drawer Drag-to-Bar, Canvas Node Drag-to-Pin & Pro Slider Scrubbing */
  var LP_DRAG = null;
  var DRAWER_DRAG = null;
  var PSLIDER_DRAG = null;
  var NODE_DRAG = null;

  function clearLpDrag() {
    if (!LP_DRAG) return;
    if (LP_DRAG.timer) clearTimeout(LP_DRAG.timer);
    if (LP_DRAG.wrap) {
      LP_DRAG.wrap.classList.remove('shb-drag-src');
      LP_DRAG.wrap.classList.remove('shb-collapsed');
    }
    if (LP_DRAG.active) ghostHide();
    LP_DRAG = null;
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

  function nodeTypeOf(node) {
    return node ? String(node.type || node.comfyClass || '') : '';
  }

  function clearDrawerDrag() {
    if (!DRAWER_DRAG) return;
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
    var bars = rootEl.querySelectorAll('.shb-bar');
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
        var dItem = resolveBarItem(DRAWER_DRAG.uid, HB.node);
        if (!dItem) { clearDrawerDrag(); return; }
        DRAWER_DRAG.active = true;
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
      var botC = HB.el.querySelector('[data-hb-bar="bot"]');
      var target = null, before = null;
      if (botC && hbOverPlus(px, py, 16)) {
        target = botC;
      } else if (distToNearestBar(HB.el, px, py) <= 34) {
        var underEl = null;
        try { underEl = document.elementFromPoint(px, py); } catch (err) { underEl = null; }
        if (underEl && underEl.closest) {
          var overWrapEl = underEl.closest('.shb-item-wrap[data-hb-uid]');
          var overBarBox = underEl.closest('.shb-bar');
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
      hbSetBotDrop(!!(target && target === botC), false);
      ghostMove(px, py, target ? 'Release to pin' : 'Drag onto a bar or +', target ? 'over' : '');
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

    /* 2. Bar buttons: reorder within / across bars, drag out to remove (pins anytime, others in edit mode) */
    if (!LP_DRAG || !HB.el) return;
    var dist = Math.hypot(e.clientX - LP_DRAG.x0, e.clientY - LP_DRAG.y0);
    if (!LP_DRAG.active) {
      if (dist <= 6) return;
      if (LP_DRAG.timer) { clearTimeout(LP_DRAG.timer); LP_DRAG.timer = 0; }
      if (!HB.editMode && !LP_DRAG.isPin) { clearLpDrag(); return; }
      LP_DRAG.active = true;
      LP_DRAG.wrap.classList.add('shb-drag-src');
      var lblEl = LP_DRAG.wrap.querySelector('.shb-lbl');
      ghostShow(lblEl ? lblEl.textContent : '', e.clientX, e.clientY);
    }
    e.preventDefault();

    var dragWrap = LP_DRAG.wrap;
    var out = distToNearestBar(HB.el, e.clientX, e.clientY) > 34 && !hbOverPlus(e.clientX, e.clientY, 16);
    if (out !== !!LP_DRAG.outside) {
      LP_DRAG.outside = out;
      dragWrap.classList.toggle('shb-collapsed', out);
    }
    ghostMove(e.clientX, e.clientY, out ? 'Release to remove' : 'Drag out to remove', out ? 'rm' : '');
    if (out) return;

    var under = null;
    try { under = document.elementFromPoint(e.clientX, e.clientY); } catch (err) { under = null; }
    if (!under || !under.closest) return;

    var overWrap = under.closest('.shb-item-wrap[data-hb-uid]');
    if (overWrap && overWrap !== dragWrap && overWrap.parentNode) {
      var r = overWrap.getBoundingClientRect();
      var isBefore = e.clientX < (r.left + r.width / 2);
      overWrap.parentNode.insertBefore(dragWrap, isBefore ? overWrap : overWrap.nextSibling);
      return;
    }
    var overBar = under.closest('[data-hb-bar]');
    if (overBar && overBar !== dragWrap.parentNode) {
      overBar.appendChild(dragWrap);
    }
  }, true);

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
      if (dd.active && HB.el) {
        HB.suppressClickUntil = Date.now() + 260;
        HB.el.classList.remove('shb-dropping');
        hbSetBotDrop(false);
        var dw = dd.wrap;
        if (dd.inBar && dw && dw.parentNode && dw.parentNode.hasAttribute('data-hb-bar')) {
          dw.classList.remove('shb-drag-src');
          commitDomBarsOrder(HB.el, HB.node);
          hbPaint();
          hbFlashUid(dd.uid);
          setStatus('ok', '📌 Pinned "' + (dd.item ? dd.item.label : 'button') + '"');
        } else if (dw && dw.parentNode) {
          dw.parentNode.removeChild(dw);
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
    if (!lp.active) {
      /* A long-press that only entered edit mode must not also run the button */
      if (lp.fired) HB.suppressClickUntil = Date.now() + 250;
      return;
    }
    ghostHide();
    HB.suppressClickUntil = Date.now() + 250;
    if (!HB.el) return;
    var w = lp.wrap;
    var uid = w.getAttribute('data-hb-uid');
    var lbl = w.querySelector('.shb-lbl');
    var name = lbl ? lbl.textContent : uid;
    if (lp.outside) {
      if (w.parentNode) w.parentNode.removeChild(w);
      hbPoof(e.clientX, e.clientY, name);
      commitDomBarsOrder(HB.el, HB.node, uid);
      hbPaint();
      setStatus('ok', 'Removed "' + name + '" · Reset (edit mode) restores the defaults');
    } else {
      w.classList.remove('shb-drag-src', 'shb-collapsed');
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
    HB.el = null; HB.node = null; HB.rect = null; HB.drawer = ''; HB.drawerAnchor = null; HB.editMode = false; HB.q = ''; HB.keyMap = {}; HB.catMenu = false;
    if (old) {
      old.removeAttribute('id');
      hbAnimateClose(old, cx, cy);
    }
  }

  function hbOpen() {
    hbClose();
    if (!SRV.probed) probe().then(function () { if (HB.el) hbPaint(); });
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
    hbPaint();
    hbAnimateOpen();

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

      if (t.closest('[data-hb-rm]') || t.closest('[data-hb-ren]')) return;

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
        isPin: wrap.getAttribute('data-hb-bar') === 'bot' && wUid.indexOf('tool:') !== 0,
        timer: HB.editMode ? 0 : setTimeout(function () {
          if (!LP_DRAG || LP_DRAG.wrap !== wrap || !HB.el) return;
          LP_DRAG.timer = 0;
          LP_DRAG.fired = true;
          hbSetEdit(true);
        }, 420)
      };
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

    /* Mouse wheel over a Pro Slider row nudges the value smoothly */
    el.addEventListener('wheel', function (e) {
      var t = e.target;
      if (!t || !t.closest || !HB.node) return;
      var rowEl = t.closest('.shb-ps[data-ps-row]');
      if (!rowEl) return;
      e.preventDefault();
      e.stopPropagation();
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

      var rmBtn = t.closest('[data-hb-rm]');
      if (rmBtn) {
        e.stopPropagation();
        var rmUid = rmBtn.getAttribute('data-hb-rm');
        var rmBar = rmBtn.getAttribute('data-hb-rmbar') || 'add';
        var rmWrap = rmBtn.closest('.shb-item-wrap');
        if (rmWrap) rmWrap.classList.add('shb-removing');
        /* Collapse first (max-width -> 0, scale .3, fade), then drop it from the list */
        setTimeout(function () {
          var curList = getBarUids(rmBar, HB.node).filter(function (u) { return u !== rmUid; });
          setBarUids(rmBar, HB.node, curList);
          if (HB.el) hbPaint();
        }, 130);
        return;
      }

      var renBtn = t.closest('[data-hb-ren]');
      if (renBtn) {
        e.stopPropagation();
        promptRenameBarItem(renBtn.getAttribute('data-hb-ren'), HB.node);
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

      var runBtn = t.closest('[data-hb-run]');
      if (runBtn && HB.editMode && runBtn.closest('[data-hb-bar]')) {
        /* In edit mode a tap renames the button instead of running it */
        promptRenameBarItem(runBtn.getAttribute('data-hb-run'), HB.node);
        return;
      }
      if (runBtn) {
        var rUid = runBtn.getAttribute('data-hb-run');
        var item = resolveBarItem(rUid, HB.node);
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
        if (sel.length >= 2 && ndAdds(n)) addModelPair(sel, mType);
        else if (ndAdds(n)) addModel(n, mType);
        else swapNode(n, mType);
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
        if (a === 'editreset') {
          S.customAddBar = null;
          S.customAddBySig = {};
          S.customToolsBar = {};
          S.customBotBar = null;
          S.customLabels = {};
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
        else if (a === 'loadcanvas') actLoadInCanvas(node);
        else if (a === 'preview') addPreview(node);
        else if (a === 'bypass') actBypass(node);
        else if (a === 'apibypass') actBypassApi();
        else if (a === 'zoom') actDotZoom(node);
      }
    };

    el.oninput = function (e) {
      var t = e.target;
      if (t && t.hasAttribute('data-hb-q')) {
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

  function isTopBarBtnProperlyMounted(btn) {
    if (!btn || !btn.parentNode || !document.body.contains(btn)) return false;
    var imissBtn = document.getElementById('imissnuke-topbar-btn');
    if (imissBtn && imissBtn.parentNode && document.body.contains(imissBtn) && isElemVisible(imissBtn)) {
      return btn.previousElementSibling === imissBtn;
    }
    var p = btn.closest('.comfyui-menu, .comfyui-menu-actions, .comfyui-top-menu, .comfy-menu, .comfyui-button-group');
    if (p && isElemVisible(p)) return true;
    return false;
  }

  function updateTopBarButtonState() {
    var btn = document.getElementById(PANEL_ID + '-topbar-btn');
    if (!btn) return;
    var isEnabled = !!S.useHotbox;
    btn.classList.toggle('tool-on', isEnabled);
    btn.title = 'Hotbox (' + (isEnabled ? 'Enabled · ' + hbKeyLabel() : 'Disabled') + ') - Settings (Right-click to toggle)';
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
      btn.innerHTML = '<span class="shb-h-icon">H</span>';
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
    updateTopBarButtonState();

    if (isTopBarBtnProperlyMounted(btn)) {
      var imissNow = document.getElementById('imissnuke-topbar-btn');
      if (imissNow) {
        btn.classList.toggle('in-grouped', imissNow.classList.contains('in-grouped'));
      }
      return true;
    }

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
    [50, 150, 300, 600, 1200, 2500, 5000].forEach(function (d) {
      setTimeout(mountTopBarButton, d);
    });
    if (window.MutationObserver && !TOPBAR_OBSERVER_MOUNTED) {
      TOPBAR_OBSERVER_MOUNTED = true;
      var throttleTimer = null;
      var observer = new MutationObserver(function () {
        var curBtn = document.getElementById(PANEL_ID + '-topbar-btn');
        if (isTopBarBtnProperlyMounted(curBtn) && curBtn === TOPBAR_BTN
          && document.querySelectorAll('#' + PANEL_ID + '-topbar-btn').length === 1) return;
        if (!throttleTimer) {
          throttleTimer = setTimeout(function () {
            throttleTimer = null;
            mountTopBarButton();
          }, 200);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function renderStatusPill() {
    mountTopBarButton();
  }

  function exportCustomSettings() {
    try {
      var payload = {
        hotbox_version: 1,
        exported_at: new Date().toISOString(),
        settings: JSON.parse(JSON.stringify(S))
      };
      var jsonStr = JSON.stringify(payload, null, 2);
      var blob = new Blob([jsonStr], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'hotbox_settings.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
      }, 250);
      setStatus('ok', '✓ Exported custom settings & buttons (.json)');
    } catch (err) {
      setStatus('error', 'Export failed: ' + msgOf(err));
    }
  }

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
          if (!src || typeof src !== 'object') throw new Error('Invalid JSON format');
          var count = 0;
          for (var k in DEFAULTS) {
            if (Object.prototype.hasOwnProperty.call(DEFAULTS, k) && src[k] !== undefined) {
              S[k] = src[k];
              count++;
            }
          }
          if (hbKeyRefused(S.hbKey, S.hbCode)) {
            S.hbKey = '`';
            S.hbCode = 'Backquote';
            S.hbMods = '';
          }
          save();
          updateTopBarButtonState();
          if (HB.el) hbPaint();
          if (typeof onDone === 'function') onDone();
          setStatus('ok', '✓ Imported custom settings & buttons (' + count + ' items)');
        } catch (err) {
          setStatus('error', 'Import failed: ' + msgOf(err));
        }
      };
      reader.readAsText(file);
    };
    document.body.appendChild(inp);
    inp.click();
  }

  /* The user's own power tools — each one can be switched off here, which also hides its hotbox buttons */
  var POWER_TOOLS = [
    { key: 'useAltZ', icon: 'lupa', name: 'Magnifier · Visual Crop · Paint Studio', keys: 'Alt+Z', desc: 'A big editor for the node under the cursor',
      tip: 'On a prompt / text node: Magnifier, a big live text editor (5 font sizes, box presets, corner resize). On a crop node: the Visual Crop editor (8 handles, ratios, size presets, arrow-key nudging; its stitch stays in sync). On a paint or LoadImage node: the fullscreen Paint Studio (brush, eraser, undo, uploads straight to ComfyUI). Also the Z row of the hotbox.' },
    { key: 'useAltN', icon: 'label', name: 'Label Studio', keys: 'Alt+N', desc: 'Rich canvas titles and notes',
      tip: 'Creates or edits a canvas label: text, size, font, color, corners, top shine, spacing and quick icons. Uses Label (rgthree) or an installed label node when it can, otherwise MarkdownNote / Note / Group. Also the Add Label row (L) of the hotbox.' },
    { key: 'useAltR', icon: 'loadCanvas', name: 'Load in Canvas', keys: 'Alt+R · V', desc: 'Hand a render to a new Load Image / Load Video',
      tip: 'Takes what the node is showing (Save / Preview Image, Save Video…), copies it into input/ and drops a Load Image — or a Load Video for videos — with it right under the node, in its own INPUT group. The [V] button only shows up on nodes that are showing an image or a video.' },
    { key: 'useShiftR', icon: 'play', name: 'Render Selected', keys: 'Shift+R', desc: 'Queue only the selected outputs',
      tip: 'Renders only what you selected: the selected output nodes, or the output nodes downstream of the selection, with just the nodes they need. Nothing selected renders nothing, so a stray key never spends API credits on the whole graph. Uses rgthree\'s queue when it is installed.' },
    { key: 'useStitch', icon: 'stitch', name: 'Super Stitch', keys: 'crop · result', desc: 'Put processed crops back into their plate',
      tip: 'On a crop, on the plate it cuts, or on a result that came out of a crop: adds a fit (ImageScale, bicubic) that sizes your result back to the crop box and an ImageCompositeMasked that pastes it at the crop\'s x / y. Several crops of one plate chain into one result, a preview closes the chain, an empty "apinode / localmodel" group marks where the model goes, and every stitch keeps following its crop when you move or resize it.' },
    { key: 'useKillApi', icon: 'zapOff', name: 'Bypass All APIs', keys: 'K', desc: 'Bypass every API node at once',
      tip: 'Bypasses every paid API node in the workflow for a cost-free test run; press it again to bring them back. Shows up in the bottom bar when the workflow has API nodes.' },
    { key: 'dotZoom', icon: 'zoom', name: 'Zoom to Selection', keys: '.', desc: 'Frame the selection, press again to go back',
      tip: 'Smoothly frames the selected node(s). Press . again to return to exactly where you were.' }
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

    /* Keep Hotbox open (or open it if closed) so user sees live UI Scale & Bar Spacing changes */
    if (!HB.el) hbOpen();

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
    var modalStyle = ' style="position:fixed;top:' + topPx + 'px;left:' + leftPx + 'px;width:min(' + mw + 'px,94vw);margin:0;pointer-events:auto"';

    /* Settings with several choices are one button that steps through them; the dots show where you are */
    var CYCLES = {
      hbHold: { opts: [false, true], names: ['Toggle on Press', 'Hold & Release'],
        tip: 'Toggle: press the hotkey to open, press again to close. Hold & Release: Maya / Nuke style, open while held.' },
      hbStyle: { opts: ['pro', 'classic', 'quiet'], names: ['Fluid', 'Compact', 'Quiet'],
        tip: 'Fluid: frosted glass cards. Compact: the same look, bars only. Quiet: native ComfyUI panels with hairline leaders. Tab also switches it.' },
      hbEditAnim: { opts: ['jiggle', 'tilt', 'float', 'outline'], names: ['Jiggle', 'Tilt', 'Float', 'Outline'],
        tip: 'How the bar buttons move in edit mode (long-press any button). Clicking here previews it.' }
    };
    var ptOpen = false;

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

    function setLabel(icon, text, top) {
      return '<label class="shb-set-l' + (top ? ' shb-set-top' : '') + '">' + ico(icon, 14) + '<span>' + esc(text) + '</span></label>';
    }

    function render() {
      tipHide();
      var curScale = parseFloat(S.hbScale) || 1;
      var curGap = (S.hbGap !== undefined && S.hbGap !== null) ? Number(S.hbGap) : 28;
      wrap.innerHTML =
        '<div class="shb-modal shb-settings"' + modalStyle + '>' +
          '<div class="shb-modal-t">' +
            '<span style="display:inline-flex;align-items:center;gap:7px"><span style="color:#e58c2c;font-weight:900">H</span><span>Hotbox Settings</span></span>' +
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
            setLabel('sparkles', 'Effects') +
            '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
              '<button class="shb-btn ' + (S.hbScrim !== false ? 'shb-btn-on' : 'shb-btn-pri') + '" data-st-toggle="hbScrim" data-tip="Fluid & Compact: a soft dim behind the hotbox (never blurred)">' + ico('moon', 13) + '<span>Canvas Dim</span></button>' +
              '<button class="shb-btn ' + (S.hbLeaders !== false ? 'shb-btn-on' : 'shb-btn-pri') + '" data-st-toggle="hbLeaders" data-tip="Quiet: hairlines from the cursor to each zone">' + ico('leaders', 13) + '<span>Leader Lines</span></button>' +
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
              '<button type="button" class="shb-btn shb-btn-pri shb-ptmenu" data-st-ptmenu data-tip="Your own extras: switch each one on or off (hover a tool to see what it does)">' +
                '<span class="shb-ptmenu-v">' + POWER_TOOLS.filter(function (pt) { return S[pt.key] !== false; }).length + ' of ' + POWER_TOOLS.length + ' on</span>' +
                ico(ptOpen ? 'chevDown' : 'chevRight', 13) +
              '</button>' +
              (ptOpen ? '<div class="shb-pt">' +
                POWER_TOOLS.map(function (pt) {
                  var on = S[pt.key] !== false;
                  return '<button type="button" class="shb-pt-row' + (on ? ' shb-on' : '') + '" data-st-toggle="' + pt.key + '" data-tip="' + esc(pt.tip) + '">' +
                    '<span class="shb-pt-sw"></span>' +
                    ico(pt.icon, 15) +
                    '<span class="shb-pt-name">' + esc(pt.name) + '<small>' + esc(pt.desc) + '</small></span>' +
                    '<span class="shb-pt-key">' + esc(pt.keys) + '</span>' +
                  '</button>';
                }).join('') +
              '</div>' : '') +
            '</div>' +
            setLabel('save', 'Custom Config') +
            '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
              '<button type="button" class="shb-btn shb-btn-pri" data-st-export title="Export all your custom buttons, bars, labels & settings to a .json file">' + ico('save', 13) + '<span>Export Settings (.json)</span></button>' +
              '<button type="button" class="shb-btn shb-btn-pri" data-st-import title="Import custom buttons, bars & settings from a .json file">' + ico('loadCanvas', 13) + '<span>Import Settings (.json)</span></button>' +
              '<button type="button" class="shb-btn" data-st-resetbars title="Reset custom bar buttons back to defaults">' + ico('sync', 13) + '<span>Reset Bars</span></button>' +
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
          S.customAddBar = null;
          S.customAddBySig = {};
          S.customToolsBar = {};
          S.customBotBar = null;
          S.customLabels = {};
          save();
          if (HB.el) hbPaint();
          setStatus('ok', '✓ Custom bars reset to defaults');
        };
      }
    }

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

    /* When Hotbox is open and user is not typing in the drawer search box */
    if (HB.el && !hbTyping()) {
      if (e.key === 'Escape') {
        hbEat(e);
        if (HB.editMode) hbSetEdit(false);
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
        var cardDrawer = { f: 'search', n: 'tools', a: 'models', g: 'subs' }[kl];
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

  /* ---------------------------------------------------------------------
   * 17. BOOTSTRAP & COMFYUI EXTENSION REGISTRATION
   * --------------------------------------------------------------------- */
  function boot() {
    injectStyles();
    setupTopBarMounting();
    probe();
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
    zoom: actDotZoom
  };
})();
