import { useState, useEffect } from 'react';
import Settings from 'lucide-react/dist/esm/icons/settings'
import Save from 'lucide-react/dist/esm/icons/save'
import Building2 from 'lucide-react/dist/esm/icons/building-2'
import Receipt from 'lucide-react/dist/esm/icons/receipt'
import { toast } from 'react-hot-toast';
import { getGSTConfig, saveGSTConfig, getCompanyConfig, saveCompanyConfig, GSTConfig, CompanyConfig } from '../db/settingsEngine';

export function InvoiceSettings() {
  const [tab, setTab] = useState<'company' | 'gst' | 'template'>('company');
  const [gst, setGst] = useState<GSTConfig | null>(null);
  const [company, setCompany] = useState<CompanyConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setGst(await getGSTConfig());
      setCompany(await getCompanyConfig());
    })();
  }, []);

  const handleSave = async () => {
    if (!gst || !company) return;
    setSaving(true);
    try {
      await saveGSTConfig(gst);
      await saveCompanyConfig(company);
      toast.success('Settings saved successfully');
    } catch (e) {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!gst || !company) {
    return <div className="p-10 text-center text-slate-500">Loading settings…</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-4xl">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Settings className="text-blue-600" /> Invoice Settings
          </h1>
          <p className="text-slate-500 text-sm">Configure company details, GST rules, and invoice templates.</p>
        </div>
        <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700 transition font-bold text-sm shadow-sm disabled:opacity-50">
          <Save size={16} /> {saving ? 'Saving…' : 'Save All Settings'}
        </button>
      </div>

      <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-sm flex gap-1 inline-flex">
        <TabBtn active={tab === 'company'} onClick={() => setTab('company')} icon={Building2} label="Company Profile" />
        <TabBtn active={tab === 'gst'} onClick={() => setTab('gst')} icon={Receipt} label="GST & Pricing Rules" />
        <TabBtn active={tab === 'template'} onClick={() => setTab('template')} icon={Settings} label="Template & Footer" />
      </div>

      {tab === 'company' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-bold text-slate-800">Company Profile</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Company Name" value={company.name} onChange={(v) => setCompany({ ...company, name: v })} />
            <Field label="Tagline" value={company.tagline} onChange={(v) => setCompany({ ...company, tagline: v })} />
            <Field label="GSTIN" value={company.gstin} onChange={(v) => setCompany({ ...company, gstin: v })} />
            <Field label="Invoice Prefix (e.g. AD)" value={company.invoicePrefix} onChange={(v) => setCompany({ ...company, invoicePrefix: v })} />
            <Field label="Phone" value={company.phone} onChange={(v) => setCompany({ ...company, phone: v })} />
            <Field label="Email" value={company.email} onChange={(v) => setCompany({ ...company, email: v })} />
            <Field label="Address" value={company.address} onChange={(v) => setCompany({ ...company, address: v })} />
            <Field label="City / State / Pincode" value={company.city} onChange={(v) => setCompany({ ...company, city: v })} />
            <Field label="State" value={company.state} onChange={(v) => setCompany({ ...company, state: v })} />
            <Field label="State Code" value={company.stateCode} onChange={(v) => setCompany({ ...company, stateCode: v })} />
            <Field label="Default HSN Code" value={company.hsnDefault} onChange={(v) => setCompany({ ...company, hsnDefault: v })} />
          </div>
          <div className="border-t pt-4">
            <h3 className="font-bold text-slate-800 mb-3">Bank Details</h3>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Bank Name" value={company.bankName} onChange={(v) => setCompany({ ...company, bankName: v })} />
              <Field label="Account No" value={company.bankAccount} onChange={(v) => setCompany({ ...company, bankAccount: v })} />
              <Field label="IFSC Code" value={company.bankIFSC} onChange={(v) => setCompany({ ...company, bankIFSC: v })} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 uppercase">Company Logo (base64 PNG/JPG)</label>
            <input type="file" accept="image/*" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setCompany({ ...company, logoBase64: String(reader.result) });
              reader.readAsDataURL(file);
            }} className="text-sm" />
            {company.logoBase64 && <img src={company.logoBase64} alt="Logo preview" className="mt-2 h-16 border rounded" />}
          </div>
        </div>
      )}

      {tab === 'gst' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-bold text-slate-800">GST & Pricing Rules</h2>
          <ToggleField label="GST Enabled" checked={gst.gstEnabled} onChange={(v) => setGst({ ...gst, gstEnabled: v })} hint="Disable to generate invoices without tax" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="GST Percentage (%)" type="number" value={gst.gstRate} onChange={(v) => setGst({ ...gst, gstRate: Number(v) || 0 })} />
            <SelectField label="GST Mode" value={gst.gstMode} options={['exclusive', 'inclusive']} onChange={(v) => setGst({ ...gst, gstMode: v as any })} />
          </div>
          <ToggleField label="Apply GST Before Discount" checked={gst.gstBeforeDiscount} onChange={(v) => setGst({ ...gst, gstBeforeDiscount: v })} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Delivery Charge (₹)" type="number" value={gst.deliveryCharge} onChange={(v) => setGst({ ...gst, deliveryCharge: Number(v) || 0 })} />
            <Field label="COD Charge (₹)" type="number" value={gst.codCharge} onChange={(v) => setGst({ ...gst, codCharge: Number(v) || 0 })} />
          </div>
          <ToggleField label="Round Off Total" checked={gst.roundOffEnabled} onChange={(v) => setGst({ ...gst, roundOffEnabled: v })} hint="Round total to nearest rupee" />
          <Field label="Currency Symbol" value={gst.currency} onChange={(v) => setGst({ ...gst, currency: v })} />
        </div>
      )}

      {tab === 'template' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-bold text-slate-800">Invoice Template & Footer</h2>
          <Field label="Terms & Conditions (one per line)" value={company.termsConditions} onChange={(v) => setCompany({ ...company, termsConditions: v })} multiline />
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 uppercase">Authorized Signature (base64 image)</label>
            <input type="file" accept="image/*" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setCompany({ ...company, signatureBase64: String(reader.result) });
              reader.readAsDataURL(file);
            }} className="text-sm" />
            {company.signatureBase64 && <img src={company.signatureBase64} alt="Signature preview" className="mt-2 h-16 border rounded bg-white" />}
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: any) {
  return (
    <button onClick={onClick} className={`px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition ${active ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>
      <Icon size={14} /> {label}
    </button>
  );
}

function Field({ label, value, onChange, type = 'text', multiline = false }: { label: string; value: any; onChange: (v: string) => void; type?: string; multiline?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
      )}
    </div>
  );
}

function ToggleField({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-200">
      <div>
        <div className="font-bold text-slate-800 text-sm">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      <button onClick={() => onChange(!checked)} className={`w-12 h-6 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <span className={`block w-5 h-5 bg-white rounded-full shadow transition transform ${checked ? 'translate-x-6' : 'translate-x-0.5'}`}></span>
      </button>
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg text-sm">
        {options.map(opt => <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>)}
      </select>
    </div>
  );
}
