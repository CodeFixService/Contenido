#!/bin/bash
# Base local limpia: ./pruebas/base.sh [bd]   (stub.sql + instalar.sql; quita las extensiones que no existen en local)
set -e
cd "$(dirname "$0")"
DB=${1:-p_contenido}
PSQL="psql -h ${PGHOST:-/var/tmp/pgb} -p ${PGPORT:-54329} -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null
$PSQL -d $DB -f stub.sql >/dev/null 2>&1
sed -E 's/create extension if not exists (http|pg_cron|pg_net)[^;]*;/create schema if not exists extensions;/I' ../supabase/instalar.sql > /tmp/instalar_$DB.sql
$PSQL -d $DB -f /tmp/instalar_$DB.sql 2>&1 | grep -vE '^(NOTICE|psql:.*NOTICE)' | grep -v '^$' || true
echo "Base $DB lista"
