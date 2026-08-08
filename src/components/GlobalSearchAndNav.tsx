import { useState, useEffect, memo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import Search from 'lucide-react/dist/esm/icons/search'
import Menu from 'lucide-react/dist/esm/icons/menu'
import X from 'lucide-react/dist/esm/icons/x'
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call'
import MessageSquare from 'lucide-react/dist/esm/icons/message-square'
import Check from 'lucide-react/dist/esm/icons/check'
import { NotificationBell } from './NotificationBell';
import { Customer360Profile } from './Customer360Profile';
import { format } from 'date-fns';

export const GlobalSearchAndNav = memo(function GlobalSearchAndNav() {
  const location = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

  const followups = useLiveQuery(() => db.leads.filter(l => l.status === 'Followup' || l.status === 'Callback').toArray()) || [];

  const [activeReminder, setActiveReminder] = useState<any>(null);
  // OPTIMIZATION: Use useRef instead of state for triggeredIds to prevent effect re-triggering
  const triggeredIdsRef = useRef<number[]>([]);

  // Reset the global search whenever the route changes — search text must
  // never persist across pages (and never hold the login mobile number).
  useEffect(() => {
    setSearchTerm('');
    setResults([]);
    setIsSearchOpen(false);
  }, [location.pathname]);

  // Smart Followup Notification Engine
  // OPTIMIZATION: Only depends on followups (not triggeredIds) to prevent interval reset on each trigger
  useEffect(() => {
    const checkFollowups = async () => {
      const now = new Date();
      const currentLocalDate = format(now, 'yyyy-MM-dd');
      const currentLocalTime = format(now, 'HH:mm');

      for (const lead of followups) {
        const ids = triggeredIdsRef.current;
        if (lead.followupDate === currentLocalDate && lead.followupTime === currentLocalTime && lead.id && !ids.includes(lead.id)) {
          triggeredIdsRef.current = [...ids, lead.id!];
          
          // Fetch customer details
          const customer = await db.customers.get(lead.customerId);
          if (customer) {
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime);
            gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.15);

            // Native OS notification routing
            const electronWindow = (window as any).electron;
            if (electronWindow) {
              electronWindow.showNotification(
                'Follow-up Reminder Due Now!',
                `Customer: ${customer.name} for product ${lead.product}`
              );
            }
            
            setActiveReminder({ lead, customer });
          }
        }
      }
    };
    
    const interval = setInterval(checkFollowups, 5000);
    return () => clearInterval(interval);
  }, [followups]); // Only depends on followups — triggeredIdsRef stays stable

  useEffect(() => {
    const performSearch = async () => {
      if (searchTerm.length < 3) {
        setResults([]);
        return;
      }

      // Leverage indexed searches for instant lookup (Starts-with)
      const customers = await db.customers
        .where('mobile').startsWith(searchTerm)
        .or('name').startsWithIgnoreCase(searchTerm)
        .toArray();

      const orders = await db.orders
        .where('orderId').startsWithIgnoreCase(searchTerm)
        .or('trackingId').startsWithIgnoreCase(searchTerm)
        .toArray();

      const combinedResults = [
        ...customers.map(c => ({ type: 'Customer', data: c })),
        ...orders.map(o => ({ type: 'Order', data: o }))
      ] as any[];

      setResults(combinedResults.slice(0, 10)); // Top 10
    };

    const debounce = setTimeout(performSearch, 300);
    return () => clearTimeout(debounce);
  }, [searchTerm]);

  const handleResultClick = async (result: any) => {
    let customerId = result.type === 'Customer' ? result.data.id : result.data.customerId;
    setSelectedCustomerId(customerId || null);
    setIsSearchOpen(false);
    setSearchTerm('');
  };

  const handleReminderComplete = async (leadId: number) => {
    try {
      await db.leads.update(leadId, { status: 'Interested' });
      setActiveReminder(null);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      {activeReminder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border-2 border-amber-400 rounded-2xl w-full max-w-md shadow-2xl p-6 relative overflow-hidden animate-bounce-short">
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-400 to-orange-500"></div>
            
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-2 text-amber-600 font-bold">
                <PhoneCall size={20} className="animate-pulse" />
                <span>FOLLOW-UP REMINDER DUE NOW!</span>
              </div>
              <button onClick={() => setActiveReminder(null)} className="p-1 hover:bg-slate-100 rounded-full transition">
                <X size={20} className="text-slate-500" />
              </button>
            </div>

            <div className="space-y-3 mb-6">
              <div className="border-b border-slate-100 pb-2">
                <p className="text-xs text-slate-400 font-medium">CUSTOMER DETAILS</p>
                <p className="text-lg font-bold text-slate-800">{activeReminder.customer.name}</p>
                <p className="text-sm font-semibold text-slate-600">{activeReminder.customer.mobile}</p>
              </div>

              <div>
                <p className="text-xs text-slate-400 font-medium">PRODUCT INTERESTED</p>
                <p className="text-sm font-bold text-slate-700">{activeReminder.lead.product}</p>
              </div>

              {activeReminder.lead.notes && (
                <div className="bg-amber-50 border border-amber-100 p-3 rounded-lg text-sm text-slate-700 italic">
                  "{activeReminder.lead.notes}"
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <a 
                href={`tel:${activeReminder.customer.mobile}`}
                onClick={() => setActiveReminder(null)}
                className="flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition text-sm shadow-sm"
              >
                <PhoneCall size={16} /> Call Now
              </a>
              <a 
                href={`https://wa.me/91${activeReminder.customer.mobile}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setActiveReminder(null)}
                className="flex items-center justify-center gap-2 py-2.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition text-sm shadow-sm"
              >
                <MessageSquare size={16} /> WhatsApp
              </a>
              <button 
                onClick={() => handleReminderComplete(activeReminder.lead.id)}
                className="flex items-center justify-center gap-2 py-2.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition text-sm shadow-sm col-span-2"
              >
                <Check size={16} /> Complete Follow-up
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border-b border-slate-200 px-3 sm:px-6 lg:px-8 py-2.5 lg:py-3 flex justify-between items-center gap-3 z-10 sticky top-0">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('crm:toggle-sidebar'))}
          className="lg:hidden p-2 -ml-1 rounded-lg text-slate-600 hover:bg-slate-100 transition shrink-0"
          aria-label="Menu"
        >
          <Menu size={22} />
        </button>
        <div className="relative w-full min-w-0 sm:w-72 lg:w-96">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              autoComplete="off" 
              placeholder="Global Search (Phone, Name, Order ID, Tracking)..." 
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setIsSearchOpen(true); }}
              onFocus={() => setIsSearchOpen(true)}
              className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
            />
          </div>

          {isSearchOpen && searchTerm.length >= 3 && (
            <div className="absolute top-full mt-2 w-[500px] max-w-[calc(100vw-1.5rem)] right-0 sm:right-auto bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden max-h-[400px] overflow-y-auto">
              <div className="p-2 border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500">SEARCH RESULTS</div>
              {results.length > 0 ? (
                results.map((res, idx) => (
                  <div 
                    key={idx} 
                    onClick={() => handleResultClick(res)}
                    className="p-3 border-b border-slate-100 hover:bg-slate-50 cursor-pointer flex justify-between items-center"
                  >
                    <div>
                      <div className="font-bold text-slate-800 text-sm">
                        {res.type === 'Customer' ? res.data.name : res.data.orderId}
                      </div>
                      <div className="text-xs text-slate-500">
                        {res.type === 'Customer' ? res.data.mobile : `Tracking: ${res.data.trackingId || 'N/A'}`}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded">
                      {res.type}
                    </span>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-slate-500 text-sm">No results found for "{searchTerm}"</div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <NotificationBell />
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
            AD
          </div>
        </div>
      </div>

      {isSearchOpen && (
        <div className="fixed inset-0 z-0" onClick={() => setIsSearchOpen(false)}></div>
      )}

      {selectedCustomerId && (
        <Customer360Profile 
          customerId={selectedCustomerId} 
          isOpen={true} 
          onClose={() => setSelectedCustomerId(null)} 
        />
      )}
    </>
  );
});
