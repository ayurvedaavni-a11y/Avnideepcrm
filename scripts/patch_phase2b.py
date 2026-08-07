# -*- coding: utf-8 -*-
# Phase 2b: db.ts interfaces + fake tracking removal
import io, sys

def load(p):
    with io.open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()
def save(p, c):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(c)

def rep(content, NL, old, new, count=1):
    o = old.replace('\n', NL)
    n = new.replace('\n', NL)
    c = content.count(o)
    if c != count:
        print(f'FAIL [{c}/{count}] for: {old.splitlines()[0][:70]}')
        sys.exit(1)
    content = content.replace(o, n)
    print('OK:', old.splitlines()[0][:70])
    return content

# db.ts Customer + Order interfaces
p = 'src/db/db.ts'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

c = rep(c, NL,
"""  currentStatus: LeadStatus;
  createdAt: string;
  updatedAt: string;
}

export type LeadStatus =""",
"""  landmark?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type LeadStatus =""")

c = rep(c, NL,
"""  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NDRCase {""",
"""  discount?: number;
  deliveryCharge?: number;
  codCharge?: number;
  paymentMode?: 'COD' | 'Prepaid';
  specialInstructions?: string;
  orderNotes?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NDRCase {""")

save(p, c)
print('db.ts done')

# OrderPipeline fake tracking + tracking display
p = 'src/pages/OrderPipeline.tsx'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

c = rep(c, NL,
"""      if (newStatus === 'Shipped' && !order.trackingId) {
        meta.trackingId = `TRK${Date.now().toString().slice(-8)}`;
        meta.shipmentDate = new Date().toISOString();
        meta.courier = order.courier || 'Delhivery';
      }""",
"""      if (newStatus === 'Shipped' && !order.trackingId) {
        meta.shipmentDate = new Date().toISOString();
      }""")

c = rep(c, NL,
"""            <p className="font-bold text-slate-800 mt-1 text-[13px] font-mono truncate">{order.trackingId || 'N/A'}</p>""",
"""            <p className="font-bold text-slate-800 mt-1 text-[13px] font-mono truncate">{order.trackingId || <span className="text-amber-600 text-[11px]">Tracking ID not assigned yet</span>}</p>""")

save(p, c)
print('OrderPipeline done')

# Logistics fake tracking
p = 'src/pages/Logistics.tsx'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

c = rep(c, NL,
"""      if (newStatus === 'Shipped' && !order.trackingId) {
        meta.trackingId = `TRK${Date.now().toString().slice(-8)}`;
        meta.shipmentDate = new Date().toISOString();
        meta.courier = order.courier || 'Delhivery';
      }""",
"""      if (newStatus === 'Shipped' && !order.trackingId) {
        meta.shipmentDate = new Date().toISOString();
      }""")

save(p, c)
print('Logistics done')

# DeliveredCustomers tracking display
p = 'src/pages/DeliveredCustomers.tsx'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

c = rep(c, NL,
"""                      {order?.trackingId || 'N/A'}""",
"""                      {order?.trackingId || <span className="text-amber-600">Tracking ID not assigned yet</span>}""")

save(p, c)
print('DeliveredCustomers done')

print('\n=== ALL PHASE 2b DONE ===')