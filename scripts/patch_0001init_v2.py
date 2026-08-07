# -*- coding: utf-8 -*-
# Fix 0001_init.sql — sync new columns using exact file patterns
import io

path = 'worker/migrations/0001_init.sql'
with io.open(path, 'r', encoding='utf-8', newline='') as f:
    c = f.read()
NL = '\r\n' if '\r\n' in c else '\n'

# crm_customers: add landmark + notes after risk_level/current_status
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
assert c.count(o) == 1, f'customers table: found {c.count(o)}'
c = c.replace(o, n)
print('crm_customers: landmark + notes added')

# crm_orders: add discount, delivery_charge, cod_charge, payment_mode, special_instructions, order_notes after cod_amount
old2 = '''  cod_amount    REAL NOT NULL DEFAULT 0,
  courier       TEXT,
  tracking_id   TEXT,
  status        TEXT NOT NULL DEFAULT 'Order Booked',
  order_date    TEXT,
  shipment_date TEXT,
  booked_by     TEXT,
  booked_by_name TEXT,
  delivered_at  TEXT,
  created_at    TEXT,
  updated_at    TEXT
);'''
new2 = '''  cod_amount    REAL NOT NULL DEFAULT 0,
  discount          REAL DEFAULT 0,
  delivery_charge   REAL DEFAULT 0,
  cod_charge        REAL DEFAULT 0,
  payment_mode      TEXT DEFAULT 'COD',
  special_instructions TEXT,
  order_notes       TEXT,
  courier       TEXT,
  tracking_id   TEXT,
  status        TEXT NOT NULL DEFAULT 'Order Booked',
  order_date    TEXT,
  shipment_date TEXT,
  booked_by     TEXT,
  booked_by_name TEXT,
  delivered_at  TEXT,
  created_at    TEXT,
  updated_at    TEXT
);'''
o = old2.replace('\n', NL)
n = new2.replace('\n', NL)
assert c.count(o) == 1, f'orders table: found {c.count(o)}'
c = c.replace(o, n)
print('crm_orders: pricing + payment columns added')

with io.open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(c)
print('0001_init.sql synced OK')