/* CONTROL - lógica pura (sin DOM, sin base de datos). Probable en Node. */
(function (root) {
  'use strict';

  const METHODS = [
    { id: 'debito', name: 'Débito' },
    { id: 'visa', name: 'Visa' },
    { id: 'mastercard', name: 'Mastercard' },
    { id: 'transferencia', name: 'Transferencia' },
    { id: 'efectivo', name: 'Efectivo' },
  ];
  const DEFAULT_CATEGORIES = [
    'Supermercado', 'Almacén', 'Restaurante', 'Farmacia', 'Transporte',
    'Hogar', 'Servicios', 'Salud', 'Educación', 'Entretenimiento', 'Otros',
  ];

  const pad = (n) => String(n).padStart(2, '0');

  function methodName(id) {
    const m = METHODS.find((x) => x.id === id);
    return m ? m.name : id;
  }

  // $12.345 (pesos chilenos, sin decimales, separador de miles con punto)
  function formatMoney(n) {
    const neg = n < 0;
    const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-$' : '$') + s;
  }

  function monthKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }

  function dateStr(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function timeStr(ts) {
    const d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function inMonth(expenses, key) {
    return expenses.filter((e) => monthKey(e.ts) === key)
      .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  }

  function totals(list) {
    const total = list.reduce((s, e) => s + e.amount, 0);
    const byCategory = {};
    const byMethod = {};
    for (const e of list) {
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
      byMethod[e.method] = (byMethod[e.method] || 0) + e.amount;
    }
    return { total, byCategory, byMethod };
  }

  function sortedEntries(obj) {
    return Object.entries(obj).sort((a, b) => b[1] - a[1]);
  }

  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }

  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return MONTHS[m - 1] + ' ' + y;
  }

  function newId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ¿Hay un movimiento idéntico registrado hace menos de `secs` segundos?
  function findRecentDuplicate(expenses, cand, nowTs, secs) {
    const now = new Date(nowTs).getTime();
    return expenses.find((e) =>
      e.id !== cand.id && e.amount === cand.amount && e.category === cand.category &&
      e.method === cand.method && Math.abs(now - new Date(e.ts).getTime()) < secs * 1000);
  }

  // ---- Respaldo ----
  const BACKUP_FORMAT = 'control-backup';
  const BACKUP_VERSION = 1;

  function makeBackup(expenses, settings, nowIso) {
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: nowIso,
      count: expenses.length,
      total: expenses.reduce((s, e) => s + e.amount, 0),
      settings: { budget: settings.budget, categories: settings.categories },
      expenses: expenses,
    };
  }

  // Devuelve {ok, error, data}. Valida estructura y cifras de control.
  function parseBackup(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { return { ok: false, error: 'El archivo no es un respaldo válido (JSON ilegible).' }; }
    if (!o || o.format !== BACKUP_FORMAT) return { ok: false, error: 'El archivo no es un respaldo de CONTROL.' };
    if (typeof o.version !== 'number' || o.version > BACKUP_VERSION) return { ok: false, error: 'Versión de respaldo no soportada.' };
    if (!Array.isArray(o.expenses)) return { ok: false, error: 'Respaldo sin movimientos.' };
    const methods = METHODS.map((m) => m.id);
    for (const e of o.expenses) {
      if (!e || typeof e.id !== 'string' || !Number.isFinite(e.amount) || e.amount <= 0 ||
        typeof e.ts !== 'string' || isNaN(new Date(e.ts).getTime()) ||
        typeof e.category !== 'string' || !methods.includes(e.method)) {
        return { ok: false, error: 'El respaldo contiene movimientos dañados. No se importó nada.' };
      }
    }
    const sum = o.expenses.reduce((s, e) => s + e.amount, 0);
    if (o.count !== o.expenses.length || o.total !== sum) {
      return { ok: false, error: 'Las cifras de control no coinciden: el respaldo está incompleto o alterado.' };
    }
    return { ok: true, data: o };
  }

  // Mezcla por id: agrega los que faltan; si el id existe, gana el más reciente (updatedAt).
  function mergeExpenses(current, incoming) {
    const map = new Map(current.map((e) => [e.id, e]));
    let added = 0, updated = 0;
    for (const e of incoming) {
      const cur = map.get(e.id);
      if (!cur) { map.set(e.id, e); added++; }
      else if ((e.updatedAt || e.ts) > (cur.updatedAt || cur.ts)) { map.set(e.id, e); updated++; }
    }
    return { expenses: Array.from(map.values()), added, updated };
  }

  const api = {
    METHODS, DEFAULT_CATEGORIES, methodName, formatMoney, monthKey, dateStr, timeStr,
    inMonth, totals, sortedEntries, shiftMonth, monthLabel, newId, findRecentDuplicate,
    makeBackup, parseBackup, mergeExpenses,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
