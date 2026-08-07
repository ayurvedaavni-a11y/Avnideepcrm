# -*- coding: utf-8 -*-
# Production fixes: OrderPipeline.tsx
#  - telecaller My Orders card: Invoice hidden, read-only shipment tracking
#  - OrderDetailModal: Invoice button admin-only
import io, sys

def load(p):
    with io.open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()

def save(p, c):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(c)

def patch_file(path, edits):
    content = load(path)
    NL = '\r\n' if '\r\n' in content else '\n'
    for old, new in edits:
        o = old.replace('\n', NL)
        n = new.replace('\n', NL)
        c = content.count(o)
        if c != 1:
            print(f'FAIL [{c}] in {path}: {old.splitlines()[0][:80]}')
            sys.exit(1)
        content = content.replace(o, n)
        print('OK ->', old.splitlines()[0][:60])
    save(path, content)

patch_file('src/pages/OrderPipeline.tsx', [
# --- MobileOrderCard: signature + guard + stepper component ---
("""const MobileOrderCard = memo(function MobileOrderCard({ order, customer, lead, onDetail }: {
  order: any; customer: any; lead?: Lead;
  onTimeline: (customerId: number) => void;
  onDetail: (orderId: number) => void;
}) {
  const handleInvoice = async () => {
    let inv = await db.invoices.where('orderId').equals(order.id!).first();
    if (!inv) inv = await autoGenerateInvoice(order.id, 'Admin') || undefined;
    if (inv) downloadInvoicePDF(inv);
  };
  if (!customer) return null;
""",
"""// Read-only shipment tracking shown on the telecaller's My Orders card.
const TRACKING_STEPS = ['Order Booked', 'Packing', 'Packed', 'Ready To Ship', 'Shipped', 'In Transit', 'Out For Delivery', 'Delivered'];

function ShipmentSteps({ status }: { status: string }) {
  const idx = TRACKING_STEPS.indexOf(status);
  if (status === 'RTO' || status === 'Cancelled') {
    return (
      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${status === 'RTO' ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-600'}`}>{status}</span>
        <span className="text-[10px] text-slate-400 font-medium">Shipment tracking ends here</span>
      </div>
    );
  }
  if (idx < 0) return null;
  return (
    <div className="mt-2.5 pt-2 border-t border-slate-100">
      <div className="flex items-center gap-0.5 overflow-x-auto av-scroll-none pb-0.5">
        {TRACKING_STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-0.5 shrink-0">
            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full whitespace-nowrap transition-colors ${
              i < idx ? 'bg-emerald-100 text-emerald-700'
              : i === idx ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-400'
            }`}>
              {s}
            </span>
            {i < TRACKING_STEPS.length - 1 && (
              <span className={`w-1.5 h-px shrink-0 ${i < idx ? 'bg-emerald-300' : 'bg-slate-200'}`} />
            )}
          </div>
        ))}
      </div>
      <p className="text-[9px] text-slate-400 font-medium mt-1">Read-only tracking — status updates automatically</p>
    </div>
  );
}

const MobileOrderCard = memo(function MobileOrderCard({ order, customer, lead, onDetail, canInvoice = false, showTracking = false }: {
  order: any; customer: any; lead?: Lead;
  onTimeline: (customerId: number) => void;
  onDetail: (orderId: number) => void;
  canInvoice?: boolean;
  showTracking?: boolean;
}) {
  const handleInvoice = async () => {
    if (!canInvoice) return;
    let inv = await db.invoices.where('orderId').equals(order.id!).first();
    if (!inv) inv = await autoGenerateInvoice(order.id, 'Admin') || undefined;
    if (inv) downloadInvoicePDF(inv);
  };
  if (!customer) return null;
"""),
# --- MobileOrderCard: action grid (Invoice admin-only) + stepper ---
("""      {/* Thumb-friendly action row */}
      <div className="px-3 pb-3 pt-1 grid grid-cols-4 gap-2">
        <a href={`tel:${customer.mobile}`} className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-green-50 text-green-700 border border-green-100 active:scale-95 transition-transform">
          <Phone size={18} />
          <span className="text-[10px] font-bold">Call</span>
        </a>
        <a href={`https://wa.me/91${customer.mobile}`} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 active:scale-95 transition-transform">
          <MessageCircle size={18} />
          <span className="text-[10px] font-bold">WhatsApp</span>
        </a>
        <button onClick={handleInvoice} className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 active:scale-95 transition-transform">
          <FileText size={18} />
          <span className="text-[10px] font-bold">Invoice</span>
        </button>
        <button onClick={() => onDetail(order.id!)} className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 active:scale-95 transition-transform">
          <Eye size={18} />
          <span className="text-[10px] font-bold">Details</span>
        </button>
      </div>
    </div>
  );
});
""",
"""      {/* Thumb-friendly action row — Invoice is ADMIN-ONLY (hidden for telecallers) */}
      <div className={`px-3 pb-3 pt-1 grid ${canInvoice ? 'grid-cols-4' : 'grid-cols-3'} gap-2`}>
        <a href={`tel:${customer.mobile}`} className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-green-50 text-green-700 border border-green-100 active:scale-95 transition-transform">
          <Phone size={18} />
          <span className="text-[10px] font-bold">Call</span>
        </a>
        <a href={`https://wa.me/91${customer.mobile}`} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 active:scale-95 transition-transform">
          <MessageCircle size={18} />
          <span className="text-[10px] font-bold">WhatsApp</span>
        </a>
        {canInvoice && (
          <button onClick={handleInvoice} className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 active:scale-95 transition-transform">
            <FileText size={18} />
            <span className="text-[10px] font-bold">Invoice</span>
          </button>
        )}
        <button onClick={() => onDetail(order.id!)} className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 active:scale-95 transition-transform">
          <Eye size={18} />
          <span className="text-[10px] font-bold">Details</span>
        </button>
      </div>

      {/* Read-only shipment tracking (telecaller My Orders) */}
      {showTracking && <ShipmentSteps status={order.status} />}
    </div>
  );
});
"""),
# --- telecaller view: pass canInvoice=false + showTracking ---
("""            {tcOrders.map(order => (
              <MobileOrderCard
                key={order.id}
                order={order}
                customer={customerMap.get(order.customerId)}
                lead={leadMap.get(order.leadId!)}
                onTimeline={handleViewTimeline}
                onDetail={handleViewDetail}
              />
            ))}
""",
"""            {tcOrders.map(order => (
              <MobileOrderCard
                key={order.id}
                order={order}
                customer={customerMap.get(order.customerId)}
                lead={leadMap.get(order.leadId!)}
                onTimeline={handleViewTimeline}
                onDetail={handleViewDetail}
                canInvoice={false}
                showTracking
              />
            ))}
"""),
# --- MobileBoard signature ---
("""function MobileBoard({ orders, activeChip, setActiveChip, leadMap, customerMap, onTimeline, onDetail }: {
  orders: any[];
  activeChip: string;
  setActiveChip: (c: string) => void;
  leadMap: Map<number, Lead>;
  customerMap: Map<number, any>;
  onTimeline: (customerId: number) => void;
  onDetail: (orderId: number) => void;
}) {
""",
"""function MobileBoard({ orders, activeChip, setActiveChip, leadMap, customerMap, onTimeline, onDetail, canInvoice = true }: {
  orders: any[];
  activeChip: string;
  setActiveChip: (c: string) => void;
  leadMap: Map<number, Lead>;
  customerMap: Map<number, any>;
  onTimeline: (customerId: number) => void;
  onDetail: (orderId: number) => void;
  canInvoice?: boolean;
}) {
"""),
("""                <MobileOrderCard
                  order={order}
                  customer={customerMap.get(order.customerId)}
                  lead={leadMap.get(order.leadId!)}
                  onTimeline={onTimeline}
                  onDetail={onDetail}
                />
""",
"""                <MobileOrderCard
                  order={order}
                  customer={customerMap.get(order.customerId)}
                  lead={leadMap.get(order.leadId!)}
                  onTimeline={onTimeline}
                  onDetail={onDetail}
                  canInvoice={canInvoice}
                />
"""),
("""      <MobileBoard
        orders={filteredOrders}
        activeChip={activeChip}
        setActiveChip={setActiveChip}
        leadMap={leadMap}
        customerMap={customerMap}
        onTimeline={handleViewTimeline}
        onDetail={handleViewDetail}
      />
""",
"""      <MobileBoard
        orders={filteredOrders}
        activeChip={activeChip}
        setActiveChip={setActiveChip}
        leadMap={leadMap}
        customerMap={customerMap}
        onTimeline={handleViewTimeline}
        onDetail={handleViewDetail}
        canInvoice={isAdmin}
      />
"""),
# --- OrderDetailModal signature + invoice guard ---
("""function OrderDetailModal({ orderId, onClose }: { orderId: number; onClose: () => void }) {
""",
"""function OrderDetailModal({ orderId, onClose, canInvoice = true }: { orderId: number; onClose: () => void; canInvoice?: boolean }) {
"""),
("""          <button onClick={() => { const inv = db.invoices.where('orderId').equals(order.id!).first(); inv.then(i => { if (i) downloadInvoicePDF(i); else autoGenerateInvoice(order.id!, 'Admin').then(g => g && downloadInvoicePDF(g)); }); }}
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 font-bold text-xs hover:bg-blue-100 transition active:scale-95">
            <FileText size={15} /> Invoice
          </button>
""",
"""          {canInvoice && (
            <button onClick={() => { const inv = db.invoices.where('orderId').equals(order.id!).first(); inv.then(i => { if (i) downloadInvoicePDF(i); else autoGenerateInvoice(order.id!, 'Admin').then(g => g && downloadInvoicePDF(g)); }); }}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 font-bold text-xs hover:bg-blue-100 transition active:scale-95">
              <FileText size={15} /> Invoice
            </button>
          )}
"""),
# --- telecaller + admin OrderDetailModal call sites ---
("""        {detailOrderId && (
          <OrderDetailModal orderId={detailOrderId} onClose={() => setDetailOrderId(null)} />
        )}
""",
"""        {detailOrderId && (
          <OrderDetailModal orderId={detailOrderId} onClose={() => setDetailOrderId(null)} canInvoice={isAdmin} />
        )}
"""),
("""      {detailOrderId && (
        <OrderDetailModal orderId={detailOrderId} onClose={() => setDetailOrderId(null)} />
      )}
""",
"""      {detailOrderId && (
        <OrderDetailModal orderId={detailOrderId} onClose={() => setDetailOrderId(null)} canInvoice={isAdmin} />
      )}
"""),
])

print('PART 2 OK')
