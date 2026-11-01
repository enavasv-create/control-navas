/* CONTROL - escritor mínimo de .xlsx (ZIP sin compresión). Sin dependencias, funciona offline. */
(function (root) {
  'use strict';

  const enc = new TextEncoder();

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) { // files: [{name, data(Uint8Array)}]
    const chunks = [];
    const central = [];
    let offset = 0;
    const u16 = (v) => new Uint8Array([v & 255, (v >>> 8) & 255]);
    const u32 = (v) => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
    const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0); const o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const local = cat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
        u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0), name, f.data);
      chunks.push(local);
      central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
        u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), name));
      offset += local.length;
    }
    const cd = cat(...central);
    const end = cat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(cd.length), u32(offset), u16(0));
    return cat(...chunks, cd, end);
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

  // rows: array de arrays; celdas: string | number | null. La 1a fila es encabezado (estilo 1).
  function sheetXml(rows, widths) {
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    x += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    x += '<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols><sheetData>';
    rows.forEach((r, ri) => {
      x += '<row r="' + (ri + 1) + '">';
      r.forEach((v, ci) => {
        if (v === null || v === undefined || v === '') return;
        const ref = colName(ci) + (ri + 1);
        if (typeof v === 'number') x += '<c r="' + ref + '" s="' + (ri === 0 ? 1 : 2) + '"><v>' + v + '</v></c>';
        else x += '<c r="' + ref + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      });
      x += '</row>';
    });
    return x + '</sheetData></worksheet>';
  }

  // sheets: [{name, rows, widths}]
  function buildXlsx(sheets) {
    const files = [];
    const add = (name, text) => files.push({ name, data: enc.encode(text) });
    const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    add('[Content_Types].xml', H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>');
    add('_rels/.rels', H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    add('xl/workbook.xml', H + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map((s, i) => '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>');
    add('xl/_rels/workbook.xml.rels', H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    add('xl/styles.xml', H + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    sheets.forEach((s, i) => add('xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s.rows, s.widths)));
    return zip(files);
  }

  const api = { buildXlsx, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Xlsx = api;
})(typeof window !== 'undefined' ? window : globalThis);
