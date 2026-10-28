-- Cerebro · Instalación/actualización corta: descarga y ejecuta supabase/instalar.sql (siempre la última, rama main).
-- Basta con correrla UNA vez en Supabase → SQL Editor: después la base se actualiza sola cada 10 minutos (función auto_actualizar).
create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
do $$ begin
  execute (select content from extensions.http_get('https://raw.githubusercontent.com/CodeFixService/Contenido/main/supabase/instalar.sql?t=' || extract(epoch from now())::bigint));
end $$;
select 'Cerebro instalado v' || public.db_version() as resultado;
