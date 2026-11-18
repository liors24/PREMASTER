/* =========================================================
   store.js — מודל נתונים, מיזוג וסנכרון לגיטהאב
   כל רשומה (שורה/עמודה/פרויקט/משתמש) נושאת updatedAt,
   והמיזוג בין מכשירים נעשה ברמת הרשומה (האחרון מנצח),
   כך ששני עורכים שעובדים במקביל לא דורסים זה את זה.
   ========================================================= */
(function (global) {
  'use strict';

  const LS_DB = 'pt.db.v1';
  const LS_CFG = 'pt.cfg.v1';
  const LS_SESSION = 'pt.session.v1';
  let _sess;
  addEventListener('storage', (e) => { if (e.key === LS_SESSION) _sess = undefined; });
  const TOMBSTONE_TTL = 1000 * 60 * 60 * 24 * 60; // 60 ימים

  const now = () => Date.now();
  const uid = () =>
    (global.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : (Math.random().toString(36) + Math.random().toString(36)).replace(/[^a-z0-9]/g, '')).slice(0, 14);

  /* ---------- SHA-256 טהור (עובד גם ללא https) ---------- */
  function sha256(ascii) {
    function rightRotate(v, a) { return (v >>> a) | (v << (32 - a)); }
    const bytes = new TextEncoder().encode(ascii);
    const words = [];
    const bitLen = bytes.length * 8;
    const K = sha256.k || (sha256.k = (() => {
      const k = []; let n = 2; const isPrime = (x) => { for (let i = 2; i * i <= x; i++) if (x % i === 0) return false; return true; };
      while (k.length < 64) { if (isPrime(n)) k.push((Math.pow(n, 1 / 3) * 0x100000000) | 0); n++; }
      return k;
    })());
    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    padded.set(bytes); padded[bytes.length] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 4, bitLen >>> 0); dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
    for (let i = 0; i < padded.length; i += 4) words.push(dv.getUint32(i));
    for (let j = 0; j < words.length; j += 16) {
      const w = words.slice(j, j + 16); const oldH = H.slice(0);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = H[0], e = H[4];
        const temp1 = H[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ((e & H[5]) ^ (~e & H[6])) + K[i] +
          (w[i] = i < 16 ? w[i] : (w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
        const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & H[1]) ^ (a & H[2]) ^ (H[1] & H[2]));
        H = [(temp1 + temp2) | 0].concat(H); H[4] = (H[4] + temp1) | 0; H.length = 8;
      }
      for (let i = 0; i < 8; i++) H[i] = (H[i] + oldH[i]) | 0;
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  function hashPassword(pw, salt) {
    let h = salt + '|' + pw;
    for (let i = 0; i < 3000; i++) h = sha256(h + salt);
    return h;
  }

  /* ---------- מבנה ברירת מחדל ---------- */
  function defaultBomColumns() {
    const t = now();
    return [
      { id: 'b_proj', name: 'פרויקט', width: 130, type: 'text', order: -1, updatedAt: t },
      { id: 'b_asm', name: 'מכלול', width: 170, type: 'text', order: 0, updatedAt: t },
      { id: 'b_pn', name: 'מק"ט', width: 150, type: 'text', order: 1, updatedAt: t },
      { id: 'b_desc', name: 'תיאור', width: 240, type: 'text', order: 2, updatedAt: t },
      { id: 'b_qty', name: 'כמות נדרשת', width: 110, type: 'number', order: 3, updatedAt: t },
    ];
  }
  function emptyDb() {
    return {
      schema: 1,
      users: [],
      projects: [],
      datasets: {
        orders: { columns: [], rows: [] },
        bom: { columns: defaultBomColumns(), rows: [] },
      },
      settings: { mapping: {}, statusMap: {}, bomMapping: { project: 'b_proj', assembly: 'b_asm', part: 'b_pn', desc: 'b_desc', qty: 'b_qty' }, updatedAt: 0 },
    };
  }

  /* ---------- מיזוג ---------- */
  function mergeList(a = [], b = []) {
    const map = new Map();
    for (const r of a) map.set(r.id, r);
    for (const r of b) {
      const cur = map.get(r.id);
      if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) map.set(r.id, r);
    }
    const cutoff = now() - TOMBSTONE_TTL;
    return [...map.values()].filter((r) => !(r.deleted && (r.updatedAt || 0) < cutoff));
  }
  function mergeDb(local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    const out = emptyDb();
    out.users = mergeList(local.users, remote.users);
    out.projects = mergeList(local.projects, remote.projects);
    for (const k of new Set([...Object.keys(local.datasets || {}), ...Object.keys(remote.datasets || {})])) {
      const L = (local.datasets || {})[k] || { columns: [], rows: [] };
      const R = (remote.datasets || {})[k] || { columns: [], rows: [] };
      out.datasets[k] = { columns: mergeList(L.columns, R.columns), rows: mergeList(L.rows, R.rows) };
    }
    out.gen = remote.gen || local.gen; out.purgedAt = Math.max(remote.purgedAt || 0, local.purgedAt || 0);
    out.settings = (remote.settings && (remote.settings.updatedAt || 0) > ((local.settings && local.settings.updatedAt) || 0)) ? remote.settings : local.settings;
    return out;
  }
  function normalizeDb(db) {
    const base = emptyDb();
    db = Object.assign(base, db || {});
    db.datasets = Object.assign(base.datasets, db.datasets || {});
    for (const k of Object.keys(db.datasets)) {
      db.datasets[k].columns = db.datasets[k].columns || [];
      db.datasets[k].rows = db.datasets[k].rows || [];
    }
    db.settings = Object.assign(emptyDb().settings, db.settings || {});
    return scrubDb(db);
  }
  /** רשומה שנמחקה נשמרת רק כ"מצבה" (מזהה + זמן מחיקה) — בלי שום תוכן, כדי שנתונים שנמחקו לא יישמרו בשום מקום */
  function scrub(list) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r && r.deleted && Object.keys(r).length > 4) list[i] = { id: r.id, deleted: true, updatedAt: r.updatedAt || 0, by: r.by || '' };
    }
    return list;
  }
  function scrubDb(db) {
    scrub(db.users || []); scrub(db.projects || []);
    for (const k of Object.keys(db.datasets || {})) { scrub(db.datasets[k].columns); scrub(db.datasets[k].rows); }
    return db;
  }

  /* ---------- אחסון מקומי: IndexedDB (ללא מגבלת 5MB של localStorage) ---------- */
  const IDB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((ok, fail) => {
        if (!global.indexedDB) return fail(new Error('no idb'));
        const r = indexedDB.open('procurement-tracker', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { this.db = r.result; ok(this.db); };
        r.onerror = () => fail(r.error);
      });
    },
    async get(k) { const db = await this.open(); return new Promise((ok, fail) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => fail(q.error); }); },
    async set(k, v) { const db = await this.open(); return new Promise((ok, fail) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => ok(); t.onerror = () => fail(t.error); }); },
  };
  const channel = global.BroadcastChannel ? new BroadcastChannel('procurement-tracker') : null;

  /* ---------- דחיסה (gzip) — קובץ של 10,000 שורות קטן פי ~10 ---------- */
  const canGzip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
  async function gzip(str) {
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  async function decodeFile(b64) {
    const bytes = b64ToBytes(b64);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return gunzip(bytes);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- base64 UTF-8 ---------- */
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- מנוע הסנכרון ---------- */
  const listeners = new Set();
  const state = {
    db: null,
    cfg: null,
    sha: null,
    etag: null,
    version: 0,       // מונה שינויים מקומיים
    pushedVersion: 0, // הגרסה האחרונה שנשמרה בהצלחה
    status: 'idle',   // idle | saving | synced | offline | error | local
    message: '',
    lastSync: 0,
    timer: null,
    poller: null,
    busy: false,
  };

  function emit(type, detail) { for (const fn of listeners) { try { fn(type, detail); } catch (e) { console.error(e); } } }
  function setStatus(status, message = '') { state.status = status; state.message = message; emit('status', { status, message }); }

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(LS_CFG)) || null; } catch { return null; }
  }
  function saveCfg(cfg) { state.cfg = cfg; localStorage.setItem(LS_CFG, JSON.stringify(cfg)); }
  let cacheTimer = 0;
  function cacheLocal(now) {
    clearTimeout(cacheTimer);
    const run = async () => {
      try { scrubDb(state.db); await IDB.set('db', state.db); localStorage.removeItem(LS_DB); channel && channel.postMessage('db'); }
      catch (e) {
        console.warn('IDB failed, falling back to localStorage', e);
        try { localStorage.setItem(LS_DB, JSON.stringify(state.db)); } catch (e2) { emit('status', { status: 'error', message: 'אין מקום לשמירה במכשיר. פנה למנהל המערכת.' }); }
      }
    };
    if (now) return run();
    cacheTimer = setTimeout(run, 400);
  }
  async function loadLocal() {
    try { const d = await IDB.get('db'); if (d) return normalizeDb(d); } catch (e) { console.warn(e); }
    try { return normalizeDb(JSON.parse(localStorage.getItem(LS_DB))); } catch { return emptyDb(); } // מעבר מגרסה קודמת
  }
  global.addEventListener && global.addEventListener('pagehide', () => { if (cacheTimer) cacheLocal(true); });

  function ghHeaders(extra = {}) {
    return Object.assign({
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + state.cfg.token,
      'X-GitHub-Api-Version': '2022-11-28',
    }, extra);
  }
  function contentsUrl() {
    const c = state.cfg;
    return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}`;
  }

  async function ghGet() {
    const c = state.cfg;
    const res = await fetch(contentsUrl() + '?ref=' + encodeURIComponent(c.branch) + '&_=' + now(), {
      headers: ghHeaders(state.etag ? { 'If-None-Match': state.etag } : {}), cache: 'no-store',
    });
    if (res.status === 304) return { unchanged: true };
    if (res.status === 404) return { missing: true };
    if (!res.ok) throw await ghError(res);
    const etag = res.headers.get('ETag');
    const meta = await res.json();
    if (meta.sha && meta.sha === state.sha) { state.etag = etag; return { unchanged: true }; } // זו הגרסה ששמרנו בעצמנו
    let text;
    if (meta.content && meta.encoding === 'base64') text = await decodeFile(meta.content);
    else {
      // קובץ גדול מ-1MB: נקרא דרך blob API
      const r2 = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/git/blobs/${meta.sha}`, { headers: ghHeaders(), cache: 'no-store' });
      if (!r2.ok) throw await ghError(r2);
      const blob = await r2.json();
      text = await decodeFile(blob.content);
    }
    return { sha: meta.sha, etag, data: text ? JSON.parse(text) : null };
  }
  async function ghPut(json, sha) {
    const c = state.cfg;
    const zipped = canGzip && /\.gz$/i.test(c.path);
    const content = zipped ? bytesToB64(await gzip(json)) : b64encode(json);
    const body = { message: `עדכון נתונים · ${new Date().toISOString()}`, content, branch: c.branch };
    if (sha) body.sha = sha;
    const res = await fetch(contentsUrl(), { method: 'PUT', headers: ghHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    if (res.status === 409 || res.status === 422) return { conflict: true };
    if (!res.ok) throw await ghError(res);
    const out = await res.json();
    return { sha: out.content.sha };
  }
  async function ghError(res) {
    let msg = '';
    try { msg = (await res.json()).message; } catch { }
    const map = {
      401: 'הרשאת הסנכרון אינה תקינה או שפג תוקפה. פנה למנהל המערכת.',
      403: 'אין הרשאה לשמור נתונים. פנה למנהל המערכת.',
      404: 'מאגר הנתונים לא נמצא. פנה למנהל המערכת.',
    };
    const e = new Error(map[res.status] || `שגיאת סנכרון ${res.status}: ${msg}`);
    e.status = res.status;
    return e;
  }

  async function pull() {
    if (!state.cfg || state.cfg.mode !== 'github') return false;
    const r = await ghGet();
    if (r.unchanged) return false;
    if (r.missing) { state.sha = null; return false; }
    state.etag = r.etag; state.sha = r.sha;
    const remote = normalizeDb(r.data);
    const before = JSON.stringify(state.db);
    // הנתונים במאגר "אופסו" (ניקוי היסטוריה) — לוקחים את המרוחק, ושומרים רק שינויים מקומיים שנעשו אחרי הניקוי
    let local = state.db;
    if (remote.gen && remote.gen !== local.gen) local = sinceOnly(local, remote.purgedAt || 0);
    const merged = normalizeDb(mergeDb(local, remote));
    const mergedStr = JSON.stringify(merged);
    const changed = mergedStr !== before;
    state.db = merged;
    // אם יש אצלנו משהו שלא קיים במרוחק — צריך לדחוף
    if (mergedStr !== JSON.stringify(remote)) state.version++;
    if (changed) { cacheLocal(); emit('remote'); }
    return changed;
  }

  function sinceOnly(db, t) {
    const keep = (l) => (l || []).filter((r) => (r.updatedAt || 0) > t);
    const out = emptyDb();
    out.users = keep(db.users); out.projects = keep(db.projects);
    for (const k of Object.keys(db.datasets || {})) out.datasets[k] = { columns: keep(db.datasets[k].columns), rows: keep(db.datasets[k].rows) };
    out.settings = db.settings; out.gen = null;
    return out;
  }
  /** יש רשומות מחוקות? אחרי שמירה מנקים: מסירים אותן לגמרי ומוחקים את כל ההיסטוריה במאגר */
  const hasTombstones = (db) => [db.users, db.projects, ...Object.values(db.datasets || {}).flatMap((d) => [d.columns, d.rows])].some((l) => (l || []).some((r) => r.deleted));
  async function ghApi(path, method, body) {
    const c = state.cfg;
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}${path}`, { method, headers: ghHeaders({ 'Content-Type': 'application/json' }), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    if (!res.ok) throw new Error('GitHub ' + res.status);
    return res.json();
  }
  let purging = false;
  async function purgeHistory() {
    if (!state.cfg || state.cfg.mode !== 'github' || purging) return false;
    purging = true;
    try {
      await pull();
      const t = now();
      const db = state.db;
      const live = (l) => (l || []).filter((r) => !r.deleted);
      db.users = live(db.users); db.projects = live(db.projects);
      for (const k of Object.keys(db.datasets)) { db.datasets[k].columns = live(db.datasets[k].columns); db.datasets[k].rows = live(db.datasets[k].rows); }
      db.gen = uid(); db.purgedAt = t;
      const c = state.cfg;
      const json = JSON.stringify(db);
      const zipped = canGzip && /\.gz$/i.test(c.path);
      const content = zipped ? bytesToB64(await gzip(json)) : b64encode(json);
      // קומיט יחיד בלי היסטוריה: blob → tree → commit בלי הורים → הצבעת הענף בכוח
      const blob = await ghApi('/git/blobs', 'POST', { content, encoding: 'base64' });
      const tree = await ghApi('/git/trees', 'POST', { tree: [{ path: c.path, mode: '100644', type: 'blob', sha: blob.sha }] });
      const commit = await ghApi('/git/commits', 'POST', { message: 'נתונים', tree: tree.sha, parents: [] });
      await ghApi(`/git/refs/heads/${encodeURIComponent(c.branch || 'main')}`, 'PATCH', { sha: commit.sha, force: true });
      state.sha = blob.sha; state.etag = null; state.pushedVersion = state.version; state.lastSync = now();
      await cacheLocal(true); emit('remote');
      return true;
    } finally { purging = false; }
  }
  let purgeTimer = 0;
  function schedulePurge() { clearTimeout(purgeTimer); purgeTimer = setTimeout(() => { purgeHistory().catch((e) => console.warn('purge', e)); }, 15000); }

  async function push() {
    if (!state.cfg || state.cfg.mode !== 'github') return;
    for (let attempt = 0; attempt < 4; attempt++) {
      const v = state.version;
      scrubDb(state.db);
      const json = JSON.stringify(state.db);
      const r = await ghPut(json, state.sha);
      if (r.conflict) { state.etag = null; await pull(); await new Promise((ok) => setTimeout(ok, 400 * (attempt + 1))); continue; }
      state.sha = r.sha; state.etag = null; state.pushedVersion = v; state.lastSync = now();
      if (hasTombstones(state.db)) schedulePurge();
      return;
    }
    throw new Error('לא הצלחתי לשמור בגלל עדכונים מקבילים. מנסה שוב בעוד רגע.');
  }

  async function syncNow() {
    if (!state.cfg) return;
    if (state.cfg.mode === 'local') { await cacheLocal(true); setStatus('local', 'נשמר'); return; }
    if (state.busy) { schedule(800); return; }
    state.busy = true;
    try {
      if (state.version !== state.pushedVersion) setStatus('saving', 'שומר…');
      await pull();
      if (state.version !== state.pushedVersion) { setStatus('saving', 'שומר…'); await push(); }
      state.lastSync = now();
      setStatus('synced', 'מסונכרן');
    } catch (e) {
      console.error(e);
      if (!navigator.onLine || e instanceof TypeError) setStatus('offline', 'אין חיבור לאינטרנט — השינויים יישלחו כשהחיבור יחזור');
      else setStatus('error', e.message);
      schedule(8000);
    } finally { state.busy = false; }
  }
  function schedule(ms = 1200) {
    clearTimeout(state.timer);
    state.timer = setTimeout(syncNow, ms);
  }

  /* ---------- כניסה מכל מכשיר ----------
   * קובץ access.json במאגר האתר (ציבורי) מחזיק את פרטי מאגר הנתונים ואת טוקן הגישה
   * מוצפן בנפרד לכל משתמש בסיסמה שלו (PBKDF2 + AES-GCM), ועוד עותק מוצפן ב"קוד צוות"
   * להרשמת עורכים חדשים. כך במכשיר חדש מספיק שם + סיסמה. */
  const ACCESS_PATH = 'access.json';
  function siteRepo() {
    if (global.PT_SITE_REPO) return global.PT_SITE_REPO;
    const h = location.hostname.match(/^([^.]+)\.github\.io$/i);
    const seg = location.pathname.split('/').filter(Boolean)[0];
    if (h && seg) return { owner: h[1], repo: seg };
    if (state.cfg && state.cfg.siteOwner) return { owner: state.cfg.siteOwner, repo: state.cfg.siteRepo };
    return null;
  }
  const normName = (first, last) => (first.trim() + ' ' + last.trim()).toLowerCase().replace(/\s+/g, ' ');
  const nameKey = (first, last) => sha256('pt-user|' + normName(first, last));
  async function deriveKey(secret, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(text, secret) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(secret, salt);
    const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
    return { s: bytesToB64(salt), i: bytesToB64(iv), c: bytesToB64(c) };
  }
  async function unseal(entry, secret) {
    try {
      const key = await deriveKey(secret, b64ToBytes(entry.s));
      const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(entry.i) }, key, b64ToBytes(entry.c));
      return new TextDecoder().decode(out);
    } catch { return null; }
  }
  const siteUrl = (sr) => `https://api.github.com/repos/${encodeURIComponent(sr.owner)}/${encodeURIComponent(sr.repo)}/contents/${ACCESS_PATH}`;
  let accessCache = null;
  /** קריאת access.json בלי טוקן (המאגר ציבורי) */
  async function fetchAccess(force) {
    if (accessCache && !force) return accessCache;
    const sr = siteRepo();
    let acc = null, definitive = false;
    if (sr) {
      try {
        const r = await fetch(siteUrl(sr) + '?_=' + now(), { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
        if (r.ok) { const j = await r.json(); acc = JSON.parse(await decodeFile(j.content)); }
        definitive = r.ok || r.status === 404;
      } catch (e) { console.warn('access via api failed', e); }
    }
    if (!acc && !definitive && sr) {
      try { const r = await fetch(ACCESS_PATH + '?_=' + now(), { cache: 'no-store' }); if (r.ok) acc = await r.json(); } catch { }
    }
    accessCache = acc && acc.data ? acc : null;
    return accessCache;
  }
  /** עדכון access.json (דורש טוקן עם הרשאת כתיבה גם למאגר האתר) */
  async function writeAccess(mutate) {
    const sr = siteRepo();
    if (!sr) throw new Error('לא זוהה מאגר האתר.');
    for (let attempt = 0; attempt < 4; attempt++) {
      const g = await fetch(siteUrl(sr) + '?_=' + now(), { headers: ghHeaders(), cache: 'no-store' });
      let acc = { v: 1, users: [] }, sha;
      if (g.ok) { const j = await g.json(); sha = j.sha; try { acc = JSON.parse(await decodeFile(j.content)); } catch { } }
      else if (g.status !== 404) throw await ghError(g);
      acc.users = acc.users || [];
      await mutate(acc);
      const body = { message: 'עדכון הרשאות כניסה', content: b64encode(JSON.stringify(acc, null, 1)) };
      if (sha) body.sha = sha;
      const p = await fetch(siteUrl(sr), { method: 'PUT', headers: ghHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
      if (p.status === 409 || p.status === 422) { await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1))); continue; }
      if (!p.ok) throw await ghError(p);
      accessCache = acc;
      return acc;
    }
    throw new Error('לא הצלחתי לעדכן את קובץ ההרשאות. נסה שוב.');
  }
  const dataInfo = () => ({ owner: state.cfg.owner, repo: state.cfg.repo, branch: state.cfg.branch, path: state.cfg.path });

  let _su = null, _suAt = 0;
  function sessionUser() {
    if (now() - _suAt > 2000) { const s = Store.session; _su = s && s.userId; _suAt = now(); }
    return _su;
  }

  /* ---------- API ציבורי ---------- */
  const Store = {
    uid, now, sha256, hashPassword,
    get db() { return state.db; },
    get cfg() { return state.cfg; },
    get status() { return { status: state.status, message: state.message, lastSync: state.lastSync }; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async init() {
      state.cfg = loadCfg();
      state.db = await loadLocal();
      if (!state.cfg) return { needsSetup: true };
      if (state.cfg.mode === 'github') {
        setStatus('saving', 'טוען…');
        try {
          await pull();
          if (!state.sha) { state.version++; await push(); } // יצירת קובץ נתונים ראשון
          setStatus('synced', 'מסונכרן');
        } catch (e) {
          setStatus(navigator.onLine ? 'error' : 'offline', e.message);
        }
        this.startPolling();
      } else setStatus('local', 'נשמר');
      if (channel) channel.onmessage = async () => {
        if (state.cfg && state.cfg.mode === 'local') { state.db = await loadLocal(); emit('remote'); }
      };
      return { needsSetup: false };
    },

    async testConnection(cfg) {
      const prev = state.cfg; state.cfg = cfg; state.etag = null;
      try {
        const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`, { headers: ghHeaders(), cache: 'no-store' });
        if (!res.ok) throw await ghError(res);
        const repo = await res.json();
        if (repo.permissions && !repo.permissions.push) throw new Error('לטוקן יש הרשאת קריאה בלבד. נדרשת הרשאת כתיבה (Contents: Read and write).');
        return { ok: true, private: repo.private };
      } finally { state.cfg = prev; }
    },

    async connect(cfg) {
      saveCfg(cfg); state.sha = null; state.etag = null;
      if (cfg.mode === 'github') { await pull(); if (!state.sha) { state.version++; await push(); } this.startPolling(); setStatus('synced', 'מסונכרן'); }
      else { await cacheLocal(true); setStatus('local', 'נשמר'); }
    },
    disconnect() { localStorage.removeItem(LS_CFG); state.cfg = null; clearInterval(state.poller); },

    startPolling() {
      clearInterval(state.poller);
      state.poller = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 12000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
      window.addEventListener('online', () => syncNow());
    },
    syncNow,
    /** שמירה מקומית מיידית (למשל בסיום ייבוא) */
    flush() { return cacheLocal(true); },

    /** כל שינוי בנתונים עובר כאן: מעדכן את המטמון ומתזמן שמירה */
    commit() {
      state.version++;
      cacheLocal();
      emit('change');
      if (state.cfg && state.cfg.mode === 'github') { setStatus('saving', 'ממתין לשמירה…'); schedule(1200); }
    },

    /* ---------- סט נתונים ---------- */
    columns(ds) { return state.db.datasets[ds].columns.filter((c) => !c.deleted).sort((a, b) => a.order - b.order); },
    rows(ds) { return state.db.datasets[ds].rows.filter((r) => !r.deleted); },
    rowById(ds, id) { return state.db.datasets[ds].rows.find((r) => r.id === id); },
    touch(rec) { rec.updatedAt = now(); rec.by = sessionUser(); return rec; },

    /* ---------- משתמשים ---------- */
    // נקרא בכל ציור תא (הרשאות) — שומרים במטמון במקום לקרוא מהאחסון כל פעם
    get session() { if (_sess === undefined) { try { _sess = JSON.parse(sessionStorage.getItem(LS_SESSION) || localStorage.getItem(LS_SESSION)); } catch { _sess = null; } } return _sess; },
    currentUser() { const s = this.session; return s && state.db.users.find((u) => u.id === s.userId && !u.deleted); },
    userName(id) { const u = state.db.users.find((x) => x.id === id); return u ? `${u.first} ${u.last}` : ''; },
    register(first, last, pw, extra = {}) {
      first = first.trim(); last = last.trim();
      if (!first || !last) throw new Error('צריך למלא שם פרטי ושם משפחה.');
      if (pw.length < 8) throw new Error('הסיסמה צריכה להכיל לפחות 8 תווים (היא גם מצפינה את הגישה לנתונים מכל מכשיר).');
      const key = (first + ' ' + last).toLowerCase();
      if (state.db.users.some((u) => !u.deleted && (u.first + ' ' + u.last).toLowerCase() === key)) throw new Error('משתמש בשם הזה כבר רשום. אפשר להתחבר במקום להירשם.');
      const salt = uid();
      const user = Object.assign({ id: uid(), first, last, salt, hash: hashPassword(pw, salt), createdAt: now(), updatedAt: now() }, extra);
      state.db.users.push(user);
      this.commit();
      return user;
    },
    login(first, last, pw, remember) {
      const key = (first.trim() + ' ' + last.trim()).toLowerCase();
      const u = state.db.users.find((x) => !x.deleted && (x.first + ' ' + x.last).toLowerCase() === key);
      if (!u) throw new Error('לא נמצא משתמש בשם הזה. בדוק את האיות או הירשם.');
      if (hashPassword(pw, u.salt) !== u.hash) throw new Error('הסיסמה שגויה.');
      _suAt = 0;
      const s = JSON.stringify({ userId: u.id, at: now() });
      sessionStorage.setItem(LS_SESSION, s); _sess = undefined;
      if (remember) localStorage.setItem(LS_SESSION, s); else localStorage.removeItem(LS_SESSION);
      return u;
    },
    updateUser(id, patch) {
      const u = state.db.users.find((x) => x.id === id); if (!u) return null;
      Object.assign(u, patch); u.updatedAt = now(); this.commit(); return u;
    },
    /** אחסון מקומי קטן (העדפות התראה, תאריך התראה אחרונה) — משותף גם ל-Service Worker */
    async kvGet(k) { try { return await IDB.get(k); } catch { return null; } },
    async kvSet(k, v) { try { await IDB.set(k, v); } catch { } },
    logout() { _suAt = 0; _sess = undefined; sessionStorage.removeItem(LS_SESSION); localStorage.removeItem(LS_SESSION); sessionStorage.removeItem('pt.unlocked'); },

    /* ---------- כניסה מכל מכשיר ---------- */
    siteRepo,
    fetchAccess,
    get remoteReady() { return !!(state.cfg && state.cfg.mode === 'github'); },
    /** מאפשר למשתמש להיכנס מכל מכשיר עם שם + סיסמה */
    async enableRemoteLogin(user, password) {
      if (!this.remoteReady) return false;
      const entry = await seal(state.cfg.token, password);
      entry.u = nameKey(user.first, user.last);
      await writeAccess((acc) => {
        acc.data = dataInfo();
        acc.users = acc.users.filter((x) => x.u !== entry.u).concat(entry);
      });
      return true;
    },
    async hasRemoteLogin(user) {
      const acc = await fetchAccess(true);
      return !!(acc && acc.users.some((x) => x.u === nameKey(user.first, user.last)));
    },
    async setTeamCode(code) {
      if (!this.remoteReady) throw new Error('צריך קודם להפעיל סנכרון.');
      if (code.length < 4) throw new Error('קוד הצוות צריך להכיל לפחות 4 תווים.');
      const team = await seal(state.cfg.token, code);
      await writeAccess((acc) => { acc.data = dataInfo(); acc.team = team; });
    },
    /** כניסה ממכשיר שעוד לא מחובר: מפענח את הטוקן בעזרת הסיסמה ומתחבר לנתונים */
    async remoteLogin(first, last, password) {
      const acc = await fetchAccess(true);
      if (!acc) throw new Error('המערכת עוד לא מסונכרנת. היכנס מהמכשיר הראשי.');
      const entry = acc.users.find((x) => x.u === nameKey(first, last));
      if (!entry) throw new Error('לא נמצא משתמש בשם הזה. בדוק את האיות, או הירשם עם קוד הצוות.');
      const token = await unseal(entry, password);
      if (!token) throw new Error('הסיסמה שגויה.');
      await this.connect(Object.assign({ mode: 'github' }, acc.data, { token }));
      return this.login(first, last, password, true);
    },
    /** הצטרפות ממכשיר חדש בעזרת קוד הצוות (לפני הרשמה) */
    async remoteJoin(code) {
      const acc = await fetchAccess(true);
      if (!acc || !acc.team) throw new Error('עוד לא הוגדר קוד צוות. בקש ממנהל המערכת להגדיר אותו (תפריט המשתמש ← קוד צוות).');
      const token = await unseal(acc.team, code);
      if (!token) throw new Error('קוד הצוות שגוי.');
      await this.connect(Object.assign({ mode: 'github' }, acc.data, { token }));
    },
    async checkSiteWrite() {
      const sr = siteRepo(); if (!sr || !this.remoteReady) return null;
      const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(sr.owner)}/${encodeURIComponent(sr.repo)}`, { headers: ghHeaders(), cache: 'no-store' });
      if (!r.ok) return false;
      const j = await r.json();
      return !!(j.permissions && j.permissions.push);
    },

    /* ---------- פרויקטים ---------- */
    projects() { return state.db.projects.filter((p) => !p.deleted).sort((a, b) => a.order - b.order); },
    isUnlocked(pid) { try { return (JSON.parse(sessionStorage.getItem('pt.unlocked')) || []).includes(pid); } catch { return false; } },
    unlock(pid) { const s = new Set(JSON.parse(sessionStorage.getItem('pt.unlocked') || '[]')); s.add(pid); sessionStorage.setItem('pt.unlocked', JSON.stringify([...s])); },

    /* ---------- ייבוא/ייצוא גיבוי ---------- */
    exportJson() { return JSON.stringify(state.db, null, 1); },
    importJson(text) { state.db = normalizeDb(mergeDb(state.db, normalizeDb(JSON.parse(text)))); this.commit(); emit('remote'); },
    normalizeDb, mergeDb, emptyDb,
  };

  global.Store = Store;
})(window);
