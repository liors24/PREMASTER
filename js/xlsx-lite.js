/* =========================================================
   xlsx-lite.js — קריאה וכתיבה של קובצי אקסל (xlsx) בלי ספריות חיצוניות
   קריאה: פירוק ZIP + DecompressionStream של הדפדפן
   כתיבה: ZIP ללא דחיסה עם CRC32
   קבצי ‎.xls ישנים נטענים דרך SheetJS מ-CDN לפי הצורך.
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------------- ZIP read ---------------- */
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('הקובץ אינו קובץ אקסל תקין (xlsx).');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      const lnlen = dv.getUint16(off + 26, true), lelen = dv.getUint16(off + 28, true);
      const start = off + 30 + lnlen + lelen;
      files[name] = { method, data: u8.subarray(start, start + csize) };
      p += 46 + nlen + elen + clen;
    }
    return {
      has: (name) => !!files[name],
      async text(name) {
        const f = files[name]; if (!f) return null;
        const raw = f.method === 8 ? await inflateRaw(f.data) : f.data;
        return dec.decode(raw);
      },
    };
  }

  /* ---------------- XLSX read ---------------- */
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const tags = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

  function colIndex(ref) {
    let n = 0;
    for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); }
    return n - 1;
  }
  function serialToISO(v) {
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    if (isNaN(d)) return String(v);
    return d.toISOString().slice(0, 10);
  }

  async function readXlsx(buf) {
    const zip = await unzip(buf);
    const wb = xml(await zip.text('xl/workbook.xml'));
    const rels = xml((await zip.text('xl/_rels/workbook.xml.rels')) || '<Relationships/>');
    const relMap = {};
    for (const r of tags(rels, 'Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');

    const shared = [];
    const ssText = await zip.text('xl/sharedStrings.xml');
    if (ssText) for (const si of tags(xml(ssText), 'si')) shared.push(tags(si, 't').map((t) => t.textContent).join(''));

    // זיהוי תאי תאריך לפי סגנון
    const dateStyles = new Set();
    const stText = await zip.text('xl/styles.xml');
    if (stText) {
      const st = xml(stText);
      const custom = {};
      for (const f of tags(st, 'numFmt')) custom[f.getAttribute('numFmtId')] = f.getAttribute('formatCode') || '';
      const cellXfs = tags(st, 'cellXfs')[0];
      if (cellXfs) {
        Array.from(cellXfs.children).forEach((xf, i) => {
          const id = +xf.getAttribute('numFmtId');
          const code = (custom[id] || '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
          if (DATE_IDS.has(id) || (custom[id] && /[dy]/i.test(code) && !/^[#0.,%]+$/.test(code))) dateStyles.add(i);
        });
      }
    }

    const sheets = [];
    for (const s of tags(wb, 'sheet')) {
      const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let target = relMap[rid] || '';
      target = target.replace(/^\//, '');
      if (!target.startsWith('xl/')) target = 'xl/' + target;
      const text = await zip.text(target);
      if (!text) continue;
      const doc = xml(text);
      const rows = [];
      for (const r of tags(doc, 'row')) {
        const ri = (+r.getAttribute('r') || rows.length + 1) - 1;
        const arr = [];
        let ci = 0;
        for (const c of tags(r, 'c')) {
          const ref = c.getAttribute('r');
          if (ref) ci = colIndex(ref);
          const t = c.getAttribute('t');
          const vEl = tags(c, 'v')[0];
          let v = vEl ? vEl.textContent : '';
          if (t === 's') v = shared[+v] ?? '';
          else if (t === 'inlineStr') v = tags(c, 't').map((x) => x.textContent).join('');
          else if (t === 'b') v = v === '1' ? 'TRUE' : 'FALSE';
          else if (t !== 'str' && t !== 'e' && v !== '') {
            const num = +v;
            if (dateStyles.has(+c.getAttribute('s')) && num > 0 && num < 2958466) v = serialToISO(num);
            else if (!isNaN(num)) v = Math.round(num * 1e9) / 1e9;
          }
          arr[ci] = v;
          ci++;
        }
        rows[ri] = arr;
      }
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      sheets.push({ name: s.getAttribute('name'), rows });
    }
    return sheets;
  }

  function loadSheetJS() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    return new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = () => ok(global.XLSX);
      s.onerror = () => fail(new Error('לא ניתן לטעון את רכיב הקריאה לקובצי xls ישנים. שמור את הקובץ כ-xlsx ונסה שוב.'));
      document.head.appendChild(s);
    });
  }

  function parseCSV(text) {
    const rows = []; let row = []; let cur = ''; let q = false;
    const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  async function readFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
      let text = await file.text();
      text = text.replace(/^﻿/, '');
      return [{ name: file.name, rows: parseCSV(text) }];
    }
    const buf = await file.arrayBuffer();
    if (name.endsWith('.xls') || !(new Uint8Array(buf)[0] === 0x50 && new Uint8Array(buf)[1] === 0x4b)) {
      const X = await loadSheetJS();
      const wb = X.read(buf, { type: 'array', cellDates: true });
      return wb.SheetNames.map((n) => ({
        name: n,
        rows: X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }).map((r) => r.map((v) => v instanceof Date ? v.toISOString().slice(0, 10) : v)),
      }));
    }
    return readXlsx(buf);
  }

  /* ---------------- ZIP write ---------------- */
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zip(files) {
    const enc = new TextEncoder();
    const parts = []; const central = []; let offset = 0;
    for (const [name, content] of Object.entries(files)) {
      const nb = enc.encode(name); const data = enc.encode(content); const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true);
      parts.push(new Uint8Array(lh.buffer), nb, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nb);
      offset += 30 + nb.length + data.length;
    }
    const csize = central.reduce((s, a) => s + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  function colRef(i) { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

  /** sheets: [{name, header:[...], rows:[[...]], widths:[px]}] */
  function writeXlsx(sheets) {
    const files = {};
    files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
    files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    files['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
    files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    files['xl/styles.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1C3550"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" fillId="0"/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`;
    sheets.forEach((s, si) => {
      const rowsXml = [];
      const all = [s.header, ...s.rows];
      all.forEach((r, ri) => {
        const cells = r.map((v, ci) => {
          if (v === '' || v == null) return '';
          const ref = colRef(ci) + (ri + 1);
          const st = ri === 0 ? ' s="1"' : '';
          if (ri > 0 && typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
          return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        }).join('');
        rowsXml.push(`<row r="${ri + 1}">${cells}</row>`);
      });
      const cols = (s.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(6, Math.round(w / 7))}" customWidth="1"/>`).join('');
      files[`xl/worksheets/sheet${si + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rowsXml.join('')}</sheetData><autoFilter ref="A1:${colRef(Math.max(0, s.header.length - 1))}${all.length}"/></worksheet>`;
    });
    return zip(files);
  }

  global.XlsxLite = { readFile, readXlsx, writeXlsx, parseCSV };
})(window);
