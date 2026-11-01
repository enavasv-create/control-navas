/* CONTROL - cifrado local de respaldos con contraseña.
 * PBKDF2-SHA256 (600.000 iteraciones) -> AES-256-GCM. Solo WebCrypto del navegador: sin servicios ni librerías externas.
 * La contraseña no se guarda en ninguna parte. Sin la contraseña el respaldo no se puede recuperar. */
(function (root) {
  'use strict';
  const FORMAT = 'control-backup-enc';
  const VERSION = 1;
  const ITER = 600000;
  const te = new TextEncoder();
  const td = new TextDecoder();
  const AAD = te.encode('control-backup-enc:1');

  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    const bin = atob(s);
    const o = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
    return o;
  }
  async function deriveKey(password, salt, iterations) {
    const base = await root.crypto.subtle.importKey('raw', te.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return root.crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  function isEncrypted(text) {
    try { const o = JSON.parse(text); return !!o && o.format === FORMAT; } catch (e) { return false; }
  }

  async function encryptText(plain, password) {
    const salt = root.crypto.getRandomValues(new Uint8Array(16));
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITER);
    const ct = new Uint8Array(await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, te.encode(plain)));
    return JSON.stringify({
      format: FORMAT, version: VERSION, kdf: 'PBKDF2-SHA256', iterations: ITER,
      cipher: 'AES-256-GCM', salt: b64(salt), iv: b64(iv), data: b64(ct),
    });
  }

  // -> { ok:true, text } | { ok:false, error:'FORMAT'|'PASSWORD' }
  async function decryptText(fileText, password) {
    let o;
    try { o = JSON.parse(fileText); } catch (e) { return { ok: false, error: 'FORMAT' }; }
    if (!o || o.format !== FORMAT || o.version !== VERSION || typeof o.salt !== 'string' ||
      typeof o.iv !== 'string' || typeof o.data !== 'string' ||
      !Number.isInteger(o.iterations) || o.iterations < 100000 || o.iterations > 5000000) {
      return { ok: false, error: 'FORMAT' };
    }
    try {
      const key = await deriveKey(password, unb64(o.salt), o.iterations);
      const pt = await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv), additionalData: AAD }, key, unb64(o.data));
      return { ok: true, text: td.decode(pt) };
    } catch (e) {
      return { ok: false, error: 'PASSWORD' };
    }
  }

  const api = { isEncrypted, encryptText, decryptText, FORMAT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Vault = api;
})(typeof window !== 'undefined' ? window : globalThis);
