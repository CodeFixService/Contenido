/* Cerebro · Métricas: importar (archivo, captura o texto pegado) y ver qué funciona. Todo se ordena solo en las tablas universales. */
(function () {
  'use strict';
  const { esc } = App;
  let cola = [], dias = 28, mapeos = null, raiz = null;
  const NOMBRE = { visualizaciones: 'Visualizaciones', vistas: 'Vistas', espectadores: 'Espectadores', espectadores_nuevos: 'Espectadores nuevos', interacciones: 'Interacciones',
    seguidores_nuevos: 'Seguidores nuevos', visitas_perfil: 'Visitas al perfil', me_gusta: 'Me gusta', comentarios: 'Comentarios', compartidos: 'Compartidos', guardados: 'Guardados', clics_enlace: 'Clics en el enlace' };
  const nom = (k) => NOMBRE[k] || NOMBRE[k.replace(/_\d+d$/, '')] && NOMBRE[k.replace(/_\d+d$/, '')] + ' (' + k.match(/_(\d+)d$/)[1] + ' días)' || k.replace(/_/g, ' ');
  const TIPO = { cuenta: 'Serie diaria de la cuenta', audiencia: 'Audiencia / formatos', contenido: 'Por publicación', pares: 'Datos de una captura o texto', desconocido: 'Columnas sin reconocer', base: 'Base de contenido', vacio: 'Archivo vacío' };

  async function cargarMapeos() {
    if (mapeos) return mapeos;
    const r = await App.q(App.sb.from('mapeos_import').select('red,columna_origen,columna_destino'));
    mapeos = {}; r.forEach((m) => { mapeos[Importador.norm(m.columna_origen)] = m.columna_destino; });
    return mapeos;
  }

  /* ---------- pantalla ---------- */
  function pintar(el) {
    raiz = el;
    el.innerHTML = CC.titulo('Métricas') +
      '<div class="card"><h3>Importar</h3><div class="soltar" id="mSoltar"><b>Arrastra o elige archivos</b><p class="sub">CSV de Meta Business Suite o TikTok Studio, o capturas de pantalla de las estadísticas.</p>' +
      '<div class="fila" style="justify-content:center"><label class="btn small" style="margin:0">📄 Archivos<input type="file" id="mArch" multiple accept=".csv,.txt,text/csv" hidden></label>' +
      '<label class="btn small alt" style="margin:0">📷 Capturas<input type="file" id="mCap" multiple accept="image/*" hidden></label><button type="button" class="small ghost" id="mPeg">📋 Pegar texto</button></div></div>' +
      '<div id="mCola"></div></div>' + resumen() + '<div class="grid-2">' + topPublicaciones() + ranking() + audiencia() + ciclo() + '</div>';
    const s = el.querySelector('#mSoltar');
    s.ondragover = (e) => { e.preventDefault(); s.classList.add('encima'); };
    s.ondragleave = () => s.classList.remove('encima');
    s.ondrop = (e) => { e.preventDefault(); s.classList.remove('encima'); leer(Array.from(e.dataTransfer.files)); };
    el.querySelector('#mArch').onchange = (e) => { leer(Array.from(e.target.files)); e.target.value = ''; };
    el.querySelector('#mCap').onchange = (e) => { leer(Array.from(e.target.files)); e.target.value = ''; };
    el.querySelector('#mPeg').onclick = pegar;
    el.querySelectorAll('[data-dias]').forEach((b) => { b.onclick = () => { dias = +b.dataset.dias; pintar(el); }; });
    el.querySelectorAll('[data-anotar]').forEach((b) => { b.onclick = () => { const p = CC.pubs.find((x) => x.id === b.dataset.anotar); if (p) CC.anotarMetricas(p); }; });
    el.querySelectorAll('[data-cerrar-mes]').forEach((b) => { b.onclick = () => cerrarMes(b.dataset.cerrarMes); });
    pintarCola();
  }

  /* ---------- lectura ---------- */
  async function leer(archivos) {
    await cargarMapeos();
    for (const f of archivos) {
      const item = { nombre: f.name, estado: 'leyendo' };
      cola.push(item); pintarCola();
      try {
        if (/^image\//.test(f.type)) {
          const r = await Importador.leerCaptura(f, (p) => { item.avance = p; pintarCola(); });
          Object.assign(item, r, { estado: 'listo' });
        } else {
          const txt = Importador.decodificar(await f.arrayBuffer());
          const firma = txt.length + ':' + txt.slice(0, 300);
          if (cola.some((c) => c !== item && c.firma === firma)) { cola.splice(cola.indexOf(item), 1); App.toast(f.name + ' es igual a otro archivo: se omite'); pintarCola(); continue; }
          Object.assign(item, Importador.analizar(txt, f.name, mapeos), { estado: 'listo', firma, texto: txt });
        }
      } catch (e) { item.estado = 'error'; item.error = e.message; }
      pintarCola();
    }
  }
  function pegar() {
    const d = App.modal('<h2>📋 Pegar texto</h2><p class="muted" style="margin-top:0">Copia los números del panel (o de un CSV) y pégalos aquí. Se ordenan solos.</p><textarea id="pgT" rows="9" placeholder="Visualizaciones 1,604,253&#10;Seguidores netos +2.574"></textarea><div class="btns"><button class="ghost" data-cerrar>Cancelar</button><button id="pgOk">Analizar</button></div>');
    d.querySelector('#pgOk').onclick = async () => {
      await cargarMapeos();
      const t = d.querySelector('#pgT').value;
      if (!t.trim()) return;
      cola.push(Object.assign({ nombre: 'Texto pegado', estado: 'listo' }, /[,;\t]/.test(t.split('\n')[0]) ? Importador.analizar(t, 'pegado', mapeos) : Importador.pegado(t)));
      d.close(); pintarCola();
    };
  }

  /* ---------- revisión antes de guardar ---------- */
  function opcionesRed(sel, ...permitidas) {
    return '<select data-k="red"><option value="">¿De qué red?</option>' + (permitidas.length ? permitidas : ['tiktok', 'instagram', 'facebook']).map((r) => '<option value="' + r + '"' + (sel === r ? ' selected' : '') + '>' + CC.nomRed(r) + '</option>').join('') + '</select>';
  }
  function resumenItem(it) {
    if (it.tipo === 'cuenta') {
      const t = {}; it.filas.forEach((f) => { t[f.metrica] = (t[f.metrica] || 0) + f.valor; });
      const fechas = it.filas.map((f) => f.fecha).sort();
      return Object.keys(t).map((k) => nom(k) + ': <b>' + CC.fmt(t[k]) + '</b>').join(' · ') + (fechas.length ? '<div class="sub">' + App.fCorta(fechas[0]) + ' → ' + App.fCorta(fechas[fechas.length - 1]) + ' · ' + it.filas.length + ' valores</div>' : '');
    }
    if (it.tipo === 'audiencia') return it.filas.length + ' datos (' + Array.from(new Set(it.filas.map((f) => f.dimension))).join(', ') + ')';
    if (it.tipo === 'contenido') return it.filas.length + ' publicaciones' + (it.sinMapear && it.sinMapear.length ? '<div class="sub">Sin usar: ' + esc(it.sinMapear.slice(0, 6).join(', ')) + '</div>' : '');
    if (it.tipo === 'pares') {
      return (it.pares.length ? '<ul class="list">' + it.pares.map((p, k) => '<li><label class="check" style="margin:0"><input type="checkbox" data-par="' + k + '" checked> ' + esc(nom(p.clave)) + ': <b>' + CC.fmt(p.valor) + '</b></label></li>').join('') + '</ul>' : '') +
        (it.lista && it.lista.length ? '<b class="sub">Publicaciones leídas</b><ul class="list">' + it.lista.map((l, k) => '<li><div class="fila"><span class="grow">' + esc(l.texto) + '</span><b>' + CC.fmt(l.vistas) + '</b></div>' + selPub('lista' + k, parecida(l.texto)) + '</li>').join('') + '</ul>' : '') +
        (!it.pares.length && !(it.lista || []).length ? '<p class="err">No encontré números. Prueba con otra captura más nítida o pega el texto.</p>' : '') +
        (it.pares.length ? '<label>¿De dónde son estos números?</label>' + selPub('destino', null, true) : '');
    }
    if (it.tipo === 'desconocido') {
      return '<p class="sub">Dime qué es cada columna (queda guardado para la próxima vez):</p>' + it.encabezados.map((h, k) => '<div class="fila" style="margin:4px 0"><span class="grow">' + esc(h) + '</span><select data-col="' + k + '"><option value="">Ignorar</option>' +
        Object.keys(Importador.SINONIMOS).map((c) => '<option value="' + c + '">' + esc(nom(c)) + '</option>').join('') + '</select></div>').join('');
    }
    if (it.tipo === 'base') return it.filas.length + ' filas de base de contenido → se cargan en la pantalla Base.';
    return '';
  }
  function parecida(texto) {
    const n = Importador.norm(texto).slice(0, 28);
    if (n.length < 8) return null;
    const p = CC.pubs.find((x) => Importador.norm(x.texto).startsWith(n) || Importador.norm(x.texto).includes(n));
    return p ? p.id : null;
  }
  function selPub(k, sel, conCuenta) {
    return '<select data-sel="' + k + '">' + (conCuenta ? '<option value="cuenta">Resumen de la cuenta</option>' : '<option value="">Nueva publicación</option>') +
      CC.pubs.slice(0, 60).map((p) => '<option value="' + p.id + '"' + (sel === p.id ? ' selected' : '') + '>' + esc(CC.nomRed(p.red) + ' · ' + App.fCorta(App.iso(new Date(p.fecha_hora))) + ' · ' + (p.texto || '').slice(0, 40)) + '</option>').join('') + '</select>';
  }
  function pintarCola() {
    const c = raiz && raiz.querySelector('#mCola'); if (!c) return;
    if (!cola.length) { c.innerHTML = ''; return; }
    c.innerHTML = cola.map((it, i) => '<div class="det-imp" data-i="' + i + '"><div class="fila"><b class="grow">' + esc(it.nombre) + '</b><button type="button" class="small ghost" data-quitar aria-label="Quitar">✕</button></div>' +
      (it.estado === 'leyendo' ? '<p class="sub">Leyendo…' + (it.avance != null ? ' ' + it.avance + '%' : '') + '</p>' : it.estado === 'error' ? '<p class="err">' + esc(it.error) + '</p>' :
        '<div class="sub">' + esc(TIPO[it.tipo] || it.tipo) + (it.origen ? ' · ' + esc(it.origen) : '') + '</div>' +
        (['cuenta', 'audiencia', 'contenido', 'pares'].includes(it.tipo) ? '<div class="fila" style="margin:6px 0">' + opcionesRed(it.red) + (it.red ? '' : '<span class="err" style="margin:0">Elige la red</span>') + '</div>' : '') +
        '<div style="margin-top:6px">' + resumenItem(it) + '</div>' + (it.tipo === 'desconocido' ? '<div class="btns"><button type="button" class="small" data-mapear>Aplicar</button></div>' : '')) + '</div>').join('') +
      '<div class="btns"><button type="button" class="ghost" id="mVaciar">Limpiar</button><button type="button" id="mGuardar">Guardar todo</button></div>';
    c.querySelectorAll('[data-k="red"]').forEach((s) => { s.onchange = () => { cola[+s.closest('[data-i]').dataset.i].red = s.value || null; pintarCola(); }; });
    c.querySelectorAll('[data-quitar]').forEach((b) => { b.onclick = () => { cola.splice(+b.closest('[data-i]').dataset.i, 1); pintarCola(); }; });
    c.querySelectorAll('[data-mapear]').forEach((b) => { b.onclick = () => mapear(+b.closest('[data-i]').dataset.i); });
    c.querySelector('#mVaciar').onclick = () => { cola = []; pintarCola(); };
    c.querySelector('#mGuardar').onclick = guardar;
  }
  async function mapear(i) {
    const it = cola[i], caja = raiz.querySelector('[data-i="' + i + '"]');
    const nuevos = [];
    caja.querySelectorAll('[data-col]').forEach((s) => { if (s.value) { const h = it.encabezados[+s.dataset.col]; mapeos[Importador.norm(h)] = s.value; nuevos.push({ owner: CC.cuenta.id, red: it.red || 'todas', columna_origen: h.slice(0, 80), columna_destino: s.value }); } });
    if (!nuevos.length) return App.toast('Elige al menos una columna');
    try { await App.q(App.sb.from('mapeos_import').upsert(nuevos, { onConflict: 'owner,red,columna_origen' })); } catch (e) { App.toast(e.message); }
    Object.assign(it, Importador.analizar(it.texto, it.nombre, mapeos));
    pintarCola();
  }

  async function guardar() {
    const b = raiz.querySelector('#mGuardar');
    const listos = cola.filter((it) => it.estado === 'listo' && it.tipo !== 'desconocido' && it.tipo !== 'vacio');
    if (listos.some((it) => ['cuenta', 'audiencia', 'contenido', 'pares'].includes(it.tipo) && !it.red)) return App.toast('Falta elegir la red en algún archivo');
    b.disabled = true; b.textContent = 'Guardando…';
    let n = 0;
    try {
      for (const it of listos) {
        const caja = raiz.querySelector('[data-i="' + cola.indexOf(it) + '"]');
        if (it.tipo === 'base') { const r = await App.rpc('base_importar', { p_empresa: CC.emp.id, p_filas: it.filas }); n += r.nuevas; continue; }
        if (it.tipo === 'pares') {
          const marcados = it.pares.filter((p, k) => { const c = caja.querySelector('[data-par="' + k + '"]'); return !c || c.checked; });
          const destino = (caja.querySelector('[data-sel="destino"]') || {}).value || 'cuenta';
          if (marcados.length && destino === 'cuenta') {
            const filas = marcados.map((p) => ({ fecha: App.hoy(), metrica: (p.clave === 'vistas' ? 'visualizaciones' : p.clave) + (it.periodo ? '_' + it.periodo + 'd' : ''), valor: p.valor }));
            n += (await App.rpc('metricas_importar', { p_empresa: CC.emp.id, p_red: it.red, p_tipo: 'cuenta', p_filas: filas })).filas;
          } else if (marcados.length) {
            const f = { publicacion_id: destino }; marcados.forEach((p) => { f[p.clave] = p.valor; });
            n += (await App.rpc('metricas_importar', { p_empresa: CC.emp.id, p_red: it.red, p_tipo: 'contenido', p_filas: [f] })).filas;
          }
          if ((it.lista || []).length) {
            const filas = it.lista.map((l, k) => { const s = caja.querySelector('[data-sel="lista' + k + '"]'); return s && s.value ? { publicacion_id: s.value, vistas: l.vistas } : { texto: l.texto, vistas: l.vistas }; });
            n += (await App.rpc('metricas_importar', { p_empresa: CC.emp.id, p_red: it.red, p_tipo: 'contenido', p_filas: filas })).filas;
          }
          continue;
        }
        // Lotes de 1.000 filas.
        for (let k = 0; k < it.filas.length; k += 1000) {
          const r = await App.rpc('metricas_importar', { p_empresa: CC.emp.id, p_red: it.red, p_tipo: it.tipo, p_filas: it.filas.slice(k, k + 1000) });
          n += r.filas;
        }
      }
      cola = cola.filter((it) => !listos.includes(it));
      await CC.cargarEmpresa();
      App.toast('✅ ' + n + ' datos guardados');
      pintar(raiz);
    } catch (e) { App.toast(e.message); b.disabled = false; b.textContent = 'Guardar todo'; }
  }

  /* ---------- lectura de resultados ---------- */
  function resumen() {
    const hasta = App.hoy(), desde = App.sumarDias(hasta, -dias + 1), antes = App.sumarDias(desde, -dias);
    const redes = ['tiktok', 'instagram', 'facebook'].filter((r) => CC.mcuenta.some((m) => m.red === r && !/_\d+d$/.test(m.metrica)));
    const cab = '<div class="chips">' + [7, 28, 90].map((d) => '<button type="button" data-dias="' + d + '" class="' + (d === dias ? 'on' : '') + '">' + d + ' días</button>').join('') + '</div>';
    if (!redes.length) return '<div class="card"><h3>Tu cuenta</h3><p class="empty">Importa los archivos de Meta Business Suite o TikTok Studio para ver aquí cómo va cada red.</p></div>';
    return '<div class="card"><h3>Tu cuenta</h3>' + cab + redes.map((r) => {
      const vistos = {};
      const suma = (a, b) => { const o = {}; CC.mcuenta.filter((m) => m.red === r && m.fecha >= a && m.fecha <= b && !/_\d+d$/.test(m.metrica)).forEach((m) => { o[m.metrica] = (o[m.metrica] || 0) + Number(m.valor); (vistos[a] = vistos[a] || {})[m.metrica + m.fecha] = 1; }); return o; };
      const ahora = suma(desde, hasta), prev = suma(antes, App.sumarDias(desde, -1));
      // Solo se compara si el período anterior tiene datos de casi todos sus días (si no, el % engaña).
      const cubierto = (k) => Object.keys(vistos[antes] || {}).filter((x) => x.startsWith(k + '2')).length >= Math.ceil(dias * 0.8);
      const ks = Object.keys(ahora).sort((a, b) => (a === 'visualizaciones' ? -1 : b === 'visualizaciones' ? 1 : 0));
      return '<h3 style="margin-top:12px">' + CC.red(r) + '</h3><div class="grid-num">' + ks.map((k) => {
        const p = prev[k], v = ahora[k], d = p && cubierto(k) ? Math.round(((v - p) / p) * 100) : null;
        return '<div class="kpi"><b>' + CC.fmt(v) + '</b><span>' + esc(nom(k)) + (d != null ? ' · <span style="color:var(--' + (d >= 0 ? 'ok' : 'bad') + ')">' + (d >= 0 ? '▲' : '▼') + Math.abs(d) + '%</span>' : '') + '</span></div>';
      }).join('') + '</div>' + CC.tip(r, ks.includes('espectadores_nuevos') ? 'espectadores_nuevos' : 'vistas');
    }).join('') + '<p class="sub">Los % comparan con los ' + dias + ' días anteriores (solo si están importados completos).</p></div>';
  }
  function topPublicaciones() {
    const ult = {};
    CC.metricas.forEach((m) => { if (!ult[m.publicacion_id] || m.fecha_corte > ult[m.publicacion_id].fecha_corte) ult[m.publicacion_id] = m; });
    const L = CC.pubs.filter((p) => ult[p.id]).sort((a, b) => (ult[b.id].vistas || 0) - (ult[a.id].vistas || 0)).slice(0, 10);
    const sinMedir = CC.pubs.filter((p) => !ult[p.id]).slice(0, 5);
    const n = (v) => v == null ? '—' : CC.fmt(v);
    return '<div class="card"><h3>Publicaciones que más rinden</h3>' + (L.length ? '<ul class="list pubs">' + L.map((p) => { const m = ult[p.id];
      return '<li><div class="fila">' + CC.red(p.red) + '<span class="sub grow">' + App.fCorta(String(p.fecha_hora).slice(0, 10)) + '</span><button class="small ghost" data-anotar="' + p.id + '">' + (m.clientes_generados ? '🎯 ' + m.clientes_generados : 'Anotar') + '</button></div>' +
        '<div class="txt">' + esc(p.texto || '(importada)') + '</div><div class="nums"><span><b>' + n(m.vistas) + '</b> vistas</span><span><b>' + n(m.compartidos) + '</b> compartidos</span><span><b>' + n(m.guardados) + '</b> guardados</span></div></li>'; }).join('') + '</ul>'
      : '<p class="empty">Aún no hay métricas por publicación.</p>') +
      (sinMedir.length ? '<b class="sub">Publicadas sin medir</b><ul class="list">' + sinMedir.map((p) => '<li><div class="fila"><span class="grow">' + CC.red(p.red) + ' ' + esc((p.texto || '').slice(0, 60)) + '</span><button class="small" data-anotar="' + p.id + '">Anotar</button></div></li>').join('') + '</ul>' : '') +
      CC.tip('todas', 'clientes_generados') + '</div>';
  }
  function ranking() {
    if (!CC.rend || !CC.rend.n) return '';
    const fila = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => '<tr><td>' + esc(n(k)) + '</td><td>' + v.toFixed(2) + '×</td></tr>').join('');
    return '<div class="card"><h3>Qué ganchos y temas ganan</h3><p class="sub" style="margin-top:0">Según ' + CC.rend.n + ' publicaciones medidas. 1× = tu promedio; el motor da más espacio a lo que está sobre 1.</p>' +
      '<table class="tabla"><thead><tr><th>Gancho</th><th>Rinde</th></tr></thead><tbody>' + fila(CC.rend.estructura, CC.nombreEstructura) + '</tbody></table>' +
      '<table class="tabla" style="margin-top:10px"><thead><tr><th>Tema</th><th>Rinde</th></tr></thead><tbody>' + fila(CC.rend.tema, (t) => t) + '</tbody></table></div>';
  }
  function audiencia() {
    if (!CC.audiencia.length) return '';
    const ult = CC.audiencia.reduce((a, x) => (x.fecha_corte > a ? x.fecha_corte : a), '');
    const de = (dim) => CC.audiencia.filter((a) => a.fecha_corte === ult && a.dimension === dim).sort((a, b) => b.porcentaje - a.porcentaje).slice(0, 5);
    const bloque = (t, L, pct) => L.length ? '<b class="sub">' + t + '</b><ul class="list">' + L.map((a) => '<li><div class="fila"><span class="grow">' + esc(a.valor) + ' <span class="sub">' + CC.nomRed(a.red) + '</span></span><b>' + (pct ? String(a.porcentaje).replace('.', ',') + '%' : CC.fmt(a.porcentaje)) + '</b></div></li>').join('') + '</ul>' : '';
    return '<div class="card"><h3>Tu público</h3>' + bloque('Edad y sexo', de('edad_sexo'), true) + bloque('Ciudades', de('ciudad'), true) + bloque('Países', de('pais'), true) + bloque('Horas de más actividad', de('hora'), true) + bloque('Formatos', de('formato')) + '</div>';
  }

  /* ---------- ciclo mensual: descargar, resumir y liberar espacio ---------- */
  const MES = (m) => { const t = new Date(m + '-15T12:00:00').toLocaleDateString('es-CL', { month: 'long', year: 'numeric' }); return t[0].toUpperCase() + t.slice(1); };
  function ciclo() {
    const actual = App.hoy().slice(0, 7);
    const abiertos = Array.from(new Set(CC.mcuenta.map((m) => m.fecha.slice(0, 7)))).filter((m) => m < actual).sort();
    const cerrados = Array.from(new Set(CC.meses.map((m) => String(m.mes).slice(0, 7)))).sort().reverse().slice(0, 12);
    const val = (mes, red, k) => { const x = CC.meses.find((m) => String(m.mes).slice(0, 7) === mes && m.red === red && m.metrica === k); return x ? Number(x.valor) : null; };
    return '<div class="card"><h3>🗂️ Ciclo mensual</h3><p class="sub" style="margin-top:0">Cada mes terminado: descargas su Excel, queda un resumen para comparar y se borra lo diario para no llenar el servidor. Tus ideas no se borran: así ningún gancho se repite.</p>' +
      (abiertos.length ? '<ul class="list">' + abiertos.map((m) => '<li><div class="fila"><span class="grow"><b>' + MES(m) + '</b><span class="sub"> · ' + CC.mcuenta.filter((x) => x.fecha.startsWith(m)).length + ' filas diarias</span></span><button class="small" data-cerrar-mes="' + m + '">⬇️ Cerrar mes</button></div></li>').join('') + '</ul>'
        : '<p class="empty" style="padding:8px 0">No hay meses por cerrar.</p>') +
      (cerrados.length ? '<b class="sub">Meses cerrados</b><div class="scroll-x"><table class="tabla"><thead><tr><th>Mes</th><th>Visualiz.</th><th>Seguid.</th><th>Publicadas</th><th>🎯</th></tr></thead><tbody>' +
        cerrados.map((m) => { const s = (k) => ['tiktok', 'instagram', 'facebook'].reduce((a, r) => a + (val(m, r, k) || 0), 0); return '<tr><td>' + MES(m) + '</td><td>' + CC.fmt(s('visualizaciones')) + '</td><td>' + CC.fmt(s('seguidores_nuevos')) + '</td><td>' + CC.fmt(s('pub_publicadas')) + '</td><td>' + CC.fmt(s('pub_clientes')) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') + '</div>';
  }
  async function cerrarMes(m) {
    if (!(await App.confirmar('Cerrar ' + MES(m) + ':\n1) Se descarga el Excel del mes.\n2) Queda el resumen para comparar.\n3) Se borran las filas diarias de ese mes.\n\nLas ideas y publicaciones se conservan.', 'Descargar y cerrar'))) return;
    try {
      const pubs = CC.pubs.filter((p) => String(p.fecha_hora).slice(0, 7) === m);
      const met = {}; CC.metricas.forEach((x) => { if (!met[x.publicacion_id] || x.fecha_corte > met[x.publicacion_id].fecha_corte) met[x.publicacion_id] = x; });
      const hojas = {
        Diario: CC.mcuenta.filter((x) => x.fecha.startsWith(m)).map((x) => ({ red: x.red, fecha: x.fecha, metrica: x.metrica, valor: Number(x.valor) })),
        Publicaciones: pubs.map((p) => { const x = met[p.id] || {}; return { red: p.red, fecha: String(p.fecha_hora).slice(0, 16).replace('T', ' '), texto: p.texto, link: p.link, vistas: x.vistas, compartidos: x.compartidos, guardados: x.guardados, me_gusta: x.me_gusta, comentarios: x.comentarios, clientes: x.clientes_generados }; }),
        Ideas: CC.ideas.filter((i) => (i.fecha_plan || '').startsWith(m)).map((i) => ({ fecha: i.fecha_plan, red: i.red, tema: i.tema, gancho: i.gancho, formato: i.formato, estado: i.estado })),
        Audiencia: CC.audiencia.map((a) => ({ red: a.red, fecha: a.fecha_corte, dimension: a.dimension, valor: a.valor, porcentaje: Number(a.porcentaje) }))
      };
      if (window.CFX_RESPALDO) CFX_RESPALDO.excel('cerebro-' + Importador.norm(CC.emp.nombre).replace(/ /g, '-') + '-' + m, hojas);
      const r = await App.rpc('cerrar_mes', { p_empresa: CC.emp.id, p_mes: m + '-01' });
      await CC.cargarEmpresa();
      App.toast('✅ ' + MES(m) + ' cerrado · ' + r.diarias_borradas + ' filas liberadas');
      pintar(raiz);
    } catch (e) { App.toast(e.message); }
  }

  CC.vistas.metricas = { pintar };
})();
