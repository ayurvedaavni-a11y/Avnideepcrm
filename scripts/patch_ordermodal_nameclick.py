# -*- coding: utf-8 -*-
# Phase 3: OrderEditModal integration + name-click wiring
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
        return content, c  # return count for recovery
    content = content.replace(o, n)
    print('OK:', old.splitlines()[0][:70])
    return content, 1

# ==================== OrderPipeline.tsx ====================
p = 'src/pages/OrderPipeline.tsx'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

# 1) Import OrderEditModal
c, _ = rep(c, NL,
"""import { Customer360Profile } from '../components/Customer360Profile';""",
"""import { Customer360Profile } from '../components/Customer360Profile';
import { OrderEditModal } from '../components/OrderEditModal';""")

# 2) Add editOrderId state after detailOrderId
c, _ = rep(c, NL,
"""  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);""",
"""  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  const [editOrderId, setEditOrderId] = useState<number | null>(null);""")

# 3) Add Edit handler
c, _ = rep(c, NL,
"""  const handleViewTimeline = useCallback((customerId: number) => setSelectedCustomerId(customerId), []);""",
"""  const handleViewTimeline = useCallback((customerId: number) => setSelectedCustomerId(customerId), []);
  const handleEditOrder = useCallback((orderId: number) => setEditOrderId(orderId), []);""")

# 4) In OrderDetailModal render — add Edit button in footer for admin
# Find the footer section
c, _ = rep(c, NL,
"""        {/* Footer actions */}
        <div className="p-5 border-t border-slate-100 bg-slate-50 rounded-b-3xl grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <a href={`tel:${customer.mobile}`} className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-50 text-green-700 border border-green-100 font-bold text-xs hover:bg-green-100 transition active:scale-95">
            <Phone size={15} /> Call
          </a>
          <a href={`https://wa.me/91${customer.mobile}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold text-xs hover:bg-emerald-100 transition active:scale-95">
            <MessageCircle size={15} /> WhatsApp
          </a>
          {canInvoice && (
            <button onClick={() => { const inv = db.invoices.where('orderId').equals(order.id!).first(); inv.then(i => { if (i) downloadInvoicePDF(i); else autoGenerateInvoice(order.id!, 'Admin').then(g => g && downloadInvoicePDF(g)); }); }}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 font-bold text-xs hover:bg-blue-100 transition active:scale-95">
              <FileText size={15} /> Invoice
            </button>
          )}
          <button onClick={() => { onClose(); }} className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white text-slate-600 border border-slate-200 font-bold text-xs hover:bg-slate-100 transition active:scale-95">
            Close
          </button>
        </div>""",
"""        {/* Footer actions */}
        <div className="p-5 border-t border-slate-100 bg-slate-50 rounded-b-3xl grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <a href={`tel:${customer.mobile}`} className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-50 text-green-700 border border-green-100 font-bold text-xs hover:bg-green-100 transition active:scale-95">
            <Phone size={15} /> Call
          </a>
          <a href={`https://wa.me/91${customer.mobile}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold text-xs hover:bg-emerald-100 transition active:scale-95">
            <MessageCircle size={15} /> WhatsApp
          </a>
          {canInvoice && (
            <button onClick={() => { const inv = db.invoices.where('orderId').equals(order.id!).first(); inv.then(i => { if (i) downloadInvoicePDF(i); else autoGenerateInvoice(order.id!, 'Admin').then(g => g && downloadInvoicePDF(g)); }); }}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 font-bold text-xs hover:bg-blue-100 transition active:scale-95">
              <FileText size={15} /> Invoice
            </button>
          )}
          <button onClick={onEdit} className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-50 text-amber-700 border border-amber-100 font-bold text-xs hover:bg-amber-100 transition active:scale-95">
            <Edit2 size={15} /> Edit
          </button>
          <button onClick={() => { onClose(); }} className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white text-slate-600 border border-slate-200 font-bold text-xs hover:bg-slate-100 transition active:scale-95">
            Close
          </button>
        </div>""")

# 5) Add onEdit prop to OrderDetailModal + import Edit2
c, _ = rep(c, NL,
"""import FileText from 'lucide-react/dist/esm/icons/file-text'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'""",
"""import FileText from 'lucide-react/dist/esm/icons/file-text'
import Edit2 from 'lucide-react/dist/esm/icons/edit-2'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'""")

# 6) Add onEdit to OrderDetailModal props
c, _ = rep(c, NL,
"""function OrderDetailModal({ orderId, onClose, canInvoice = true }: { orderId: number; onClose: () => void; canInvoice?: boolean }) {""",
"""function OrderDetailModal({ orderId, onClose, onEdit, canInvoice = true }: { orderId: number; onClose: () => void; onEdit?: () => void; canInvoice?: boolean }) {""")

# 7) Update detailOrderId render to pass onEdit
c, _ = rep(c, NL,
"""        <OrderDetailModal orderId={detailOrderId} onClose={() => setDetailOrderId(null)} canInvoice={isAdmin} />""",
"""        <OrderDetailModal orderId={detailOrderId} onClose={() => setDetailOrderId(null)} onEdit={() => setEditOrderId(detailOrderId)} canInvoice={isAdmin} />""")

# 8) Add Edit2 icon import to OrderDetailModal's view — Edit2 already imported (step 5)
# 9) Add edit modal render + exclude edit from mobile card
c, _ = rep(c, NL,
"""      {detailOrderId && (
        <OrderDetailModal orderId={detailOrderId} onClose={() => setDetailOrderId(null)} canInvoice={isAdmin} />
      )}
    </div>""",
"""      {detailOrderId && (
        <OrderDetailModal orderId={detailOrderId} onClose={() => setDetailOrderId(null)} onEdit={() => setEditOrderId(detailOrderId)} canInvoice={isAdmin} />
      )}
      {editOrderId && (
        <OrderEditModal orderId={editOrderId} onClose={() => setEditOrderId(null)} />
      )}
    </div>""")

