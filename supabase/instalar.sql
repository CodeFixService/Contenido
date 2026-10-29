-- =====================================================================
--  Cerebro · Cerebro de Contenido · Base de datos (Supabase)
--  Primera vez: Supabase → SQL Editor → pega supabase/instalar-corto.sql → Run.
--  Después se actualiza sola cada 10 minutos desde GitHub (rama main).
--  Se puede volver a ejecutar sin perder datos.
-- =====================================================================
set check_function_bodies = off;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- A0. Tablas y funciones base (cuentas, avisos, push y registro).
--     Si ya existen (actualización), no se tocan.
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null,
  nombre             text not null default '' check (length(nombre) <= 80),
  telefono           text not null default '' check (length(telefono) <= 30),
  rol                text not null default 'usuario',
  premium_hasta      timestamptz,
  aviso_venc_para    timestamptz,
  aviso_vencido_para timestamptz,
  suspendido         boolean not null default false,
  visto_at           timestamptz,
  created_by         uuid,
  created_at         timestamptz not null default now()
);
alter table public.perfiles enable row level security;
create table if not exists public.invitaciones (
  email      text primary key,
  rol        text not null,
  nombre     text not null default '',
  telefono   text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.invitaciones enable row level security;
create table if not exists public.notificaciones (
  id           uuid primary key default gen_random_uuid(),
  para         uuid not null references public.perfiles (id) on delete cascade,
  titulo       text not null,
  cuerpo       text not null default '',
  url          text not null default '',
  leida        boolean not null default false,
  push_enviado boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists notif_para_idx on public.notificaciones (para, created_at desc);
create index if not exists notif_push_idx on public.notificaciones (push_enviado, created_at) where not push_enviado;
alter table public.notificaciones enable row level security;
create table if not exists public.push_subs (
  endpoint   text primary key,
  perfil_id  uuid not null references public.perfiles (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
create table if not exists public.auditoria (
  id         bigserial primary key,
  quien      uuid,
  accion     text not null,
  detalle    text not null default '',
  created_at timestamptz not null default now()
);
alter table public.auditoria enable row level security;
create or replace function public.avisar(p_para uuid, p_titulo text, p_cuerpo text, p_url text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notificaciones (para, titulo, cuerpo, url)
  select p_para, left(p_titulo, 90), left(coalesce(p_cuerpo, ''), 240), coalesce(p_url, '')
  where p_para is not null
$$;
create or replace function public.push_guardar(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  if p_endpoint !~ '^https://' then raise exception 'Suscripción no válida'; end if;
  insert into public.push_subs (endpoint, perfil_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set perfil_id = excluded.perfil_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
create or replace function public.push_quitar(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subs where endpoint = p_endpoint and perfil_id = auth.uid()
$$;
create or replace function public.push_pendientes() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ids uuid[]; out jsonb;
begin
  select array_agg(id) into ids from (
    select id from public.notificaciones where not push_enviado and created_at > now() - interval '1 day'
    order by created_at limit 300 for update skip locked) x;
  if ids is null then return jsonb_build_object('claves', null, 'envios', '[]'::jsonb); end if;
  update public.notificaciones set push_enviado = true where id = any (ids);
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
           'titulo', n.titulo, 'cuerpo', n.cuerpo, 'url', n.url, 'id', n.id)), '[]')
    into out from public.notificaciones n join public.push_subs s on s.perfil_id = n.para where n.id = any (ids);
  return jsonb_build_object('envios', out, 'claves', jsonb_build_object(
    'publica', (select valor #>> '{}' from public.config where clave = 'vapid_publica'),
    'privada', (select valor from public.secretos where clave = 'vapid_privada')));
end $$;
create or replace function public.push_borrar_endpoint(p_endpoint text) returns void
language sql security definer set search_path = '' as $$ delete from public.push_subs where endpoint = p_endpoint $$;
create or replace function public.registrar_visto() returns void
language sql security definer set search_path = '' as $$
  update public.perfiles set visto_at = now()
  where id = auth.uid() and (visto_at is null or visto_at < now() - interval '5 minutes')
$$;

-- ---------------------------------------------------------------------
-- A. Todas las funciones antiguas se borran y se vuelven a crear (salvo las base que se reutilizan tal cual).
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and p.proname <> all (array['admin_email', 'cfg_int', 'is_admin', 'is_socio', 'is_staff', 'admin_check', 'avisar',
        'push_guardar', 'push_quitar', 'push_pendientes', 'push_borrar_endpoint', 'registrar_visto', 'mi_empresa'])
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute 'drop function if exists ' || r.f || ' cascade';
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- B. Ajustes generales, cuentas y planes
-- ---------------------------------------------------------------------
create or replace function public.admin_email() returns text
language sql immutable as $$ select 'juanjosuecastilloloyola@gmail.com'::text $$;
create or replace function public.db_version() returns text
language sql immutable as $$ select '1.3'::text $$;
create or replace function public.cfg_int(c text) returns int
language sql stable security definer set search_path = '' as $$
  select (valor #>> '{}')::int from public.config where clave = c
$$;

create table if not exists public.config (clave text primary key, valor jsonb not null);
create table if not exists public.textos (clave text primary key, valor text not null default '');
create table if not exists public.secretos (clave text primary key, valor text not null);
create table if not exists public.planes (
  codigo text primary key, nombre text not null, descripcion text not null default '',
  limites jsonb not null default '{}', beneficios jsonb not null default '[]',
  duracion_dias int not null default 30 check (duracion_dias between 1 and 3650));
alter table public.config enable row level security;
alter table public.textos enable row level security;
alter table public.secretos enable row level security;
alter table public.planes enable row level security;

insert into public.config (clave, valor) values
  ('dias_prueba', '7'), ('dias_aviso_vencimiento', '3'), ('soporte_whatsapp', '""'), ('vapid_publica', '""'),
  ('limite_db_mb', '500'), ('auditoria_max', '2000'), ('version_liberada', '"1.0"')
on conflict (clave) do nothing;

insert into public.textos (clave, valor) values
  ('app_nombre', 'Cerebro'),
  ('app_lema', 'Ideas que no se repiten para tus redes.'),
  ('terminos', 'Tus datos son tuyos: el administrador no lee tus ideas, pedidos ni métricas. Puedes descargarlos y borrarlos cuando quieras.'),
  ('pro_titulo', 'Cerebro Pro'),
  ('pro_texto', 'Varias empresas, importador sin límites y prioridad por resultados.')
on conflict (clave) do nothing;

alter table public.planes drop constraint if exists planes_codigo_check;
delete from public.planes where codigo not in ('free', 'pro');
alter table public.planes add constraint planes_codigo_check check (codigo in ('free', 'pro'));
insert into public.planes (codigo, nombre, descripcion, limites, beneficios, duracion_dias) values
  ('free', 'Gratis', 'Una empresa con todo lo esencial.',
   '{"empresas": 1, "ideas_semana": 30, "importar": true}',
   '["1 empresa", "Motor de ideas sin repetir", "Pedidos por WhatsApp y calendario", "Importar métricas"]', 30),
  ('pro', 'Pro', 'Para manejar varias marcas o clientes.',
   '{"empresas": 15, "ideas_semana": 0, "importar": true}',
   '["Hasta 15 empresas (una por cliente)", "Ideas ilimitadas", "Prioridad por resultados", "Respaldo en Excel"]', 30)
on conflict (codigo) do nothing;

-- Cuentas: usuario (la persona), socio (ayuda a administrar) y admin (súper administrador).
alter table public.perfiles drop constraint if exists perfiles_rol_check;
update public.perfiles set rol = 'usuario' where rol not in ('admin', 'socio');
alter table public.perfiles add constraint perfiles_rol_check check (rol in ('admin', 'socio', 'usuario'));
alter table public.perfiles add column if not exists prefs jsonb not null default '{}';
alter table public.perfiles add column if not exists prueba_usada boolean not null default false;
alter table public.perfiles add column if not exists aviso_limpieza_at timestamptz;
alter table public.invitaciones drop constraint if exists invitaciones_rol_check;
delete from public.invitaciones where rol not in ('socio', 'usuario');
alter table public.invitaciones add constraint invitaciones_rol_check check (rol in ('socio', 'usuario'));
alter table public.auditoria add column if not exists rol text not null default '';
alter table public.auditoria add column if not exists quien_email text not null default '';
alter table public.auditoria add column if not exists motivo text not null default '';

-- ---------------------------------------------------------------------
-- C. Cerebro de Contenido: 10 tablas (solo texto). Todo cuelga de una empresa y cada persona ve solo lo suyo.
-- ---------------------------------------------------------------------
-- 1) Empresas: un cerebro por marca o cliente.
create table if not exists public.empresas (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references public.perfiles (id) on delete cascade,
  nombre     text not null check (length(nombre) between 1 and 80),
  rubro      text not null default '' check (length(rubro) <= 80),
  publico    text not null default '' check (length(publico) <= 300),
  tono       text not null default '' check (length(tono) <= 200),
  servicios  text not null default '' check (length(servicios) <= 600),
  colores    text not null default '' check (length(colores) <= 200),
  redes      text[] not null default array['tiktok', 'instagram', 'facebook'],
  ritmo      jsonb not null default '{"tiktok": 7, "instagram": 5, "facebook": 5, "historias": 4}',
  equipo     jsonb not null default '[]',   -- [{ nombre, tel }] quienes graban (para los pedidos por WhatsApp)
  cta_base   text not null default '' check (length(cta_base) <= 200),
  activa     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists empresas_owner_idx on public.empresas (owner);
alter table public.empresas enable row level security;

-- 2) Base de contenido: la materia prima (partes, síntomas, errores, mitos, datos, costos, ideas, llamados, tomas, estructuras).
create table if not exists public.base_contenido (
  id          bigserial primary key,
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  tema        text not null check (length(tema) between 1 and 60),
  categoria   text not null check (categoria in ('parte', 'sintoma', 'error', 'mito', 'dato', 'costo', 'idea_video', 'cta', 'toma', 'estructura_gancho', 'formato')),
  texto       text not null check (length(texto) between 1 and 300),
  veces_usado int not null default 0,
  ultimo_uso  timestamptz,
  created_at  timestamptz not null default now(),
  unique (empresa_id, tema, categoria, texto)
);
create index if not exists base_empresa_idx on public.base_contenido (empresa_id, categoria);
alter table public.base_contenido enable row level security;

-- 3) Ideas: cada combinación (estructura + elemento) se usa una sola vez por empresa (antirrepetición).
create table if not exists public.ideas (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  combo            text not null check (length(combo) <= 120),
  tema             text not null default '',
  formato          text not null default '',
  estructura       text not null default '',
  gancho           text not null default '' check (length(gancho) <= 300),
  elemento         text not null default '' check (length(elemento) <= 300),
  toma             text not null default '' check (length(toma) <= 300),
  texto_pantalla   text not null default '' check (length(texto_pantalla) <= 300),
  cta              text not null default '' check (length(cta) <= 200),
  red              text not null default 'tiktok' check (red in ('tiktok', 'instagram', 'facebook', 'historias')),
  hora             text not null default '' check (hora = '' or hora ~ '^[0-2][0-9]:[0-5][0-9]$'),
  duracion_seg     int not null default 15 check (duracion_seg between 3 and 600),
  bloqueados       text[] not null default '{}',
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'pedido', 'recibido', 'editado', 'programado', 'publicado', 'descartado')),
  fecha_plan       date,
  nota             text not null default '' check (length(nota) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (empresa_id, combo)
);
create index if not exists ideas_empresa_idx on public.ideas (empresa_id, estado, fecha_plan);
alter table public.ideas enable row level security;

-- 4) Pedidos de grabación (a ti o a alguien del equipo), listos para WhatsApp.
create table if not exists public.pedidos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas (id) on delete cascade,
  idea_id        uuid references public.ideas (id) on delete set null,
  para           text not null default '' check (length(para) <= 60),
  tel            text not null default '' check (length(tel) <= 20),
  instrucciones  text not null check (length(instrucciones) between 1 and 1500),
  duracion_seg   int not null default 15 check (duracion_seg between 3 and 600),
  estado         text not null default 'pedido' check (estado in ('pedido', 'recibido', 'cancelado')),
  fecha_pedido   timestamptz not null default now(),
  fecha_recibido timestamptz
);
create index if not exists pedidos_empresa_idx on public.pedidos (empresa_id, estado);
alter table public.pedidos enable row level security;

-- 5) Publicaciones: lo publicado (el calendario sale de aquí y de las ideas programadas).
create table if not exists public.publicaciones (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  idea_id       uuid references public.ideas (id) on delete set null,
  red           text not null check (red in ('tiktok', 'instagram', 'facebook', 'historias')),
  tipo          text not null default 'reel' check (tipo in ('reel', 'video', 'carrusel', 'foto', 'historia', 'texto', 'enlace')),
  fecha_hora    timestamptz not null default now(),
  texto         text not null default '' check (length(texto) <= 600),
  link          text not null default '' check (length(link) <= 400),
  id_plataforma text not null default '' check (length(id_plataforma) <= 80),
  created_at    timestamptz not null default now()
);
create index if not exists pub_empresa_idx on public.publicaciones (empresa_id, fecha_hora desc);
create unique index if not exists pub_plataforma_uq on public.publicaciones (empresa_id, red, id_plataforma) where id_plataforma <> '';
alter table public.publicaciones enable row level security;

-- 6) Métricas por publicación (una fila por corte).
create table if not exists public.metricas (
  id                 bigserial primary key,
  empresa_id         uuid not null references public.empresas (id) on delete cascade,
  publicacion_id     uuid not null references public.publicaciones (id) on delete cascade,
  red                text not null,
  fecha_corte        date not null default current_date,
  vistas             bigint, espectadores bigint, me_gusta bigint, comentarios bigint, compartidos bigint, guardados bigint,
  seguidores_nuevos  bigint, retencion numeric(6, 2), visitas_perfil bigint, clientes_generados int,
  extra              jsonb not null default '{}',
  unique (publicacion_id, fecha_corte)
);
create index if not exists met_empresa_idx on public.metricas (empresa_id, red);
alter table public.metricas enable row level security;

-- 7) Métricas de la cuenta por día (visualizaciones, espectadores, alcance, interacciones, seguidores, visitas, clics…).
create table if not exists public.metricas_cuenta (
  id         bigserial primary key,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  red        text not null check (red in ('tiktok', 'instagram', 'facebook')),
  fecha      date not null,
  metrica    text not null check (metrica ~ '^[a-z0-9_]{2,40}$'),
  valor      numeric not null,
  unique (empresa_id, red, fecha, metrica)
);
create index if not exists mc_empresa_idx on public.metricas_cuenta (empresa_id, red, fecha);
alter table public.metricas_cuenta enable row level security;

-- 8) Audiencia: sexo, edad, ubicación, hora y día de mayor actividad.
create table if not exists public.audiencia (
  id          bigserial primary key,
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  red         text not null check (red in ('tiktok', 'instagram', 'facebook')),
  fecha_corte date not null default current_date,
  dimension   text not null check (dimension in ('sexo', 'edad', 'edad_sexo', 'ciudad', 'pais', 'hora', 'dia', 'formato')),
  valor       text not null check (length(valor) between 1 and 80),
  porcentaje  numeric not null,
  unique (empresa_id, red, fecha_corte, dimension, valor)
);
alter table public.audiencia enable row level security;

