/* =========================================================
   domain.js — לוגיקה עסקית: תפקידי עמודות, סטטוסים, פרויקטים, BOM
   ========================================================= */
(function (global) {
  'use strict';
  const D = {};

  D.ROLES = [
    { key: 'project', label: 'פרויקט', re: /פרוי?קט|project|program|תוכנית/i },
    { key: 'status', label: 'סטטוס', re: /סטטוס|status|מצב/i },
    { key: 'orderDate', label: 'תאריך הזמנה', re: /תאריך\s*(ה)?הזמנה|order\s*date|po\s*date/i },
    { key: 'qtySupplied', label: 'כמות שסופקה', re: /(כמות.*(סופק|התקבל|נקלט|אספק))|((סופק|התקבל).*כמות)|received|delivered\s*qty|qty\s*rec/i },
    { key: 'qty', label: 'כמות', re: /כמות|qty|quantity/i },
    { key: 'part', label: 'מק"ט', re: /מק["'״]?ט|מקט|part|p\/n|\bpn\b|catalog|קטלוג/i },
    { key: 'order', label: 'מס׳ הזמנה', re: /הזמנ|\bpo\b|p\.o|order/i },
    { key: 'supplier', label: 'ספק', re: /ספק|supplier|vendor/i },
    { key: 'due', label: 'תאריך אספקה', re: /(תאריך|ת\.).*(אספק|נדרש|יעד|צפוי)|צפי|due|delivery|eta|need\s*date/i },
    { key: 'desc', label: 'תיאור', re: /תיאור|description|\bdesc\b|שם\s*פריט/i },
  ];
  D.BOM_ROLES = [
    { key: 'assembly', label: 'מכלול', re: /מכלול|assembly|\basm\b|assy/i },
    { key: 'part', label: 'מק"ט', re: /מק["'״]?ט|מקט|part|p\/n|\bpn\b|catalog/i },
    { key: 'desc', label: 'תיאור', re: /תיאור|description|desc/i },
    { key: 'qty', label: 'כמות נדרשת', re: /כמות|qty|quantity/i },
  ];

  D.CATS = {
    open: { label: 'פתוחה', icon: 'cloud' },
    supplied: { label: 'סופקה', icon: 'check' },
    delayed: { label: 'בעיכוב', icon: 'alert' },
    closed: { label: 'סגורה', icon: 'lock' },
    cancelled: { label: 'בוטלה', icon: 'x' },
  };
  D.CAT_ORDER = ['open', 'supplied', 'delayed', 'closed']; // הסדר שעבר בדיקת צבעים

  const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normPart = (s) => String(s ?? '').trim().toUpperCase().replace(/[\s\-_.]/g, '');
  D.norm = norm; D.normPart = normPart;

  D.mapping = () => Store.db.settings.mapping || {};
  D.roleOf = (colId) => { const m = D.mapping(); const r = D.ROLES.find((x) => m[x.key] === colId); return r ? r.label : ''; };
  D.setMapping = (patch) => {
    const s = Store.db.settings;
    s.mapping = Object.assign({}, s.mapping, patch);
    s.updatedAt = Store.now();
    Store.commit();
  };
  D.autoMap = (columns, roles = D.ROLES, existing = {}) => {
    const out = Object.assign({}, existing);
    const used = new Set(Object.values(out).filter(Boolean));
    for (const col of columns) {
      if (used.has(col.id)) continue;
      for (const r of roles) {
        if (out[r.key]) continue;
        if (r.re.test(col.name)) { out[r.key] = col.id; used.add(col.id); break; }
      }
    }
    return out;
  };

  D.autoCat = (v) => {
    const s = norm(v);
    if (!s) return 'open';
    if (/בוטל|מבוטל|cancel/.test(s)) return 'cancelled';
    if (/חלק|partial/.test(s)) return 'open';
    if (/סגור|closed|complete|הושלם/.test(s)) return 'closed';
    if (/סופק|התקבל|נקלט|הגיע|deliver|receiv|supplied/.test(s)) return 'supplied';
    if (/עיכוב|מעוכב|באיחור|איחור|delay|late|חריג|תקוע|בעי|hold|חסום|דחוף/.test(s)) return 'delayed';
    return 'open';
  };
  D.catOfValue = (v) => {
    const map = Store.db.settings.statusMap || {};
    const k = norm(v);
    return map[k] || D.autoCat(v);
  };
  D.today = () => new Date().toISOString().slice(0, 10);
  D.isOverdue = (row) => {
    const m = D.mapping();
    if (!m.due) return false;
    const due = row.c[m.due];
    if (!due || !/^\d{4}-\d{2}-\d{2}/.test(String(due))) return false;
    return String(due) < D.today() && D.catOfValue(m.status ? row.c[m.status] : '') === 'open';
  };
  /** קטגוריה אפקטיבית: הזמנה פתוחה שתאריך האספקה שלה עבר נחשבת בעיכוב */
  D.cat = (row) => {
    const m = D.mapping();
    const c = D.catOfValue(m.status ? row.c[m.status] : '');
    if (c === 'open' && D.isOverdue(row)) return 'delayed';
    return c;
  };

  /* ---------- פרויקטים ---------- */
  D.inProject = (row, p) => {
    const m = D.mapping();
    return !!m.project && norm(row.c[m.project]) === norm(p.name);
  };
  D.projectRows = (p) => Store.rows('orders').filter((r) => D.inProject(r, p));
  D.PROJECT_COLORS = ['#2F5BD3', '#1E8E5A', '#D2551C', '#7E57B0', '#0E7C86', '#B4417A', '#8A6D1F', '#4A5A6E'];
  D.addProject = (name) => {
    name = name.trim();
    if (!name) throw new Error('צריך לתת שם לפרויקט.');
    if (Store.projects().some((p) => norm(p.name) === norm(name))) throw new Error('כבר קיים פרויקט בשם הזה.');
    const list = Store.projects();
    const p = { id: Store.uid(), name, order: list.length, color: D.PROJECT_COLORS[list.length % D.PROJECT_COLORS.length], createdAt: Store.now(), updatedAt: Store.now() };
    Store.db.projects.push(p);
    Store.commit();
    return p;
  };
  D.projectColor = (name) => { const p = Store.projects().find((x) => norm(x.name) === norm(name)); return p ? p.color : null; };

  /* ---------- סטטיסטיקה ---------- */
  D.stats = (rows, newDays = 7) => {
    const m = D.mapping();
    const s = { total: rows.length, open: 0, supplied: 0, closed: 0, delayed: 0, cancelled: 0, notDone: 0, newer: 0 };
    const since = Store.now() - newDays * 864e5;
    const sinceIso = new Date(since).toISOString().slice(0, 10);
    for (const r of rows) {
      const c = D.cat(r);
      s[c]++;
      if (c === 'open' || c === 'delayed') s.notDone++;
      if (m.orderDate && r.c[m.orderDate]) { if (String(r.c[m.orderDate]) >= sinceIso) s.newer++; }
      else if (!r.imp && (r.createdAt || 0) >= since) s.newer++;
    }
    return s;
  };

  /* ---------- BOM ---------- */
  D.bomMapping = () => Store.db.settings.bomMapping || {};
  D.bomLines = (p) => Store.rows('bom').filter((r) => r.p === p.id);
  /**
   * לכל שורת BOM: כמה סופק מתוך הנדרש, לפי ההזמנות בפרויקט עם אותו מק"ט.
   * כמות שסופקה מחולקת בין שורות BOM שחולקות מק"ט (לפי הסדר), כדי לא לספור פעמיים.
   */
  D.bomProgress = (p) => {
    const m = D.mapping(); const bm = D.bomMapping();
    const lines = D.bomLines(p).sort((a, b) => (a.o || 0) - (b.o || 0));
    const orders = m.part ? D.projectRows(p) : [];
    const byPart = new Map();
    for (const o of orders) {
      const k = normPart(o.c[m.part]); if (!k) continue;
      if (!byPart.has(k)) byPart.set(k, []);
      byPart.get(k).push(o);
    }
    const pool = new Map();
    for (const [k, list] of byPart) {
      let sup = 0;
      for (const o of list) {
        const c = D.cat(o);
        if (c === 'cancelled') continue;
        const q = m.qty ? +o.c[m.qty] || 0 : 0;
        if (m.qtySupplied && o.c[m.qtySupplied] !== '' && o.c[m.qtySupplied] != null) sup += +o.c[m.qtySupplied] || 0;
        else if (c === 'supplied' || c === 'closed') sup += q || Infinity;
      }
      pool.set(k, sup);
    }
    const result = new Map();
    const asms = new Map();
    for (const line of lines) {
      const asm = String(line.c[bm.assembly] ?? '').trim() || 'ללא מכלול';
      const k = normPart(line.c[bm.part]);
      const req = Math.max(0, +line.c[bm.qty] || 1);
      const ords = (byPart.get(k) || []).filter((o) => D.cat(o) !== 'cancelled');
      let got = 0;
      if (k && pool.has(k)) { const avail = pool.get(k); got = Math.min(req, avail); pool.set(k, avail - got); }
      const frac = req ? Math.min(1, got / req) : 1;
      let state;
      if (!k) state = 'missing';
      else if (frac >= 1) state = 'done';
      else if (ords.some((o) => D.cat(o) === 'delayed')) state = 'late';
      else if (ords.length) state = 'ordered';
      else state = 'missing';
      const info = { line, asm, part: line.c[bm.part], req, got, frac, state, orders: ords };
      result.set(line.id, info);
      if (!asms.has(asm)) asms.set(asm, { name: asm, items: [] });
      asms.get(asm).items.push(info);
    }
    const list = [...asms.values()].map((a) => {
      const pct = a.items.reduce((s, i) => s + i.frac, 0) / a.items.length;
      const cnt = { done: 0, ordered: 0, late: 0, missing: 0 };
      a.items.forEach((i) => cnt[i.state]++);
      return Object.assign(a, { pct, cnt });
    });
    const overall = lines.length ? [...result.values()].reduce((s, i) => s + i.frac, 0) / lines.length : 0;
    return { lines: result, assemblies: list, overall, count: lines.length };
  };
  D.LINE_STATE = {
    done: { label: 'סופק', cls: 'supplied' },
    ordered: { label: 'הוזמן', cls: 'open' },
    late: { label: 'בעיכוב', cls: 'delayed' },
    missing: { label: 'לא הוזמן', cls: 'missing' },
  };

  global.Domain = D;
})(window);
