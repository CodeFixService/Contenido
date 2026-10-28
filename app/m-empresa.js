/* Cerebro · Empresa: perfil de marca, equipo que graba (para los pedidos), ritmo por red, nueva empresa, respaldo y cuenta. */
(function () {
  'use strict';
  const { esc } = App;
  let creando = false;

  function form(e) {
    e = e || { redes: ['tiktok', 'instagram', 'facebook'], ritmo: { tiktok: 7, instagram: 5, facebook: 5, historias: 4 }, equipo: [] };
    const r = Object.assign({ tiktok: 7, instagram: 5, facebook: 5, historias: 4 }, e.ritmo || {});
    const equipo = (e.equipo || []).length ? e.equipo : [{ nombre: '', tel: '' }];
    return '<form id="fEmp" class="card"><h3>' + (e.id ? 'Perfil de la empresa' : 'Nueva empresa') + '</h3>' +
      '<label for="eNom">Nombre</label><input id="eNom" maxlength="80" required value="' + esc(e.nombre || '') + '" placeholder="Ej: Ciclo Service">' +
      '<label for="eRub">Rubro</label><input id="eRub" maxlength="80" value="' + esc(e.rubro || '') + '" placeholder="Ej: taller de bicicletas">' +
      '<label for="ePub">Público (a quién le hablas)</label><input id="ePub" maxlength="300" value="' + esc(e.publico || '') + '" placeholder="Ej: hombres 25–44 que andan en bici en Santiago">' +
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

  function pintar(el) {
    const e = creando || !CC.emp ? null : CC.emp;
    el.innerHTML = CC.titulo(e ? 'Empresa' : 'Tu empresa') +
      (!CC.empresas.length ? '<div class="card"><h3>¡Bienvenido a Cerebro! 🧠</h3><p class="muted" style="margin:0">Crea tu empresa, carga su base de contenido y el motor te arma la semana: ganchos que no se repiten, pedidos por WhatsApp, calendario y métricas.</p></div>' : '') +
      form(e) +
      (e ? '<div class="card"><h3>Base de contenido de otra empresa</h3><p class="sub" style="margin-top:0">Para un cliente nuevo: crea la empresa, copia el prompt, pégalo en un chat gratis y pega el CSV que te devuelve en Base.</p><div class="btns" style="flex-wrap:wrap"><button class="small" id="eNueva">＋ Nueva empresa</button><button class="small ghost" id="ePrompt">🧠 Prompt de esta empresa</button></div></div>' +
        '<div class="card"><h3>Mi cuenta</h3><p class="muted" style="margin-top:0">' + esc(CC.cuenta.email) + ' · ' + (CC.cuenta.premium ? 'Pro' + (CC.cuenta.premium_hasta ? ' hasta ' + App.fCorta(CC.cuenta.premium_hasta.slice(0, 10)) : '') : 'Gratis') + '</p>' +
        '<div class="btns" style="flex-wrap:wrap"><button class="small ghost" id="eResp">⬇️ Respaldo Excel</button>' + (CC.cuenta.premium ? '' : '<button class="small gold" id="ePro">⭐ Pasar a Pro</button>') + '<button class="small danger" id="eBorrar">Borrar esta empresa</button><button class="small ghost" onclick="App.salir()">Cerrar sesión</button></div></div>' : '');
    const f = el.querySelector('#fEmp');
    f.onsubmit = (ev) => { ev.preventDefault(); guardar(el, e); };
    el.querySelector('#eMasEq').onclick = () => el.querySelector('#eEq').insertAdjacentHTML('beforeend', filaEq({}));
    el.querySelector('#eEq').onclick = (ev) => { const q = ev.target.closest('[data-q]'); if (q) q.parentNode.remove(); };
    const c = el.querySelector('#eCancel'); if (c) c.onclick = () => { creando = false; pintar(el); };
    if (!e) return;
    el.querySelector('#eNueva').onclick = nueva;
    el.querySelector('#ePrompt').onclick = () => CC.vistas.base.verPrompt('nueva', CC.emp);
    el.querySelector('#eResp').onclick = respaldo;
    const pro = el.querySelector('#ePro'); if (pro) pro.onclick = () => window.CFX_PAGOS && CFX_PAGOS.abrir({ rpc: App.rpc });
    el.querySelector('#eBorrar').onclick = async () => {
      if (!(await App.confirmar('¿Borrar "' + CC.emp.nombre + '" con toda su base, ideas, pedidos y métricas? No se puede deshacer.\nDescarga antes el respaldo si lo necesitas.', 'Borrar todo'))) return;
      try { await App.q(App.sb.from('empresas').delete().eq('id', CC.emp.id)); CC.emp = null; await CC.cargar(); CC.ir(CC.emp ? 'inicio' : 'empresa'); App.toast('Empresa borrada'); } catch (er) { App.toast(er.message); }
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