-- 9) Mapeos del importador: columna de la plataforma → columna universal (se confirma una vez y queda guardado).
create table if not exists public.mapeos_import (
  id              bigserial primary key,
  owner           uuid not null references public.perfiles (id) on delete cascade,
  red             text not null,
  columna_origen  text not null check (length(columna_origen) between 1 and 80),
  columna_destino text not null check (length(columna_destino) between 1 and 40),
  unique (owner, red, columna_origen)
);
alter table public.mapeos_import enable row level security;

-- 10) Guía por red: tips cortos que aparecen junto a cada métrica (iguales para todos).
create table if not exists public.guia_redes (
  id      serial primary key,
  red     text not null,
  metrica text not null,
  tip     text not null,
  unique (red, metrica)
);
alter table public.guia_redes enable row level security;
insert into public.guia_redes (red, metrica, tip) values
  ('tiktok', 'vistas', 'TikTok es tu laboratorio: sube todo lo nuevo y compara contra tu promedio de las últimas 2 semanas.'),
  ('tiktok', 'compartidos', 'Compartidos es la señal más fuerte: si supera tu promedio en 48 h, ese video pasa a Instagram.'),
  ('tiktok', 'retencion', 'Si la gente se va antes de 3 segundos, el problema es el gancho, no el tema.'),
  ('tiktok', 'espectadores_nuevos', 'Espectadores nuevos bajando = falta volumen de videos nuevos, no calidad.'),
  ('tiktok', 'visitas_perfil', 'Visitas al perfil altas y pocos seguidores: revisa tu foto, nombre y bio.'),
  ('instagram', 'vistas', 'Instagram premia lo probado: sube los ganadores de TikTok y carruseles educativos.'),
  ('instagram', 'pct_no_seguidores', 'Sobre 70% de no seguidores = el algoritmo te está mostrando a gente nueva. Buena señal.'),
  ('instagram', 'guardados', 'Guardados altos = contenido útil. Repite el tema con otro gancho.'),
  ('instagram', 'compartidos', 'Lo que se comparte por mensaje es lo que más alcance trae.'),
  ('instagram', 'seguidores_nuevos', 'Mira qué publicación trajo más seguidores, no cuál tuvo más vistas.'),
  ('facebook', 'vistas', 'Facebook: el mismo reel de Instagram con texto más largo y llamado a agendar.'),
  ('facebook', 'interacciones', 'Comentarios en Facebook suelen ser preguntas: respóndelas, son clientes.'),
  ('facebook', 'clics_enlace', 'Si los clics están en 0, agrega el link de agenda en el texto, no solo en la bio.'),
  ('todas', 'clientes_generados', 'La métrica que manda: anota de qué video llegó cada cliente.')
on conflict (red, metrica) do update set tip = excluded.tip;

-- 11) Meses cerrados: el resumen de cada mes queda aquí (liviano) y las filas diarias se borran (ciclo mensual).
create table if not exists public.resumen_mes (
  id         bigserial primary key,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  red        text not null,
  mes        date not null check (extract(day from mes) = 1),
  metrica    text not null,
  valor      numeric not null,
  unique (empresa_id, red, mes, metrica)
);
create index if not exists rm_empresa_idx on public.resumen_mes (empresa_id, mes);
alter table public.resumen_mes enable row level security;

-- ---------------------------------------------------------------------
-- D. Quién soy y reglas de plan
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.perfiles p join auth.users u on u.id = p.id
    where p.id = auth.uid() and p.rol = 'admin' and not p.suspendido
      and lower(u.email) = public.admin_email() and u.email_confirmed_at is not null)
$$;
create or replace function public.is_socio() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'socio' and not p.suspendido)
$$;
create or replace function public.is_staff() returns boolean
language sql stable as $$ select public.is_admin() or public.is_socio() $$;

-- Pro vigente (el admin y los socios siempre).
create or replace function public.es_pro(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.rol in ('admin', 'socio') or p.premium_hasta > now() from public.perfiles p where p.id = uid), false)
$$;
create or replace function public.limite(uid uuid, clave text) returns int
language sql stable security definer set search_path = '' as $$
  select (limites ->> clave)::int from public.planes where codigo = case when public.es_pro(uid) then 'pro' else 'free' end
$$;

create or replace function public.admin_check() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Solo el administrador'; end if;
end $$;
create or replace function public.super_check() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Solo el súper administrador'; end if;
end $$;
create or replace function public.edit_check(p_motivo text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.is_admin() then return; end if;
  if not public.is_socio() then raise exception 'Solo el administrador'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 4 then raise exception 'Escribe el motivo del cambio (mínimo 4 letras)'; end if;
end $$;

create or replace function public.auditar(p_accion text, p_detalle text, p_motivo text default '') returns void
language sql security definer set search_path = '' as $$
  insert into public.auditoria (quien, accion, detalle, motivo, rol, quien_email)
  select auth.uid(), left(p_accion, 60), left(coalesce(p_detalle, ''), 500), left(coalesce(p_motivo, ''), 300),
         coalesce(p.rol, ''), coalesce(p.email, '')
  from (select 1) x left join public.perfiles p on p.id = auth.uid()
$$;

create or replace function public.avisar_staff(p_titulo text, p_cuerpo text, p_url text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notificaciones (para, titulo, cuerpo, url)
  select p.id, left(p_titulo, 90), left(coalesce(p_cuerpo, ''), 240), coalesce(p_url, '')
  from public.perfiles p where p.rol in ('admin', 'socio') and not p.suspendido
$$;

-- ¿Esta empresa es mía? (la usan todas las reglas de acceso)
create or replace function public.mi_empresa(p_empresa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.empresas e where e.id = p_empresa and e.owner = auth.uid())
$$;

-- Registro de cuentas: abierto con correo. El socio entra por invitación del administrador.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  inv public.invitaciones;
  em text := lower(new.email);
  rolx text := 'usuario';
  nom text;
begin
  if em = public.admin_email() then
    insert into public.perfiles (id, email, nombre, rol) values (new.id, em, 'Administrador', 'admin') on conflict (id) do nothing;
    return new;
  end if;
  select * into inv from public.invitaciones where email = em and created_at > now() - interval '1 day';
  if inv.email is not null then
    rolx := inv.rol; nom := inv.nombre;
    delete from public.invitaciones where email = em;
  else
    nom := trim(coalesce(meta ->> 'nombre', ''));
  end if;
  insert into public.perfiles (id, email, nombre, telefono, rol, premium_hasta, prueba_usada, created_by)
  values (new.id, em, left(coalesce(nom, ''), 80), left(coalesce(inv.telefono, meta ->> 'telefono', ''), 30), rolx,
          case when rolx = 'usuario' then now() + make_interval(days => coalesce(public.cfg_int('dias_prueba'), 7)) end,
          rolx = 'usuario', inv.created_by)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

insert into public.perfiles (id, email, nombre, rol)
select u.id, lower(u.email), 'Administrador', 'admin' from auth.users u where lower(u.email) = public.admin_email()
on conflict (id) do update set rol = 'admin';

create or replace function public.preparar_cuenta(p_caller uuid, p_email text, p_nombre text, p_telefono text, p_rol text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.perfiles; em text := lower(trim(coalesce(p_email, '')));
begin
  select * into c from public.perfiles where id = p_caller and not suspendido;
  if c.id is null or c.rol not in ('admin', 'socio') then return jsonb_build_object('ok', false, 'error', 'Sin permiso'); end if;
  if p_rol not in ('socio', 'usuario') then return jsonb_build_object('ok', false, 'error', 'Tipo de cuenta no válido'); end if;
  if p_rol = 'socio' and c.rol <> 'admin' then return jsonb_build_object('ok', false, 'error', 'Solo el súper administrador crea socios'); end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'Correo no válido'); end if;
  if trim(coalesce(p_nombre, '')) = '' then return jsonb_build_object('ok', false, 'error', 'Escribe el nombre'); end if;
  if exists (select 1 from auth.users where lower(email) = em) then return jsonb_build_object('ok', false, 'error', 'Ese correo ya tiene cuenta'); end if;
  insert into public.invitaciones (email, rol, nombre, telefono, created_by)
  values (em, p_rol, trim(p_nombre), trim(coalesce(p_telefono, '')), c.id)
  on conflict (email) do update set rol = excluded.rol, nombre = excluded.nombre, telefono = excluded.telefono,
    created_by = excluded.created_by, created_at = now();
  insert into public.auditoria (quien, accion, detalle, rol, quien_email) values (c.id, 'crear_cuenta', p_rol || ' ' || em, c.rol, c.email);
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.cancelar_invitacion(p_email text) returns void
language sql security definer set search_path = '' as $$ delete from public.invitaciones where email = lower(trim(p_email)) $$;
create or replace function public.preparar_borrado(p_caller uuid, p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.perfiles; t public.perfiles;
begin
  select * into c from public.perfiles where id = p_caller and not suspendido;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'Sin permiso'); end if;
  -- Cada persona puede borrar su propia cuenta; el staff, otras (el socio con motivo).
  if p_id <> c.id and c.rol not in ('admin', 'socio') then return jsonb_build_object('ok', false, 'error', 'Sin permiso'); end if;
  if p_id <> c.id and c.rol = 'socio' and length(trim(coalesce(p_motivo, ''))) < 4 then return jsonb_build_object('ok', false, 'error', 'Escribe el motivo (mínimo 4 letras)'); end if;
  select * into t from public.perfiles where id = p_id;
  if t.id is null then return jsonb_build_object('ok', false, 'error', 'Cuenta no encontrada'); end if;
  if t.rol = 'admin' then return jsonb_build_object('ok', false, 'error', 'No se puede borrar al administrador'); end if;
  if t.rol = 'socio' and c.rol <> 'admin' then return jsonb_build_object('ok', false, 'error', 'Solo el súper administrador borra socios'); end if;
  insert into public.auditoria (quien, accion, detalle, motivo, rol, quien_email) values (c.id, 'borrar_cuenta', t.email, left(coalesce(p_motivo, ''), 300), c.rol, c.email);
  return jsonb_build_object('ok', true, 'ids', jsonb_build_array(t.id));
end $$;

-- ---------------------------------------------------------------------
-- E. Reglas automáticas (límite de empresas del plan, fecha de cambio de las ideas)
-- ---------------------------------------------------------------------
create or replace function public.empresas_antes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int; n int;
begin
  if tg_op = 'INSERT' then
    new.owner := auth.uid();
    if new.owner is null then raise exception 'Inicia sesión'; end if;
    lim := coalesce(public.limite(new.owner, 'empresas'), 1);
    select count(*) into n from public.empresas where owner = new.owner;
    if lim > 0 and n >= lim then raise exception 'Tu plan permite % empresa(s). Pásate a Pro para agregar más.', lim; end if;
  else
    new.owner := old.owner;
  end if;
  new.equipo := coalesce(new.equipo, '[]'::jsonb);
  if jsonb_typeof(new.equipo) <> 'array' or length(new.equipo::text) > 3000 then raise exception 'Equipo no válido'; end if;
  if jsonb_typeof(new.ritmo) <> 'object' or length(new.ritmo::text) > 500 then raise exception 'Ritmo no válido'; end if;
  return new;
end $$;
drop trigger if exists empresas_antes on public.empresas;
create trigger empresas_antes before insert or update on public.empresas for each row execute function public.empresas_antes();

create or replace function public.ideas_antes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int; n int; dueno uuid;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    select owner into dueno from public.empresas where id = new.empresa_id;
    lim := coalesce(public.limite(dueno, 'ideas_semana'), 0);
    if lim > 0 then
      select count(*) into n from public.ideas i where i.empresa_id = new.empresa_id and i.created_at > now() - interval '7 days';
      if n >= lim then raise exception 'Llegaste a % ideas esta semana en el plan Gratis. Pásate a Pro para ideas ilimitadas.', lim; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ideas_antes on public.ideas;
create trigger ideas_antes before insert or update on public.ideas for each row execute function public.ideas_antes();

-- ---------------------------------------------------------------------
-- F. Políticas (cada persona solo ve lo suyo; ni admin ni socios leen el contenido de otros)
-- ---------------------------------------------------------------------
drop policy if exists "ver perfiles" on public.perfiles;
create policy "ver perfiles" on public.perfiles for select to authenticated using (id = auth.uid() or public.is_staff());
drop policy if exists "mis empresas" on public.empresas;
create policy "mis empresas" on public.empresas for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
do $$
declare t text;
begin
  foreach t in array array['base_contenido', 'ideas', 'pedidos', 'publicaciones', 'metricas', 'metricas_cuenta', 'audiencia', 'resumen_mes'] loop
    execute format('drop policy if exists "de mi empresa" on public.%I', t);
    execute format('create policy "de mi empresa" on public.%I for all to authenticated using (public.mi_empresa(empresa_id)) with check (public.mi_empresa(empresa_id))', t);
  end loop;
end $$;
drop policy if exists "mis mapeos" on public.mapeos_import;
create policy "mis mapeos" on public.mapeos_import for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "ver guia" on public.guia_redes;
create policy "ver guia" on public.guia_redes for select to authenticated using (true);
drop policy if exists "mis avisos" on public.notificaciones;
create policy "mis avisos" on public.notificaciones for select to authenticated using (para = auth.uid());
drop policy if exists "leer mis avisos" on public.notificaciones;
create policy "leer mis avisos" on public.notificaciones for update to authenticated using (para = auth.uid()) with check (para = auth.uid());
drop policy if exists "borrar mis avisos" on public.notificaciones;
create policy "borrar mis avisos" on public.notificaciones for delete to authenticated using (para = auth.uid());
drop policy if exists "ver textos" on public.textos;
create policy "ver textos" on public.textos for select to anon, authenticated using (true);
drop policy if exists "ver planes" on public.planes;
create policy "ver planes" on public.planes for select to anon, authenticated using (true);

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on public.perfiles, public.notificaciones, public.textos, public.planes, public.guia_redes,
  public.empresas, public.base_contenido, public.ideas, public.pedidos, public.publicaciones, public.metricas,
  public.metricas_cuenta, public.audiencia, public.mapeos_import, public.resumen_mes to authenticated;
grant select on public.textos, public.planes to anon;
grant insert, update, delete on public.empresas, public.base_contenido, public.ideas, public.pedidos, public.publicaciones,
  public.metricas, public.metricas_cuenta, public.audiencia, public.mapeos_import to authenticated;
grant update (leida), delete on public.notificaciones to authenticated;
grant usage, select on all sequences in schema public to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notificaciones') then
    alter publication supabase_realtime add table public.notificaciones;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- G. Cuenta y funciones de la app
-- ---------------------------------------------------------------------
create or replace function public.config_publica() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'config', (select jsonb_object_agg(clave, valor) from public.config),
    'textos', (select jsonb_object_agg(clave, valor) from public.textos),
    'planes', (select jsonb_object_agg(codigo, jsonb_build_object('nombre', nombre, 'descripcion', descripcion,
                 'limites', limites, 'beneficios', beneficios, 'duracion_dias', duracion_dias)) from public.planes))
$$;

create or replace function public.mi_cuenta() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'email', p.email, 'nombre', p.nombre, 'telefono', p.telefono, 'rol', p.rol,
    'suspendido', p.suspendido, 'is_admin', public.is_admin(), 'is_socio', public.is_socio(),
    'premium', public.es_pro(p.id), 'premium_hasta', p.premium_hasta, 'prefs', p.prefs, 'db_version', public.db_version(),
    'limites', (select limites from public.planes where codigo = case when public.es_pro(p.id) then 'pro' else 'free' end))
  from public.perfiles p where p.id = auth.uid()
