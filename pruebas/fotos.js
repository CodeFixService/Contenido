// Capturas de todas las pantallas y ventanas en un ancho dado: ANCHO=360|768|1280 node pruebas/fotos.js <carpeta h.js> <carpeta CSV Meta>
const path = require('path'), fs = require('fs');
const { abrir } = require(path.resolve(process.argv[2], 'h.js'));
const META = process.argv[3];
(async () => {
  const t = await abrir(path.resolve(__dirname, '..'), 'p_contenido');
  const p = t.page, w = process.env.ANCHO || '360';
  await t.ctx.addInitScript(() => { window.CFX_SIN_GUIA = true; });
  if (process.env.OSCURO) await p.emulateMedia({ colorScheme: 'dark' });
  const espera = (ms) => p.waitForTimeout(ms || 700);
  const foto = async (n) => { await t.foto(w + '-' + n); const ok = await t.anchoOk(); if (!ok) console.log('DESBORDA', w, n); };
  try {
    await t.sim.crearUsuario('martin@prueba.cl', 'clave123');
    await p.goto(t.base + '/'); await p.fill('input[type=email]', 'martin@prueba.cl'); await p.fill('input[type=password]', 'clave123'); await p.press('input[type=password]', 'Enter');
    await p.waitForURL(/app/); await espera(1500); await t.sinModales(); await espera(200);
    await foto('01-empresa-nueva');
    await p.fill('#eNom', 'Ciclo Service'); await p.fill('#eRub', 'taller de bicicletas');
    await p.locator('#eEq [data-k=nombre]').first().fill('Rodrigo'); await p.locator('#eEq [data-k=tel]').first().fill('912345678');
    await p.click('#fEmp button[type=submit]'); await espera(1500); await t.sinModales();
    await p.click('#bPlantilla'); await espera(2500); await t.sinModales();
    await p.locator('details[data-t]').first().evaluate((d) => { d.open = true; }); await espera(400);
    await foto('02-base');
    await p.click('#nav [data-v=nuevo]'); await espera(500); await foto('03-generar'); await p.click('#gOk'); await espera(2500); await t.sinModales();
    await foto('04-ideas');
    await p.evaluate(() => { window.open = () => ({ close() {} }); });
    await p.locator('.idea').first().locator('[data-a=pedir]').click(); await espera(400); await foto('05-pedir'); await p.locator('#pQuien [data-i="0"]').click(); await espera(900);
    await p.locator('.idea').nth(1).locator('[data-a=publicar]').click(); await espera(400); await foto('06-publicar'); await p.click('#puOk'); await espera(900);
    await p.locator('.idea').nth(2).locator('[data-a=mas]').click(); await espera(400); await foto('07-mas'); await t.sinModales();
    await p.evaluate(() => CC.ir('inicio')); await espera(800); await foto('08-inicio');
    await p.evaluate(() => CC.ir('calendario')); await espera(800); await foto('09-calendario');
    await p.evaluate(() => { const l = document.querySelector('#cDia'); if (l) l.scrollIntoView(); }); await espera(300); await foto('09b-dia');
    const fuera = await p.evaluate(() => Array.from(document.querySelectorAll('#cDia button, .idea button, .card button')).filter((b) => { const r = b.getBoundingClientRect(), c = b.closest('.card, .idea, li').getBoundingClientRect(); return r.width && (r.right > c.right + 1 || r.left < c.left - 1); }).length);
    console.log('BOTONES FUERA:', fuera);
    await p.evaluate(() => CC.ir('pedidos')); await espera(800); await foto('10-pedidos');
    await p.evaluate(() => CC.ir('metricas')); await espera(800);
    const archivos = fs.readdirSync(META).filter((f) => /\.csv$/.test(f)).map((f) => path.join(META, f));
    await p.setInputFiles('#mArch', archivos.slice(0, 4)); await espera(1500); await foto('11-importar');
    await p.evaluate(() => document.querySelectorAll('#mCola [data-k=red]').forEach((s) => { if (!s.value) { s.value = 'instagram'; s.dispatchEvent(new Event('change')); } })); await espera(300);
    await p.click('#mGuardar'); await espera(2500);
    await p.evaluate(() => CC.anotarMetricas(CC.pubs[0])); await espera(400); await foto('12-anotar'); await p.fill('#am_vistas', '62700'); await p.click('#amOk'); await espera(900);
    await foto('13-metricas');
    await p.evaluate(() => CC.ir('empresa')); await espera(800); await foto('14-empresa');
    await p.click('#bEmpresa'); await espera(400); await foto('15-elegir'); await t.sinModales();
    await p.evaluate(() => document.querySelector('.cfx-menu') && document.querySelector('.cfx-menu').click()); await espera(500); await foto('16-hoja-mas');
    await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelectorAll('.cfx-mv').forEach((x) => x.remove())); await t.sinModales(); await p.evaluate(() => CC.tour(true)); await espera(400); await foto('17-guia');
  } catch (e) { console.log(e.message); await t.foto(w + '-error'); }
  console.log('ERRORES:', t.errores.join('\n') || 'ninguno');
  await t.cerrar();
})();
