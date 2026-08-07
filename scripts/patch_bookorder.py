# -*- coding: utf-8 -*-
# BookOrderModal upgrade:
#  - import useAuth for role check
#  - add specialInstructions + orderNotes to formData + form fields
#  - save landmark + notes (customer remark) to customer
#  - save discount, deliveryCharge, codCharge, paymentMode, specialInstructions, orderNotes to order
#  - mobile read-only for telecaller

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

p = 'src/components/BookOrderModal.tsx'
c = load(p)
NL = '\r\n' if '\r\n' in c else '\n'

# 1) Import useAuth
c = rep(c, NL,
"""import { toast } from 'react-hot-toast';""",
"""import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';""")

# 2) specialInstructions + orderNotes in formData
c = rep(c, NL,
"""    courier: '',
    notes: ''
  });""",
"""    courier: '',
    paymentMode: 'COD' as 'COD' | 'Prepaid',
    specialInstructions: '',
    orderNotes: '',
    notes: ''
  });""")

# 3) Get role
c = rep(c, NL,
"""  const [saving, setSaving] = useState(false);""",
"""  const { isAdmin } = useAuth();
  const [saving, setSaving] = useState(false);""")

# 4) Update customer save — add landmark + notes, name + alt now allowed
c = rep(c, NL,
"""      await db.customers.update(customer.id!, {
        name: formData.name,
        mobile: formData.mobile,
        alternateNumber: formData.altMobile,
        address: formData.address,
        city: formData.city,
        state: formData.state,
        pincode: formData.pincode,
        currentStatus: 'Order Booked',
        totalOrders: (customer.totalOrders || 0) + 1,
        updatedAt: new Date().toISOString()
      });""",
"""      await db.customers.update(customer.id!, {
        name: formData.name,
        mobile: formData.mobile,
        alternateNumber: formData.altMobile,
        address: formData.address,
        landmark: formData.landmark || '',
        city: formData.city,
        state: formData.state,
        pincode: formData.pincode,
        notes: formData.notes || '',
        currentStatus: 'Order Booked',
        totalOrders: (customer.totalOrders || 0) + 1,
        updatedAt: new Date().toISOString()
      });""")

# 5) Order create — add discount, deliveryCharge, codCharge, paymentMode, specialInstructions, orderNotes
c = rep(c, NL,
"""        product: selectedProduct?.name || formData.productSearch || 'General Item',
        qty: formData.quantity,
        codAmount: totals.finalTotal,
        status: 'Order Booked',
        orderDate: nowIso,
        bookedBy,
        bookedByName,
        createdAt: nowIso,
        updatedAt: nowIso""",
"""        product: selectedProduct?.name || formData.productSearch || 'General Item',
        qty: formData.quantity,
        codAmount: totals.finalTotal,
        discount: formData.discount || 0,
        deliveryCharge: formData.deliveryCharge || 0,
        codCharge: formData.codCharge || 0,
        paymentMode: formData.paymentMode || 'COD',
        specialInstructions: formData.specialInstructions || '',
        orderNotes: formData.orderNotes || '',
        status: 'Order Booked',
        orderDate: nowIso,
        bookedBy,
        bookedByName,
        createdAt: nowIso,
        updatedAt: nowIso""")

# 6) Mobile input read-only for telecaller
c = rep(c, NL,
"""              <div className="grid grid-cols-2 gap-4">
                <Input label="Mobile" value={formData.mobile} onChange={v => setFormData({...formData, mobile: v})} />
                <Input label="Alt Mobile" value={formData.altMobile} onChange={v => setFormData({...formData, altMobile: v})} />
              </div>""",
"""              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Mobile</label>
                  <input
                    className="w-full p-3 bg-slate-100 border border-slate-200 rounded-2xl text-sm font-medium"
                    value={formData.mobile}
                    readOnly={!isAdmin}
                    title={!isAdmin ? "🔒 Mobile cannot be changed" : undefined}
                    tabIndex={-1}
                  />
                  {!isAdmin && <p className="text-[9px] text-amber-600 font-bold mt-1 ml-1">🔒 Mobile locked</p>}
                </div>
                <Input label="Alt Mobile" value={formData.altMobile} onChange={v => setFormData({...formData, altMobile: v})} />
              </div>""")

# 7) Add specialInstructions + orderNotes fields in Order Details section
# Find the "Order Summary" section and add fields before it
c = rep(c, NL,
"""              {/* Order Summary */}
              <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl shadow-slate-200 mt-4 relative overflow-hidden">""",
"""              <div className="space-y-3">
                <Input label="Special Instructions" value={formData.specialInstructions} onChange={v => setFormData({...formData, specialInstructions: v})} multiline />
                <Input label="Order Remarks / Notes" value={formData.orderNotes} onChange={v => setFormData({...formData, orderNotes: v})} multiline />
              </div>

              {/* Order Summary */}
              <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl shadow-slate-200 mt-4 relative overflow-hidden">""")

save(p, c)
print('BookOrderModal upgrade DONE')