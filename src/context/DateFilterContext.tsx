// AVNIDEEP CRM PRO — Global Date Filter Context
// All list modules consume this single source of truth for date-range filtering.

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

// ===== Date Presets =====
export type DatePreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'custom';

export const PRESET_LABELS: Record<DatePreset, string> = {
  all: 'All Time',
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 Days',
  last30: 'Last 30 Days',
  thisMonth: 'This Month',
  lastMonth: 'Last Month',
  thisYear: 'This Year',
  custom: 'Custom Range',
};

export const QUICK_PRESETS: DatePreset[] = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'thisMonth',
  'lastMonth',
  'thisYear',
  'custom',
];

// ===== Date Range State =====
export interface DateRange {
  start: Date | null;
  end: Date | null;
}

export interface DateFilterState {
  preset: DatePreset;
  startDate: Date | null;
  endDate: Date | null;
  customStart: string; // YYYY-MM-DD
  customEnd: string;   // YYYY-MM-DD
}

// ===== Compute start/end from preset =====
function computeRange(preset: DatePreset, customStart: string, customEnd: string): { start: Date | null; end: Date | null } {
  const now = new Date();

  switch (preset) {
    case 'all':
      return { start: null, end: null };

    case 'today': {
      const s = new Date(now);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e };
    }

    case 'yesterday': {
      const s = new Date(now);
      s.setDate(s.getDate() - 1);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setDate(e.getDate() - 1);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e };
    }

    case 'last7': {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e };
    }

    case 'last30': {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e };
    }

    case 'thisMonth': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e };
    }

    case 'lastMonth': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start: s, end: e };
    }

    case 'thisYear': {
      const s = new Date(now.getFullYear(), 0, 1);
      s.setHours(0, 0, 0, 0);
      const e = new Date(now);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e };
    }

    case 'custom': {
      if (!customStart || !customEnd) return { start: null, end: null };
      const s = new Date(customStart + 'T00:00:00');
      const e = new Date(customEnd + 'T23:59:59.999');
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return { start: null, end: null };
      return { start: s, end: e };
    }

    default:
      return { start: null, end: null };
  }
}

// ===== Context =====
interface DateFilterContextValue {
  state: DateFilterState;
  range: DateRange;
  setPreset: (preset: DatePreset) => void;
  setCustomRange: (start: string, end: string) => void;
  clearFilter: () => void;
  /** Check if a date string/object falls within the current filter range */
  isInRange: (dateValue: any) => boolean;
  /** Filter an array of items by a date field */
  filterByDate: <T>(items: T[], dateField: keyof T | ((item: T) => string | Date | null | undefined)) => T[];
  /** Get a human-readable label for the active filter */
  activeLabel: string;
}

const DateFilterContext = createContext<DateFilterContextValue | null>(null);

// ===== Provider =====
export function DateFilterProvider({ children }: { children: ReactNode }) {
  const [preset, setPreset] = useState<DatePreset>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const range = useMemo(() => computeRange(preset, customStart, customEnd), [preset, customStart, customEnd]);

  const state: DateFilterState = useMemo(
    () => ({ preset, startDate: range.start, endDate: range.end, customStart, customEnd }),
    [preset, range, customStart, customEnd]
  );

  const handleSetPreset = useCallback((p: DatePreset) => {
    setPreset(p);
  }, []);

  const handleSetCustomRange = useCallback((start: string, end: string) => {
    setCustomStart(start);
    setCustomEnd(end);
    setPreset('custom');
  }, []);

  const clearFilter = useCallback(() => {
    setPreset('all');
    setCustomStart('');
    setCustomEnd('');
  }, []);

  // Parse any date value into a Date object for comparison
  const parseDateValue = useCallback((value: any): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) return d;
      // Try dd/mm/yyyy
      const m = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (m) {
        const [, day, mon, yr] = m;
        const year = yr.length === 2 ? 2000 + parseInt(yr) : parseInt(yr);
        const parsed = new Date(year, parseInt(mon) - 1, parseInt(day));
        if (!isNaN(parsed.getTime())) return parsed;
      }
    }
    return null;
  }, []);

  const isInRange = useCallback(
    (dateValue: any): boolean => {
      if (!range.start && !range.end) return true; // 'all' — no filter
      const date = parseDateValue(dateValue);
      if (!date) return false;
      if (range.start && date.getTime() < range.start.getTime()) return false;
      if (range.end && date.getTime() > range.end.getTime()) return false;
      return true;
    },
    [range, parseDateValue]
  );

  const filterByDate = useCallback(
    <T,>(items: T[], dateField: keyof T | ((item: T) => string | Date | null | undefined)): T[] => {
      if (!range.start && !range.end) return items; // 'all' — no filtering
      return items.filter((item) => {
        let dateValue: string | Date | null | undefined;
        if (typeof dateField === 'function') {
          dateValue = dateField(item);
        } else {
          dateValue = item[dateField] as any;
        }
        return isInRange(dateValue);
      });
    },
    [range, isInRange]
  );

  const activeLabel = useMemo(() => {
    if (preset === 'all') return 'All Time';
    if (preset === 'custom') {
      if (customStart && customEnd) {
        const fmt = (d: string) => {
          const parts = d.split('-');
          return `${parts[2]}/${parts[1]}/${parts[0]}`;
        };
        return `${fmt(customStart)} - ${fmt(customEnd)}`;
      }
      return 'Custom Range';
    }
    return PRESET_LABELS[preset];
  }, [preset, customStart, customEnd]);

  const value = useMemo<DateFilterContextValue>(
    () => ({
      state,
      range,
      setPreset: handleSetPreset,
      setCustomRange: handleSetCustomRange,
      clearFilter,
      isInRange,
      filterByDate,
      activeLabel,
    }),
    [state, range, handleSetPreset, handleSetCustomRange, clearFilter, isInRange, filterByDate, activeLabel]
  );

  return <DateFilterContext.Provider value={value}>{children}</DateFilterContext.Provider>;
}

// ===== Hook =====
export function useDateFilter(): DateFilterContextValue {
  const ctx = useContext(DateFilterContext);
  if (!ctx) {
    throw new Error('useDateFilter must be used within a DateFilterProvider');
  }
  return ctx;
}