save(p, c)
print('OrderPipeline: edit modal integrated')

# ==================== LeadCenter.tsx — name click ====================
p = 'src/pages/LeadCenter.tsx'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

c, _ = rep(c, NL,
"""              <div className="font-bold text-slate-800">{customer.name}</div>""",
"""              <div className="font-bold text-slate-800 cursor-pointer hover:text-blue-600" onClick={() => setSelectedCustomerId(lead.customerId)}>{customer.name}</div>""")

save(p, c)
print('LeadCenter: name click wired')

# ==================== OrderPipeline OrderCard name click ====================
p = 'src/pages/OrderPipeline.tsx'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

c, _ = rep(c, NL,
"""            <h4 className="font-bold text-slate-800 text-[13px] leading-tight truncate">{customer.name}</h4>""",
"""            <h4 className="font-bold text-slate-800 text-[13px] leading-tight truncate cursor-pointer hover:text-blue-600" onClick={() => onTimeline(order.customerId)}>{customer.name}</h4>""")

# MobileOrderCard name click
c, _ = rep(c, NL,
"""            <h4 className="font-bold text-slate-900 text-[15px] leading-tight">{customer.name}</h4>""",
"""            <h4 className="font-bold text-slate-900 text-[15px] leading-tight cursor-pointer hover:text-blue-600" onClick={() => onTimeline(order.customerId)}>{customer.name}</h4>""")

save(p, c)
print('OrderPipeline: OrderCard name click wired')

# ==================== Logistics.tsx — customer name click + profile modal ====================
p = 'src/pages/Logistics.tsx'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

# Add selectedCustomerId state
c, _ = rep(c, NL,
"""  const [editingShipId, setEditingShipId] = useState<number | null>(null);""",
"""  const [editingShipId, setEditingShipId] = useState<number | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);""")

# Wire customer name click
c, _ = rep(c, NL,
"""              <div className="font-medium text-slate-800 text-sm">{ship.customer.name}</div>""",
"""              <div className="font-medium text-slate-800 text-sm cursor-pointer hover:text-blue-600" onClick={() => setSelectedCustomerId(ship.customer.id)}>{ship.customer.name}</div>""")

# Import + render Customer360Profile at bottom — check if already imported
if 'Customer360Profile' not in c:
    c, _ = rep(c, NL,
    """import { ShipmentTrackingTimeline } from '../components/ShipmentTrackingTimeline';""",
    """import { Customer360Profile } from '../components/Customer360Profile';
import { ShipmentTrackingTimeline } from '../components/ShipmentTrackingTimeline';""")

# Add Customer360Profile render before the end
c, _ = rep(c, NL,
"""      {selectedOrderId && (
        <ShipmentTrackingTimeline orderId={selectedOrderId} isOpen={true} onClose={() => setSelectedOrderId(null)} />
      )}
    </div>""",
"""      {selectedOrderId && (
        <ShipmentTrackingTimeline orderId={selectedOrderId} isOpen={true} onClose={() => setSelectedOrderId(null)} />
      )}
      {selectedCustomerId && (
        <Customer360Profile customerId={selectedCustomerId} isOpen={true} onClose={() => setSelectedCustomerId(null)} />
      )}
    </div>""")

save(p, c)
print('Logistics: name click + profile modal added')

# ==================== FollowUps.tsx — name click ====================
p = 'src/pages/FollowUps.tsx'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

# SpaceLLeadCard name click (line ~478 area)
c, _ = rep(c, NL,
"""                  <h4 className="font-bold text-slate-800 text-sm">{customer.name}</h4>""",
"""                  <h4 className="font-bold text-slate-800 text-sm cursor-pointer hover:text-blue-600" onClick={() => onViewTimeline()}>{customer.name}</h4>""")

save(p, c)
print('FollowUps: name click wired')

# ==================== DeliveredCustomers.tsx — name click ====================
p = 'src/pages/DeliveredCustomers.tsx'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

c, _ = rep(c, NL,
"""                      <div className="font-bold text-slate-800">{cust.name}</div>""",
"""                      <div className="font-bold text-slate-800 cursor-pointer hover:text-blue-600" onClick={() => setSelectedCustomerId(cust.id!)}>{cust.name}</div>""")

save(p, c)
print('DeliveredCustomers: name click wired')

# ==================== UndeliveredCustomers.tsx — name click ====================
p = 'src/pages/UndeliveredCustomers.tsx'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

c, _ = rep(c, NL,
"""                      <div className="font-bold text-slate-800">{cust.name}</div>""",
"""                      <div className="font-bold text-slate-800 cursor-pointer hover:text-blue-600" onClick={() => setSelectedCustomerId(cust.id!)}>{cust.name}</div>""")

save(p, c)
print('UndeliveredCustomers: name click wired')

# ==================== Customers.tsx — name click ====================
p = 'src/pages/Customers.tsx'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

c, _ = rep(c, NL,
"""            <div className="font-bold text-slate-800">{customer.name}</div>""",
"""            <div className="font-bold text-slate-800 cursor-pointer hover:text-blue-600" onClick={() => setSelectedCustomerId(customer.id!)}>{customer.name}</div>""")

save(p, c)
print('Customers: name click wired')

print('\n=== ALL PHASE 3 DONE ===')