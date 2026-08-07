import { memo, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import LayoutDashboard from 'lucide-react/dist/esm/icons/layout-dashboard'
import Users from 'lucide-react/dist/esm/icons/users'
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call'
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart'
import Truck from 'lucide-react/dist/esm/icons/truck'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle'
import UserSquare2 from 'lucide-react/dist/esm/icons/user-square-2'
import MessageSquare from 'lucide-react/dist/esm/icons/message-square'
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3'
import Settings from 'lucide-react/dist/esm/icons/settings'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2'
import XCircle from 'lucide-react/dist/esm/icons/x-circle'
import UploadCloud from 'lucide-react/dist/esm/icons/upload-cloud'
import FileText from 'lucide-react/dist/esm/icons/file-text'
import Package from 'lucide-react/dist/esm/icons/package'
import Wallet from 'lucide-react/dist/esm/icons/wallet'
import Receipt from 'lucide-react/dist/esm/icons/receipt'
import Shield from 'lucide-react/dist/esm/icons/shield'
import Database from 'lucide-react/dist/esm/icons/database'
import UserPlus from 'lucide-react/dist/esm/icons/user-plus'
import LogOut from 'lucide-react/dist/esm/icons/log-out'
import X from 'lucide-react/dist/esm/icons/x'
import { cn } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { useSyncStatus } from '../db/syncStatus';
import { PwaInstallButton } from './PwaInstallButton';
import logo from '../assets/logo.png';

interface NavItem {
  name: string;
  path: string;
  icon: any;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Lead Center', path: '/leads', icon: Users },
  { name: 'SpaceL Leads', path: '/followups', icon: PhoneCall },
  { name: 'Order Pipeline', path: '/orders', icon: ShoppingCart },
  { name: 'Logistics', path: '/logistics', icon: Truck, adminOnly: true },
  { name: 'NDR Panel', path: '/ndr', icon: AlertTriangle, adminOnly: true },
  { name: 'Delivered Order list', path: '/delivered-list', icon: CheckCircle2, adminOnly: true },
  { name: 'Undelivered Cases', path: '/undelivered-list', icon: XCircle, adminOnly: true },
  { name: 'All Customers', path: '/customers', icon: UserSquare2, adminOnly: true },
  { name: 'Invoices', path: '/invoices', icon: FileText, adminOnly: true },
  { name: 'Payments', path: '/payments', icon: Wallet, adminOnly: true },
  { name: 'Inventory', path: '/inventory', icon: Package, adminOnly: true },
  { name: 'Invoice Settings', path: '/invoice-settings', icon: Receipt, adminOnly: true },
  { name: 'Backup Center', path: '/backup', icon: Shield, adminOnly: true },
  { name: 'Bulk Import', path: '/bulk-import', icon: UploadCloud, adminOnly: true },
  { name: 'WhatsApp Auto', path: '/whatsapp', icon: MessageSquare, adminOnly: true },
  { name: 'Analytics', path: '/analytics', icon: BarChart3, adminOnly: true },
  { name: 'Telecaller Performance', path: '/performance', icon: BarChart3, adminOnly: true },
  { name: 'Courier Analytics', path: '/courier-analytics', icon: Truck, adminOnly: true },
  { name: 'GST Reports', path: '/gst-reports', icon: FileText, adminOnly: true },
  { name: 'DB Health', path: '/db-health', icon: Database, adminOnly: true },
  { name: 'Settings', path: '/settings', icon: Settings, adminOnly: true },
];

export const Sidebar = memo(function Sidebar() {
  const { profile, isAdmin, logout } = useAuth();
  const sync = useSyncStatus();
  const [open, setOpen] = useState(false);

  // Mobile drawer — controlled via custom events from the topbar hamburger
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    const close = () => setOpen(false);
    window.addEventListener('crm:toggle-sidebar', toggle);
    window.addEventListener('crm:close-sidebar', close);
    return () => {
      window.removeEventListener('crm:toggle-sidebar', toggle);
      window.removeEventListener('crm:close-sidebar', close);
    };
  }, []);

  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin);
  const teamItem: NavItem = { name: 'Team Management', path: '/team', icon: UserPlus, adminOnly: true };
  if (isAdmin) visibleItems.push(teamItem);

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={cn(
          'fixed inset-0 bg-black/50 z-40 lg:hidden transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={() => setOpen(false)}
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-slate-900 text-white border-r border-slate-800 transform transition-transform duration-200 lg:static lg:translate-x-0 lg:z-auto shadow-2xl lg:shadow-none',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={logo}
              alt="AVNIDEEP logo"
              draggable={false}
              className="h-10 w-10 shrink-0 rounded-lg bg-slate-800 object-contain ring-1 ring-white/15"
            />
            <h1 className="text-xl font-bold tracking-wider text-blue-400">
              AVNIDEEP<span className="text-white">CRM</span>
              <span className="text-xs text-blue-500 block">PRO EDITION</span>
            </h1>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="lg:hidden p-2 -mr-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-3">
            {visibleItems.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-200",
                      isActive
                        ? "bg-blue-600 text-white"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    )
                  }
                >
                  <item.icon size={20} />
                  <span className="font-medium">{item.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
          <PwaInstallButton variant="light" />
          {profile && (
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-bold text-white truncate">{profile.full_name}</div>
                <div className="text-[11px] text-slate-400">
                  <span className="font-semibold">{isAdmin ? 'Admin' : 'Telecaller'}</span>
                  {profile.mobile ? ` • ${profile.mobile}` : ''}
                </div>
              </div>
              <button
                onClick={logout}
                title="Logout"
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-red-400 transition"
              >
                <LogOut size={16} />
              </button>
            </div>
          )}
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                sync.online ? (sync.pending > 0 ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-red-400'
              }`}
            />
            {sync.online
              ? sync.pending > 0
                ? `${sync.pending} item(s) sync pending…`
                : 'Online • Synced'
              : 'Offline Mode'}
          </div>
          <div className="text-[10px] text-slate-600 mt-1">v1.0.0 • Cloud Sync</div>
        </div>
      </aside>
    </>
  );
});
