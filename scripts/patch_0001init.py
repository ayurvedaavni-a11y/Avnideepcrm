# -*- coding: utf-8 -*-
# Fix 0001_init.sql sync — match exact column definitions
import io

path = 'worker/migrations/0001_init.sql'
with io.open(path, 'r', encoding='utf-8', newline='') as f:
    c = f.read()
NL = '\r\n' if '\r\n' in c else '\n'

# crm_customers: add landmark + notes
old1 = '''  risk_level      TEXT NOT NULL DEFAULT 'Low',
  current_status  TEXT NOT NULL DEFAULT 'New Lead',
  created_at      TEXT,
  updated_at      TEXT
);'''

new1 = '''  risk_level      TEXT NOT NULL DEFAULT 'Low',
  current_status  TEXT NOT NULL DEFAULT 'New Lead',
  landmark        TEXT,
  notes           TEXT,
  created_at      TEXT,
  updated_at      TEXT
);'''

o = old1.replace('\n', NL)
n = new1.replace('\n', NL)
assert c.count(o) == 1, c.count(o)
c = c.replace(o, n)
print('crm_customers: landmark + notes added')

# crm_orders: add discount, delivery_charge, cod_charge, payment_mode, special_instructions, order_notes
# First check the exact crm_orders create pattern
import re
m = re.search(r'CREATE TABLE IF NOT EXISTS crm_orders \(\n(.+?)\);', c, re.DOTALL)
if m:
    orders_def = m.group(1)
    print(f'crm_orders columns:')
    for line in orders_def.split(NL):
        col = line.strip().split()[0] if line.strip() else ''
        if col: print(f'  {col}')
    # Find the cod_amount line to insert after
    new_cols = '''
  discount          REAL DEFAULT 0,
  delivery_charge   REAL DEFAULT 0,
  cod_charge        REAL DEFAULT 0,
  payment_mode      TEXT DEFAULT 'COD',
  special_instructions TEXT,
  order_notes       TEXT,'''
    # Insert after cod_amount line
    lines = c.split(NL)
    result = []
    inserted = False
    for line in lines:
        result.append(line)
        if 'cod_amount' in line and 'cod_charge' not in line and not inserted:
            for nc in new_cols.strip().split(NL):
                result.append(nc)
            inserted = True
    c = NL.join(result)
    print('crm_orders: pricing + payment columns added')
else:
    print('ERROR: could not find crm_orders CREATE TABLE')
    exit(1)

with io.open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(c)
print('0001_init.sql synced')