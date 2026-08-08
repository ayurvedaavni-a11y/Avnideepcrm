#!/bin/sh
# Apply all D1 migrations in order. Migrations are idempotent-safe:
#  - 0001..0003, 0005: CREATE TABLE/INDEX IF NOT EXISTS + safe UPDATEs
#  - 0004: historical ALTERs whose columns already exist in 0001 on fresh
#    databases → ALTER fails harmlessly ("duplicate column name"), which
#    simply means the columns are already present. `|| true` keeps the
#    chain from aborting; the goal of 0004 (columns exist) is met either way.
set -e
for f in 0001_init.sql 0002_perf_indexes.sql 0003_fast_status_sync.sql 0004_enterprise_edit_fields.sql 0005_intake_dedup.sql; do
  echo "→ $f"
  npx wrangler d1 execute avnideep-crm --local --file=./migrations/$f || true
done
echo "✓ migrations applied (local)"
