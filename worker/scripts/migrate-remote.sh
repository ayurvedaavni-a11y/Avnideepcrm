#!/bin/sh
# Apply all D1 migrations in order against the REMOTE (production) database.
# Same idempotency semantics as migrate-local.sh — see that file for the
# 0004 note. Safe to re-run on every deploy.
set -e
for f in 0001_init.sql 0002_perf_indexes.sql 0003_fast_status_sync.sql 0004_enterprise_edit_fields.sql 0005_intake_dedup.sql; do
  echo "→ $f"
  npx wrangler d1 execute avnideep-crm --remote --file=./migrations/$f || true
done
echo "✓ migrations applied (remote)"
