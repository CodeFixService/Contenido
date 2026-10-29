/* Cerebro · Ideas: tarjetas con 🔄 (otra opción) y 🔒 (fijar) en cada campo, generar la semana y mover cada idea por su ciclo. */
(function () {
  'use strict';
  const { esc } = App;
  let filtro = 'semana', lunes = null, el = null;
  const CAMPOS = [['gancho', 'Gancho'], ['formato', 'Formato'], ['toma', 'Qué grabar'], ['texto_pantalla', 'Pantalla'], ['cta', 'Llamado'], ['red', 'Red']];
  const FILTROS = [['semana', 'Esta semana'], ['pendiente', 'Sin pedir'], ['grabar', 'Por grabar'], ['listas', 'Por publicar'], ['publicado', 'Publicadas'], ['todas', 'Todas']];

  function lista() {
    const L = CC.ideas.filter((i) => i.estado !== 'descartado' || filtro === 'todas');
    if (filtro === 'semana') return L.filter((i) => CC.enSemana(i.fecha_plan, lunes)).sort(orden);
    if (filtro === 'pendiente') return L.filter((i) => i.estado === 'pendiente').sort(orden);
    if (filtro === 'grabar') return L.filter((i) => ['pedido', 'recibido'].includes(i.estado)).sort(orden);
    if (filtro === 'listas') return L.filter((i) => ['editado', 'programado'].includes(i.estado)).sort(orden);
    if (filtro === 'publicado') return L.filter((i) => i.estado === 'publicado').sort((a, b) => (b.fecha_plan || '').localeCompare(a.fecha_plan || ''));
    return L;
  }
  const orden = (a, b) => (a.fecha_plan || '9').localeCompare(b.fecha_plan || '9') || (a.hora || '').localeCompare(b.hora || '') || a.red.localeCompare(b.red);

  function tarjeta(i) {
    const bl = i.bloqueados || [];
    const val = (k) => k === 'red' ? CC.red(i.red) + ' <span class="sub">' + (i.fecha_plan ? App.fCorta(i.fecha_plan) + ' · ' : '') + esc(i.hora || '') + '</span>'
      : k === 'formato' ? esc(i.formato) + (i.duracion_seg && !/Carrusel/.test(i.formato) ? ' <span class="sub">· ' + i.duracion_seg + ' s</span>' : '') : esc(Motor.may(i[k]) || '—');
    const campos = CAMPOS.map(([k, t]) => '<div class="campo ' + k + '"><span class="et">' + t + '</span><div class="val">' + val(k) + '</div>' +
      (i.estado === 'publicado' ? '' : '<div class="acc"><button type="button" data-r="' + k + '" aria-label="Otra opción de ' + t + '" title="Otra opción">🔄</button>' +
      '<button type="button" data-l="' + k + '" class="' + (bl.includes(k) ? 'lock-on' : '') + '" aria-label="' + (bl.includes(k) ? 'Desbloquear ' : 'Fijar ') + t + '" title="Fijar">' + (bl.includes(k) ? '🔒' : '🔓') + '</button></div>') + '</div>').join('');
    const pub = CC.pubs.find((p) => p.idea_id === i.id);
    const bot = i.estado === 'publicado'
      ? '<button type="button" data-a="metricas" class="alt">📊 Métricas</button><button type="button" data-a="mas" class="ghost">⋯</button>'
      : '<button type="button" data-a="pedir">📲 Pedir</button><button type="button" data-a="programar" class="alt">📅 Fecha</button><button type="button" data-a="publicar" class="okb">✅ Publicada</button><button type="button" data-a="mas" class="ghost">⋯</button>';
    return '<article class="idea ' + esc(i.estado) + '" data-id="' + i.id + '"><div class="cab"><span class="pill">' + esc(i.tema) + '</span><span class="sub grow">' + esc(CC.nombreEstructura(i.estructura)) + '</span>' + CC.est(i.estado) + '</div>' +
      campos + (i.nota ? '<p class="sub" style="margin:6px 0 0">📝 ' + esc(i.nota) + '</p>' : '') + (pub && pub.link ? '<p class="sub" style="margin:6px 0 0"><a href="' + esc(pub.link) + '" target="_blank" rel="noopener">Ver publicación</a></p>' : '') +
      '<div class="botones' + (i.estado === 'publicado' ? '" style="grid-template-columns:1fr 60px' : '') + '">' + bot + '</div></article>';
  }

  function pintar(raiz) {
    el = raiz;
    lunes = lunes || CC.lunes();
    const L = lista();
    const cap = CC.ctx ? Motor.capacidad(CC.ctx) : { libres: 0 };
    el.innerHTML = CC.titulo('Ideas', '<button type="button" class="small" id="iGen">＋ Generar</button>') +
      '<div class="chips" id="iFil">' + FILTROS.map(([k, t]) => '<button type="button" data-f="' + k + '" class="' + (k === filtro ? 'on' : '') + '">' + t + '</button>').join('') + '</div>' +
      (filtro === 'semana' ? '<div class="fila nav-sem" style="margin-bottom:10px"><button type="button" class="small ghost" id="iAnt" aria-label="Semana anterior">◀</button><b class="grow" style="text-align:center">Semana del ' + App.fCorta(lunes) + '</b><button type="button" class="small ghost" id="iSig" aria-label="Semana siguiente">▶</button></div>' : '') +
      (cap.libres < 50 && CC.base.length ? '<div class="aviso warn"><div class="grow">Quedan ' + cap.libres + ' ganchos sin usar. Recarga la base para seguir sin repetir.</div><button class="small" onclick="CC.ir(\'base\')">Base</button></div>' : '') +
      (!CC.base.length ? '<div class="card"><h3>Primero carga la base de contenido</h3><p class="muted">Es la materia prima del motor. Usa la plantilla de bicicletas o pega la de tu rubro.</p><button onclick="CC.ir(\'base\')">Ir a la base</button></div>' :
      L.length ? '<div class="grid-ideas">' + L.map(tarjeta).join('') + '</div>' : '<p class="empty">' + (filtro === 'semana' ? 'Sin ideas para esta semana. Toca "＋ Generar".' : 'Nada por aquí.') + '</p>');
    el.querySelector('#iGen').onclick = generar;
    el.querySelector('#iFil').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { filtro = b.dataset.f; pintar(el); } };
    const a = el.querySelector('#iAnt'), s = el.querySelector('#iSig');
    if (a) a.onclick = () => { lunes = App.sumarDias(lunes, -7); pintar(el); };
    if (s) s.onclick = () => { lunes = App.sumarDias(lunes, 7); pintar(el); };
    el.onclick = clic;
  }

  async function clic(e) {
    const card = e.target.closest('.idea'); if (!card) return;
    const i = CC.ideas.find((x) => x.id === card.dataset.id); if (!i) return;
    const r = e.target.closest('[data-r]'), l = e.target.closest('[data-l]'), a = e.target.closest('[data-a]');
    try {
      if (r) {
        if ((i.bloqueados || []).includes(r.dataset.r)) return App.toast('Ese campo está fijado 🔒');
        r.disabled = true;
        const n = Motor.refrescar(CC.ctx, i, r.dataset.r);
        const cambios = {};
        ['combo', 'tema', 'estructura', 'gancho', 'elemento', 'formato', 'duracion_seg', 'toma', 'texto_pantalla', 'cta', 'red', 'hora'].forEach((k) => { if (n[k] !== i[k]) cambios[k] = n[k]; });
        if (!Object.keys(cambios).length) { r.disabled = false; return App.toast(r.dataset.r === 'gancho' ? 'No quedan ganchos nuevos para este tema' : 'No hay otra opción'); }
        const g = await CC.actualizarIdea(i.id, cambios);
        card.outerHTML = tarjeta(g);
      } else if (l) {
        const bl = new Set(i.bloqueados || []);
        bl.has(l.dataset.l) ? bl.delete(l.dataset.l) : bl.add(l.dataset.l);
        const g = await CC.actualizarIdea(i.id, { bloqueados: Array.from(bl) });
        card.outerHTML = tarjeta(g);
      } else if (a) {
        const k = a.dataset.a;
        if (k === 'pedir') CC.pedir(i);
        else if (k === 'programar') CC.programar(i);
        else if (k === 'publicar') CC.publicar(i);
        else if (k === 'metricas') { const p = CC.pubs.find((x) => x.idea_id === i.id); if (p) CC.anotarMetricas(p); else CC.publicar(i); }
        else if (k === 'mas') mas(i);
      }
    } catch (er) { App.toast(er.message); if (r) r.disabled = false; }
  }

  function mas(i) {
    const op = [['recibido', '📥 Material recibido'], ['editado', '✂️ Editado'], ['pendiente', '🔄 Volver a sin pedir'], ['nota', '📝 Nota'], ['copiar', '📋 Copiar todo'],
      [i.estado === 'descartado' ? 'pendiente' : 'descartado', i.estado === 'descartado' ? '🔄 Recuperar' : '🗑️ Descartar']];
    const d = App.modal('<h2>' + esc(i.gancho) + '</h2><div id="mOp">' + op.map(([k, t]) => '<button type="button" class="opc op-fila" data-k="' + k + '">' + t + '</button>').join('') + '</div><div class="btns"><button class="ghost" data-cerrar>Cerrar</button></div>');
    d.querySelector('#mOp').onclick = async (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      const k = b.dataset.k;
      try {
        if (k === 'nota') {
          d.close();
          const n = App.modal('<h2>📝 Nota</h2><textarea id="nTxt" rows="4" maxlength="500">' + esc(i.nota || '') + '</textarea><div class="btns"><button class="ghost" data-cerrar>Cancelar</button><button id="nOk">Guardar</button></div>');
          n.querySelector('#nOk').onclick = async () => { await CC.actualizarIdea(i.id, { nota: n.querySelector('#nTxt').value.trim() }); n.close(); pintar(el); };
          return;
        }
        if (k === 'copiar') {
          const t = i.gancho + '\n\nFormato: ' + i.formato + '\nQué grabar: ' + i.toma + '\nTexto en pantalla: ' + i.texto_pantalla + '\nLlamado: ' + i.cta + '\nRed: ' + CC.nomRed(i.red) + ' ' + (i.fecha_plan || '') + ' ' + (i.hora || '');
          await navigator.clipboard.writeText(t); App.toast('Copiado'); d.close(); return;
        }
        await CC.actualizarIdea(i.id, { estado: k });
        if (k === 'recibido') { const p = CC.pedidos.find((x) => x.idea_id === i.id && x.estado === 'pedido'); if (p) await App.q(App.sb.from('pedidos').update({ estado: 'recibido', fecha_recibido: new Date().toISOString() }).eq('id', p.id)).then(() => { p.estado = 'recibido'; }); }
        d.close(); pintar(el);
      } catch (er) { App.toast(er.message); }
    };
  }

  // Generar: la semana completa según el ritmo de la empresa, o una idea suelta.
  function generar() {
    if (!CC.base.length) { App.toast('Primero carga la base de contenido'); return CC.ir('base'); }
    const r = Object.assign({ tiktok: 7, instagram: 5, facebook: 5, historias: 4 }, CC.emp.ritmo || {});
    const lun = lunes && lunes >= CC.lunes() ? lunes : CC.lunes();
    const prox = App.sumarDias(CC.lunes(), 7);
    const ya = (l) => CC.ideas.filter((i) => CC.enSemana(i.fecha_plan, l) && i.estado !== 'descartado').length;
    const cap = Motor.capacidad(CC.ctx);
    const d = App.modal('<h2>✨ Generar ideas</h2><p class="muted" style="margin-top:0">Quedan <b>' + cap.libres + '</b> ganchos sin usar.</p>' +
      '<label for="gSem">Semana</label><select id="gSem"><option value="' + CC.lunes() + '">Esta semana (desde ' + App.fCorta(CC.lunes()) + ') · ' + ya(CC.lunes()) + ' ya hechas</option><option value="' + prox + '"' + (lun === prox ? ' selected' : '') + '>Próxima semana (desde ' + App.fCorta(prox) + ') · ' + ya(prox) + ' ya hechas</option></select>' +
      '<label>Cuántas por red (historias = 1 idea diaria)</label><div class="ritmo">' + ['tiktok', 'instagram', 'facebook', 'historias'].map((k) =>
        '<label>' + CC.nomRed(k) + '<input type="number" min="0" max="21" id="gR_' + k + '" value="' + (+r[k] || 0) + '"></label>').join('') + '</div>' +
      '<p class="sub">TikTok prueba todo · Instagram y Facebook suben lo que gana. Cada gancho se usa una sola vez.</p>' +
      '<div class="btns"><button class="ghost" id="gUna">Solo una idea</button><button id="gOk">Generar semana</button></div>');
    d.querySelector('#gOk').onclick = async () => {
      const rit = {}; ['tiktok', 'instagram', 'facebook', 'historias'].forEach((k) => { rit[k] = Math.max(0, Math.min(21, +d.querySelector('#gR_' + k).value || 0)); });
      const l = d.querySelector('#gSem').value;
      if (ya(l) && !(await App.confirmar('Esa semana ya tiene ' + ya(l) + ' ideas. ¿Agregar ' + (rit.tiktok + rit.instagram + rit.facebook + (rit.historias ? 7 : 0)) + ' más?', 'Agregar'))) return;
      const b = d.querySelector('#gOk'); b.disabled = true; b.textContent = 'Generando…';
      try {
        const nuevas = Motor.semana(CC.ctx, rit, l);
        if (!nuevas.length) throw new Error('No quedan combinaciones: recarga la base.');
        await CC.guardarNuevas(nuevas);
        if (JSON.stringify(rit) !== JSON.stringify(r)) App.q(App.sb.from('empresas').update({ ritmo: rit }).eq('id', CC.emp.id)).then(() => { CC.emp.ritmo = rit; }).catch(() => {});
        d.close(); filtro = 'semana'; lunes = l; CC.ir('ideas');
        App.toast(nuevas.length + ' ideas nuevas, ninguna repetida');
      } catch (e) { App.toast(e.message); b.disabled = false; b.textContent = 'Generar semana'; CC.armarMotor(); }
    };
    d.querySelector('#gUna').onclick = () => {
      d.close();
      const u = App.modal('<h2>Una idea</h2><label for="uRed">Red</label><select id="uRed">' + Motor.REDES.map((x) => '<option value="' + x + '">' + CC.nomRed(x) + '</option>').join('') + '</select>' +
        '<label for="uTema">Tema</label><select id="uTema"><option value="">El que toque</option>' + CC.ctx.temas.map((t) => '<option>' + esc(t) + '</option>').join('') + '</select>' +
        '<label for="uF">Fecha</label><input id="uF" type="date" value="' + App.hoy() + '"><div class="btns"><button class="ghost" data-cerrar>Cancelar</button><button id="uOk">Crear</button></div>');
      u.querySelector('#uOk').onclick = async () => {
        try {
          const n = Motor.nueva(CC.ctx, u.querySelector('#uRed').value, u.querySelector('#uF').value || null, { tema: u.querySelector('#uTema').value || null });
          if (!n) throw new Error('No quedan ganchos para ese tema');
          await CC.guardarNuevas([n]); u.close(); filtro = 'pendiente'; CC.ir('ideas');
        } catch (e) { App.toast(e.message); CC.armarMotor(); }
      };
    };
  }

  CC.vistas.ideas = { pintar, generar };
})();
