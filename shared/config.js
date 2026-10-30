/* Conexión con Supabase. Ambos valores son públicos por diseño:
   la seguridad está en las reglas de la base de datos (supabase/instalar.sql). */
window.BT_CONFIG = {
  SUPABASE_URL: 'https://vndqseptmymgqyxumbqy.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZuZHFzZXB0bXltZ3F5eHVtYnF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMTIxMjEsImV4cCI6MjEwODc4ODEyMX0.kJKU63-4heUrV7tUtpmDTpfXJvBWp_wgwOyEF5-DO78',
  VERSION: '1.7',     // versión de la app (súbela en cada cambio y en version.json; se libera desde el Centro de Mando → Apps)
  DB_VERSION: '1.4'   // versión que debe tener la base de datos (supabase/instalar.sql → db_version)
};
