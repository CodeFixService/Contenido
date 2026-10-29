/* Cerebro · Base de contenido: la materia prima del motor (por tema y categoría), plantillas, importar y el prompt para recargarla. */
(function () {
  'use strict';
  const { esc } = App;
  const CATS = [['parte', 'Partes'], ['sintoma', 'Síntomas'], ['error', 'Errores'], ['mito', 'Mitos'], ['dato', 'Datos'], ['costo', 'Costos'], ['idea_video', 'Ideas de video'], ['cta', 'Llamados'], ['toma', 'Tomas'], ['estructura_gancho', 'Estructuras de gancho'], ['formato', 'Formatos']];
  const nomCat = (c) => (CATS.find((x) => x[0] === c) || [c, c])[1];
  let abierto = null;

  function pintar(el) {
    if (!CC.emp) { el.innerHTML = CC.titulo('Base') + '<p class="empty">Primero crea tu empresa.</p><button onclick="CC.ir(\'empresa\')">Crear empresa</button>'; return; }
    const cap = Motor.capacidad(CC.ctx);
    const temas = {};
    CC.base.forEach((b) => { const t = (temas[b.tema] = temas[b.tema] || {}); t[b.categoria] = (t[b.categoria] || 0) + 1; });
    const lista = Object.keys(temas).sort((a, b) => (a === 'General') - (b === 'General') || a.localeCompare(b));
    el.innerHTML = CC.titulo('Base de contenido', '<span class="sub">' + CC.base.length + ' filas</span>') +
      '<div class="card"><div class="fila"><h3 class="grow" style="margin:0">Ganchos sin usar</h3><b>' + cap.libres + ' / ' + cap.total + '</b></div>' +
      '<div class="barra-cap"><div style="width:' + (cap.total ? Math.round((cap.libres / cap.total) * 100) : 0) + '%"></div></div>' +
      '<p class="sub" style="margin:0">' + (cap.libres < 50 && cap.total ? '⚠️ Quedan pocos: recarga la base con el prompt.' : 'Cada combinación estructura + elemento se usa una sola vez.') + '</p>' +
      '<div class="btns" style="flex-wrap:wrap"><button class="small" id="bPrompt">🧠 Prompt para recargar</button><label class="btn small alt" style="margin:0">📄 Importar CSV<input type="file" id="bArch" accept=".csv,.txt,text/csv" hidden></label>' +
      '<button class="small ghost" id="bPegar">📋 Pegar CSV</button><button class="small ghost" id="bMano">＋ A mano</button>' + (!CC.base.length ? '<button class="small okb" id="bPlantilla">🚲 Plantilla bicicletas</button>' : '') + '</div></div>' +
      (lista.length ? '<div class="grid-2">' + lista.map((t) => '<details class="card" data-t="' + esc(t) + '"' + (abierto === t ? ' open' : '') + '><summary><b>' + esc(t) + '</b> <span class="sub">' + Object.values(temas[t]).reduce((a, b) => a + b, 0) + ' · ' +
        CATS.filter((c) => temas[t][c[0]]).map((c) => c[1].toLowerCase() + ' ' + temas[t][c[0]]).join(', ') + '</span></summary><div class="cuerpo"></div></details>').join('') + '</div>'
        : '<div class="card"><p class="muted">Aún no hay base. Si eres un taller de bicicletas, toca <b>🚲 Plantilla bicicletas</b>. Para otro rubro, usa <b>🧠 Prompt</b>: lo pegas en un chat gratis, copias el CSV que te entrega y lo pegas aquí.</p></div>');
    el.querySelector('#bPrompt').onclick = () => verPrompt(CC.base.length ? 'recarga' : 'nueva');
    el.querySelector('#bArch').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importar(Importador.decodificar(await f.arrayBuffer())); };
    el.querySelector('#bPegar').onclick = () => {
      const d = App.modal('<h2>📋 Pegar CSV</h2><p class="muted" style="margin-top:0">Encabezado: tema,categoria,texto</p><textarea id="pcT" rows="10" class="prompt"></textarea><div class="btns"><button class="ghost" data-cerrar>Cancelar</button><button id="pcOk">Cargar</button></div>');
      d.querySelector('#pcOk').onclick = () => { const t = d.querySelector('#pcT').value.replace(/^```\w*\n?|```\s*$/gm, '').trim(); d.close(); importar(t); };
    };
    el.querySelector('#bMano').onclick = () => aMano(lista);
    const bp = el.querySelector('#bPlantilla');
    if (bp) bp.onclick = async () => { bp.disabled = true; try { importar(await (await fetch('../plantillas/bicicletas.csv', { cache: 'no-store' })).text()); } catch (e) { App.toast(e.message); bp.disabled = false; } };
    el.querySelectorAll('details[data-t]').forEach((d) => { d.ontoggle = () => { if (d.open) { abierto = d.dataset.t; cuerpo(d); } else if (abierto === d.dataset.t) abierto = null; }; if (d.open) cuerpo(d); });
  }

  function cuerpo(det) {
    const t = det.dataset.t, c = det.querySelector('.cuerpo');
    const filas = CC.base.filter((b) => b.tema === t);
    const usados = new Set(); CC.ideas.forEach((i) => { const n = Number(String(i.combo).split('|')[1]); if (n) usados.add(n); });
    c.innerHTML = CATS.filter((k) => filas.some((b) => b.categoria === k[0])).map((k) => '<h3 style="margin:12px 0 4px">' + k[1] + '</h3><ul class="list">' + filas.filter((b) => b.categoria === k[0]).map((b) =>
      '<li><div class="fila"><span class="grow"' + (usados.has(b.id) ? ' style="opacity:.6"' : '') + '>' + esc(b.texto) + (b.veces_usado ? ' <span class="sub">· usado ' + b.veces_usado + '×</span>' : '') + '</span><button type="button" class="small ghost" data-borrar="' + b.id + '" aria-label="Borrar">✕</button></div></li>').join('') + '</ul>').join('');
    c.onclick = async (e) => {
      const b = e.target.closest('[data-borrar]'); if (!b) return;
      try { await App.q(App.sb.from('base_contenido').delete().eq('id', b.dataset.borrar)); CC.base = CC.base.filter((x) => String(x.id) !== b.dataset.borrar); CC.armarMotor(); b.closest('li').remove(); }
      catch (er) { App.toast(er.message); }
    };
  }

  async function importar(texto) {
    const r = Importador.analizar(texto, 'base.csv');
    if (r.tipo !== 'base' || !r.filas.length) return App.toast('No encontré las columnas tema, categoria y texto');
    try {
      let nuevas = 0, ign = 0;
      for (let k = 0; k < r.filas.length; k += 2000) { const x = await App.rpc('base_importar', { p_empresa: CC.emp.id, p_filas: r.filas.slice(k, k + 2000) }); nuevas += x.nuevas; ign += x.ignoradas; }
      await CC.cargarEmpresa();
      App.toast('✅ ' + nuevas + ' filas nuevas' + (ign ? ' · ' + ign + ' repetidas o no válidas' : ''));
      CC.ir('base');
    } catch (e) { App.toast(e.message); }
  }

  function aMano(temas) {
    const d = App.modal('<h2>＋ Agregar a la base</h2><label for="amT">Tema</label><input id="amT" list="amTl" maxlength="60" placeholder="Ej: Frenos"><datalist id="amTl">' + temas.map((t) => '<option value="' + esc(t) + '">').join('') + '</datalist>' +
      '<label for="amC">Categoría</label><select id="amC">' + CATS.map((c) => '<option value="' + c[0] + '">' + c[1] + '</option>').join('') + '</select>' +
      '<label for="amX">Texto (uno por línea para agregar varios)</label><textarea id="amX" rows="5"></textarea><p class="sub">Errores en infinitivo ("usar…", "no limpiar…"). Datos que se lean después de "Nadie te dice que…".</p>' +
      '<div class="btns"><button class="ghost" data-cerrar>Cancelar</button><button id="amOk">Agregar</button></div>');
    d.querySelector('#amOk').onclick = async () => {
      const tema = d.querySelector('#amT').value.trim(), cat = d.querySelector('#amC').value;
      const filas = d.querySelector('#amX').value.split('\n').map((x) => x.trim()).filter(Boolean).map((texto) => ({ tema: cat === 'estructura_gancho' || cat === 'toma' ? tema || 'General' : tema, categoria: cat, texto }));
      if (!tema && !['estructura_gancho', 'toma'].includes(cat)) return App.toast('Escribe el tema');
      if (!filas.length) return App.toast('Escribe al menos un texto');
      try { const r = await App.rpc('base_importar', { p_empresa: CC.emp.id, p_filas: filas }); await CC.cargarEmpresa(); d.close(); App.toast(r.nuevas + ' agregadas'); CC.ir('base'); } catch (e) { App.toast(e.message); }
    };
  }

  /* ---------- prompt (se pega en un chat gratis y devuelve el CSV) ---------- */
  function prompt(modo, emp) {
    emp = emp || CC.emp || {};
    const ficha = 'EMPRESA: ' + (emp.nombre || '') + '\nRubro: ' + (emp.rubro || '') + '\nPúblico: ' + (emp.publico || '') + '\nServicios o productos: ' + (emp.servicios || '') + '\nTono: ' + (emp.tono || 'cercano, directo, en español de Chile');
    const reglas = 'Entrega SOLO un bloque CSV, sin explicaciones, con este encabezado exacto:\ntema,categoria,texto\n\nReglas:\n' +
      '- Categorías permitidas: parte, sintoma, error, mito, dato, costo, idea_video, cta, toma, estructura_gancho.\n' +
      '- "parte": sustantivos sin artículo (ej: "cadena", "pastillas").\n' +
      '- "sintoma": lo que nota el cliente, frase corta (ej: "chirrido al frenar").\n' +
      '- "error": en infinitivo (ej: "usar WD-40 como lubricante", "no limpiar el exceso").\n' +
      '- "mito": lo que la gente cree y es falso (ej: "más aceite es mejor").\n' +
      '- "dato": en minúscula, que se pueda leer después de "Nadie te dice que…".\n' +
      '- "costo": "algo barato → daño caro".\n' +
      '- "idea_video": ideas concretas y grabables.\n' +
      '- "cta": llamados a la acción cortos.\n' +
      '- Textos de máximo 120 caracteres, concretos, sin repetir y sin precios inventados.\n' +
      '- Si un texto lleva coma, ponlo entre comillas dobles.';
    if (modo === 'nueva') {
      return 'Actúa como estratega de contenido para redes sociales (TikTok, Instagram y Facebook). Necesito la base de contenido para el motor de ideas de mi app.\n\n' + ficha + '\n\n' + reglas + '\n\n' +
        'Cantidades:\n- 12 a 14 temas del rubro: los que más buscan, guardan y comparten sus clientes.\n- Por cada tema: 8 parte, 8 sintoma, 8 error, 5 mito, 6 dato, 4 costo, 6 idea_video y 3 cta (si alguna categoría no aplica al tema, omítela).\n' +
        '- Además, con tema "General": 10 toma (tipos de plano para grabar) y 10 cta.\n- Opcional, con tema "General": estructura_gancho con el formato "Nombre: plantilla 1 | plantilla 2" usando {error} {sintoma} {dato} {mito} {parte} {costo} {idea_video} (con mayúscula inicial, ej. {Error}, si va al comienzo).';
    }
    const por = {};
    CC.base.filter((b) => b.tema !== 'General').forEach((b) => { const k = b.tema + ' / ' + b.categoria; (por[k] = por[k] || []).push(b.texto); });
    return 'Actúa como estratega de contenido para redes sociales. Tengo una base de contenido y ya usé gran parte. Necesito filas NUEVAS para seguir sin repetir.\n\n' + ficha + '\n\n' + reglas + '\n\n' +
      'Cantidades: por cada tema existente, 6 sintoma, 6 error, 4 mito, 5 dato, 3 costo y 4 idea_video NUEVOS. Además propón 2 temas nuevos del rubro con 8 filas por categoría.\n\n' +
      'NO repitas ni reformules estos textos que ya tengo:\n' + Object.keys(por).map((k) => k + ': ' + por[k].join('; ')).join('\n');
  }
  function verPrompt(modo, emp) {
    const t = prompt(modo, emp);
    const d = App.modal('<h2>🧠 Prompt ' + (modo === 'nueva' ? 'para crear la base' : 'para recargar') + '</h2><p class="muted" style="margin-top:0">1) Cópialo y pégalo en un chat gratis. 2) Copia el CSV que te responda. 3) Vuelve y toca <b>📋 Pegar CSV</b>.</p>' +
      '<textarea class="prompt" readonly id="prT">' + esc(t) + '</textarea><div class="btns"><button class="ghost" data-cerrar>Cerrar</button><button id="prC">Copiar prompt</button></div>');
    d.querySelector('#prC').onclick = async () => { try { await navigator.clipboard.writeText(t); App.toast('Copiado'); } catch (e) { d.querySelector('#prT').select(); document.execCommand('copy'); App.toast('Copiado'); } };
  }

  CC.vistas.base = { pintar, prompt, verPrompt, importar };
})();
