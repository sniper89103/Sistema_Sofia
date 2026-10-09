/* ==========================================================
   Sofía · Sistema de ventas — lógica (app.js)
   Datos guardados en el navegador (localStorage).
   ========================================================== */
'use strict';

/* ---------- Constantes y estado ---------- */
const KEY = 'sofia_ventas_v1';
const UNITS = ['kg', 'lb', 'unidad', 'paquete'];
const PALETTE = ['#A3142B', '#E8743B', '#F2B705', '#C9041F', '#5E0A15', '#C98A8F', '#2F6FB5', '#4E8F4A'];
const DEFAULT_CATS = [
  { id: 'c1', name: 'Res', emoji: '🥩' },
  { id: 'c2', name: 'Cerdo', emoji: '🐖' },
  { id: 'c3', name: 'Pollo', emoji: '🍗' },
  { id: 'c4', name: 'Embutidos', emoji: '🌭' },
  { id: 'c5', name: 'Otros', emoji: '🛒' }
];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function defaults() {
  return {
    categories: JSON.parse(JSON.stringify(DEFAULT_CATS)),
    products: [],      // {id, name, catId, unit}
    sales: [],
    counter: 0,
    closures: {},      // cierres de caja por día
    prices: {},        // último precio usado: "catId|nombre|unidad" -> precio
    settings: {
      business: 'Sofía',
      bigSale: 1000,
      dailyGoal: 1500,
      maxDiscount: 20,
      sound: true,
      theme: 'light',
      lastBackup: null,
      goalNotified: '',
      pin: null,            // clave del encargado (se guarda cifrada)
      configVersion: 0,     // versión de config.js ya aplicada en este equipo
      lockVoid: true,       // pedir clave para anular ventas
      lockViews: { historial: false, dashboard: false, reportes: false }
    }
  };
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') {
      const d = defaults();
      return Object.assign(d, raw, { settings: Object.assign(d.settings, raw.settings || {}) });
    }
  } catch (e) { /* datos dañados: se empieza de cero */ }
  return defaults();
}
let S = load();
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
    return true;
  } catch (e) {
    toast('error', 'No se pudo guardar', 'El almacenamiento del navegador está lleno. Haz un respaldo y libera espacio.');
    return false;
  }
}

/* ---------- Utilidades ---------- */
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = arr => arr.reduce((a, b) => a + b, 0);
const pad = (n, l = 2) => String(n).padStart(l, '0');
const money = n => 'Bs ' + (Number(n) || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = n => (Math.round(n * 1000) / 1000).toLocaleString('es-BO', { maximumFractionDigits: 3 });
const dkey = d => { d = new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const fdate = iso => { const d = new Date(iso); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); };
const ftime = iso => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
const fdateKey = k => { const [y, m, d] = k.split('-'); return d + '/' + m + '/' + y; };
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const catById = id => S.categories.find(c => c.id === id);
const catColor = id => { const i = S.categories.findIndex(c => c.id === id); return PALETTE[(i < 0 ? 0 : i) % PALETTE.length]; };
const okSales = () => S.sales.filter(s => s.status !== 'void');
const startOfWeek = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; };
const priceKey = (catId, name, unit) => catId + '|' + name.trim().toLowerCase() + '|' + unit;

/* ---------- Sonido y vibración ---------- */
let audioCtx = null;
function beep(kind) {
  if (!S.settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'error' ? [220, 160] : [660, 880];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.12 + 0.18);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime + i * 0.12); o.stop(audioCtx.currentTime + i * 0.12 + 0.2);
    });
  } catch (e) { /* sin audio */ }
}
function vibrate(p) { try { if (S.settings.sound && navigator.vibrate) navigator.vibrate(p); } catch (e) { } }

/* ---------- Toasts ---------- */
const TOAST_ICONS = { success: '✅', error: '⛔', warn: '⚠️', info: 'ℹ️' };
function toast(type, title, msg = '', ms = 4800) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<span class="t-ico">${TOAST_ICONS[type] || ''}</span><div><b>${esc(title)}</b>${msg ? `<span class="t-msg">${esc(msg)}</span>` : ''}</div>`;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  if (type === 'error') { vibrate([120, 60, 120]); }
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  el.addEventListener('click', kill);
  setTimeout(kill, ms);
}

/* ---------- Modales ---------- */
function modal({ title, body, actions = [], type = '', wide = false, onClose, onOpen }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${type}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn light" data-x aria-label="Cerrar">✕</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-actions"></div></div>`;
  let closed = false;
  const onKey = e => { if (e.key === 'Escape') close(); };
  function close() {
    if (closed) return; closed = true;
    ov.remove(); document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  }
  const bar = $('.modal-actions', ov);
  actions.forEach(a => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn ' + (a.cls || 'ghost'); b.innerHTML = a.label;
    b.addEventListener('click', () => {
      let r;
      if (a.onClick) r = a.onClick(close, ov);
      if (r !== false) close();
    });
    bar.appendChild(b);
  });
  if (!actions.length) bar.remove();
  $('[data-x]', ov).addEventListener('click', close);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  document.addEventListener('keydown', onKey);
  $('#modal-root').appendChild(ov);
  if (onOpen) onOpen(ov, close);
  const first = $('input,select,textarea', ov);
  if (first && !onOpen) setTimeout(() => first.focus(), 60);
  return close;
}
function confirmBox({ title, message, okText = 'Confirmar', danger = false, extra = '', type = '' }) {
  return new Promise(res => {
    modal({
      title, type: type || (danger ? 't-error' : ''),
      body: `<p>${message}</p>${extra}`,
      actions: [
        { label: 'Cancelar', cls: 'ghost', onClick: () => res(false) },
        { label: okText, cls: danger ? 'danger' : 'primary', onClick: () => res(true) }
      ],
      onClose: () => res(false)
    });
  });
}
function promptBox({ title, message, label, placeholder = '', okText = 'Aceptar', danger = false, validate }) {
  return new Promise(res => {
    modal({
      title, type: danger ? 't-error' : '',
      body: `<p>${message}</p><label>${esc(label)}<input id="pb-input" type="text" placeholder="${esc(placeholder)}" autocomplete="off"></label><div id="pb-err" style="margin-top:8px"></div>`,
      actions: [
        { label: 'Cancelar', cls: 'ghost', onClick: () => res(null) },
        {
          label: okText, cls: danger ? 'danger' : 'primary', onClick: () => {
            const v = $('#pb-input').value.trim();
            const err = validate ? validate(v) : (v ? '' : 'Este campo es obligatorio.');
            if (err) { $('#pb-err').innerHTML = alertHTML('error', '', err); $('#pb-input').classList.add('invalid'); vibrate(100); return false; }
            res(v);
          }
        }
      ],
      onClose: () => res(null)
    });
  });
}

/* ---------- Alertas en pantalla ---------- */
function alertHTML(type, title, text, big = '', extraHTML = '') {
  return `<div class="alert ${type}" role="alert"><span class="a-ico">${TOAST_ICONS[type]}</span><div class="a-body">${title ? `<span class="a-title">${esc(title)}</span>` : ''}${big ? `<span class="a-big">${big}</span>` : ''}${text ? `<span>${text}</span>` : ''}${extraHTML}</div></div>`;
}

/* ==========================================================
   CONFIGURACIÓN OFICIAL (config.js): clave + catálogo para todos los celulares
   ========================================================== */
function applyConfig() {
  const C = window.SOFIA_CONFIG;
  if (!C || !C.version || S.settings.configVersion === C.version) return;
  const clone = o => JSON.parse(JSON.stringify(o));
  if (Array.isArray(C.categories) && C.categories.length) S.categories = clone(C.categories);
  if (Array.isArray(C.products)) S.products = clone(C.products);
  if (C.business) S.settings.business = C.business;
  if (C.settings) ['bigSale', 'dailyGoal', 'maxDiscount'].forEach(k => { if (typeof C.settings[k] === 'number') S.settings[k] = C.settings[k]; });
  if (C.pin && C.pin.h) S.settings.pin = clone(C.pin);
  S.settings.configVersion = C.version;
  save();
}
function exportConfig() {
  if (!S.settings.pin) { toast('warn', 'Primero crea la clave', 'La configuración debe llevar la clave del encargado.'); return; }
  const version = Date.now(), now = new Date().toISOString();
  const cfg = {
    version, business: S.settings.business,
    settings: { bigSale: S.settings.bigSale, dailyGoal: S.settings.dailyGoal, maxDiscount: S.settings.maxDiscount },
    pin: S.settings.pin, categories: S.categories, products: S.products
  };
  const txt = `/* Configuración oficial de ${S.settings.business}. Generado el ${fdate(now)} ${ftime(now)}.\n   No lo edites a mano: se genera desde Ajustes -> Publicar para las impulsadoras. */\nwindow.SOFIA_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`;
  S.settings.configVersion = version; save();
  download(new Blob([txt], { type: 'text/javascript;charset=utf-8' }), 'config.js');
  toast('success', 'config.js descargado', `${S.categories.length} categorías y ${S.products.length} productos. Súbelo a GitHub reemplazando el anterior.`, 8000);
}

/* ==========================================================
   CLAVE DEL ENCARGADO (candado contra cambios accidentales)
   ========================================================== */
const UNLOCK_MS = 5 * 60 * 1000;
const LOCK_KEY = 'sofia_lock_v1';
const VIEW_NAMES = { historial: 'Historial', dashboard: 'Dashboard', reportes: 'Reportes', catalogo: 'Catálogo', ajustes: 'Ajustes' };
let unlockedUntil = 0, accessPending = null;
const isUnlocked = () => Date.now() < unlockedUntil;
function touchUnlock() { if (isUnlocked()) unlockedUntil = Date.now() + UNLOCK_MS; }
function lockedViews() {
  const L = S.settings.lockViews || {};
  return ['catalogo', 'ajustes'].concat(['historial', 'dashboard', 'reportes'].filter(v => L[v]));
}
function hashStr(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
function hashPin(v, salt) { let h = v + '|' + salt; for (let i = 0; i < 3000; i++) h = hashStr(h + salt); return h; }
function randomCode(n) {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let out = '';
  try { const b = new Uint8Array(n); crypto.getRandomValues(b); b.forEach(x => { out += A[x % A.length]; }); }
  catch (e) { for (let i = 0; i < n; i++) out += A[Math.floor(Math.random() * A.length)]; }
  return out;
}
const normCode = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const showCode = c => c.slice(0, 4) + '-' + c.slice(4);
function verifyPin(v) { const p = S.settings.pin; return !!p && hashPin(v, p.salt) === p.h; }
function verifyRecovery(v) { const p = S.settings.pin; return !!p && hashPin(normCode(v), p.salt) === p.rh; }
function savePin(pin) {
  const salt = uid() + uid(), rec = randomCode(8);
  S.settings.pin = { salt, h: hashPin(pin, salt), rh: hashPin(rec, salt) };
  save(); return rec;
}
/* intentos fallidos: 3 errores seguidos = espera de 30 s, y se duplica */
function lockState() { try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || { fails: 0, until: 0 }; } catch (e) { return { fails: 0, until: 0 }; } }
function setLockState(st) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(st)); } catch (e) { } }
function waitSeconds() { return Math.max(0, Math.ceil((lockState().until - Date.now()) / 1000)); }
function failAttempt() {
  const st = lockState(); st.fails = (st.fails || 0) + 1;
  if (st.fails >= 3) st.until = Date.now() + Math.min(300, 30 * Math.pow(2, st.fails - 3)) * 1000;
  setLockState(st);
}
function resetFails() { setLockState({ fails: 0, until: 0 }); }

