/* =========================================================
   grid.js — טבלה בסגנון אקסל
   רינדור וירטואלי (רק השורות שעל המסך), בחירת טווחים מרובים,
   שינוי רוחב/גובה בגרירה, עריכה, העתק/הדבק מאקסל, ידית מילוי,
   Ctrl+Enter להחלה על כל התאים המסומנים, סינון ומיון, ביטול/חזרה.
   ========================================================= */
(function (global) {
  'use strict';
  const RH_W = 56;
  const HEAD_H = 58;
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
  const H_CACHE = new Map();
  const NUMF = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  function display(col, v) {
    if (v == null || v === '') return '';
    if (col.type === 'date') return fmtDate(String(v));
    if (col.type === 'number' && typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 1000 ? String(v) : NUMF.format(v);
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
      this.colSearch = {};        // colId -> טקסט לחיפוש בתוך העמודה
      this.search = '';
      this.view = []; this.cols = []; this.tops = [0]; this.colOff = [0];
      this.ranges = [{ r1: 0, c1: 0, r2: 0, c2: 0 }];
      this.active = { r: 0, c: 0 };
      this.undoStack = []; this.redoStack = [];
      this.editor = null;
      this._raf = 0;
      this.flashIds = new Set();
      this.z = 1;
      // מטמון גבהים משותף לכל הטבלאות (מפתח כולל רוחב עמודות, גופן וזמן עדכון) — פתיחה חוזרת של לשונית מיידית
      this.hCache = H_CACHE;
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

      this.scroll.addEventListener('scroll', () => {
        this.queueRender(true);
        // בזמן גלילה מקפיאים אנימציות רקע כבדות (טשטוש זכוכית) כדי שהגלילה תהיה חלקה
        document.body.classList.add('is-scrolling');
        clearTimeout(this._st); this._st = setTimeout(() => document.body.classList.remove('is-scrolling'), 160);
      }, { passive: true });
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
      // זום לטבלה: Ctrl+גלגלת מעל הטבלה (לא משנה את גודל האתר)
      this.scroll.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        this.setZoom(this.z + (e.deltaY < 0 ? 0.1 : -0.1));
      }, { passive: false });
      this._ro = new ResizeObserver(() => this.queueRender());
      this._ro.observe(this.scroll);
    }
    destroy() { this._ro && this._ro.disconnect(); this.commitEdit(); this.host.innerHTML = ''; }
    focus() { this.scroll.focus({ preventScroll: true }); }
    get dsObj() { return Store.db.datasets[this.ds]; }
    rowH(row) {
      if (row.h) return row.h;
      const base = this.o.rowHeight();
      if (!this.o.wrap || !this.o.wrap()) return base;
      return this.autoH(row, base);
    }
    /** גובה אוטומטי לפי אורך הטקסט: כמה שורות צריך התא הארוך ביותר ברוחב העמודה שלו */
    autoH(row, base) {
      const f = this.o.cellFont ? this.o.cellFont() : { font: 'Rubik', size: 14 };
      const key = row.updatedAt + '|' + this.colSig + '|' + base + '|' + f.font + f.size;
      const hit = this.hCache.get(this.ds + row.id);
      if (hit && hit.k === key) return hit.h;
      const ctx = (this._ctx ||= document.createElement('canvas').getContext('2d'));
      ctx.font = `400 ${f.size}px "${f.font}", "Rubik", system-ui, sans-serif`;
      const cw = f.size * 0.44, lh = Math.round(f.size * 1.38);
      let lines = 1;
      for (const col of this.cols) {
        if (col.type === 'number') continue;
        const v = this.val(row, col);
        if (v === '' || v == null) continue;
        const txt = display(col, v);
        const avail = (col.width || 120) - 26;
        const breaks = (txt.match(/\n/g) || []).length + 1;
        if (txt.length * cw <= avail && breaks === 1) continue;
        let need = breaks;
        if (txt.length * cw > avail) need = Math.max(need, Math.ceil((ctx.measureText(txt).width * 1.08) / avail));
        if (need > lines) lines = need;
        if (lines >= 8) { lines = 8; break; }
      }
      const h = lines === 1 ? Math.max(base, lh + 14) : Math.max(base, lines * lh + 14);
      this.hCache.set(this.ds + row.id, { k: key, h });
      return h;
    }
    /** זום לטבלה בלבד (לא לכל האתר) */
    setZoom(z) {
      this.z = Math.max(0.5, Math.min(2, Math.round(z * 100) / 100));
      const host = this.host.querySelector('.grid-host');
      if (host) host.style.zoom = this.z;
      this.queueRender();
      this.o.onZoom && this.o.onZoom(this.z);
      return this.z;
    }
    val(row, col) { return col.get ? col.get(row) : row.c[col.id]; }
    allow(k) { return !this.o[k] || this.o[k](); }
    isRO(col, row) { return !!col.virtual || !!(this.o.readOnly && this.o.readOnly(col, row)); }

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
      for (const [cid, q0] of Object.entries(this.colSearch)) {
        const col = allCols.find((c) => c.id === cid);
        const q = String(q0 || '').trim().toLowerCase();
        if (!col || !q) { delete this.colSearch[cid]; continue; }
        rows = rows.filter((r) => display(col, this.val(r, col)).toLowerCase().includes(q));
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
      const off = [0];
      for (let j = 0; j < this.cols.length; j++) off.push(off[j] + (this.cols[j].width || 120));
      this.colSig = this.cols.map((c) => c.id + ':' + c.width).join(',');
      const t = [0];
      for (let i = 0; i < this.view.length; i++) t.push(t[i] + this.rowH(this.view[i]));
      this.tops = t;
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
    queueRender(fromScroll) {
      if (!fromScroll) this._dirty = true;
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; const f = this._dirty; this._dirty = false; this.renderRows(!f); });
    }
    renderHead() {
      const selCols = this.selectedColSet();
      let h = `<div class="gh-corner" data-corner title="בחירת הכול">${UI.icon('table', 14)}</div>`;
      this.cols.forEach((c, j) => {
        const f = this.filters[c.id];
        const s = this.sort && this.sort.colId === c.id ? this.sort.dir : 0;
        const marks = (this.colSearch[c.id] ? `<span class="gh-mark" title="חיפוש: ${esc(this.colSearch[c.id])}">${UI.icon('search', 12)}</span>` : '') + (f ? `<span class="gh-mark" title="מסונן">${UI.icon('filter', 12)}</span>` : '') + (s ? `<span class="gh-mark">${UI.icon(s > 0 ? 'sortAsc' : 'sortDesc', 12)}</span>` : '');
        let role = this.o.colRole ? this.o.colRole(c.id) : '';
        if (role && c.name.replace(/["'״׳]/g, '').includes(role.replace(/["'״׳]/g, ''))) role = '';
        const locked = this.o.colLocked && this.o.colLocked(c);
        h += `<div title="${locked ? 'לקריאה בלבד בתפקיד שלך' : ''}" class="gh${this.isFrz(c, j) ? ' frz' : ''}${selCols.has(j) ? ' hl' : ''}${f ? ' filtered' : ''}${locked ? ' locked' : ''}" data-c="${j}" style="width:${c.width}px" draggable="true" role="columnheader" title="${esc(c.name)}${role ? ' · ' + esc(role) : ''}">
          <span class="gh-text"><span class="gh-name">${esc(c.name)}</span>${role || locked ? `<span class="gh-role${locked ? ' ro' : ''}">${locked ? UI.icon('lock', 10) : ''}${esc(role || 'קריאה בלבד')}</span>` : ''}</span>${marks}
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
      return [lo, end];
    }
    renderRows(onlyIfNeeded) {
      const [va, vb] = this.visibleRange();
      // גלילה בתוך החלון שכבר מצויר — אין צורך לצייר מחדש
      const R = this._rng;
      if (onlyIfNeeded && R && R.view === this.view && R.w === this.totalW && va >= R.a && vb <= R.b) return;
      const OV = 14;
      const a = Math.max(0, va - OV), b = Math.min(this.view.length, vb + OV);
      this._rng = { a, b, view: this.view, w: this.totalW };
      const selRows = this.selectedRowFull();
      const touched = this.selectedRowAny();
      const decorate = this.o.decorate;
      const wrap = !!(this.o.wrap && this.o.wrap());
      let html = '';
      for (let i = a; i < b; i++) {
        const row = this.view[i];
        const h = this.rowH(row);
        html += `<div class="gr${i % 2 ? ' odd' : ''}${selRows.has(i) ? ' rsel' : ''}${this.flashIds.has(row.id) ? ' flash' : ''}" style="top:${this.tops[i]}px;height:${h}px;width:${this.totalW}px" data-r="${i}" role="row">`;
        html += `<div class="rh${touched.has(i) ? ' hl' : ''}" data-rh="${i}">${i + 1}<span class="rh-rs" data-rrs="${i}"></span></div>`;
        for (let j = 0; j < this.cols.length; j++) {
          const col = this.cols[j];
          const v = this.val(row, col);
          const txt = display(col, v);
          const d = decorate ? decorate(row, col, v, txt) : null;
          const cls = 'gc t-' + (col.type || 'text') + (wrap ? ' wrap' : '') + (col.align ? ' al-' + col.align : '') + (this.isFrz(col, j) ? ' frz' : '') + (!col.virtual && this.o.readOnly && this.o.readOnly(col, row) ? ' ro' : '') + (d && d.cls ? ' ' + d.cls : '');
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
        let dy = 0; if (pt.y > sr.bottom - 20) dy = 24; else if (pt.y < sr.top + HEAD_H * this.z + 10) dy = -24;
        let dx = 0; if (pt.x < sr.left + 20) dx = -24; else if (pt.x > sr.right - RH_W * this.z - 10) dx = 24;
        if (dy || dx) { this.scroll.scrollTop += dy; this.scroll.scrollLeft += dx; update(); }
        auto = requestAnimationFrame(step);
      };
      const update = () => {
        const sr = this.scroll.getBoundingClientRect();
        const x = Math.max(sr.left + 2, Math.min(pt.x, sr.right - RH_W * this.z - 2));
        const y = Math.max(sr.top + HEAD_H * this.z + 2, Math.min(pt.y, sr.bottom - 2));
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
      const move = (ev) => { col.width = Math.max(MIN_W, Math.round(sw + (sx - ev.clientX) / this.z)); this.layout(); this.renderHead(); this.renderRows(); this.renderSel(); };
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
      const move = (ev) => { row.h = Math.max(MIN_H, Math.round(sh + (ev.clientY - sy) / this.z)); this.layout(); this.renderRows(); this.renderSel(); };
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
      ctx.font = '400 14px "Rubik", system-ui, sans-serif';
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
        const el = document.elementFromPoint(Math.min(Math.max(ev.clientX, sr.left + 4), sr.right - RH_W * this.z - 4), Math.min(Math.max(ev.clientY, sr.top + HEAD_H * this.z + 2), sr.bottom - 2));
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
          if (col.virtual) continue;
          const vals = []; for (let r = src.r1; r <= src.r2; r++) vals.push(this.val(this.view[r], col));
          // סדרה מספרית (1,2,3…) כמו באקסל
          let stepv = null;
          if (h >= 2 && vals.every((v) => typeof v === 'number')) {
            const d = vals[1] - vals[0];
            if (vals.every((v, i) => i === 0 || Math.abs(v - vals[i - 1] - d) < 1e-9)) stepv = d;
          }
          for (let r = from; r <= to; r++) {
            const row = this.view[r]; if (!row || this.isRO(col, row)) continue;
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
      if (!this.allow('canAdmin')) return;
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
      if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); return this.setZoom(this.z + 0.1); }
      if (ctrl && (k === '-' || k === '_')) { e.preventDefault(); return this.setZoom(this.z - 0.1); }
      if (ctrl && k === '0') { e.preventDefault(); return this.setZoom(1); }
      if (ctrl && (k === 'd' || k === 'ג')) { e.preventDefault(); return this.fillDown(); }
      if (ctrl && (k === 'c' || k === 'x' || k === 'v' || k === 'ב' || k === 'ס' || k === 'ה')) return; // ייטפל באירועי הלוח
      if (k.length === 1 && !ctrl && !e.altKey) { e.preventDefault(); this.startEdit(k); }
    }

    /* ================= עריכה ================= */
    startEdit(initial) {
      if (!this.view.length || !this.cols.length) return;
      const { r, c } = this.active;
      const row = this.view[r], col = this.cols[c];
      if (this.isRO(col, row)) return UI.toast(col.virtual ? 'העמודה הזו מחושבת אוטומטית ואינה ניתנת לעריכה.' : 'אין לך הרשאה לערוך את העמודה הזו.', 'info');
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
          if (this.isRO(col, row)) continue;
          tx.touch(row); row.c[col.id] = parseValue(col, raw);
        }
      });
    }
    /** קביעת ערך בעמודה מסוימת לכל השורות המסומנות */
    setColumnForSelectedRows(colId, raw) {
      const col = Store.columns(this.ds).find((c) => c.id === colId); if (!col) return;
      const rows = this.selectedRows();
      this.transact((tx) => rows.forEach((row) => { if (this.isRO(col, row)) return; tx.touch(row); row.c[colId] = parseValue(col, raw); }));
    }
    clearSelection() {
      this.transact((tx) => {
        for (const { row, col } of this.eachSelectedCell()) {
          if (this.val(row, col) === '' || this.val(row, col) == null) continue;
          if (this.isRO(col, row)) continue;
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
            const col = this.cols[c]; if (col.virtual) continue; const v = this.val(this.view[srcR], col);
            for (let r = (g.r1 === g.r2 ? g.r1 : g.r1 + 1); r <= g.r2; r++) { const row = this.view[r]; if (this.isRO(col, row)) continue; tx.touch(row); row.c[col.id] = v; }
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
          row.createdBy = Store.session && Store.session.userId;
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
      if (!this.allow('canAdd')) return UI.toast('אין לך הרשאה להוסיף שורות.', 'info');
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
      if (!this.allow('canAdd')) return UI.toast('אין לך הרשאה להוסיף שורות.', 'info');
      let o = this.maxOrder();
      const ids = [];
      this.transact((tx) => { for (let i = 0; i < n; i++) ids.push(tx.create(++o).id); });
      this.selectRowIds(ids);
      const idx = this.view.findIndex((r) => r.id === ids[0]);
      if (idx >= 0) { this.active = { r: idx, c: 0 }; this.ensureVisible(idx, 0); this.renderSel(); }
    }
    deleteSelectedRows() {
      if (!this.allow('canDel')) return UI.toast('אין לך הרשאה למחוק שורות.', 'info');
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
      let need = startR + m.length - this.view.length;
      if (need > 0 && this.o.canAdd && !this.o.canAdd()) { UI.toast('אין לך הרשאה להוסיף שורות — הודבקו רק השורות הקיימות.', 'info', 5000); m.length = this.view.length - startR; need = 0; }
      let blocked = 0;
      this.transact((tx) => {
        const targets = this.view.slice(startR, startR + m.length);
        let o = this.maxOrder();
        for (let k = 0; k < need; k++) targets.push(tx.create(++o));
        m.forEach((line, i) => {
          const row = targets[i]; if (!row) return;
          let touched = false;
          line.forEach((v, j) => {
            const col = this.cols[startC + j]; if (!col) return;
            if (this.isRO(col, row)) { blocked++; return; }
            if (!touched) { tx.touch(row); touched = true; }
            row.c[col.id] = parseValue(col, v);
          });
        });
      });
      const r2 = Math.min(this.view.length - 1, startR + m.length - 1);
      const c2 = Math.min(this.cols.length - 1, startC + Math.max(...m.map((l) => l.length)) - 1);
      this.setSel([{ r1: startR, c1: startC, r2, c2 }], { r: startR, c: startC }, false);
      if (need > 0) UI.toast(`נוספו ${need} שורות חדשות מההדבקה`, 'ok');
      if (blocked) UI.toast(`${blocked} תאים לא עודכנו — אין לך הרשאת עריכה לעמודות האלה.`, 'info', 5000);
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
        { label: `הוספת ${rows > 1 ? rows + ' שורות' : 'שורה'} מעל`, icon: 'rowAbove', disabled: !this.allow('canAdd'), action: () => this.insertRows('above') },
        { label: `הוספת ${rows > 1 ? rows + ' שורות' : 'שורה'} מתחת`, icon: 'rowBelow', disabled: !this.allow('canAdd'), action: () => this.insertRows('below') },
        { label: 'גובה שורה…', icon: 'height', action: () => this.rowHeightDialog() },
        { label: rows > 1 ? `מחיקת ${rows} שורות` : 'מחיקת שורה', icon: 'trash', danger: true, disabled: !this.allow('canDel'), action: () => this.deleteSelectedRows() },
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
      // תפריט עמודה: הסינון במרכז, וכל הפעולות בחלונית צדדית שנפתחת לידו
      const M = (items) => this.columnPanel(col, j, items.filter((it) => !(it && it.label && /סינון|^מיון (עולה|יורד)$/.test(it.label))));
      if (col.virtual) return M( [{ title: col.name + ' · מחושב' }, { label: 'חיפוש בתוך העמודה…', icon: 'search', action: () => this.columnSearch(col, x, y) }, { label: 'מיון עולה', icon: 'sortAsc', action: () => this.setSort(col.id, 1) }, { label: 'מיון יורד', icon: 'sortDesc', action: () => this.setSort(col.id, -1) }, { label: 'סינון ערכים…', icon: 'filter', action: () => this.filterDialog(col) }, this.filters[col.id] ? { label: 'ניקוי סינון', icon: 'x', action: () => { delete this.filters[col.id]; this.refresh(); } } : null]);
      const typeItem = (t, l) => ({ label: (col.type === t ? '✓ ' : '') + l, icon: col.type === t ? 'check' : null, action: () => { col.type = t; Store.touch(col); Store.commit(); this.refresh(true); } });
      const extra = this.o.columnMenuExtra ? this.o.columnMenuExtra(col) : [];
      const admin = this.allow('canAdmin');
      const searchItem = { label: this.colSearch[col.id] ? `חיפוש בעמודה: "${this.colSearch[col.id]}"` : 'חיפוש בתוך העמודה…', icon: 'search', action: () => this.columnSearch(col, x, y) };
      const clearSearch = this.colSearch[col.id] ? { label: 'ניקוי החיפוש בעמודה', icon: 'x', action: () => { delete this.colSearch[col.id]; this.refresh(); this.o.onSearch && this.o.onSearch(); } } : null;
      if (!admin) return M( [{ title: col.name }, searchItem, clearSearch, { label: 'מיון עולה', icon: 'sortAsc', action: () => this.setSort(col.id, 1) }, { label: 'מיון יורד', icon: 'sortDesc', action: () => this.setSort(col.id, -1) }, { label: 'סינון ערכים…', icon: 'filter', action: () => this.filterDialog(col) }, this.filters[col.id] ? { label: 'ניקוי סינון', icon: 'x', action: () => { delete this.filters[col.id]; this.refresh(); this.o.onFilter && this.o.onFilter(); } } : null, { label: 'התאמת רוחב לתוכן', icon: 'columns', action: () => this.autofit(j) }]);
      M( [
        { title: col.name },
        searchItem, clearSearch,
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
        { sep: true },
        { title: 'יישור בעמודה' },
        ...[['right', 'ימין'], ['center', 'מרכז'], ['left', 'שמאל'], ['', 'לפי הגדרת הטבלה']].map(([k, l]) => ({ label: ((col.align || '') === k ? '✓ ' : '') + l, icon: k ? 'align-' + k : 'refresh', action: () => { if (k) col.align = k; else delete col.align; Store.touch(col); Store.commit(); this.refresh(true); } })),
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
    columnPanel(col, j, items) {
      UI.closeMenu && UI.closeMenu();
      document.querySelectorAll('.colp, .colp-side').forEach((e) => e.remove());
      const gh = this.head.querySelector(`.gh[data-c="${j}"]`);
      const hr = gh ? gh.getBoundingClientRect() : { right: innerWidth / 2, bottom: 120, width: 200 };
      // ערכים ייחודיים בעמודה (לפי השורות שעברו את שאר הסינונים)
      const counts = new Map();
      for (const r of this.baseRows()) { const d = display(col, this.val(r, col)); counts.set(d, (counts.get(d) || 0) + 1); }
      const coll = new Intl.Collator('he', { numeric: true });
      const vals = [...counts.keys()].sort((a, b) => (a === '') - (b === '') || coll.compare(a, b));
      const cur = this.filters[col.id];
      const sel = new Set(cur ? vals.filter((v) => cur.has(v)) : vals);
      const LIMIT = 400;
      const sortDir = this.sort && this.sort.colId === col.id ? this.sort.dir : 0;
      const p = document.createElement('div');
      p.className = 'colp'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'סינון ' + col.name);
      p.innerHTML = `
        <header class="colp-h"><span class="colp-t">${UI.icon('filter', 15)}<b title="${esc(col.name)}">${esc(col.name)}</b></span>
          <button type="button" class="colp-more" data-more aria-expanded="false">${UI.icon('more', 15)}<span>פעולות</span></button></header>
        <div class="colp-sort"><button type="button" data-sort="1" class="${sortDir > 0 ? 'on' : ''}">${UI.icon('sortAsc', 14)}<span>מיון עולה</span></button><button type="button" data-sort="-1" class="${sortDir < 0 ? 'on' : ''}">${UI.icon('sortDesc', 14)}<span>מיון יורד</span></button></div>
        <label class="colp-q">${UI.icon('search', 15)}<input type="search" placeholder="חיפוש ערך…" data-q aria-label="חיפוש ערך"></label>
        <label class="chk all"><input type="checkbox" data-all><span>בחירת הכול</span><em data-cnt></em></label>
        <div class="colp-list" data-list></div>
        <footer class="colp-f"><button type="button" class="btn btn-ghost" data-clear>ניקוי</button><button type="button" class="btn btn-primary" data-apply>${UI.icon('filter', 15)}<span>סינון</span></button></footer>`;
      document.body.appendChild(p);
      const listEl = p.querySelector('[data-list]'), q = p.querySelector('[data-q]'), all = p.querySelector('[data-all]');
      const matching = () => { const t = q.value.trim().toLowerCase(); return t ? vals.filter((v) => v.toLowerCase().includes(t)) : vals; };
      const draw = () => {
        const mv = matching();
        listEl.innerHTML = mv.slice(0, LIMIT).map((v, i) => `<label class="chk"><input type="checkbox" data-i="${vals.indexOf(v)}" ${sel.has(v) ? 'checked' : ''}><span>${v === '' ? '<i class="muted">(ריק)</i>' : esc(v)}</span><em>${counts.get(v).toLocaleString('en-US')}</em></label>`).join('')
          + (mv.length > LIMIT ? `<p class="colp-note">מוצגים ${LIMIT} מתוך ${mv.length.toLocaleString('en-US')} ערכים — הקלד כדי לצמצם</p>` : '')
          + (!mv.length ? '<p class="colp-note">אין ערכים תואמים</p>' : '');
        const n = mv.filter((v) => sel.has(v)).length;
        all.checked = n === mv.length && n > 0; all.indeterminate = n > 0 && n < mv.length;
        p.querySelector('[data-cnt]').textContent = `${n.toLocaleString('en-US')}/${mv.length.toLocaleString('en-US')}`;
      };
      listEl.addEventListener('change', (e) => { const i = e.target.dataset.i; if (i == null) return; const v = vals[+i]; if (e.target.checked) sel.add(v); else sel.delete(v); draw(); });
      all.addEventListener('change', () => { for (const v of matching()) all.checked ? sel.add(v) : sel.delete(v); draw(); });
      let qt; q.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => {
        // כמו באקסל: חיפוש מסמן את מה שנמצא
        if (q.value.trim()) { sel.clear(); for (const v of matching()) sel.add(v); } else { sel.clear(); vals.forEach((v) => (!cur || cur.has(v)) && sel.add(v)); }
        draw(); }, 120); });
      const done = () => { this.o.onFilter && this.o.onFilter(); close(); this.focus(); };
      const apply = () => {
        const on = (q.value.trim() ? matching() : vals).filter((v) => sel.has(v));
        if (on.length === vals.length) delete this.filters[col.id]; else this.filters[col.id] = new Set(on);
        this.refresh(); done();
      };
      p.querySelector('[data-apply]').onclick = apply;
      p.querySelector('[data-clear]').onclick = () => { delete this.filters[col.id]; this.refresh(); done(); };
      p.querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => { const d = +b.dataset.sort; this.setSort(sortDir === d ? null : col.id, sortDir === d ? 0 : d); close(); }));
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
      draw();
      // מיקום: מתחת לכותרת, מיושר לצד שלה
      const W = p.offsetWidth, H = p.offsetHeight;
      let left = Math.min(innerWidth - W - 8, hr.right - W); left = Math.max(8, left);
      let top = hr.bottom + 6; if (top + H > innerHeight - 8) top = Math.max(8, innerHeight - H - 8);
      p.style.left = left + 'px'; p.style.top = top + 'px';
      requestAnimationFrame(() => p.classList.add('in'));
      // חלונית צדדית עם כל הפעולות
      let side = null;
      const moreBtn = p.querySelector('[data-more]');
      const openSide = () => {
        if (side) { side.classList.remove('in'); const s0 = side; side = null; setTimeout(() => s0.remove(), 180); moreBtn.setAttribute('aria-expanded', 'false'); moreBtn.classList.remove('on'); return; }
        side = document.createElement('div'); side.className = 'colp-side'; side.setAttribute('role', 'menu');
        for (const it of items) {
          if (!it) continue;
          if (it.sep) { side.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>'); continue; }
          if (it.title) { if (it.title === col.name || it.title.startsWith(col.name + ' ·')) continue; side.insertAdjacentHTML('beforeend', `<div class="menu-title">${esc(it.title)}</div>`); continue; }
          const b = document.createElement('button'); b.type = 'button'; b.className = 'menu-item' + (it.danger ? ' danger' : ''); b.disabled = !!it.disabled; b.setAttribute('role', 'menuitem');
          b.innerHTML = `${it.icon ? UI.icon(it.icon, 15) : '<span class="ic-sp"></span>'}<span class="mi-label">${esc(it.label)}</span>`;
          b.onclick = () => { close(); it.action && it.action(); };
          side.appendChild(b);
        }
        // מנקים מפרידים כפולים בהתחלה/בסוף
        while (side.firstElementChild && side.firstElementChild.classList.contains('menu-sep')) side.firstElementChild.remove();
        document.body.appendChild(side);
        const pr = p.getBoundingClientRect(), sw = side.offsetWidth, sh = side.offsetHeight;
        let sl = pr.left - sw - 8, dir = 'l'; if (sl < 8) { sl = pr.right + 8; dir = 'r'; }
        if (sl + sw > innerWidth - 8) { sl = Math.max(8, innerWidth - sw - 8); }
        let st = pr.top; if (st + sh > innerHeight - 8) st = Math.max(8, innerHeight - sh - 8);
        side.style.left = sl + 'px'; side.style.top = st + 'px'; side.dataset.dir = dir;
        requestAnimationFrame(() => side && side.classList.add('in'));
        moreBtn.setAttribute('aria-expanded', 'true'); moreBtn.classList.add('on');
      };
      moreBtn.onclick = openSide;
      const outside = (e) => { if (!p.contains(e.target) && !(side && side.contains(e.target)) && !e.target.closest('.modal-backdrop')) close(); };
      const esc_ = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); this.focus(); } };
      function close() {
        document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc_, true);
        p.classList.remove('in'); p.classList.add('out'); if (side) { side.classList.remove('in'); }
        const s0 = side; setTimeout(() => { p.remove(); s0 && s0.remove(); }, 170);
      }
      setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', esc_, true); }, 0);
      q.focus({ preventScroll: true });
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
    /** חיפוש בתוך עמודה אחת — תיבה צפה ליד הכותרת, מסנן תוך כדי הקלדה */
    columnSearch(col, x, y) {
      document.querySelectorAll('.col-search').forEach((e) => e.remove());
      const j = this.cols.indexOf(col);
      const gh = this.head.querySelector(`.gh[data-c="${j}"]`);
      const r = gh ? gh.getBoundingClientRect() : { right: x, bottom: y, width: 240 };
      const box = document.createElement('div');
      box.className = 'col-search';
      box.innerHTML = `${UI.icon('search', 15)}<input type="search" placeholder="חיפוש ב${esc(col.name)}…" aria-label="חיפוש בעמודה ${esc(col.name)}"><em></em><button type="button" class="icon-btn sm" aria-label="סגירה">${UI.icon('x', 14)}</button>`;
      document.body.appendChild(box);
      const w = Math.max(260, Math.min(360, r.width + 60));
      box.style.width = w + 'px';
      box.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
      box.style.top = (r.bottom + 6) + 'px';
      const inp = box.querySelector('input'); const cnt = box.querySelector('em');
      inp.value = this.colSearch[col.id] || '';
      const run = () => { if (inp.value.trim()) this.colSearch[col.id] = inp.value; else delete this.colSearch[col.id]; this.refresh(); cnt.textContent = inp.value.trim() ? `${this.view.length} שורות` : ''; this.o.onSearch && this.o.onSearch(); };
      let t; inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 150); });
      const close = () => { box.classList.add('out'); setTimeout(() => box.remove(), 160); document.removeEventListener('mousedown', outside, true); };
      const outside = (e) => { if (!box.contains(e.target)) close(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); this.focus(); } });
      box.querySelector('button').onclick = () => { inp.value = ''; run(); close(); };
      setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
      requestAnimationFrame(() => box.classList.add('in'));
      inp.focus(); inp.select();
      if (inp.value) run();
    }
    isFrz(col, j) { return j === 0 && !(this.o.noFreeze && this.o.noFreeze(col)); }
    clearFilters() { this.filters = {}; this.sort = null; this.search = ''; this.refresh(); }
    setSearch(q) { this.search = q.trim(); this.refresh(); }
    exportData() { return { cols: this.cols, rows: this.view }; }
  }

  Grid.util = { display, parseValue, parseDate, fmtDate, editText };
  global.Grid = Grid;
})(window);
