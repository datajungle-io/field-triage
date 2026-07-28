#!/usr/bin/env bash
# Apply every migration in order, stopping at the first error.
#
# Usage:
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<pw>@<host>:5432/postgres' npm run db:push
#
# Get the URL from Supabase: Project Settings > Database > Connection string > URI.
# Use the session pooler / direct connection, not the transaction pooler — the
# migrations create types and functions, which the transaction pooler rejects.
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  # Fall back to .env.local so the URL can live with the rest of the config.
  if [[ -f .env.local ]] && grep -q '^SUPABASE_DB_URL=' .env.local; then
    SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
  else
    echo "SUPABASE_DB_URL is not set (env or .env.local)." >&2
    exit 1
  fi
fi

for file in supabase/migrations/*.sql; do
  echo "→ $file"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$file"
done

echo "✓ All migrations applied"
