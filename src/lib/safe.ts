// AVNIDEEP CRM PRO — Centralized Safe Utilities
// ALL modules MUST use these. NO direct parsing elsewhere.

import { safeParseDate } from './dateUtils';

/** Safe money: parse and validate financial values. Never returns NaN or negative for valid data. */
export function safeMoney(value: any): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : Math.max(0, value);
  if (typeof value === 'string') {
    const cleaned = value.replace(/[₹,,\s]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : Math.max(0, num);
  }
  return 0;
}

/** Safe number: parse any value to a non-negative number. */
export function safeNumber(value: any): number {
  if (value === undefined || value === null) return 0;
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^\d.-]/g, ''));
  return isNaN(num) ? 0 : Math.max(0, num);
}

/** Safe string: never returns null/undefined. */
export function safeString(value: any, fallback: string = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return String(value);
  const s = String(value).trim();
  return s || fallback;
}

/** Safe array: never returns null. */
export function safeArray<T>(value: T[] | null | undefined): T[] {
  return value || [];
}

/** Safe date: never throws. Returns Date or null. */
export function safeDate(value: any): Date | null {
  return safeParseDate(value);
}

/** Safe date display: never crashes. */
export function safeDisplayDate(value: any, fmt?: string): string {
  const d = safeParseDate(value);
  if (!d) return 'N/A';
  try {
    if (!fmt) {
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    // Simple format support
    const map: Record<string, string> = {
      'dd MMM yyyy': d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      'dd MMM': d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      'dd MMM yyyy, HH:mm': d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    };
    return map[fmt] || d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return 'N/A';
  }
}

/** Safe percentage: compute with zero-division protection. */
export function safePercent(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.round((Math.max(0, part) / total) * 100);
}

/** Safe reduce: never crashes on empty arrays. */
export function safeReduce<T>(arr: T[] | null | undefined, fn: (acc: number, item: T) => number, initial: number = 0): number {
  if (!arr || arr.length === 0) return initial;
  try {
    return arr.reduce(fn, initial);
  } catch {
    return initial;
  }
}

/** Safe sum: sum a numeric field from an array. */
export function safeSum<T>(arr: T[] | null | undefined, field: keyof T): number {
  return safeReduce(arr, (acc, item) => acc + safeMoney(item[field]), 0);
}

/** Safe filter: never crashes. */
export function safeFilter<T>(arr: T[] | null | undefined, fn: (item: T) => boolean): T[] {
  if (!arr) return [];
  try {
    return arr.filter(fn);
  } catch {
    return [];
  }
}

/** Safe tracking: normalizes AWB/tracking to display value. */
export function safeTracking(value: any): string {
  const s = safeString(value);
  if (!s || s === 'N/A-IMP-') return 'N/A';
  if (s.startsWith('N/A-IMP')) return 'N/A';
  return s;
}

/** Safe customer name: never shows empty. */
export function safeCustomerName(name: any, phone: any): string {
  const n = safeString(name);
  if (n) return n;
  const p = safeString(phone);
  return p || 'Unknown Customer';
}

/** Safe status: normalize with fallback. */
export function safeStatus(status: any, fallback: string = 'In Transit'): string {
  const s = safeString(status);
  return s || fallback;
}
