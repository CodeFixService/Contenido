-- Pruebas de la base (local): psql -f pruebas/contenido.sql sobre una base creada con pruebas/base.sh
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'juanjosuecastilloloyola@gmail.com'),
  ('00000000-0000-0000-0000-000000000001', 'uno@prueba.cl'), ('00000000-0000-0000-0000-000000000002', 'dos@prueba.cl');
select rol, (premium_hasta > now()) as prueba from public.perfiles order by email;

-- Usuario 1
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', false);
select public.mi_cuenta() ->> 'rol' as rol, public.mi_cuenta() -> 'limites' as limites;
insert into public.empresas (nombre, rubro, equipo) values ('Ciclo Service', 'taller de bicicletas', '[{"nombre":"Rodrigo","tel":"912345678"}]');
-- Pro de prueba (7 días): puede crear una segunda empresa
insert into public.empresas (nombre) values ('Cliente 2');
select count(*) as empresas_u1 from public.empresas;
select public.base_importar((select id from public.empresas where nombre = 'Ciclo Service'),
  '[{"tema":"Frenos","categoria":"error","texto":"tocar el disco con los dedos"},{"tema":"Frenos","categoria":"error","texto":"tocar el disco con los dedos"},{"tema":"Frenos","categoria":"malo","texto":"x"},{"tema":"Frenos","categoria":"sintoma","texto":"chirrido al frenar"}]') as base;
insert into public.ideas (empresa_id, combo, tema, gancho, red, fecha_plan) select id, 'error_que_cuesta|1', 'Frenos', 'El error de tocar el disco', 'tiktok', current_date from public.empresas where nombre = 'Ciclo Service';
-- combo repetido → error
do $$ begin
  insert into public.ideas (empresa_id, combo, tema, gancho, red) select id, 'error_que_cuesta|1', 'Frenos', 'x', 'tiktok' from public.empresas where nombre = 'Ciclo Service';
  raise exception 'FALLO: aceptó combo repetido';
exception when unique_violation then raise notice 'ok: combo repetido rechazado'; end $$;
select public.base_marcar_uso((select id from public.empresas where nombre = 'Ciclo Service'), array[1]::bigint[]);
insert into public.pedidos (empresa_id, idea_id, para, tel, instrucciones) select e.id, i.id, 'Rodrigo', '912345678', 'Graba la pastilla' from public.empresas e join public.ideas i on i.empresa_id = e.id;
insert into public.publicaciones (empresa_id, idea_id, red, texto) select e.id, i.id, 'tiktok', i.gancho from public.empresas e join public.ideas i on i.empresa_id = e.id;
-- Importador: serie, audiencia y contenido (con y sin publicacion_id)
select public.metricas_importar((select id from public.empresas where nombre = 'Ciclo Service'), 'instagram', 'cuenta',
  '[{"fecha":"2026-10-01","metrica":"visualizaciones","valor":21473},{"fecha":"2026-10-01","metrica":"visualizaciones","valor":21473},{"fecha":"2026-10-02","metrica":"vistas_30d","valor":1604253},{"fecha":"x","metrica":"malo","valor":1}]');
select public.metricas_importar((select id from public.empresas where nombre = 'Ciclo Service'), 'instagram', 'audiencia',
  '[{"dimension":"edad_sexo","valor":"35-44 · Hombres","porcentaje":31.4},{"dimension":"ciudad","valor":"Santiago de Chile, Chile","porcentaje":32.6}]');
select public.metricas_importar((select id from public.empresas where nombre = 'Ciclo Service'), 'tiktok', 'contenido',
  ('[{"publicacion_id":"' || (select id from public.publicaciones limit 1) || '","vistas":62700,"compartidos":227},{"texto":"Reel importado","vistas":"278000","me_gusta":1600,"link":"https://x/1"},{"texto":"Reel importado","vistas":280000,"link":"https://x/1"}]')::jsonb);
select red, texto, (select vistas from public.metricas m where m.publicacion_id = p.id order by fecha_corte desc limit 1) from public.publicaciones p order by texto;
select jsonb_array_length(public.cfx_guia() -> 'items') as pasos_guia, (select count(*) from jsonb_array_elements(public.cfx_guia() -> 'items') x where (x ->> 'ok')::boolean) as hechos;
select jsonb_object_keys(public.mi_respaldo()) as hojas;
-- Plan gratis: 1 empresa (se quita el Pro de prueba)
reset role;
update public.perfiles set premium_hasta = null where email = 'uno@prueba.cl';
set role authenticated;
do $$ begin
  insert into public.empresas (nombre) values ('Tercera');
  raise exception 'FALLO: aceptó más empresas de las del plan';
exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'ok límite: %', sqlerrm; end $$;

-- Usuario 2 no ve nada del 1 (RLS)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', false);
select (select count(*) from public.empresas) e, (select count(*) from public.base_contenido) b, (select count(*) from public.ideas) i, (select count(*) from public.metricas) m, (select count(*) from public.metricas_cuenta) mc;
do $$ begin
  perform public.base_importar((select id from public.empresas limit 1), '[]');
  insert into public.ideas (empresa_id, combo) select id, 'x|9' from public.empresas where false;
  perform public.metricas_importar('00000000-0000-0000-0000-000000000099', 'tiktok', 'cuenta', '[]');
  raise exception 'FALLO: importó en empresa ajena';
exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'ok ajena: %', sqlerrm; end $$;
do $$ begin
  insert into public.ideas (empresa_id, combo, tema) select id, 'z|1', 't' from public.empresas e where e.nombre = 'Ciclo Service';
  if exists (select 1 from public.ideas where combo = 'z|1') then raise exception 'FALLO: insertó en empresa ajena'; end if;
  raise notice 'ok: no ve la empresa ajena para insertar';
end $$;

-- Admin: funciones del núcleo y de administración
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
select public.is_admin() as admin, (public.admin_resumen() ->> 'empresas') as empresas, jsonb_array_length(public.cfx_planes()) as planes, jsonb_array_length(public.cfx_limpieza()) as limpiezas;
select public.admin_config_guardar('version_liberada', '"1.0"');
select public.cfx_pago_estado() ->> 'rol' as rol_pago;
select jsonb_array_length(public.cfx_inventario()) as tablas_sobrantes;
reset role;
-- Piloto automático (lunes 10:00 y domingo 20:00 hora Chile)
select public.tareas_periodicas('2026-11-02 13:00:00+00'), public.tareas_periodicas('2026-11-02 13:30:00+00') as segunda_vez, public.tareas_periodicas('2026-11-08 23:00:00+00');
select titulo from public.notificaciones order by created_at;
-- Actualización automática (simula GitHub)
insert into extensions.http_respuestas (url_like, content) values ('%version.json%', '{"version":"1.0","bd":"1.0"}');
select public.auto_actualizar() as auto;
select jobname, schedule from cron.job order by jobname;
