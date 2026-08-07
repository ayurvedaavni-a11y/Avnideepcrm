# -*- coding: utf-8 -*-
# Enterprise edit-permission upgrade (worker side):
#  1) tables.ts — add new writable columns:
#     crm_customers: landmark, notes
#     crm_orders:    discount, delivery_charge, cod_charge, payment_mode,
#                    special_instructions, order_notes
#  2) index.ts handlePush — telecaller permission matrix:
#     - crm_customers: sirf `mobile` blocked (baaki sb — name, alt, address,
#       landmark, city, state, pincode, notes — editable)
#     - crm_orders UPDATE: status/courier/tracking_id/shipment_date/payment_mode
#       blocked; cod_amount ALLOWED (Req: telecaller COD amount edit kar sake)
#     - crm_leads: notes/followup_date/followup_time pehle se allowed
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

# ============ 1) tables.ts ============
p = 'worker/src/tables.ts'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

c = rep(c, NL,
"""  crm_customers: {
    dedup: 'mobile',
    columns: [
      'mobile', 'name', 'alternate_number', 'address', 'pincode', 'city',
      'district', 'state', 'total_orders', 'delivered', 'rto', 'cancelled',
      'fake_count', 'total_spend', 'last_order_date', 'risk_level',
      'current_status', 'created_at', 'updated_at',
    ],
  },""",
"""  crm_customers: {
    dedup: 'mobile',
    columns: [
      'mobile', 'name', 'alternate_number', 'address', 'pincode', 'city',
      'district', 'state', 'landmark', 'notes', 'total_orders', 'delivered',
      'rto', 'cancelled', 'fake_count', 'total_spend', 'last_order_date',
      'risk_level', 'current_status', 'created_at', 'updated_at',
    ],
  },""")

c = rep(c, NL,
"""  crm_orders: {
    dedup: 'order_id',
    columns: [
      'order_id', 'lead_id', 'customer_id', 'product', 'qty', 'cod_amount',
      'courier', 'tracking_id', 'status', 'order_date', 'shipment_date',
      'booked_by', 'booked_by_name', 'delivered_at', 'created_at', 'updated_at',
    ],
  },""",
"""  crm_orders: {
    dedup: 'order_id',
    columns: [
      'order_id', 'lead_id', 'customer_id', 'product', 'qty', 'cod_amount',
      'discount', 'delivery_charge', 'cod_charge', 'payment_mode',
      'special_instructions', 'order_notes', 'courier', 'tracking_id', 'status',
      'order_date', 'shipment_date', 'booked_by', 'booked_by_name',
      'delivered_at', 'created_at', 'updated_at',
    ],
  },""")

save(p, c)
print('tables.ts done')

# ============ 2) index.ts permission matrix ============
p = 'worker/src/index.ts'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

# 2a) customer strip list — remove name/alternate_number (telecaller ab edit kar sakta hai)
c = rep(c, NL,
"""  // Telecallers may edit customer ADDRESS/notes fields but never identity or
  // financial/counter fields (mobile, name, totals, risk, status counters).
  if (user && user.role !== 'admin' && table === 'crm_customers') {
    for (const p of ['mobile', 'name', 'alternate_number', 'total_orders', 'delivered', 'rto', 'cancelled', 'fake_count', 'total_spend', 'last_order_date', 'risk_level', 'current_status']) {
      delete data[p];
    }
  }""",
"""  // TELECALLER CUSTOMER EDIT PERMISSION (enterprise matrix):
  //  - editable: name, alternate_number, address, landmark, city, state,
  //    pincode, district, notes  (Req: address/landmark/city/state/pincode/
  //    alt number/notes/customer remark/customer name)
  //  - BLOCKED: mobile (identity — kabhi nahi badal sakta), plus all
  //    financial/counter fields (totals, risk, status counters) jo sirf
  //    system/admin update karte hain.
  if (user && user.role !== 'admin' && table === 'crm_customers') {
    for (const p of ['mobile', 'total_orders', 'delivered', 'rto', 'cancelled', 'fake_count', 'total_spend', 'last_order_date', 'risk_level', 'current_status']) {
      delete data[p];
    }
  }""")

# 2b) order update strip — cod_amount ab ALLOWED, payment_mode BLOCKED
c = rep(c, NL,
"""    if (user && user.role !== 'admin') {
      if (hasId) {
        // Update path: telecaller cannot modify any fulfilment/identity field.
        for (const p of ['status', 'courier', 'tracking_id', 'shipment_date', 'cod_amount', 'customer_id', 'lead_id', 'order_id', 'booked_by', 'booked_by_name', 'delivered_at']) {
          delete data[p];
        }
      } else {""",
"""    if (user && user.role !== 'admin') {
      if (hasId) {
        // Update path (enterprise matrix): telecaller kabhi shipment/payment
        // status, courier, AWB, identity ya ownership fields change nahi kar
        // sakta — lekin COD AMOUNT edit kar sakta hai (Req 3). Baki pricing
        // fields (discount/delivery/cod charge) admin-only.
        for (const p of ['status', 'courier', 'tracking_id', 'shipment_date', 'payment_mode', 'discount', 'delivery_charge', 'cod_charge', 'special_instructions', 'order_notes', 'customer_id', 'lead_id', 'order_id', 'booked_by', 'booked_by_name', 'delivered_at']) {
          delete data[p];
        }
      } else {""")

save(p, c)
print('index.ts done — ALL OK')
