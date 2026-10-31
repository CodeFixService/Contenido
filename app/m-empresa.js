/* Cerebro · Empresa: perfil de marca, equipo que graba (para los pedidos), ritmo por red, nueva empresa, respaldo y cuenta. */
(function () {
  'use strict';
  const { esc } = App;
  let creando = false;

  function form(e) {
    e = e || { redes: ['tiktok', 'instagram', 'facebook'], ritmo: { tiktok: 7, instagram: 5, facebook: 5, historias: 4 }, equipo: [] };
    const r = Object.assign({ tiktok: 7, instagram: 5, facebook: 5, historias: 4 }, e.ritmo || {});
    const equipo = (e.equipo || []).length ? e.equipo : [{ nombre: '', tel: '' }];
    return '<form id="fEmp" class="card">' + (e.id ? '' : '<h3>Nueva empresa</h3>') +
      '<label for="eNom">Nombre</label><input id="eNom" maxlength="80" required value="' + esc(e.nombre || '') + '" placeholder="Ej: Ciclo Service">' +
      '<label for="eRub">Rubro</label><input id="eRub" maxlength="80" value="' + esc(e.rubro || '') + '" placeholder="Ej: taller de bicicletas">' +
      '<label for="ePub">Público (a quién le hablas)</label><input id="ePub" maxlength="300" value="' + esc(e.publico || '') + '" placeholder="Ej: hombres 25–44 ciclistas">' +
      '<label for="eSer">Servicios o productos</label><textarea id="eSer" rows="2" maxlength="600">' + esc(e.servicios || '') + '</textarea>' +
      '<label for="eTon">Tono</label><input id="eTon" maxlength="200" value="' + esc(e.tono || '') + '" placeholder="Ej: cercano, directo, técnico pero simple">' +
      '<label for="eCol">Colores de marca</label><input id="eCol" maxlength="200" value="' + esc(e.colores || '') + '" placeholder="Ej: negro, blanco, plomo, verde lima">' +
      '<label for="eCta">Llamado a la acción principal</label><input id="eCta" maxlength="200" value="' + esc(e.cta_base || '') + '" placeholder="Ej: Agenda tu mantención por DM">' +
      '<label>Ideas por semana en cada red (historias = 1 idea diaria)</label><div class="ritmo">' + ['tiktok', 'instagram', 'facebook', 'historias'].map((k) =>
        '<label>' + CC.nomRed(k) + '<input type="number" min="0" max="21" id="eR_' + k + '" value="' + (+r[k] || 0) + '"></label>').join('') + '</div>' +
      '<label>Quiénes graban (los pedidos les llegan por WhatsApp)</label><div id="eEq">' + equipo.map(filaEq).join('') + '</div><button type="button" class="small ghost" id="eMasEq">＋ Persona</button>' +
      '<div class="btns">' + (e.id ? '' : (CC.empresas.length ? '<button type="button" class="ghost" id="eCancel">Cancelar</button>' : '')) + '<button type="submit">' + (e.id ? 'Guardar cambios' : 'Crear empresa') + '</button></div></form>';
  }
  const filaEq = (p) => '<div class="equipo-fila"><input placeholder="Nombre" maxlength="40" value="' + esc(p.nombre || '') + '" data-k="nombre"><input placeholder="WhatsApp" inputmode="tel" maxlength="20" value="' + esc(p.tel || '') + '" data-k="tel"><button type="button" class="ghost" data-q aria-label="Quitar">✕</button></div>';

  // Con empresa: menú común del núcleo (CFX_MENU); sin empresa: la bienvenida y el formulario para crearla (y el menú debajo).
  function pintar(el) {
    const e = creando || !CC.emp ? null : CC.emp, adm = !!CC.cuenta.is_admin;
    const tarjeta = (id, h) => '<div class="card" id="' + id + '">' + h + '</div>';
    el.innerHTML = CC.titulo(e ? 'Empresa' : 'Tu empresa') +
      (!CC.empresas.length ? '<div class="card"><h3>¡Bienvenido a Cerebro! 🧠</h3><p class="muted" style="margin:0">Crea tu empresa, carga su base de contenido y el motor te arma la semana: ganchos que no se repiten, pedidos por WhatsApp, calendario y métricas.</p></div>' : '') +
      '<div id="eAj"></div>' + (!e && adm && !creando ? '<details class="card" id="eNuevaD"><summary style="cursor:pointer;font-weight:800">＋ Nueva empresa</summary>' + form(e) + '</details>' : form(e)) +
      (e ? tarjeta('eOtra', '<p class="sub" style="margin-top:0">Para un cliente nuevo: crea la empresa, copia el prompt, pégalo en un chat gratis y pega el CSV que te devuelve en Base.</p><div class="btns" style="flex-wrap:wrap"><button class="small" id="eNueva">＋ Nueva empresa</button><button class="small ghost" id="ePrompt">🧠 Prompt de esta empresa</button></div>') +
        tarjeta('eCuenta', '<p class="muted" style="margin-top:0">' + esc(CC.cuenta.email) + ' · ' + (CC.cuenta.premium ? 'Pro' + (CC.cuenta.premium_hasta ? ' hasta ' + App.fCorta(CC.cuenta.premium_hasta.slice(0, 10)) : '') : 'Gratis') + '</p>' +
          '<div class="btns" style="flex-wrap:wrap"><button class="small ghost" id="eGuia">📘 Guía de uso</button><button class="small ghost" id="eResp">⬇️ Respaldo Excel</button>' + (CC.cuenta.premium ? '' : '<button class="small gold" id="ePro">⭐ Pasar a Pro</button>') + '<button class="small danger" id="eBorrar">Borrar esta empresa</button><button class="small danger" id="eBorrarTodo">Borrar todos mis datos</button><button class="small ghost" onclick="App.salir()">Cerrar sesión</button></div>') +
        tarjeta('eUso', '<p class="sub">Cargando…</p>') : '') +
      (adm && !creando ? tarjeta('eAvisos', '') + tarjeta('eReg', '') : '');
    const f = el.querySelector('#fEmp');
    f.onsubmit = (ev) => { ev.preventDefault(); guardar(el, e); };
    el.querySelector('#eMasEq').onclick = () => el.querySelector('#eEq').insertAdjacentHTML('beforeend', filaEq({}));
    el.querySelector('#eEq').onclick = (ev) => { const q = ev.target.closest('[data-q]'); if (q) q.parentNode.remove(); };
    const c = el.querySelector('#eCancel'); if (c) c.onclick = () => { creando = false; pintar(el); };
    const n = (id) => el.querySelector('#' + id);
    if (adm && !creando) avisos(n('eAvisos'));
    // Las tarjetas se guardan antes: al abrir su hoja se mueven fuera de la página y n() ya no las encontraría.
    const nUso = n('eUso'), nReg = n('eReg');
    const S = [
      e && { k: 'perfil-emp', ico: '🏢', t: 'Perfil de la empresa', d: 'Nombre, público, tono y equipo', grupo: 'Tu empresa', nodo: f },
      e && { k: 'otra', ico: '➕', t: 'Otra empresa', d: 'Nueva empresa y su prompt', grupo: 'Tu empresa', nodo: n('eOtra') },
      e && { k: 'uso', ico: '📦', t: 'Espacio de tus datos', d: 'Cuánto ocupan tus datos', grupo: 'Tu empresa', nodo: nUso, abrir: () => uso(nUso) },
      e && { k: 'micuenta', ico: '🗂️', t: 'Respaldo, guía y borrar', d: 'Excel, guía de uso y borrar datos', grupo: 'Tu empresa', nodo: n('eCuenta') },
      adm && !creando && { k: 'avisos', ico: '🔔', t: 'Notificaciones', d: 'Claves y servidor', grupo: 'Administración', nodo: n('eAvisos') },
      adm && !creando && { k: 'registro', ico: '📜', t: 'Registro', d: 'Lo que se hizo y borrarlo', grupo: 'Administración', nodo: nReg, abrir: () => { nReg.innerHTML = ''; window.CFX_AJUSTES.registro(nReg, App.rpc, { lista: true }); } }
    ].filter(Boolean);
    // Sin empresa el formulario queda a la vista; la cuadrícula (solo admin) va debajo.
    // Menú común del núcleo (lista + hoja): las opciones de la empresa, tu perfil y Cuenta y ayuda. Sin empresa: el formulario arriba y el menú debajo.
    if (window.CFX_MENU) { if (!e) el.appendChild(n('eAj')); window.CFX_MENU.montar(n('eAj'), S); }
    if (!e) return;
    n('eNueva').onclick = nueva;
    n('ePrompt').onclick = () => CC.vistas.base.verPrompt('nueva', CC.emp);
    n('eResp').onclick = respaldo;
    n('eGuia').onclick = () => CC.tour(true);
    const pro = n('ePro'); if (pro) pro.onclick = () => window.CFX_PAGOS && CFX_PAGOS.abrir({ rpc: App.rpc });
    n('eBorrar').onclick = async () => {
      if (!(await App.confirmar('¿Borrar "' + CC.emp.nombre + '" con toda su base, ideas, pedidos y métricas? No se puede deshacer.\nDescarga antes el respaldo si lo necesitas.', 'Borrar todo'))) return;
      try { await App.q(App.sb.from('empresas').delete().eq('id', CC.emp.id)); CC.emp = null; await CC.cargar(); CC.ir(CC.emp ? 'inicio' : 'empresa'); App.toast('Empresa borrada'); } catch (er) { App.toast(er.message); }
    };
    // Ley 19.628 / 21.719: el usuario puede borrar todo lo suyo (todas sus empresas e importaciones).
    n('eBorrarTodo').onclick = async () => {
      if (!(await App.confirmar('¿Borrar TODAS tus empresas, bases, ideas, pedidos y métricas? Tu cuenta sigue abierta. No se puede deshacer.\nDescarga antes el respaldo si lo necesitas.', 'Borrar todo'))) return;
      try { await App.q(App.sb.rpc('mi_borrar_datos')); CC.emp = null; await CC.cargar(); CC.ir('empresa'); App.toast('Tus datos fueron borrados'); } catch (er) { App.toast(er.message); }
    };
  }

  async function guardar(el, e) {
    const v = (id) => el.querySelector('#' + id).value.trim();
    const ritmo = {}; ['tiktok', 'instagram', 'facebook', 'historias'].forEach((k) => { ritmo[k] = Math.max(0, Math.min(21, +el.querySelector('#eR_' + k).value || 0)); });
    const equipo = Array.from(el.querySelectorAll('#eEq .equipo-fila')).map((x) => ({ nombre: x.querySelector('[data-k=nombre]').value.trim().slice(0, 40), tel: x.querySelector('[data-k=tel]').value.trim().slice(0, 20) })).filter((p) => p.nombre);
    const datos = { nombre: v('eNom'), rubro: v('eRub'), publico: v('ePub'), servicios: v('eSer'), tono: v('eTon'), colores: v('eCol'), cta_base: v('eCta'), ritmo, equipo };
    if (!datos.nombre) return App.toast('Escribe el nombre');
    try {
      if (e) {
        const r = await App.q(App.sb.from('empresas').update(datos).eq('id', e.id).select('*').single());
        Object.assign(CC.emp, r); CC.empresas = CC.empresas.map((x) => (x.id === r.id ? r : x)); CC.pintarCabecera(); App.toast('Guardado');
      } else {
        const r = await App.q(App.sb.from('empresas').insert(datos).select('*').single());
        CC.empresas.push(r); creando = false;
        await CC.usarEmpresa(r.id);
        App.toast('Empresa creada. Ahora carga su base de contenido.');
        CC.ir('base');
      }
    } catch (er) { App.toast(er.message); }
  }

  function nueva() { creando = true; CC.ir('empresa'); }

  // Cuánto ocupan tus datos (el servidor completo se ve en el Centro de Mando).
  const kb = (b) => b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  async function uso(caja) {
    if (!caja) return;
    try {
      const u = await App.rpc('mi_uso');
      const total = u.tablas.reduce((a, t) => a + Number(t.bytes), 0), filas = u.tablas.reduce((a, t) => a + Number(t.filas), 0);
      let html = '<p class="sub" style="margin-top:0">Tus datos: <b>' + CC.fmt(filas) + ' filas · ' + kb(total) + '</b> (solo texto).</p>' +
        '<table class="tabla"><tbody>' + u.tablas.filter((t) => +t.filas).map((t) => '<tr><td>' + esc(t.t) + '</td><td>' + CC.fmt(t.filas) + '</td><td>' + kb(+t.bytes) + '</td></tr>').join('') + '</tbody></table>';
      // El servidor completo (todas las cuentas) se ve en el Centro de Mando → Resumen.
      html += '<div class="btns"><button class="small ghost" onclick="CC.ir(\'metricas\')">🗂️ Ciclo mensual</button></div>';
      caja.innerHTML = html;
    } catch (e) { caja.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; }
  }

  // Notificaciones push (solo el súper administrador): claves y prueba de la función "servidor".
  function avisos(caja) {
    const k = App.pushListo();
    caja.innerHTML = '<p class="sub" style="margin-top:0">Para que los avisos lleguen con la app cerrada.</p>' +
      '<details class="av-pasos"><summary class="sub" style="cursor:pointer;font-weight:700">Ver los pasos de instalación</summary>' +
      '<ul class="list check-sem"><li class="' + (k ? 'ok' : '') + '"><span class="ck">' + (k ? '✓' : '1') + '</span><div class="grow"><b>Crear las claves</b><div class="sub">Se crean aquí con un toque.</div></div></li>' +
      '<li id="avFn"><span class="ck">2</span><div class="grow"><b>Función "servidor" en Supabase</b><div class="sub">Edge Functions → Deploy a new function → nombre <b>servidor</b> → pega el contenido de supabase/functions/servidor/corto.ts → Deploy.</div></div></li></ul>' + '</details>' +
      '<div class="btns"><button class="small' + (k ? ' ghost' : '') + '" id="avK">' + (k ? 'Crear claves nuevas' : 'Crear claves') + '</button><button class="small alt" id="avP">Probar servidor</button></div><p class="sub" id="avR" style="margin:6px 0 0"></p>';
    caja.querySelector('#avK').onclick = async () => {
      if (k && !(await App.confirmar('Con claves nuevas todos deberán activar las notificaciones otra vez.', 'Continuar'))) return;
      try {
        const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
        const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)), jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
        const b64u = (u) => btoa(String.fromCharCode.apply(null, u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        await App.rpc('admin_push_claves', { p_publica: b64u(raw), p_privada: jwk.d });
        await App.cargarPublica(); App.toast('Claves creadas: ya puedes activar las notificaciones'); avisos(caja);
      } catch (e) { App.toast(e.message); }
    };
    caja.querySelector('#avP').onclick = async () => {
      const r = caja.querySelector('#avR'); r.textContent = 'Probando…';
      try {
        const { data, error } = await App.sb.functions.invoke('servidor', { body: { accion: 'ping' } });
        const ok = !error && data && data.servicio;
        r.textContent = error ? 'No responde: despliega la función "servidor" (paso 2).' : ok ? '✅ Funciona (v' + data.version + '). Activa las notificaciones en la campana 🔔.' : 'Responde, pero sin clave de servicio.';
        caja.querySelector('#avFn').classList.toggle('ok', !!ok);
      } catch (e) { r.textContent = 'No responde: despliega la función "servidor" (paso 2).'; }
    };
  }

  async function respaldo() {
    try {
      const r = await App.rpc('mi_respaldo');
      const hojas = {};
      Object.keys(r).forEach((k) => { hojas[k] = (r[k] || []).map((f) => { const o = {}; Object.keys(f).forEach((c) => { o[c] = f[c] && typeof f[c] === 'object' ? JSON.stringify(f[c]) : f[c]; }); return o; }); });
      if (window.CFX_RESPALDO) CFX_RESPALDO.excel('cerebro-respaldo-' + App.hoy(), hojas);
      else App.descargar('data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(r)), 'cerebro-respaldo-' + App.hoy() + '.json');
    } catch (er) { App.toast(er.message); }
  }

  CC.vistas.empresa = { pintar, nueva };
})();