function pinProblem(a, b) {
  if (!/^\d{4,8}$/.test(a)) return 'La clave debe tener entre 4 y 8 números.';
  if (/^(\d)\1+$/.test(a) || ['1234', '12345', '123456', '4321'].includes(a)) return 'Esa clave es muy fácil de adivinar. Elige otra.';
  if (a !== b) return 'Las dos claves no coinciden.';
  return '';
}
const pinInput = (id, label) => `<label>${label}<input id="${id}" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" maxlength="8"></label>`;
function fieldErr(msg) { const e = $('#pin-err'); if (e) e.innerHTML = msg ? alertHTML('error', '', msg) : ''; beep('error'); vibrate([80, 40, 80]); }
function enterToSubmit(ov) {
  $$('input', ov).forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const b = $$('.modal-actions .btn', ov).pop(); if (b) b.click(); } }));
}
function grant(once) {
  if (!once) { unlockedUntil = Date.now() + UNLOCK_MS; toast('success', 'Acceso de encargado', 'Se cierra solo a los 5 minutos o al volver a Vender.'); }
  updateLockUI();
}
function updateLockUI() {
  const u = isUnlocked(), b = $('#btn-lock');
  if (b) { b.textContent = u ? '🔓' : '🔒'; b.title = u ? 'Bloquear ahora' : 'Entrar como encargado'; b.setAttribute('aria-label', b.title); }
  const L = lockedViews();
  $$('#nav button').forEach(x => x.classList.toggle('is-locked', L.includes(x.dataset.view) && !u));
}
function lockNow() {
  unlockedUntil = 0; updateLockUI();
  if (lockedViews().includes(currentView)) showNow('vender');
  toast('info', 'Sistema bloqueado', 'Modo vendedora.');
}
function requireAccess(reason, once = false) {
  if (isUnlocked()) { if (!once) touchUnlock(); return Promise.resolve(true); }
  if (accessPending) return accessPending;
  const p = (S.settings.pin ? askPinModal(reason, once) : setupPinFlow()).finally(() => { accessPending = null; });
  accessPending = p; return p;
}
function askPinModal(reason, once) {
  return new Promise(res => {
    let handoff = false;
    modal({
      title: '🔒 Acceso restringido',
      body: `${alertHTML('warn', 'Solo el encargado puede entrar aquí', `${esc(reason || 'Esta acción necesita la clave del encargado')}. Si no eres el encargado, <b>contáctalo y solicita la clave</b>.`)}<br>${pinInput('pin-in', 'Clave del encargado')}<div id="pin-err" style="margin-top:8px"></div><button type="button" class="link-btn" id="pin-forgot">Olvidé la clave</button>`,
      actions: [
        { label: 'Cancelar', cls: 'ghost', onClick: () => res(false) },
        {
          label: 'Entrar', cls: 'primary', onClick: () => {
            const w = waitSeconds(); if (w > 0) { fieldErr(`Demasiados intentos. Espera ${w} segundos.`); return false; }
            const v = $('#pin-in').value.trim();
            if (!v) { fieldErr('Escribe la clave.'); return false; }
            if (verifyPin(v)) { resetFails(); grant(once); res(true); return; }
            failAttempt();
            const w2 = waitSeconds();
            fieldErr(w2 > 0 ? `Clave incorrecta. Espera ${w2} segundos para volver a intentar.` : 'Clave incorrecta. Intenta de nuevo.');
            $('#pin-in').value = ''; $('#pin-in').focus(); return false;
          }
        }
      ],
      onClose: () => { if (!handoff) res(false); },
      onOpen: (ov, close) => {
        enterToSubmit(ov); setTimeout(() => $('#pin-in', ov).focus(), 60);
        $('#pin-forgot', ov).addEventListener('click', () => { handoff = true; close(); recoverFlow().then(res); });
      }
    });
  });
}
function showRecoveryCode(code) {
  modal({
    title: '🔑 Código de recuperación',
    body: `${alertHTML('warn', 'Guárdalo ahora', 'Este código se muestra una sola vez. Si olvidas la clave, es la única forma de recuperarla. Anótalo y guárdalo en un lugar seguro, lejos de las impulsadoras.')}<div class="recovery-code">${showCode(code)}</div>`,
    actions: [
      { label: '📋 Copiar', cls: 'ghost', onClick: () => { try { navigator.clipboard.writeText(showCode(code)); toast('success', 'Código copiado'); } catch (e) { toast('warn', 'No se pudo copiar', 'Anótalo a mano.'); } return false; } },
      { label: 'Ya lo guardé', cls: 'primary' }
    ]
  });
}
function setupPinFlow() {
  return new Promise(res => {
    let done = false;
    modal({
      title: '🔑 Crear clave del encargado',
      body: `${alertHTML('info', 'Esta clave protege el sistema', 'Se pedirá para entrar a Catálogo y Ajustes y para anular ventas. Solo debe conocerla el encargado, no las impulsadoras.')}<br>${pinInput('pin-a', 'Nueva clave (4 a 8 números)')}<br>${pinInput('pin-b', 'Repite la clave')}<div id="pin-err" style="margin-top:8px"></div>`,
      actions: [
        { label: 'Cancelar', cls: 'ghost', onClick: () => res(false) },
        {
          label: 'Guardar clave', cls: 'primary', onClick: () => {
            const a = $('#pin-a').value.trim(), pr = pinProblem(a, $('#pin-b').value.trim());
            if (pr) { fieldErr(pr); return false; }
            const rec = savePin(a); done = true; grant(false); res(true);
            setTimeout(() => showRecoveryCode(rec), 80);
          }
        }
      ],
      onClose: () => { if (!done) res(false); },
      onOpen: ov => { enterToSubmit(ov); setTimeout(() => $('#pin-a', ov).focus(), 60); }
    });
  });
}
function changePinFlow() {
  modal({
    title: '🔑 Cambiar clave',
    body: `${pinInput('pin-c', 'Clave actual')}<br>${pinInput('pin-a', 'Nueva clave (4 a 8 números)')}<br>${pinInput('pin-b', 'Repite la nueva clave')}<div id="pin-err" style="margin-top:8px"></div>`,
    actions: [
      { label: 'Cancelar', cls: 'ghost' },
      {
        label: 'Cambiar clave', cls: 'primary', onClick: () => {
          const w = waitSeconds(); if (w > 0) { fieldErr(`Demasiados intentos. Espera ${w} segundos.`); return false; }
          if (!verifyPin($('#pin-c').value.trim())) { failAttempt(); fieldErr('La clave actual es incorrecta.'); return false; }
          resetFails();
          const a = $('#pin-a').value.trim(), pr = pinProblem(a, $('#pin-b').value.trim());
          if (pr) { fieldErr(pr); return false; }
          const rec = savePin(a); toast('success', 'Clave cambiada');
          setTimeout(() => showRecoveryCode(rec), 80);
          if (currentView === 'ajustes') renderAjustes();
        }
      }
    ],
    onOpen: ov => { enterToSubmit(ov); setTimeout(() => $('#pin-c', ov).focus(), 60); }
  });
}
function recoverFlow() {
  return new Promise(res => {
    let done = false;
    modal({
      title: '🔑 Recuperar acceso',
      body: `${alertHTML('info', 'Usa tu código de recuperación', 'Es el código de 8 letras y números que se mostró al crear la clave. Sin ese código, la única salida es borrar los datos del navegador (se pierden las ventas que no tengan respaldo).')}<br><label>Código de recuperación<input id="rec-in" class="pin-input" type="text" autocomplete="off" maxlength="9" placeholder="XXXX-XXXX"></label><br>${pinInput('pin-a', 'Nueva clave (4 a 8 números)')}<br>${pinInput('pin-b', 'Repite la nueva clave')}<div id="pin-err" style="margin-top:8px"></div>`,
      actions: [
        { label: 'Cancelar', cls: 'ghost', onClick: () => res(false) },
        {
          label: 'Recuperar', cls: 'primary', onClick: () => {
            const w = waitSeconds(); if (w > 0) { fieldErr(`Demasiados intentos. Espera ${w} segundos.`); return false; }
            if (!verifyRecovery($('#rec-in').value)) { failAttempt(); fieldErr('El código de recuperación no es correcto.'); return false; }
            const a = $('#pin-a').value.trim(), pr = pinProblem(a, $('#pin-b').value.trim());
            if (pr) { fieldErr(pr); return false; }
            resetFails();
            const rec = savePin(a); done = true; grant(false); res(true);
            setTimeout(() => showRecoveryCode(rec), 80);
          }
        }
      ],
      onClose: () => { if (!done) res(false); },
      onOpen: ov => { enterToSubmit(ov); setTimeout(() => $('#rec-in', ov).focus(), 60); }
    });
  });
}
function initLock() {
  $('#btn-lock').addEventListener('click', () => { if (isUnlocked()) lockNow(); else requireAccess('Entrar como encargado'); });
  const bump = () => { if (isUnlocked() && currentView !== 'vender') touchUnlock(); };
  document.addEventListener('pointerdown', bump, true);
  document.addEventListener('keydown', bump, true);
  setInterval(() => {
    if (unlockedUntil && !isUnlocked()) {
      unlockedUntil = 0; updateLockUI();
      if (lockedViews().includes(currentView)) { toast('info', 'Sesión del encargado cerrada', 'Por seguridad, vuelve a ingresar la clave.'); showNow('vender'); }
    }
  }, 10000);
  updateLockUI();
}

/* ---------- Navegación ---------- */
let currentView = 'vender';
async function show(view) {
  if (lockedViews().includes(view) && !isUnlocked()) {
    const ok = await requireAccess(`Para entrar a ${VIEW_NAMES[view]} se necesita la clave del encargado`);
    if (!ok) return;
  }
  if (view === 'vender' && isUnlocked()) { unlockedUntil = 0; updateLockUI(); }
  showNow(view);
}
function showNow(view) {
  currentView = view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.body.classList.toggle('in-sale', view === 'vender');
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  const fn = { vender: refreshSaleForm, historial: renderHistorial, dashboard: renderDashboard, reportes: renderReportes, catalogo: renderCatalogo, ajustes: renderAjustes }[view];
  if (fn) fn();
}

/* ==========================================================
   VENTA
   ========================================================== */
let cart = [];
let lineSeq = 0;
let showErrors = false;

function newLine() {
  return { k: ++lineSeq, catId: (S.categories[0] || {}).id || '', name: '', qty: '1', unit: 'kg', price: '', sub: 0 };
}
function nextId() { return 'V-' + pad(S.counter + 1, 4); }

