// AVNIDEEP CRM PRO — Safe date formatting for display
// Wraps date-fns format with safe parsing — never crashes
import { format } from 'date-fns';
import { safeParseDate } from './dateUtils';

/**
 * Safe date-fns format — never throws on invalid dates.
 * Returns formatted date string or "N/A" fallback.
 */
export function safeFormat(value: any, fmt: string = 'dd MMM yyyy'): string {
  const d = safeParseDate(value);
  if (!d) return 'N/A';
  try {
    return format(d, fmt);
  } catch {
    return 'N/A';
  }
}

/**
 * Safe short date format.
 */
export function safeFormatShort(value: any): string {
  return safeFormat(value, 'dd MMM');
}

/**
 * Safe date-time format.
 */
export function safeFormatDateTime(value: any): string {
  return safeFormat(value, 'dd MMM yyyy, hh:mm a');
}

/**
 * Safe day + time format.
 */
export function safeFormatDay(value: any): string {
  return safeFormat(value, 'EEE');
}
