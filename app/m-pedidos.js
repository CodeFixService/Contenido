/* Cerebro · Pedidos de grabación: lo pedido, lo recibido, reenviar por WhatsApp y marcar cuando llega el material. */
(function () {
  'use strict';
  const { esc } = App;
  let filtro = 'pedido';

  function pintar(el) {
    const L = CC.pedidos.filter((p) => filtro === 'todos' || p.estado === filtro);
    const n = (e) => CC.pedidos.filter((p) => p.estado === e).length;
    const sinPedir = CC.ideas.filter((i) => i.estado === 'pendiente' && i.fecha_plan && i.fecha_plan >= CC.lunes()).length;
    el.innerHTML = CC.titulo('Pedidos', '<span class="sub">' + n('pedido') + ' esperando</span>') +
      (sinPedir ? '<div class="aviso"><div class="grow">Tienes ' + sinPedir + ' ideas de esta semana sin pedir.</div><button class="small" id="pIr">Ver</button></div>' : '') +
      '<div class="chips" id="pFil">' + [['pedido', 'Esperando (' + n('pedido') + ')'], ['recibido', 'Recibidos'], ['cancelado', 'Cancelados'], ['todos', 'Todos']].map(([k, t]) => '<button type="button" data-f="' + k + '" class="' + (k === filtro ? 'on' : '') + '">' + t + '</button>').join('') + '</div>' +
      (L.length ? L.map(fila).join('') : '<p class="empty">' + (filtro === 'pedido' ? 'No hay pedidos esperando. Pide desde una idea con 📲.' : 'Nada por aquí.') + '</p>');
    el.querySelector('#pFil').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { filtro = b.dataset.f; pintar(el); } };
    const ir = el.querySelector('#pIr'); if (ir) ir.onclick = () => { CC.ir('ideas'); };
    el.onclick = (e) => clic(e, el);
  }

  function fila(p) {
    const i = CC.ideas.find((x) => x.id === p.idea_id);
    return '<div class="card" data-id="' + p.id + '"><div class="fila"><b class="grow">' + esc(p.para || 'Sin nombre') + '</b>' + CC.est(p.estado) + '</div>' +
      '<p class="sub" style="margin:2px 0 6px">Pedido ' + App.hace(p.fecha_pedido) + (p.fecha_recibido ? ' · recibido ' + App.hace(p.fecha_recibido) : '') + (i && i.fecha_plan ? ' · para el ' + App.fCorta(i.fecha_plan) : '') + '</p>' +
      (i ? '<div style="margin-bottom:6px">' + CC.red(i.red) + ' <b>' + esc(i.gancho) + '</b></div>' : '') +
      '<details><summary class="sub">Ver mensaje</summary><p style="white-space:pre-line;font-size:13.5px">' + esc(p.instrucciones) + '</p></details>' +
      '<div class="btns">' + (p.estado === 'pedido' ? (p.tel ? '<button class="ghost small" data-a="wa">💬 Recordar</button>' : '') + '<button class="ghost small" data-a="cancelar">Cancelar</button><button class="small okb" data-a="recibido">📥 Recibido</button>'
        : p.estado === 'recibido' ? '<button class="ghost small" data-a="pedido">↩️ Volver a esperando</button>' : '<button class="ghost small" data-a="pedido">↩️ Reactivar</button>') + '</div></div>';
  }

  async function clic(e, el) {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const p = CC.pedidos.find((x) => x.id === b.closest('[data-id]').dataset.id); if (!p) return;
    const a = b.dataset.a;
    try {
      if (a === 'wa') { window.open(App.wa(p.tel, '👋 ¿Cómo va este video?\n\n' + p.instrucciones), '_blank'); return; }
      const cambios = { estado: a === 'cancelar' ? 'cancelado' : a, fecha_recibido: a === 'recibido' ? new Date().toISOString() : null };
      const r = await App.q(App.sb.from('pedidos').update(cambios).eq('id', p.id).select('*').single());
      Object.assign(p, r);
      if (p.idea_id) {
        const i = CC.ideas.find((x) => x.id === p.idea_id);
        if (i && a === 'recibido' && ['pendiente', 'pedido'].includes(i.estado)) await CC.actualizarIdea(i.id, { estado: 'recibido' });
        if (i && a === 'cancelar' && i.estado === 'pedido') await CC.actualizarIdea(i.id, { estado: 'pendiente' });
        if (i && a === 'pedido' && ['pendiente', 'recibido'].includes(i.estado)) await CC.actualizarIdea(i.id, { estado: 'pedido' });
      }
      App.toast(a === 'recibido' ? 'Material recibido 📥' : 'Listo');
      pintar(el);
    } catch (er) { App.toast(er.message); }
  }

  CC.vistas.pedidos = { pintar };
})();
