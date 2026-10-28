/* Cerebro · Inicio: checklist de la semana (se marca sola según lo que haces), lo de hoy y el estado de la base. */
(function () {
  'use strict';
  const { esc } = App;

  function pintar(el) {
    const lun = CC.lunes(), hoy = App.hoy();
    const sem = CC.ideas.filter((i) => CC.enSemana(i.fecha_plan, lun) && i.estado !== 'descartado');
    const cuenta = (f) => sem.filter(f).length;
    const pedidas = cuenta((i) => i.estado !== 'pendiente');
    const recibidas = cuenta((i) => ['recibido', 'editado', 'programado', 'publicado'].includes(i.estado));
    const listas = cuenta((i) => ['editado', 'programado', 'publicado'].includes(i.estado));
    const publicadas = cuenta((i) => i.estado === 'publicado');
    const metricasSemana = CC.metricas.some((m) => m.fecha_corte >= lun) || CC.mcuenta.some((m) => m.fecha >= App.sumarDias(lun, -1));
    const pasos = [
      ['Revisar y generar las ideas de la semana', sem.length > 0, sem.length + ' ideas', 'ideas'],
      ['Mandar los pedidos de grabación', sem.length > 0 && pedidas >= sem.length, pedidas + ' de ' + sem.length + ' pedidas', 'pedidos'],
      ['Recibir el material', sem.length > 0 && recibidas >= sem.length, recibidas + ' de ' + sem.length + ' recibidas', 'ideas'],
      ['Editar y programar', sem.length > 0 && listas >= sem.length, listas + ' de ' + sem.length + ' listas', 'calendario'],
      ['Publicar', sem.length > 0 && publicadas >= sem.length, publicadas + ' de ' + sem.length + ' publicadas', 'calendario'],
      ['Domingo: importar métricas de las 3 redes', metricasSemana, metricasSemana ? 'importadas' : 'pendiente', 'metricas']
    ];
    const hechos = pasos.filter((p) => p[1]).length;
    const deHoy = CC.ideas.filter((i) => i.fecha_plan === hoy && i.estado !== 'descartado').sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
    const pend = CC.pedidos.filter((p) => p.estado === 'pedido');
    const cap = CC.ctx ? Motor.capacidad(CC.ctx) : { total: 0, libres: 0 };
    const pct = cap.total ? Math.round((cap.libres / cap.total) * 100) : 0;
    const semanasQuedan = Math.floor(cap.libres / Math.max(1, (+CC.emp.ritmo.tiktok || 0) + (+CC.emp.ritmo.instagram || 0) + (+CC.emp.ritmo.facebook || 0) + 7));
    el.innerHTML = CC.titulo('Hola' + (CC.cuenta.nombre ? ', ' + CC.cuenta.nombre.split(' ')[0] : ''), '<span class="sub">Semana del ' + App.fCorta(lun) + '</span>') +
      '<div class="card"><div class="fila"><h3 class="grow" style="margin:0">Tu semana</h3><b>' + hechos + '/' + pasos.length + '</b></div><div class="barra-cap"><div style="width:' + Math.round((hechos / pasos.length) * 100) + '%"></div></div>' +
      '<ul class="list check-sem">' + pasos.map((p) => '<li class="' + (p[1] ? 'ok' : '') + ' clic" data-ir="' + p[3] + '"><span class="ck">' + (p[1] ? '✓' : '') + '</span><div class="grow"><b>' + esc(p[0]) + '</b><div class="sub">' + esc(p[2]) + '</div></div></li>').join('') + '</ul></div>' +
      '<div class="card"><h3>Hoy</h3>' + (deHoy.length ? '<ul class="list">' + deHoy.map((i) => '<li class="clic" data-ir="ideas"><div class="fila">' + CC.red(i.red) + '<span class="sub">' + esc(i.hora || '') + '</span>' + CC.est(i.estado) + '</div><div style="margin-top:4px">' + esc(i.gancho) + '</div></li>').join('') + '</ul>' : '<p class="empty">Nada programado para hoy.</p>') + '</div>' +
      (pend.length ? '<div class="card"><h3>Pedidos esperando material (' + pend.length + ')</h3><ul class="list">' + pend.slice(0, 5).map((p) => '<li class="clic" data-ir="pedidos"><b>' + esc(p.para || 'Sin nombre') + '</b> <span class="sub">' + App.hace(p.fecha_pedido) + '</span></li>').join('') + '</ul></div>' : '') +
      '<div class="card"><div class="fila"><h3 class="grow" style="margin:0">Ganchos sin usar</h3><b>' + cap.libres + '</b></div><div class="barra-cap"><div style="width:' + pct + '%"></div></div>' +
      '<p class="sub" style="margin:0">' + (cap.total ? 'Te alcanzan para unas ' + semanasQuedan + ' semanas a tu ritmo.' : 'Carga la base para empezar.') + (cap.libres < 50 && cap.total ? ' <a href="#base">Recárgala</a>.' : '') + '</p></div>' +
      (CC.rend && CC.rend.n ? '<div class="card"><h3>Lo que mejor te funciona</h3>' + mejores() + '</div>' : '');
    el.onclick = (e) => { const x = e.target.closest('[data-ir]'); if (x) CC.ir(x.dataset.ir); };
  }

  function mejores() {
    const top = (o, nombre) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => '<li><div class="fila"><span class="grow">' + esc(nombre(k)) + '</span><b>' + (v >= 1 ? '▲ ' : '▼ ') + v.toFixed(1) + '×</b></div></li>').join('');
    return '<p class="sub" style="margin-top:0">1× = tu promedio. Lo que está arriba sale más seguido en las ideas nuevas.</p><b class="sub">Ganchos</b><ul class="list">' + top(CC.rend.estructura, CC.nombreEstructura) + '</ul><b class="sub">Temas</b><ul class="list">' + top(CC.rend.tema, (t) => t) + '</ul>';
  }

  CC.vistas.inicio = { pintar };
})();
