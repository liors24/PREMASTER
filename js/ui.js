/* =========================================================
   ui.js — רכיבי ממשק משותפים: אייקונים, תפריטים, חלונות, הודעות
   ========================================================= */
(function (global) {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const P = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    sortAsc: '<path d="M7 4v16M3 8l4-4 4 4M14 6h7M14 12h5M14 18h3"/>',
    sortDesc: '<path d="M7 20V4M3 16l4 4 4-4M14 6h3M14 12h5M14 18h7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    cloud: '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z"/>',
    cloudOff: '<path d="M3 3l18 18M8.5 8.2A5 5 0 0 0 7 18h11M19 10a4 4 0 0 1 2 6.5M11 6.1A6 6 0 0 1 19 10"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    alert: '<path d="M12 3l10 18H2zM12 10v4M12 18h.01"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
    undo: '<path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 10v10"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6M6.6 6.6A17 17 0 0 0 2.5 12S6 18 12 18a9 9 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="3"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/>',
    fillDown: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
    rowAbove: '<rect x="3" y="12" width="18" height="8" rx="1"/><path d="M12 3v6M9 6h6"/>',
    rowBelow: '<rect x="3" y="4" width="18" height="8" rx="1"/><path d="M12 15v6M9 18h6"/>',
    height: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
    wand: '<path d="M15 4V2M15 10V8M19 6h2M9 6h2M17.8 3.2l1.4-1.4M17.8 8.8l1.4 1.4M3 21l12-12"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    box: '<path d="M21 8l-9-5-9 5 9 5zM3 8v8l9 5 9-5V8M12 13v8"/>',
  };
  const icon = (name, size = 16) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

  /* ---------- toast ---------- */
  function toast(msg, kind = 'info', ms = 3200) {
    let host = document.getElementById('toasts');
    if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
    const t = document.createElement('div');
    t.className = 'toast toast-' + kind;
    t.setAttribute('role', 'status');
    t.innerHTML = icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'cloud', 16) + `<span>${esc(msg)}</span><i class="toast-t" style="animation-duration:${ms}ms"></i>`;
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 250); }, ms);
  }

  /* ---------- context menu ---------- */
  let openMenuEl = null;
  function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
  function menu(x, y, items) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'menu'; m.setAttribute('role', 'menu');
    for (const it of items) {
      if (!it) continue;
      if (it.sep) { m.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>'); continue; }
      if (it.title) { m.insertAdjacentHTML('beforeend', `<div class="menu-title">${esc(it.title)}</div>`); continue; }
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'menu-item' + (it.danger ? ' danger' : '');
      b.disabled = !!it.disabled; b.setAttribute('role', 'menuitem');
      b.innerHTML = `${it.icon ? icon(it.icon, 15) : '<span class="ic-sp"></span>'}<span class="mi-label">${esc(it.label)}</span>${it.shortcut ? `<kbd>${esc(it.shortcut)}</kbd>` : ''}`;
      b.addEventListener('click', () => { closeMenu(); it.action && it.action(); });
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    const vw = innerWidth, vh = innerHeight;
    let left = x - r.width; if (left < 8) left = Math.min(x, vw - r.width - 8);
    let top = y; if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
    m.style.left = left + 'px'; m.style.top = top + 'px';
    openMenuEl = m;
    const first = m.querySelector('.menu-item:not([disabled])'); first && first.focus();
    m.addEventListener('keydown', (e) => {
      const btns = [...m.querySelectorAll('.menu-item:not([disabled])')];
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
      if (e.key === 'Escape') closeMenu();
    });
    return m;
  }
  document.addEventListener('mousedown', (e) => { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }, true);
  window.addEventListener('blur', closeMenu);

  /* ---------- modal ---------- */
  function modal({ title, body, actions = [], wide = false, onClose }) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-h"><h2>${esc(title)}</h2><button class="icon-btn" data-x aria-label="סגירה">${icon('x', 18)}</button></header>
      <div class="modal-b"></div><footer class="modal-f"></footer></div>`;
    const b = back.querySelector('.modal-b');
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
    const f = back.querySelector('.modal-f');
    const close = () => { back.classList.remove('in'); setTimeout(() => back.remove(), 180); document.removeEventListener('keydown', onKey); onClose && onClose(); };
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ' + (a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-ghost');
      btn.innerHTML = (a.icon ? icon(a.icon, 16) : '') + `<span>${esc(a.label)}</span>`;
      btn.addEventListener('click', async () => {
        if (!a.action) return close();
        btn.disabled = true;
        try { const r = await a.action(back); if (r !== false) close(); }
        catch (e) { toast(e.message, 'error', 5000); }
        finally { btn.disabled = false; }
      });
      f.appendChild(btn);
    }
    if (!actions.length) f.remove();
    back.querySelector('[data-x]').onclick = close;
    back.addEventListener('mousedown', (e) => { if (e.target === back && !back.classList.contains('locked')) close(); });
    const onKey = (e) => {
      if (e.key === 'Escape' && !back.classList.contains('locked')) close();
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'INPUT') { const p = f.querySelector('.btn-primary'); if (p) { e.preventDefault(); p.click(); } }
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('in'));
    setTimeout(() => { const inp = b.querySelector('input,select,textarea'); inp && inp.focus(); }, 60);
    return { el: back, body: b, close };
  }
  function confirm(title, text, okLabel = 'אישור', danger = false) {
    return new Promise((res) => {
      let done = false;
      modal({
        title, body: `<p class="muted">${esc(text)}</p>`,
        actions: [{ label: 'ביטול', action: () => { done = true; res(false); } }, { label: okLabel, primary: !danger, danger, action: () => { done = true; res(true); } }],
        onClose: () => { if (!done) res(false); },
      });
    });
  }
  function prompt(title, label, value = '', okLabel = 'שמירה') {
    return new Promise((res) => {
      let done = false;
      const m = modal({
        title, body: `<label class="field"><span>${esc(label)}</span><input type="text" value="${esc(value)}"></label>`,
        actions: [{ label: 'ביטול', action: () => { done = true; res(null); } }, { label: okLabel, primary: true, action: (el) => { done = true; res(el.querySelector('input').value.trim()); } }],
        onClose: () => { if (!done) res(null); },
      });
      setTimeout(() => m.body.querySelector('input').select(), 80);
    });
  }

  /** חיווי עבודה ברקע; מחזיר פונקציה שסוגרת אותו */
  function busy(msg) {
    const el = document.createElement('div');
    el.className = 'busy'; el.setAttribute('role', 'status');
    el.innerHTML = `<span class="spinner"></span><span>${esc(msg)}</span>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    return () => { el.classList.remove('in'); setTimeout(() => el.remove(), 200); };
  }

  /**
   * מחוון התקדמות לפעולות ארוכות (קריאת אקסל, ייבוא):
   * set(שבר 0..1, שלב, פירוט) · done(הודעה) · fail()
   */
  function progress(title) {
    const back = document.createElement('div');
    back.className = 'prog-back';
    back.innerHTML = `<div class="prog-card" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="${esc(title)}">
      <div class="prog-ic"><svg viewBox="0 0 100 100" width="46" height="46" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round">${Array.from({ length: 9 }, (_, i) => `<path d="M50 50 C 58 40, 61 26, 56 12" transform="rotate(${i * 40} 50 50)"/>`).join('')}<circle cx="50" cy="50" r="10" fill="currentColor" stroke="none"/></svg>
        <svg class="prog-ok" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></div>
      <b class="prog-title">${esc(title)}</b>
      <span class="prog-stage">מתחיל…</span>
      <div class="prog-bar"><i></i></div>
      <div class="prog-meta"><span class="prog-detail"></span><b class="prog-pct">0%</b></div>
    </div>`;
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('in'));
    const card = back.querySelector('.prog-card');
    let last = 0;
    const api = {
      set(frac, stage, detail) {
        frac = Math.max(last, Math.min(1, frac)); last = frac;
        const p = Math.round(frac * 100);
        back.querySelector('.prog-bar i').style.transform = `scaleX(${frac})`;
        back.querySelector('.prog-pct').textContent = p + '%';
        card.setAttribute('aria-valuenow', p);
        if (stage) back.querySelector('.prog-stage').textContent = stage;
        if (detail != null) back.querySelector('.prog-detail').textContent = detail;
        if (global.__progressLog) global.__progressLog.push([p, stage || '']);
      },
      done(msg) {
        return new Promise((ok) => {
          api.set(1, msg || 'הושלם');
          card.classList.add('ok');
          setTimeout(() => { back.classList.remove('in'); setTimeout(() => { back.remove(); ok(); }, 220); }, 700);
        });
      },
      fail() { back.remove(); },
    };
    return api;
  }
  /** מאפשר לדפדפן לצייר בין מנות עבודה */
  const yieldUI = () => new Promise((ok) => setTimeout(ok, 0));

  global.UI = { esc, icon, toast, menu, closeMenu, modal, confirm, prompt, busy, progress, yieldUI };
})(window);