function catOptions(sel) {
  return '<option value="">Elige categoría…</option>' + S.categories.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.emoji)} ${esc(c.name)}</option>`).join('');
}
/* ----- Ventana para elegir producto (solo productos del catálogo) ----- */
function setLineProduct(l, row, p) {
  l.name = p ? p.name : '';
  if (p) l.unit = p.unit;
  const btn = $('.f-name', row);
  $('.pb-text', btn).textContent = p ? p.name : 'Toca para elegir el producto';
  btn.classList.toggle('has', !!p);
  $('.f-unit', row).value = l.unit;
  $('.u', row).textContent = l.unit;
}
function openProductPicker(l, row) {
  const cat = catById(l.catId);
  if (!cat) { toast('warn', 'Primero elige la categoría', 'Los productos se muestran según la categoría.'); const c = $('.f-cat', row); c.classList.add('invalid'); c.focus(); return; }
  const prods = S.products.filter(p => p.catId === cat.id).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (!prods.length) {
    modal({
      title: `${cat.emoji} ${cat.name}`,
      body: alertHTML('warn', 'Esta categoría no tiene productos', 'Pide al encargado que agregue los productos en la sección Catálogo.'),
      actions: [{ label: 'Cerrar', cls: 'ghost' }, { label: 'Soy el encargado', cls: 'primary', onClick: () => { setTimeout(() => show('catalogo'), 30); } }]
    });
    return;
  }
  const tile = p => {
    const last = S.prices[priceKey(p.catId, p.name, p.unit)];
    return `<button type="button" class="pick-tile ${p.name === l.name ? 'on' : ''}" data-pid="${p.id}" data-n="${esc(p.name.toLowerCase())}">
      <b>${esc(p.name)}</b><small>por ${esc(p.unit)}${last ? ' · último ' + money(last) : ''}</small></button>`;
  };
  modal({
    title: `${cat.emoji} ${cat.name} · elige el producto`, wide: true,
    body: `${prods.length > 6 ? `<input class="pick-search" type="search" placeholder="Buscar producto…" autocomplete="off" aria-label="Buscar producto">` : ''}
      <div class="pick-grid">${prods.map(tile).join('')}</div>
      <div class="pick-none hide">${alertHTML('info', 'Sin resultados', 'Prueba con otra palabra.')}</div>
      <p class="muted tiny" style="margin-top:10px">${prods.length} producto${prods.length > 1 ? 's' : ''} en ${esc(cat.name)}</p>`,
    onOpen: (ov, close) => {
      const grid = $('.pick-grid', ov), none = $('.pick-none', ov), q = $('.pick-search', ov);
      if (q) q.addEventListener('input', () => {
        const t = q.value.trim().toLowerCase(); let n = 0;
        $$('.pick-tile', grid).forEach(b => { const ok = !t || b.dataset.n.includes(t); b.classList.toggle('hide', !ok); if (ok) n++; });
        none.classList.toggle('hide', n > 0);
      });
      grid.addEventListener('click', e => {
        const b = e.target.closest('.pick-tile'); if (!b) return;
        const p = S.products.find(x => x.id === b.dataset.pid); if (!p) return;
        setLineProduct(l, row, p);
        close(); updateTotals();
        const pr = $('.f-price', row); if (pr) setTimeout(() => pr.focus(), 80);
      });
    }
  });
}
function lineHTML(l, i) {
  const cat = catById(l.catId);
  return `<div class="line" data-k="${l.k}" style="--cc:${catColor(l.catId)}">
    <div class="line-head">
      <span class="chip-cat">${cat ? esc(cat.emoji + ' ' + cat.name) : 'Sin categoría'}</span>
      <span class="line-n">Producto ${i + 1}</span>
      <button type="button" class="icon-btn danger" data-act="rm" aria-label="Quitar producto ${i + 1}">✕</button>
    </div>
    <div class="line-grid">
      <label class="w-full">Categoría<select class="f-cat">${catOptions(l.catId)}</select></label>
      <div class="field w-full"><span class="field-lbl">Producto</span>
        <button type="button" class="prod-btn f-name ${l.name ? 'has' : ''}" data-act="pick" aria-haspopup="dialog"><span class="pb-text">${l.name ? esc(l.name) : 'Toca para elegir el producto'}</span><span class="pb-arrow" aria-hidden="true">▾</span></button>
      </div>
      <label>Cantidad<input class="f-qty" type="number" inputmode="decimal" min="0" step="any" value="${esc(l.qty)}"></label>
      <label>Unidad<select class="f-unit">${UNITS.map(u => `<option ${u === l.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
      <label class="w-full"><span>Precio de venta (Bs por <span class="u">${esc(l.unit)}</span>)</span><input class="f-price" type="number" inputmode="decimal" min="0" step="any" value="${esc(l.price)}" placeholder="0.00"></label>
      <div class="line-sub"><span>Subtotal</span><b class="sub-val">Bs 0,00</b></div>
    </div>
    <div class="line-msgs"></div>
  </div>`;
}
function renderLines() {
  $('#lines').innerHTML = cart.map(lineHTML).join('');
  cart.forEach(refreshLine);
  updateTotals();
}

/* Errores que bloquean la venta (siempre se calculan) */
function lineErrors(l) {
  const e = {};
  if (!l.catId) e.cat = 'Elige una categoría.';
  if (!l.name.trim()) e.name = 'Elige un producto de la lista.';
  const q = num(l.qty), p = num(l.price);
  if (String(l.qty).trim() === '') e.qty = 'Escribe la cantidad.';
  else if (q <= 0) e.qty = 'La cantidad debe ser mayor a 0.';
  if (String(l.price).trim() === '') e.price = 'Escribe el precio.';
  else if (p <= 0) e.price = 'El precio debe ser mayor a 0.';
  return e;
}
function lineWarnings(l) {
  const w = [];
  const q = num(l.qty), p = num(l.price);
  if (l.catId && l.name.trim()) {
    const last = S.prices[priceKey(l.catId, l.name, l.unit)];
    if (last) {
      if (p > 0 && (p / last >= 3 || p / last <= 1 / 3)) w.push({ type: 'warn', text: `<b>Precio sospechoso.</b> El último precio de este producto fue ${money(last)} por ${esc(l.unit)} y ahora escribiste ${money(p)}. ¿Seguro?` });
      else if (!String(l.price).trim()) w.push({ type: 'info', text: `Último precio usado: <b>${money(last)}</b> por ${esc(l.unit)}.` });
    }
  }
  if (q > 0 && (l.unit === 'kg' || l.unit === 'lb') && q > 100) w.push({ type: 'warn', text: `<b>Cantidad muy alta:</b> ${qtyFmt(q)} ${esc(l.unit)}. Verifica que sea correcta.` });
  if (q > 0 && l.unit === 'unidad' && q % 1 !== 0) w.push({ type: 'info', text: 'Las unidades suelen ser números enteros.' });
  return w;
}
function refreshLine(l) {
  const el = $(`.line[data-k="${l.k}"]`);
  if (!el) return;
  const errs = lineErrors(l);
  const touchedOnly = (field, val) => showErrors || (String(val).trim() !== '' && field !== 'name');
  const mark = (sel, key, val) => $(sel, el).classList.toggle('invalid', !!errs[key] && touchedOnly(key, val));
  mark('.f-cat', 'cat', 'x'); mark('.f-name', 'name', l.name); mark('.f-qty', 'qty', l.qty); mark('.f-price', 'price', l.price);
  if (!showErrors) {
    // sin intentar cobrar: solo marcar valores ya escritos que estén mal (ej. 0)
    $('.f-cat', el).classList.remove('invalid'); $('.f-name', el).classList.remove('invalid');
  }
  const msgs = [];
  Object.keys(errs).forEach(k => {
    const val = { cat: 'x', name: l.name, qty: l.qty, price: l.price }[k];
    const wrote = String(val).trim() !== '';
    if (showErrors || (wrote && (k === 'qty' || k === 'price'))) msgs.push({ type: 'error', text: errs[k] });
  });
  lineWarnings(l).forEach(w => msgs.push(w));
  $('.line-msgs', el).innerHTML = msgs.map(m => alertHTML(m.type, '', m.text)).join('');
  $('.sub-val', el).textContent = money(l.sub);
  const pw = $('.f-price', el); pw.classList.toggle('warn-field', lineWarnings(l).some(w => w.type === 'warn') && !errs.price);
  $('.u', el).textContent = l.unit;
}

/* Cálculo general de la venta */
function calc() {
  let subtotal = 0; const byCat = {};
  cart.forEach(l => {
    const q = num(l.qty), p = num(l.price);
    l.sub = (q > 0 && p > 0) ? round2(q * p) : 0;
    subtotal += l.sub;
    if (l.sub > 0) byCat[l.catId || 'x'] = round2((byCat[l.catId || 'x'] || 0) + l.sub);
  });
  subtotal = round2(subtotal);
  const dType = $('#s-disc-type').value, dVal = num($('#s-disc').value);
  let disc = dType === 'pct' ? round2(subtotal * dVal / 100) : round2(dVal);
  const issues = [];
  let discOk = true;
  if (dVal < 0) { issues.push({ type: 'error', title: 'Descuento inválido', text: 'El descuento no puede ser negativo.' }); disc = 0; discOk = false; }
  if (dType === 'pct' && dVal > 100) { issues.push({ type: 'error', title: 'Descuento inválido', text: 'El porcentaje no puede pasar de 100 %.' }); discOk = false; }
  if (disc > subtotal && subtotal > 0) { issues.push({ type: 'error', title: 'Descuento mayor al total', text: `El descuento (${money(disc)}) supera el subtotal (${money(subtotal)}).` }); discOk = false; }
  if (disc > 0 && subtotal === 0) { issues.push({ type: 'error', title: 'Descuento sin productos', text: 'Primero agrega productos con precio.' }); discOk = false; }
  const discPct = subtotal > 0 ? disc / subtotal * 100 : 0;
  if (discOk && disc > 0 && discPct > S.settings.maxDiscount) issues.push({ type: 'warn', title: 'Descuento alto', text: `Estás dando ${discPct.toFixed(1)} % de descuento (el límite de aviso es ${S.settings.maxDiscount} %).` });
  const total = round2(Math.max(0, subtotal - (discOk ? disc : 0)));
  if (total >= S.settings.bigSale && total > 0) issues.push({ type: 'info', title: 'Venta grande', text: `Esta venta supera ${money(S.settings.bigSale)}.` });
  return { subtotal, disc: discOk ? disc : 0, discOk, discPct, total, byCat, issues };
}


let lastCalc = null;
function updateTotals() {
  const c = calc(); lastCalc = c;
  cart.forEach(l => { const el = $(`.line[data-k="${l.k}"] .sub-val`); if (el) el.textContent = money(l.sub); });
  $('#sum-count').textContent = cart.filter(l => l.sub > 0).length;
  $('#sum-sub').textContent = money(c.subtotal);
  $('#sum-disc').textContent = '− ' + money(c.disc);
  $('#sum-total').textContent = money(c.total);
  $('#mt-total').textContent = money(c.total);
  $('#next-id').textContent = nextId();
  $('#sum-cats').innerHTML = Object.keys(c.byCat).map(id => {
    const cat = catById(id);
    return `<div style="--cc:${catColor(id)}"><span><i></i>${cat ? esc(cat.emoji + ' ' + cat.name) : 'Sin categoría'}</span><b>${money(c.byCat[id])}</b></div>`;
  }).join('');


  $('#sale-alerts').innerHTML = (S.categories.length === 0 ? alertHTML('error', 'No hay categorías', 'Crea al menos una categoría en la sección Catálogo.') : '') +
    c.issues.map(i => alertHTML(i.type, i.title, i.text)).join('');
  cart.forEach(refreshLine);
}

function refreshSaleForm() {
  if (!cart.length) cart.push(newLine());
  renderLines();
}
function clearSale(silent) {
  cart = [newLine()]; showErrors = false;
  $('#s-client').value = ''; $('#s-notes').value = ''; $('#s-disc').value = '';
  $('#s-disc-type').value = 'bs';
  renderLines();
  if (!silent) toast('info', 'Venta limpiada', 'Puedes empezar una nueva.');
}
function saleHasData() { return cart.some(l => l.name.trim() || num(l.price) > 0); }

function bindSaleForm() {
  const linesEl = $('#lines');
  const getLine = e => { const el = e.target.closest('.line'); return el ? cart.find(l => l.k === +el.dataset.k) : null; };

  linesEl.addEventListener('input', e => {
    const l = getLine(e); if (!l) return;
    const t = e.target;
    if (t.classList.contains('f-qty')) l.qty = t.value;
    else if (t.classList.contains('f-price')) l.price = t.value;
    updateTotals();
  });
  linesEl.addEventListener('change', e => {
    const l = getLine(e); if (!l) return;
    const t = e.target, row = t.closest('.line');
    if (t.classList.contains('f-cat')) {
      l.catId = t.value;
      row.style.setProperty('--cc', catColor(l.catId));
      const cat = catById(l.catId);
      $('.chip-cat', row).textContent = cat ? cat.emoji + ' ' + cat.name : 'Sin categoría';
      if (l.name && !S.products.some(p => p.catId === l.catId && p.name === l.name)) setLineProduct(l, row, null);
    } else if (t.classList.contains('f-unit')) l.unit = t.value;
    updateTotals();
  });
  linesEl.addEventListener('click', e => {
    const pk = e.target.closest('[data-act="pick"]');
    if (pk) { const l = getLine(e); if (l) openProductPicker(l, pk.closest('.line')); return; }
    const b = e.target.closest('[data-act="rm"]'); if (!b) return;
    const l = getLine(e);
    if (cart.length === 1) { cart = [newLine()]; toast('info', 'Producto limpiado', 'La venta necesita al menos un producto.'); }
    else cart = cart.filter(x => x !== l);
    renderLines();
  });

  $('#btn-add-line').addEventListener('click', () => {
    const prev = cart[cart.length - 1];
    const l = newLine(); if (prev && prev.catId) l.catId = prev.catId;
    cart.push(l); renderLines();
    const el = $(`.line[data-k="${l.k}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('#s-disc').addEventListener('input', updateTotals);
  $('#s-disc-type').addEventListener('change', updateTotals);
  $('#btn-clear').addEventListener('click', async () => {
    if (!saleHasData()) return clearSale();
    if (await confirmBox({ title: 'Limpiar venta', message: 'Se borrarán todos los productos de esta venta que aún no guardaste.', okText: 'Sí, limpiar', danger: true })) clearSale();
  });
  $('#btn-confirm').addEventListener('click', trySubmit);
  $('#mt-go').addEventListener('click', () => $('#checkout').scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function trySubmit() {
  showErrors = true;
  const c = calc();
  cart.forEach(refreshLine);
  if (!cart.length || !S.categories.length) { toast('error', 'Venta vacía', 'Agrega al menos un producto.'); beep('error'); return; }
  const bad = cart.find(l => Object.keys(lineErrors(l)).length);
  if (bad) {
    toast('error', 'Revisa los campos en rojo', 'Hay productos con datos incompletos o incorrectos.');
    beep('error');
    const el = $(`.line[data-k="${bad.k}"] .invalid`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); }
    return;
  }
  if (!c.discOk) { toast('error', 'Corrige el descuento', 'Revisa el cuadro de descuento.'); beep('error'); return; }
  if (c.total <= 0) { toast('error', 'Total en cero', 'El total de la venta debe ser mayor a 0.'); beep('error'); return; }

  const warns = [];
  cart.forEach(l => lineWarnings(l).filter(w => w.type === 'warn').forEach(w => warns.push(alertHTML('warn', '', w.text))));
  c.issues.filter(i => i.type === 'warn' || i.title === 'Venta grande').forEach(i => warns.push(alertHTML(i.type, i.title, i.text)));

  const items = cart.map(l => `<div class="it"><span>${esc(l.name)}<small>${esc((catById(l.catId) || {}).name || '')} · ${qtyFmt(num(l.qty))} ${esc(l.unit)} × ${money(num(l.price))}</small></span><b>${money(l.sub)}</b></div>`).join('');
  const body = `<div class="item-list">${items}</div>
    <div class="kv">
      <div><span>Subtotal</span><b>${money(c.subtotal)}</b></div>
      ${c.disc > 0 ? `<div><span>Descuento</span><b>− ${money(c.disc)}</b></div>` : ''}
      <div><span>Total a cobrar</span><b class="big">${money(c.total)}</b></div>
    </div>
    ${warns.length ? `<div class="alert-list">${warns.join('')}</div>` : ''}`;
  modal({
    title: `¿Confirmar venta de ${money(c.total)}?`, body, wide: true,
    actions: [
      { label: 'Volver', cls: 'ghost' },
      { label: '✔ Confirmar venta', cls: 'primary', onClick: () => { recordSale(c); } }
    ]
  });
}

function recordSale(c) {
  const now = new Date();
  S.counter += 1;
  const sale = {
    id: 'V-' + pad(S.counter, 4),
    ts: now.toISOString(),
    items: cart.map(l => {
      const cat = catById(l.catId) || {};
      return { catId: l.catId, catName: cat.name || '', catEmoji: cat.emoji || '', name: l.name.trim(), qty: num(l.qty), unit: l.unit, price: num(l.price), sub: l.sub };
    }),
    subtotal: c.subtotal, discount: c.disc, total: c.total,
    client: $('#s-client').value.trim(), notes: $('#s-notes').value.trim(),
    status: 'ok'
  };
  S.sales.push(sale);
  // recordar el último precio usado (los productos son fijos del catálogo)
  sale.items.forEach(it => {
    S.prices[priceKey(it.catId, it.name, it.unit)] = it.price;
  });
  if (!save()) { S.sales.pop(); S.counter -= 1; return; }

  beep('ok'); vibrate(60);
  toast('success', `Venta ${sale.id} registrada`, `${money(sale.total)} · ${fdate(sale.ts)} ${ftime(sale.ts)}`);
  if (sale.total >= S.settings.bigSale) setTimeout(() => toast('warn', 'Venta grande', `${sale.id} por ${money(sale.total)}.`), 500);
  const today = dkey(now);
  const tTotal = sum(okSales().filter(s => dkey(s.ts) === today).map(s => s.total));
  if (S.settings.dailyGoal > 0 && tTotal >= S.settings.dailyGoal && S.settings.goalNotified !== today) {
    S.settings.goalNotified = today; save();
    setTimeout(() => toast('success', '🎉 ¡Meta del día cumplida!', `Llevas ${money(tTotal)} de ${money(S.settings.dailyGoal)}.`, 7000), 1000);
  }
  clearSale(true);
  showReceipt(sale);
}

function ticketHTML(s) {
  const items = s.items.map(it => `<div>${esc(it.name)}</div><div class="r"><span>${qtyFmt(it.qty)} ${esc(it.unit)} x ${it.price.toFixed(2)}</span><span>${it.sub.toFixed(2)}</span></div>`).join('');
  return `<div class="ticket">
    <h4>${esc(S.settings.business)}</h4><div class="c">Comprobante de venta</div><hr>
    <div class="r"><span>N°</span><b>${s.id}</b></div>
    <div class="r"><span>Fecha</span><span>${fdate(s.ts)}</span></div>
    <div class="r"><span>Hora</span><span>${ftime(s.ts)}</span></div>
    ${s.client ? `<div class="r"><span>Cliente</span><span>${esc(s.client)}</span></div>` : ''}<hr>
    ${items}<hr>
    <div class="r"><span>Subtotal</span><span>${s.subtotal.toFixed(2)}</span></div>
    ${s.discount > 0 ? `<div class="r"><span>Descuento</span><span>-${s.discount.toFixed(2)}</span></div>` : ''}
    <div class="r"><b>TOTAL Bs</b><b>${s.total.toFixed(2)}</b></div><hr>
    <hr><div class="c">¡Gracias por su compra!</div></div>`;
}
function showReceipt(s) {
  modal({
    title: `Venta ${s.id} registrada`, type: 't-ok',
    body: ticketHTML(s),
    actions: [
      { label: '📄 Ticket PDF', cls: 'ghost', onClick: () => { ticketPDF(s); return false; } },
      { label: '➕ Nueva venta', cls: 'primary', onClick: () => { window.scrollTo({ top: 0, behavior: 'smooth' }); } }
    ]
  });
}

/* ==========================================================
   HISTORIAL
   ========================================================== */
const HF = { q: '', date: '', status: 'all' };

function renderHistorial() {
  const el = $('#view-historial');
  el.innerHTML = `
    <div class="page-head"><div><h1>Historial de ventas</h1><p class="muted">Toca una venta para ver todo el detalle.</p></div></div>
    <div class="card"><div class="filters">
      <label class="w-full">Buscar<input id="hf-q" type="search" placeholder="ID, cliente o producto" value="${esc(HF.q)}"></label>
      <label>Fecha<input id="hf-date" type="date" value="${HF.date}"></label>
      <label>Estado<select id="hf-status">
        <option value="all">Todas</option><option value="ok">Válidas</option><option value="void">Anuladas</option></select></label>
    </div></div>
    <div id="hf-sum"></div><div id="hf-list"></div>`;
  $('#hf-status').value = HF.status;
  const upd = () => { HF.q = $('#hf-q').value; HF.date = $('#hf-date').value; HF.status = $('#hf-status').value; renderHistList(); };
  ['#hf-q', '#hf-date', '#hf-status'].forEach(s => $(s).addEventListener('input', upd));
  renderHistList();
}
function renderHistList() {
  const q = HF.q.trim().toLowerCase();
  const list = S.sales.filter(s => {
    if (HF.date && dkey(s.ts) !== HF.date) return false;
    if (HF.status === 'ok' && s.status === 'void') return false;
    if (HF.status === 'void' && s.status !== 'void') return false;
    if (q && !(s.id.toLowerCase().includes(q) || (s.client || '').toLowerCase().includes(q) || s.items.some(i => i.name.toLowerCase().includes(q)))) return false;
    return true;
  }).sort((a, b) => b.ts.localeCompare(a.ts));
  const valid = list.filter(s => s.status !== 'void');
  $('#hf-sum').innerHTML = list.length ? `<div class="alert info" style="margin-bottom:12px"><span class="a-ico">🧾</span><div class="a-body"><span class="a-title">${list.length} ventas · ${valid.length} válidas</span>Total válido: <b>${money(sum(valid.map(s => s.total)))}</b></div></div>` : '';
  if (!list.length) {
    $('#hf-list').innerHTML = `<div class="empty"><span class="e-ico">🧾</span>${S.sales.length ? 'No hay ventas con esos filtros.' : 'Aún no hay ventas. Registra la primera en la pestaña Vender.'}</div>`;
    return;
  }
  const shown = list.slice(0, 150);
  $('#hf-list').innerHTML = shown.map(s => `
    <button class="sale-card ${s.status === 'void' ? 'void' : ''}" data-id="${s.id}">
      <span class="sc-ico">🧾</span>
      <span><span class="sc-id">${s.id}</span> ${s.status === 'void' ? '<span class="badge void">ANULADA</span>' : ''}
        <span class="sc-sub" style="display:block">${fdate(s.ts)} · ${ftime(s.ts)}${s.client ? ' · ' + esc(s.client) : ''}</span>
        <span class="sc-sub" style="display:block">${s.items.length} producto${s.items.length > 1 ? 's' : ''}: ${esc(s.items.slice(0, 2).map(i => i.name).join(', '))}${s.items.length > 2 ? '…' : ''}</span></span>
      <span class="sc-total">${money(s.total)}</span>
    </button>`).join('') + (list.length > shown.length ? `<p class="muted" style="text-align:center">Mostrando las ${shown.length} más recientes. Usa los filtros o Reportes para ver todo.</p>` : '');
  $$('.sale-card', $('#hf-list')).forEach(b => b.addEventListener('click', () => showSaleDetail(b.dataset.id)));
}

function showSaleDetail(id) {
  const s = S.sales.find(x => x.id === id); if (!s) return;
  const items = s.items.map(i => `<div class="it"><span>${esc(i.name)}<small><span class="badge cat" style="--cc:${catColor(i.catId)}">${esc(i.catEmoji + ' ' + i.catName)}</span> ${qtyFmt(i.qty)} ${esc(i.unit)} × ${money(i.price)}</small></span><b>${money(i.sub)}</b></div>`).join('');
  const body = `
    ${s.status === 'void' ? alertHTML('warn', 'Venta anulada', `${fdate(s.voidAt)} ${ftime(s.voidAt)} — Motivo: ${esc(s.voidReason || '')}`) + '<br>' : ''}
    <div class="kv">
      <div><span>ID</span><b>${s.id}</b></div>
      <div><span>Fecha</span><b>${fdate(s.ts)}</b></div>
      <div><span>Hora</span><b>${ftime(s.ts)}</b></div>
      ${s.client ? `<div><span>Cliente</span><b>${esc(s.client)}</b></div>` : ''}
      ${s.notes ? `<div><span>Nota</span><b>${esc(s.notes)}</b></div>` : ''}
    </div>
    <div class="item-list">${items}</div>
    <div class="kv">
      <div><span>Subtotal</span><b>${money(s.subtotal)}</b></div>
      ${s.discount > 0 ? `<div><span>Descuento</span><b>− ${money(s.discount)}</b></div>` : ''}
      <div><span>Total</span><b class="big">${money(s.total)}</b></div>
    </div>`;
  const actions = [{ label: 'Cerrar', cls: 'ghost' }, { label: '📄 Ticket PDF', cls: 'ghost', onClick: () => { ticketPDF(s); return false; } }];
  if (s.status !== 'void') actions.push({ label: 'Anular venta', cls: 'danger', onClick: () => { setTimeout(() => voidSale(s.id), 50); } });
  modal({ title: `Detalle ${s.id}`, body, actions, wide: true });
}
async function voidSale(id) {
  const s = S.sales.find(x => x.id === id); if (!s || s.status === 'void') return;
  if (S.settings.lockVoid !== false && !(await requireAccess('Anular una venta necesita la clave del encargado', true))) return;
  const reason = await promptBox({ title: `Anular ${id}`, message: `Vas a anular una venta de <b>${money(s.total)}</b>. La venta queda registrada como anulada y no cuenta en los totales.`, label: 'Motivo de la anulación', placeholder: 'Ej: Error de precio', okText: 'Anular venta', danger: true });
  if (!reason) return;
  s.status = 'void'; s.voidAt = new Date().toISOString(); s.voidReason = reason;
  if (!save()) { s.status = 'ok'; return; }
  toast('success', `Venta ${id} anulada`, reason);
  const today = dkey(new Date());
  const v = S.sales.filter(x => x.status === 'void' && dkey(x.voidAt || x.ts) === today).length;
  if (v >= 3) setTimeout(() => toast('warn', 'Muchas anulaciones hoy', `Van ${v} ventas anuladas. Revisa si hay errores al registrar.`, 7000), 600);
  if (currentView === 'historial') renderHistList();
}

/* ==========================================================
   ALERTAS DEL NEGOCIO
   ========================================================== */
function computeAlerts() {
  const A = [], now = new Date(), today = dkey(now), h = now.getHours();
  if (!S.settings.pin) A.push({ id: 'nopin', type: 'warn', title: 'Falta la clave del encargado', text: 'Créala antes de entregar el sistema a las impulsadoras. Así quedan protegidos el Catálogo, los Ajustes y la anulación de ventas.', act: 'pin', actLabel: 'Crear clave ahora' });
  const tAll = S.sales.filter(s => dkey(s.ts) === today), tOk = tAll.filter(s => s.status !== 'void');
  const tTotal = sum(tOk.map(s => s.total)), goal = S.settings.dailyGoal;
  if (goal > 0) {
    if (tTotal >= goal) A.push({ id: 'goal-ok', type: 'success', title: 'Meta del día cumplida', text: `Vendiste ${money(tTotal)} de ${money(goal)}.` });
    else if (tOk.length) A.push({ id: 'goal', type: 'info', title: 'Meta del día', text: `Llevas ${money(tTotal)} de ${money(goal)} (${Math.round(tTotal / goal * 100)} %). Faltan ${money(goal - tTotal)}.` });
  }
  const voids = tAll.length - tOk.length;
  if (voids >= 3) A.push({ id: 'voids', type: 'warn', title: 'Muchas ventas anuladas hoy', text: `Hay ${voids} anuladas. Conviene revisar el motivo.` });
  const lb = S.settings.lastBackup, days = lb ? Math.floor((now - new Date(lb)) / 864e5) : null;
  if (S.sales.length && (lb == null || days >= 7)) A.push({ id: 'backup', type: 'warn', title: 'Respaldo pendiente', text: lb ? `Hace ${days} días que no haces un respaldo.` : 'Todavía no hiciste ningún respaldo de tus datos.', act: 'backup', actLabel: 'Hacer respaldo ahora' });
  if (h >= 20 && tOk.length && !S.closures[today]) A.push({ id: 'caja', type: 'warn', title: 'Día sin cerrar', text: 'Ya es tarde y todavía no hiciste el cierre del día.', act: 'caja', actLabel: 'Cerrar el día' });
  if (h >= 8 && h < 20) {
    if (tOk.length) {
      const last = new Date(Math.max(...tOk.map(s => +new Date(s.ts)))), hrs = (now - last) / 36e5;
      if (hrs >= 3) A.push({ id: 'idle', type: 'info', title: 'Hace rato sin ventas', text: `Pasaron ${Math.floor(hrs)} horas desde la última venta.` });
    } else if (h >= 11) A.push({ id: 'idle0', type: 'info', title: 'Aún no hay ventas hoy', text: 'Registra la primera venta del día.' });
  }
  try {
    const kb = (localStorage.getItem(KEY) || '').length * 2 / 1024;
    if (kb > 4000) A.push({ id: 'storage', type: 'error', title: 'Almacenamiento casi lleno', text: `Los datos ocupan unos ${(kb / 1024).toFixed(1)} MB. Haz un respaldo y archiva ventas antiguas.`, act: 'backup', actLabel: 'Hacer respaldo' });
  } catch (e) { }
  return A;
}
const toasted = new Set();
function checkSystemAlerts() {
  computeAlerts().filter(a => ['nopin', 'backup', 'caja', 'voids', 'storage', 'idle'].includes(a.id) && !toasted.has(a.id)).forEach((a, i) => {
    toasted.add(a.id);
    setTimeout(() => toast(a.type, a.title, a.text, 7000), i * 700);
  });
}
function alertAction(act) { if (act === 'backup') exportBackup(); if (act === 'caja') openClosing(); if (act === 'pin') setupPinFlow().then(() => { if (currentView === 'dashboard') renderDashboard(); }); }

/* ==========================================================
   DASHBOARD
   ========================================================== */
let DP = 'hoy';
const DP_LABEL = { hoy: 'Hoy', '7d': '7 días', mes: 'Este mes', todo: 'Todo' };
function inPeriod(s) {
  const d = new Date(s.ts), now = new Date();
  if (DP === 'hoy') return dkey(d) === dkey(now);
  if (DP === '7d') { const x = new Date(now); x.setDate(x.getDate() - 6); x.setHours(0, 0, 0, 0); return d >= x; }
  if (DP === 'mes') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  return true;
}
function renderDashboard() {
  const el = $('#view-dashboard');
  const ok = okSales(), now = new Date(), today = dkey(now);
  const tS = ok.filter(s => dkey(s.ts) === today);
  const wk = startOfWeek(now), wS = ok.filter(s => new Date(s.ts) >= wk);
  const mS = ok.filter(s => { const d = new Date(s.ts); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const tTot = sum(tS.map(s => s.total)), goal = S.settings.dailyGoal;
  const gp = goal > 0 ? Math.min(100, tTot / goal * 100) : 0;
  const alerts = computeAlerts();

  // últimos 7 días
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); days.push({ k: dkey(d), lbl: DAYS[d.getDay()], t: 0 }); }
  ok.forEach(s => { const x = days.find(d => d.k === dkey(s.ts)); if (x) x.t += s.total; });
  const maxD = Math.max(1, ...days.map(d => d.t));

  // periodo seleccionado
  const P = ok.filter(inPeriod);
  const catTot = {}, prod = {}, hours = Array(24).fill(0);
  P.forEach(s => {
    hours[new Date(s.ts).getHours()] += s.total;
    s.items.forEach(i => {
      catTot[i.catId] = catTot[i.catId] || { name: i.catName, emoji: i.catEmoji, t: 0 };
      catTot[i.catId].t += i.sub;
      const pk = i.catId + '|' + i.name.toLowerCase();
      prod[pk] = prod[pk] || { name: i.name, t: 0, q: {} };
      prod[pk].t += i.sub; prod[pk].q[i.unit] = (prod[pk].q[i.unit] || 0) + i.qty;
    });
  });
  const cats = Object.keys(catTot).map(k => ({ id: k, ...catTot[k] })).sort((a, b) => b.t - a.t);
  const catSum = sum(cats.map(c => c.t)) || 1;
  let acc = 0;
  const conic = cats.map(c => { const from = acc / catSum * 100; acc += c.t; return `${catColor(c.id)} ${from}% ${acc / catSum * 100}%`; }).join(',');
  const tops = Object.values(prod).sort((a, b) => b.t - a.t).slice(0, 6);
  const maxP = Math.max(1, ...tops.map(t => t.t));
  const hrs = []; for (let h = 6; h <= 21; h++) hrs.push(h);
  const maxH = Math.max(1, ...hrs.map(h => hours[h]));
  const peak = hours.indexOf(Math.max(...hours));

  el.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><p class="muted">Resumen de ventas válidas (las anuladas no cuentan).</p></div></div>
    ${alerts.length ? `<div class="alert-list">${alerts.map(a => alertHTML(a.type, a.title, esc(a.text), '', a.act ? `<button class="btn ghost sm" data-aa="${a.act}">${a.actLabel}</button>` : '')).join('')}</div>` : ''}
    <div class="kpis">
      <div class="kpi k1"><small>Vendido hoy</small><b>${money(tTot)}</b></div>
      <div class="kpi k2"><small>Esta semana</small><b>${money(sum(wS.map(s => s.total)))}</b></div>
      <div class="kpi k3"><small>Este mes</small><b>${money(sum(mS.map(s => s.total)))}</b></div>
      <div class="kpi k4"><small>Ventas hoy</small><b>${tS.length}</b></div>
      <div class="kpi k5"><small>Ticket promedio hoy</small><b>${money(tS.length ? tTot / tS.length : 0)}</b></div>
      <div class="kpi k6"><small>Anuladas hoy</small><b>${S.sales.filter(s => s.status === 'void' && dkey(s.ts) === today).length}</b></div>
    </div>
    <div class="card"><h2>Meta del día</h2>
      <div class="progress ${gp >= 100 ? 'done' : ''}"><i style="width:${gp}%"></i></div>
      <p class="muted">${goal > 0 ? `${money(tTot)} de ${money(goal)} (${Math.round(gp)} %)` : 'Define una meta en Ajustes.'}</p></div>
    <div class="card"><h2>Ventas de los últimos 7 días</h2>
      <div class="bars">${days.map(d => `<div class="bar-col ${d.k === today ? 'today' : ''}"><span class="bar-val">${d.t ? Math.round(d.t) : ''}</span><div class="bar" style="height:${d.t / maxD * 100 * 0.8}%"></div><span class="bar-lbl">${d.lbl}</span></div>`).join('')}</div></div>

    <div class="seg" role="group" aria-label="Periodo">${Object.keys(DP_LABEL).map(k => `<button data-dp="${k}" class="${k === DP ? 'on' : ''}">${DP_LABEL[k]}</button>`).join('')}</div>
    ${P.length ? `
    <div class="dash-grid">
      <div class="card"><h2>Ventas por categoría</h2>
        <div class="donut-wrap"><div class="donut" style="background:conic-gradient(${conic})"></div>
        <div class="legend">${cats.map(c => `<div><span><i style="background:${catColor(c.id)}"></i>${esc(c.emoji + ' ' + c.name)}</span><b>${money(c.t)} <small class="muted">${Math.round(c.t / catSum * 100)}%</small></b></div>`).join('')}</div></div></div>
      <div class="card"><h2>Productos más vendidos</h2>
        ${tops.map(t => `<div class="hbar"><div class="hbar-top"><span>${esc(t.name)} <small class="muted">${Object.keys(t.q).map(u => qtyFmt(t.q[u]) + ' ' + u).join(' + ')}</small></span><b>${money(t.t)}</b></div><div class="hbar-track"><i style="width:${t.t / maxP * 100}%"></i></div></div>`).join('')}</div>
      <div class="card"><h2>Ventas por hora</h2>
        <div class="bars hours">${hrs.map(h => `<div class="bar-col"><div class="bar" style="height:${hours[h] / maxH * 85}%" title="${h}:00 · ${money(hours[h])}"></div><span class="bar-lbl">${h}</span></div>`).join('')}</div>
        <p class="muted" style="margin-top:8px">${hours[peak] > 0 ? `Hora pico: <b>${peak}:00 a ${peak + 1}:00</b>` : ''}</p></div>
      <div class="card"><h2>Resumen del periodo</h2>
        <div class="kv"><div><span>Ventas</span><b>${P.length}</b></div><div><span>Total vendido</span><b>${money(sum(P.map(s => s.total)))}</b></div><div><span>Ticket promedio</span><b>${money(sum(P.map(s => s.total)) / P.length)}</b></div><div><span>Descuentos dados</span><b>${money(sum(P.map(s => s.discount)))}</b></div></div></div>
    </div>` : `<div class="empty"><span class="e-ico">📊</span>No hay ventas en este periodo.${S.sales.length === 0 ? '<br>Puedes cargar datos de ejemplo en Ajustes para ver cómo se ve.' : ''}</div>`}
    <div class="card" style="margin-top:14px"><h2>Últimas ventas</h2>
      ${S.sales.length ? S.sales.slice(-6).reverse().map(s => `<button class="sale-card ${s.status === 'void' ? 'void' : ''}" data-id="${s.id}"><span class="sc-ico">🧾</span><span><span class="sc-id">${s.id}</span><span class="sc-sub" style="display:block">${fdate(s.ts)} · ${ftime(s.ts)}</span></span><span class="sc-total">${money(s.total)}</span></button>`).join('') : '<p class="muted">Sin ventas todavía.</p>'}</div>`;
  $$('[data-dp]', el).forEach(b => b.addEventListener('click', () => { DP = b.dataset.dp; renderDashboard(); }));
  $$('[data-aa]', el).forEach(b => b.addEventListener('click', () => alertAction(b.dataset.aa)));
  $$('.sale-card', el).forEach(b => b.addEventListener('click', () => showSaleDetail(b.dataset.id)));
}

/* ==========================================================
   REPORTES Y EXPORTACIÓN
   ========================================================== */
const monthStart = () => { const d = new Date(); return dkey(new Date(d.getFullYear(), d.getMonth(), 1)); };
const RF = { from: monthStart(), to: dkey(new Date()), cat: '', q: '', status: 'ok' };

function renderReportes() {
  const el = $('#view-reportes');
  el.innerHTML = `
    <div class="page-head"><div><h1>Reportes</h1><p class="muted">Filtra y descarga en Excel, Word o PDF.</p></div>
      <button class="btn primary" id="btn-caja">🧮 Cierre del día</button></div>
    <div class="card">
      <div class="seg">
        <button data-rg="hoy">Hoy</button><button data-rg="ayer">Ayer</button><button data-rg="semana">Esta semana</button><button data-rg="mes">Este mes</button><button data-rg="todo">Todo</button>
      </div>
      <div class="filters">
        <label>Desde<input type="date" id="rf-from" value="${RF.from}"></label>
        <label>Hasta<input type="date" id="rf-to" value="${RF.to}"></label>
        <label>Categoría<select id="rf-cat"><option value="">Todas</option>${S.categories.map(c => `<option value="${c.id}">${esc(c.emoji + ' ' + c.name)}</option>`).join('')}</select></label>
        <label class="w-full">Producto<input type="search" id="rf-q" placeholder="Ej: pechuga" value="${esc(RF.q)}"></label>
        <label>Estado<select id="rf-status"><option value="ok">Solo válidas</option><option value="all">Con anuladas</option><option value="void">Solo anuladas</option></select></label>
      </div>
      <div class="export-bar">
        <button class="btn xls" data-exp="xls"><span>📗</span>Excel</button>
        <button class="btn doc" data-exp="doc"><span>📘</span>Word</button>
        <button class="btn pdf" data-exp="pdf"><span>📕</span>PDF</button>
      </div>
    </div>
    <div id="rep-out"></div>`;
  $('#rf-cat').value = RF.cat; $('#rf-status').value = RF.status;
  const upd = () => { RF.from = $('#rf-from').value; RF.to = $('#rf-to').value; RF.cat = $('#rf-cat').value; RF.q = $('#rf-q').value; RF.status = $('#rf-status').value; renderReportResults(); };
  ['#rf-from', '#rf-to', '#rf-cat', '#rf-q', '#rf-status'].forEach(s => $(s).addEventListener('input', upd));
  $$('[data-rg]', el).forEach(b => b.addEventListener('click', () => {
    const now = new Date(), t = dkey(now);
    const r = b.dataset.rg;
    if (r === 'hoy') { RF.from = t; RF.to = t; }
    if (r === 'ayer') { const y = new Date(now); y.setDate(y.getDate() - 1); RF.from = RF.to = dkey(y); }
    if (r === 'semana') { RF.from = dkey(startOfWeek(now)); RF.to = t; }
    if (r === 'mes') { RF.from = monthStart(); RF.to = t; }
    if (r === 'todo') { RF.from = ''; RF.to = ''; }
    $('#rf-from').value = RF.from; $('#rf-to').value = RF.to; renderReportResults();
  }));
  $$('[data-exp]', el).forEach(b => b.addEventListener('click', () => doExport(b.dataset.exp)));
  $('#btn-caja').addEventListener('click', openClosing);
  renderReportResults();
}

function buildReport() {
  const f = RF, q = f.q.trim().toLowerCase(), lineFilter = !!(f.cat || q);
  const sales = S.sales.filter(s => {
    const d = dkey(s.ts);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (f.status === 'ok' && s.status === 'void') return false;
    if (f.status === 'void' && s.status !== 'void') return false;
    return true;
  }).sort((a, b) => a.ts.localeCompare(b.ts));
  const lines = [], used = [];
  sales.forEach(s => {
    let any = false;
    s.items.forEach(it => {
      if (f.cat && it.catId !== f.cat) return;
      if (q && !it.name.toLowerCase().includes(q)) return;
      any = true; lines.push({ s, it });
    });
    if (any) used.push(s);
  });
  const live = used.filter(s => s.status !== 'void');
  const liveLines = lines.filter(l => l.s.status !== 'void');
  const total = lineFilter ? round2(sum(liveLines.map(l => l.it.sub))) : round2(sum(live.map(s => s.total)));
  const discount = lineFilter ? 0 : round2(sum(live.map(s => s.discount)));
  const count = live.length;
  const byCat = {}, byDay = {};
  liveLines.forEach(({ s, it }) => {
    const c = byCat[it.catId] = byCat[it.catId] || { name: it.catName, lines: 0, total: 0 };
    c.lines++; c.total = round2(c.total + it.sub);
  });
  live.forEach(s => {
    const d = byDay[dkey(s.ts)] = byDay[dkey(s.ts)] || { n: 0, total: 0 };
    d.n++; d.total = round2(d.total + (lineFilter ? sum(s.items.filter(it => (!f.cat || it.catId === f.cat) && (!q || it.name.toLowerCase().includes(q))).map(i => i.sub)) : s.total));
  });
  const voids = used.filter(s => s.status === 'void');
  const periodText = (f.from ? fdateKey(f.from) : 'inicio') + ' al ' + (f.to ? fdateKey(f.to) : 'hoy');
  const filtersText = [f.cat ? 'Categoría: ' + (catById(f.cat) || {}).name : '', q ? 'Producto: ' + f.q : '', 'Estado: ' + ({ ok: 'solo válidas', all: 'con anuladas', void: 'solo anuladas' })[f.status]].filter(Boolean).join(' · ');
  return {
    count, total, discount, avg: count ? round2(total / count) : 0, lineFilter,
    voidCount: voids.length, voidTotal: round2(sum(voids.map(s => s.total))),
    items: liveLines.length,
    byCat: Object.values(byCat).sort((a, b) => b.total - a.total),
    byDay: Object.keys(byDay).sort().map(k => ({ day: fdateKey(k), n: byDay[k].n, total: byDay[k].total })),
    lines, periodText, filtersText
  };
}
const lineRow = ({ s, it }) => [s.id, fdate(s.ts), ftime(s.ts), it.name, it.catName, it.qty, it.unit, it.price, it.sub, s.status === 'void' ? 'Anulada' : 'Válida', s.client || ''];
const LINE_HEAD = ['ID', 'Fecha', 'Hora', 'Producto', 'Categoría', 'Cantidad', 'Unidad', 'Precio (Bs)', 'Subtotal (Bs)', 'Estado', 'Cliente'];

function renderReportResults() {
  const R = buildReport();
  const out = $('#rep-out');
  if (!R.lines.length) { out.innerHTML = `<div class="empty"><span class="e-ico">🔎</span>No hay datos con estos filtros. Cambia las fechas o quita algún filtro.</div>`; return; }
  const trs = R.lines.slice(0, 300).map(l => { const r = lineRow(l); return `<tr class="${l.s.status === 'void' ? 'void-row' : ''}"><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td><td class="num">${qtyFmt(r[5])}</td><td>${r[6]}</td><td class="num">${r[7].toFixed(2)}</td><td class="num">${r[8].toFixed(2)}</td><td>${r[9]}</td></tr>`; }).join('');
  out.innerHTML = `
    <div class="kpis">
      <div class="kpi k1"><small>Total vendido</small><b>${money(R.total)}</b></div>
      <div class="kpi k2"><small>Ventas</small><b>${R.count}</b></div>
      <div class="kpi k3"><small>Ticket promedio</small><b>${money(R.avg)}</b></div>
      <div class="kpi k4"><small>Descuentos</small><b>${money(R.discount)}</b></div>
      <div class="kpi k5"><small>Productos vendidos</small><b>${R.items}</b></div>
      <div class="kpi k6"><small>Anuladas</small><b>${R.voidCount}</b></div>
    </div>
    <p class="muted" style="margin-bottom:10px">Periodo: <b>${R.periodText}</b> · ${esc(R.filtersText)}</p>
    ${R.lineFilter ? alertHTML('info', 'Filtro por categoría o producto', 'El total suma solo los productos filtrados, sin descuentos.') + '<br>' : ''}
    <div class="dash-grid">
      <div class="card"><h2>Por categoría</h2><div class="table-wrap"><table><thead><tr><th>Categoría</th><th class="num">Líneas</th><th class="num">Total</th></tr></thead><tbody>
        ${R.byCat.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${c.lines}</td><td class="num">${c.total.toFixed(2)}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted tiny" style="margin-top:6px">Totales antes de descuentos.</p></div>
    </div>
    <div class="card"><h2>Por día</h2><div class="table-wrap"><table><thead><tr><th>Día</th><th class="num">Ventas</th><th class="num">Total</th></tr></thead><tbody>
      ${R.byDay.map(c => `<tr><td>${c.day}</td><td class="num">${c.n}</td><td class="num">${c.total.toFixed(2)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h2>Detalle de cada producto vendido</h2>
      <div class="table-wrap table-scroll-y"><table><thead><tr><th>ID</th><th>Fecha</th><th>Hora</th><th>Producto</th><th>Categoría</th><th class="num">Cant.</th><th>Unidad</th><th class="num">Precio</th><th class="num">Subtotal</th><th>Estado</th></tr></thead><tbody>${trs}</tbody></table></div>
      ${R.lines.length > 300 ? `<p class="muted tiny" style="margin-top:6px">Se muestran 300 de ${R.lines.length} líneas. La descarga incluye todas.</p>` : ''}</div>`;
}

/* ----- Exportar ----- */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const fname = ext => `Reporte_${S.settings.business.replace(/\s+/g, '_')}_${dkey(new Date())}.${ext}`;
function doExport(kind) {
  const R = buildReport();
  if (!R.lines.length) { toast('warn', 'No hay datos para descargar', 'Cambia los filtros e inténtalo otra vez.'); beep('error'); return; }
  try {
    if (kind === 'xls') exportExcel(R);
    if (kind === 'doc') exportWord(R);
    if (kind === 'pdf') exportPDF(R);
  } catch (e) {
    console.error(e);
    toast('error', 'No se pudo crear el archivo', 'Detalle: ' + (e.message || e));
  }
}
function summaryRows(R) {
  return [['Ventas válidas', R.count], ['Total vendido (Bs)', R.total], ['Ticket promedio (Bs)', R.avg], ['Descuentos (Bs)', R.discount], ['Productos vendidos (líneas)', R.items], ['Ventas anuladas', R.voidCount], ['Monto anulado (Bs)', R.voidTotal]];
}
function exportExcel(R) {
  if (!window.XLSX) {
    const rows = [LINE_HEAD, ...R.lines.map(lineRow)];
    const csv = '\ufeff' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\n');
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fname('csv'));
    toast('warn', 'Se descargó en CSV', 'No se pudo cargar la librería de Excel (¿sin internet?). El CSV abre en Excel igual.');
    return;
  }
  const wb = XLSX.utils.book_new();
  const mk = (rows, widths) => { const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = widths.map(w => ({ wch: w })); return ws; };
  XLSX.utils.book_append_sheet(wb, mk([[S.settings.business + ' - Reporte de ventas'], ['Periodo', R.periodText], ['Filtros', R.filtersText], [], ['Indicador', 'Valor'], ...summaryRows(R)], [32, 40]), 'Resumen');
  XLSX.utils.book_append_sheet(wb, mk([LINE_HEAD, ...R.lines.map(lineRow)], [9, 12, 10, 26, 14, 10, 9, 12, 14, 10, 18]), 'Detalle');
  XLSX.utils.book_append_sheet(wb, mk([['Categoría', 'Líneas', 'Total (Bs)'], ...R.byCat.map(c => [c.name, c.lines, c.total])], [20, 10, 14]), 'Categorías');
  XLSX.utils.book_append_sheet(wb, mk([['Día', 'Ventas', 'Total (Bs)'], ...R.byDay.map(c => [c.day, c.n, c.total])], [14, 10, 14]), 'Por día');
  XLSX.writeFile(wb, fname('xlsx'));
  toast('success', 'Excel descargado', fname('xlsx'));
}
function reportDocHTML(R) {
  const tbl = (head, rows) => `<table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse;width:100%;font-size:10pt"><tr style="background:#800611;color:#fff">${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
  const f2 = n => Number(n).toFixed(2);
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Reporte</title>
  <style>body{font-family:Calibri,Arial,sans-serif;color:#222}h1{color:#800611;margin-bottom:0}h2{color:#800611;margin-top:18px}@page{size:landscape;margin:1.5cm}</style></head><body>
  <h1>${esc(S.settings.business)} — Reporte de ventas</h1>
  <p>Periodo: <b>${R.periodText}</b><br>${esc(R.filtersText)}<br>Generado: ${fdate(new Date().toISOString())} ${ftime(new Date().toISOString())}</p>
  <h2>Resumen</h2>${tbl(['Indicador', 'Valor'], summaryRows(R).map(r => [r[0], typeof r[1] === 'number' && r[0].includes('Bs') ? f2(r[1]) : r[1]]))}
  <h2>Por categoría</h2>${tbl(['Categoría', 'Líneas', 'Total (Bs)'], R.byCat.map(c => [c.name, c.lines, f2(c.total)]))}
  <h2>Por día</h2>${tbl(['Día', 'Ventas', 'Total (Bs)'], R.byDay.map(c => [c.day, c.n, f2(c.total)]))}
  <h2>Detalle de ventas</h2>${tbl(LINE_HEAD.slice(0, 10), R.lines.map(l => { const r = lineRow(l); return [r[0], r[1], r[2], r[3], r[4], qtyFmt(r[5]), r[6], f2(r[7]), f2(r[8]), r[9]]; }))}
  </body></html>`;
}
function exportWord(R) {
  download(new Blob(['\ufeff', reportDocHTML(R)], { type: 'application/msword;charset=utf-8' }), fname('doc'));
  toast('success', 'Word descargado', fname('doc'));
}
function printHTML(html) {
  const w = window.open('', '_blank');
  if (!w) { toast('warn', 'El navegador bloqueó la ventana', 'Permite ventanas emergentes para imprimir o guardar en PDF.'); return; }
  w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
}
function pdfHeader(doc, title, sub) {
  const W = doc.internal.pageSize.getWidth();
  for (let i = 0; i < 60; i++) {
    const t = i / 59;
    doc.setFillColor(Math.round(134 - 40 * t), Math.round(9 - 3 * t), Math.round(26 - 12 * t));
    doc.rect(W / 60 * i, 0, W / 60 + 0.5, 22, 'F');
  }
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text(title, 12, 13);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(sub, 12, 19);
  doc.setTextColor(40);
}
function exportPDF(R) {
  if (!window.jspdf) {
    printHTML(reportDocHTML(R));
    toast('warn', 'Se abrió la vista de impresión', 'Elige "Guardar como PDF". No se pudo cargar la librería de PDF (¿sin internet?).');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  pdfHeader(doc, S.settings.business + ' — Reporte de ventas', `Periodo: ${R.periodText}   |   ${R.filtersText}`);
  const f2 = n => Number(n).toFixed(2);
  const st = { headStyles: { fillColor: [128, 6, 17] }, styles: { fontSize: 8.5 }, alternateRowStyles: { fillColor: [250, 240, 238] } };
  doc.autoTable({ startY: 28, head: [['Indicador', 'Valor']], body: summaryRows(R).map(r => [r[0], typeof r[1] === 'number' && r[0].includes('Bs') ? f2(r[1]) : String(r[1])]), tableWidth: 110, ...st });
  const y1 = doc.lastAutoTable.finalY;
  doc.autoTable({ startY: 28, margin: { left: 135 }, head: [['Categoría', 'Líneas', 'Total (Bs)']], body: R.byCat.map(c => [c.name, c.lines, f2(c.total)]), tableWidth: 80, ...st });
  const y2 = doc.lastAutoTable.finalY;
  doc.autoTable({
    startY: Math.max(y1, y2) + 8, head: [LINE_HEAD.slice(0, 10)],
    body: R.lines.map(l => { const r = lineRow(l); return [r[0], r[1], r[2], r[3], r[4], qtyFmt(r[5]), r[6], f2(r[7]), f2(r[8]), r[9]]; }), ...st, styles: { fontSize: 7.5 }
  });
  const pages = doc.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(`Página ${i} de ${pages}`, W - 12, H - 6, { align: 'right' }); }
  doc.save(fname('pdf'));
  toast('success', 'PDF descargado', fname('pdf'));
}

/* ----- Ticket PDF (80 mm) ----- */
function drawTicket(doc, s) {
  const W = 80; let y = 10;
  const center = (t, size, bold) => { doc.setFont('courier', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.text(t, W / 2, y, { align: 'center' }); y += size * 0.45; };
  const row = (a, b, bold) => { doc.setFont('courier', bold ? 'bold' : 'normal'); doc.setFontSize(8.5); doc.text(a, 6, y); doc.text(b, W - 6, y, { align: 'right' }); y += 4; };
  const hr = () => { doc.setFontSize(8); doc.text('-'.repeat(38), 6, y); y += 4; };
  center(S.settings.business, 15, true); y += 1;
  center('Comprobante de venta', 8.5); y += 2; hr();
  row('N°', s.id, true); row('Fecha', fdate(s.ts)); row('Hora', ftime(s.ts));
  if (s.client) row('Cliente', s.client.slice(0, 22));
  if (s.status === 'void') row('ESTADO', 'ANULADA', true);
  hr();
  s.items.forEach(it => {
    doc.setFont('courier', 'bold'); doc.setFontSize(8.5);
    doc.splitTextToSize(it.name, 68).forEach(t => { doc.text(t, 6, y); y += 4; });
    row(`${qtyFmt(it.qty)} ${it.unit} x ${it.price.toFixed(2)}`, it.sub.toFixed(2));
  });
  hr();
  row('Subtotal', s.subtotal.toFixed(2));
  if (s.discount > 0) row('Descuento', '-' + s.discount.toFixed(2));
  row('TOTAL Bs', s.total.toFixed(2), true); hr();
  y += 2; center('¡Gracias por su compra!', 9, true);
  return y + 8;
}
function ticketPDF(s) {
  if (!window.jspdf) { printHTML(`<html><body style="font-family:monospace">${ticketHTML(s)}</body></html>`); return; }
  const { jsPDF } = window.jspdf;
  const h = drawTicket(new jsPDF({ unit: 'mm', format: [80, 600] }), s);
  const doc = new jsPDF({ unit: 'mm', format: [80, Math.max(h, 60)] });
  drawTicket(doc, s);
  doc.save(`Ticket_${s.id}.pdf`);
  toast('success', 'Ticket descargado', s.id);
}

/* ----- Cierre del día ----- */
function openClosing() {
  const today = dkey(new Date());
  const ts = okSales().filter(s => dkey(s.ts) === today);
  const total = round2(sum(ts.map(s => s.total)));
  const byCat = {};
  ts.forEach(s => s.items.forEach(i => { const c = byCat[i.catId] = byCat[i.catId] || { name: i.catName, total: 0 }; c.total = round2(c.total + i.sub); }));
  const cats = Object.values(byCat).sort((a, b) => b.total - a.total);
  const prev = S.closures[today];
  if (!ts.length) { toast('info', 'Hoy no hay ventas', 'Cuando registres ventas podrás cerrar el día.'); return; }
  modal({
    title: 'Cierre del día', wide: true,
    body: `${prev ? alertHTML('info', 'Ya cerraste el día', `A las ${ftime(prev.ts)} con ${money(prev.total)}. Si cierras otra vez, se reemplaza.`) + '<br>' : ''}
      <div class="kv">
        <div><span>Fecha</span><b>${fdateKey(today)}</b></div>
        <div><span>Ventas válidas</span><b>${ts.length}</b></div>
        ${cats.map(c => `<div><span>${esc(c.name)}</span><b>${money(c.total)}</b></div>`).join('')}
        <div><span>Total anotado del día</span><b class="big">${money(total)}</b></div>
      </div>`,
    actions: [
      { label: 'Cancelar', cls: 'ghost' },
      {
        label: 'Cerrar el día y descargar PDF', cls: 'primary', onClick: () => {
          S.closures[today] = { ts: new Date().toISOString(), count: ts.length, total, cats };
          if (!save()) return false;
          toast('success', 'Día cerrado', `Total del día ${money(total)}`);
          closingPDF(today);
        }
      }
    ]
  });
}
function closingPDF(day) {
  const c = S.closures[day]; if (!c) return;
  const rows = [['Fecha', fdateKey(day)], ['Hora de cierre', ftime(c.ts)], ['Ventas válidas', String(c.count)], ...c.cats.map(k => [k.name, k.total.toFixed(2) + ' Bs']), ['TOTAL DEL DÍA', c.total.toFixed(2) + ' Bs']];
  if (!window.jspdf) { printHTML(`<html><body style="font-family:sans-serif"><h2>${esc(S.settings.business)} — Cierre del día</h2><table border="1" cellpadding="6" style="border-collapse:collapse">${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table></body></html>`); return; }
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'mm', format: 'a4' });
  pdfHeader(doc, S.settings.business + ' — Cierre del día', fdateKey(day));
  doc.autoTable({ startY: 30, head: [['Concepto', 'Valor']], body: rows, headStyles: { fillColor: [128, 6, 17] }, alternateRowStyles: { fillColor: [250, 240, 238] }, tableWidth: 120 });
  doc.save(`Cierre_${day}.pdf`);
}

/* ==========================================================
   CATÁLOGO
   ========================================================== */
function renderCatalogo() {
  const el = $('#view-catalogo');
  const cnt = id => S.products.filter(p => p.catId === id).length;
  el.innerHTML = `
    <div class="page-head"><div><h1>Catálogo</h1><p class="muted">Productos fijos por categoría. El precio se escribe a mano en cada venta.</p></div></div>
    <div class="grid-2">
      <div class="card"><h2>Categorías</h2>
        ${S.categories.map(c => `<div class="list-row" style="border-left:6px solid ${catColor(c.id)}"><span class="emoji">${esc(c.emoji)}</span><div class="lr-main"><b>${esc(c.name)}</b><span class="muted tiny">${cnt(c.id)} productos</span></div><button class="icon-btn" data-ec="${c.id}" aria-label="Editar ${esc(c.name)}">✏️</button><button class="icon-btn danger" data-dc="${c.id}" aria-label="Eliminar ${esc(c.name)}">🗑️</button></div>`).join('') || '<div class="empty">Aún no hay categorías.</div>'}
        <button class="btn primary" id="add-cat" style="width:100%;margin-top:6px">＋ Nueva categoría</button></div>
      <div class="card"><h2>Productos</h2>
        ${S.categories.map(c => { const ps = S.products.filter(p => p.catId === c.id).sort((a, b) => a.name.localeCompare(b.name)); return ps.length ? `<p class="muted" style="margin:8px 0 4px"><b>${esc(c.emoji + ' ' + c.name)}</b></p>` + ps.map(p => `<div class="list-row"><div class="lr-main"><b>${esc(p.name)}</b><span class="muted tiny">Se vende por ${esc(p.unit)}${S.prices[priceKey(p.catId, p.name, p.unit)] ? ' · último precio ' + money(S.prices[priceKey(p.catId, p.name, p.unit)]) : ''}</span></div><button class="icon-btn" data-ep="${p.id}" aria-label="Editar ${esc(p.name)}">✏️</button><button class="icon-btn danger" data-dp2="${p.id}" aria-label="Eliminar ${esc(p.name)}">🗑️</button></div>`).join('') : ''; }).join('') || ''}
        ${S.products.length ? '' : '<div class="empty">Aún no hay productos. Agrégalos aquí: son los que aparecerán al vender.</div>'}
        <button class="btn primary" id="add-prod" style="width:100%;margin-top:6px">＋ Nuevo producto</button></div>
    </div>`;
  $('#add-cat').addEventListener('click', () => catForm());
  $('#add-prod').addEventListener('click', () => prodForm());
  $$('[data-ec]', el).forEach(b => b.addEventListener('click', () => catForm(b.dataset.ec)));
  $$('[data-dc]', el).forEach(b => b.addEventListener('click', () => deleteCat(b.dataset.dc)));
  $$('[data-ep]', el).forEach(b => b.addEventListener('click', () => prodForm(b.dataset.ep)));
  $$('[data-dp2]', el).forEach(b => b.addEventListener('click', () => deleteProd(b.dataset.dp2)));
}
function catForm(id) {
  const c = id ? catById(id) : { name: '', emoji: '🥩' };
  modal({
    title: id ? 'Editar categoría' : 'Nueva categoría',
    body: `<div class="row2"><label>Nombre<input id="cf-name" value="${esc(c.name)}" maxlength="30" placeholder="Ej: Res"></label><label>Emoji<input id="cf-emoji" value="${esc(c.emoji)}" maxlength="4"></label></div><div id="cf-err" style="margin-top:8px"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, {
      label: 'Guardar', cls: 'primary', onClick: () => {
        const name = $('#cf-name').value.trim(), emoji = $('#cf-emoji').value.trim() || '🛒';
        if (!name) { $('#cf-err').innerHTML = alertHTML('error', '', 'Escribe el nombre de la categoría.'); $('#cf-name').classList.add('invalid'); return false; }
        if (S.categories.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) { $('#cf-err').innerHTML = alertHTML('error', '', 'Ya existe una categoría con ese nombre.'); return false; }
        if (id) { c.name = name; c.emoji = emoji; } else S.categories.push({ id: 'c' + uid(), name, emoji });
        if (save()) { toast('success', id ? 'Categoría actualizada' : 'Categoría creada', name); renderCatalogo(); }
      }
    }]
  });
}
async function deleteCat(id) {
  const c = catById(id), n = S.products.filter(p => p.catId === id).length, vs = S.sales.filter(s => s.items.some(i => i.catId === id)).length;
  const extra = (n || vs) ? alertHTML('warn', 'Ojo', `${n ? `Tiene ${n} producto(s) que también se eliminarán. ` : ''}${vs ? `Aparece en ${vs} venta(s); el historial conserva su nombre.` : ''}`) : '';
  if (!await confirmBox({ title: `¿Eliminar "${esc(c.name)}"?`, message: 'Esta acción no se puede deshacer.', extra, okText: 'Eliminar', danger: true })) return;
  S.categories = S.categories.filter(x => x.id !== id); S.products = S.products.filter(p => p.catId !== id);
  if (save()) { toast('success', 'Categoría eliminada', c.name); renderCatalogo(); }
}
function prodForm(id) {
  if (!S.categories.length) { toast('warn', 'Primero crea una categoría', 'Los productos van dentro de una categoría.'); return; }
  const p = id ? S.products.find(x => x.id === id) : { name: '', catId: S.categories[0].id, unit: 'kg' };
  modal({
    title: id ? 'Editar producto' : 'Nuevo producto',
    body: `<label>Nombre<input id="pf-name" value="${esc(p.name)}" maxlength="60" placeholder="Ej: Pechuga de pollo"></label>
      <div class="row2" style="margin-top:10px"><label>Categoría<select id="pf-cat">${S.categories.map(c => `<option value="${c.id}" ${c.id === p.catId ? 'selected' : ''}>${esc(c.emoji + ' ' + c.name)}</option>`).join('')}</select></label>
      <label>Se vende por<select id="pf-unit">${UNITS.map(u => `<option ${u === p.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label></div><div id="pf-err" style="margin-top:8px"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, {
      label: 'Guardar', cls: 'primary', onClick: () => {
        const name = $('#pf-name').value.trim(), catId = $('#pf-cat').value, unit = $('#pf-unit').value;
        if (!name) { $('#pf-err').innerHTML = alertHTML('error', '', 'Escribe el nombre del producto.'); $('#pf-name').classList.add('invalid'); return false; }
        if (S.products.some(x => x.id !== id && x.catId === catId && x.name.toLowerCase() === name.toLowerCase())) { $('#pf-err').innerHTML = alertHTML('error', '', 'Ese producto ya existe en la categoría.'); return false; }
        if (id) Object.assign(p, { name, catId, unit }); else S.products.push({ id: uid(), name, catId, unit });
        if (save()) { toast('success', id ? 'Producto actualizado' : 'Producto creado', name); renderCatalogo(); }
      }
    }]
  });
}
async function deleteProd(id) {
  const p = S.products.find(x => x.id === id);
  if (!await confirmBox({ title: `¿Eliminar "${esc(p.name)}"?`, message: 'Las ventas ya registradas no cambian.', okText: 'Eliminar', danger: true })) return;
  S.products = S.products.filter(x => x.id !== id);
  if (save()) { toast('success', 'Producto eliminado', p.name); renderCatalogo(); }
}

/* ==========================================================
   AJUSTES Y RESPALDO
   ========================================================== */
function renderAjustes() {
  const el = $('#view-ajustes'), st = S.settings;
  const kb = Math.round((localStorage.getItem(KEY) || '').length * 2 / 1024);
  el.innerHTML = `
    <div class="page-head"><div><h1>Ajustes</h1><p class="muted">Estos valores controlan las alertas. Puedes cambiarlos cuando quieras.</p></div></div>
    <div class="grid-2">
      <div class="card"><h2>Negocio y alertas</h2>
        <label>Nombre del negocio<input id="st-name" value="${esc(st.business)}" maxlength="40"></label>
        <div class="row2" style="margin-top:10px">
          <label>Venta grande desde (Bs)<input id="st-big" type="number" inputmode="decimal" min="0" value="${st.bigSale}"></label>
          <label>Meta diaria (Bs)<input id="st-goal" type="number" inputmode="decimal" min="0" value="${st.dailyGoal}"></label>
          <label>Avisar descuento mayor a (%)<input id="st-disc" type="number" inputmode="decimal" min="0" max="100" value="${st.maxDiscount}"></label>
        </div>
        <div class="switch-row"><span>Sonido y vibración en alertas</span><input id="st-sound" type="checkbox" ${st.sound ? 'checked' : ''}></div>
        <button class="btn primary" id="st-save" style="width:100%">Guardar ajustes</button></div>
      <div class="card"><h2>Seguridad</h2>
        <p class="muted" style="margin-bottom:10px">Clave del encargado: <b>${st.pin ? 'creada ✔' : 'sin crear'}</b>. Siempre se pide para entrar a Catálogo y Ajustes. Se vuelve a pedir tras 5 minutos sin usar o al volver a Vender.</p>
        <div class="switch-row"><span>Pedir clave para anular ventas</span><input id="sec-void" type="checkbox" ${st.lockVoid !== false ? 'checked' : ''}></div>
        <p class="muted tiny" style="margin:8px 0 2px">También pedir clave para entrar a:</p>
        ${['historial', 'dashboard', 'reportes'].map(v => `<div class="switch-row"><span>${VIEW_NAMES[v]}</span><input type="checkbox" data-lv="${v}" ${(st.lockViews || {})[v] ? 'checked' : ''}></div>`).join('')}
        <div class="btn-row" style="margin-top:8px"><button class="btn primary" id="sec-pin">🔑 ${st.pin ? 'Cambiar clave' : 'Crear clave'}</button><button class="btn ghost" id="sec-lock">🔒 Bloquear ahora</button></div></div>
      <div class="card"><h2>Publicar para las impulsadoras</h2>
        <p class="muted" style="margin-bottom:10px">Los celulares toman de un archivo <b>config.js</b> la clave del encargado, las categorías y los productos. Cuando cambies algo de eso aquí, descarga el archivo y súbelo a GitHub reemplazando el anterior. <b>Estado:</b> ${st.pin ? 'listo para publicar' : 'primero crea la clave'}.</p>
        <button class="btn primary" id="cfg-export" style="width:100%">⬇ Descargar config.js</button></div>
      <div class="card"><h2>Respaldo de datos</h2>
        <p class="muted" style="margin-bottom:10px">Tus datos viven en este navegador (${kb} KB usados). Haz respaldos seguido y guarda el archivo en un lugar seguro.${st.lastBackup ? `<br>Último respaldo: <b>${fdate(st.lastBackup)} ${ftime(st.lastBackup)}</b>` : '<br><b>Aún no hiciste ningún respaldo.</b>'}</p>
        <div class="btn-row"><button class="btn primary" id="bk-export">💾 Crear respaldo</button><button class="btn ghost" id="bk-import">📂 Importar respaldo</button></div></div>
      <div class="card"><h2>Datos de prueba</h2>
        <p class="muted" style="margin-bottom:10px">Carga ventas de ejemplo para ver cómo luce el dashboard y los reportes. Reemplaza lo que tengas ahora.</p>
        <button class="btn ghost" id="bk-sample">🧪 Cargar datos de ejemplo</button></div>
      <div class="card"><h2>Borrar todo</h2>
        <p class="muted" style="margin-bottom:10px">Elimina ventas, productos y ajustes de este navegador. Haz un respaldo antes.</p>
        <button class="btn danger" id="bk-reset">🗑️ Borrar todos los datos</button></div>
    </div>`;
  $('#st-save').addEventListener('click', () => {
    const name = $('#st-name').value.trim(), big = num($('#st-big').value), goal = num($('#st-goal').value), disc = num($('#st-disc').value);
    if (!name) return toast('error', 'Falta el nombre', 'Escribe el nombre del negocio.');
    if (big < 0 || goal < 0 || disc < 0 || disc > 100) return toast('error', 'Valores inválidos', 'Los montos no pueden ser negativos y el descuento va de 0 a 100.');
    Object.assign(S.settings, { business: name, bigSale: big, dailyGoal: goal, maxDiscount: disc, sound: $('#st-sound').checked });
    if (save()) { applyBrand(); toast('success', 'Ajustes guardados'); }
  });
  $('#bk-export').addEventListener('click', exportBackup);
  $('#bk-import').addEventListener('click', () => $('#file-import').click());
  $('#bk-sample').addEventListener('click', loadSample);
  $('#bk-reset').addEventListener('click', resetAll);
  $('#sec-void').addEventListener('change', e => { S.settings.lockVoid = e.target.checked; if (save()) toast('success', 'Guardado', e.target.checked ? 'Anular ventas pedirá clave.' : 'Anular ventas ya no pedirá clave.'); });
  $$('[data-lv]', el).forEach(c => c.addEventListener('change', () => { S.settings.lockViews = Object.assign({ historial: false, dashboard: false, reportes: false }, S.settings.lockViews, { [c.dataset.lv]: c.checked }); if (save()) { updateLockUI(); toast('success', 'Guardado', `${VIEW_NAMES[c.dataset.lv]} ${c.checked ? 'pedirá clave' : 'ya no pedirá clave'}.`); } }));
  $('#sec-pin').addEventListener('click', () => { if (S.settings.pin) changePinFlow(); else setupPinFlow().then(() => renderAjustes()); });
  $('#sec-lock').addEventListener('click', lockNow);
  $('#cfg-export').addEventListener('click', exportConfig);
}
function exportBackup() {
  S.settings.lastBackup = new Date().toISOString(); save();
  download(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }), `Respaldo_${S.settings.business.replace(/\s+/g, '_')}_${dkey(new Date())}.json`);
  toast('success', 'Respaldo creado', 'Guarda el archivo en un lugar seguro.');
  if (currentView === 'ajustes') renderAjustes();
}
function importBackup(file) {
  const fr = new FileReader();
  fr.onload = async () => {
    try {
      const d = JSON.parse(fr.result);
      if (!d || !Array.isArray(d.categories) || !Array.isArray(d.sales)) throw new Error('El archivo no parece un respaldo de este sistema.');
      if (!await confirmBox({ title: 'Importar respaldo', message: `El respaldo tiene <b>${d.sales.length} ventas</b> y <b>${d.categories.length} categorías</b>. Esto <b>reemplaza todos los datos actuales</b>.`, okText: 'Reemplazar datos', danger: true })) return;
      const base = defaults(), keepPin = S.settings.pin; S = Object.assign(base, d, { settings: Object.assign(base.settings, d.settings || {}) }); if (keepPin) S.settings.pin = keepPin;
      if (save()) { applyBrand(); applyTheme(); toast('success', 'Respaldo importado', `${S.sales.length} ventas recuperadas.`); cart = []; show('ajustes'); }
    } catch (e) { toast('error', 'No se pudo importar', e.message || 'Archivo dañado.'); beep('error'); }
  };
  fr.readAsText(file);
}
async function resetAll() {
  const v = await promptBox({ title: 'Borrar todos los datos', message: 'Se borrará <b>todo</b> y no se puede deshacer. Para confirmar escribe <b>BORRAR</b>.', label: 'Escribe BORRAR', okText: 'Borrar todo', danger: true, validate: t => t === 'BORRAR' ? '' : 'Debes escribir BORRAR en mayúsculas.' });
  if (v !== 'BORRAR') return;
  const keepPin = S.settings.pin; S = defaults(); S.settings.pin = keepPin; save(); cart = []; applyBrand(); applyTheme();
  toast('success', 'Datos borrados', 'El sistema quedó como nuevo.'); show('ajustes');
}
async function loadSample() {
  if (S.sales.length && !await confirmBox({ title: 'Cargar datos de ejemplo', message: 'Esto reemplaza tus ventas actuales por datos inventados.', okText: 'Reemplazar', danger: true })) return;
  const fresh = defaults(); fresh.settings = S.settings; S = fresh;
  const cat = n => S.categories.find(c => c.name === n);
  const cat0 = {
    Res: [['Lomo', 'kg', 75], ['Costilla de res', 'kg', 55], ['Carne molida', 'kg', 60]],
    Cerdo: [['Chuleta', 'kg', 48], ['Costilla de cerdo', 'kg', 42]],
    Pollo: [['Pollo entero', 'kg', 18], ['Pechuga', 'kg', 28], ['Alitas', 'kg', 24]],
    Embutidos: [['Chorizo', 'kg', 45], ['Salchicha', 'paquete', 18]],
    Otros: [['Carbón', 'unidad', 25], ['Chimichurri', 'unidad', 12]]
  };
  const pool = [];
  Object.keys(cat0).forEach(cn => cat0[cn].forEach(([name, unit, price]) => { const c = cat(cn); S.products.push({ id: uid(), name, catId: c.id, unit }); pool.push({ c, name, unit, price }); S.prices[priceKey(c.id, name, unit)] = price; }));
  const rnd = (a, b) => a + Math.random() * (b - a), now = new Date();
  for (let d = 13; d >= 0; d--) {
    const n = d === 0 ? 4 : Math.round(rnd(5, 10));
    for (let i = 0; i < n; i++) {
      const dt = new Date(now); dt.setDate(now.getDate() - d); dt.setHours(Math.round(rnd(8, d === 0 ? Math.max(8, now.getHours()) : 19)), Math.floor(rnd(0, 59)), Math.floor(rnd(0, 59)));
      if (dt > now) continue;
      const items = Array.from({ length: Math.round(rnd(1, 3)) }, () => {
        const p = pool[Math.floor(rnd(0, pool.length))];
        const qty = p.unit === 'kg' ? Math.round(rnd(0.5, 4) * 4) / 4 : Math.round(rnd(1, 3));
        const price = round2(p.price * rnd(0.95, 1.08));
        return { catId: p.c.id, catName: p.c.name, catEmoji: p.c.emoji, name: p.name, qty, unit: p.unit, price, sub: round2(qty * price) };
      });
      const subtotal = round2(sum(items.map(i => i.sub))), discount = Math.random() < 0.12 ? round2(subtotal * 0.05) : 0, total = round2(subtotal - discount);
      S.counter++;
      S.sales.push({ id: 'V-' + pad(S.counter, 4), ts: dt.toISOString(), items, subtotal, discount, total, client: '', notes: '', status: Math.random() < 0.03 ? 'void' : 'ok', voidReason: 'Error de precio', voidAt: dt.toISOString() });
    }
  }
  S.sales.sort((a, b) => a.ts.localeCompare(b.ts)).forEach((s, i) => { s.id = 'V-' + pad(i + 1, 4); }); S.counter = S.sales.length;
  if (save()) { cart = []; toast('success', 'Datos de ejemplo cargados', `${S.sales.length} ventas de los últimos 14 días.`); show('dashboard'); }
}

/* ==========================================================
   ARRANQUE
   ========================================================== */
function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme;
  $('#btn-theme').textContent = S.settings.theme === 'dark' ? '☀️' : '🌙';
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = S.settings.theme === 'dark' ? '#4F060D' : '#86091A';
}
function applyBrand() {
  $('#brand-name').textContent = S.settings.business;
  document.title = S.settings.business + ' · Sistema de ventas';
}
function tickClock() {
  const n = new Date(), iso = n.toISOString();
  $('#clock-time').textContent = ftime(iso);
  $('#clock-date').textContent = DAYS[n.getDay()] + ' ' + fdate(iso);
  const sc = $('#sale-clock'); if (sc) sc.textContent = fdate(iso) + ' ' + ftime(iso);
}
function boot() {
  applyConfig(); applyTheme(); applyBrand(); bindSaleForm(); initLock();
  $$('#nav button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  $('#btn-theme').addEventListener('click', () => { S.settings.theme = S.settings.theme === 'dark' ? 'light' : 'dark'; save(); applyTheme(); });
  $('#file-import').addEventListener('change', e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
  window.addEventListener('beforeunload', e => { if (currentView === 'vender' && saleHasData()) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('offline', () => toast('warn', 'Sin conexión a internet', 'Puedes seguir vendiendo. Excel y PDF pueden no funcionar hasta que vuelva la conexión.', 7000));
  window.addEventListener('online', () => toast('success', 'Conexión recuperada'));
  tickClock(); setInterval(tickClock, 1000);
  show('vender');
  setTimeout(checkSystemAlerts, 1500);
  setInterval(checkSystemAlerts, 5 * 60 * 1000);
  if (!navigator.onLine) toast('warn', 'Sin conexión a internet', 'Puedes seguir vendiendo.');
}
document.addEventListener('DOMContentLoaded', boot);
