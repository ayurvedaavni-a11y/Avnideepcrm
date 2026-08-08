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
    // .av-shell-height = 100dvh with a 100vh fallback for older browsers
    // (see index.css). Mobile browsers shrink the visible viewport when the
    // URL bar shows; 100vh overflows it and cuts content behind the URL bar.
    // min-w-0 on the content column lets wide children (tables/boards) scroll
    // INSIDE their own overflow container instead of pushing the whole page
    // horizontally — root cause of mobile horizontal page overflow.
    <div className="flex av-shell-height bg-slate-50 overflow-hidden font-sans text-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 av-shell-height overflow-hidden">
        <GlobalSearchAndNav />
        {/* Global Date Filter Bar — compact single row */}
        {showDateFilter && (
          <div className="bg-white border-b border-slate-200 px-2.5 sm:px-4 lg:px-6 py-1.5 flex items-center gap-2 z-10">
            <GlobalDateFilter />
            <div className="text-xs text-slate-400 hidden md:inline">
              All lists, counters, search, and exports respect this date range.
            </div>
          </div>
        )}
        <main className="flex-1 overflow-y-auto bg-slate-50 relative z-0 min-h-0">
          <ErrorBoundary>
            {/* Compact paddings: mobile p-2.5, desktop p-6. The old pb-24
                (96px) reserved space for a bottom nav that does not exist. */}
            <div className="p-2.5 sm:p-4 lg:p-6 max-w-7xl mx-auto pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <Outlet />
            </div>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
