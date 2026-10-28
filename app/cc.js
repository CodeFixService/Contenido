/* Cerebro · núcleo de la app: datos de la empresa activa, navegación, motor y acciones comunes (pedir, programar, publicar). */
(function (global) {
  'use strict';
  const { $, esc } = App;
  const CC = {
    cuenta: null, empresas: [], emp: null, vista: null, sync: 0,
    base: [], ideas: [], pedidos: [], pubs: [], metricas: [], mcuenta: [], audiencia: [], guia: [], ctx: null, vistas: {}
  };

  /* ---------- íconos ---------- */
  const IC = {
    inicio: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
    ideas: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/>',
    calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    pedidos: '<path d="M4 7h11l5 5v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM15 7v5h5"/><path d="M8 13h4M8 16h6"/>',
    metricas: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    base: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    empresa: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  CC.ico = (n, s) => '<svg width="' + (s || 22) + '" height="' + (s || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[n] || '') + '</svg>';
  CC.TABS = [['inicio', 'Inicio'], ['ideas', 'Ideas'], ['nuevo', 'Generar'], ['calendario', 'Calendario'], ['pedidos', 'Pedidos'], ['metricas', 'Métricas'], ['base', 'Base'], ['empresa', 'Empresa']];
  CC.montarBarra = function () {
    const nav = $('nav');
    nav.innerHTML = CC.TABS.map((t) => t[0] === 'nuevo'
      ? '<button type="button" class="nuevo" data-v="nuevo" aria-label="Generar ideas"><span class="i">' + CC.ico('plus', 28) + '</span>Generar</button>'
      : '<button type="button" data-v="' + t[0] + '"><span class="i">' + CC.ico(t[0]) + '</span>' + t[1] + '</button>').join('');
    nav.onclick = (e) => { const b = e.target.closest('button[data-v]'); if (b) CC.ir(b.dataset.v); };
    $('bEmpresa').onclick = CC.elegirEmpresa;
  };

  /* ---------- navegación ---------- */
  CC.ir = function (v) {
    if (v === 'nuevo') { if (!CC.emp) return CC.ir('empresa'); return CC.vistas.ideas && CC.vistas.ideas.generar(); }
    if (!$('v-' + v)) v = 'inicio';
    if (!CC.emp && !['empresa', 'base'].includes(v)) v = 'empresa';
    CC.vista = v;
    document.querySelectorAll('.view').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
    document.querySelectorAll('#nav button[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
    scrollTo(0, 0);
    CC.pintar(v);
  };
  CC.pintar = function (v) {
    const m = CC.vistas[v || CC.vista];
    if (!m) return;
    try { m.pintar($('v-' + (v || CC.vista))); } catch (e) { console.error(e); App.toast(e.message); }
  };
  CC.repintar = () => CC.pintar();

  /* ---------- datos ---------- */
  const q = (p) => App.q(p);
  CC.cargar = async function () {
    CC.empresas = await q(App.sb.from('empresas').select('*').order('created_at'));
    const pref = CC.cuenta && CC.cuenta.prefs && CC.cuenta.prefs.empresa;
    CC.emp = CC.empresas.find((e) => e.id === pref) || CC.empresas[0] || null;
    CC.pintarCabecera();
    if (CC.emp) await CC.cargarEmpresa();
  };
  CC.cargarEmpresa = async function () {
    const id = CC.emp && CC.emp.id;
    if (!id) return;
    const desde = App.sumarDias(App.hoy(), -180);
    const [base, ideas, pedidos, pubs, metricas, mcuenta, audiencia, guia] = await Promise.all([
      q(App.sb.from('base_contenido').select('id,tema,categoria,texto,veces_usado').eq('empresa_id', id).order('id').limit(10000)),
      q(App.sb.from('ideas').select('*').eq('empresa_id', id).order('created_at', { ascending: false }).limit(5000)),
      q(App.sb.from('pedidos').select('*').eq('empresa_id', id).order('fecha_pedido', { ascending: false }).limit(500)),
      q(App.sb.from('publicaciones').select('*').eq('empresa_id', id).order('fecha_hora', { ascending: false }).limit(2000)),
      q(App.sb.from('metricas').select('*').eq('empresa_id', id).order('fecha_corte', { ascending: false }).limit(5000)),
      q(App.sb.from('metricas_cuenta').select('red,fecha,metrica,valor').eq('empresa_id', id).gte('fecha', desde).order('fecha').limit(10000)),
      q(App.sb.from('audiencia').select('red,fecha_corte,dimension,valor,porcentaje').eq('empresa_id', id).order('fecha_corte', { ascending: false }).limit(2000)),
      CC.guia.length ? Promise.resolve(CC.guia) : q(App.sb.from('guia_redes').select('red,metrica,tip'))
    ]);
    Object.assign(CC, { base, ideas, pedidos, pubs, metricas, mcuenta, audiencia, guia, sync: Date.now() });
    CC.armarMotor();
  };
  CC.armarMotor = function () {
    CC.rend = Motor.rendimiento(CC.ideas, CC.pubs, CC.metricas);
    CC.ctx = Motor.contexto(CC.base, CC.ideas, { rendimiento: CC.rend, horas: CC.mejoresHoras() });
  };
  // Hora de mayor actividad por red (si se importó la audiencia por hora).
  CC.mejoresHoras = function () {
    const out = {};
    ['tiktok', 'instagram', 'facebook'].forEach((r) => {
      const h = CC.audiencia.filter((a) => a.red === r && a.dimension === 'hora').sort((a, b) => b.porcentaje - a.porcentaje)[0];
      if (h) { const n = parseInt(h.valor, 10); if (n >= 0 && n < 24) out[r] = String(n).padStart(2, '0') + ':00'; }
    });
    return out;
  };

  /* ---------- empresa activa ---------- */
  CC.pintarCabecera = function () {
    const n = CC.emp ? CC.emp.nombre : 'Cerebro';
    $('nomEmp').textContent = n;
    $('logoEmp').textContent = (n.trim()[0] || 'C').toUpperCase();
    document.title = n + ' · Cerebro';
  };
  CC.usarEmpresa = async function (id) {
    CC.emp = CC.empresas.find((e) => e.id === id) || CC.emp;
    CC.pintarCabecera();
    App.rpc('mi_perfil_guardar', { p_nombre: null, p_telefono: null, p_prefs: { empresa: id } }).catch(() => {});
    if (CC.cuenta) CC.cuenta.prefs = Object.assign({}, CC.cuenta.prefs, { empresa: id });
    await CC.cargarEmpresa();
    CC.ir(CC.vista && CC.vista !== 'empresa' ? CC.vista : 'inicio');
  };
  CC.elegirEmpresa = function () {
    const d = App.modal('<h2>Tus empresas</h2><div class="list" id="lEmp">' + (CC.empresas.map((e) =>
      '<button type="button" class="opc' + (CC.emp && e.id === CC.emp.id ? ' on' : '') + '" data-id="' + e.id + '" style="width:100%;text-align:left;margin:6px 0"><b>' + esc(e.nombre) + '</b><small>' + esc(e.rubro || 'Sin rubro') + '</small></button>').join('') ||
      '<p class="empty">Aún no tienes empresas.</p>') + '</div><div class="btns"><button class="ghost" data-cerrar>Cerrar</button><button id="bNuevaEmp">＋ Nueva empresa</button></div>');
    d.querySelector('#lEmp').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) { d.close(); CC.usarEmpresa(b.dataset.id); } };
    d.querySelector('#bNuevaEmp').onclick = () => { d.close(); CC.ir('empresa'); setTimeout(() => CC.vistas.empresa.nueva(), 50); };
  };

  /* ---------- fechas ---------- */
  CC.lunes = function (s) { const d = App.fechaDe(s || App.hoy()); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return App.iso(d); };
  CC.enSemana = (f, lunes) => f && f >= lunes && f <= App.sumarDias(lunes, 6);

  /* ---------- piezas comunes de interfaz ---------- */
  const NOM_RED = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', historias: 'Historias' };
  CC.nomRed = (r) => NOM_RED[r] || r;
  CC.red = (r) => '<span class="red ' + esc(r) + '">' + esc(CC.nomRed(r)) + '</span>';
  CC.est = (e) => '<span class="est ' + esc(e) + '">' + esc(e) + '</span>';
  CC.titulo = (t, extra) => '<div class="titulo"><h2>' + esc(t) + '</h2>' + (extra || '') + '</div>';
  CC.nombreEstructura = (k) => { const e = CC.ctx && CC.ctx.estructuras.find((x) => x.k === k); return e ? e.nombre : k; };
  CC.tip = (red, metrica) => { const g = CC.guia.find((x) => (x.red === red || x.red === 'todas') && x.metrica === metrica); return g ? '<p class="tip">💡 ' + esc(g.tip) + '</p>' : ''; };
  CC.fmt = (n) => n == null ? '—' : Math.round(Number(n)).toLocaleString('es-CL');

  /* ---------- acciones sobre ideas ---------- */
  const CAMPOS = ['combo', 'tema', 'formato', 'estructura', 'gancho', 'elemento', 'toma', 'texto_pantalla', 'cta', 'red', 'hora', 'duracion_seg', 'bloqueados', 'estado', 'fecha_plan', 'nota'];
  const limpia = (i) => { const o = {}; CAMPOS.forEach((k) => { if (i[k] !== undefined) o[k] = i[k]; }); if (o.hora && !/^\d{2}:\d{2}$/.test(o.hora)) o.hora = ''; return o; };
  const idElemento = (combo) => { const n = Number(String(combo || '').split('|')[1]); return isFinite(n) && n > 0 ? n : null; };
  // Guarda ideas nuevas (lote). Devuelve las guardadas.
  CC.guardarNuevas = async function (lista) {
    if (!lista.length) return [];
    const filas = lista.map((i) => Object.assign(limpia(i), { empresa_id: CC.emp.id }));
    const r = await q(App.sb.from('ideas').insert(filas).select('*'));
    const ids = lista.map((i) => idElemento(i.combo)).filter(Boolean);
    if (ids.length) App.rpc('base_marcar_uso', { p_empresa: CC.emp.id, p_ids: ids }).catch(() => {});
    CC.ideas = r.concat(CC.ideas);
    CC.armarMotor();
    return r;
  };
  CC.actualizarIdea = async function (id, cambios) {
    const r = await q(App.sb.from('ideas').update(limpia(cambios)).eq('id', id).select('*').single());
    const k = CC.ideas.findIndex((x) => x.id === id);
    if (k >= 0) CC.ideas[k] = r;
    if (cambios.combo) { CC.armarMotor(); const n = idElemento(cambios.combo); if (n) App.rpc('base_marcar_uso', { p_empresa: CC.emp.id, p_ids: [n] }).catch(() => {}); }
    return r;
  };

  // Pedir la grabación: elige a quién (equipo de la empresa o yo), guarda el pedido y abre WhatsApp con el mensaje listo.
  CC.pedir = function (idea) {
    const equipo = (CC.emp.equipo || []).filter((p) => p && p.nombre);
    const d = App.modal('<h2>📲 Pedir grabación</h2><p class="muted" style="margin-top:0">' + esc(idea.gancho) + '</p>' +
      '<label>¿A quién?</label><div id="pQuien">' + equipo.map((p, i) => '<button type="button" class="opc" data-i="' + i + '" style="width:100%;text-align:left;margin:4px 0"><b>' + esc(p.nombre) + '</b><small>' + esc(p.tel || 'sin teléfono') + '</small></button>').join('') +
      '<button type="button" class="opc" data-i="yo" style="width:100%;text-align:left;margin:4px 0"><b>Lo grabo yo</b><small>Queda anotado sin enviar WhatsApp</small></button></div>' +
      (equipo.length ? '' : '<p class="sub">Agrega a tu equipo (nombre y WhatsApp) en Empresa para mandarles el pedido directo.</p>') +
      '<label for="pMsg">Mensaje</label><textarea id="pMsg" rows="9">' + esc(Motor.mensajePedido(idea, CC.emp.nombre)) + '</textarea><div class="btns"><button class="ghost" data-cerrar>Cancelar</button></div>');
    d.querySelector('#pQuien').onclick = async (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const p = b.dataset.i === 'yo' ? { nombre: 'Yo', tel: '' } : equipo[+b.dataset.i];
      let msg = d.querySelector('#pMsg').value.trim();
      if (p.nombre !== 'Yo' && !/^🎬[^\n]*\nPara:/.test(msg)) msg = msg.replace(/^(🎬[^\n]*\n)/, '$1Para: ' + p.nombre + '\n');
      // La ventana de WhatsApp se abre antes de esperar a la base (si no, el navegador la bloquea).
      const w = p.tel ? window.open(App.wa(p.tel, msg), '_blank') : null;
      try {
        const r = await q(App.sb.from('pedidos').insert({ empresa_id: CC.emp.id, idea_id: idea.id, para: p.nombre.slice(0, 60), tel: String(p.tel || '').slice(0, 20), instrucciones: msg.slice(0, 1500), duracion_seg: idea.duracion_seg || 15 }).select('*').single());
        CC.pedidos.unshift(r);
        await CC.actualizarIdea(idea.id, { estado: 'pedido' });
        App.toast(p.tel ? 'Pedido enviado a ' + p.nombre : 'Pedido anotado');
        d.close(); CC.repintar();
      } catch (er) { if (w) w.close(); App.toast(er.message); }
    };
  };

  // Programar: fecha y hora del calendario.
  CC.programar = function (idea) {
    const d = App.modal('<h2>📅 Programar</h2><p class="muted" style="margin-top:0">' + esc(idea.gancho) + '</p><div class="row"><div><label for="prF">Fecha</label><input id="prF" type="date" value="' + esc(idea.fecha_plan || App.hoy()) + '"></div>' +
      '<div><label for="prH">Hora</label><input id="prH" type="time" value="' + esc(idea.hora || '19:00') + '"></div></div><div class="btns"><button class="ghost" data-cerrar>Cancelar</button><button id="prOk">Programar</button></div>');
    d.querySelector('#prOk').onclick = async () => {
      try { await CC.actualizarIdea(idea.id, { fecha_plan: d.querySelector('#prF').value || null, hora: d.querySelector('#prH').value || '', estado: 'programado' }); d.close(); App.toast('Programada'); CC.repintar(); } catch (e) { App.toast(e.message); }
    };
  };

  // Marcar como publicada: crea la publicación (para medirla) con la fecha y hora real.
  const TIPO_DE = (f) => /Carrusel/i.test(f) ? 'carrusel' : /^Historia/i.test(f) ? 'historia' : 'reel';
  CC.publicar = function (idea) {
    const ahora = new Date(), hh = String(ahora.getHours()).padStart(2, '0') + ':' + String(ahora.getMinutes()).padStart(2, '0');
    const d = App.modal('<h2>✅ Publicada</h2><p class="muted" style="margin-top:0">' + esc(idea.gancho) + '</p>' +
      '<div class="row"><div><label for="puF">Fecha</label><input id="puF" type="date" value="' + App.hoy() + '"></div><div><label for="puH">Hora</label><input id="puH" type="time" value="' + hh + '"></div></div>' +
      '<label for="puL">Link de la publicación (opcional, ayuda a cruzar las métricas)</label><input id="puL" type="url" placeholder="https://…">' +
      '<div class="btns"><button class="ghost" data-cerrar>Cancelar</button><button id="puOk">Guardar</button></div>');
    d.querySelector('#puOk').onclick = async () => {
      try {
        const fh = new Date((d.querySelector('#puF').value || App.hoy()) + 'T' + (d.querySelector('#puH').value || hh) + ':00');
        const r = await q(App.sb.from('publicaciones').insert({ empresa_id: CC.emp.id, idea_id: idea.id, red: idea.red, tipo: TIPO_DE(idea.formato),
          fecha_hora: fh.toISOString(), texto: String(idea.gancho || '').slice(0, 600), link: d.querySelector('#puL').value.trim().slice(0, 400) }).select('*').single());
        CC.pubs.unshift(r);
        await CC.actualizarIdea(idea.id, { estado: 'publicado' });
        d.close(); App.toast('¡Publicada! El domingo importa sus métricas.'); CC.repintar();
      } catch (e) { App.toast(e.message); }
    };
  };

  // Anotar métricas a mano de una publicación (y los clientes que trajo, la métrica que más pesa).
  CC.anotarMetricas = function (pub) {
    const m = CC.metricas.find((x) => x.publicacion_id === pub.id) || {};
    const campo = (k, t) => '<div><label for="am_' + k + '">' + t + '</label><input id="am_' + k + '" inputmode="numeric" value="' + (m[k] == null ? '' : m[k]) + '"></div>';
    const d = App.modal('<h2>📊 Métricas</h2><p class="muted" style="margin-top:0">' + CC.red(pub.red) + ' ' + esc(pub.texto) + '</p><div class="grid-num">' +
      campo('vistas', 'Vistas') + campo('compartidos', 'Compartidos') + campo('guardados', 'Guardados') + campo('me_gusta', 'Me gusta') + campo('comentarios', 'Comentarios') + campo('seguidores_nuevos', 'Seguidores') + campo('clientes_generados', 'Clientes 🎯') + '</div>' +
      CC.tip('todas', 'clientes_generados') + '<div class="btns"><button class="ghost" data-cerrar>Cancelar</button><button id="amOk">Guardar</button></div>');
    d.querySelector('#amOk').onclick = async () => {
      const fila = { empresa_id: CC.emp.id, publicacion_id: pub.id, red: pub.red, fecha_corte: App.hoy() };
      ['vistas', 'compartidos', 'guardados', 'me_gusta', 'comentarios', 'seguidores_nuevos', 'clientes_generados'].forEach((k) => { const v = Importador.numero(d.querySelector('#am_' + k).value); fila[k] = v == null ? null : Math.round(v); });
      try {
        const r = await q(App.sb.from('metricas').upsert(fila, { onConflict: 'publicacion_id,fecha_corte' }).select('*').single());
        CC.metricas = [r].concat(CC.metricas.filter((x) => x.id !== r.id));
        CC.armarMotor(); d.close(); App.toast('Métricas guardadas'); CC.repintar();
      } catch (e) { App.toast(e.message); }
    };
  };

  global.CC = CC;
})(window);