$$;

create or replace function public.mi_perfil_guardar(p_nombre text, p_telefono text, p_prefs jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare f jsonb;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  if p_prefs is not null then
    if jsonb_typeof(p_prefs) <> 'object' or length(p_prefs::text) > 1500 then raise exception 'Datos no válidos'; end if;
    select coalesce(jsonb_object_agg(k, v), '{}') into f from jsonb_each(p_prefs) as t(k, v)
    where k in ('empresa', 'tema', 'guia', 'avatar', 'resumen_lunes', 'recordar_metricas');
  end if;
  update public.perfiles set nombre = left(trim(coalesce(p_nombre, nombre)), 80), telefono = left(trim(coalesce(p_telefono, telefono)), 30),
    prefs = case when f is null then prefs else prefs || f end
  where id = auth.uid();
end $$;

-- Carga masiva a la base de contenido: [{ tema, categoria, texto }]. Repetidas se ignoran.
create or replace function public.base_importar(p_empresa uuid, p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int; total int;
begin
  if not public.mi_empresa(p_empresa) then raise exception 'Empresa no encontrada'; end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) > 5000 then raise exception 'Máximo 5.000 filas por carga'; end if;
  total := jsonb_array_length(p_filas);
  insert into public.base_contenido (empresa_id, tema, categoria, texto)
  select p_empresa, left(trim(f ->> 'tema'), 60), lower(trim(f ->> 'categoria')), left(trim(f ->> 'texto'), 300)
  from jsonb_array_elements(p_filas) f
  where coalesce(trim(f ->> 'tema'), '') <> '' and coalesce(trim(f ->> 'texto'), '') <> ''
    and lower(trim(f ->> 'categoria')) in ('parte', 'sintoma', 'error', 'mito', 'dato', 'costo', 'idea_video', 'cta', 'toma', 'estructura_gancho', 'formato')
  on conflict (empresa_id, tema, categoria, texto) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('nuevas', n, 'ignoradas', total - n);
end $$;

-- Marca elementos de la base como usados (suma 1 y guarda la fecha).
create or replace function public.base_marcar_uso(p_empresa uuid, p_ids bigint[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.mi_empresa(p_empresa) then raise exception 'Empresa no encontrada'; end if;
  update public.base_contenido set veces_usado = veces_usado + 1, ultimo_uso = now() where empresa_id = p_empresa and id = any (p_ids);
end $$;

-- Importador universal. p_tipo:
--   'cuenta'    → [{ fecha, metrica, valor }]                                   (series diarias de Meta o TikTok)
--   'audiencia' → [{ dimension, valor, porcentaje }]                            (sexo, edad, ciudad, país, hora, día, formato)
--   'contenido' → [{ publicacion_id?, id_plataforma, link, fecha_hora, texto, tipo, vistas, …, extra }]  (una fila por publicación)
create or replace function public.metricas_importar(p_empresa uuid, p_red text, p_tipo text, p_filas jsonb, p_fecha date default current_date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f jsonb; n int := 0; pid uuid; nuevas int := 0;
  num constant text := '^-?[0-9]+(\.[0-9]+)?$';
begin
  if not public.mi_empresa(p_empresa) then raise exception 'Empresa no encontrada'; end if;
  if p_red not in ('tiktok', 'instagram', 'facebook') then raise exception 'Red no válida'; end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) > 3000 then raise exception 'Máximo 3.000 filas por carga'; end if;
  if p_tipo = 'cuenta' then
    -- Si el lote trae la misma fecha y métrica dos veces, vale la última.
    insert into public.metricas_cuenta (empresa_id, red, fecha, metrica, valor)
    select distinct on (d, m) p_empresa, p_red, d, m, v from (
      select left(x ->> 'fecha', 10)::date as d, x ->> 'metrica' as m, (x ->> 'valor')::numeric as v, o
      from jsonb_array_elements(p_filas) with ordinality as t(x, o)
      where (x ->> 'fecha') ~ '^\d{4}-\d{2}-\d{2}' and (x ->> 'metrica') ~ '^[a-z0-9_]{2,40}$' and (x ->> 'valor') ~ num) z
    order by d, m, o desc
    on conflict (empresa_id, red, fecha, metrica) do update set valor = excluded.valor;
    get diagnostics n = row_count;
  elsif p_tipo = 'audiencia' then
    insert into public.audiencia (empresa_id, red, fecha_corte, dimension, valor, porcentaje)
    select distinct on (di, va) p_empresa, p_red, coalesce(p_fecha, current_date), di, va, po from (
      select x ->> 'dimension' as di, left(x ->> 'valor', 80) as va, (x ->> 'porcentaje')::numeric as po, o
      from jsonb_array_elements(p_filas) with ordinality as t(x, o)
      where (x ->> 'dimension') in ('sexo', 'edad', 'edad_sexo', 'ciudad', 'pais', 'hora', 'dia', 'formato') and coalesce(x ->> 'valor', '') <> '' and (x ->> 'porcentaje') ~ num) z
    order by di, va, o desc
    on conflict (empresa_id, red, fecha_corte, dimension, valor) do update set porcentaje = excluded.porcentaje;
    get diagnostics n = row_count;
  elsif p_tipo = 'contenido' then
    for f in select * from jsonb_array_elements(p_filas) loop
      pid := null;
      if coalesce(f ->> 'publicacion_id', '') ~ '^[0-9a-f-]{36}$' then
        select id into pid from public.publicaciones where empresa_id = p_empresa and id = (f ->> 'publicacion_id')::uuid;
      end if;
      if pid is null and coalesce(f ->> 'id_plataforma', '') <> '' then
        select id into pid from public.publicaciones where empresa_id = p_empresa and red = p_red and id_plataforma = f ->> 'id_plataforma';
      end if;
      if pid is null and coalesce(f ->> 'link', '') <> '' then
        select id into pid from public.publicaciones where empresa_id = p_empresa and red = p_red and link = f ->> 'link' limit 1;
      end if;
      if pid is null then
        insert into public.publicaciones (empresa_id, red, tipo, fecha_hora, texto, link, id_plataforma)
        values (p_empresa, p_red,
          case when f ->> 'tipo' in ('reel', 'video', 'carrusel', 'foto', 'historia', 'texto', 'enlace') then f ->> 'tipo' else 'reel' end,
          coalesce(nullif(f ->> 'fecha_hora', '')::timestamptz, now()), left(coalesce(f ->> 'texto', ''), 600),
          left(coalesce(f ->> 'link', ''), 400), left(coalesce(f ->> 'id_plataforma', ''), 80))
        returning id into pid;
        nuevas := nuevas + 1;
      end if;
      insert into public.metricas (empresa_id, publicacion_id, red, fecha_corte, vistas, espectadores, me_gusta, comentarios, compartidos,
        guardados, seguidores_nuevos, retencion, visitas_perfil, extra)
      values (p_empresa, pid, p_red, coalesce(p_fecha, current_date),
        case when (f ->> 'vistas') ~ num then (f ->> 'vistas')::numeric::bigint end,
        case when (f ->> 'espectadores') ~ num then (f ->> 'espectadores')::numeric::bigint end,
        case when (f ->> 'me_gusta') ~ num then (f ->> 'me_gusta')::numeric::bigint end,
        case when (f ->> 'comentarios') ~ num then (f ->> 'comentarios')::numeric::bigint end,
        case when (f ->> 'compartidos') ~ num then (f ->> 'compartidos')::numeric::bigint end,
        case when (f ->> 'guardados') ~ num then (f ->> 'guardados')::numeric::bigint end,
        case when (f ->> 'seguidores_nuevos') ~ num then (f ->> 'seguidores_nuevos')::numeric::bigint end,
        case when (f ->> 'retencion') ~ num then least((f ->> 'retencion')::numeric, 9999) end,
        case when (f ->> 'visitas_perfil') ~ num then (f ->> 'visitas_perfil')::numeric::bigint end,
        case when jsonb_typeof(f -> 'extra') = 'object' then f -> 'extra' else '{}'::jsonb end)
      on conflict (publicacion_id, fecha_corte) do update set
        vistas = coalesce(excluded.vistas, metricas.vistas), espectadores = coalesce(excluded.espectadores, metricas.espectadores),
        me_gusta = coalesce(excluded.me_gusta, metricas.me_gusta), comentarios = coalesce(excluded.comentarios, metricas.comentarios),
        compartidos = coalesce(excluded.compartidos, metricas.compartidos), guardados = coalesce(excluded.guardados, metricas.guardados),
        seguidores_nuevos = coalesce(excluded.seguidores_nuevos, metricas.seguidores_nuevos), retencion = coalesce(excluded.retencion, metricas.retencion),
        visitas_perfil = coalesce(excluded.visitas_perfil, metricas.visitas_perfil), extra = metricas.extra || excluded.extra;
      n := n + 1;
    end loop;
  else
    raise exception 'Tipo de importación no válido';
  end if;
  return jsonb_build_object('filas', n, 'publicaciones_nuevas', nuevas);
end $$;

-- Cuánto espacio ocupo (filas y tamaño aproximado de mis datos) y meses que ya se pueden cerrar.
create or replace function public.mi_uso() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e uuid[] := array(select id from public.empresas where owner = auth.uid());
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  return jsonb_build_object(
    'tablas', jsonb_build_array(
      jsonb_build_object('t', 'Base de contenido', 'filas', (select count(*) from public.base_contenido where empresa_id = any (e)), 'bytes', (select coalesce(sum(pg_column_size(x.*)), 0) from public.base_contenido x where empresa_id = any (e))),
      jsonb_build_object('t', 'Ideas', 'filas', (select count(*) from public.ideas where empresa_id = any (e)), 'bytes', (select coalesce(sum(pg_column_size(x.*)), 0) from public.ideas x where empresa_id = any (e))),
      jsonb_build_object('t', 'Pedidos', 'filas', (select count(*) from public.pedidos where empresa_id = any (e)), 'bytes', (select coalesce(sum(pg_column_size(x.*)), 0) from public.pedidos x where empresa_id = any (e))),
      jsonb_build_object('t', 'Publicaciones', 'filas', (select count(*) from public.publicaciones where empresa_id = any (e)), 'bytes', (select coalesce(sum(pg_column_size(x.*)), 0) from public.publicaciones x where empresa_id = any (e))),
      jsonb_build_object('t', 'Métricas por publicación', 'filas', (select count(*) from public.metricas where empresa_id = any (e)), 'bytes', (select coalesce(sum(pg_column_size(x.*)), 0) from public.metricas x where empresa_id = any (e))),
      jsonb_build_object('t', 'Métricas diarias', 'filas', (select count(*) from public.metricas_cuenta where empresa_id = any (e)), 'bytes', (select coalesce(sum(pg_column_size(x.*)), 0) from public.metricas_cuenta x where empresa_id = any (e))),
      jsonb_build_object('t', 'Audiencia', 'filas', (select count(*) from public.audiencia where empresa_id = any (e)), 'bytes', (select coalesce(sum(pg_column_size(x.*)), 0) from public.audiencia x where empresa_id = any (e))),
      jsonb_build_object('t', 'Meses cerrados', 'filas', (select count(*) from public.resumen_mes where empresa_id = any (e)), 'bytes', (select coalesce(sum(pg_column_size(x.*)), 0) from public.resumen_mes x where empresa_id = any (e)))),
    'limite_bytes', coalesce(public.cfg_int('limite_db_mb'), 500)::bigint * 1048576,
    'db_bytes', case when public.is_staff() then pg_database_size(current_database()) end);
end $$;

-- Cierre de mes: guarda el resumen del mes (totales por red y métrica) en resumen_mes y borra lo pesado de ese mes:
--   · métricas diarias de la cuenta · audiencia antigua (queda la última foto) · cortes repetidos de métricas por publicación (queda el último).
--   Las ideas NO se borran: guardan qué ganchos ya se usaron (antirrepetición). Solo meses ya terminados.
create or replace function public.cerrar_mes(p_empresa uuid, p_mes date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ini date := date_trunc('month', p_mes)::date; fin date := (date_trunc('month', p_mes) + interval '1 month')::date;
  n_res int; n_dia int; n_aud int; n_met int; ultima date;
begin
  if not public.mi_empresa(p_empresa) then raise exception 'Empresa no encontrada'; end if;
  if fin > date_trunc('month', (now() at time zone 'America/Santiago'))::date then raise exception 'Solo se cierran meses terminados'; end if;
  -- Totales del mes (las métricas "_30d" de capturas son fotos: se guarda la última, no la suma).
  insert into public.resumen_mes (empresa_id, red, mes, metrica, valor)
  select p_empresa, red, ini, metrica, case when metrica ~ '_\d+d$' then (array_agg(valor order by fecha desc))[1] else sum(valor) end
  from public.metricas_cuenta where empresa_id = p_empresa and fecha >= ini and fecha < fin group by red, metrica
  on conflict (empresa_id, red, mes, metrica) do update set valor = excluded.valor;
  get diagnostics n_res = row_count;
  -- Publicaciones del mes y sus resultados (últimos), para comparar meses.
  insert into public.resumen_mes (empresa_id, red, mes, metrica, valor)
  select p_empresa, p.red, ini, k, sum(v) from public.publicaciones p
    join lateral (select * from public.metricas m where m.publicacion_id = p.id order by m.fecha_corte desc limit 1) m on true,
    lateral (values ('pub_publicadas', 1::numeric), ('pub_vistas', coalesce(m.vistas, 0)), ('pub_compartidos', coalesce(m.compartidos, 0)), ('pub_clientes', coalesce(m.clientes_generados, 0))) x(k, v)
  where p.empresa_id = p_empresa and p.fecha_hora >= ini and p.fecha_hora < fin group by p.red, k
  on conflict (empresa_id, red, mes, metrica) do update set valor = excluded.valor;
  delete from public.metricas_cuenta where empresa_id = p_empresa and fecha >= ini and fecha < fin;
  get diagnostics n_dia = row_count;
  select max(fecha_corte) into ultima from public.audiencia where empresa_id = p_empresa;
  delete from public.audiencia where empresa_id = p_empresa and fecha_corte < fin and fecha_corte < ultima;
  get diagnostics n_aud = row_count;
  delete from public.metricas m where m.empresa_id = p_empresa and m.fecha_corte < fin
    and exists (select 1 from public.metricas m2 where m2.publicacion_id = m.publicacion_id and m2.fecha_corte > m.fecha_corte);
  get diagnostics n_met = row_count;
  return jsonb_build_object('mes', ini, 'resumen', n_res, 'diarias_borradas', n_dia, 'audiencia_borrada', n_aud, 'cortes_borrados', n_met);
end $$;

-- Respaldo de mis datos (Excel desde la app: una hoja por tabla).
create or replace function public.mi_respaldo() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  return jsonb_build_object(
    'Empresas', (select coalesce(jsonb_agg(to_jsonb(e) - 'owner' order by e.created_at), '[]') from public.empresas e where e.owner = auth.uid()),
    'Base', (select coalesce(jsonb_agg(jsonb_build_object('empresa', e.nombre, 'tema', b.tema, 'categoria', b.categoria, 'texto', b.texto, 'veces_usado', b.veces_usado) order by e.nombre, b.tema, b.categoria), '[]')
             from public.base_contenido b join public.empresas e on e.id = b.empresa_id where e.owner = auth.uid()),
    'Ideas', (select coalesce(jsonb_agg((to_jsonb(i) - 'empresa_id') || jsonb_build_object('empresa', e.nombre) order by i.created_at), '[]')
              from public.ideas i join public.empresas e on e.id = i.empresa_id where e.owner = auth.uid()),
    'Pedidos', (select coalesce(jsonb_agg((to_jsonb(p) - 'empresa_id') || jsonb_build_object('empresa', e.nombre) order by p.fecha_pedido), '[]')
                from public.pedidos p join public.empresas e on e.id = p.empresa_id where e.owner = auth.uid()),
    'Publicaciones', (select coalesce(jsonb_agg((to_jsonb(p) - 'empresa_id') || jsonb_build_object('empresa', e.nombre) order by p.fecha_hora), '[]')
                      from public.publicaciones p join public.empresas e on e.id = p.empresa_id where e.owner = auth.uid()),
    'Metricas', (select coalesce(jsonb_agg((to_jsonb(m) - 'empresa_id' - 'extra') || jsonb_build_object('empresa', e.nombre) order by m.fecha_corte), '[]')
                 from public.metricas m join public.empresas e on e.id = m.empresa_id where e.owner = auth.uid()),
    'Cuenta', (select coalesce(jsonb_agg(jsonb_build_object('empresa', e.nombre, 'red', c.red, 'fecha', c.fecha, 'metrica', c.metrica, 'valor', c.valor) order by c.fecha), '[]')
               from public.metricas_cuenta c join public.empresas e on e.id = c.empresa_id where e.owner = auth.uid()),
    'Meses', (select coalesce(jsonb_agg(jsonb_build_object('empresa', e.nombre, 'red', r.red, 'mes', r.mes, 'metrica', r.metrica, 'valor', r.valor) order by r.mes), '[]')
              from public.resumen_mes r join public.empresas e on e.id = r.empresa_id where e.owner = auth.uid()));
end $$;

-- Borra todo mi contenido (las empresas y lo que cuelga de ellas). La cuenta se conserva.
create or replace function public.mi_borrar_datos() returns void
language sql security definer set search_path = '' as $$
  delete from public.empresas where owner = auth.uid();
  delete from public.mapeos_import where owner = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- I. Administración (la maneja el Centro de Mando)
-- ---------------------------------------------------------------------
create or replace function public.admin_resumen() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_check();
  return jsonb_build_object(
    'usuarios', (select count(*) from public.perfiles where rol = 'usuario'),
    'activos7', (select count(*) from public.perfiles where rol = 'usuario' and visto_at > now() - interval '7 days'),
    'nuevos7', (select count(*) from public.perfiles where rol = 'usuario' and created_at > now() - interval '7 days'),
    'pro', (select count(*) from public.perfiles where rol = 'usuario' and premium_hasta > now()),
    'empresas', (select count(*) from public.empresas),
    'ideas', (select count(*) from public.ideas),
    'publicadas', (select count(*) from public.ideas where estado = 'publicado'),
    'pagos_pendientes', (select count(*) from public.cfx_pagos where estado = 'pendiente'));
end $$;

create or replace function public.admin_config_guardar(p_clave text, p_valor jsonb, p_motivo text default '') returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.edit_check(p_motivo);
  if p_clave not in ('dias_prueba', 'dias_aviso_vencimiento', 'soporte_whatsapp', 'limite_db_mb', 'auditoria_max', 'version_liberada', 'version_min') then
    raise exception 'Ajuste no válido';
  end if;
  if p_clave in ('version_liberada', 'version_min') then
    perform public.super_check();
    if jsonb_typeof(p_valor) not in ('string', 'number') or (p_valor #>> '{}') !~ '^\d{1,3}(\.\d{1,3}){1,2}$' then raise exception 'Versión inválida (usa 1.0 o 1.0.1)'; end if;
    p_valor := to_jsonb(p_valor #>> '{}');
  end if;
  insert into public.config (clave, valor) values (p_clave, p_valor) on conflict (clave) do update set valor = excluded.valor;
  perform public.auditar('ajuste', p_clave || ' = ' || p_valor::text, p_motivo);
end $$;

create or replace function public.admin_texto_guardar(p_clave text, p_valor text, p_motivo text default '') returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.edit_check(p_motivo);
  update public.textos set valor = left(coalesce(p_valor, ''), 2000) where clave = p_clave;
  if not found then raise exception 'Texto no encontrado'; end if;
  perform public.auditar('texto', p_clave, p_motivo);
end $$;

create or replace function public.admin_push_claves(p_publica text, p_privada text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.super_check();
  if p_publica !~ '^[A-Za-z0-9_-]{80,100}$' or p_privada !~ '^[A-Za-z0-9_-]{40,50}$' then raise exception 'Claves no válidas'; end if;
  insert into public.secretos (clave, valor) values ('vapid_privada', p_privada) on conflict (clave) do update set valor = excluded.valor;
  insert into public.config (clave, valor) values ('vapid_publica', to_jsonb(p_publica)) on conflict (clave) do update set valor = excluded.valor;
  delete from public.push_subs where true;
  perform public.auditar('push', 'claves nuevas');
end $$;

create or replace function public.admin_auditoria(p_limite int default 5000) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_check();
  return (select coalesce(jsonb_agg(x order by x.id desc), '[]') from (
    select id, created_at, quien_email, rol, accion, detalle, motivo from public.auditoria
    order by id desc limit greatest(1, least(coalesce(p_limite, 5000), 20000))) x);
end $$;

create or replace function public.auditoria_vaciar(p_hasta_id bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public.super_check();
  delete from public.auditoria where id <= p_hasta_id;
  get diagnostics n = row_count;
  perform public.auditar('auditoria_vaciada', n || ' filas');
  return n;
end $$;

-- Respaldo y limpieza (funciones comunes cfx_*: las usa el Centro de Mando → Apps → Respaldo y limpieza).
create or replace function public.cfx_respaldo() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_check();
  return jsonb_build_object(
    'Cuentas', (select coalesce(jsonb_agg(x order by x.creada), '[]') from (select p.email as correo, p.nombre, p.telefono, p.rol,
      p.premium_hasta as pro_hasta, p.suspendido, p.visto_at as visto, p.created_at as creada,
      (select count(*) from public.empresas e where e.owner = p.id) as empresas,
      (select count(*) from public.ideas i join public.empresas e on e.id = i.empresa_id where e.owner = p.id) as ideas from public.perfiles p) x),
    'Registro', (select coalesce(jsonb_agg(x order by x.id), '[]') from (select id, created_at as fecha, quien_email as quien, rol, accion, detalle, motivo from public.auditoria) x),
    'Ajustes', (select coalesce(jsonb_agg(jsonb_build_object('clave', clave, 'valor', valor #>> '{}') order by clave), '[]') from public.config),
    'Textos', (select coalesce(jsonb_agg(jsonb_build_object('clave', clave, 'texto', valor) order by clave), '[]') from public.textos),
    'Planes', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre, 'limites', limites, 'dias', duracion_dias)), '[]') from public.planes));
end $$;

create or replace function public.cfx_limpieza() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_check();
  return jsonb_build_array(
    jsonb_build_object('clave', 'avisos', 'titulo', 'Avisos', 'detalle', 'Más de 30 días (se borran solos cada día).',
      'filas', (select count(*) from public.notificaciones where created_at < now() - interval '30 days')),
    jsonb_build_object('clave', 'descartadas', 'titulo', 'Ideas descartadas', 'detalle', 'Más de 180 días (su combinación queda libre otra vez).',
      'filas', (select count(*) from public.ideas where estado = 'descartado' and updated_at < now() - interval '180 days')),
    jsonb_build_object('clave', 'metricas', 'titulo', 'Métricas diarias antiguas', 'detalle', 'Más de 2 años.',
      'filas', (select count(*) from public.metricas_cuenta where fecha < current_date - 730)),
    jsonb_build_object('clave', 'registro', 'titulo', 'Registro de cambios', 'detalle', 'Más de 1 año.',
      'filas', (select count(*) from public.auditoria where created_at < now() - interval '365 days')));
end $$;

create or replace function public.cfx_limpiar(p_clave text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0;
begin
  perform public.super_check();
  if p_clave = 'avisos' then
    delete from public.notificaciones where created_at < now() - interval '30 days';
  elsif p_clave = 'descartadas' then
    delete from public.ideas where estado = 'descartado' and updated_at < now() - interval '180 days';
  elsif p_clave = 'metricas' then
    delete from public.metricas_cuenta where fecha < current_date - 730;
  elsif p_clave = 'registro' then
    delete from public.auditoria where created_at < now() - interval '365 days';
  else raise exception 'Opción no válida';
  end if;
  get diagnostics n = row_count;
  perform public.auditar('limpieza', p_clave || ': ' || n || ' filas');
  return n;
end $$;

create or replace function public.admin_uso() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_check();
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'limite_bytes', coalesce(public.cfg_int('limite_db_mb'), 500)::bigint * 1048576,
    'usuarios', (select count(*) from auth.users),
    'tablas', (select coalesce(jsonb_agg(jsonb_build_object('tabla', c.relname, 'bytes', pg_total_relation_size(c.oid),
                 'filas', greatest(c.reltuples, 0)::bigint) order by pg_total_relation_size(c.oid) desc), '[]')
               from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'));
end $$;

-- ---------------------------------------------------------------------
-- J. Piloto automático (cada hora): plan del lunes, métricas del domingo, publicaciones de hoy y limpieza.
--    Cada aviso sale una sola vez por persona y día (prefs.avisos_<clave> = fecha).
-- ---------------------------------------------------------------------
create or replace function public.tareas_periodicas(p_ahora timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare loc timestamp := p_ahora at time zone 'America/Santiago'; hoy date := loc::date; h int := extract(hour from loc); dow int := extract(isodow from loc);
  r record; n int := 0; clave text;
begin
  for r in select p.id, p.prefs, e.id as emp, e.nombre from public.perfiles p join public.empresas e on e.owner = p.id
           where not p.suspendido and e.activa loop
    -- Lunes 9:00: enviar los pedidos de la semana.
    if dow = 1 and h >= 9 then
      clave := 'lunes_' || r.emp;
      if coalesce(r.prefs ->> ('av_' || clave), '') <> hoy::text then
        perform public.avisar(r.id, '📋 Plan de la semana · ' || r.nombre, 'Revisa las ideas y manda los pedidos de grabación por WhatsApp.', '/app/#inicio');
        update public.perfiles set prefs = prefs || jsonb_build_object('av_' || clave, hoy::text) where id = r.id; n := n + 1;
      end if;
    end if;
    -- Domingo 19:00: importar métricas.
    if dow = 7 and h >= 19 then
      clave := 'dom_' || r.emp;
      if coalesce(r.prefs ->> ('av_' || clave), '') <> hoy::text then
        perform public.avisar(r.id, '📊 Métricas de la semana · ' || r.nombre, 'Sube las capturas o archivos de TikTok, Instagram y Facebook. Toma 5 minutos.', '/app/#metricas');
        update public.perfiles set prefs = prefs || jsonb_build_object('av_' || clave, hoy::text) where id = r.id; n := n + 1;
      end if;
    end if;
    -- Días 1 a 3, 10:00: cerrar el mes anterior (si tiene métricas diarias sin cerrar).
    if extract(day from loc) <= 3 and h >= 10 then
      clave := 'mes_' || r.emp;
      if coalesce(r.prefs ->> ('av_' || clave), '') <> to_char(hoy, 'YYYY-MM')
         and exists (select 1 from public.metricas_cuenta c where c.empresa_id = r.emp and c.fecha < date_trunc('month', hoy)::date) then
        perform public.avisar(r.id, '🗂️ Cierra el mes · ' || r.nombre, 'Descarga el Excel del mes y libera espacio. Te queda el resumen para comparar.', '/app/#metricas');
        update public.perfiles set prefs = prefs || jsonb_build_object('av_' || clave, to_char(hoy, 'YYYY-MM')) where id = r.id; n := n + 1;
      end if;
    end if;
    -- 8:00: lo que toca publicar hoy.
    if h >= 8 then
      clave := 'hoy_' || r.emp;
      if coalesce(r.prefs ->> ('av_' || clave), '') <> hoy::text
         and exists (select 1 from public.ideas i where i.empresa_id = r.emp and i.fecha_plan = hoy and i.estado in ('programado', 'editado')) then
        perform public.avisar(r.id, '🚀 Hoy publicas · ' || r.nombre,
          (select count(*) from public.ideas i where i.empresa_id = r.emp and i.fecha_plan = hoy and i.estado in ('programado', 'editado')) || ' pieza(s) programadas para hoy.', '/app/#calendario');
        update public.perfiles set prefs = prefs || jsonb_build_object('av_' || clave, hoy::text) where id = r.id; n := n + 1;
      end if;
    end if;
  end loop;
  -- Limpieza diaria: avisos de más de 30 días.
  delete from public.notificaciones where created_at < p_ahora - interval '30 days';
  return jsonb_build_object('avisos', n);
end $$;
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cc-tareas';
  perform cron.schedule('cc-tareas', '7 * * * *', 'select public.tareas_periodicas()');
exception when others then
  raise notice 'Tareas automáticas no activadas (%). Activa pg_cron en Supabase → Database → Extensions y vuelve a correr.', sqlerrm;
end $$;

-- Push (cada minuto): llama a la función "servidor", que envía los avisos nuevos a los celulares con notificaciones activas.
-- Si la función aún no está desplegada, la llamada no hace nada.
do $$
begin
  create extension if not exists pg_net with schema extensions;
  perform cron.unschedule(jobid) from cron.job where jobname = 'cc-push';
  perform cron.schedule('cc-push', '* * * * *', $c$ select net.http_post(
    url := 'https://vndqseptmymgqyxumbqy.supabase.co/functions/v1/servidor',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZuZHFzZXB0bXltZ3F5eHVtYnF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMTIxMjEsImV4cCI6MjEwODc4ODEyMX0.kJKU63-4heUrV7tUtpmDTpfXJvBWp_wgwOyEF5-DO78"}'::jsonb,
    body := '{}'::jsonb) where exists (select 1 from public.notificaciones where not push_enviado and created_at > now() - interval '1 day') $c$);
exception when others then
  raise notice 'Push automático no activado (%). Activa pg_net en Supabase → Database → Extensions y vuelve a correr.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- J2. Actualización automática: cada 10 minutos la base revisa GitHub (rama main).
--   · Si hay una base nueva (version.json → "bd"), descarga y ejecuta este mismo instalar.sql (no borra datos).
--   · La app la liberas tú desde el Centro de Mando → Apps → Liberar (no se libera sola).
-- ---------------------------------------------------------------------
create or replace function public.auto_actualizar() returns text
language plpgsql security definer set search_path = '' as $$
declare
  base constant text := 'https://raw.githubusercontent.com/CodeFixService/Contenido/main/';
  marca text := '?t=' || extract(epoch from now())::bigint; j jsonb; v_bd text; codigo text;
  re constant text := '^[0-9]+(\.[0-9]+)*$';
begin
  execute 'select content from extensions.http_get($1)' into codigo using base || 'version.json' || marca;
  j := codigo::jsonb; v_bd := j ->> 'bd';
  if v_bd ~ re and string_to_array(v_bd, '.')::int[] > string_to_array(public.db_version(), '.')::int[] then
    execute 'select content from extensions.http_get($1)' into codigo using base || 'supabase/instalar.sql' || marca;
    if codigo is null or position('function public.db_version()' in codigo) = 0 then return 'instalar.sql no disponible'; end if;
    execute codigo;
    perform public.auditar('version', 'Base actualizada sola a la v' || public.db_version());
    return 'base actualizada a ' || public.db_version();
  end if;
  return 'al día';
exception when others then
  return 'sin cambios: ' || sqlerrm;
end $$;
do $$
begin
  create extension if not exists http with schema extensions;
  perform cron.unschedule(jobid) from cron.job where jobname = 'cc-auto';
  perform cron.schedule('cc-auto', '*/10 * * * *', 'select public.auto_actualizar()');
exception when others then
  raise notice 'Actualización automática no activada (%). Activa pg_cron y http en Supabase → Database → Extensions y vuelve a correr.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- K. Permisos de las funciones
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute 'revoke execute on function ' || r.f || ' from public, anon, authenticated';
    if r.proname in ('preparar_cuenta', 'cancelar_invitacion', 'preparar_borrado', 'push_pendientes', 'push_borrar_endpoint', 'auto_actualizar',
                     'tareas_periodicas', 'avisar', 'avisar_staff', 'empresas_antes', 'ideas_antes', 'handle_new_user') then
      if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || r.f || ' to service_role'; end if;
    else
      execute 'grant execute on function ' || r.f || ' to authenticated';
      if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function ' || r.f || ' to service_role'; end if;
    end if;
  end loop;
end $$;
grant execute on function public.config_publica() to anon;
grant execute on function public.db_version() to anon, authenticated;
-- Las reglas de acceso llaman a mi_empresa(): debe poder ejecutarla quien consulta.
grant execute on function public.mi_empresa(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- L. Ganchos de esta app para el núcleo: quién soy, cómo se da el Premium, cómo se avisa y la guía para partir.
--    En Cerebro la "cuenta principal" (negocio) es cada usuario.
-- ---------------------------------------------------------------------
create or replace function public.cfx_yo() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'email', p.email, 'nombre', p.nombre, 'premium_hasta', p.premium_hasta, 'creado', p.created_at,
    'rol', case when p.rol = 'usuario' then 'negocio' else 'admin' end) from public.perfiles p where p.id = auth.uid()
$$;
create or replace function public.cfx_dar_premium(p_cuenta uuid, p_rol text, p_dias int) returns timestamptz
language sql security definer set search_path = '' as $$
  update public.perfiles set premium_hasta = greatest(coalesce(premium_hasta, now()), now()) + make_interval(days => p_dias)
  where id = p_cuenta returning premium_hasta
$$;
create or replace function public.cfx_avisar(p_cuenta uuid, p_titulo text, p_cuerpo text) returns void
language sql security definer set search_path = '' as $$ select public.avisar(p_cuenta, p_titulo, p_cuerpo, '/app/#empresa') $$;
create or replace function public.cfx_avisar_admin(p_titulo text, p_cuerpo text) returns void
language sql security definer set search_path = '' as $$ select public.avisar_staff(p_titulo, p_cuerpo, '/app/#empresa') $$;

create or replace function public.cfx_planes_app() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('grupo', m.g, 'clave', k, 'free', f.limites -> k, 'premium', p.limites -> k) order by m.g, k), '[]')
  from (values ('negocio', 'free', 'pro')) m(g, fc, pc) join public.planes f on f.codigo = m.fc join public.planes p on p.codigo = m.pc,
  lateral (select jsonb_object_keys(f.limites || p.limites) as k) x
$$;
create or replace function public.cfx_plan_guardar_app(p_grupo text, p_clave text, p_free jsonb, p_premium jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare fc text; pc text;
begin
  select m.fc, m.pc into fc, pc from (values ('negocio', 'free', 'pro')) m(g, fc, pc) where m.g = p_grupo;
  if fc is null or p_clave !~ '^[a-z_]{2,40}$' then raise exception 'Plan no válido'; end if;
  update public.planes set limites = limites || jsonb_build_object(p_clave, p_free) where codigo = fc;
  update public.planes set limites = limites || jsonb_build_object(p_clave, p_premium) where codigo = pc;
end $$;
create or replace function public.cfx_textos_app() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('clave', clave, 'valor', valor) order by clave), '[]') from public.textos
$$;
create or replace function public.cfx_texto_guardar_app(p_clave text, p_valor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.textos set valor = p_valor where clave = p_clave;
  if not found then raise exception 'Texto no encontrado'; end if;
end $$;
create or replace function public.cfx_destinatarios(p_destino text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.perfiles where not suspendido and (rol = 'usuario' or (rol = 'socio' and p_destino = 'todos'))
    and (p_destino in ('todos', 'negocios') or (p_destino = 'premium' and premium_hasta > now()) or (p_destino = 'gratis' and (premium_hasta is null or premium_hasta <= now())))
$$;
create or replace function public.cfx_marcar_verificado(p_cuenta uuid, p_si boolean) returns void
language sql security definer set search_path = '' as $$ select null::void $$;

-- Guía para partir: crear la empresa, cargar su base, generar ideas, mandar un pedido, publicar e importar métricas.
create or replace function public.cfx_guia_app() returns jsonb
language sql stable security definer set search_path = '' as $$
  with e as (select id from public.empresas where owner = auth.uid())
  select jsonb_build_array(
    jsonb_build_object('k', 'empresa', 't', 'Crea tu empresa', 'd', 'Nombre, rubro, público y quiénes graban.', 'ok', exists (select 1 from e), 'ir', 'app/#empresa'),
    jsonb_build_object('k', 'base', 't', 'Carga la base de contenido', 'd', 'Usa la plantilla o pega la que te armó el prompt.', 'ok', exists (select 1 from public.base_contenido b where b.empresa_id in (select id from e)), 'ir', 'app/#base'),
    jsonb_build_object('k', 'ideas', 't', 'Genera tus primeras ideas', 'd', 'Toca Generar semana y ajusta con 🔄.', 'ok', exists (select 1 from public.ideas i where i.empresa_id in (select id from e)), 'ir', 'app/#ideas'),
    jsonb_build_object('k', 'pedido', 't', 'Manda tu primer pedido', 'd', 'Se abre WhatsApp con el mensaje listo.', 'ok', exists (select 1 from public.pedidos p where p.empresa_id in (select id from e)), 'ir', 'app/#pedidos'),
    jsonb_build_object('k', 'metricas', 't', 'Importa tus métricas', 'd', 'Captura o archivo de TikTok, Instagram o Facebook.', 'ok', exists (select 1 from public.metricas_cuenta m where m.empresa_id in (select id from e)) or exists (select 1 from public.metricas m where m.empresa_id in (select id from e)), 'ir', 'app/#metricas'))
$$;

-- >>> CFX núcleo (no editar aquí: se copia de saas/nucleo/sql con sincronizar.py)
-- ---------------------------------------------------------------------
-- CodeFix · Pagos (igual en las 6 apps; lo reparte nucleo/sincronizar.py). Se administra desde el Centro de Mando → Pagos.
--   Precios iguales en las 6: negocio (inicio, mensual, anual) y cliente (mensual, anual). Link de pago SIN monto (la persona
--   escribe el monto; se le suma el cargo por pago online, visible como una línea aparte), tarjeta (otro link, con su propio cargo)
--   o transferencia (precio exacto, sin cargo), y foto del comprobante. Tú apruebas y se activa el Premium por días enteros.
--   Liberar: por N días nadie queda bloqueado y las cuentas creadas en ese tiempo no pagan el primer pago (quedan en gratis).
--   El comprobante se borra al aprobar o rechazar (ya no sirve). Negocios nuevos: bloqueados hasta su primer pago (si está activado).
--   Cada app define antes: cfx_yo(), cfx_dar_premium(uuid, text, int), cfx_avisar(uuid, text, text) y cfx_avisar_admin(text, text).
-- ---------------------------------------------------------------------
create table if not exists public.cfx_config (clave text primary key, valor jsonb not null);
alter table public.cfx_config enable row level security;
insert into public.cfx_config (clave, valor) values ('pagos', jsonb_build_object(
  'negocio', jsonb_build_object('inicio', 4900, 'inicio_dias', 30, 'mensual', 4900, 'anual', 49900, 'exigir_inicio', true),
  'cliente', jsonb_build_object('mensual', 3000, 'anual', 29900),
  'link', '', 'comision_pct', 0, 'whatsapp', '', 'tarjeta', jsonb_build_object('link', '', 'comision_pct', 0),
  'transferencia', jsonb_build_object('banco', '', 'tipo', '', 'numero', '', 'rut', '', 'titular', '', 'correo', ''),
  'inicio_desde', now()))
on conflict (clave) do nothing;

create table if not exists public.cfx_pagos (
  id          uuid primary key default gen_random_uuid(),
  cuenta      uuid not null,
  email       text not null default '',
  nombre      text not null default '',
  rol         text not null check (rol in ('negocio', 'cliente', 'otro')),
  periodo     text not null check (periodo in ('inicio', 'mensual', 'anual', 'otro')),
  monto       int not null check (monto between 1 and 100000000),
  medio       text not null check (medio in ('link', 'transferencia')),
  nota        text not null default '' check (length(nota) <= 300),
  comprobante text check (comprobante is null or (comprobante ~ '^data:image/(jpeg|png|webp);base64,' and length(comprobante) <= 400000)),
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  dias        int,
  motivo      text not null default '',
  creado      timestamptz not null default now(),
  resuelto    timestamptz
);
alter table public.cfx_pagos add column if not exists cupon text;
alter table public.cfx_pagos add column if not exists meses int check (meses is null or meses between 1 and 24);
alter table public.cfx_pagos drop constraint if exists cfx_pagos_medio_check;
alter table public.cfx_pagos add constraint cfx_pagos_medio_check check (medio in ('link', 'transferencia', 'tarjeta'));
alter table public.cfx_pagos drop constraint if exists cfx_pagos_periodo_check;
alter table public.cfx_pagos add constraint cfx_pagos_periodo_check check (periodo in ('inicio', 'mensual', 'meses', 'anual', 'otro'));
create index if not exists cfx_pagos_cuenta_idx on public.cfx_pagos (cuenta, creado desc);
create index if not exists cfx_pagos_estado_idx on public.cfx_pagos (estado, creado);
alter table public.cfx_pagos enable row level security;
create table if not exists public.cfx_exentos (cuenta uuid primary key, nota text not null default '', creado timestamptz not null default now());
alter table public.cfx_exentos enable row level security;
revoke all on public.cfx_config, public.cfx_pagos, public.cfx_exentos from anon, authenticated;

-- ¿Cómo estoy? Precios, mi rol, si debo el primer pago y mi último pago.
create or replace function public.cfx_pago_estado() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := (select valor from public.cfx_config where clave = 'pagos'); y jsonb := public.cfx_yo(); pagado boolean; debe boolean; bloq boolean;
        lib jsonb := (select valor from public.cfx_config where clave = 'liberar'); ld timestamptz := (lib ->> 'desde')::timestamptz; lh timestamptz := (lib ->> 'hasta')::timestamptz;
begin
  if y is null or (y ->> 'id') is null then raise exception 'Inicia sesión'; end if;
  pagado := exists (select 1 from public.cfx_pagos where cuenta = (y ->> 'id')::uuid and estado = 'aprobado')
    or exists (select 1 from public.cfx_exentos where cuenta = (y ->> 'id')::uuid);
  -- debe_inicio: cuenta nueva (desde que activaste la regla) sin primer pago. bloqueado: además es un negocio.
  -- Solo si ya hay una forma de pago configurada (si no, nadie podría pagar).
  debe := coalesce((c #>> '{negocio,exigir_inicio}')::boolean, false) and not pagado
     and (coalesce(c ->> 'link', '') <> '' or coalesce(c #>> '{transferencia,numero}', '') <> '' or coalesce(c #>> '{tarjeta,link}', '') <> '')
     and (y ->> 'creado')::timestamptz > coalesce((c ->> 'inicio_desde')::timestamptz, now())
     -- Liberado: mientras dure nadie queda bloqueado; las cuentas creadas en ese tiempo quedan en gratis sin primer pago.
     and not (lh is not null and (now() < lh or (y ->> 'creado')::timestamptz between coalesce(ld, '-infinity') and lh));
  bloq := debe and y ->> 'rol' = 'negocio';
  return jsonb_build_object('config', c - 'inicio_desde', 'yo', y, 'pagado', pagado, 'bloqueado', bloq, 'debe_inicio', debe,
    'liberado_hasta', case when lh > now() then lh end,
    'ultimo', (select to_jsonb(x) from (select id, periodo, monto, medio, estado, dias, motivo, creado, resuelto from public.cfx_pagos
               where cuenta = (y ->> 'id')::uuid order by creado desc limit 1) x));
end $$;

drop function if exists public.cfx_pago_pedir(text, int, text, text, text);
drop function if exists public.cfx_pago_pedir(text, int, text, text, text, text);
create or replace function public.cfx_pago_pedir(p_periodo text, p_monto int, p_medio text, p_comprobante text, p_nota text default '', p_cupon text default null, p_meses int default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare y jsonb := public.cfx_yo(); i uuid; cup text := nullif(upper(trim(coalesce(p_cupon, ''))), '');
begin
  if y is null or (y ->> 'id') is null then raise exception 'Inicia sesión'; end if;
  if y ->> 'rol' not in ('negocio', 'cliente') and p_periodo <> 'otro' then raise exception 'Pide al dueño de la cuenta que haga el pago'; end if;
  if p_periodo not in ('inicio', 'mensual', 'meses', 'anual', 'otro') or p_medio not in ('link', 'transferencia', 'tarjeta') then raise exception 'Datos no válidos'; end if;
  if p_periodo = 'meses' and coalesce(p_meses, 0) not between 2 and 11 then raise exception 'Elige de 2 a 11 meses'; end if;
  if coalesce(p_monto, 0) < 1 then raise exception 'Escribe el monto que pagaste'; end if;
  if coalesce(length(p_comprobante), 0) < 200 then raise exception 'Sube la foto del comprobante'; end if;
  if cup is not null then perform public.cfx_cupon_ver(cup); end if;
  if exists (select 1 from public.cfx_pagos where cuenta = (y ->> 'id')::uuid and estado = 'pendiente') then raise exception 'Ya tienes un pago en revisión. Te avisamos apenas se apruebe.'; end if;
  if (select count(*) from public.cfx_pagos where cuenta = (y ->> 'id')::uuid and creado > now() - interval '1 day') >= 5 then raise exception 'Demasiados intentos hoy. Escribe a soporte.'; end if;
  insert into public.cfx_pagos (cuenta, email, nombre, rol, periodo, monto, medio, nota, comprobante, cupon, meses)
  values ((y ->> 'id')::uuid, coalesce(y ->> 'email', ''), left(coalesce(y ->> 'nombre', ''), 80), case when y ->> 'rol' in ('negocio', 'cliente') then y ->> 'rol' else 'otro' end,
          p_periodo, p_monto, p_medio, left(coalesce(p_nota, ''), 300), p_comprobante, cup, case when p_periodo = 'meses' then p_meses end)
  returning id into i;
  -- Aviso al tiro: al Centro de Mando si la app está vinculada (si no, al administrador de esta app).
  perform public.cfx_al_cm('💳 Pago por revisar', coalesce(nullif(y ->> 'nombre', ''), y ->> 'email') || ' · $' || p_monto || ' (' || case p_periodo when 'meses' then p_meses || ' meses' else p_periodo end || ', ' || p_medio || ')' || coalesce(' · cupón ' || cup, ''), 'pago');
  return i;
end $$;

-- Precios públicos (para la portada, sin iniciar sesión).
create or replace function public.cfx_precios() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('negocio', valor -> 'negocio', 'cliente', valor -> 'cliente', 'comision_pct', valor -> 'comision_pct',
    'liberado_hasta', (select case when (l.valor ->> 'hasta')::timestamptz > now() then l.valor -> 'hasta' end from public.cfx_config l where l.clave = 'liberar'))
  from public.cfx_config where clave = 'pagos'
$$;
revoke all on function public.cfx_precios() from public;
grant execute on function public.cfx_precios() to anon, authenticated;

-- ---------- Administrador (lo llama el Centro de Mando) ----------
create or replace function public.cfx_pagos_config() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.super_check();
  return (select valor from public.cfx_config where clave = 'pagos');
end $$;

create or replace function public.cfx_pagos_config_guardar(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb := (select valor from public.cfx_config where clave = 'pagos');
begin
  perform public.super_check();
  if jsonb_typeof(p) <> 'object' then raise exception 'Datos no válidos'; end if;
  if coalesce(p ->> 'link', '') <> '' and (p ->> 'link') !~ '^https://[^ ]+$' then raise exception 'El link de pago debe empezar con https://'; end if;
  if coalesce((p ->> 'comision_pct')::numeric, 0) not between 0 and 20 or coalesce((p #>> '{tarjeta,comision_pct}')::numeric, 0) not between 0 and 20 then raise exception 'El cargo por pago online va de 0 a 20 %%'; end if;
  if coalesce(p #>> '{tarjeta,link}', '') <> '' and (p #>> '{tarjeta,link}') !~ '^https://[^ ]+$' then raise exception 'El link de tarjeta debe empezar con https://'; end if;
  -- Al activar "bloquear hasta el primer pago", solo aplica a los negocios que se registren desde ahora.
  -- También cuando se configura la primera forma de pago (antes nadie podía pagar, así que nadie quedó obligado).
  if coalesce((p #>> '{negocio,exigir_inicio}')::boolean, false) and (not coalesce((v #>> '{negocio,exigir_inicio}')::boolean, false)
     or (coalesce(v ->> 'link', '') = '' and coalesce(v #>> '{transferencia,numero}', '') = '' and coalesce(v #>> '{tarjeta,link}', '') = ''
         and (coalesce(p ->> 'link', '') <> '' or coalesce(p #>> '{transferencia,numero}', '') <> '' or coalesce(p #>> '{tarjeta,link}', '') <> ''))) then
    p := p || jsonb_build_object('inicio_desde', now());
  end if;
  v := v || (p - 'inicio_desde') || case when p ? 'inicio_desde' then jsonb_build_object('inicio_desde', p -> 'inicio_desde') else '{}'::jsonb end;
  update public.cfx_config set valor = v where clave = 'pagos';
  return v;
end $$;

create or replace function public.cfx_pagos_lista(p_estado text default 'pendiente') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.super_check();
  return (select coalesce(jsonb_agg(x order by x.creado desc), '[]') from (
    select id, cuenta, email, nombre, rol, periodo, meses, monto, medio, nota, estado, dias, motivo, creado, resuelto, comprobante is not null as con_comprobante,
      public.cfx_dias_sugeridos(g) as sugeridos,
      (select count(*) from public.cfx_pagos z where z.cuenta = g.cuenta and z.estado = 'aprobado') as aprobados
    from public.cfx_pagos g where p_estado = 'todos' or estado = p_estado order by creado desc limit 200) x);
end $$;

create or replace function public.cfx_pago_comprobante(p_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.super_check();
  return (select comprobante from public.cfx_pagos where id = p_id);
end $$;

-- Días que corresponden a un pago (siempre días enteros): mensual 30, anual 365, N meses = N × 30, primer pago lo configurado,
-- y "otro monto" en proporción al precio mensual (sin contar el cargo por pago online).
create or replace function public.cfx_dias_sugeridos(g public.cfx_pagos) returns int
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := (select valor from public.cfx_config where clave = 'pagos'); m numeric; pct numeric; neto numeric;
begin
  if g.periodo = 'inicio' then return coalesce((c #>> '{negocio,inicio_dias}')::int, 30); end if;
  if g.periodo = 'mensual' then return 30; end if;
  if g.periodo = 'anual' then return 365; end if;
  if g.periodo = 'meses' then return 30 * coalesce(g.meses, 1); end if;
  m := nullif((c #>> array[case when g.rol = 'cliente' then 'cliente' else 'negocio' end, 'mensual'])::numeric, 0);
  pct := case g.medio when 'link' then coalesce((c ->> 'comision_pct')::numeric, 0) when 'tarjeta' then coalesce((c #>> '{tarjeta,comision_pct}')::numeric, 0) else 0 end;
  neto := g.monto / (1 + pct / 100);
  return case when m is null then 0 else least(3660, floor(neto * 30 / m))::int end;
end $$;
revoke all on function public.cfx_dias_sugeridos(public.cfx_pagos) from public, anon, authenticated;

create or replace function public.cfx_pago_resolver(p_id uuid, p_aprobar boolean, p_dias int default null, p_motivo text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.cfx_pagos; c jsonb := (select valor from public.cfx_config where clave = 'pagos'); d int; hasta timestamptz;
begin
  perform public.super_check();
  select * into g from public.cfx_pagos where id = p_id and estado = 'pendiente' for update;
  if g.id is null then raise exception 'Pago no encontrado o ya resuelto'; end if;
  d := coalesce(p_dias, public.cfx_dias_sugeridos(g));
  if p_aprobar then
    if d < 0 or d > 3660 then raise exception 'Días no válidos'; end if;
    if d > 0 then hasta := public.cfx_dar_premium(g.cuenta, g.rol, d); end if;
    update public.cfx_pagos set estado = 'aprobado', dias = d, motivo = left(coalesce(p_motivo, ''), 200), resuelto = now(), comprobante = null where id = p_id;
    perform public.cfx_avisar(g.cuenta, '✅ Pago aprobado', case when hasta is not null then 'Premium activo hasta el ' || to_char(hasta at time zone 'America/Santiago', 'DD/MM/YYYY') || '. ¡Gracias!' else 'Gracias, tu pago quedó registrado.' end);
  else
    update public.cfx_pagos set estado = 'rechazado', motivo = left(coalesce(nullif(p_motivo, ''), 'No pudimos validar el comprobante'), 200), resuelto = now(), comprobante = null where id = p_id;
    perform public.cfx_avisar(g.cuenta, '⚠️ Pago rechazado', left(coalesce(nullif(p_motivo, ''), 'No pudimos validar el comprobante'), 200) || '. Puedes subirlo de nuevo.');
  end if;
  return jsonb_build_object('estado', case when p_aprobar then 'aprobado' else 'rechazado' end, 'dias', d, 'hasta', hasta);
end $$;

-- Liberar el registro por N días (0 = terminar ahora). Sin p_dias solo devuelve cómo está.
create or replace function public.cfx_liberar(p_dias int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb := (select valor from public.cfx_config where clave = 'liberar');
begin
  perform public.super_check();
  if p_dias is not null then
    if p_dias < 0 or p_dias > 90 then raise exception 'De 0 a 90 días'; end if;
    v := case when p_dias = 0 then coalesce(v, '{}'::jsonb) || jsonb_build_object('hasta', least(coalesce((v ->> 'hasta')::timestamptz, now()), now()))
         else jsonb_build_object('desde', case when (v ->> 'hasta')::timestamptz > now() then v -> 'desde' else to_jsonb(now()) end, 'hasta', now() + make_interval(days => p_dias)) end;
    insert into public.cfx_config (clave, valor) values ('liberar', v) on conflict (clave) do update set valor = excluded.valor;
  end if;
  return jsonb_build_object('desde', v -> 'desde', 'hasta', v -> 'hasta', 'activo', coalesce((v ->> 'hasta')::timestamptz > now(), false));
end $$;
revoke all on function public.cfx_liberar(int) from public, anon;
grant execute on function public.cfx_liberar(int) to authenticated;

-- Cuentas que no pagan el inicio (por ejemplo, las que creas tú de regalo).
create or replace function public.cfx_exento(p_cuenta uuid, p_si boolean, p_nota text default '') returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.super_check();
  if p_si then insert into public.cfx_exentos (cuenta, nota) values (p_cuenta, left(coalesce(p_nota, ''), 200)) on conflict (cuenta) do update set nota = excluded.nota;
  else delete from public.cfx_exentos where cuenta = p_cuenta; end if;
end $$;

create or replace function public.cfx_exento_email(p_email text, p_si boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  perform public.super_check();
  select id into u from auth.users where lower(email) = lower(trim(coalesce(p_email, '')));
  if u is null then raise exception 'No hay una cuenta con ese correo en esta app'; end if;
  perform public.cfx_exento(u, p_si, 'Desde el Centro de Mando');
  return lower(trim(p_email));
end $$;

revoke all on function public.cfx_exento_email(text, boolean) from public, anon;
grant execute on function public.cfx_exento_email(text, boolean) to authenticated;
revoke all on function public.cfx_pago_estado(), public.cfx_pago_pedir(text, int, text, text, text, text, int), public.cfx_pagos_config(), public.cfx_pagos_config_guardar(jsonb),
  public.cfx_pagos_lista(text), public.cfx_pago_comprobante(uuid), public.cfx_pago_resolver(uuid, boolean, int, text), public.cfx_exento(uuid, boolean, text) from public, anon;
grant execute on function public.cfx_pago_estado(), public.cfx_pago_pedir(text, int, text, text, text, text, int), public.cfx_pagos_config(), public.cfx_pagos_config_guardar(jsonb),
  public.cfx_pagos_lista(text), public.cfx_pago_comprobante(uuid), public.cfx_pago_resolver(uuid, boolean, int, text), public.cfx_exento(uuid, boolean, text) to authenticated;
revoke all on function public.cfx_yo(), public.cfx_dar_premium(uuid, text, int), public.cfx_avisar(uuid, text, text), public.cfx_avisar_admin(text, text) from public, anon, authenticated;
-- ---------------------------------------------------------------------
-- CodeFix · Administración común (igual en las 6 apps; se maneja desde el Centro de Mando → Control).
--   Planes (interruptores sí/no y límites), textos, aviso a todos, keys de Premium, cupones de descuento,
--   verificación de identidad y registro de lo que hace el administrador.
--   Cada app define antes: cfx_planes_app(), cfx_plan_guardar_app(text, text, jsonb, jsonb), cfx_textos_app(),
--   cfx_texto_guardar_app(text, text), cfx_destinatarios(text) y cfx_marcar_verificado(uuid, boolean).
-- ---------------------------------------------------------------------
create table if not exists public.cfx_registro (
  id bigserial primary key, quien text not null default '', accion text not null, detalle text not null default '', creado timestamptz not null default now());
create table if not exists public.cfx_keys (
  id uuid primary key default gen_random_uuid(), hash text not null unique, ultimos text not null, rol text not null check (rol in ('negocio', 'cliente')),
  dias int not null check (dias between 1 and 3660), nota text not null default '', creado timestamptz not null default now(),
  usada_por uuid, usada_email text, usada_at timestamptz, revocada boolean not null default false);
create table if not exists public.cfx_cupones (
  codigo text primary key check (codigo ~ '^[A-Z0-9-]{3,20}$'), pct int not null check (pct between 1 and 100), usos_max int, usos int not null default 0,
  vence date, activo boolean not null default true, creado timestamptz not null default now());
create table if not exists public.cfx_verificaciones (
  cuenta uuid primary key, email text not null default '', nombre text not null default '', rut text not null, documento text not null default '',
  frente text, reverso text, selfie text, estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  motivo text not null default '', creado timestamptz not null default now(), resuelto timestamptz);
alter table public.cfx_registro enable row level security;
alter table public.cfx_keys enable row level security;
alter table public.cfx_cupones enable row level security;
alter table public.cfx_verificaciones enable row level security;
revoke all on public.cfx_registro, public.cfx_keys, public.cfx_cupones, public.cfx_verificaciones from anon, authenticated;

create or replace function public.cfx_anotar(p_accion text, p_detalle text) returns void
language sql security definer set search_path = '' as $$
  insert into public.cfx_registro (quien, accion, detalle) values (coalesce((select email from auth.users where id = auth.uid()), 'sistema'), left(p_accion, 60), left(coalesce(p_detalle, ''), 400))
$$;
create or replace function public.cfx_registro_lista(p_limite int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.super_check();
  return (select coalesce(jsonb_agg(x order by x.id desc), '[]') from (select * from public.cfx_registro order by id desc limit greatest(1, least(coalesce(p_limite, 200), 2000))) x);
end $$;

-- ---------- Planes: [{grupo, clave, free, premium}] (números o sí/no) ----------
-- Borrar el registro de cambios (el común y el propio de la app, si tiene): lo de más de N días, o todo con 0. Solo el administrador.
create or replace function public.cfx_registro_borrar(p_dias int default 30) returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; k int; col text; desde timestamptz := case when coalesce(p_dias, 0) <= 0 then 'infinity'::timestamptz else now() - make_interval(days => p_dias) end;
begin
  perform public.super_check();
  delete from public.cfx_registro where creado < desde; get diagnostics n = row_count;
  if to_regclass('public.auditoria') is not null then
    select c.column_name into col from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'auditoria'
      and c.column_name in ('created_at', 'at', 'creado', 'fecha') and c.data_type like 'timestamp%' order by c.ordinal_position limit 1;
    if col is not null then execute format('delete from public.auditoria where %I < $1', col) using desde; get diagnostics k = row_count; n := n + k; end if;
  end if;
  insert into public.cfx_registro (quien, accion, detalle) values (coalesce((select email from auth.users where id = auth.uid()), 'sistema'), 'registro borrado',
    case when coalesce(p_dias, 0) <= 0 then 'todo' else 'más de ' || p_dias || ' días' end || ' (' || n || ' filas)');
  return n;
end $$;
revoke all on function public.cfx_registro_borrar(int) from public, anon;
grant execute on function public.cfx_registro_borrar(int) to authenticated;

create or replace function public.cfx_planes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.super_check();
  return public.cfx_planes_app();
end $$;
create or replace function public.cfx_plan_guardar(p_grupo text, p_clave text, p_free jsonb, p_premium jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.super_check();
  if jsonb_typeof(p_free) not in ('number', 'boolean') or jsonb_typeof(p_premium) not in ('number', 'boolean') then raise exception 'Valor no válido'; end if;
  perform public.cfx_plan_guardar_app(p_grupo, p_clave, p_free, p_premium);
  perform public.cfx_anotar('plan', p_grupo || '.' || p_clave || ': gratis ' || p_free::text || ' · premium ' || p_premium::text);
end $$;

-- ---------- Textos: [{clave, valor}] ----------
create or replace function public.cfx_textos() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.super_check();
  return public.cfx_textos_app();
end $$;
create or replace function public.cfx_texto_guardar(p_clave text, p_valor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.super_check();
  perform public.cfx_texto_guardar_app(p_clave, left(coalesce(p_valor, ''), 2000));
  perform public.cfx_anotar('texto', p_clave);
end $$;

-- ---------- Aviso a todos: destino todos | negocios | clientes | premium | gratis ----------
create or replace function public.cfx_aviso_masivo(p_destino text, p_titulo text, p_cuerpo text) returns int
language plpgsql security definer set search_path = '' as $$
declare u uuid; n int := 0;
begin
  perform public.super_check();
  if trim(coalesce(p_titulo, '')) = '' then raise exception 'Escribe el título'; end if;
  if p_destino not in ('todos', 'negocios', 'clientes', 'premium', 'gratis') then raise exception 'Destino no válido'; end if;
  for u in select * from public.cfx_destinatarios(p_destino) loop
    perform public.cfx_avisar(u, left(p_titulo, 80), left(coalesce(p_cuerpo, ''), 240));
    n := n + 1;
  end loop;
  perform public.cfx_anotar('aviso', p_destino || ' (' || n || '): ' || p_titulo);
  return n;
end $$;

-- ---------- Keys de Premium (de un solo uso). Se guardan cifradas: el código completo solo se ve al crearlas. ----------
create or replace function public.cfx_keys_crear(p_n int, p_rol text, p_dias int, p_nota text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c text; out jsonb := '[]'::jsonb;
begin
  perform public.super_check();
  if p_rol not in ('negocio', 'cliente') or coalesce(p_dias, 0) not between 1 and 3660 or coalesce(p_n, 0) not between 1 and 50 then raise exception 'Datos no válidos'; end if;
  for i in 1..p_n loop
    c := upper(replace(gen_random_uuid()::text, '-', ''));
    c := 'CFX-' || substr(c, 1, 4) || '-' || substr(c, 5, 4) || '-' || substr(c, 9, 4);
    insert into public.cfx_keys (hash, ultimos, rol, dias, nota) values (encode(sha256(convert_to(c, 'UTF8')), 'hex'), right(c, 4), p_rol, p_dias, left(coalesce(p_nota, ''), 120));
    out := out || to_jsonb(c);
  end loop;
  perform public.cfx_anotar('keys', p_n || ' keys ' || p_rol || ' de ' || p_dias || ' días');
  return out;
end $$;
create or replace function public.cfx_keys_lista() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.super_check();
  return (select coalesce(jsonb_agg(to_jsonb(k) - 'hash' order by k.creado desc), '[]') from (select * from public.cfx_keys order by creado desc limit 300) k);
end $$;
create or replace function public.cfx_key_revocar(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.super_check();
  update public.cfx_keys set revocada = true where id = p_id and usada_por is null;
  perform public.cfx_anotar('key revocada', p_id::text);
end $$;
create or replace function public.cfx_key_canjear(p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare y jsonb := public.cfx_yo(); k public.cfx_keys; h timestamptz; c text := upper(trim(coalesce(p_codigo, '')));
begin
  if y is null or (y ->> 'id') is null then raise exception 'Inicia sesión'; end if;
  if (select count(*) from public.cfx_registro where accion = 'key fallida' and detalle = (y ->> 'id') and creado > now() - interval '1 hour') >= 10 then
    raise exception 'Demasiados intentos. Prueba en una hora.';
  end if;
  select * into k from public.cfx_keys where hash = encode(sha256(convert_to(c, 'UTF8')), 'hex') for update;
  if k.id is null or k.revocada or k.usada_por is not null then
    insert into public.cfx_registro (quien, accion, detalle) values (coalesce(y ->> 'email', ''), 'key fallida', y ->> 'id');
    raise exception 'Key no válida o ya usada';
  end if;
  if k.rol <> coalesce(y ->> 'rol', '') then raise exception 'Esta key es para cuentas de %', case when k.rol = 'negocio' then 'negocio' else 'cliente' end; end if;
  h := public.cfx_dar_premium((y ->> 'id')::uuid, k.rol, k.dias);
  update public.cfx_keys set usada_por = (y ->> 'id')::uuid, usada_email = y ->> 'email', usada_at = now() where id = k.id;
  insert into public.cfx_exentos (cuenta, nota) values ((y ->> 'id')::uuid, 'Key ' || k.ultimos) on conflict (cuenta) do nothing;
  perform public.cfx_avisar_admin('🔑 Key canjeada', coalesce(y ->> 'email', '') || ' · ' || k.dias || ' días');
  return jsonb_build_object('hasta', h, 'dias', k.dias);
end $$;

-- ---------- Cupones de descuento (se aplican al pagar Premium) ----------
create or replace function public.cfx_cupon_ver(p_codigo text) returns int
language plpgsql stable security definer set search_path = '' as $$
declare c public.cfx_cupones;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  select * into c from public.cfx_cupones where codigo = upper(trim(coalesce(p_codigo, '')));
  if c.codigo is null or not c.activo or (c.vence is not null and c.vence < current_date) or (c.usos_max is not null and c.usos >= c.usos_max) then
    raise exception 'Cupón no válido o vencido';
  end if;
  return c.pct;
end $$;
create or replace function public.cfx_cupones_lista() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.super_check();
  return (select coalesce(jsonb_agg(to_jsonb(c) order by c.creado desc), '[]') from public.cfx_cupones c);
end $$;
create or replace function public.cfx_cupon_guardar(p_codigo text, p_pct int, p_usos_max int default null, p_vence date default null, p_activo boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.super_check();
  insert into public.cfx_cupones (codigo, pct, usos_max, vence, activo) values (upper(trim(p_codigo)), p_pct, p_usos_max, p_vence, coalesce(p_activo, true))
  on conflict (codigo) do update set pct = excluded.pct, usos_max = excluded.usos_max, vence = excluded.vence, activo = excluded.activo;
  perform public.cfx_anotar('cupón', upper(trim(p_codigo)) || ' ' || p_pct || '%');
end $$;
create or replace function public.cfx_cupon_borrar(p_codigo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.super_check();
  delete from public.cfx_cupones where codigo = upper(trim(p_codigo));
end $$;

-- ---------- Verificación de identidad (RUT, N° de documento, fotos de la cédula y selfie). Las fotos se borran al revisar. ----------
create or replace function public.cfx_rut_ok(r text) returns boolean
language plpgsql immutable as $$
declare s text := upper(regexp_replace(coalesce(r, ''), '[^0-9kK]', '', 'g')); cuerpo text; dv text; suma int := 0; m int := 2; res text;
begin
  if length(s) < 2 then return false; end if;
  cuerpo := left(s, length(s) - 1); dv := right(s, 1);
  if cuerpo !~ '^[0-9]+$' then return false; end if;
  for i in reverse length(cuerpo)..1 loop
    suma := suma + substr(cuerpo, i, 1)::int * m; m := case when m = 7 then 2 else m + 1 end;
  end loop;
  res := case 11 - suma % 11 when 11 then '0' when 10 then 'K' else (11 - suma % 11)::text end;
  return res = dv;
end $$;
create or replace function public.cfx_verif_estado() returns jsonb
language sql stable security definer set search_path = '' as $$
  select (select jsonb_build_object('estado', estado, 'motivo', motivo, 'creado', creado, 'resuelto', resuelto) from public.cfx_verificaciones where cuenta = auth.uid())
$$;
create or replace function public.cfx_verif_enviar(p_rut text, p_documento text, p_frente text, p_reverso text, p_selfie text) returns void
language plpgsql security definer set search_path = '' as $$
declare y jsonb := public.cfx_yo(); r text := upper(regexp_replace(coalesce(p_rut, ''), '[^0-9kK]', '', 'g'));
begin
  if y is null or (y ->> 'id') is null then raise exception 'Inicia sesión'; end if;
  if not public.cfx_rut_ok(r) then raise exception 'RUT no válido'; end if;
  if exists (select 1 from public.cfx_verificaciones where rut = r and cuenta <> (y ->> 'id')::uuid and estado <> 'rechazada') then raise exception 'Ese RUT ya está en otra cuenta'; end if;
  if exists (select 1 from public.cfx_verificaciones where cuenta = (y ->> 'id')::uuid and estado = 'aprobada') then raise exception 'Tu identidad ya está verificada'; end if;
  if coalesce(length(p_frente), 0) < 200 or coalesce(length(p_reverso), 0) < 200 or coalesce(length(p_selfie), 0) < 200 then raise exception 'Faltan fotos'; end if;
  if length(p_frente) > 500000 or length(p_reverso) > 500000 or length(p_selfie) > 500000 then raise exception 'Fotos muy pesadas'; end if;
  insert into public.cfx_verificaciones (cuenta, email, nombre, rut, documento, frente, reverso, selfie, estado, motivo, creado, resuelto)
  values ((y ->> 'id')::uuid, coalesce(y ->> 'email', ''), left(coalesce(y ->> 'nombre', ''), 80), r, left(coalesce(p_documento, ''), 20), p_frente, p_reverso, p_selfie, 'pendiente', '', now(), null)
  on conflict (cuenta) do update set rut = excluded.rut, documento = excluded.documento, frente = excluded.frente, reverso = excluded.reverso, selfie = excluded.selfie,
    estado = 'pendiente', motivo = '', creado = now(), resuelto = null;
  perform public.cfx_avisar_admin('🪪 Verificación por revisar', coalesce(nullif(y ->> 'nombre', ''), y ->> 'email'));
end $$;
create or replace function public.cfx_verif_lista(p_estado text default 'pendiente') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.super_check();
  return (select coalesce(jsonb_agg(x order by x.creado desc), '[]') from (select cuenta, email, nombre, rut, documento, estado, motivo, creado, resuelto
    from public.cfx_verificaciones where p_estado = 'todos' or estado = p_estado order by creado desc limit 200) x);
end $$;
create or replace function public.cfx_verif_fotos(p_cuenta uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.super_check();
  return (select jsonb_build_object('frente', frente, 'reverso', reverso, 'selfie', selfie) from public.cfx_verificaciones where cuenta = p_cuenta);
end $$;
create or replace function public.cfx_verif_resolver(p_cuenta uuid, p_aprobar boolean, p_motivo text default '') returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.super_check();
  update public.cfx_verificaciones set estado = case when p_aprobar then 'aprobada' else 'rechazada' end, motivo = left(coalesce(p_motivo, ''), 200),
    resuelto = now(), frente = null, reverso = null, selfie = null where cuenta = p_cuenta and estado = 'pendiente';
  if not found then raise exception 'No hay una verificación pendiente'; end if;
  perform public.cfx_marcar_verificado(p_cuenta, p_aprobar);
  perform public.cfx_avisar(p_cuenta, case when p_aprobar then '🪪 Identidad verificada' else '🪪 Verificación rechazada' end,
    case when p_aprobar then 'Ya apareces como persona verificada.' else coalesce(nullif(p_motivo, ''), 'Revisa las fotos') || '. Puedes enviarla de nuevo.' end);
  perform public.cfx_anotar(case when p_aprobar then 'verificación aprobada' else 'verificación rechazada' end, p_cuenta::text);
end $$;

create or replace function public.cfx_cupon_usado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.estado = 'aprobado' and old.estado = 'pendiente' and new.cupon is not null then update public.cfx_cupones set usos = usos + 1 where codigo = new.cupon; end if;
  return new;
end $$;
drop trigger if exists cfx_cupon_usado on public.cfx_pagos;
create trigger cfx_cupon_usado after update of estado on public.cfx_pagos for each row execute function public.cfx_cupon_usado();

-- ---------- Verificación humana (Cloudflare Turnstile): la site key es pública; la secret key va en Supabase → Authentication → CAPTCHA ----------
insert into public.cfx_config (clave, valor) values ('humano', '{"site_key": ""}') on conflict (clave) do nothing;
create or replace function public.cfx_humano() returns jsonb
language sql stable security definer set search_path = '' as $$ select valor from public.cfx_config where clave = 'humano' $$;
create or replace function public.cfx_humano_guardar(p_site_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.super_check();
  if coalesce(p_site_key, '') <> '' and p_site_key !~ '^[0-9A-Za-z_-]{10,60}$' then raise exception 'Site key no válida'; end if;
  update public.cfx_config set valor = jsonb_build_object('site_key', coalesce(p_site_key, '')) where clave = 'humano';
  perform public.cfx_anotar('humano', case when coalesce(p_site_key, '') = '' then 'apagado' else 'site key ' || right(p_site_key, 4) end);
end $$;
revoke all on function public.cfx_humano(), public.cfx_humano_guardar(text) from public;
grant execute on function public.cfx_humano() to anon, authenticated;
grant execute on function public.cfx_humano_guardar(text) to authenticated;

revoke all on function public.cfx_anotar(text, text), public.cfx_cupon_usado() from public, anon, authenticated;
revoke all on function public.cfx_registro_lista(int), public.cfx_planes(), public.cfx_plan_guardar(text, text, jsonb, jsonb), public.cfx_textos(), public.cfx_texto_guardar(text, text),
  public.cfx_aviso_masivo(text, text, text), public.cfx_keys_crear(int, text, int, text), public.cfx_keys_lista(), public.cfx_key_revocar(uuid), public.cfx_key_canjear(text),
  public.cfx_cupon_ver(text), public.cfx_cupones_lista(), public.cfx_cupon_guardar(text, int, int, date, boolean), public.cfx_cupon_borrar(text),
  public.cfx_verif_estado(), public.cfx_verif_enviar(text, text, text, text, text), public.cfx_verif_lista(text), public.cfx_verif_fotos(uuid), public.cfx_verif_resolver(uuid, boolean, text) from public, anon;
grant execute on function public.cfx_registro_lista(int), public.cfx_planes(), public.cfx_plan_guardar(text, text, jsonb, jsonb), public.cfx_textos(), public.cfx_texto_guardar(text, text),
  public.cfx_aviso_masivo(text, text, text), public.cfx_keys_crear(int, text, int, text), public.cfx_keys_lista(), public.cfx_key_revocar(uuid), public.cfx_key_canjear(text),
  public.cfx_cupon_ver(text), public.cfx_cupones_lista(), public.cfx_cupon_guardar(text, int, int, date, boolean), public.cfx_cupon_borrar(text),
  public.cfx_verif_estado(), public.cfx_verif_enviar(text, text, text, text, text), public.cfx_verif_lista(text), public.cfx_verif_fotos(uuid), public.cfx_verif_resolver(uuid, boolean, text) to authenticated;
revoke all on function public.cfx_planes_app(), public.cfx_plan_guardar_app(text, text, jsonb, jsonb), public.cfx_textos_app(), public.cfx_texto_guardar_app(text, text),
  public.cfx_destinatarios(text), public.cfx_marcar_verificado(uuid, boolean) from public, anon, authenticated;

-- ---------- Series para el Resumen del Centro de Mando: por mes, cuentas nuevas y pagos/ingresos aprobados (últimos N meses) ----------
create or replace function public.cfx_series(p_meses int default 6) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n int := greatest(1, least(coalesce(p_meses, 6), 24));
begin
  perform public.super_check();
  return (select jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'),
      'cuentas', (select count(*) from auth.users u where u.created_at >= m and u.created_at < m + interval '1 month'),
      'pagos', (select count(*) from public.cfx_pagos p where p.estado = 'aprobado' and p.creado >= m and p.creado < m + interval '1 month'),
      'ingresos', (select coalesce(sum(p.monto), 0) from public.cfx_pagos p where p.estado = 'aprobado' and p.creado >= m and p.creado < m + interval '1 month')) order by m)
    from generate_series(date_trunc('month', now()) - make_interval(months => n - 1), date_trunc('month', now()), interval '1 month') m);
end $$;
-- ---------------------------------------------------------------------
-- CodeFix · Ayuda (igual en las 6 apps; lo reparte nucleo/sincronizar.py).
--   1) Puente al Centro de Mando: los avisos importantes (pagos por revisar, mensajes de soporte) le llegan al tiro
--      al Centro de Mando. El Centro de Mando vincula cada app solo (cfx_cm_vincular) al abrir Pagos o Mensajes.
--   2) Chat de soporte: cada persona escribe desde su app y tú respondes desde el Centro de Mando → Mensajes.
--   3) Guía para partir: lo que le falta configurar a cada negocio (cfx_guia_app() de cada app). No se marca
--      como listo hasta que de verdad lo hace, y se le recuerda cada vez que entra.
--   Cada app define antes: cfx_guia_app() → [{ k, t, d, ok, ir }].
-- ---------------------------------------------------------------------

-- ---------- 1) Puente al Centro de Mando ----------
create or replace function public.cfx_cm_vincular(p_url text, p_key text, p_secreto text, p_app text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.super_check();
  if coalesce(p_url, '') !~ '^https://[a-z0-9.-]+$' or length(coalesce(p_key, '')) < 20 or length(coalesce(p_secreto, '')) < 24 or coalesce(p_app, '') !~ '^[a-z]{2,20}$' then
    raise exception 'Datos de vínculo no válidos';
  end if;
  insert into public.cfx_config (clave, valor) values ('cm', jsonb_build_object('url', p_url, 'key', p_key, 'secreto', p_secreto, 'app', p_app, 'desde', now()))
  on conflict (clave) do update set valor = excluded.valor;
  return jsonb_build_object('vinculado', true, 'app', p_app);
end $$;

create or replace function public.cfx_cm_estado() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := (select valor from public.cfx_config where clave = 'cm');
begin
  perform public.super_check();
  return jsonb_build_object('vinculado', coalesce(v ->> 'secreto', '') <> '', 'app', v ->> 'app', 'url', v ->> 'url', 'desde', v -> 'desde');
end $$;

-- Avisa al Centro de Mando (si la app está vinculada); si no, al administrador de esta app. Nunca hace fallar lo que la llama.
create or replace function public.cfx_al_cm(p_titulo text, p_cuerpo text, p_tipo text default 'aviso') returns void
language plpgsql security definer set search_path = '' as $$
declare v jsonb := (select valor from public.cfx_config where clave = 'cm');
begin
  if coalesce(v ->> 'secreto', '') = '' then
    perform public.cfx_avisar_admin(p_titulo, p_cuerpo);
    return;
  end if;
  begin
    perform net.http_post(
      url := (v ->> 'url') || '/rest/v1/rpc/cfx_aviso_externo',
      body := jsonb_build_object('p_app', v ->> 'app', 'p_secreto', v ->> 'secreto', 'p_titulo', left(p_titulo, 90), 'p_cuerpo', left(coalesce(p_cuerpo, ''), 240), 'p_tipo', p_tipo),
      headers := jsonb_build_object('apikey', v ->> 'key', 'Authorization', 'Bearer ' || (v ->> 'key'), 'Content-Type', 'application/json'));
  exception when others then
    begin perform public.cfx_avisar_admin(p_titulo, p_cuerpo); exception when others then null; end;
  end;
end $$;

-- ---------- 2) Chat de soporte ----------
create table if not exists public.cfx_chat (
  id      bigserial primary key,
  cuenta  uuid not null,
  email   text not null default '',
  nombre  text not null default '',
  rol     text not null default '',
  de      text not null check (de in ('persona', 'soporte')),
  texto   text not null check (length(texto) between 1 and 1000),
  leido   boolean not null default false,
  creado  timestamptz not null default now()
);
create index if not exists cfx_chat_cuenta_idx on public.cfx_chat (cuenta, id);
create index if not exists cfx_chat_sin_leer_idx on public.cfx_chat (de, leido) where not leido;
alter table public.cfx_chat enable row level security;
revoke all on public.cfx_chat from anon, authenticated;

create or replace function public.cfx_chat_mio() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare y jsonb := public.cfx_yo(); u uuid := (y ->> 'id')::uuid;
begin
  if u is null then raise exception 'Inicia sesión'; end if;
  update public.cfx_chat set leido = true where cuenta = u and de = 'soporte' and not leido;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'de', de, 'texto', texto, 'creado', creado) order by id), '[]')
          from (select * from public.cfx_chat where cuenta = u order by id desc limit 100) x);
end $$;

create or replace function public.cfx_chat_sin_leer() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.cfx_chat where cuenta = auth.uid() and de = 'soporte' and not leido
$$;

create or replace function public.cfx_chat_enviar(p_texto text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare y jsonb := public.cfx_yo(); u uuid := (y ->> 'id')::uuid; t text := trim(coalesce(p_texto, '')); i bigint;
begin
  if u is null then raise exception 'Inicia sesión'; end if;
  if t = '' then raise exception 'Escribe tu mensaje'; end if;
  if length(t) > 1000 then raise exception 'Máximo 1000 letras'; end if;
  if (select count(*) from public.cfx_chat where cuenta = u and de = 'persona' and creado > now() - interval '1 hour') >= 20 then
    raise exception 'Muchos mensajes seguidos. Espera un poco y te respondemos.';
  end if;
  insert into public.cfx_chat (cuenta, email, nombre, rol, de, texto)
  values (u, coalesce(y ->> 'email', ''), left(coalesce(y ->> 'nombre', ''), 80), coalesce(y ->> 'rol', ''), 'persona', t) returning id into i;
  delete from public.cfx_chat where cuenta = u and creado < now() - interval '365 days';
  perform public.cfx_al_cm('💬 ' || coalesce(nullif(y ->> 'nombre', ''), y ->> 'email', 'Mensaje'), left(t, 200), 'chat');
  return i;
end $$;

-- Administrador: bandeja (una fila por persona), conversación y respuesta.
create or replace function public.cfx_chat_bandeja() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.super_check();
  return (select coalesce(jsonb_agg(x order by x.ultimo desc), '[]') from (
    select c.cuenta, max(c.email) as email, max(c.nombre) as nombre, max(c.rol) as rol, max(c.creado) as ultimo,
      (array_agg(c.texto order by c.id desc))[1] as texto, (array_agg(c.de order by c.id desc))[1] as de,
      count(*) filter (where c.de = 'persona' and not c.leido) as sin_leer
    from public.cfx_chat c group by c.cuenta order by max(c.creado) desc limit 200) x);
end $$;

create or replace function public.cfx_chat_hilo(p_cuenta uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.super_check();
  update public.cfx_chat set leido = true where cuenta = p_cuenta and de = 'persona' and not leido;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'de', de, 'texto', texto, 'creado', creado) order by id), '[]')
          from (select * from public.cfx_chat where cuenta = p_cuenta order by id desc limit 200) x);
end $$;

create or replace function public.cfx_chat_responder(p_cuenta uuid, p_texto text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare t text := trim(coalesce(p_texto, '')); i bigint; o public.cfx_chat;
begin
  perform public.super_check();
  if t = '' or length(t) > 1000 then raise exception 'Escribe la respuesta (máx. 1000 letras)'; end if;
  select * into o from public.cfx_chat where cuenta = p_cuenta order by id desc limit 1;
  if o.id is null then raise exception 'Conversación no encontrada'; end if;
  insert into public.cfx_chat (cuenta, email, nombre, rol, de, texto, leido) values (p_cuenta, o.email, o.nombre, o.rol, 'soporte', t, false) returning id into i;
  update public.cfx_chat set leido = true where cuenta = p_cuenta and de = 'persona' and not leido;
  perform public.cfx_avisar(p_cuenta, '💬 Soporte te respondió', left(t, 200));
  return i;
end $$;

-- El administrador escribe primero a una cuenta (consejos o recomendaciones): queda en su chat de soporte (🛟) y en CM → Mensajes.
create or replace function public.cfx_chat_iniciar(p_cuenta uuid, p_texto text, p_email text default '', p_nombre text default '', p_rol text default 'negocio') returns bigint
language plpgsql security definer set search_path = '' as $$
declare t text := trim(coalesce(p_texto, '')); i bigint; o public.cfx_chat;
begin
  perform public.super_check();
  if t = '' or length(t) > 1000 then raise exception 'Escribe el mensaje (máx. 1000 letras)'; end if;
  select * into o from public.cfx_chat where cuenta = p_cuenta order by id desc limit 1;
  insert into public.cfx_chat (cuenta, email, nombre, rol, de, texto, leido)
  values (p_cuenta, coalesce(o.email, left(coalesce(p_email, ''), 200)), coalesce(o.nombre, left(coalesce(p_nombre, ''), 120)), coalesce(o.rol, left(coalesce(p_rol, 'negocio'), 20)), 'soporte', t, false)
  returning id into i;
  perform public.cfx_avisar(p_cuenta, '💬 Soporte te escribió', left(t, 200));
  return i;
end $$;
revoke all on function public.cfx_chat_iniciar(uuid, text, text, text, text) from public, anon;
grant execute on function public.cfx_chat_iniciar(uuid, text, text, text, text) to authenticated;

-- ---------- 3) Guía para partir ----------
-- Pendientes de configuración del negocio (los arma cada app) + verificar identidad. Solo para negocios.
create or replace function public.cfx_guia() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare y jsonb := public.cfx_yo(); l jsonb;
begin
  if y is null or (y ->> 'id') is null then raise exception 'Inicia sesión'; end if;
  if y ->> 'rol' <> 'negocio' then return jsonb_build_object('items', '[]'::jsonb, 'sin_leer', public.cfx_chat_sin_leer()); end if;
  l := coalesce(public.cfx_guia_app(), '[]'::jsonb);
  -- Sin guía propia (Centro de Mando): nada que mostrar.
  if jsonb_array_length(l) > 0 and not exists (select 1 from jsonb_array_elements(l) e where e ->> 'k' = 'verificar') then l := l || jsonb_build_array(jsonb_build_object('k', 'verificar', 't', 'Verifica tu identidad',
    'd', 'Tus clientes confían más en un negocio verificado. Toma 2 minutos.',
    'ok', exists (select 1 from public.cfx_verificaciones v where v.cuenta = (y ->> 'id')::uuid and v.estado = 'aprobada'), 'ir', 'verificar')); end if;
  return jsonb_build_object('items', l, 'sin_leer', public.cfx_chat_sin_leer());
end $$;

revoke all on function public.cfx_al_cm(text, text, text) from public, anon, authenticated;
revoke all on function public.cfx_cm_vincular(text, text, text, text), public.cfx_cm_estado(), public.cfx_chat_mio(), public.cfx_chat_sin_leer(), public.cfx_chat_enviar(text),
  public.cfx_chat_bandeja(), public.cfx_chat_hilo(uuid), public.cfx_chat_responder(uuid, text), public.cfx_guia() from public, anon;
grant execute on function public.cfx_cm_vincular(text, text, text, text), public.cfx_cm_estado(), public.cfx_chat_mio(), public.cfx_chat_sin_leer(), public.cfx_chat_enviar(text),
  public.cfx_chat_bandeja(), public.cfx_chat_hilo(uuid), public.cfx_chat_responder(uuid, text), public.cfx_guia() to authenticated;
revoke all on function public.cfx_guia_app() from public, anon, authenticated;
-- ---------------------------------------------------------------------
-- CodeFix · Inventario (igual en las 6 apps; lo usa el Centro de Mando → Apps → Respaldo y limpieza).
--   Muestra las tablas que esta versión ya NO usa (restos de versiones antiguas) con cuántas filas tienen.
--   Nada se borra solo: las vacías se borran con un toque; las que tienen datos piden descargar el respaldo y escribir "sí".
--   cfx_tablas() = las tablas que crea este archivo (la revisa pruebas/inventario.py --verificar).
-- ---------------------------------------------------------------------
create or replace function public.cfx_tablas() returns text[] language sql immutable as $$ select array['public.audiencia', 'public.auditoria', 'public.base_contenido', 'public.cfx_chat', 'public.cfx_config', 'public.cfx_cupones', 'public.cfx_exentos', 'public.cfx_keys', 'public.cfx_pagos', 'public.cfx_registro', 'public.cfx_verificaciones', 'public.config', 'public.empresas', 'public.guia_redes', 'public.ideas', 'public.invitaciones', 'public.mapeos_import', 'public.metricas', 'public.metricas_cuenta', 'public.notificaciones', 'public.pedidos', 'public.perfiles', 'public.planes', 'public.publicaciones', 'public.push_subs', 'public.resumen_mes', 'public.secretos', 'public.textos'] $$;
create or replace function public.cfx_inventario() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; n bigint; out jsonb := '[]'::jsonb;
begin
  perform public.super_check();
  for r in select s.nspname || '.' || c.relname as t, pg_total_relation_size(c.oid) as b from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname in ('public', 'privado') and c.relkind in ('r', 'p') and not (s.nspname || '.' || c.relname = any (public.cfx_tablas()))
           and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') order by 1
  loop
    execute 'select count(*) from ' || r.t into n;
    out := out || jsonb_build_object('tabla', r.t, 'filas', n, 'bytes', r.b);
  end loop;
  return out;
end $$;
create or replace function public.cfx_inventario_datos(p_tabla text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j jsonb;
begin
  perform public.super_check();
  if not exists (select 1 from jsonb_array_elements(public.cfx_inventario()) x where x ->> 'tabla' = p_tabla) then raise exception 'Esa tabla no está en la lista de sobrantes'; end if;
  execute 'select coalesce(jsonb_agg(to_jsonb(t)), ''[]'') from (select * from ' || p_tabla || ' limit 20000) t' into j;
  return j;
end $$;
create or replace function public.cfx_inventario_borrar(p_tabla text, p_confirmacion text default '') returns text
language plpgsql security definer set search_path = '' as $$
declare x jsonb;
begin
  perform public.super_check();
  select e into x from jsonb_array_elements(public.cfx_inventario()) e where e ->> 'tabla' = p_tabla;
  if x is null then raise exception 'Esa tabla no está en la lista de sobrantes'; end if;
  if (x ->> 'filas')::bigint > 0 and lower(trim(coalesce(p_confirmacion, ''))) not in ('sí', 'si') then
    raise exception 'La tabla tiene % filas: descarga el respaldo y escribe "sí" para borrarla', x ->> 'filas';
  end if;
  execute 'drop table ' || p_tabla || ' cascade';
  return p_tabla || ' borrada';
end $$;
revoke all on function public.cfx_tablas(), public.cfx_inventario(), public.cfx_inventario_datos(text), public.cfx_inventario_borrar(text, text) from public, anon;
grant execute on function public.cfx_inventario(), public.cfx_inventario_datos(text), public.cfx_inventario_borrar(text, text) to authenticated;
-- <<< CFX núcleo

select 'Cerebro instalado v' || public.db_version() as resultado;
