import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Layout } from './components/Layout';
import { LockScreen } from './components/LockScreen';
import { Toaster } from 'react-hot-toast';
import { db } from './db/db';
import { hydrateFromSQLite, attachWriteThroughSync } from './db/sqliteSync';
import { checkOverdueSpaceLFollowups } from './db/workflow';
import { DateFilterProvider } from './context/DateFilterContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { startOnlineSync, stopOnlineSync } from './db/onlineSync';
import { runNotificationChecks } from './db/notificationEngine';
import { Login } from './pages/Login';

// Lazy-loaded route pages — split into separate chunks
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const LeadCenter = lazy(() => import('./pages/LeadCenter').then(m => ({ default: m.LeadCenter })));
const FollowUps = lazy(() => import('./pages/FollowUps').then(m => ({ default: m.FollowUps })));
const OrderPipeline = lazy(() => import('./pages/OrderPipeline').then(m => ({ default: m.OrderPipeline })));
const Logistics = lazy(() => import('./pages/Logistics').then(m => ({ default: m.Logistics })));
const NDRPanel = lazy(() => import('./pages/NDRPanel').then(m => ({ default: m.NDRPanel })));
const Customers = lazy(() => import('./pages/Customers').then(m => ({ default: m.Customers })));
const WhatsApp = lazy(() => import('./pages/WhatsApp').then(m => ({ default: m.WhatsApp })));
const Analytics = lazy(() => import('./pages/Analytics').then(m => ({ default: m.Analytics })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const DeliveredCustomers = lazy(() => import('./pages/DeliveredCustomers').then(m => ({ default: m.DeliveredCustomers })));
const UndeliveredCustomers = lazy(() => import('./pages/UndeliveredCustomers').then(m => ({ default: m.UndeliveredCustomers })));
const BulkImport = lazy(() => import('./pages/BulkImport').then(m => ({ default: m.BulkImport })));
const Invoices = lazy(() => import('./pages/Invoices').then(m => ({ default: m.Invoices })));
const Inventory = lazy(() => import('./pages/Inventory').then(m => ({ default: m.Inventory })));
const InvoiceSettings = lazy(() => import('./pages/InvoiceSettings').then(m => ({ default: m.InvoiceSettings })));
const CreateInvoice = lazy(() => import('./pages/CreateInvoice').then(m => ({ default: m.CreateInvoice })));
const InvoiceDetailsPage = lazy(() => import('./pages/InvoiceDetailsPage').then(m => ({ default: m.InvoiceDetailsPage })));
const Payments = lazy(() => import('./pages/Payments').then(m => ({ default: m.Payments })));
const CourierAnalytics = lazy(() => import('./pages/CourierAnalytics').then(m => ({ default: m.CourierAnalytics })));
const GSTReports = lazy(() => import('./pages/GSTReports').then(m => ({ default: m.GSTReports })));
const BackupCenter = lazy(() => import('./pages/BackupCenter').then(m => ({ default: m.BackupCenter })));
const DBHealthCheck = lazy(() => import('./pages/DBHealthCheck').then(m => ({ default: m.DBHealthCheck })));
const RunTests = lazy(() => import('./pages/RunTests').then(m => ({ default: m.RunTests })));
const Team = lazy(() => import('./pages/Team').then(m => ({ default: m.Team })));
const TelecallerPerformance = lazy(() => import('./pages/TelecallerPerformance').then(m => ({ default: m.TelecallerPerformance })));

/** Blocks admin-only routes for telecallers. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SplashScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="inline-block w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-slate-700 font-bold">Loading AVNIDEEP CRM PRO</p>
        <p className="text-slate-500 text-sm">Initializing database…</p>
      </div>
    </div>
  );
}

function AppContent() {
  const { loading, user, profile } = useAuth();
  const [isReady, setIsReady] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(() => sessionStorage.getItem('crm_unlocked') === 'true');

  const canEnter = offlineMode || Boolean(user && profile);

  // Boot: SQLite hydration (desktop) + online cloud sync (when logged in)
  useEffect(() => {
    if (!canEnter) return;
    let mounted = true;
    (async () => {
      try {
        const electronAPI = (window as any).electron;
        if (electronAPI?.sqlite) {
          await hydrateFromSQLite();
          attachWriteThroughSync(db);
          console.log('[App] Booted with SQLite persistence layer');
        } else {
          console.log('[App] Booted with browser-only persistence (Dexie/IndexedDB)');
        }
        if (!offlineMode && user) {
          await startOnlineSync();
        }
      } catch (err) {
        console.error('[App] Boot sequence error:', err);
      } finally {
        if (mounted) setIsReady(true);
      }
    })();
    return () => { mounted = false; stopOnlineSync(); };
  }, [canEnter, user, offlineMode]);
  // Notification engine: overdue follow-ups, pending leads, inactive telecallers (every 5 min)
  useEffect(() => {
    const check = async () => {
      if (!profile || profile.role !== 'admin') return;
      try { await runNotificationChecks(); } catch (e) { console.error('[NotificationEngine] failed:', e); }
    };
    check();
    const interval = setInterval(check, 300000);
    return () => clearInterval(interval);
  }, []);

  // SpaceL Overdue Follow-up Check (every 60s)
  useEffect(() => {
    const checkSpaceL = async () => {
      try {
        await checkOverdueSpaceLFollowups();
      } catch (e) {
        console.error('[SpaceL] Auto-check failed:', e);
      }
    };
    checkSpaceL();
    const interval = setInterval(checkSpaceL, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <SplashScreen />;

  if (!canEnter) {
    return <Login onContinueOffline={() => setOfflineMode(true)} />;
  }

  if (!isReady) return <SplashScreen />;

  if (!isUnlocked) {
    return <LockScreen onUnlock={() => setIsUnlocked(true)} />;
  }

  // Lazy-loading fallback — shown while a page bundle is being fetched
  const PageFallback = () => (
    <div className="flex items-center justify-center py-32">
      <div className="text-center">
        <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-2"></div>
        <p className="text-sm text-slate-500">Loading page…</p>
      </div>
    </div>
  );

  return (
    <Router>
      <DateFilterProvider>
      <Toaster position="top-right" />
      <Suspense fallback={<PageFallback />}>
        <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="leads" element={<LeadCenter />} />
          <Route path="followups" element={<FollowUps />} />
          <Route path="orders" element={<OrderPipeline />} />
          {/* Admin-only modules (telecallers are redirected to Dashboard) */}
          <Route path="logistics" element={<RequireAdmin><Logistics /></RequireAdmin>} />
          <Route path="ndr" element={<RequireAdmin><NDRPanel /></RequireAdmin>} />
          <Route path="delivered-list" element={<RequireAdmin><DeliveredCustomers /></RequireAdmin>} />
          <Route path="undelivered-list" element={<RequireAdmin><UndeliveredCustomers /></RequireAdmin>} />
          <Route path="customers" element={<RequireAdmin><Customers /></RequireAdmin>} />
          <Route path="bulk-import" element={<RequireAdmin><BulkImport /></RequireAdmin>} />
          <Route path="invoices" element={<RequireAdmin><Invoices /></RequireAdmin>} />
          <Route path="invoices/create" element={<RequireAdmin><CreateInvoice /></RequireAdmin>} />
          <Route path="invoices/:invoiceNo" element={<RequireAdmin><InvoiceDetailsPage /></RequireAdmin>} />
          <Route path="invoice-settings" element={<RequireAdmin><InvoiceSettings /></RequireAdmin>} />
          <Route path="inventory" element={<RequireAdmin><Inventory /></RequireAdmin>} />
          <Route path="payments" element={<RequireAdmin><Payments /></RequireAdmin>} />
          <Route path="courier-analytics" element={<RequireAdmin><CourierAnalytics /></RequireAdmin>} />
          <Route path="gst-reports" element={<RequireAdmin><GSTReports /></RequireAdmin>} />
          <Route path="backup" element={<RequireAdmin><BackupCenter /></RequireAdmin>} />
          <Route path="whatsapp" element={<RequireAdmin><WhatsApp /></RequireAdmin>} />
          <Route path="analytics" element={<RequireAdmin><Analytics /></RequireAdmin>} />
          <Route path="team" element={<RequireAdmin><Team /></RequireAdmin>} />
          <Route path="performance" element={<RequireAdmin><TelecallerPerformance /></RequireAdmin>} />
          <Route path="settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
          <Route path="run-tests" element={<RequireAdmin><RunTests /></RequireAdmin>} />
          <Route path="db-health" element={<RequireAdmin><DBHealthCheck /></RequireAdmin>} />
        </Route>
      </Routes>
      </Suspense>
      </DateFilterProvider>
    </Router>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
