# MEMORIA (resumen corto para chats nuevos)

**Qué es:** Cerebro · Cerebro de Contenido. App de CodeFix para gestionar redes sociales de una o varias empresas: base de contenido,
motor de ideas que no se repiten, pedidos de grabación por WhatsApp, calendario y métricas importadas. Todo gratis (sin API de IA).
**Infra:** Cloudflare (main) + Supabase (`vndqseptmymgqyxumbqy`) + GitHub `CodeFixService/Contenido` (público: la base se actualiza sola desde main).
**Súper admin:** juanjosuecastilloloyola@gmail.com. Se administra desde el Centro de Mando (Apps, Pagos, Control).

## Estructura
- `index.html` entrada · `app/` la app (cc.js núcleo, motor.js, importador.js, m-*.js pantallas) · `shared/` común (app.js, config.js + núcleo CodeFix)
- `supabase/instalar.sql` base completa (idempotente) · `supabase/instalar-corto.sql` se pega UNA vez · `plantillas/bicicletas.csv` base de ejemplo
- `pruebas/` motor.test.js, importador.test.js, contenido.sql (base local), ui.js (recorrido en navegador a 360 px)

## Base de datos (10 tablas propias, todo cuelga de `empresas` con RLS `mi_empresa()`)
empresas · base_contenido (tema, categoria, texto) · ideas (combo único por empresa = antirrepetición) · pedidos · publicaciones · metricas (por publicación) ·
metricas_cuenta (serie diaria: red, fecha, metrica, valor) · audiencia (dimension, valor, porcentaje) · mapeos_import · guia_redes.
RPC: base_importar, base_marcar_uso, metricas_importar(empresa, red, tipo cuenta|audiencia|contenido, filas), mi_respaldo, cfx_* del núcleo.
Planes: free = 1 empresa y 30 ideas/semana; pro = 15 empresas, ideas ilimitadas. Cron: cc-auto (10 min) y cc-tareas (cada hora: lunes plan, domingo métricas, hoy publicas).

## Motor (app/motor.js)
Estructuras "Nombre: plantilla | plantilla" con {error} {sintoma} {dato} {mito} {parte} {costo} {idea_video}. combo = estructura|id del elemento, se usa 1 vez.
Tema descansa 7 días; misma estructura no seguida; 70% por rendimiento (vistas, compartidos×2, guardados, clientes×3) y 30% exploración.

## Importador (app/importador.js)
Meta: UTF-16 con `sep=,`; series diarias ("Fecha","Primary") y resúmenes en bloques. Varios archivos no dicen la red → se elige al subir.
TikTok Studio: UTF-8 con BOM, encabezados en inglés, fecha sin año (año del nombre del archivo). Capturas: Tesseract.js (CDN) → pares etiqueta/número.
Columnas desconocidas: se mapean una vez (mapeos_import).

## Versiones
- App 1.0 · Base 1.0 · Núcleo 2.2. Cada cambio: subir VERSION (shared/config.js + version.json) y, si cambia la base, db_version() + "bd".
