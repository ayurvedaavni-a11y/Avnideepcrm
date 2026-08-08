import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { ErrorBoundary } from './ErrorBoundary';

import { GlobalSearchAndNav } from './GlobalSearchAndNav';
import { GlobalDateFilter } from './DateRangeFilter';

// All modules including Dashboard and Analytics now support the global date filter
const DATE_FILTER_ENABLED_ROUTES = [
  '/',
  '/leads',
  '/orders',
  '/logistics',
  '/customers',
  '/delivered-list',
  '/undelivered-list',
  '/payments',
  '/invoices',
  '/followups',
  '/ndr',
  '/inventory',
  '/gst-reports',
  '/analytics',
];

export function Layout() {
  const location = useLocation();
  const showDateFilter = DATE_FILTER_ENABLED_ROUTES.includes(location.pathname);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <GlobalSearchAndNav />
        {/* Global Date Filter Bar */}
        {showDateFilter && (
          <div className="bg-white border-b border-slate-200 px-3 sm:px-6 lg:px-8 py-2.5 flex items-center gap-3 z-10">
            <GlobalDateFilter />
            <div className="text-xs text-slate-400">
              All lists, counters, search, and exports respect this date range.
            </div>
          </div>
        )}
        <main className="flex-1 overflow-y-auto bg-slate-50 relative z-0">
          <ErrorBoundary>
            <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto pb-24 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              <Outlet />
            </div>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
