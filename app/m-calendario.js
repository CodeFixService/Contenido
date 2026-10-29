/* Cerebro · Calendario mensual: lo planificado (ideas con fecha) y lo publicado, por red. Tocas un día y ves su detalle. */
(function () {
  'use strict';
  const { esc } = App;
  let mes = null, dia = null;
  const DN = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  function delDia(d) {
    const ideas = CC.ideas.filter((i) => i.fecha_plan === d && i.estado !== 'descartado');
    const conIdea = new Set(ideas.map((i) => i.id));
    const sueltas = CC.pubs.filter((p) => App.iso(new Date(p.fecha_hora)) === d && !conIdea.has(p.idea_id));
    return { ideas: ideas.sort((a, b) => (a.hora || '').localeCompare(b.hora || '')), sueltas };
  }

  function pintar(el) {
    mes = mes || App.hoy().slice(0, 7);
    dia = dia || App.hoy();
    const [y, m] = mes.split('-').map(Number);
    const primero = new Date(y, m - 1, 1), ini = App.sumarDias(App.iso(primero), -((primero.getDay() + 6) % 7));
    const celdas = Array.from({ length: 42 }, (_, k) => App.sumarDias(ini, k));
    const hoy = App.hoy();
    const nm = primero.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' }), nombreMes = nm[0].toUpperCase() + nm.slice(1);
    const d = delDia(dia);
    el.innerHTML = CC.titulo('Calendario') +
      '<div class="fila" style="margin-bottom:8px"><button type="button" class="small ghost" id="cAnt" aria-label="Mes anterior">◀</button><b class="grow" style="text-align:center">' + esc(nombreMes) + '</b><button type="button" class="small ghost" id="cSig" aria-label="Mes siguiente">▶</button></div>' +
      '<div class="cal" id="cGrid">' + DN.map((x) => '<div class="dn">' + x + '</div>').join('') + celdas.map((c) => {
        const x = delDia(c);
        const pts = x.ideas.map((i) => '<span class="pt ' + (i.estado === 'publicado' ? 'ok' : esc(i.red)) + '"></span>').concat(x.sueltas.map(() => '<span class="pt ok"></span>')).slice(0, 8).join('');
        return '<button type="button" data-d="' + c + '" class="' + (c.slice(0, 7) !== mes ? 'otro ' : '') + (c === hoy ? 'hoy ' : '') + (c === dia ? 'sel' : '') + '">' + Number(c.slice(8)) + '<span class="puntos">' + pts + '</span></button>';
      }).join('') + '</div>' +
      '<p class="sub leyenda" style="margin:8px 0 0">' + [['tiktok', 'TikTok'], ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['historias', 'Historias'], ['ok', 'Publicada']].map(([k, t]) => '<span><span class="pt ' + k + '"></span>' + t + '</span>').join('') + '</p>' +
      '<div class="card" style="margin-top:12px"><h3>' + esc(App.fLarga(dia).replace(/^./, (c) => c.toUpperCase())) + '</h3>' +
      (d.ideas.length || d.sueltas.length ? '<ul class="list" id="cDia">' + d.ideas.map((i) => '<li data-id="' + i.id + '"><div class="cont"><div class="fila">' + CC.red(i.red) + '<b>' + esc(i.hora || '--:--') + '</b><span class="grow"></span>' + CC.est(i.estado) + '</div>' +
        '<div>' + esc(i.gancho) + '</div><div class="sub">' + esc(i.formato) + '</div><div class="btns">' +
        (i.estado === 'publicado' ? '<button class="small alt" data-a="metricas">📊 Métricas</button>' : '<button class="small ghost" data-a="programar">📅 Mover</button><button class="small okb" data-a="publicar">✅ Publicada</button>') + '</div></div></li>').join('') +
        d.sueltas.map((p) => '<li data-pub="' + p.id + '"><div class="cont"><div class="fila">' + CC.red(p.red) + '<b>' + new Date(p.fecha_hora).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + '</b><span class="grow"></span>' + CC.est('publicado') + '</div><div>' + esc(p.texto || '(importada)') + '</div><div class="btns"><button class="small alt" data-a="metricas">📊 Métricas</button></div></div></li>').join('') + '</ul>'
        : '<p class="empty">Nada este día.</p>') + '</div>';
    el.querySelector('#cAnt').onclick = () => { mes = mover(-1); pintar(el); };
    el.querySelector('#cSig').onclick = () => { mes = mover(1); pintar(el); };
    el.querySelector('#cGrid').onclick = (e) => { const b = e.target.closest('[data-d]'); if (b) { dia = b.dataset.d; if (dia.slice(0, 7) !== mes) mes = dia.slice(0, 7); pintar(el); } };
    const L = el.querySelector('#cDia');
    if (L) L.onclick = (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const li = b.closest('li');
      if (li.dataset.pub) { const p = CC.pubs.find((x) => x.id === li.dataset.pub); if (p) CC.anotarMetricas(p); return; }
      const i = CC.ideas.find((x) => x.id === li.dataset.id); if (!i) return;
      if (b.dataset.a === 'publicar') CC.publicar(i);
      else if (b.dataset.a === 'programar') CC.programar(i);
      else { const p = CC.pubs.find((x) => x.idea_id === i.id); if (p) CC.anotarMetricas(p); }
    };
  }
  function mover(n) { const [y, m] = mes.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  CC.vistas.calendario = { pintar };
})();
