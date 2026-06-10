/* roughneck-enhance.js — loaded with `defer`, never blocks Roughdraft.
 *   1. Wider content column.
 *   2. Light/Auto theme toggle (defaults to Light).
 *   3. Mermaid diagrams as click-to-zoom overlays.
 *
 * ProseMirror reverts any change to its own DOM, so we NEVER touch the <pre>.
 * We reserve space + hide raw code via an external <style> rule, and draw each
 * SVG in an overlay appended to the scroll container (scrolls natively).
 * Clicking a diagram opens a full-screen pan/zoom modal.
 */
(function () {
  if (window.__roughneckEnhance) return;
  window.__roughneckEnhance = true;

  var style = document.createElement('style');
  style.textContent =
    /* widen the document column. With comments open, the page becomes a 2-col grid
       (doc | comments) capped at 1080px, with the doc track capped at 46.5rem — so
       we widen the outer cap, the doc max-width, and the grid's doc track. */
    '[class*="max-w-[46"]{max-width:92rem !important;}' +
    '.document-page-main{max-width:92rem !important;}' +
    '.max-w-\\[1080px\\]{max-width:100rem !important;}' +
    '.document-page-shell{grid-template-columns:minmax(0,92rem) minmax(20rem,26rem) !important;}' +
    '.ProseMirror{max-width:none !important;}' +
    'pre:has(> code.language-mermaid){min-height:120px;}' +   /* small placeholder; per-diagram height set below */
    'pre:has(> code.language-mermaid) > code{opacity:0;}';
  (document.head || document.documentElement).appendChild(style);

  /* theme toggle */
  var TKEY = 'rn-theme';
  var pref = localStorage.getItem(TKEY) || 'light';
  var htmlObs = null;
  function enforceLight() { if (document.documentElement.classList.contains('dark')) document.documentElement.classList.remove('dark'); }
  function applyPref() {
    if (pref === 'light') { enforceLight(); if (!htmlObs) { htmlObs = new MutationObserver(enforceLight); htmlObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }); } }
    else if (htmlObs) { htmlObs.disconnect(); htmlObs = null; }
  }
  applyPref();
  function makeBtn() {
    if (document.getElementById('rn-theme-btn')) return;
    var b = document.createElement('button');
    b.id = 'rn-theme-btn';
    b.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:9999;font:12px system-ui,sans-serif;padding:5px 9px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#111;cursor:pointer;opacity:.65;box-shadow:0 1px 3px rgba(0,0,0,.1);';
    b.onmouseenter = function () { b.style.opacity = '1'; }; b.onmouseleave = function () { b.style.opacity = '.65'; };
    function label() { b.textContent = pref === 'light' ? '☀ Light' : '◐ Auto'; } label();
    b.onclick = function () { pref = (pref === 'light') ? 'auto' : 'light'; localStorage.setItem(TKEY, pref); applyPref(); label(); if (pref === 'auto') location.reload(); };
    document.body.appendChild(b);
  }
  if (document.body) makeBtn(); else document.addEventListener('DOMContentLoaded', makeBtn);

  var badge, hideT;
  function status(msg, persist) {
    if (!badge) { badge = document.createElement('div'); badge.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:9999;font:11px ui-monospace,monospace;padding:4px 8px;border-radius:6px;background:#111;color:#0f0;opacity:.8;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'; (document.body || document.documentElement).appendChild(badge); }
    badge.textContent = 'mermaid: ' + msg;
    clearTimeout(hideT);
    if (!persist) hideT = setTimeout(function () { if (badge) { badge.remove(); badge = null; } }, 2500);
  }

  function natSize(svg) { var m = svg.match(/viewBox="[\d.\-]+ [\d.\-]+ ([\d.\-]+) ([\d.\-]+)"/); if (m && +m[1] > 0) return { w: +m[1], h: +m[2] }; var w = svg.match(/width="([\d.]+)/), h = svg.match(/height="([\d.]+)/); return { w: w ? +w[1] : 800, h: h ? +h[1] : 600 }; }

  function openModal(svg) {
    var nat = natSize(svg);
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.78);display:flex;flex-direction:column;';
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;align-items:center;padding:10px 12px;';
    function mkb(t) { var b = document.createElement('button'); b.textContent = t; b.style.cssText = 'font:14px system-ui;height:32px;min-width:34px;padding:0 12px;border:0;border-radius:6px;background:#ffffff26;color:#fff;cursor:pointer;'; return b; }
    var bOut = mkb('−'), pct = document.createElement('span'), bIn = mkb('+'), bRst = mkb('Reset'), bX = mkb('✕ Close');
    pct.style.cssText = 'min-width:52px;text-align:center;color:#fff;font:13px ui-monospace,monospace;';
    bar.append(bOut, pct, bIn, bRst, bX);
    var vp = document.createElement('div');
    vp.style.cssText = 'flex:1;overflow:hidden;position:relative;cursor:grab;touch-action:none;';
    var stage = document.createElement('div');
    stage.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;background:#fff;border-radius:8px;';
    stage.innerHTML = svg;
    var sv = stage.querySelector('svg'); if (sv) { sv.style.display = 'block'; sv.setAttribute('width', nat.w); sv.setAttribute('height', nat.h); }
    vp.appendChild(stage); ov.append(bar, vp); document.body.appendChild(ov);

    var scale = 1, tx = 0, ty = 0;
    function apply() { stage.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; pct.textContent = Math.round(scale * 100) + '%'; }
    function fit() { var vw = vp.clientWidth, vh = vp.clientHeight; scale = Math.min(vw / nat.w, vh / nat.h) * 0.92; if (!isFinite(scale) || scale <= 0) scale = 1; tx = (vw - nat.w * scale) / 2; ty = (vh - nat.h * scale) / 2; apply(); }
    function zoomAt(cx, cy, f) { var ns = Math.min(Math.max(scale * f, 0.1), 20); tx = cx - (cx - tx) * (ns / scale); ty = cy - (cy - ty) * (ns / scale); scale = ns; apply(); }
    vp.addEventListener('wheel', function (e) { e.preventDefault(); var r = vp.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
    bIn.onclick = function () { var r = vp.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.25); };
    bOut.onclick = function () { var r = vp.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.25); };
    bRst.onclick = fit;
    var pan = null;
    vp.addEventListener('pointerdown', function (e) { pan = { x: e.clientX, y: e.clientY, tx: tx, ty: ty }; vp.style.cursor = 'grabbing'; try { vp.setPointerCapture(e.pointerId); } catch (x) {} });
    vp.addEventListener('pointermove', function (e) { if (!pan) return; tx = pan.tx + (e.clientX - pan.x); ty = pan.ty + (e.clientY - pan.y); apply(); });
    vp.addEventListener('pointerup', function () { pan = null; vp.style.cursor = 'grab'; });
    function close() { ov.remove(); document.removeEventListener('keydown', onkey); window.removeEventListener('resize', fit); }
    function onkey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onkey); window.addEventListener('resize', fit);
    bX.onclick = close; ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    fit();
  }

  /* render + overlay */
  var dark = pref !== 'light' && document.documentElement.classList.contains('dark');
  var theme = dark ? { bg: '#0b0b0c', bd: '#27272a' } : { bg: '#ffffff', bd: '#e5e7eb' };
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; (document.head || document.documentElement).appendChild(s); }); }

  (async function () {
    status('loading…', true);
    var mermaid = null, via = '';
    try { var m = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'); mermaid = m.default || m; via = 'cdn'; }
    catch (e) { try { await loadScript('/assets/mermaid.min.js'); if (window.mermaid) { mermaid = window.mermaid; via = 'local'; } } catch (e2) {} }
    if (!mermaid) { status('no renderer', true); return; }
    try { mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: dark ? 'dark' : 'default' }); } catch (e) {}

    var scroller = (function () {
      var el = document.querySelector('pre > code.language-mermaid'); el = el && el.parentElement;
      while (el && el !== document.body && el !== document.documentElement) { var s = getComputedStyle(el); if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 4) return { el: el, win: false }; el = el.parentElement; }
      return { el: document.body, win: true };
    })();
    if (!scroller.win && getComputedStyle(scroller.el).position === 'static') scroller.el.style.position = 'relative';

    var done = new WeakSet(), boxes = [], idc = 0, cache = {}, ok = 0, fail = 0, firstErr = '';
    var sizeSheet = document.createElement('style'); (document.head || document.documentElement).appendChild(sizeSheet);
    function render(def) { if (cache[def]) return Promise.resolve(cache[def]); return mermaid.render('rn-m-' + (idc++), def).then(function (r) { cache[def] = r.svg; return r.svg; }); }
    // Per-diagram height via stylesheet (nth-child) — PM-safe, so each block hugs
    // its own diagram instead of a fixed tall box.
    function applySizes() {
      var rules = [];
      for (var i = 0; i < boxes.length; i++) {
        var e = boxes[i]; if (!e.pre.isConnected) continue;
        var par = e.pre.parentElement; if (!par) continue;
        var idx = Array.prototype.indexOf.call(par.children, e.pre) + 1; if (idx < 1) continue;
        var w = e.pre.clientWidth || 700;
        var h = Math.min(Math.max(Math.round(w * e.aspect) + 12, 70), Math.round(window.innerHeight * 0.85));
        rules.push('.ProseMirror>pre:nth-child(' + idx + '){height:' + h + 'px!important;min-height:' + h + 'px!important;}');
      }
      sizeSheet.textContent = rules.join('');
    }
    function placeBox(box, pre) {
      var pr = pre.getBoundingClientRect();
      if (scroller.win) { box.style.left = (pr.left + window.scrollX) + 'px'; box.style.top = (pr.top + window.scrollY) + 'px'; }
      else { var ar = scroller.el.getBoundingClientRect(); box.style.left = (pr.left - ar.left + scroller.el.scrollLeft) + 'px'; box.style.top = (pr.top - ar.top + scroller.el.scrollTop) + 'px'; }
      box.style.width = pr.width + 'px'; box.style.height = pr.height + 'px';
    }
    function reposition() {
      for (var i = boxes.length - 1; i >= 0; i--) { if (!boxes[i].pre.isConnected) { boxes[i].box.remove(); boxes.splice(i, 1); } }
      applySizes();
      for (var j = 0; j < boxes.length; j++) placeBox(boxes[j].box, boxes[j].pre);
    }
    function report() { status('via ' + via + ': ' + ok + ' ok' + (fail ? (', ' + fail + ' err — ' + firstErr) : ''), fail > 0); }
    function apply(pre) {
      if (done.has(pre)) return; done.add(pre);
      var code = pre.firstElementChild; if (!code) return;
      render(code.textContent).then(function (svg) {
        var n = natSize(svg), aspect = (n.w > 0 ? n.h / n.w : 0.5);
        var box = document.createElement('div');
        box.style.cssText = 'position:absolute;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:12px;background:' + theme.bg + ';border:1px solid ' + theme.bd + ';border-radius:8px;overflow:hidden;cursor:zoom-in;';
        box.title = 'Click to zoom';
        box.innerHTML = svg;
        var sv = box.querySelector('svg'); if (sv) { sv.style.maxWidth = '100%'; sv.style.maxHeight = '100%'; sv.style.height = 'auto'; sv.style.pointerEvents = 'none'; sv.removeAttribute('height'); }
        box.onclick = function () { openModal(svg); };
        scroller.el.appendChild(box);
        boxes.push({ box: box, pre: pre, aspect: aspect });
        reposition();
        ok++; report();
      }).catch(function (e) { fail++; if (!firstErr) firstErr = String(e && e.message || e).slice(0, 90); report(); });
    }
    function scan() { document.querySelectorAll('pre > code.language-mermaid').forEach(function (c) { apply(c.parentElement); }); reposition(); }

    var deb; new MutationObserver(function () { clearTimeout(deb); deb = setTimeout(scan, 150); }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', reposition);
    if (window.ResizeObserver) { try { new ResizeObserver(reposition).observe(document.querySelector('.ProseMirror') || document.body); } catch (e) {} }
    [0, 400, 1200, 2500].forEach(function (t) { setTimeout(scan, t); });
  })();

  /* 4. Obsidian [[wikilinks]] — rendered as styled links (color, no brackets).
   * PM-safe: we never modify the editor DOM (it would be reverted). Each link is
   * drawn as an overlay positioned over the raw [[...]] text, in the scroll
   * container so it scrolls natively. Clicking opens the linked note. */
  (async function () {
    var LINK = '#2563eb';
    var projectDir = '';
    try { var st = await fetch('/api/status').then(function (r) { return r.json(); }); projectDir = st.projectDir || ''; } catch (e) {}
    if (!projectDir) return;
    var map = {};
    try {
      var ft = await fetch('/api/file-tree?projectPath=' + encodeURIComponent(projectDir)).then(function (r) { return r.json(); });
      (ft.paths || []).forEach(function (p) {
        if (!/\.md$/i.test(p)) return;
        var rel = p.replace(/^\/+/, ''), base = rel.replace(/\.md$/i, '');
        map[base.toLowerCase()] = rel;
        var name = base.split('/').pop().toLowerCase();
        if (!(name in map)) map[name] = rel;
      });
    } catch (e) { return; }
    function resolve(t) { t = t.split('#')[0].split('|')[0].trim().toLowerCase(); return map[t] || map[t.split('/').pop()] || null; }
    function display(name) { var parts = name.split('|'); return (parts[1] || parts[0].split('#')[0]).trim(); }
    // Roughdraft's AG() splits ?path= at the last slash to derive projectPath
    // (dirname) + documentPath (basename), so the link MUST be the absolute path.
    function abs(p) { return /^([a-zA-Z]:[\\/]|\/)/.test(p) ? p : projectDir.replace(/\/+$/, '') + '/' + p.replace(/^\/+/, ''); }
    function navTo(path) { var u = new URL(window.location.href); u.pathname = '/'; u.searchParams.set('path', abs(path)); window.location.assign(u.pathname + u.search); }

    var sc = { el: document.body, win: true };
    function detectSc() {            // re-detect each build: the inner scroller may not exist until content is laid out
      var el = document.querySelector('.ProseMirror') || document.body;
      while (el && el !== document.body && el !== document.documentElement) {
        var s = getComputedStyle(el);
        if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 4) { sc = { el: el, win: false }; if (getComputedStyle(el).position === 'static') el.style.position = 'relative'; return; }
        el = el.parentElement;
      }
      sc = { el: document.body, win: true };
    }
    function pageBg() { var ed = document.querySelector('.ProseMirror'), c = ed && getComputedStyle(ed).backgroundColor; if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') c = getComputedStyle(document.body).backgroundColor; return c && c !== 'rgba(0, 0, 0, 0)' ? c : '#fff'; }

    var overlays = [];
    function clearOverlays() { overlays.forEach(function (o) { o.remove(); }); overlays = []; }
    function build() {
      clearOverlays();
      detectSc();
      var ed = document.querySelector('.ProseMirror'); if (!ed) return;
      var bg = pageBg();
      var walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT, null), tn, todo = [];
      while ((tn = walker.nextNode())) { if (tn.textContent.indexOf('[[') !== -1) todo.push(tn); }
      todo.forEach(function (node) {
        var text = node.textContent, re = /\[\[([^\[\]]+)\]\]/g, m;
        while ((m = re.exec(text))) {
          var path = resolve(m[1]); if (!path) continue;
          var range = document.createRange(); range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
          var rects = range.getClientRects(); if (rects.length !== 1) continue;     // skip wrapped (rare); handled by click fallback
          var r = rects[0], cs = getComputedStyle(node.parentElement);
          var a = document.createElement('span');
          a.textContent = display(m[1]); a.title = path;
          a.style.cssText = 'position:absolute;display:inline-flex;align-items:center;box-sizing:border-box;white-space:pre;overflow:hidden;cursor:pointer;color:' + LINK + ';background:' + bg + ';font-family:' + cs.fontFamily + ';font-size:' + cs.fontSize + ';font-weight:' + cs.fontWeight + ';letter-spacing:' + cs.letterSpacing + ';';
          if (sc.win) { a.style.left = (r.left + window.scrollX) + 'px'; a.style.top = (r.top + window.scrollY) + 'px'; }
          else { var ar = sc.el.getBoundingClientRect(); a.style.left = (r.left - ar.left + sc.el.scrollLeft) + 'px'; a.style.top = (r.top - ar.top + sc.el.scrollTop) + 'px'; }
          a.style.height = r.height + 'px'; a.style.minWidth = r.width + 'px';
          a.onmouseenter = function () { a.style.textDecoration = 'underline'; };
          a.onmouseleave = function () { a.style.textDecoration = 'none'; };
          (function (p) { a.onclick = function (e) { e.preventDefault(); e.stopPropagation(); navTo(p); }; })(path);
          sc.el.appendChild(a); overlays.push(a);
        }
      });
    }
    var deb; function schedule() { clearTimeout(deb); deb = setTimeout(build, 400); }
    new MutationObserver(schedule).observe(document.querySelector('.ProseMirror') || document.body, { childList: true, subtree: true }); // childList only — characterData fired on every keystroke and was costly on big docs
    window.addEventListener('resize', schedule);
    [300, 1000, 2200].forEach(function (t) { setTimeout(build, t); });

    // Click fallback for any wrapped (multi-line) links not overlaid.
    function caret(x, y) { if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y); if (document.caretPositionFromPoint) { var p = document.caretPositionFromPoint(x, y); return p && { startContainer: p.offsetNode, startOffset: p.offset }; } return null; }
    document.addEventListener('click', function (e) {
      var c = caret(e.clientX, e.clientY); if (!c || !c.startContainer || c.startContainer.nodeType !== 3) return;
      var t = c.startContainer.textContent, off = c.startOffset, re = /\[\[([^\[\]]+)\]\]/g, m, name = null;
      while ((m = re.exec(t))) { if (off >= m.index && off <= m.index + m[0].length) { name = m[1]; break; } }
      if (!name) return; var path = resolve(name); if (!path) return;
      e.preventDefault(); e.stopPropagation(); navTo(path);
    }, true);
  })();

  /* 5. roughneck — a repo browser for Roughdraft (lives at the root URL). */
  (async function () {
    var onDoc = !!new URLSearchParams(window.location.search).get('path') || (window.location.pathname !== '/' && window.location.pathname !== '');
    if (onDoc) {                                  // doc open: subtle "roughneck" header link back to the browser
      var fb = document.createElement('button');
      fb.textContent = '⬡ roughneck'; fb.title = 'Browse repo — roughneck, a browser for Roughdraft';
      fb.style.cssText = 'position:fixed;top:10px;left:12px;z-index:9998;font:11px ui-monospace,monospace;letter-spacing:.02em;padding:3px 8px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;color:#6b7280;cursor:pointer;opacity:.6;';
      fb.onmouseenter = function () { fb.style.opacity = '1'; fb.style.color = '#111'; }; fb.onmouseleave = function () { fb.style.opacity = '.6'; fb.style.color = '#6b7280'; };
      fb.onclick = function () { window.location.assign('/'); };
      function add() { document.body.appendChild(fb); } if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
      return;
    }
    var projectDir = '';
    try { var st = await fetch('/api/status').then(function (r) { return r.json(); }); projectDir = st.projectDir || ''; } catch (e) {}
    if (!projectDir) return;
    var paths = [];
    try { var ft = await fetch('/api/file-tree?projectPath=' + encodeURIComponent(projectDir)).then(function (r) { return r.json(); }); paths = ft.paths || []; } catch (e) { return; }

    var root = { dirs: {}, files: [] };
    paths.forEach(function (p) {
      var isFile = !/\/$/.test(p), rel = p.replace(/\/+$/, ''); if (!rel) return;
      var segs = rel.split('/');
      if (segs.some(function (s) { return s.charAt(0) === '.' || s === 'node_modules'; })) return;
      if (isFile && !/\.md$/i.test(rel)) return;
      var node = root;
      for (var i = 0; i < segs.length - 1; i++) { var d = segs[i]; node.dirs[d] = node.dirs[d] || { name: d, dirs: {}, files: [] }; node = node.dirs[d]; }
      var last = segs[segs.length - 1];
      if (isFile) node.files.push({ name: last.replace(/\.md$/i, ''), path: rel });
      else node.dirs[last] = node.dirs[last] || { name: last, dirs: {}, files: [] };
    });
    function hasFiles(n) { if (n.files.length) return true; return Object.keys(n.dirs).some(function (k) { return hasFiles(n.dirs[k]); }); }
    // Absolute path required: Roughdraft derives projectPath from dirname(?path=).
    function abs(p) { return /^([a-zA-Z]:[\\/]|\/)/.test(p) ? p : projectDir.replace(/\/+$/, '') + '/' + p.replace(/^\/+/, ''); }
    function openPath(path) { var u = new URL(window.location.href); u.pathname = '/'; u.searchParams.set('path', abs(path)); window.location.assign(u.pathname + u.search); }

    var d2 = (typeof dark !== 'undefined') ? dark : false;
    function render(n, depth) {
      var frag = document.createDocumentFragment();
      Object.keys(n.dirs).sort().forEach(function (k) {
        var dn = n.dirs[k]; if (!hasFiles(dn)) return;
        var row = document.createElement('div');
        row.textContent = '📁 ' + k;
        row.style.cssText = 'padding:6px 8px;margin-left:' + (depth * 18) + 'px;font-weight:600;color:' + (d2 ? '#cbd5e1' : '#374151') + ';';
        frag.appendChild(row); frag.appendChild(render(dn, depth + 1));
      });
      n.files.sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (f) {
        var a = document.createElement('a');
        a.textContent = '📄 ' + f.name; a.href = '/?path=' + encodeURIComponent(abs(f.path)); a.title = f.path;
        a.style.cssText = 'display:block;padding:6px 8px;margin-left:' + (depth * 18) + 'px;color:#2563eb;text-decoration:none;border-radius:6px;';
        a.onmouseenter = function () { a.style.background = d2 ? '#1e293b' : '#eff6ff'; }; a.onmouseleave = function () { a.style.background = ''; };
        a.onclick = function (e) { e.preventDefault(); openPath(f.path); };
        frag.appendChild(a);
      });
      return frag;
    }

    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:90000;overflow:auto;background:' + (d2 ? '#0b0b0c' : '#f8f8f7') + ';';
    var card = document.createElement('div');
    card.style.cssText = 'max-width:60rem;margin:48px auto;padding:28px 32px;background:' + (d2 ? '#111114' : '#fff') + ';border:1px solid ' + (d2 ? '#27272a' : '#e9e9e8') + ';border-radius:12px;box-shadow:0 18px 44px rgba(57,47,38,0.08);font:14px system-ui,sans-serif;color:' + (d2 ? '#e5e7eb' : '#111') + ';';
    var brand = document.createElement('div'); brand.textContent = '⬡ roughneck — a browser for Roughdraft';
    brand.style.cssText = 'font:11px ui-monospace,monospace;letter-spacing:.03em;color:' + (d2 ? '#64748b' : '#9ca3af') + ';margin-bottom:4px;';
    var h = document.createElement('div'); h.textContent = (projectDir.split('/').pop() || 'project');
    h.style.cssText = 'font-size:18px;font-weight:700;margin-bottom:16px;';
    card.appendChild(brand); card.appendChild(h); card.appendChild(render(root, 0)); ov.appendChild(card);
    function show() { document.body.appendChild(ov); } if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  })();
})();
