import MessageSquare from 'lucide-react/dist/esm/icons/message-square'
import Send from 'lucide-react/dist/esm/icons/send'
import Settings from 'lucide-react/dist/esm/icons/settings'
import Smartphone from 'lucide-react/dist/esm/icons/smartphone'
import { toast } from 'react-hot-toast';

export function WhatsApp() {
  const templates = [
    { id: 'followup', name: 'Send Followup', message: 'Hi {{name}}, we noticed you were interested in {{product}}. Let us know if you need any help!' },
    { id: 'shipment', name: 'Send Shipment', message: 'Great news! Your order {{orderId}} has been shipped via {{courier}}. Tracking: {{trackingId}}' },
    { id: 'otp', name: 'Send OTP', message: 'Your verification OTP for order is {{otp}}. Please do not share this with anyone.' },
    { id: 'delivery', name: 'Send Delivery Message', message: 'Yay! Your order {{orderId}} has been successfully delivered. Thank you for shopping with us.' },
    { id: 'ndr', name: 'Send NDR Message', message: 'Hi {{name}}, our courier tried to deliver your order but couldn\'t. Please reply with a preferred time for reattempt.' },
  ];

  const handleTestSend = (templateName: string) => {
    toast.success(`Test message for "${templateName}" initiated via WhatsApp API (Simulation)`);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between flex-wrap gap-2 items-center">
        <h1 className="text-2xl font-bold text-slate-900">WhatsApp Automation</h1>
        <button className="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-200 transition">
          <Settings size={18} /> Configure API
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
              <Smartphone size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Quick Sender</h2>
              <p className="text-sm text-slate-500">Test automation templates manually</p>
            </div>
          </div>
          
          <div className="space-y-3">
            {templates.map(tpl => (
              <div key={tpl.id} className="flex items-center justify-between p-3 border border-slate-100 rounded-lg hover:bg-slate-50">
                <div className="font-medium text-slate-700">{tpl.name}</div>
                <button 
                  onClick={() => handleTestSend(tpl.name)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm font-bold rounded hover:bg-green-700 transition"
                >
                  <Send size={14} /> Send
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <MessageSquare size={20} /> Template Preview
          </h2>
          
          <div className="space-y-4">
            {templates.map(tpl => (
              <div key={tpl.id} className="bg-slate-50 p-4 rounded-lg border border-slate-100 relative">
                <span className="absolute top-2 right-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">{tpl.id}</span>
                <p className="text-sm font-medium text-slate-800 mb-2">{tpl.name}</p>
                <p className="text-sm text-slate-600 font-mono bg-white p-2 rounded border border-slate-200">
                  {tpl.message}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
