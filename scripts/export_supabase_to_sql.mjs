#!/usr/bin/env node
// =====================================================================
// Supabase → D1 data export
//
// Reads every CRM table from Supabase (service role key) and writes a
// plain-SQL dump that can be imported straight into Cloudflare D1:
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/export_supabase_to_sql.mjs
//   wrangler d1 execute avnideep-crm --remote --file=./d1_export.sql
//
// NOTE: Auth users (team members + their PINs) CANNOT be exported — they
// must be re-created in the new system via the Team page after bootstrap.
// =====================================================================
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(url, key);

// Order matters: parents before children (matching the sync engine).
const TABLES = [
  'crm_customers',
  'crm_leads',
  'crm_orders',
  'crm_spacel_followups',
  'crm_timeline_logs',
  'crm_notifications',
  'crm_call_logs',
  'crm_logistics',
  'crm_ndr_cases',
  'crm_invoices',
  'crm_products',
  'crm_inventory_logs',
  'crm_invoice_items',
  'crm_payments',
  'crm_invoice_settings',
  'crm_shipment_scans',
  'leads',
];

const esc = (v) =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;

let out = '-- Supabase → D1 data export\nPRAGMA foreign_keys = OFF;\nBEGIN;\n';

for (const t of TABLES) {
  let start = 0;
  const page = 1000;
  let rows = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(t)
      .select('*')
      .range(start, start + page - 1)
      .order('id', { ascending: true });
    if (error) {
      console.warn(`!! ${t}: ${error.message}`);
      break;
    }
    if (!data || !data.length) break;
    for (const row of data) {
      const cols = Object.keys(row).filter((k) => row[k] !== undefined);
      const vals = cols.map((c) => esc(row[c]));
      out += `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${vals.join(', ')});\n`;
      rows++;
    }
    start += page;
    if (data.length < page) break;
  }
  console.log(`exported ${t}: ${rows} rows`);
}

out += 'COMMIT;\n';
const output = process.env.OUTPUT || 'd1_export.sql';
writeFileSync(output, out);
console.log(`\nWrote ${output}`);
console.log(`Import it with: wrangler d1 execute avnideep-crm --remote --file=./${output}`);
