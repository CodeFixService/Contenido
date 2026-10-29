// La guía sale sola 1 vez al día durante 5 días; el panel aparece solo para el administrador.
const path = require('path');
const { abrir } = require(path.resolve(process.argv[2], 'h.js'));
const assert = (c, m) => { if (!c) throw new Error('FALLA: ' + m); console.log('ok', m); };
(async () => {
  const t = await abrir(path.resolve(__dirname, '..'), 'p_contenido');
  const p = t.page;
  try {
    const u = await t.sim.crearUsuario('guia@prueba.cl', 'clave123');
    await t.sim.su("insert into public.empresas (owner, nombre) values ($1, 'X')", [u.id]).catch(async () => { await t.sim.su("alter table public.empresas disable trigger empresas_antes"); await t.sim.su("insert into public.empresas (owner, nombre) values ($1, 'X')", [u.id]); await t.sim.su("alter table public.empresas enable trigger empresas_antes"); });
    await t.sim.su("insert into public.base_contenido (empresa_id, tema, categoria, texto) select id, 'General', 'estructura_gancho', x from public.empresas, unnest(array[$1, $2]) x where nombre = 'X'", ["Pregunta directa: '¿Sigues {error}?'", "Reto: '¿Qué le pasa a esta {parte}?'"]);
    for (let dia = 1; dia <= 6; dia++) {
      await p.goto(t.base + '/'); await p.fill('input[type=email]', 'guia@prueba.cl'); await p.fill('input[type=password]', 'clave123'); await p.press('input[type=password]', 'Enter');
      await p.waitForURL(/app/); await p.waitForTimeout(400); await t.sinModales(); await p.waitForTimeout(2200);
      const hay = await p.locator('dialog[open] .guia').count();
      if (!hay && dia <= 5) console.log('debug', JSON.stringify(await p.evaluate(() => ({ prefs: CC.cuenta.prefs, hoy: App.hoy(), dlg: Array.from(document.querySelectorAll('dialog[open]')).map((d) => d.className + d.textContent.slice(0, 60)) }))), JSON.stringify(await t.sim.su('select prefs from perfiles where email = $1', ['guia@prueba.cl'])));
      assert(hay === (dia <= 5 ? 1 : 0), 'día ' + dia + ': guía ' + (hay ? 'sale' : 'no sale'));
      if (dia === 1) { for (let k = 0; k < 8; k++) await p.click('#gSig'); await t.foto('guia-fin'); assert((await p.textContent('#gSig')) === '¡Listo!', 'llega al último paso'); }
      await t.sinModales();
      // Al otro día: se corre la fecha guardada un día atrás.
      await t.sim.su("update public.perfiles set prefs = jsonb_set(prefs, '{guia,d}', to_jsonb('2000-01-01'::text)) where id = $1", [u.id]);
      await p.evaluate(() => App.salir()); await p.waitForTimeout(500);
    }
    const est = await t.sim.su("select texto from public.base_contenido where categoria = 'estructura_gancho' order by id");
    assert(est.length === 10 && !est.some((r) => /Sigues|esta \{parte\}/.test(r.texto)), 'estructuras antiguas reemplazadas: ' + est.length);
    const adm = await t.sim.crearUsuario('juanjosuecastilloloyola@gmail.com', 'admin123');
    await p.goto(t.base + '/'); await p.fill('input[type=email]', 'juanjosuecastilloloyola@gmail.com'); await p.fill('input[type=password]', 'admin123'); await p.press('input[type=password]', 'Enter');
    await p.waitForURL(/app/); await p.waitForTimeout(1500); await t.sinModales();
    const href = await p.getAttribute('#bPanel', 'href');
    assert(/\/admin\/$/.test(href || '') && !(await p.locator('#bPanel.hidden').count()), 'botón al panel para el admin: ' + href);
    await t.foto('panel-admin');
  } catch (e) { console.log(e.message); await t.foto('error-guia'); }
  console.log('ERRORES:', t.errores.join('\n') || 'ninguno');
  await t.cerrar();
})();
