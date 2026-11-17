/* =========================================================
   grid.js — טבלה בסגנון אקסל
   רינדור וירטואלי (רק השורות שעל המסך), בחירת טווחים מרובים,
   שינוי רוחב/גובה בגרירה, עריכה, העתק/הדבק מאקסל, ידית מילוי,
   Ctrl+Enter להחלה על כל התאים המסומנים, סינון ומיון, ביטול/חזרה.
   ========================================================= */
(function (global) {
  'use strict';
  const RH_W = 56;
  const HEAD_H = 40;
  const MIN_W = 44, MIN_H = 22;
  const esc = (s) => UI.esc(s);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- ערכים ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  function isoDate(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
  function fmtDate(v) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); return m ? `${m[3]}/${m[2]}/${m[1]}` : v; }
  function parseDate(s) {
    s = String(s).trim(); let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return isoDate(m[1], m[2], m[3]);
    if ((m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(s))) { let y = +m[3]; if (y < 100) y += 2000; return isoDate(y, m[2], m[1]); }
    if (/^\d{5}$/.test(s)) { const d = new Date(Math.round((+s - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
    return s;
  }
  function parseValue(col, raw) {
    if (raw == null) return '';
    const s = String(raw);
    if (s.trim() === '') return '';
    if (col.type === 'number') { const n = +s.replace(/[,\s₪$€]/g, ''); return isNaN(n) ? s : n; }
    if (col.type === 'date') return parseDate(s);
    return s;
  }
  function display(col, v) {
    if (v == null || v === '') return '';
    if (col.type === 'date') return fmtDate(String(v));
    if (col.type === 'number' && typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return String(v);
  }
  function editText(col, v) {
    if (v == null) return '';
    if (col.type === 'date') return fmtDate(String(v));
    return String(v);
  }
  function parseTSV(text) {
    text = text.replace(/\r\n?/g, '\n');
    if (text.endsWith('\n')) text = text.slice(0, -1);
    const rows = []; let row = []; let cur = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"' && cur === '') q = true;
      else if (ch === '\t') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    row.push(cur); rows.push(row);
    return rows;
  }
  const tsvCell = (s) => (/[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);

  class Grid {
    constructor(host, opts) {
      this.host = host;
      this.o = opts;
      this.ds = opts.dataset;
      this.sort = null;           // {colId, dir}
      this.filters = {};          // colId -> Set(display values)
      this.search = '';
      this.view = []; this.cols = []; this.tops = [0]; this.colOff = [0];
      this.ranges = [{ r1: 0, c1: 0, r2: 0, c2: 0 }];
      this.active = { r: 0, c: 0 };
      this.undoStack = []; this.redoStack = [];
      this.editor = null;
      this._raf = 0;
      this.flashIds = new Set();
      this.ver = new Map();
      this.build();
      this.refresh();
    }

    /* ================= מבנה ================= */
    build() {
      this.host.innerHTML = `<div class="grid-host">
        <div class="grid-scroll" tabindex="0" role="grid" aria-label="${esc(this.o.label || 'טבלה')}">
          <div class="grid-head" role="row"></div>
          <div class="grid-body"><div class="grid-rows"></div><div class="grid-sel"></div></div>
        </div>
        <div class="grid-empty" hidden></div></div>`;
      this.scroll = this.host.querySelector('.grid-scroll');
      this.head = this.host.querySelector('.grid-head');
      this.body = this.host.querySelector('.grid-body');
      this.rowsEl = this.host.querySelector('.grid-rows');
      this.selEl = this.host.querySelector('.grid-sel');
      this.emptyEl = this.host.querySelector('.grid-empty');

      this.scroll.addEventListener('scroll', () => this.queueRender(), { passive: true });
      this.scroll.addEventListener('mousedown', (e) => this.onMouseDown(e));
      this.scroll.addEventListener('dblclick', (e) => this.onDblClick(e));
      this.scroll.addEventListener('contextmenu', (e) => this.onContext(e));
      this.scroll.addEventListener('keydown', (e) => this.onKey(e));
      this.scroll.addEventListener('copy', (e) => this.onCopy(e));
      this.scroll.addEventListener('cut', (e) => { this.onCopy(e); this.clearSelection(); });
      this.scroll.addEventListener('paste', (e) => this.onPaste(e));
      this.head.addEventListener('dragstart', (e) => this.onDragStart(e));
      this.head.addEventListener('dragover', (e) => this.onDragOver(e));
      this.head.addEventListener('drop', (e) => this.onDrop(e));
      this.head.addEventListener('dragend', () => this.head.querySelectorAll('.drop-l,.drop-r').forEach((x) => x.classList.remove('drop-l', 'drop-r')));
      this._ro = new ResizeObserver(() => this.queueRender());
      this._ro.observe(this.scroll);
    }
    destroy() { this._ro && this._ro.disconnect(); this.commitEdit(); this.host.innerHTML = ''; }
    focus() { this.scroll.focus({ preventScroll: true }); }
    get dsObj() { return Store.db.datasets[this.ds]; }
    rowH(row) { return row.h || this.o.rowHeight(); }
    val(row, col) { return col.get ? col.get(row) : row.c[col.id]; }
    isRO(col) { return !!col.virtual || !!(this.o.readOnly && this.o.readOnly(col)); }

    /* ================= נתונים לתצוגה ================= */
    baseRows() {
      let rows = Store.rows(this.ds);
      if (this.o.filter) rows = rows.filter(this.o.filter);
      return rows;
    }
    /** flash=true: שורות שעודכנו ע"י משתמש אחר מהבהבות לרגע */
    refresh(keepOrder = false, flash = false) {
      const allCols = Store.columns(this.ds).concat(this.o.virtualCols ? this.o.virtualCols() : []);
      this.allCols = allCols;
      this.cols = allCols.filter((c) => !c.hidden);
      let rows = this.baseRows();
      for (const [cid, set] of Object.entries(this.filters)) {
        const col = allCols.find((c) => c.id === cid);
        if (!col) { delete this.filters[cid]; continue; }
        rows = rows.filter((r) => set.has(display(col, this.val(r, col))));
      }
      if (this.search) {
        const q = this.search.toLowerCase();
        rows = rows.filter((r) => this.cols.some((c) => display(c, this.val(r, c)).toLowerCase().includes(q)));
      }
      if (keepOrder && this.sort && this.view.length) {
        const idx = new Map(this.view.map((r, i) => [r.id, i]));
        rows.sort((a, b) => (idx.get(a.id) ?? 1e9) - (idx.get(b.id) ?? 1e9) || (a.o || 0) - (b.o || 0));
      } else if (this.sort) {
        const col = allCols.find((c) => c.id === this.sort.colId);
        const dir = this.sort.dir;
        if (col) {
          const coll = new Intl.Collator('he', { numeric: true, sensitivity: 'base' });
          rows.sort((a, b) => {
            const x = this.val(a, col), y = this.val(b, col);
            const ex = x === '' || x == null, ey = y === '' || y == null;
            if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1; // ריקים תמיד בסוף
            if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
            return coll.compare(String(x), String(y)) * dir;
          });
        }
      } else rows.sort((a, b) => (a.o || 0) - (b.o || 0));
      if (flash) {
        const me = Store.session && Store.session.userId;
        for (const r of rows) { const v = this.ver.get(r.id); if (v !== r.updatedAt && (v !== undefined || this.ver.size) && r.by !== me) this.flashIds.add(r.id); }
        if (this.flashIds.size) { clearTimeout(this._ft); this._ft = setTimeout(() => { this.flashIds.clear(); }, 1400); }
      }
      this.ver = new Map(rows.map((r) => [r.id, r.updatedAt]));
      this.view = rows;
      this.layout();
      this.clampSel();
      this.renderHead();
      this.renderRows();
      this.renderSel();
      const empty = !this.view.length;
      this.emptyEl.hidden = !empty;
      if (empty) this.emptyEl.innerHTML = (this.search || Object.keys(this.filters).length)
        ? `<div><b>אין שורות שתואמות לסינון</b><p>נקה את החיפוש או את המסננים כדי לראות את כל ההזמנות.</p></div>`
        : (this.o.emptyHtml || '<div><b>אין עדיין שורות</b></div>');
      this.emitStats();
    }
    layout() {
      const t = [0];
      for (let i = 0; i < this.view.length; i++) t.push(t[i] + this.rowH(this.view[i]));
      this.tops = t;
      const off = [0];
      for (let j = 0; j < this.cols.length; j++) off.push(off[j] + (this.cols[j].width || 120));
      this.colOff = off;
      this.totalW = RH_W + off[off.length - 1];
      this.head.style.width = this.totalW + 'px';
      this.body.style.width = this.totalW + 'px';
      this.body.style.height = Math.max(t[t.length - 1], 1) + 'px';
    }
    clampSel() {
      const maxR = Math.max(0, this.view.length - 1), maxC = Math.max(0, this.cols.length - 1);
      const cl = (v, m) => Math.max(0, Math.min(v, m));
      this.ranges = this.ranges.map((g) => ({ r1: cl(g.r1, maxR), r2: cl(g.r2, maxR), c1: cl(g.c1, maxC), c2: cl(g.c2, maxC) }));
      this.active = { r: cl(this.active.r, maxR), c: cl(this.active.c, maxC) };
    }

    /* ================= רינדור ================= */
    queueRender() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.renderRows(); });
    }
    renderHead() {
      const selCols = this.selectedColSet();
      let h = `<div class="gh-corner" data-corner title="בחירת הכול">${UI.icon('table', 14)}</div>`;
      this.cols.forEach((c, j) => {
        const f = this.filters[c.id];
        const s = this.sort && this.sort.colId === c.id ? this.sort.dir : 0;
        const marks = (f ? `<span class="gh-mark" title="מסונן">${UI.icon('filter', 12)}</span>` : '') + (s ? `<span class="gh-mark">${UI.icon(s > 0 ? 'sortAsc' : 'sortDesc', 12)}</span>` : '');
        let role = this.o.colRole ? this.o.colRole(c.id) : '';
        if (role && c.name.replace(/["'״׳]/g, '').includes(role.replace(/["'״׳]/g, ''))) role = '';
        h += `<div class="gh${selCols.has(j) ? ' hl' : ''}${f ? ' filtered' : ''}" data-c="${j}" style="width:${c.width}px" draggable="true" role="columnheader" title="${esc(c.name)}${role ? ' · ' + esc(role) : ''}">
          <span class="gh-text"><span class="gh-name">${esc(c.name)}</span>${role ? `<span class="gh-role">${esc(role)}</span>` : ''}</span>${marks}
          <button class="gh-menu" data-cm="${j}" tabindex="-1" aria-label="אפשרויות עמודה">${UI.icon('chevron', 14)}</button>
          <span class="gh-rs" data-crs="${j}"></span></div>`;
      });
      this.head.innerHTML = h;
    }
    visibleRange() {
      const st = this.scroll.scrollTop;
      const h = this.scroll.clientHeight - HEAD_H;
      const t = this.tops;
      let lo = 0, hi = this.view.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid + 1] <= st) lo = mid + 1; else hi = mid; }
      let end = lo;
      while (end < this.view.length && t[end] < st + h) end++;
      return [Math.max(0, lo - 6), Math.min(this.view.length, end + 6)];
    }
    renderRows() {
      const [a, b] = this.visibleRange();
      const selRows = this.selectedRowFull();
      const touched = this.selectedRowAny();
      const decorate = this.o.decorate;
      let html = '';
      for (let i = a; i < b; i++) {
        const row = this.view[i];
        const h = this.rowH(row);
        html += `<div class="gr${selRows.has(i) ? ' rsel' : ''}${this.flashIds.has(row.id) ? ' flash' : ''}" style="top:${this.tops[i]}px;height:${h}px;width:${this.totalW}px" data-r="${i}" role="row">`;
        html += `<div class="rh${touched.has(i) ? ' hl' : ''}" data-rh="${i}">${i + 1}<span class="rh-rs" data-rrs="${i}"></span></div>`;
        for (let j = 0; j < this.cols.length; j++) {
          const col = this.cols[j];
          const v = this.val(row, col);
          const txt = display(col, v);
          const d = decorate ? decorate(row, col, v, txt) : null;
          const cls = 'gc t-' + (col.type || 'text') + (d && d.cls ? ' ' + d.cls : '');
          html += `<div class="${cls}" data-c="${j}" style="width:${col.width}px" role="gridcell">${d && d.html != null ? d.html : esc(txt)}</div>`;
        }
        html += '</div>';
      }
      this.rowsEl.innerHTML = html;
    }
    rectOf(g) {
      return {
        top: this.tops[g.r1], height: this.tops[g.r2 + 1] - this.tops[g.r1],
        right: RH_W + this.colOff[g.c1], width: this.colOff[g.c2 + 1] - this.colOff[g.c1],
      };
    }
    renderSel() {
      if (!this.view.length || !this.cols.length) { this.selEl.innerHTML = ''; return; }
      let h = '';
      const multi = this.ranges.length > 1 || this.ranges.some((g) => g.r1 !== g.r2 || g.c1 !== g.c2);
      this.ranges.forEach((g0) => {
        const g = this.norm(g0); const r = this.rectOf(g);
        if (multi) h += `<div class="sel-range" style="top:${r.top}px;height:${r.height}px;right:${r.right}px;width:${r.width}px"></div>`;
      });
      const a = this.active;
      const ar = this.rectOf({ r1: a.r, r2: a.r, c1: a.c, c2: a.c });
      h += `<div class="sel-active" style="top:${ar.top}px;height:${ar.height}px;right:${ar.right}px;width:${ar.width}px"></div>`;
      const last = this.norm(this.ranges[this.ranges.length - 1]);
      const lr = this.rectOf(last);
      h += `<div class="fill-handle" title="גרור כדי למלא" style="top:${lr.top + lr.height - 4}px;right:${lr.right + lr.width - 4}px"></div>`;
      this.selEl.innerHTML = h;
      // הדגשת כותרות
      const selCols = this.selectedColSet();
      this.head.querySelectorAll('.gh').forEach((el) => el.classList.toggle('hl', selCols.has(+el.dataset.c)));
      this.renderRows();
    }

    /* ================= בחירה ================= */
    norm(g) { return { r1: Math.min(g.r1, g.r2), r2: Math.max(g.r1, g.r2), c1: Math.min(g.c1, g.c2), c2: Math.max(g.c1, g.c2) }; }
    selectedColSet() {
      const s = new Set();
      for (const g0 of this.ranges) { const g = this.norm(g0); for (let c = g.c1; c <= g.c2; c++) s.add(c); }
      return s;
    }
    selectedRowAny() {
      const s = new Set();
      for (const g0 of this.ranges) { const g = this.norm(g0); if (g.r2 - g.r1 > 5000) continue; for (let r = g.r1; r <= g.r2; r++) s.add(r); }
      return s;
    }
    selectedRowFull() {
      const s = new Set(); const last = this.cols.length - 1;
      for (const g0 of this.ranges) { const g = this.norm(g0); if (g.c1 === 0 && g.c2 === last && last >= 0) for (let r = g.r1; r <= g.r2; r++) s.add(r); }
      return s;
    }
    selectedRows() { return [...this.selectedRowAny()].sort((a, b) => a - b).map((i) => this.view[i]).filter(Boolean); }
    *eachSelectedCell() {
      const seen = new Set();
      for (const g0 of this.ranges) {
        const g = this.norm(g0);
        for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
          const k = r * 10000 + c; if (seen.has(k)) continue; seen.add(k);
          if (this.view[r] && this.cols[c]) yield { r, c, row: this.view[r], col: this.cols[c] };
        }
      }
    }
    setSel(ranges, active, scroll = true) {
      this.ranges = ranges; this.active = active;
      this.clampSel(); this.renderSel();
      if (scroll) this.ensureVisible(this.active.r, this.active.c);
      this.emitStats();
    }
    selectAll() { if (!this.view.length) return; this.setSel([{ r1: 0, c1: 0, r2: this.view.length - 1, c2: this.cols.length - 1 }], { r: 0, c: 0 }, false); }
    selectRowIds(ids) {
      const set = new Set(ids); const ranges = [];
      this.view.forEach((r, i) => { if (set.has(r.id)) ranges.push({ r1: i, r2: i, c1: 0, c2: this.cols.length - 1 }); });
      if (ranges.length) this.setSel(ranges, { r: ranges[0].r1, c: 0 });
    }
    ensureVisible(r, c) {
      const s = this.scroll;
      if (r >= 0 && r < this.view.length) {
        const top = this.tops[r], bot = this.tops[r + 1];
        const vh = s.clientHeight - HEAD_H;
        if (top < s.scrollTop) s.scrollTop = top;
        else if (bot > s.scrollTop + vh) s.scrollTop = bot - vh;
      }
      if (c >= 0 && c < this.cols.length) {
        const x1 = this.colOff[c], x2 = RH_W + this.colOff[c + 1];
        const vis = -s.scrollLeft; // RTL: scrollLeft שלילי
        if (x1 < vis) s.scrollLeft = -x1;
        else if (x2 > vis + s.clientWidth) s.scrollLeft = -(x2 - s.clientWidth);
      }
    }
    emitStats() {
      if (!this.o.onStats) return;
      let count = 0, nums = 0, sum = 0, cells = 0;
      for (const { row, col } of this.eachSelectedCell()) {
        if (++cells > 200000) break;
        const v = this.val(row, col);
        if (v === '' || v == null) continue;
        count++;
        const n = typeof v === 'number' ? v : (col.type === 'number' ? +v : NaN);
        if (!isNaN(n)) { nums++; sum += n; }
      }
      this.o.onStats({ cells, count, nums, sum, avg: nums ? sum / nums : 0, rows: this.selectedRowAny().size, total: this.view.length });
    }

    /* ================= עכבר ================= */
    hit(el) {
      const cell = el.closest('.gc');
      if (cell) return { type: 'cell', r: +cell.parentElement.dataset.r, c: +cell.dataset.c };
      const rh = el.closest('.rh');
      if (rh) return { type: 'row', r: +rh.dataset.rh };
      const gh = el.closest('.gh');
      if (gh) return { type: 'col', c: +gh.dataset.c };
      return null;
    }
    onMouseDown(e) {
      const t = e.target;
      if (this.editor && this.editor.el.contains(t)) return;
      if (t.closest('.gh-menu')) { e.preventDefault(); e.stopPropagation(); this.commitEdit(); const j = +t.closest('.gh-menu').dataset.cm; const r = t.closest('.gh').getBoundingClientRect(); this.columnMenu(j, r.right, r.bottom + 4); return; }
      if (t.closest('.gh-rs')) { e.preventDefault(); this.commitEdit(); return this.startColResize(+t.closest('.gh-rs').dataset.crs, e); }
      if (t.closest('.rh-rs')) { e.preventDefault(); this.commitEdit(); return this.startRowResize(+t.closest('.rh-rs').dataset.rrs, e); }
      if (t.closest('.fill-handle')) { e.preventDefault(); this.commitEdit(); return this.startFill(e); }
      if (t.closest('[data-corner]')) { this.commitEdit(); this.selectAll(); return; }
      const h = this.hit(t);
      if (!h) return;
      this.commitEdit();
      const add = e.ctrlKey || e.metaKey, ext = e.shiftKey;
      const lastC = this.cols.length - 1, lastR = this.view.length - 1;
      if (e.button === 2) { // לחיצה ימנית: לא לשבור בחירה קיימת
        if (h.type === 'cell' && this.inSelection(h.r, h.c)) return;
        if (h.type === 'row' && this.selectedRowFull().has(h.r)) return;
        if (h.type === 'col' && this.ranges.some((g0) => { const g = this.norm(g0); return g.r1 === 0 && g.r2 === lastR && h.c >= g.c1 && h.c <= g.c2; })) return;
      }
      let mk;
      if (h.type === 'cell') mk = (r, c) => ({ r1: this.anchor.r, c1: this.anchor.c, r2: r, c2: c });
      if (h.type === 'row') mk = (r) => ({ r1: this.anchor.r, c1: 0, r2: r, c2: lastC });
      if (h.type === 'col') mk = (r, c) => ({ r1: 0, c1: this.anchor.c, r2: lastR, c2: c });
      if (h.type === 'col' && lastR < 0) return;
      if (!ext || !this.anchor) this.anchor = { r: h.r ?? 0, c: h.c ?? 0 };
      const cur = mk(h.r ?? 0, h.c ?? 0);
      let ranges;
      if (add) ranges = [...this.ranges, cur];
      else if (ext) ranges = [...this.ranges.slice(0, -1), cur];
      else ranges = [cur];
      const active = ext ? this.active : { r: h.r ?? 0, c: h.c ?? 0 };
      this.setSel(ranges, active, h.type === 'cell');
      this.focus();
      if (e.button !== 0) return;
      if (h.type === 'col') return; // גרירת כותרת = סידור עמודות
      e.preventDefault();
      this.dragSelect(h.type, mk);
    }
    inSelection(r, c) { return this.ranges.some((g0) => { const g = this.norm(g0); return r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2; }); }
    dragSelect(type, mk) {
      let last = '';
      let auto = 0, pt = null;
      const step = () => {
        if (!pt) return;
        const sr = this.scroll.getBoundingClientRect();
        let dy = 0; if (pt.y > sr.bottom - 20) dy = 24; else if (pt.y < sr.top + HEAD_H + 10) dy = -24;
        let dx = 0; if (pt.x < sr.left + 20) dx = -24; else if (pt.x > sr.right - RH_W - 10) dx = 24;
        if (dy || dx) { this.scroll.scrollTop += dy; this.scroll.scrollLeft += dx; update(); }
        auto = requestAnimationFrame(step);
      };
      const update = () => {
        const sr = this.scroll.getBoundingClientRect();
        const x = Math.max(sr.left + 2, Math.min(pt.x, sr.right - RH_W - 2));
        const y = Math.max(sr.top + HEAD_H + 2, Math.min(pt.y, sr.bottom - 2));
        const el = document.elementFromPoint(type === 'row' ? sr.right - 10 : x, y);
        if (!el) return;
        const h = this.hit(el); if (!h || h.r == null) return;
        const key = h.r + ':' + h.c; if (key === last) return; last = key;
        this.ranges[this.ranges.length - 1] = mk(h.r, h.c ?? 0);
        this.renderSel(); this.emitStats();
      };
      const move = (e) => { pt = { x: e.clientX, y: e.clientY }; update(); if (!auto) auto = requestAnimationFrame(step); };
      const up = () => { cancelAnimationFrame(auto); auto = 0; pt = null; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    }
    onDblClick(e) {
      const rs = e.target.closest('.gh-rs');
      if (rs) return this.autofit(+rs.dataset.crs);
      const h = this.hit(e.target);
      if (h && h.type === 'cell') { this.active = { r: h.r, c: h.c }; this.startEdit(); }
    }
    onContext(e) {
      const h = this.hit(e.target);
      if (!h) return;
      e.preventDefault();
      if (h.type === 'col') return this.columnMenu(h.c, e.clientX, e.clientY);
      this.cellMenu(e.clientX, e.clientY);
    }

    /* ---------- שינוי גדלים ---------- */
    startColResize(j, e) {
      const col = this.cols[j]; const sx = e.clientX; const sw = col.width;
      document.body.classList.add('resizing-col');
      const move = (ev) => { col.width = Math.max(MIN_W, Math.round(sw + (sx - ev.clientX))); this.layout(); this.renderHead(); this.renderRows(); this.renderSel(); };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        document.body.classList.remove('resizing-col');
        if (col.width === sw) return;
        // אם העמודה חלק מבחירת עמודות שלמות — כולן מקבלות אותו רוחב
        const full = this.fullySelectedCols();
        const targets = full.has(j) ? [...full].map((k) => this.cols[k]) : [col];
        for (const c of targets) { c.width = col.width; Store.touch(c); }
        Store.commit(); this.layout(); this.renderHead(); this.renderRows(); this.renderSel();
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }
    fullySelectedCols() {
      const s = new Set(); const lastR = this.view.length - 1;
      for (const g0 of this.ranges) { const g = this.norm(g0); if (g.r1 === 0 && g.r2 === lastR) for (let c = g.c1; c <= g.c2; c++) s.add(c); }
      return s;
    }
    startRowResize(i, e) {
      const row = this.view[i]; const sy = e.clientY; const sh = this.rowH(row);
      document.body.classList.add('resizing-row');
      const move = (ev) => { row.h = Math.max(MIN_H, Math.round(sh + ev.clientY - sy)); this.layout(); this.renderRows(); this.renderSel(); };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        document.body.classList.remove('resizing-row');
        const h = row.h;
        if (h === sh) return;
        const full = this.selectedRowFull();
        const targets = full.has(i) ? [...full].map((k) => this.view[k]) : [row];
        for (const r of targets) { r.h = h; Store.touch(r); }
        Store.commit(); this.layout(); this.renderRows(); this.renderSel();
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }
    setRowHeight(h) {
      const rows = this.selectedRows();
      this.transact((tx) => rows.forEach((r) => { tx.touch(r); if (h) r.h = h; else delete r.h; }));
    }
    autofit(j) {
      const col = this.cols[j];
      const ctx = (this._ctx ||= document.createElement('canvas').getContext('2d'));
      ctx.font = '500 13px "IBM Plex Sans Hebrew", system-ui, sans-serif';
      let w = ctx.measureText(col.name).width + 54;
      const n = Math.min(this.view.length, 3000);
      for (let i = 0; i < n; i++) w = Math.max(w, ctx.measureText(display(col, this.val(this.view[i], col))).width + 28);
      col.width = Math.min(520, Math.ceil(w)); Store.touch(col); Store.commit();
      this.layout(); this.renderHead(); this.renderRows(); this.renderSel();
    }

    /* ---------- ידית מילוי ---------- */
    startFill(e) {
      const src = this.norm(this.ranges[this.ranges.length - 1]);
      let target = src.r2;
      const ghost = document.createElement('div'); ghost.className = 'fill-ghost'; this.selEl.appendChild(ghost);
      const draw = () => {
        const g = target > src.r2 ? { ...src, r2: target } : target < src.r1 ? { ...src, r1: target } : src;
        const r = this.rectOf(g);
        Object.assign(ghost.style, { top: r.top + 'px', height: r.height + 'px', right: r.right + 'px', width: r.width + 'px' });
      };
      draw();
      const move = (ev) => {
        const sr = this.scroll.getBoundingClientRect();
        if (ev.clientY > sr.bottom - 16) this.scroll.scrollTop += 20;
        const el = document.elementFromPoint(Math.min(Math.max(ev.clientX, sr.left + 4), sr.right - RH_W - 4), Math.min(Math.max(ev.clientY, sr.top + HEAD_H + 2), sr.bottom - 2));
        const h = el && this.hit(el);
        if (h && h.r != null) { target = h.r; draw(); }
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        ghost.remove();
        if (target > src.r2) this.fillRange(src, src.r2 + 1, target, 1);
        else if (target < src.r1) this.fillRange(src, target, src.r1 - 1, -1);
        else this.renderSel();
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }
    fillRange(src, from, to, dir) {
      const h = src.r2 - src.r1 + 1;
      this.transact((tx) => {
        for (let c = src.c1; c <= src.c2; c++) {
          const col = this.cols[c];
          if (this.isRO(col)) continue;
          const vals = []; for (let r = src.r1; r <= src.r2; r++) vals.push(this.val(this.view[r], col));
          // סדרה מספרית (1,2,3…) כמו באקסל
          let stepv = null;
          if (h >= 2 && vals.every((v) => typeof v === 'number')) {
            const d = vals[1] - vals[0];
            if (vals.every((v, i) => i === 0 || Math.abs(v - vals[i - 1] - d) < 1e-9)) stepv = d;
          }
          for (let r = from; r <= to; r++) {
            const row = this.view[r]; if (!row) continue;
            let v;
            if (stepv !== null) v = dir > 0 ? vals[h - 1] + stepv * (r - src.r2) : vals[0] - stepv * (src.r1 - r);
            else { const k = dir > 0 ? (r - src.r1) % h : (h - 1) - ((src.r1 - 1 - r) % h); v = vals[(k + h) % h]; }
            tx.touch(row); row.c[col.id] = v;
          }
        }
      });
      const g = dir > 0 ? { ...src, r2: to } : { ...src, r1: from };
      this.setSel([g], this.active, false);
    }

    /* ---------- גרירת עמודות לסידור ---------- */
    onDragStart(e) {
      const gh = e.target.closest && e.target.closest('.gh');
      if (!gh) return;
      this._dragCol = +gh.dataset.c;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'col');
    }
    onDragOver(e) {
      if (this._dragCol == null) return;
      const gh = e.target.closest('.gh'); if (!gh) return;
      e.preventDefault();
      const r = gh.getBoundingClientRect();
      const before = e.clientX > r.left + r.width / 2; // RTL: הצד הימני = לפני
      this.head.querySelectorAll('.drop-l,.drop-r').forEach((x) => x.classList.remove('drop-l', 'drop-r'));
      gh.classList.add(before ? 'drop-r' : 'drop-l');
    }
    onDrop(e) {
      const gh = e.target.closest('.gh'); const from = this._dragCol; this._dragCol = null;
      if (!gh || from == null) return;
      e.preventDefault();
      const r = gh.getBoundingClientRect();
      const before = e.clientX > r.left + r.width / 2;
      let to = +gh.dataset.c + (before ? 0 : 1);
      const all = Store.columns(this.ds);
      const moving = this.cols[from];
      if (!moving || moving.virtual || (this.cols[+gh.dataset.c] || {}).virtual) return;
      const targetCol = this.cols[to] || null;
      const list = all.filter((c) => c !== moving);
      let idx = targetCol ? list.indexOf(targetCol) : list.length;
      if (idx < 0) idx = list.length;
      list.splice(idx, 0, moving);
      list.forEach((c, i) => { if (c.order !== i) { c.order = i; Store.touch(c); } });
      Store.commit(); this.refresh(true);
    }

    /* ================= מקלדת ================= */
    move(dr, dc, extend) {
      const lastR = this.view.length - 1, lastC = this.cols.length - 1;
      if (lastR < 0) return;
      if (extend) {
        const g = this.ranges[this.ranges.length - 1];
        const ng = { ...g, r2: Math.max(0, Math.min(lastR, g.r2 + dr)), c2: Math.max(0, Math.min(lastC, g.c2 + dc)) };
        this.ranges[this.ranges.length - 1] = ng;
        this.renderSel(); this.ensureVisible(ng.r2, ng.c2); this.emitStats();
        return;
      }
      const r = Math.max(0, Math.min(lastR, this.active.r + dr));
      const c = Math.max(0, Math.min(lastC, this.active.c + dc));
      this.anchor = { r, c };
      this.setSel([{ r1: r, c1: c, r2: r, c2: c }], { r, c });
    }
    onKey(e) {
      if (this.editor) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key;
      const page = Math.max(1, Math.floor((this.scroll.clientHeight - HEAD_H) / this.o.rowHeight()) - 1);
      const map = {
        ArrowDown: [ctrl ? 1e7 : 1, 0], ArrowUp: [ctrl ? -1e7 : -1, 0],
        ArrowLeft: [0, ctrl ? 1e7 : 1], ArrowRight: [0, ctrl ? -1e7 : -1], // RTL
        PageDown: [page, 0], PageUp: [-page, 0],
      };
      if (map[k]) { e.preventDefault(); return this.move(map[k][0], map[k][1], e.shiftKey); }
      if (k === 'Home') { e.preventDefault(); return ctrl ? this.move(-1e7, -1e7) : this.move(0, -1e7); }
      if (k === 'End') { e.preventDefault(); return ctrl ? this.move(1e7, 1e7) : this.move(0, 1e7); }
      if (k === 'Tab') { e.preventDefault(); return this.move(0, e.shiftKey ? -1 : 1); }
      if (k === 'Enter') { e.preventDefault(); if (e.shiftKey) return this.move(-1, 0); return this.startEdit(); }
      if (k === 'F2') { e.preventDefault(); return this.startEdit(); }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); return this.clearSelection(); }
      if (ctrl && (k === 'z' || k === 'Z' || k === 'ז')) { e.preventDefault(); return e.shiftKey ? this.redo() : this.undo(); }
      if (ctrl && (k === 'y' || k === 'ט')) { e.preventDefault(); return this.redo(); }
      if (ctrl && (k === 'a' || k === 'ש')) { e.preventDefault(); return this.selectAll(); }
      if (ctrl && (k === 'd' || k === 'ג')) { e.preventDefault(); return this.fillDown(); }
      if (ctrl && (k === 'c' || k === 'x' || k === 'v' || k === 'ב' || k === 'ס' || k === 'ה')) return; // ייטפל באירועי הלוח
      if (k.length === 1 && !ctrl && !e.altKey) { e.preventDefault(); this.startEdit(k); }
    }

    /* ================= עריכה ================= */
    startEdit(initial) {
      if (!this.view.length || !this.cols.length) return;
      const { r, c } = this.active;
      const row = this.view[r], col = this.cols[c];
      if (this.isRO(col)) return UI.toast('העמודה הזו מחושבת אוטומטית ואינה ניתנת לעריכה.', 'info');
      this.ensureVisible(r, c);
      const rect = this.rectOf({ r1: r, r2: r, c1: c, c2: c });
      const wrap = document.createElement('div');
      wrap.className = 'cell-editor';
      Object.assign(wrap.style, { top: rect.top + 'px', right: rect.right + 'px', minWidth: rect.width + 'px', height: rect.height + 'px' });
      const input = document.createElement('input');
      input.type = 'text'; input.spellcheck = false;
      input.value = initial != null ? initial : editText(col, this.val(row, col));
      if (col.type === 'date') input.placeholder = 'dd/mm/yyyy';
      if (col.type === 'number') input.dir = 'ltr';
      // השלמה אוטומטית מתוך ערכי העמודה
      if (col.type !== 'number') {
        const dl = document.createElement('datalist');
        dl.id = 'dl-' + Store.uid();
        const vals = new Set();
        for (const rr of this.baseRows()) { const v = this.val(rr, col); if (v !== '' && v != null) vals.add(display(col, v)); if (vals.size > 300) break; }
        dl.innerHTML = [...vals].slice(0, 300).map((v) => `<option value="${esc(v)}">`).join('');
        input.setAttribute('list', dl.id); wrap.appendChild(dl);
      }
      wrap.appendChild(input);
      this.body.appendChild(wrap);
      const typed = initial != null;
      this.editor = { el: wrap, input, r, c, rowId: row.id, colId: col.id };
      input.focus();
      if (!typed) input.select(); else input.setSelectionRange(input.value.length, input.value.length);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        const k = e.key;
        if (k === 'Escape') { e.preventDefault(); this.cancelEdit(); this.focus(); }
        else if (k === 'Enter') {
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) { this.commitEdit({ all: true }); this.focus(); return; }
          this.commitEdit(); this.focus(); this.move(e.shiftKey ? -1 : 1, 0);
        } else if (k === 'Tab') { e.preventDefault(); this.commitEdit(); this.focus(); this.move(0, e.shiftKey ? -1 : 1); }
        else if (typed && (k === 'ArrowDown' || k === 'ArrowUp')) { e.preventDefault(); this.commitEdit(); this.focus(); this.move(k === 'ArrowDown' ? 1 : -1, 0); }
      });
      input.addEventListener('blur', () => setTimeout(() => { if (this.editor && this.editor.input === input) this.commitEdit(); }, 0));
    }
    cancelEdit() { if (this.editor) { this.editor.el.remove(); this.editor = null; } }
    commitEdit(opt = {}) {
      const ed = this.editor; if (!ed) return;
      this.editor = null; ed.el.remove();
      const col = this.allCols.find((c) => c.id === ed.colId);
      const row = Store.rowById(this.ds, ed.rowId);
      if (!col || !row) return;
      const val = parseValue(col, ed.input.value);
      if (opt.all) return this.setValueForSelection(ed.input.value);
      if ((this.val(row, col) ?? '') === val) return;
      this.transact((tx) => { tx.touch(row); row.c[col.id] = val; });
    }
    /** החלת ערך אחד על כל התאים המסומנים (כמו Ctrl+Enter באקסל) */
    setValueForSelection(raw, colFilter) {
      this.transact((tx) => {
        for (const { row, col } of this.eachSelectedCell()) {
          if (colFilter && col.id !== colFilter) continue;
          if (this.isRO(col)) continue;
          tx.touch(row); row.c[col.id] = parseValue(col, raw);
        }
      });
    }
    /** קביעת ערך בעמודה מסוימת לכל השורות המסומנות */
    setColumnForSelectedRows(colId, raw) {
      const col = Store.columns(this.ds).find((c) => c.id === colId); if (!col) return;
      const rows = this.selectedRows();
      this.transact((tx) => rows.forEach((row) => { tx.touch(row); row.c[colId] = parseValue(col, raw); }));
    }
    clearSelection() {
      this.transact((tx) => {
        for (const { row, col } of this.eachSelectedCell()) {
          if (this.val(row, col) === '' || this.val(row, col) == null) continue;
          if (this.isRO(col)) continue;
          tx.touch(row); row.c[col.id] = '';
        }
      });
    }
    fillDown() {
      this.transact((tx) => {
        for (const g0 of this.ranges) {
          const g = this.norm(g0);
          const srcR = g.r1 === g.r2 ? g.r1 - 1 : g.r1;
          if (srcR < 0) continue;
          for (let c = g.c1; c <= g.c2; c++) {
            const col = this.cols[c]; if (this.isRO(col)) continue; const v = this.val(this.view[srcR], col);
            for (let r = (g.r1 === g.r2 ? g.r1 : g.r1 + 1); r <= g.r2; r++) { const row = this.view[r]; tx.touch(row); row.c[col.id] = v; }
          }
        }
      });
    }

    /* ================= טרנזקציות וביטול ================= */
    transact(fn) {
      const ds = this.dsObj;
      const before = new Map();
      const api = {
        touch: (row) => { if (!before.has(row.id)) before.set(row.id, clone(row)); Store.touch(row); return row; },
        create: (o) => {
          const row = { id: Store.uid(), c: Object.assign({}, this.o.defaults ? this.o.defaults() : {}), o, createdAt: Store.now() };
          if (this.o.rowProps) Object.assign(row, this.o.rowProps());
          before.set(row.id, Object.assign(clone(row), { deleted: true }));
          Store.touch(row); ds.rows.push(row); this.flashIds.add(row.id);
          clearTimeout(this._ft); this._ft = setTimeout(() => this.flashIds.clear(), 1400);
          return row;
        },
      };
      fn(api);
      if (!before.size) return;
      const idx = new Map(ds.rows.map((r) => [r.id, r]));
      const after = [...before.keys()].map((id) => clone(idx.get(id)));
      this.undoStack.push({ before: [...before.values()], after });
      if (this.undoStack.length > 150) this.undoStack.shift();
      this.redoStack = [];
      Store.commit();
      this.refresh(true);
      this.o.onChange && this.o.onChange();
    }
    applySnaps(snaps) {
      const ds = this.dsObj;
      const pos = new Map(ds.rows.map((r, i) => [r.id, i]));
      for (const s of snaps) {
        const copy = clone(s); copy.updatedAt = Store.now(); copy.by = Store.session && Store.session.userId;
        const i = pos.get(s.id);
        if (i != null) ds.rows[i] = copy; else { pos.set(s.id, ds.rows.length); ds.rows.push(copy); }
      }
      Store.commit(); this.refresh(true); this.o.onChange && this.o.onChange();
    }
    undo() { const e = this.undoStack.pop(); if (!e) return UI.toast('אין פעולות לביטול'); this.applySnaps(e.before); this.redoStack.push(e); }
    redo() { const e = this.redoStack.pop(); if (!e) return; this.applySnaps(e.after); this.undoStack.push(e); }

    /* ================= שורות ================= */
    orderBetween(a, b) {
      const oa = a ? a.o || 0 : (b ? (b.o || 0) - 1 : 0);
      const ob = b ? b.o || 0 : oa + 2;
      return oa + (ob - oa) / 2;
    }
    maxOrder() { return Store.rows(this.ds).reduce((m, r) => Math.max(m, r.o || 0), 0); }
    insertRows(where) {
      const rows = this.selectedRows();
      const count = Math.max(1, rows.length);
      const sorted = [...Store.rows(this.ds)].sort((a, b) => (a.o || 0) - (b.o || 0));
      const pivot = where === 'above' ? rows[0] : rows[rows.length - 1];
      let lo, hi;
      if (!pivot) { lo = sorted[sorted.length - 1]; hi = null; }
      else {
        const i = sorted.indexOf(pivot);
        if (where === 'above') { lo = sorted[i - 1] || null; hi = pivot; } else { lo = pivot; hi = sorted[i + 1] || null; }
      }
      const created = [];
      this.transact((tx) => {
        const loO = lo ? lo.o || 0 : (hi ? (hi.o || 0) - 1 : 0);
        const hiO = hi ? hi.o || 0 : loO + count + 1;
        for (let k = 1; k <= count; k++) created.push(tx.create(loO + ((hiO - loO) * k) / (count + 1)).id);
      });
      this.selectRowIds(created);
    }
    appendRows(n = 1) {
      let o = this.maxOrder();
      const ids = [];
      this.transact((tx) => { for (let i = 0; i < n; i++) ids.push(tx.create(++o).id); });
      this.selectRowIds(ids);
      const idx = this.view.findIndex((r) => r.id === ids[0]);
      if (idx >= 0) { this.active = { r: idx, c: 0 }; this.ensureVisible(idx, 0); this.renderSel(); }
    }
    deleteSelectedRows() {
      const rows = this.selectedRows();
      if (!rows.length) return;
      this.transact((tx) => rows.forEach((r) => { tx.touch(r); r.deleted = true; }));
      UI.toast(`נמחקו ${rows.length} שורות · אפשר לבטל עם Ctrl+Z`, 'info');
      this.ranges = [{ r1: this.active.r, r2: this.active.r, c1: this.active.c, c2: this.active.c }];
      this.clampSel(); this.renderSel();
    }

    /* ================= לוח ================= */
    onCopy(e) {
      const g = this.norm(this.ranges[this.ranges.length - 1]);
      const lines = [];
      for (let r = g.r1; r <= g.r2; r++) {
        const row = this.view[r]; if (!row) continue;
        const cells = [];
        for (let c = g.c1; c <= g.c2; c++) { const col = this.cols[c]; cells.push(tsvCell(editText(col, this.val(row, col) ?? ''))); }
        lines.push(cells.join('\t'));
      }
      e.clipboardData.setData('text/plain', lines.join('\n'));
      e.preventDefault();
      this.flashCopy(g);
    }
    flashCopy(g) {
      const r = this.rectOf(g);
      const d = document.createElement('div'); d.className = 'copy-ants';
      Object.assign(d.style, { top: r.top + 'px', height: r.height + 'px', right: r.right + 'px', width: r.width + 'px' });
      this.selEl.appendChild(d); setTimeout(() => d.remove(), 1600);
    }
    onPaste(e) {
      const text = e.clipboardData.getData('text/plain');
      if (text == null) return;
      e.preventDefault();
      this.pasteText(text);
    }
    pasteText(text) {
      const m = parseTSV(text);
      if (!m.length) return;
      if (m.length === 1 && m[0].length === 1) return this.setValueForSelection(m[0][0]);
      const g = this.norm(this.ranges[0]);
      const startR = g.r1, startC = g.c1;
      const need = startR + m.length - this.view.length;
      this.transact((tx) => {
        const targets = this.view.slice(startR, startR + m.length);
        let o = this.maxOrder();
        for (let k = 0; k < need; k++) targets.push(tx.create(++o));
        m.forEach((line, i) => {
          const row = targets[i]; if (!row) return;
          tx.touch(row);
          line.forEach((v, j) => {
            const col = this.cols[startC + j]; if (!col) return;
            if (this.isRO(col)) return;
            row.c[col.id] = parseValue(col, v);
          });
        });
      });
      const r2 = Math.min(this.view.length - 1, startR + m.length - 1);
      const c2 = Math.min(this.cols.length - 1, startC + Math.max(...m.map((l) => l.length)) - 1);
      this.setSel([{ r1: startR, c1: startC, r2, c2 }], { r: startR, c: startC }, false);
      if (need > 0) UI.toast(`נוספו ${need} שורות חדשות מההדבקה`, 'ok');
    }
    async pasteFromMenu() {
      try { const t = await navigator.clipboard.readText(); this.pasteText(t); }
      catch { UI.toast('הדפדפן חוסם הדבקה מהתפריט. השתמש ב-Ctrl+V.', 'info'); }
    }
    copyFromMenu() { document.execCommand('copy'); }

    /* ================= תפריטים ================= */
    cellMenu(x, y) {
      const rows = this.selectedRowAny().size;
      const col = this.cols[this.active.c];
      const cellsN = [...this.eachSelectedCell()].length;
      UI.menu(x, y, [
        { label: 'העתקה', icon: 'copy', shortcut: 'Ctrl+C', action: () => { this.focus(); this.copyFromMenu(); } },
        { label: 'הדבקה', icon: 'paste', shortcut: 'Ctrl+V', action: () => this.pasteFromMenu() },
        { sep: true },
        { label: cellsN > 1 ? `הזנת ערך ל-${cellsN} תאים מסומנים…` : 'הזנת ערך…', icon: 'wand', shortcut: 'Ctrl+Enter', action: () => this.bulkValueDialog() },
        { label: 'מילוי למטה', icon: 'fillDown', shortcut: 'Ctrl+D', action: () => this.fillDown() },
        { label: 'ניקוי תוכן', icon: 'x', shortcut: 'Delete', action: () => this.clearSelection() },
        { sep: true },
        { label: `הוספת ${rows > 1 ? rows + ' שורות' : 'שורה'} מעל`, icon: 'rowAbove', action: () => this.insertRows('above') },
        { label: `הוספת ${rows > 1 ? rows + ' שורות' : 'שורה'} מתחת`, icon: 'rowBelow', action: () => this.insertRows('below') },
        { label: 'גובה שורה…', icon: 'height', action: () => this.rowHeightDialog() },
        { label: rows > 1 ? `מחיקת ${rows} שורות` : 'מחיקת שורה', icon: 'trash', danger: true, action: () => this.deleteSelectedRows() },
        { sep: true },
        col && { label: `סינון לפי "${display(col, (this.view[this.active.r] ? this.val(this.view[this.active.r], col) : '')) || 'ריק'}"`, icon: 'filter', action: () => { this.filters[col.id] = new Set([display(col, this.val(this.view[this.active.r], col))]); this.refresh(); this.o.onFilter && this.o.onFilter(); } },
        col && { label: `מיון לפי "${col.name}" (א→ת)`, icon: 'sortAsc', action: () => this.setSort(col.id, 1) },
      ]);
    }
    bulkValueDialog() {
      const cells = [...this.eachSelectedCell()];
      const cols = [...new Set(cells.map((x) => x.col))];
      const body = document.createElement('div');
      body.innerHTML = `<p class="muted">הערך יוחל על התאים המסומנים (${cells.length} תאים, ${this.selectedRowAny().size} שורות).</p>
        ${cols.length > 1 ? `<label class="field"><span>להחיל על</span><select data-col><option value="">כל התאים המסומנים</option>${cols.map((c) => `<option value="${c.id}">רק בעמודה "${esc(c.name)}"</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>ערך</span><input type="text" data-val placeholder="הקלד ערך…"></label>`;
      UI.modal({
        title: 'הזנת ערך לכמה תאים', body,
        actions: [{ label: 'ביטול' }, { label: 'החלה', primary: true, icon: 'wand', action: (el) => { const c = el.querySelector('[data-col]'); this.setValueForSelection(el.querySelector('[data-val]').value, c && c.value); this.focus(); } }],
      });
    }
    async rowHeightDialog() {
      const cur = this.rowH(this.view[this.active.r] || {});
      const v = await UI.prompt('גובה שורה', 'גובה בפיקסלים (השאר ריק לברירת המחדל)', String(cur));
      if (v === null) return;
      this.setRowHeight(v ? Math.max(MIN_H, +v || cur) : 0);
    }
    setSort(colId, dir) { this.sort = dir ? { colId, dir } : null; this.refresh(); }
    columnMenu(j, x, y) {
      const col = this.cols[j]; if (!col) return;
      if (col.virtual) return UI.menu(x, y, [{ title: col.name + ' · מחושב' }, { label: 'מיון עולה', icon: 'sortAsc', action: () => this.setSort(col.id, 1) }, { label: 'מיון יורד', icon: 'sortDesc', action: () => this.setSort(col.id, -1) }, { label: 'סינון ערכים…', icon: 'filter', action: () => this.filterDialog(col) }, this.filters[col.id] ? { label: 'ניקוי סינון', icon: 'x', action: () => { delete this.filters[col.id]; this.refresh(); } } : null]);
      const typeItem = (t, l) => ({ label: (col.type === t ? '✓ ' : '') + l, icon: col.type === t ? 'check' : null, action: () => { col.type = t; Store.touch(col); Store.commit(); this.refresh(true); } });
      const extra = this.o.columnMenuExtra ? this.o.columnMenuExtra(col) : [];
      UI.menu(x, y, [
        { title: col.name },
        { label: 'מיון עולה', icon: 'sortAsc', action: () => this.setSort(col.id, 1) },
        { label: 'מיון יורד', icon: 'sortDesc', action: () => this.setSort(col.id, -1) },
        this.sort ? { label: 'ביטול מיון', icon: 'x', action: () => this.setSort(null, 0) } : null,
        { label: 'סינון ערכים…', icon: 'filter', action: () => this.filterDialog(col) },
        this.filters[col.id] ? { label: 'ניקוי סינון בעמודה', icon: 'x', action: () => { delete this.filters[col.id]; this.refresh(); this.o.onFilter && this.o.onFilter(); } } : null,
        { sep: true },
        { label: 'שינוי שם…', icon: 'edit', action: async () => { const n = await UI.prompt('שינוי שם עמודה', 'שם העמודה', col.name); if (n) { col.name = n; Store.touch(col); Store.commit(); this.refresh(true); } } },
        { label: 'התאמת רוחב לתוכן', icon: 'columns', action: () => this.autofit(j) },
        { label: 'הוספת עמודה מימין', icon: 'plus', action: () => this.addColumn(j, 0) },
        { label: 'הוספת עמודה משמאל', icon: 'plus', action: () => this.addColumn(j, 1) },
        { sep: true },
        { title: 'סוג נתונים' },
        typeItem('text', 'טקסט'), typeItem('number', 'מספר'), typeItem('date', 'תאריך'),
        ...(extra.length ? [{ sep: true }, ...extra] : []),
        { sep: true },
        { label: 'הסתרת עמודה', icon: 'eyeOff', action: () => { col.hidden = true; Store.touch(col); Store.commit(); this.refresh(true); } },
        { label: 'מחיקת עמודה', icon: 'trash', danger: true, action: async () => { if (await UI.confirm('מחיקת עמודה', `העמודה "${col.name}" תימחק מכל הלשוניות. הנתונים שבה לא יוצגו יותר.`, 'מחיקה', true)) { col.deleted = true; Store.touch(col); Store.commit(); this.refresh(true); this.o.onChange && this.o.onChange(); } } },
      ]);
    }
    addColumn(j, side) {
      const all = Store.columns(this.ds);
      const ref = this.cols[j];
      const idx = ref ? all.indexOf(ref) + side : all.length;
      const col = { id: 'c' + Store.uid(), name: 'עמודה חדשה', width: 140, type: 'text', order: 0 };
      all.splice(idx, 0, col);
      all.forEach((c, i) => { c.order = i; Store.touch(c); });
      this.dsObj.columns.push(col);
      Store.commit(); this.refresh(true);
      const nj = this.cols.indexOf(col);
      UI.prompt('עמודה חדשה', 'שם העמודה', 'עמודה חדשה').then((n) => { if (n) { col.name = n; Store.touch(col); Store.commit(); this.refresh(true); } });
      if (nj >= 0) this.ensureVisible(this.active.r, nj);
    }
    filterDialog(col) {
      const counts = new Map();
      for (const r of this.baseRows()) { const d = display(col, this.val(r, col)); counts.set(d, (counts.get(d) || 0) + 1); }
      const coll = new Intl.Collator('he', { numeric: true });
      const vals = [...counts.keys()].sort((a, b) => (a === '') - (b === '') || coll.compare(a, b));
      const cur = this.filters[col.id];
      const body = document.createElement('div');
      body.className = 'filter-dlg';
      body.innerHTML = `<label class="field search-field">${UI.icon('search', 15)}<input type="search" placeholder="חיפוש ערך…" data-q></label>
        <label class="chk all"><input type="checkbox" data-all ${!cur ? 'checked' : ''}><span>בחירת הכול</span></label>
        <div class="filter-list">${vals.map((v) => `<label class="chk" data-v="${esc(v.toLowerCase())}"><input type="checkbox" value="${esc(v)}" ${!cur || cur.has(v) ? 'checked' : ''}><span>${v === '' ? '<i class="muted">(ריק)</i>' : esc(v)}</span><em>${counts.get(v)}</em></label>`).join('')}</div>`;
      const list = () => [...body.querySelectorAll('.filter-list input')];
      body.querySelector('[data-all]').addEventListener('change', (e) => list().forEach((i) => { if (!i.closest('.chk').hidden) i.checked = e.target.checked; }));
      body.querySelector('[data-q]').addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); body.querySelectorAll('.filter-list .chk').forEach((l) => (l.hidden = q && !l.dataset.v.includes(q))); });
      UI.modal({
        title: `סינון: ${col.name}`, body,
        actions: [
          { label: 'ניקוי', action: () => { delete this.filters[col.id]; this.refresh(); this.o.onFilter && this.o.onFilter(); } },
          { label: 'החלת סינון', primary: true, icon: 'filter', action: () => {
            const on = list().filter((i) => i.checked && !i.closest('.chk').hidden).map((i) => i.value);
            if (on.length === vals.length) delete this.filters[col.id]; else this.filters[col.id] = new Set(on);
            this.refresh(); this.o.onFilter && this.o.onFilter();
          } },
        ],
      });
    }
    clearFilters() { this.filters = {}; this.sort = null; this.search = ''; this.refresh(); }
    setSearch(q) { this.search = q.trim(); this.refresh(); }
    exportData() { return { cols: this.cols, rows: this.view }; }
  }

  Grid.util = { display, parseValue, parseDate, fmtDate, editText };
  global.Grid = Grid;
})(window);
