// Prueba del importador con exportaciones reales: node pruebas/importador.test.js <carpeta con los CSV>
const fs = require('fs'), path = require('path'), I = require('../app/importador.js');
const ok = (c, m) => { if (!c) throw new Error(m); };
// números
const casos = [['1,604,253', 1604253], ['1.604.253', 1604253], ['11,2 mil', 11200], ['11.2 mil', 11200], ['688.4K', 688400], ['1.5 mill.', 1500000],
  ['+2.574', 2574], ['89%', 89], ['3 mil', 3000], ['62.7 mil', 62700], ['13,383', 13383], ['32.6', 32.6], ['0.8', 0.8], ['-181.5K', -181500]];
casos.forEach(([a, b]) => ok(I.numero(a) === b, 'numero ' + a + ' → ' + I.numero(a)));
ok(I.fecha('2026-09-30T00:00:00') === '2026-09-30', 'fecha iso');
ok(I.fecha('21 de octubre', 2026) === '2026-10-21', 'fecha es');
const dir = process.argv[2];
if (dir) fs.readdirSync(dir).filter((f) => /\.csv$/i.test(f)).forEach((f) => {
  const r = I.analizar(I.decodificar(fs.readFileSync(path.join(dir, f))), f);
  const n = (r.filas || r.pares || []).length;
  const tot = r.tipo === 'cuenta' ? r.filas.reduce((a, x) => a + x.valor, 0) : '';
  console.log(f.padEnd(40), r.tipo.padEnd(10), String(r.red).padEnd(10), String(r.metrica || '').padEnd(18), n, tot, r.origen);
});
// texto pegado (como el panel de Instagram)
const p = I.pegado('Estadísticas\nResumen Contenido Público\nTodo el contenido\n30 días\nVisualizaciones\n1,604,253\nSeguidores netos\n+2.574\nEspectadores 319,221\n' +
  'El dato que te salva de perder tu bici par…\n278 mil\nVisualizaciones\n¿Se te cae la biela izquierda aunque la a… 62.7 mil Visualizaciones');
console.log(JSON.stringify(p));
ok(p.pares.find((x) => x.clave === 'vistas' && x.valor === 1604253), 'pegado vistas');
ok(p.pares.find((x) => x.clave === 'seguidores_nuevos' && x.valor === 2574), 'pegado seguidores');
ok(p.lista.length === 2 && p.lista[0].vistas === 278000, 'pegado lista');
// tabla por publicación (formato tipo Meta Contenido, en inglés)
const t = I.analizar('Post ID,Permalink,Publish time,Description,Post type,Views,Reach,Likes,Comments,Shares,Saves,Follows\n' +
  '123,https://instagram.com/p/x,10/21/2026 19:05,Mi reel,IG reel,"62,700",50000,657,17,227,40,120', 'Contenido_instagram.csv');
console.log(JSON.stringify(t.filas[0]));
ok(t.tipo === 'contenido' && t.red === 'instagram' && t.filas[0].vistas === 62700 && t.filas[0].fecha_hora === '2026-10-21T19:05:00', 'tabla contenido');
console.log('OK importador');
