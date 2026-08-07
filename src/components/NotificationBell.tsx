import { useState, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import Bell from 'lucide-react/dist/esm/icons/bell'
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call'
import PackageX from 'lucide-react/dist/esm/icons/package-x'
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

const TYPE_ICONS: Record<string, any> = {
  info: PhoneCall,
  warning: AlertTriangle,
  success: CheckCircle,
  alert: PackageX,
};

const TYPE_COLORS: Record<string, string> = {
  info: 'bg-blue-100 text-blue-600',
  warning: 'bg-amber-100 text-amber-600',
  success: 'bg-emerald-100 text-emerald-600',
  alert: 'bg-red-100 text-red-600',
};

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'all' | 'unread'>('unread');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const allNotifications = useLiveQuery(() => db.notifications.reverse().sortBy('createdAt'), []) || [];
  const unreadNotifications = useLiveQuery(() => db.notifications.filter(n => n.isRead === false).reverse().sortBy('createdAt'), []) || [];

  const displayed = selectedTab === 'unread' ? unreadNotifications : allNotifications.slice(0, 50);
  const unreadCount = unreadNotifications.length;

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAllRead = async () => {
    for (const n of unreadNotifications) {
      if (n.id) await db.notifications.update(n.id, { isRead: true });
    }
  };

  const markOneRead = async (id: number) => {
    await db.notifications.update(id, { isRead: true });
  };

  const handleBellClick = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button onClick={handleBellClick} className="relative p-1 hover:bg-slate-100 rounded-lg transition" title="Notifications">
        <Bell size={20} className="text-slate-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-[420px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 flex flex-col max-h-[600px] animate-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="p-4 border-b border-slate-100 flex justify-between items-center">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Notifications</h3>
              <p className="text-xs text-slate-500">{unreadCount} unread</p>
            </div>
            <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg">
              <button
                onClick={() => setSelectedTab('unread')}
                className={`px-3 py-1 rounded-md text-xs font-bold transition ${selectedTab === 'unread' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Unread
              </button>
              <button
                onClick={() => setSelectedTab('all')}
                className={`px-3 py-1 rounded-md text-xs font-bold transition ${selectedTab === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                All
              </button>
            </div>
          </div>

          {/* Notification List */}
          <div className="flex-1 overflow-y-auto">
            {displayed.length === 0 && (
              <div className="p-10 text-center text-slate-400">
                <Bell size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm font-medium">No notifications</p>
                <p className="text-xs mt-1">New alerts will appear here</p>
              </div>
            )}
            {displayed.map((n) => {
              const Icon = TYPE_ICONS[n.type] || Bell;
              const colorClass = TYPE_COLORS[n.type] || 'bg-slate-100 text-slate-600';
              return (
                <div
                  key={n.id}
                  className={`px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition cursor-pointer flex gap-3 items-start ${!n.isRead ? 'bg-blue-50/30' : ''}`}
                  onClick={() => {
                    if (n.id && !n.isRead) markOneRead(n.id);
                    if (n.linkTo) navigate(n.linkTo);
                  }}
                >
                  <div className={`w-8 h-8 rounded-full ${colorClass} flex items-center justify-center shrink-0`}>
                    <Icon size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-800 text-sm truncate">{n.title}</div>
                    <div className="text-xs text-slate-600 line-clamp-2">{n.message}</div>
                    <div className="text-[10px] text-slate-400 mt-1">
                      {format(new Date(n.createdAt), 'dd MMM yyyy, hh:mm a')}
                    </div>
                  </div>
                  {!n.isRead && (
                    <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0 mt-2"></span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          {unreadCount > 0 && (
            <div className="p-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              <button
                onClick={markAllRead}
                className="w-full py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition"
              >
                Mark all as read
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
