// CodeFix · Función "servidor" (Supabase → Edge Functions → nombre: servidor)
//  1) { accion: 'crear_cuenta' }  El administrador crea socios y usuarios; el socio crea usuarios.
//  2) { accion: 'borrar' }        Administrador o socio (con motivo): borra una cuenta y sus datos.
//     { accion: 'borrar_mia' }    Cada persona borra su propia cuenta.
//  3) { accion: 'ping' }          Diagnóstico.
//  3) sin acción (cada minuto, pg_cron): envía por push los avisos nuevos de la campanita.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const VERSION = '3.0';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Cuenta = { email?: string; password?: string; nombre?: string; telefono?: string; rol?: string };

async function crearCuenta(jwt: string, b: Cuenta) {
  const s = db();
  const { data: who, error: e0 } = await s.auth.getUser(jwt);
  if (e0 || !who?.user) return { ok: false, error: 'Inicia sesión de nuevo' };
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (password.length < 6) return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres' };
  const { data: prep, error: e1 } = await s.rpc('preparar_cuenta', {
    p_caller: who.user.id, p_email: email, p_nombre: String(b.nombre || ''), p_telefono: String(b.telefono || ''),
    p_rol: b.rol === 'socio' ? 'socio' : 'usuario',
  });
  if (e1) return { ok: false, error: e1.message };
  if (!prep?.ok) return prep;
  const { data: nu, error: e2 } = await s.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { nombre: String(b.nombre || '').trim() },
  });
  if (e2 || !nu?.user) {
    await s.rpc('cancelar_invitacion', { p_email: email });
    const m = (e2 && e2.message) || 'No se pudo crear la cuenta';
    return { ok: false, error: /already|registered|exists/i.test(m) ? 'Ese correo ya tiene cuenta' : m };
  }
  return { ok: true, id: nu.user.id };
}

// Borra una cuenta y, por cascada, todos sus datos. El socio debe escribir el motivo (queda en el registro).
async function borrar(jwt: string, b: { id?: string; motivo?: string }) {
  const s = db();
  const { data: who, error: e0 } = await s.auth.getUser(jwt);
  if (e0 || !who?.user) return { ok: false, error: 'Inicia sesión de nuevo' };
  if (!/^[0-9a-f-]{36}$/i.test(String(b.id || ''))) return { ok: false, error: 'Dato no válido' };
  const { data: prep, error: e1 } = await s.rpc('preparar_borrado', { p_caller: who.user.id, p_id: b.id, p_motivo: String(b.motivo || '') });
  if (e1) return { ok: false, error: e1.message };
  if (!prep?.ok) return prep;
  let n = 0;
  for (const id of prep.ids as string[]) {
    const { error } = await s.auth.admin.deleteUser(id);
    if (!error) n++;
  }
  return { ok: true, borrados: n };
}

// Cada persona puede borrar su propia cuenta y todos sus datos.
async function borrarMia(jwt: string) {
  const s = db();
  const { data: who, error: e0 } = await s.auth.getUser(jwt);
  if (e0 || !who?.user) return { ok: false, error: 'Inicia sesión de nuevo' };
  if ((who.user.email || '').toLowerCase() === 'juanjosuecastilloloyola@gmail.com') return { ok: false, error: 'La cuenta del súper administrador no se borra desde aquí' };
  const { error } = await s.auth.admin.deleteUser(who.user.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

async function enviarPush() {
  const s = db();
  const { data, error } = await s.rpc('push_pendientes');
  if (error) throw error;
  const envios = (data?.envios || []) as { endpoint: string; p256dh: string; auth: string; titulo: string; cuerpo: string; url: string; id: string }[];
  const claves = data?.claves || {};
  if (!envios.length) return { enviados: 0 };
  if (!claves.publica || !claves.privada) return { enviados: 0, error: 'Faltan las claves push (Empresa → Notificaciones)' };
  webpush.setVapidDetails('mailto:soporte@codefix.app', claves.publica, claves.privada);
  let ok = 0, malos = 0;
  for (let i = 0; i < envios.length; i += 50) {
    const lote = envios.slice(i, i + 50);
    const res = await Promise.allSettled(lote.map((e) => webpush.sendNotification(
      { endpoint: e.endpoint, keys: { p256dh: e.p256dh, auth: e.auth } },
      JSON.stringify({ title: e.titulo, body: e.cuerpo, url: e.url || '/', tag: e.id }), { TTL: 86400 })));
    for (let j = 0; j < res.length; j++) {
      const r = res[j];
      if (r.status === 'fulfilled') ok++;
      else {
        malos++;
        const code = (r.reason as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) await s.rpc('push_borrar_endpoint', { p_endpoint: lote[j].endpoint });
      }
    }
  }
  return { enviados: ok, fallidos: malos };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    if (body?.accion === 'ping') return json({ ok: true, version: VERSION, servicio: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') });
    if (body?.accion === 'crear_cuenta') {
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      try { return json(await crearCuenta(jwt, body)); }
      catch (e) { return json({ ok: false, error: 'Error del servidor: ' + String((e as Error).message || e) }); }
    }
    if (body?.accion === 'borrar') {
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      try { return json(await borrar(jwt, body)); }
      catch (e) { return json({ ok: false, error: 'Error del servidor: ' + String((e as Error).message || e) }); }
    }
    if (body?.accion === 'borrar_mia') {
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      try { return json(await borrarMia(jwt)); }
      catch (e) { return json({ ok: false, error: 'Error del servidor: ' + String((e as Error).message || e) }); }
    }
    return json(await enviarPush());
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
