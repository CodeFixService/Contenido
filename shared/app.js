/* CodeFix · núcleo compartido: conexión, sesión, campanita en vivo, push,
   imágenes, fechas y utilidades. */
(function (global) {
  'use strict';
  const cfg = global.BT_CONFIG;
  const sb = global.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cc-auth', detectSessionInUrl: true }
  });
  const ROOT = (() => {
    const s = document.querySelector('script[src*="shared/app.js"]');
    return s ? s.src.replace(/shared\/app\.js.*$/, '') : location.origin + '/';
  })();

  /* ---------- Utilidades ---------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plata = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL');
  const numero = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^\d-]/g, '')); return isFinite(n) ? n : 0; };
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const fechaDe = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const sumarDias = (s, n) => { const d = fechaDe(s); d.setDate(d.getDate() + n); return iso(d); };
  const hoy = () => iso(new Date());
  const fCorta = (s) => s ? fechaDe(s).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const fLarga = (s) => s ? fechaDe(s).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  const fHora = (t) => t ? new Date(t).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const hace = (t) => {
    if (!t) return 'nunca';
    const m = Math.round((Date.now() - new Date(t)) / 60000);
    if (m < 2) return 'recién'; if (m < 60) return 'hace ' + m + ' min';
    const h = Math.round(m / 60); if (h < 24) return 'hace ' + h + ' h';
    const d = Math.round(h / 24); return d < 60 ? 'hace ' + d + ' días' : fHora(t);
  };
  const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const telNorm = (t) => { let d = String(t || '').replace(/\D/g, ''); if (d.length === 9 && d[0] === '9') d = '56' + d; if (d.length === 8) d = '569' + d; return d; };
  const wa = (tel, txt) => 'https://wa.me/' + telNorm(tel) + (txt ? '?text=' + encodeURIComponent(txt) : '');
  const estrellas = (n) => { n = Math.round(Number(n) || 0); return '★'.repeat(n) + '☆'.repeat(5 - n); };
  const nota = (o) => o && o.total ? '<span class="stars">★ ' + String(o.promedio).replace('.', ',') + '</span> <span class="sub">(' + o.total + ')</span>' : '<span class="sub">Sin calificaciones</span>';

  let toastT;
  function toast(msg) {
    let el = $('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // Diálogo simple: contenido HTML; devuelve el <dialog> (se borra al cerrar).
  function modal(html, onReady) {
    const d = document.createElement('dialog');
    d.innerHTML = '<div class="card">' + html + '</div>';
    document.body.appendChild(d);
    d.addEventListener('close', () => setTimeout(() => d.remove(), 50));
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.querySelectorAll('[data-cerrar]').forEach((b) => { b.onclick = () => d.close(); });
    d.showModal();
    if (onReady) onReady(d);
    return d;
  }
  function confirmar(msg, si) {
    return new Promise((ok) => {
      const d = modal('<p style="margin:0 0 6px;white-space:pre-line">' + esc(msg) + '</p><div class="btns"><button class="ghost" data-no>Cancelar</button><button data-si>' + esc(si || 'Sí, continuar') + '</button></div>');
      let r = false;
      d.querySelector('[data-si]').onclick = () => { r = true; d.close(); };
      d.querySelector('[data-no]').onclick = () => d.close();
      d.addEventListener('close', () => ok(r));
    });
  }

  function friendly(err) {
    const m = String((err && (err.message || err.error_description)) || err || '');
    if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos';
    if (/Email not confirmed/i.test(m)) return 'Confirma tu correo (revisa tu bandeja y spam)';
    if (/already registered|already been registered/i.test(m)) return 'Ese correo ya tiene cuenta. Inicia sesión.';
    if (/Password should be/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres';
    if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera unos minutos.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión. Revisa tu internet.';
    if (/Could not find the function|schema cache|does not exist/i.test(m)) return 'Falta instalar la base de datos: corre supabase/instalar.sql en Supabase → SQL Editor (guía, paso 1).';
    if (/Database error saving new user/i.test(m)) return 'No se pudo crear la cuenta. Intenta de nuevo o escribe a soporte.';
    return m.replace(/^\w*Error:\s*/, '') || 'Error';
  }
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw new Error(friendly(error));
    return data;
  }
  async function q(p) {
    const { data, error } = await p;
    if (error) throw new Error(friendly(error));
    return data;
  }

  /* ---------- Configuración pública y textos ---------- */
  let publica = null;
  try { publica = JSON.parse(localStorage.getItem('bt:publica')); } catch (e) { publica = null; }
  async function cargarPublica() {
    try { publica = await rpc('config_publica'); localStorage.setItem('bt:publica', JSON.stringify(publica)); } catch (e) { /* usa la copia */ }
    return publica || { config: {}, textos: {}, planes: {} };
  }
  function txt(clave, vars) {
    let s = (publica && publica.textos && publica.textos[clave]) || '';
    Object.keys(vars || {}).forEach((k) => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }

  /* ---------- Sesión ---------- */
  let cuenta = null;
  try { cuenta = JSON.parse(localStorage.getItem('bt:cuenta')); } catch (e) { cuenta = null; }
  async function refrescar() {
    const { data } = await sb.auth.getSession();
    if (!data.session) { cuenta = null; localStorage.removeItem('bt:cuenta'); return null; }
    try {
      cuenta = await rpc('mi_cuenta');
      if (cuenta) localStorage.setItem('bt:cuenta', JSON.stringify(cuenta));
    } catch (e) {
      if (!/Sin conexión/.test(e.message)) throw e;
    }
    if (cuenta) sb.rpc('registrar_visto').then(() => {}, () => {});
    return cuenta;
  }
  const destino = (c) => !c ? 'index.html' : 'app/';
  // Úsalo al abrir cada panel: sin sesión o con otro rol, vuelve al inicio.
  async function requerir(roles) {
    let c = null;
    try { c = await refrescar(); } catch (e) { c = cuenta; }
    if (!c) { location.replace(ROOT + 'index.html?volver=' + encodeURIComponent(location.pathname + location.hash)); return new Promise(() => {}); }
    if (c.suspendido) { document.body.innerHTML = '<main><div class="card"><h2>Cuenta suspendida</h2><p class="muted">Contacta al administrador.</p><button onclick="App.salir()">Salir</button></div></main>'; return new Promise(() => {}); }
    if (roles && !roles.includes(c.rol)) { location.replace(ROOT + destino(c)); return new Promise(() => {}); }
    // Núcleo (ayuda.js): cabecera común [campana][FREE/PRO][foto], menú de la cuenta, ayuda y sensación Premium.
    const enAdmin = /\/admin\//.test(location.pathname);
    window.CFX_AYUDA_PEND = Object.assign(window.CFX_AYUDA_PEND || {}, { rpc, app: 'contenido', admin: c.rol !== 'usuario', socio: c.rol === 'socio', premium: !!c.premium, id: c.id, hasta: c.premium_hasta,
      nombre: c.nombre, email: c.email, salir,
      cuenta: () => window.CC && window.CC.ir('empresa') }); // el botón ⇄ Panel (Centro de Mando) lo pone el núcleo
    if (window.CFX_AYUDA) window.CFX_AYUDA.iniciar(window.CFX_AYUDA_PEND);
    return c;
  }
  async function entrar(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(friendly(error));
    const c = await refrescar();
    if (!c) throw new Error('Tu cuenta no tiene perfil. Contacta al administrador.');
    sincronizarPush();
    return c;
  }
  async function salir() {
    try { const s = await subActual(); if (s) await sb.rpc('push_quitar', { p_endpoint: s.endpoint }); } catch (e) { /* sin red */ }
    try { await sb.auth.signOut(); } catch (e) { /* sin red */ }
    cuenta = null; localStorage.removeItem('bt:cuenta');
    location.replace(ROOT + 'index.html');
  }
  // Registro abierto: la persona crea su cuenta con correo y contraseña (días de prueba Pro según config).
  async function registrar(email, password, nombre) {
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { data: { nombre: String(nombre || '').trim() } } });
    if (error) throw new Error(friendly(error));
    if (!data.session) return { confirmar: true };
    await refrescar(); sincronizarPush();
    return { confirmar: false };
  }
  // Cuentas creadas desde el panel (socios y usuarios): las crea el servidor.
  async function crearCuenta(d) {
    // Si la función no responde en 40 s, avisa en vez de quedar cargando.
    const espera = new Promise((_, no) => setTimeout(() => no(new Error('La función "servidor" no respondió. Revisa en Supabase → Edge Functions que "servidor" esté desplegada (guía, paso 4).')), 40000));
    const { data, error } = await Promise.race([sb.functions.invoke('servidor', { body: Object.assign({ accion: 'crear_cuenta' }, d) }), espera]);
    if (error) {
      let det = '';
      try { det = await error.context.text(); } catch (e) { /* sin detalle */ }
      throw new Error('No se pudo conectar con la función "servidor". Revisa que esté creada en Supabase (guía, paso 4).' + (det ? ' ' + det.slice(0, 120) : ''));
    }
    if (!data || !data.ok) throw new Error((data && data.error) || 'No se pudo crear la cuenta');
    return data;
  }
  function clave() {
    const L = 'abcdefghjkmnpqrstuvwxyz', r = crypto.getRandomValues(new Uint32Array(9));
    const l = (i) => L[r[i] % L.length], n = (i) => String(r[i] % 10);
    return l(0).toUpperCase() + l(1) + l(2) + n(3) + n(4) + n(5) + n(6) + l(7) + l(8);
  }
  function mensajeAcceso(d) {
    return 'Hola ' + d.nombre + '\nTe creamos tu cuenta en ' + (d.lugar || 'Cerebro') + '.\n\nEntra aquí e instala la app: ' + ROOT +
      '\nCorreo: ' + d.email + '\nContraseña: ' + d.password + '\n\nCambia tu contraseña en "Mi cuenta" la primera vez que entres.';
  }

  function descargar(dataUrl, nombre) {
    const a = document.createElement('a');
    a.href = dataUrl; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  }
  function verImagen(dataUrl, titulo, nombreArchivo) {
    const d = modal('<h2>' + esc(titulo || 'Comprobante') + '</h2><div class="comprobante"><img alt="Comprobante" src="' + dataUrl + '"></div>' +
      '<div class="btns"><button class="ghost" data-cerrar>Cerrar</button><button data-bajar>⬇️ Descargar</button></div>');
    d.querySelector('[data-bajar]').onclick = () => descargar(dataUrl, nombreArchivo || 'comprobante.jpg');
    return d;
  }

  /* ---------- Íconos de línea (SVG fijos, sin datos del usuario) ---------- */
  const IC = {
    resumen: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    apps: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    usuarios: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.7c2 .6 3.5 2.3 3.5 5.3"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.7A8 8 0 1 1 21 12z"/>',
    pagos: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
    planes: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    ajustes: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    registro: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    casa: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
    campana: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/>',
    diana: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    billetera: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2M7 6V4.5A1.5 1.5 0 0 1 8.5 3H17"/>',
    bolsa: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
    tijeras: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1L20 20M8.1 15.9L20 4"/>',
    bici: '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-8h5l3 8M10 8l2 8M14 5h3"/>',
    auto: '<path d="M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7 19v1M17 19v1M7 13h1M16 13h1"/>',
    copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    abrir: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    cohete: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3-1 6-1 6-1s0 3-1 6l-7 7-5-5zM9 11l-3-1-2 2 4 1M13 15l1 3-2 2-1-4"/>',
    enchufe: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5"/>',
    refrescar: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
  };
  const ico = (n, s) => '<svg class="ic" width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[n] || '') + '</svg>';
  // Pone los íconos en los elementos con data-ico (menús fijos en el HTML).
  const ponerIconos = (raiz) => (raiz || document).querySelectorAll('[data-ico]').forEach((n) => { n.innerHTML = ico(n.dataset.ico, Number(n.dataset.tam) || 22); });

  /* ---------- Campanita (avisos dentro de la app, en vivo) ---------- */
  let avisos = [], canal = null;
  async function campana(btn) {
    if (!btn || !cuenta) return;
    btn.innerHTML = ico('campana', 20) + '<span class="badge hidden"></span>';
    btn.setAttribute('aria-label', 'Avisos');
    const badge = btn.querySelector('.badge');
    async function cargar() {
      try { avisos = await q(sb.from('notificaciones').select('*').order('created_at', { ascending: false }).limit(60)); } catch (e) { return; }
      const n = avisos.filter((a) => !a.leida).length;
      badge.textContent = n > 99 ? '99+' : n; badge.classList.toggle('hidden', !n);
      document.dispatchEvent(new CustomEvent('bt:avisos', { detail: n }));
    }
    btn.onclick = () => {
      const d = modal('<div style="display:flex;align-items:center;gap:8px"><h2 style="flex:1;margin:0">🔔 Avisos</h2><button class="small ghost" data-cerrar>Cerrar</button></div>' +
        '<div id="btAvisos" style="max-height:65vh;overflow:auto;margin-top:6px">' + (avisos.length ? avisos.map((a) =>
          '<div class="notif' + (a.leida ? '' : ' nueva') + '" data-url="' + esc(a.url) + '" style="position:relative;padding-right:34px"><b>' + esc(a.titulo) + '</b><div class="sub">' + esc(a.cuerpo) + '</div><div class="sub">' + hace(a.created_at) + '</div>' +
          '<button type="button" class="small ghost" data-quitar="' + a.id + '" aria-label="Borrar aviso" style="position:absolute;top:6px;right:4px;padding:2px 8px;min-height:0">✕</button></div>').join('')
          : '<p class="empty">Sin avisos por ahora.</p>') + '</div>' +
        (avisos.length ? '<div class="btns"><button class="small ghost" data-borrar>Borrar todos</button></div><p class="sub">Los avisos se borran solos a los 30 días.</p>' : '') + '<div id="btPush"></div>');
      d.querySelector('#btAvisos').onclick = async (e) => {
        const q1 = e.target.closest('[data-quitar]');
        if (q1) { e.stopPropagation(); q1.parentNode.remove(); await sb.from('notificaciones').delete().eq('id', q1.dataset.quitar); cargar(); return; }
        const n = e.target.closest('[data-url]'); if (!n || !n.dataset.url) return;
        d.close(); irA(n.dataset.url);
      };
      const bb = d.querySelector('[data-borrar]');
      if (bb) bb.onclick = async () => { if (!(await confirmar('¿Borrar todos tus avisos?', 'Borrar'))) return; await sb.from('notificaciones').delete().eq('para', cuenta.id); d.close(); cargar(); };
      ofrecerPush(d.querySelector('#btPush'));
      const ids = avisos.filter((a) => !a.leida).map((a) => a.id);
      if (ids.length) sb.from('notificaciones').update({ leida: true }).in('id', ids).then(() => cargar());
    };
    await cargar();
    insistirPush();
    if (canal) sb.removeChannel(canal);
    canal = sb.channel('avisos-' + cuenta.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones', filter: 'para=eq.' + cuenta.id }, (p) => {
        toast('🔔 ' + (p.new && p.new.titulo || 'Nuevo aviso'));
        cargar();
      })
      .subscribe();
    // Si la app estuvo en segundo plano, refresca al volver.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) cargar(); });
  }
  function irA(url) {
    if (/^https?:/.test(url)) { location.href = url; return; }
    const destinoUrl = ROOT + url.replace(/^\//, '');
    const a = new URL(destinoUrl, location.href), b = new URL(location.href);
    if (a.pathname === b.pathname && a.search === b.search) { location.hash = a.hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }
    else location.href = destinoUrl;
  }

  /* ---------- Push (notificaciones con la app cerrada) ---------- */
  const pushSoportado = () => 'serviceWorker' in navigator && 'PushManager' in global && 'Notification' in global;
  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
  async function subActual() {
    if (!pushSoportado() || Notification.permission !== 'granted') return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg && reg.pushManager ? reg.pushManager.getSubscription() : null;
  }
  async function activarPush() {
    if (!pushSoportado()) {
      throw new Error(/iPhone|iPad/.test(navigator.userAgent) ? 'En iPhone primero instala la app: Compartir → "Agregar a inicio" y ábrela desde ahí.'
        : 'Este navegador no permite notificaciones');
    }
    const p = await cargarPublica();
    const pub = p.config && p.config.vapid_publica;
    if (!pub) throw new Error('El administrador aún no activa las notificaciones');
    if (await Notification.requestPermission() !== 'granted') throw new Error('Permiso de notificaciones denegado');
    const reg = await navigator.serviceWorker.ready;
    const key = b64(pub);
    let s = await reg.pushManager.getSubscription();
    if (s) {
      const cur = s.options && s.options.applicationServerKey ? new Uint8Array(s.options.applicationServerKey) : null;
      if (!cur || cur.length !== key.length || cur.some((x, i) => x !== key[i])) { await s.unsubscribe(); s = null; }
    }
    if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const j = s.toJSON();
    await rpc('push_guardar', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    return true;
  }
  async function sincronizarPush() {
    try { const s = await subActual(); if (!s) return; const j = s.toJSON(); await rpc('push_guardar', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }); } catch (e) { /* nada */ }
  }
  const pushListo = () => !!(publica && publica.config && publica.config.vapid_publica);
  async function ofrecerPush(el) {
    if (!el || !pushListo()) return; // sin claves de push configuradas no se ofrece
    if (await subActual()) { el.innerHTML = '<p class="sub" style="margin-top:10px">✅ Notificaciones activas en este celular.</p>'; return; }
    el.innerHTML = '<div class="aviso" style="margin-top:12px"><div class="grow">📲 Activa las notificaciones para enterarte aunque tengas la app cerrada.</div>' +
      '<button class="small" type="button">Activar</button></div>';
    el.querySelector('button').onclick = async () => {
      try { await activarPush(); toast('✅ Notificaciones activadas'); ofrecerPush(el); } catch (e) { toast(e.message); }
    };
  }

  /* ---------- Notificaciones: insistir hasta que se activen ---------- */
  async function insistirPush() {
    if (!cuenta || sessionStorage.getItem('bt:pushPedido')) return;
    if (!(publica && publica.config && publica.config.vapid_publica)) return; // sin claves de push configuradas no se ofrece
    if (await subActual()) return;
    sessionStorage.setItem('bt:pushPedido', '1');
    const ios = /iPhone|iPad/.test(navigator.userAgent), instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const negado = 'Notification' in global && Notification.permission === 'denied';
    const msg = ios && !instalada ? 'Para recibir avisos en iPhone: toca Compartir → "Agregar a inicio" y abre la app desde ese ícono.'
      : negado ? 'Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador (candado junto a la dirección → Notificaciones → Permitir).'
      : 'Actívalas para recibir tus pedidos, recordatorios de publicación y avisos.';
    const d = modal('<h2>🔔 Activa las notificaciones</h2><p class="muted" style="margin-top:0">' + esc(msg) + '</p><div class="btns"><button class="ghost" data-cerrar>Ahora no</button>' +
      (!negado && !(ios && !instalada) ? '<button id="btPushSi">Activar</button>' : '') + '</div>');
    const b = d.querySelector('#btPushSi');
    if (b) b.onclick = async () => { try { await activarPush(); toast('✅ Notificaciones activadas'); d.close(); } catch (e) { toast(e.message); } };
  }

  // Admin o socio (con motivo): borra una cuenta y todos sus datos (lo hace el servidor).
  async function borrarCuenta(id, motivo) {
    const { data, error } = await sb.functions.invoke('servidor', { body: { accion: 'borrar', id, motivo: motivo || '' } });
    if (error) throw new Error('No se pudo conectar con la función "servidor".');
    if (!data || !data.ok) throw new Error((data && data.error) || 'No se pudo borrar');
    return data;
  }
  // Cada persona borra su propia cuenta y todos sus datos.
  async function borrarMiCuenta() {
    const { data, error } = await sb.functions.invoke('servidor', { body: { accion: 'borrar_mia' } });
    if (error) throw new Error('No se pudo conectar con la función "servidor".');
    if (!data || !data.ok) throw new Error((data && data.error) || 'No se pudo borrar');
    try { await sb.auth.signOut(); } catch (e) { /* sin red */ }
    cuenta = null; localStorage.removeItem('bt:cuenta');
    return data;
  }

  /* ---------- App instalable ---------- */
  function registrarSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register(ROOT + 'sw.js', { scope: ROOT }).then((r) => r.update()).catch(() => {});
  }
  let instalar = null;
  global.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); instalar = e; document.dispatchEvent(new Event('bt:instalable')); });
  async function pedirInstalar() { if (!instalar) return false; instalar.prompt(); await instalar.userChoice; instalar = null; return true; }

  /* ---------- Versión nueva: solo cuando el administrador la libera ---------- */
  // Cada celular usa su versión guardada hasta que hay una versión liberada (Administración → Versiones) más nueva:
  // entonces se actualiza sola. Solo si la suya ya es demasiado antigua (version_min) se muestra la ventana obligatoria.
  const mayor = (a, b) => {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };
  const versionMenor = (a, b) => mayor(b, a);
  let avisada = false;
  async function revisarVersion() {
    if (avisada || document.hidden) return;
    const c = ((await cargarPublica()) || {}).config || {};
    const lib = c.version_liberada, min = c.version_min;
    const forzada = !!(min && versionMenor(cfg.VERSION, min));
    if (!forzada && !(lib && versionMenor(cfg.VERSION, lib))) return;
    avisada = true;
    if (!forzada) { actualizarSola(); return; }
    const d = modal('<h2>' + (forzada ? '⚠️ Actualiza la app' : '✨ Hay una versión nueva') + '</h2><p class="muted" style="margin-top:0">' +
      (forzada ? 'Tu versión (v' + esc(cfg.VERSION) + ') ya no funciona bien. Actualízala para seguir.' : 'Tienes la v' + esc(cfg.VERSION) + ' y ya está disponible la v' + esc(lib) + '. Actualiza para tener las últimas mejoras.') +
      '</p><p class="err" id="btMsg" style="margin:0 0 10px"></p><div class="btns">' + (forzada ? '' : '<button class="ghost" data-cerrar>Después</button>') +
      '<button class="ghost hidden" id="btReparar">Reparar la app</button><button id="btActualizar">Actualizar ahora</button></div>');
    d.querySelector('#btActualizar').onclick = actualizar;
    d.querySelector('#btReparar').onclick = repararApp;
  }
  // v4.3: la versión liberada se instala sola, sin preguntar. Se descarga completa en segundo plano y la app se recarga
  // apenas no estés escribiendo ni con una ventana abierta. Si Cloudflare aún no termina de publicarla, lo reintenta más tarde.
  function actualizarSola() {
    if (!('serviceWorker' in navigator)) { avisada = false; return; }
    navigator.serviceWorker.ready.then((reg) => {
      const sw = reg.active; if (!sw) { avisada = false; return; }
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => {
        if (!(e.data && e.data.ok)) { setTimeout(() => { avisada = false; }, 5 * 60 * 1000); return; }
        const libre = () => !document.querySelector('dialog[open]') && !(document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
        const recargar = () => { if (libre()) { try { sessionStorage.setItem('bt:actualizada', e.data.version || ''); } catch (er) { /* sin storage */ } location.reload(); } else setTimeout(recargar, 4000); };
        recargar();
      };
      sw.postMessage({ tipo: 'actualizar' }, [ch.port2]);
    }).catch(() => { avisada = false; });
  }
  try { const v = sessionStorage.getItem('bt:actualizada'); if (v) { sessionStorage.removeItem('bt:actualizada'); setTimeout(() => toast('App actualizada a la v' + v), 1500); } } catch (e) { /* sin storage */ }
  // Pide al service worker que descargue la versión publicada completa y recarga. Si algo falla, sigue en la versión actual.
  function actualizar() {
    const b = document.getElementById('btActualizar');
    if (b) { b.disabled = true; b.textContent = 'Actualizando…'; }
    const listo = () => location.reload();
    let terminado = false;
    // El error se muestra dentro de la ventana (un aviso suelto quedaría escondido detrás) y se ofrece reparar la app.
    const fallo = (m) => {
      if (terminado) return; terminado = true;
      if (b) { b.disabled = false; b.textContent = 'Reintentar'; }
      const t = m || 'No se pudo actualizar: revisa tu internet.';
      const msg = document.getElementById('btMsg');
      if (msg) msg.textContent = /publicando/.test(t) ? t + ' (Cloudflare aún no termina de publicarla.)' : t + ' Si sigue igual, toca "Reparar la app" (no borra tus datos).';
      else toast(t);
      const r = document.getElementById('btReparar'); if (r) r.classList.remove('hidden');
    };
    if (!('serviceWorker' in navigator)) return listo();
    navigator.serviceWorker.ready.then((reg) => {
      const sw = reg.active; if (!sw) return listo();
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => { if (e.data && e.data.ok) { terminado = true; listo(); } else fallo(e.data && e.data.error); };
      sw.postMessage({ tipo: 'actualizar' }, [ch.port2]);
      setTimeout(() => fallo('Tardó demasiado. Prueba de nuevo.'), 45000);
    }).catch(listo);
  }
  // Borra solo la copia guardada de esta app (no toca tus datos) y la vuelve a descargar.
  async function repararApp() {
    try {
      for (const k of await caches.keys()) if (k.startsWith('cc-')) await caches.delete(k);
      const regs = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
      for (const r of regs) if (r.scope === ROOT) await r.unregister();
    } catch (e) { /* igual recarga */ }
    location.reload();
  }
  setTimeout(revisarVersion, 3000);
  setInterval(revisarVersion, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revisarVersion(); });

  function pie() {
    const f = document.createElement('footer');
    f.className = 'pie';
    f.innerHTML = '© ' + new Date().getFullYear() + ' ' + esc(txt('app_nombre') || 'Cerebro') + ' · CodeFix · v' + cfg.VERSION;
    (document.querySelector('main') || document.body).appendChild(f);
  }

  // Pestañas inferiores: <nav class="tabs"><button data-v="x">…; vistas: <section class="view" id="v-x">
  function pestanas(onShow) {
    const nav = document.querySelector('nav.tabs');
    function show(v, push) {
      if (!document.getElementById('v-' + v)) return;
      document.querySelectorAll('.view').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
      if (nav) nav.querySelectorAll('button[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === v || b.dataset.v === (document.getElementById('v-' + v).dataset.tab || '')));
      if (push !== false && location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
      scrollTo(0, 0);
      if (onShow) onShow(v);
    }
    if (nav) nav.querySelectorAll('button[data-v]').forEach((b) => { b.onclick = () => show(b.dataset.v); });
    window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h) show(h, false); });
    return show;
  }

  global.App = {
    sb, ROOT, $, esc, plata, numero, iso, fechaDe, sumarDias, hoy, fCorta, fLarga, fHora, hace, DIAS, telNorm, wa, estrellas, nota,
    toast, modal, confirmar, friendly, rpc, q, cargarPublica, txt, refrescar, requerir, entrar, salir, crearCuenta, registrar,
    clave, mensajeAcceso, descargar, verImagen, campana, irA, activarPush, ofrecerPush,
    pushSoportado, pushListo, registrarSW, pedirInstalar, pie, pestanas, ico, ponerIconos, destino, revisarVersion, actualizar, repararApp, versionMenor, borrarCuenta, borrarMiCuenta,
    get cuenta() { return cuenta; },
    get publica() { return publica; }
  };
})(window);
