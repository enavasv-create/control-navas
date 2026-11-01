/* CONTROL - interfaz y almacenamiento (IndexedDB). */
(function () {
  'use strict';
  const APP_VERSION = '1.1.0'; // mantener igual que VERSION en sw.js
  const C = window.Core;
  const V = window.Vault;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Almacenamiento ----------
  let db;
  function openDb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('control-db', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('expenses', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'key' });
        d.createObjectStore('snaps', { autoIncrement: true });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function run(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const dbAll = (s) => run(s, 'readonly', (o) => o.getAll());
  const dbKeys = (s) => run(s, 'readonly', (o) => o.getAllKeys());
  const dbPut = (s, v) => run(s, 'readwrite', (o) => o.put(v));
  const dbDel = (s, k) => run(s, 'readwrite', (o) => o.delete(k));
  function dbReplaceAll(list) { // una sola transacción: o queda todo o no cambia nada
    return new Promise((res, rej) => {
      const t = db.transaction('expenses', 'readwrite');
      const o = t.objectStore('expenses');
      o.clear();
      list.forEach((e) => o.put(e));
      t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }

  // ---------- Estado ----------
  let expenses = [];
  let settings = { budget: 0, categories: C.DEFAULT_CATEGORIES.slice(), lastBackup: null };
  let tab = 'home';
  let month = C.monthKey(new Date());
  let show = localStorage.getItem('control-show') === '1';
  let sheet = null;
  let persisted = null;
  const isStandalone = () => window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

  async function loadAll() {
    expenses = await dbAll('expenses');
    const meta = await dbAll('meta');
    const s = meta.find((m) => m.key === 'settings');
    if (s) settings = Object.assign(settings, s.value);
  }
  const saveSettings = () => dbPut('meta', { key: 'settings', value: settings });
  const money = (n) => (show ? C.formatMoney(n) : '$ ••••');

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // ---------- Diálogos propios ----------
  // o: {title, body, fields:[{id,type,placeholder}], buttons:[{id,label,primary,danger}], validate(btnId, values)->error|null}
  function ask(o) {
    return new Promise((res) => {
      const root = $('#modal-root');
      let h = '<div class="shade modal"><div class="dlg" role="dialog" aria-modal="true"><b>' + esc(o.title) + '</b>';
      if (o.body) h += '<p class="note" style="white-space:pre-line">' + esc(o.body) + '</p>';
      (o.fields || []).forEach((f) => {
        h += '<input id="m_' + f.id + '" type="' + (f.type || 'text') + '" placeholder="' + esc(f.placeholder || '') +
          '" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">';
      });
      h += '<div class="err small" style="color:var(--bad);min-height:18px"></div><div class="dbtns">' +
        o.buttons.map((b) => '<button class="btn' + (b.primary ? ' primary' : '') + (b.danger ? ' dangerbtn' : '') + '" data-b="' + esc(b.id) + '">' + esc(b.label) + '</button>').join('') +
        '</div></div></div>';
      root.innerHTML = h;
      root.onclick = (ev) => {
        const b = ev.target.closest('button[data-b]');
        if (!b) return;
        const values = {};
        (o.fields || []).forEach((f) => { values[f.id] = $('#m_' + f.id).value; });
        if (o.validate) {
          const err = o.validate(b.dataset.b, values);
          if (err) { $('.dlg .err').textContent = err; return; }
        }
        root.onclick = null; root.innerHTML = '';
        res({ btn: b.dataset.b, values });
      };
    });
  }
  const info = (title, body) => ask({ title, body, buttons: [{ id: 'ok', label: 'Entendido', primary: true }] });

  // ---------- Vistas ----------
  function render() {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const v = $('#view');
    v.innerHTML = tab === 'home' ? homeHtml() : tab === 'history' ? historyHtml() : settingsHtml();
    if (tab === 'home') {
      const f = document.createElement('button');
      f.className = 'fab'; f.id = 'fab'; f.textContent = '+ Registrar gasto';
      v.appendChild(f);
    }
  }

  function monthNavHtml() {
    return '<div class="monthnav"><button data-act="prev" aria-label="Mes anterior">‹</button><div class="lbl">' +
      C.monthLabel(month) + '</div><button data-act="next" aria-label="Mes siguiente">›</button></div>';
  }
  const eyeHtml = () => '<button class="eye" data-act="eye">' + (show ? 'Ocultar montos' : 'Mostrar montos') + '</button>';
  const bannerHtml = () => (isStandalone() ? '' :
    '<div class="card banner">Estás en el navegador. Los datos guardados aquí NO se comparten con la app instalada en la pantalla de inicio. Instala CONTROL antes de registrar datos reales.</div>');

  function breakdownHtml(title, entries, nameFn) {
    if (!entries.length) return '';
    return '<h2>' + title + '</h2><div class="card"><ul class="list">' + entries.map(([k, v]) =>
      '<li><span>' + esc(nameFn(k)) + '</span><span class="amt">' + money(v) + '</span></li>').join('') + '</ul></div>';
  }

  function mvHtml(e) {
    return '<li class="tap" data-edit="' + esc(e.id) + '"><div class="mv-main"><div>' + esc(e.category) + '</div><div class="mv-sub">' +
      esc(C.methodName(e.method)) + ' · ' + C.dateStr(e.ts).split('-').reverse().join('-') + ' ' + C.timeStr(e.ts) +
      (e.note ? ' · ' + esc(e.note) : '') + '</div></div><div class="amt">' + money(e.amount) + '</div></li>';
  }

  function homeHtml() {
    const list = C.inMonth(expenses, month);
    const t = C.totals(list);
    const budget = settings.budget || 0;
    const avail = budget - t.total;
    const pct = budget > 0 ? Math.min(100, Math.round(t.total / budget * 100)) : 0;
    let h = bannerHtml() + '<div class="row"><h1>Control</h1>' + eyeHtml() + '</div>' + monthNavHtml();
    h += '<div class="card"><div class="dim small">Total gastado</div><div class="big">' + money(t.total) + '</div>';
    if (budget > 0) {
      h += '<div class="bar' + (avail < 0 ? ' over' : '') + '"><i style="width:' + pct + '%"></i></div>';
      h += '<div class="stats"><div class="stat"><span class="dim small">Presupuesto</span><b>' + money(budget) + '</b></div>' +
        '<div class="stat"><span class="dim small">Disponible del presupuesto</span><b' + (avail < 0 ? ' style="color:var(--bad)"' : '') + '>' + money(avail) + '</b></div></div>';
    } else {
      h += '<div class="note" style="margin-top:10px">Define un presupuesto mensual en Ajustes.</div>';
    }
    h += '</div>';
    h += breakdownHtml('Por categoría', C.sortedEntries(t.byCategory), (k) => k);
    h += breakdownHtml('Por medio de pago', C.sortedEntries(t.byMethod), C.methodName);
    h += '<h2>Últimos movimientos</h2><div class="card">' + (list.length
      ? '<ul class="list">' + list.slice(0, 6).map(mvHtml).join('') + '</ul>'
      : '<div class="empty">Sin gastos este mes.</div>') + '</div>';
    h += '<div class="note" style="margin-top:12px">El disponible es presupuesto menos gastos registrados; no es tu saldo bancario.</div>';
    return h;
  }

  function historyHtml() {
    const list = C.inMonth(expenses, month);
    const t = C.totals(list);
    let h = '<div class="row"><h1>Historial</h1>' + eyeHtml() + '</div>' + monthNavHtml();
    h += '<div class="card row"><span class="dim">' + list.length + ' movimientos</span><b class="num">' + money(t.total) + '</b></div>';
    h += '<div style="height:12px"></div><div class="card">' + (list.length
      ? '<ul class="list">' + list.map(mvHtml).join('') + '</ul>'
      : '<div class="empty">Sin movimientos en este mes.</div>') + '</div>';
    h += '<div style="height:14px"></div><button class="btn primary" data-act="xlsx">Exportar ' + esc(C.monthLabel(month)) + ' a Excel (.xlsx)</button>';
    return h;
  }

  function settingsHtml() {
    const lb = settings.lastBackup;
    const days = lb ? Math.floor((Date.now() - new Date(lb).getTime()) / 864e5) : null;
    const all = expenses.slice().sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const grand = expenses.reduce((s, e) => s + e.amount, 0);
    let h = '<h1>Ajustes</h1>';
    h += '<h2>Presupuesto mensual</h2><div class="card"><input id="budget" type="text" inputmode="numeric" placeholder="Ej: 800000" value="' + (settings.budget || '') + '">' +
      '<button class="btn" data-act="savebudget" style="margin:0">Guardar presupuesto</button></div>';
    h += '<h2>Categorías</h2><div class="card">' + settings.categories.map((c, i) =>
      '<div class="cat-edit"><input type="text" data-cat="' + i + '" value="' + esc(c) + '"><button data-delcat="' + i + '" aria-label="Quitar">✕</button></div>').join('') +
      '<div class="cat-edit"><input type="text" id="newcat" placeholder="Nueva categoría"><button data-act="addcat" aria-label="Agregar">+</button></div>' +
      '<div class="note">Renombrar una categoría actualiza también los movimientos existentes. Quitarla no borra movimientos.</div></div>';
    h += '<h2>Respaldo (copia externa)</h2><div class="card">' +
      '<div class="note">Tus datos viven en este dispositivo (almacenamiento local). El respaldo es un archivo aparte que guardas fuera de la app (Archivos / iCloud Drive). Una cosa no reemplaza a la otra.</div>' +
      '<div class="note ' + (days === null || days > 7 ? 'warn' : '') + '">' + (lb ? 'Último respaldo creado: hace ' + days + ' día(s).' : 'Aún no has creado ningún respaldo.') + '</div>' +
      '<button class="btn primary" data-act="backup-enc">Crear respaldo cifrado (recomendado)</button>' +
      '<button class="btn" data-act="backup">Crear respaldo sin cifrar</button>' +
      '<button class="btn" data-act="restore">Restaurar desde un respaldo…</button>' +
      '<button class="btn" data-act="snaps" style="margin:0">Copias internas previas…</button>' +
      '<input type="file" id="file" style="position:absolute;left:-9999px;opacity:0;width:1px;height:1px" tabindex="-1"></div>';
    h += '<h2>Exportar</h2><div class="card"><button class="btn" data-act="xlsx-all" style="margin:0">Exportar todo el historial a Excel</button></div>';
    h += '<h2>Estado de CONTROL</h2><div class="card">' +
      '<div class="kv"><span>Versión</span><span>' + APP_VERSION + '</span></div>' +
      '<div class="kv"><span>Se ejecuta como</span><span>' + (isStandalone() ? 'App instalada' : 'Navegador') + '</span></div>' +
      '<div class="kv"><span>Movimientos guardados</span><span class="num">' + expenses.length + '</span></div>' +
      '<div class="kv"><span>Suma de todos los movimientos</span><span class="num">' + money(grand) + '</span></div>' +
      '<div class="kv"><span>Último movimiento</span><span>' + (all.length ? C.dateStr(all[0].ts) + ' ' + C.timeStr(all[0].ts) : '—') + '</span></div>' +
      '<div class="kv"><span>Almacenamiento protegido (informativo)</span><span>' + (persisted === null ? 'No disponible' : persisted ? 'Sí' : 'No') + '</span></div>' +
      '</div>';
    h += '<div class="note" style="margin-top:14px">CONTROL v' + APP_VERSION + ' · sin conexión a bancos ni servicios de pago. Los datos de este dispositivo son independientes de los de otros dispositivos.</div>';
    return h;
  }

  // ---------- Hoja de registro ----------
  function openSheet(e) {
    sheet = e
      ? { id: e.id, digits: String(e.amount), category: e.category, method: e.method, note: e.note || '', ts: e.ts, created: e.created, edit: true }
      : { id: C.newId(), digits: '', category: null, method: null, note: '', ts: null, edit: false, saving: false };
    renderSheet();
  }
  function closeSheet() { sheet = null; $('#sheet-root').innerHTML = ''; }

  function toLocalInput(ts) {
    const d = new Date(ts); const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderSheet() {
    if (!sheet) return;
    const amount = parseInt(sheet.digits || '0', 10);
    const cats = settings.categories.slice();
    if (sheet.category && !cats.includes(sheet.category)) cats.push(sheet.category);
    const ok = amount > 0 && sheet.category && sheet.method && !sheet.saving;
    $('#sheet-root').innerHTML = '<div class="shade" id="shade"><div class="sheet">' +
      '<div class="top"><b>' + (sheet.edit ? 'Editar gasto' : 'Nuevo gasto') + '</b><button data-s="close">Cancelar</button></div>' +
      '<div class="display' + (amount ? '' : ' zero') + '">' + C.formatMoney(amount) + '</div>' +
      '<div class="pad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, '000', 0, '⌫'].map((k) => '<button data-k="' + k + '">' + k + '</button>').join('') + '</div>' +
      '<div class="dim small" style="margin:4px 0 6px">Categoría</div><div class="chips">' +
      cats.map((c) => '<button class="chip' + (sheet.category === c ? ' on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>' +
      '<div class="dim small" style="margin:4px 0 6px">Medio de pago</div><div class="chips">' +
      C.METHODS.map((m) => '<button class="chip' + (sheet.method === m.id ? ' on' : '') + '" data-m="' + m.id + '">' + m.name + '</button>').join('') + '</div>' +
      '<input type="text" id="note" placeholder="Descripción (opcional)" value="' + esc(sheet.note) + '">' +
      (sheet.edit ? '<div class="dim small" style="margin-bottom:4px">Fecha y hora</div><input type="datetime-local" id="when" value="' + toLocalInput(sheet.ts) + '">' : '') +
      '<button class="save" data-s="save"' + (ok ? '' : ' disabled') + '>' + (sheet.edit ? 'Guardar cambios' : 'Guardar gasto') + '</button>' +
      (sheet.edit ? '<button class="danger" data-s="del" style="width:100%">Eliminar movimiento</button>' : '') +
      '</div></div>';
  }

  async function saveSheet() {
    if (!sheet || sheet.saving) return;
    const amount = parseInt(sheet.digits || '0', 10);
    if (!(amount > 0) || !sheet.category || !sheet.method) return;
    const noteEl = $('#note'); if (noteEl) sheet.note = noteEl.value.trim();
    const nowIso = new Date().toISOString();
    let ts = sheet.ts || nowIso;
    if (sheet.edit) {
      const w = $('#when'); if (w && w.value) ts = new Date(w.value).toISOString();
    }
    const rec = { id: sheet.id, ts, amount, category: sheet.category, method: sheet.method, note: sheet.note, created: sheet.created || nowIso, updatedAt: nowIso };
    sheet.saving = true; const sb = $('.save'); if (sb) sb.disabled = true;
    if (!sheet.edit) {
      const dup = C.findRecentDuplicate(expenses, rec, nowIso, 90);
      if (dup) {
        const r = await ask({ title: '¿Posible duplicado?', body: 'Ya registraste un gasto idéntico (mismo monto, categoría y medio de pago) hace menos de 90 segundos.',
          buttons: [{ id: 'no', label: 'No guardar' }, { id: 'yes', label: 'Guardar igual', primary: true }] });
        if (r.btn !== 'yes') { sheet.saving = false; renderSheet(); return; }
      }
    }
    try {
      await dbPut('expenses', rec);
      const i = expenses.findIndex((x) => x.id === rec.id);
      if (i >= 0) expenses[i] = rec; else expenses.push(rec);
      month = C.monthKey(ts);
      closeSheet(); render();
      toast('Guardado · ' + C.formatMoney(amount));
    } catch (err) {
      sheet.saving = false; renderSheet();
      toast('ERROR al guardar. El gasto NO se registró.');
    }
  }

  async function deleteSheet() {
    if (!sheet || !sheet.edit) return;
    const r = await ask({ title: '¿Eliminar este movimiento?', body: 'No se puede deshacer (salvo restaurando un respaldo).',
      buttons: [{ id: 'no', label: 'Cancelar' }, { id: 'yes', label: 'Eliminar', danger: true }] });
    if (r.btn !== 'yes') return;
    await dbDel('expenses', sheet.id);
    expenses = expenses.filter((x) => x.id !== sheet.id);
    closeSheet(); render(); toast('Movimiento eliminado');
  }

  // ---------- Archivos ----------
  async function deliver(blob, filename, mime) {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return true; }
      catch (e) { if (e && e.name === 'AbortError') return false; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  }
  const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); };

  async function markBackup() {
    settings.lastBackup = new Date().toISOString(); await saveSettings();
    if (tab === 'settings') render();
  }

  async function doBackupPlain() {
    const data = C.makeBackup(expenses, settings, new Date().toISOString());
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const ok = await deliver(blob, 'CONTROL-respaldo-' + stamp() + '.json', 'application/json');
    if (ok) { await markBackup(); toast('Respaldo sin cifrar creado: ' + data.count + ' movimientos'); }
  }

  async function doBackupEnc() {
    const r = await ask({
      title: 'Respaldo cifrado',
      body: 'Elige una contraseña de al menos 8 caracteres.\nSi la olvidas, el respaldo NO se puede abrir y no existe forma de recuperarla. Anótala en un lugar seguro, aparte del teléfono.',
      fields: [{ id: 'p1', type: 'password', placeholder: 'Contraseña' }, { id: 'p2', type: 'password', placeholder: 'Repite la contraseña' }],
      buttons: [{ id: 'no', label: 'Cancelar' }, { id: 'ok', label: 'Continuar', primary: true }],
      validate: (b, v) => (b === 'no' ? null : v.p1.length < 8 ? 'Mínimo 8 caracteres.' : v.p1 !== v.p2 ? 'Las contraseñas no coinciden.' : null),
    });
    if (r.btn !== 'ok') return;
    toast('Cifrando…');
    const data = C.makeBackup(expenses, settings, new Date().toISOString());
    const plain = JSON.stringify(data);
    let text;
    try {
      text = await V.encryptText(plain, r.values.p1);
      const chk = await V.decryptText(text, r.values.p1); // verificación inmediata
      if (!chk.ok || chk.text !== plain) throw new Error('verificación');
    } catch (e) {
      await info('No se pudo crear el respaldo cifrado', 'Este dispositivo no pudo cifrar o verificar el archivo. No se creó ningún respaldo. Usa el respaldo sin cifrar o repórtalo.');
      return;
    }
    // Segundo paso con un toque nuevo: iOS exige un gesto reciente del usuario para abrir la hoja de compartir.
    const go = await ask({ title: 'Respaldo listo', body: data.count + ' movimientos · ' + money(data.total) + '\nVerificado: se pudo descifrar correctamente con tu contraseña.\nToca "Guardar archivo" y elige Archivos o iCloud Drive.',
      buttons: [{ id: 'no', label: 'Cancelar' }, { id: 'go', label: 'Guardar archivo', primary: true }] });
    if (go.btn !== 'go') return;
    const blob = new Blob([text], { type: 'application/json' });
    const ok = await deliver(blob, 'CONTROL-respaldo-cifrado-' + stamp() + '.json', 'application/json');
    if (ok) { await markBackup(); toast('Respaldo cifrado creado: ' + data.count + ' movimientos'); }
  }

  function xlsxFor(list, label) {
    const rows = [['Fecha', 'Hora', 'Categoría', 'Medio de pago', 'Monto', 'Descripción']];
    list.slice().sort((a, b) => (a.ts < b.ts ? -1 : 1)).forEach((e) =>
      rows.push([C.dateStr(e.ts), C.timeStr(e.ts), e.category, C.methodName(e.method), e.amount, e.note || '']));
    const t = C.totals(list);
    const res = [['Resumen', label, 'Monto'], ['Total', '', t.total], ['', '', null], ['Categoría', '', 'Monto']];
    C.sortedEntries(t.byCategory).forEach(([k, v]) => res.push([k, '', v]));
    res.push(['', '', null], ['Medio de pago', '', 'Monto']);
    C.sortedEntries(t.byMethod).forEach(([k, v]) => res.push([C.methodName(k), '', v]));
    return window.Xlsx.buildXlsx([
      { name: 'Movimientos', rows, widths: [12, 8, 18, 16, 14, 40] },
      { name: 'Resumen', rows: res, widths: [22, 16, 14] },
    ]);
  }
  async function doXlsx(all) {
    const list = all ? expenses : C.inMonth(expenses, month);
    if (!list.length) { toast('No hay movimientos para exportar'); return; }
    const label = all ? 'Todo el historial' : C.monthLabel(month);
    const bytes = xlsxFor(list, label);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const ok = await deliver(blob, 'CONTROL-' + (all ? 'historial' : month) + '.xlsx', blob.type);
    if (ok) toast('Excel generado: ' + list.length + ' movimientos');
  }

  // ---------- Restauración ----------
  async function snapshot() { // copia interna previa a una restauración (se conservan las últimas 3)
    await dbPut('snaps', { at: new Date().toISOString(), data: C.makeBackup(expenses, settings, new Date().toISOString()) });
    const keys = await dbKeys('snaps');
    for (const k of keys.slice(0, Math.max(0, keys.length - 3))) await dbDel('snaps', k);
  }
  function applySettingsFrom(d, replace) {
    if (!d.settings) return;
    if (replace || !settings.budget) settings.budget = d.settings.budget || 0;
    const cats = new Set(replace ? [] : settings.categories);
    (d.settings.categories || []).forEach((c) => cats.add(c));
    expenses.forEach((e) => cats.add(e.category));
    settings.categories = Array.from(cats);
  }
  async function applyRestore(mode, d) {
    await snapshot();
    if (mode === 'merge') {
      const m = C.mergeExpenses(expenses, d.expenses);
      await dbReplaceAll(m.expenses); expenses = m.expenses;
      applySettingsFrom(d, false); await saveSettings(); render();
      return 'Restaurado (combinado): ' + m.added + ' nuevos, ' + m.updated + ' actualizados. Total: ' + expenses.length + ' movimientos.';
    }
    await dbReplaceAll(d.expenses); expenses = d.expenses.slice();
    applySettingsFrom(d, true); await saveSettings(); render();
    return 'Datos reemplazados: ' + expenses.length + ' movimientos.';
  }

  async function doRestore(file) {
    let text;
    try { text = await file.text(); } catch (e) { await info('No se pudo leer el archivo', 'Intenta de nuevo o elige otro archivo.'); return; }
    if (V.isEncrypted(text)) {
      for (;;) {
        const r = await ask({ title: 'Respaldo cifrado', body: 'Escribe la contraseña con la que se creó este respaldo.',
          fields: [{ id: 'p', type: 'password', placeholder: 'Contraseña' }],
          buttons: [{ id: 'no', label: 'Cancelar' }, { id: 'ok', label: 'Descifrar', primary: true }] });
        if (r.btn !== 'ok') return;
        toast('Descifrando…');
        const d = await V.decryptText(text, r.values.p);
        if (d.ok) { text = d.text; break; }
        if (d.error === 'FORMAT') { await info('Archivo no válido', 'El respaldo cifrado está dañado o no es compatible. No se cambió ningún dato.'); return; }
        await info('Contraseña incorrecta', 'La contraseña no es correcta (o el archivo está dañado). Puedes reintentar.');
      }
    }
    const r = C.parseBackup(text);
    if (!r.ok) { await info('No se pudo restaurar', r.error + '\nNo se cambió ningún dato.'); return; }
    const d = r.data;
    const cur = expenses.reduce((s, e) => s + e.amount, 0);
    const pick = await ask({
      title: 'Restaurar respaldo',
      body: 'Creado: ' + new Date(d.exportedAt).toLocaleString('es-CL') + '\nEn el respaldo: ' + d.count + ' movimientos · ' + money(d.total) +
        '\nEn la app ahora: ' + expenses.length + ' movimientos · ' + money(cur) +
        '\n\nCombinar agrega lo que falta sin duplicar. Reemplazar deja la app idéntica al respaldo. Antes de cualquier cambio se guarda una copia interna.',
      buttons: [{ id: 'merge', label: 'Combinar (recomendado)', primary: true }, { id: 'replace', label: 'Reemplazar todo', danger: true }, { id: 'no', label: 'Cancelar' }],
    });
    if (pick.btn === 'no') return;
    if (pick.btn === 'replace') {
      const c = await ask({ title: '¿Reemplazar todos los datos?', body: 'Se descartarán los ' + expenses.length + ' movimientos actuales y quedarán los ' + d.count + ' del respaldo.',
        buttons: [{ id: 'no', label: 'Cancelar' }, { id: 'yes', label: 'Sí, reemplazar', danger: true }] });
      if (c.btn !== 'yes') return;
    }
    try { toast(await applyRestore(pick.btn, d)); }
    catch (e) { await info('Error al restaurar', 'No se pudo completar. Los datos anteriores no se modificaron. Detalle: ' + (e && e.message)); }
  }

  async function showSnaps() {
    const vals = await dbAll('snaps'); const keys = await dbKeys('snaps');
    if (!vals.length) { await info('Copias internas', 'Aún no hay copias internas. Se crean automáticamente justo antes de cada restauración y se conservan las últimas 3.'); return; }
    const items = vals.map((s, i) => ({ k: keys[i], s })).reverse();
    const r = await ask({ title: 'Copias internas previas', body: 'Se crearon automáticamente antes de una restauración. Elige una para volver a ese estado (la actual también se guarda antes).',
      buttons: items.map((it, i) => ({ id: 's' + i, label: new Date(it.s.at).toLocaleString('es-CL') + ' · ' + it.s.data.count + ' mov.' })).concat([{ id: 'no', label: 'Cerrar', primary: true }]) });
    if (r.btn === 'no') return;
    const it = items[+r.btn.slice(1)];
    const c = await ask({ title: '¿Volver a esta copia?', body: it.s.data.count + ' movimientos · ' + money(it.s.data.total) + '\nSustituye los ' + expenses.length + ' movimientos actuales.',
      buttons: [{ id: 'no', label: 'Cancelar' }, { id: 'yes', label: 'Volver a esta copia', danger: true }] });
    if (c.btn !== 'yes') return;
    try { toast(await applyRestore('replace', it.s.data)); } catch (e) { await info('Error', 'No se pudo completar. Los datos no se modificaron.'); }
  }

  // ---------- Eventos ----------
  document.addEventListener('click', async (ev) => {
    if (ev.target.closest('#modal-root')) return;
    const el = ev.target.closest('button, li[data-edit]');
    if (!el) return;
    const d = el.dataset;
    if (el.closest('#tabs')) { tab = d.tab; render(); window.scrollTo(0, 0); return; }
    if (el.id === 'fab') return openSheet(null);
    if (d.edit) { const e = expenses.find((x) => x.id === d.edit); if (e) openSheet(e); return; }
    if (sheet && el.closest('.sheet')) {
      if (d.k !== undefined) {
        if (d.k === '⌫') sheet.digits = sheet.digits.slice(0, -1);
        else if ((sheet.digits + d.k).replace(/^0+/, '').length <= 9) sheet.digits = (sheet.digits + d.k).replace(/^0+/, '');
        keepNote(); renderSheet();
      } else if (d.cat !== undefined) { sheet.category = d.cat; keepNote(); renderSheet(); }
      else if (d.m) { sheet.method = d.m; keepNote(); renderSheet(); }
      else if (d.s === 'close') closeSheet();
      else if (d.s === 'save') saveSheet();
      else if (d.s === 'del') deleteSheet();
      return;
    }
    switch (d.act) {
      case 'prev': month = C.shiftMonth(month, -1); render(); break;
      case 'next': month = C.shiftMonth(month, 1); render(); break;
      case 'eye': show = !show; localStorage.setItem('control-show', show ? '1' : '0'); render(); break;
      case 'xlsx': doXlsx(false); break;
      case 'xlsx-all': doXlsx(true); break;
      case 'backup': doBackupPlain(); break;
      case 'backup-enc': doBackupEnc(); break;
      case 'restore': $('#file').click(); break;
      case 'snaps': showSnaps(); break;
      case 'savebudget': {
        settings.budget = parseInt(($('#budget').value || '0').replace(/\D/g, ''), 10) || 0;
        await saveSettings(); toast('Presupuesto guardado'); render(); break;
      }
      case 'addcat': {
        const v = $('#newcat').value.trim();
        if (v && !settings.categories.includes(v)) { settings.categories.push(v); await saveSettings(); render(); }
        break;
      }
    }
    if (d.delcat !== undefined) {
      const c = settings.categories[+d.delcat];
      const r = await ask({ title: 'Quitar categoría', body: '"' + c + '" dejará de aparecer en la lista. Los movimientos existentes conservan su categoría.',
        buttons: [{ id: 'no', label: 'Cancelar' }, { id: 'yes', label: 'Quitar', danger: true }] });
      if (r.btn === 'yes') { settings.categories.splice(+d.delcat, 1); await saveSettings(); render(); }
    }
  });
  function keepNote() { const n = $('#note'); if (n && sheet) sheet.note = n.value; }

  document.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.id === 'file' && t.files[0]) { const f = t.files[0]; t.value = ''; await doRestore(f); }
    if (t.dataset && t.dataset.cat !== undefined && t.closest('#view')) { // renombrar categoría
      const i = +t.dataset.cat, old = settings.categories[i], nu = t.value.trim();
      if (!nu || nu === old) { t.value = old; return; }
      if (settings.categories.includes(nu)) { toast('Esa categoría ya existe'); t.value = old; return; }
      settings.categories[i] = nu;
      const changed = expenses.filter((e) => e.category === old).map((e) => Object.assign({}, e, { category: nu, updatedAt: new Date().toISOString() }));
      for (const e of changed) await dbPut('expenses', e);
      expenses = expenses.map((e) => (e.category === old ? changed.find((c) => c.id === e.id) : e));
      await saveSettings(); toast('Categoría renombrada');
    }
  });

  // ---------- Inicio ----------
  async function init() {
    try {
      db = await openDb();
      await loadAll();
    } catch (e) {
      $('#view').innerHTML = '<div class="card"><b>No se pudo abrir el almacenamiento.</b><p class="dim">Si estás en navegación privada, abre CONTROL en una pestaña normal de Safari e instálala en la pantalla de inicio.</p></div>';
      return;
    }
    render();
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(() => navigator.storage.persisted()).then((p) => { persisted = p; if (tab === 'settings') render(); }).catch(() => {});
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__control = { get expenses() { return expenses; } }; // solo para pruebas
  init();
})();
