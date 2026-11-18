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
    { key: 'update', label: 'עדכון', re: /עדכו|update|status\s*note|הערות\s*סטטוס/i },
    { key: 'desc', label: 'תיאור', re: /תיאור|description|\bdesc\b|שם\s*פריט/i },
  ];
  /** תפקיד שלא זוהה מהכותרות יכול להיות מוגדר ידנית ב"עמודות" */
  D.ensureMapping = () => {
    const s = Store.db.settings;
    const cols = Store.columns('orders');
    if (!cols.length) return;
    const m = D.autoMap(cols, D.ROLES, s.mapping || {});
    if (JSON.stringify(m) !== JSON.stringify(s.mapping)) { s.mapping = m; s.updatedAt = Store.now(); Store.commit(); }
  };

  /* ---------- סיסמת לשוניות ---------- */
  D.TAB_PASSWORD = 'KADAM';
  D.TEAM_CODE = 'KADAM'; // קוד צוות קבוע להרשמת עורכים ממכשיר חדש

  /* ---------- תפקידים והרשאות ---------- */
  D.USER_ROLES = [
    { key: 'manager', label: 'מנהל רכש', desc: 'עורך הכול, מייבא קבצים, מנהל עמודות, הרשאות ומשתמשים' },
    { key: 'expediter', label: 'קדם', desc: 'עורך את כל העמודות — בעיקר סטטוס, עדכון ותאריכי אספקה' },
    { key: 'ops', label: 'מנהל תפעול', desc: 'עורך כמות נדרשת, כמות שהתקבלה ועדכון' },
    { key: 'buyer', label: 'קניין', desc: 'מוסיף הזמנות חדשות ועורך כמות נדרשת, כמות שהתקבלה ועדכון' },
  ];
  D.roleLabel = (k) => (D.USER_ROLES.find((r) => r.key === k) || {}).label || 'ללא תפקיד';
  D.CAPS = [
    ['add', 'הוספת הזמנות חדשות'],
    ['del', 'מחיקת שורות'],
    ['import', 'ייבוא קבצים'],
    ['bom', 'עריכת BOM'],
    ['admin', 'ניהול עמודות, סטטוסים ופרויקטים'],
  ];
  const FIELD_COLS = ['@qty', '@qtySupplied', '@update'];
  D.DEFAULT_PERMS = {
    manager: { cols: 'all', add: true, del: true, import: true, bom: true, admin: true },
    expediter: { cols: 'all', add: true, del: false, import: false, bom: false, admin: false },
    ops: { cols: FIELD_COLS, add: false, del: false, import: false, bom: false, admin: false },
    buyer: { cols: FIELD_COLS, add: true, own: true, del: false, import: false, bom: false, admin: false },
  };
  D.perms = (role) => {
    if (role === 'manager') return D.DEFAULT_PERMS.manager; // למנהל רכש תמיד הכול
    const base = D.DEFAULT_PERMS[role] || D.DEFAULT_PERMS.ops;
    return Object.assign({}, base, ((Store.db.settings.perms || {})[role]) || {});
  };
  /** רשימת העמודות שתפקיד יכול לערוך (null = כולן) */
  D.editableCols = (role) => {
    const p = D.perms(role);
    if (p.cols === 'all') return null;
    const m = D.mapping();
    return new Set((p.cols || []).map((c) => (c[0] === '@' ? m[c.slice(1)] : c)).filter(Boolean));
  };
  D.me = () => Store.currentUser();
  D.can = (cap) => { const u = D.me(); return !!(u && u.role && D.perms(u.role)[cap]); };
  let editCache = { at: 0 };
  D.canEditCell = (col, row) => {
    const u = D.me(); if (!u || !u.role) return false;
    if (u.role === 'manager') return true;
    if (editCache.at !== Store.db.settings.updatedAt || editCache.role !== u.role) editCache = { at: Store.db.settings.updatedAt, role: u.role, set: D.editableCols(u.role), own: D.perms(u.role).own };
    if (!editCache.set) return true;
    if (editCache.own && row && row.createdBy === u.id) return true; // קניין עורך את ההזמנות שהוא הוסיף
    return editCache.set.has(col.id);
  };
  D.hasManager = () => Store.db.users.some((u) => !u.deleted && u.role === 'manager');
  D.BOM_ROLES = [
    { key: 'project', label: 'פרויקט', re: /פרוי?קט|project|program|תוכנית/i },
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
  /**
   * סנכרון לשוניות מול עמודת הפרויקט:
   * ערך חדש בעמודה → לשונית חדשה; שם שהוחלף בכל השורות → הלשונית משנה שם (ושומרת BOM וצבע);
   * פרויקט שכבר אין לו שורות → הלשונית יורדת (וחוזרת אוטומטית אם השם יופיע שוב).
   */
  let membership = new Map(); // rowId -> projectId (בזיכרון בלבד)
  D.syncProjects = () => {
    const m = D.mapping();
    if (!m.project) return { changed: false, created: [] };
    const rows = Store.rows('orders');
    const names = new Map(); // norm -> כתיב תצוגה
    for (const r of rows) { const v = String(r.c[m.project] ?? '').trim(); if (v && !names.has(norm(v))) names.set(norm(v), v); }
    const bpc = D.bomMapping().project;
    const all = Store.db.projects;
    let changed = false; const created = [];
    // כפילויות שנוצרו במקביל בשני מכשירים: משאירים את הוותיקה
    const seen = new Map();
    for (const p of all.filter((x) => !x.deleted).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : 1))) {
      const k = norm(p.name);
      if (seen.has(k)) {
        const keep = seen.get(k);
        for (const b of Store.rows('bom')) if (b.p === p.id) { b.p = keep.id; Store.touch(b); }
        p.deleted = true; Store.touch(p); changed = true;
      } else seen.set(k, p);
    }
    const active = all.filter((x) => !x.deleted);
    const byNorm = new Map(active.map((x) => [norm(x.name), x]));
    let missing = active.filter((x) => !names.has(norm(x.name)) && (x.hadRows || x.auto));
    for (const [k, display] of names) {
      if (byNorm.has(k)) { const p = byNorm.get(k); if (!p.hadRows) { p.hadRows = true; Store.touch(p); changed = true; } continue; }
      // שינוי שם: רוב השורות עם השם החדש היו שייכות לפרויקט שנעלם
      const votes = new Map();
      for (const r of rows) {
        if (norm(r.c[m.project]) !== k) continue;
        const pid = membership.get(r.id);
        if (pid && missing.some((x) => x.id === pid)) votes.set(pid, (votes.get(pid) || 0) + 1);
      }
      let target = null;
      if (votes.size) { const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0]; target = missing.find((x) => x.id === best); }
      if (!target) { target = all.find((x) => x.deleted && norm(x.name) === k) || null; if (target) target.deleted = false; }
      if (target) {
        // הפרויקט שינה שם בטבלת ההזמנות — גם שורות ה-BOM שלו עוברות לשם החדש
        if (norm(target.name) !== k) for (const b of Store.rows('bom')) if (norm(b.c[bpc]) === norm(target.name)) { b.c[bpc] = display; Store.touch(b); }
        target.name = display; target.hadRows = true; Store.touch(target);
        missing = missing.filter((x) => x !== target); byNorm.set(k, target); changed = true;
      } else {
        const list = Store.projects();
        const np = { id: Store.uid(), name: display, order: list.length, color: D.PROJECT_COLORS[list.length % D.PROJECT_COLORS.length], createdAt: Store.now(), updatedAt: Store.now(), auto: true, hadRows: true };
        all.push(np); byNorm.set(k, np); created.push(np); changed = true;
      }
    }
    // פרויקטים שמופיעים רק ב-BOM מקבלים גם הם לשונית
    const bomNames = new Map();
    for (const r of Store.rows('bom')) { const v = String(r.c[bpc] ?? '').trim(); if (v && !bomNames.has(norm(v))) bomNames.set(norm(v), v); }
    for (const [k, display] of bomNames) {
      if (byNorm.has(k)) { missing = missing.filter((x) => norm(x.name) !== k); continue; }
      let t = all.find((x) => x.deleted && norm(x.name) === k);
      if (t) { t.deleted = false; Store.touch(t); }
      else {
        const list = Store.projects();
        t = { id: Store.uid(), name: display, order: list.length, color: D.PROJECT_COLORS[list.length % D.PROJECT_COLORS.length], createdAt: Store.now(), updatedAt: Store.now(), auto: true, hadRows: true };
        all.push(t); created.push(t);
      }
      byNorm.set(k, t); changed = true;
    }
    for (const p of missing) { p.deleted = true; Store.touch(p); changed = true; }
    membership = new Map();
    for (const r of rows) { const p = byNorm.get(norm(r.c[m.project])); if (p) membership.set(r.id, p.id); }
    if (changed) Store.commit();
    return { changed, created };
  };
  /** שינוי שם של לשונית מעדכן גם את השורות שלה */
  D.renameProject = (p, name) => {
    const m = D.mapping();
    const rows = D.projectRows(p);
    if (m.project) for (const r of rows) { r.c[m.project] = name; Store.touch(r); membership.set(r.id, p.id); }
    const bpc = D.bomMapping().project;
    for (const b of D.bomLines(p)) { b.c[bpc] = name; Store.touch(b); }
    p.name = name; Store.touch(p);
    Store.commit();
    return rows.length;
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
  D.bomMapping = () => Object.assign({ project: 'b_proj', assembly: 'b_asm', part: 'b_pn', desc: 'b_desc', qty: 'b_qty' }, Store.db.settings.bomMapping || {});
  D.bomProjOf = (r) => norm(r.c[D.bomMapping().project]);
  D.bomLines = (p) => { const k = norm(p.name); return Store.rows('bom').filter((r) => { const v = D.bomProjOf(r); return v ? v === k : r.p === p.id; }); };
  /** שדרוג נתונים: עמודת פרויקט ב-BOM (בגרסה הקודמת ה-BOM נשמר לפי מזהה לשונית) */
  D.ensureBomSchema = () => {
    const ds = Store.db.datasets.bom; let changed = false;
    if (!ds.columns.some((c) => c.id === 'b_proj')) {
      ds.columns.push({ id: 'b_proj', name: 'פרויקט', width: 130, type: 'text', order: -1, updatedAt: Store.now() });
      changed = true;
    }
    const bm = Store.db.settings.bomMapping || {};
    if (!bm.project) { Store.db.settings.bomMapping = Object.assign({}, D.bomMapping(), bm, { project: 'b_proj' }); Store.db.settings.updatedAt = Store.now(); changed = true; }
    const pcol = D.bomMapping().project;
    for (const r of ds.rows) {
      if (r.deleted || r.c[pcol] || !r.p) continue;
      const p = Store.db.projects.find((x) => x.id === r.p);
      if (p) { r.c[pcol] = p.name; Store.touch(r); changed = true; }
    }
    if (changed) Store.commit();
  };
  /**
   * לכל שורת BOM: כמה סופק מתוך הנדרש, לפי ההזמנות בפרויקט עם אותו מק"ט.
   * כמות שסופקה מחולקת בין שורות BOM שחולקות מק"ט (לפי הסדר), כדי לא לספור פעמיים.
   */
  D.bomProgress = (p) => D.bomProgressFor(D.bomLines(p), D.projectRows(p));
  /** התקדמות לכל שורות ה-BOM, כל שורה מול ההזמנות של הפרויקט שלה */
  D.bomProgressAll = () => {
    const m = D.mapping();
    const byProj = new Map();
    for (const r of Store.rows('bom')) { const k = D.bomProjOf(r); if (!byProj.has(k)) byProj.set(k, []); byProj.get(k).push(r); }
    const allOrders = Store.rows('orders');
    const ordersBy = new Map();
    for (const o of allOrders) { const k = m.project ? norm(o.c[m.project]) : ''; if (!ordersBy.has(k)) ordersBy.set(k, []); ordersBy.get(k).push(o); }
    const groups = [];
    const lines = new Map();
    for (const [k, rows] of byProj) {
      const res = D.bomProgressFor(rows, k ? (ordersBy.get(k) || []) : allOrders);
      const name = k ? String(rows[0].c[D.bomMapping().project]).trim() : 'ללא פרויקט';
      groups.push(Object.assign(res, { key: k, name, project: Store.projects().find((p) => norm(p.name) === k) || null }));
      for (const [id, info] of res.lines) lines.set(id, info);
    }
    const count = lines.size;
    const overall = count ? [...lines.values()].reduce((s, i) => s + i.frac, 0) / count : 0;
    const cnt = { done: 0, ordered: 0, late: 0, missing: 0 };
    for (const i of lines.values()) cnt[i.state]++;
    return { groups, lines, count, overall, cnt };
  };
  D.bomProgressFor = (linesIn, ordersIn) => {
    const m = D.mapping(); const bm = D.bomMapping();
    const lines = [...linesIn].sort((a, b) => (a.o || 0) - (b.o || 0));
    const orders = m.part ? ordersIn : [];
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
