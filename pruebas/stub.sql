-- Simula lo mínimo de Supabase en un Postgres local para probar instalar.sql (NO se usa en Supabase).
-- Común a las 6 apps. Las líneas "create extension http/pg_cron/pg_net" las quita correr.sh.
do $$ begin create role anon nologin; exception when others then null; end $$;
do $$ begin create role authenticated nologin; exception when others then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when others then null; end $$;
do $$ begin create role supabase_admin nologin; exception when others then null; end $$;
do $$ begin create role authenticator login noinherit password 'local'; exception when others then null; end $$;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz default now(),
  raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_sign_in_at timestamptz,
  encrypted_password text, banned_until timestamptz, deleted_at timestamptz, phone text, is_anonymous boolean default false
);
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade, provider text, identity_data jsonb);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade, created_at timestamptz default now());
create table auth.refresh_tokens (id bigserial primary key, user_id text, token text, revoked boolean default false);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text) $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_build_object('sub', auth.uid(), 'email', (select email from auth.users where id = auth.uid()))) $$;
create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
-- http (se responde desde la tabla extensions.http_respuestas, para simular version.json de GitHub)
create table extensions.http_respuestas (url_like text primary key, status int default 200, content text);
create type extensions.http_response as (status integer, content_type text, headers jsonb, content text);
create function extensions.http_get(url text) returns extensions.http_response language sql as $$
  select coalesce((select row(r.status, 'text/plain', '{}'::jsonb, r.content)::extensions.http_response
    from extensions.http_respuestas r where url like r.url_like limit 1), row(404, 'text/plain', '{}'::jsonb, '')::extensions.http_response) $$;
create function extensions.http_set_curlopt(a text, b text) returns boolean language sql as $$ select true $$;
-- storage
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint,
  allowed_mime_types text[], created_at timestamptz default now(), owner uuid);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text,
  owner uuid, owner_id text, metadata jsonb default '{}'::jsonb, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), path_tokens text[] generated always as (string_to_array(name, '/')) stored, unique (bucket_id, name));
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant usage on schema storage to authenticated, anon, service_role;
grant select, insert, update, delete on storage.objects, storage.buckets to authenticated, anon, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create function storage.filename(name text) returns text language sql immutable as
  $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
create function storage.extension(name text) returns text language sql immutable as
  $$ select reverse(split_part(reverse(name), '.', 1)) $$;
-- cron (pg_cron)
create schema cron;
grant usage on schema cron to postgres;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true, username text default current_user);
create table cron.job_run_details (runid bigserial, jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz);
create function cron.schedule(n text, s text, c text) returns bigint language sql as
  $$ insert into cron.job (jobname, schedule, command) values (n, s, c)
     on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.schedule(s text, c text) returns bigint language sql as
  $$ insert into cron.job (schedule, command) values (s, c) returning jobid $$;
create function cron.unschedule(id bigint) returns boolean language sql as $$ delete from cron.job where jobid = id; select true $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n; select true $$;
-- net (pg_net)
create schema net;
grant usage on schema net to postgres, service_role;
create table net.llamadas (id bigserial, url text, body jsonb, headers jsonb, creado timestamptz default now());
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as
  $$ insert into net.llamadas (url, body, headers) values (url, body, headers) returning id $$;
create function net.http_get(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
  timeout_milliseconds int default 5000) returns bigint language sql as
  $$ insert into net.llamadas (url, headers) values (url, headers) returning id $$;
-- vault
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create function vault.create_secret(s text, n text default null, d text default null) returns uuid language sql as
  $$ insert into vault.secrets (secret, name, description) values (s, n, d) returning id $$;
create function vault.update_secret(i uuid, s text default null, n text default null, d text default null) returns void language sql as
  $$ update vault.secrets set secret = coalesce(s, secret), name = coalesce(n, name) where id = i $$;
-- realtime
create publication supabase_realtime;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
-- contraseñas del simulador
create table auth.claves (email text primary key, pass text not null);
