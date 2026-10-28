// Prueba del motor con la plantilla de bicicletas: node pruebas/motor.test.js
const fs = require('fs'), path = require('path'), M = require('../app/motor.js');
const I = require('../app/importador.js');
const csv = null;
const base = I.analizar(fs.readFileSync(path.join(__dirname, '../plantillas/bicicletas.csv'), 'utf8'), 'bicicletas.csv').filas.map((f, i) => Object.assign({ id: i + 1 }, f));
const ctx = M.contexto(base, [], { semilla: 42 });
const cap = M.capacidad(ctx);
console.log('estructuras', ctx.estructuras.map((e) => e.k + ':' + e.principal).join(' '));
console.log('capacidad', cap);
const sem = M.semana(ctx, { tiktok: 7, instagram: 5, facebook: 5, historias: 4 }, '2026-11-02');
console.log('semana', sem.length, 'ideas');
const combos = new Set(sem.map((i) => i.combo)); if (combos.size !== sem.length) throw new Error('combos repetidos');
sem.slice(0, 12).forEach((i) => console.log('-', i.fecha_plan, i.red.padEnd(9), '|', i.estructura_nombre.padEnd(18), '|', i.gancho, '|', i.formato));
// refrescar
let i0 = sem[0]; const g0 = i0.gancho, c0 = i0.combo;
const i1 = M.refrescar(ctx, i0, 'gancho'); if (i1.combo === c0) throw new Error('refresco no cambió combo');
const i2 = M.refrescar(ctx, Object.assign({}, i1, { bloqueados: ['cta'] }), 'cta'); if (i2.cta !== i1.cta) throw new Error('bloqueo no respetado');
console.log('refresco ok:', g0, '→', i1.gancho);
// sin placeholders sin rellenar
const malos = sem.filter((i) => /\{/.test(i.gancho)); if (malos.length) throw new Error('placeholders: ' + malos[0].gancho);
// agotar
const ctx2 = M.contexto(base, [], { semilla: 1 }); let n = 0; while (M.nueva(ctx2, 'tiktok', '2026-11-02')) n++;
console.log('combinaciones generadas hasta agotar:', n, '= total', M.capacidad(ctx2).total);
if (n !== M.capacidad(ctx2).total) throw new Error('no agotó exacto');
console.log(M.mensajePedido(sem[0], 'Ciclo Service', 'Rodrigo'));
console.log('OK motor');
