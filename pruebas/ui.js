// Recorrido completo en el navegador (360 px): registro → empresa → plantilla → generar semana → 🔄🔒 → pedir → programar → publicar → métricas.
// Uso: NODE_PATH=<node_modules con playwright y pg> node pruebas/ui.js <carpeta con h.js y sim.js> <carpeta con CSV de Meta> <carpeta con CSV de TikTok>
const path = require('path');
const { abrir } = require(path.resolve(process.argv[2], 'h.js'));
const META = process.argv[3], TT = process.argv[4];
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error('FALLA: ' + m); console.log('ok', m); };
(async () => {
  const t = await abrir(path.resolve(__dirname, '..'), 'p_contenido');
  const p = t.page;
  await t.ctx.addInitScript(() => { window.CFX_SIN_GUIA = true; });
  if (process.env.OSCURO) await p.emulateMedia({ colorScheme: 'dark' });
  const espera = (ms) => p.waitForTimeout(ms || 700);
  try {
    await p.goto(t.base + '/?registro=1'); await espera(800);
    await p.fill('#rNom', 'Martín Romero'); await p.fill('#rEmail', 'martin@prueba.cl'); await p.fill('#rPass', 'clave123');
    await p.click('#bReg'); await p.waitForURL(/app/); await espera(1500); await t.sinModales(); await espera(200);
    assert(/#empresa/.test(p.url()), 'sin empresa abre Empresa');
    await t.foto('01-bienvenida');
    await p.fill('#eNom', 'Ciclo Service'); await p.fill('#eRub', 'taller de bicicletas'); await p.fill('#ePub', 'hombres 25–44 en Santiago');
    await p.locator('#eEq [data-k=nombre]').first().fill('Rodrigo'); await p.locator('#eEq [data-k=tel]').first().fill('912345678');
    await p.click('#fEmp button[type=submit]'); await espera(1500); await t.sinModales();
    assert(/#base/.test(p.url()), 'crear empresa lleva a Base');
    assert((await p.textContent('#nomEmp')) === 'Ciclo Service', 'cabecera con la empresa');
    await p.click('#bPlantilla'); await espera(2500);
    const nb = (await t.sim.su('select count(*)::int n from base_contenido'))[0].n;
    assert(nb > 400, 'plantilla cargada: ' + nb + ' filas');
    await t.foto('02-base');
    await p.click('#nav [data-v=nuevo]'); await espera(500);
    await p.click('#gOk'); await espera(2500); await t.sinModales();
    const ni = (await t.sim.su('select count(*)::int n, count(distinct combo)::int c from ideas'))[0];
    assert(ni.n === 24 && ni.c === 24, 'semana generada sin repetir: ' + ni.n);
    await t.foto('03-ideas');
    assert(await t.anchoOk(), 'ancho 360 ideas');
    // 🔄 gancho de la primera tarjeta
    const card = p.locator('.idea').first();
    const g0 = await card.locator('.campo.gancho .val').textContent();
    await card.locator('[data-r=gancho]').click(); await espera(900);
    const g1 = await p.locator('.idea').first().locator('.campo.gancho .val').textContent();
    assert(g0 !== g1, 'refresco de gancho: ' + g0 + ' → ' + g1);
    // 🔒 llamado
    await p.locator('.idea').first().locator('[data-l=cta]').click(); await espera(700);
    const cta0 = await p.locator('.idea').first().locator('.campo.cta .val').textContent();
    await p.locator('.idea').first().locator('[data-r=cta]').click(); await espera(500);
    assert((await p.locator('.idea').first().locator('.campo.cta .val').textContent()) === cta0, 'bloqueo respeta el llamado');
    // Pedir a Rodrigo (abre WhatsApp en otra pestaña)
    await p.locator('.idea').first().locator('[data-a=pedir]').click(); await espera(500);
    await p.evaluate(() => { window.open = (u) => { window.__abierto = u; return { close() {} }; }; });
    await p.locator('#pQuien [data-i="0"]').click(); await espera(1200);
    const wa = await p.evaluate(() => window.__abierto || '');
    assert(/wa\.me\/56912345678\?text=/.test(wa) && /Pedido%20de%20grabaci/.test(wa), 'WhatsApp con el número del equipo y el mensaje');
    assert((await t.sim.su("select count(*)::int n from pedidos where para = 'Rodrigo'"))[0].n === 1, 'pedido guardado');
    // Programar y publicar la segunda idea
    await p.locator('.idea').nth(1).locator('[data-a=programar]').click(); await espera(400); await p.click('#prOk'); await espera(900);
    await p.locator('.idea').nth(1).locator('[data-a=publicar]').click(); await espera(400); await p.click('#puOk'); await espera(1200);
    assert((await t.sim.su("select count(*)::int n from publicaciones"))[0].n === 1, 'publicación creada');
    // Calendario
    await p.click('#nav [data-v=calendario]'); await espera(900);
    await t.foto('04-calendario');
    assert(await p.locator('.cal button .pt').count() > 0, 'calendario con puntos');
    // Métricas: archivos reales de Meta y TikTok
    await p.evaluate(() => CC.ir('metricas')); await espera(800);
    const archivos = fs.readdirSync(META).filter((f) => /\.csv$/.test(f)).map((f) => path.join(META, f)).concat(fs.readdirSync(TT).filter((f) => /\.csv$/.test(f)).map((f) => path.join(TT, f)));
    await p.setInputFiles('#mArch', archivos); await espera(2500);
    const sinRed = await p.locator('#mCola [data-k=red]').evaluateAll((l) => l.filter((s) => !s.value).length);
    // Visualizaciones (2) y Alcance son de Instagram; el resto de los ambiguos, Facebook (según sus totales).
    await p.evaluate(() => {
      document.querySelectorAll('#mCola .det-imp').forEach((d) => {
        const s = d.querySelector('[data-k=red]'); if (!s || s.value) return;
        const n = d.querySelector('b').textContent;
        s.value = /Visualizaciones \(2\)|Alcance|Espectadores|Interacciones \(1\)|Audiencia/.test(n) ? 'instagram' : 'facebook';
        s.dispatchEvent(new Event('change'));
      });
    });
    await espera(400);
    const omitidos = archivos.length - await p.locator('#mCola .det-imp').count();
    await t.foto('05-importar');
    await p.click('#mGuardar'); await espera(3000);
    const mc = (await t.sim.su('select red, count(*)::int n, sum(valor)::bigint s from metricas_cuenta group by red order by red'));
    console.log(JSON.stringify(mc), 'sinRed', sinRed, 'omitidos', omitidos);
    assert(mc.find((x) => x.red === 'tiktok') && mc.find((x) => x.red === 'instagram') && mc.find((x) => x.red === 'facebook'), 'métricas de las 3 redes');
    assert(omitidos === 1, 'archivo repetido omitido');
    assert((await t.sim.su("select count(*)::int n from audiencia"))[0].n > 30, 'audiencia importada');
    await t.foto('06-metricas');
    assert(await t.anchoOk(), 'ancho 360 métricas');
    // Pegar texto de una captura
    await p.click('#mPeg'); await espera(300);
    await p.fill('#pgT', 'Instagram\n30 días\nVisualizaciones\n1,604,253\nSeguidores netos\n+2.574');
    await p.click('#pgOk'); await espera(500);
    await p.locator('#mCola [data-k=red]').first().selectOption('instagram'); await espera(300);
    await p.click('#mGuardar'); await espera(1500);
    assert((await t.sim.su("select valor from metricas_cuenta where metrica = 'visualizaciones_30d'"))[0].valor == 1604253, 'pegado guardado como resumen 30 días');
    // Anotar métricas de la publicación con clientes
    await p.evaluate(() => CC.anotarMetricas(CC.pubs[0])); await espera(400);
    await p.fill('#am_vistas', '62.7 mil'); await p.fill('#am_compartidos', '227'); await p.fill('#am_clientes_generados', '3');
    await p.click('#amOk'); await espera(1000);
    assert((await t.sim.su("select vistas::int v, clientes_generados c from metricas where vistas is not null order by vistas desc limit 1"))[0].v === 62700, 'métricas a mano');
    // Inicio, pedidos, base y empresa
    for (const v of ['inicio', 'pedidos', 'base', 'empresa']) { await p.evaluate((x) => CC.ir(x), v); await espera(700); assert(await t.anchoOk(), 'ancho 360 ' + v); await t.foto('07-' + v); }
    // Prompt para otra empresa
    await p.click('#ePrompt'); await espera(400);
    assert(/tema,categoria,texto/.test(await p.inputValue('#prT')), 'prompt con el formato CSV');
    await t.foto('08-prompt');
  } catch (e) { console.log(e.message); await t.foto('error'); }
  console.log('ERRORES:', t.errores.join('\n') || 'ninguno');
  await t.cerrar();
})();
