// AVNIDEEP CRM PRO — Enterprise-Grade Safe Date Utilities
// Never throws, never crashes, always returns valid display values.

/**
 * Convert Excel serial date number (e.g. 45798) to Date.
 * Excel serial date 1 = January 1, 1900.
 */
function excelSerialToDate(serial: number): Date | null {
  if (!serial || serial < 1) return null;
  // Excel incorrectly treats 1900 as leap year, so we subtract 1 day for dates after Feb 28, 1900
  const offset = serial > 60 ? 1 : 0;
  const epoch = new Date(1899, 11, 30); // Dec 30, 1899 (Excel epoch)
  const result = new Date(epoch.getTime() + (serial - offset) * 86400000);
  return isNaN(result.getTime()) ? null : result;
}

/**
 * SAFE date parser — never throws, never crashes.
 * Handles ALL formats: Excel serial, ISO, dd/mm/yyyy, timestamps, Date objects.
 */
export function safeParseDate(value: any): Date | null {
  if (value === undefined || value === null || value === '') return null;

  // Already a Date object
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  // Number — could be Excel serial date (e.g. 45798) or Unix timestamp
  if (typeof value === 'number') {
    // Excel serial date (typically 40000-60000 range for modern dates)
    if (value > 10000 && value < 200000) {
      return excelSerialToDate(value);
    }
    // Unix timestamp (milliseconds since 1970)
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof value !== 'string') return null;

  const str = value.trim();
  if (!str) return null;

  // Try ISO/UTC formats first (most reliable)
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) return iso;

  // Try dd/mm/yyyy (Indian/European format)
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    const parsed = new Date(year, parseInt(m) - 1, parseInt(d));
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // Try yyyy-mm-dd (SQL/Js Date input format)
  const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    const parsed = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // Try extracting date-like numbers from any string
  const nums = str.match(/\d{2,4}[\-\/\s]\d{1,2}[\-\/\s]\d{1,4}/g);
  if (nums) {
    for (const n of nums) {
      const d = new Date(n);
      if (!isNaN(d.getTime())) return d;
    }
  }

  return null;
}

/**
 * SAFE date formatting — never throws, never crashes.
 * Returns formatted date or "N/A" fallback.
 */
export function safeFormatDate(value: any, options: Intl.DateTimeFormatOptions = {}): string {
  const d = safeParseDate(value);
  if (!d) return 'N/A';

  try {
    const defaultOpts: Intl.DateTimeFormatOptions = {
      day: '2-digit', month: 'short', year: 'numeric', ...options
    };
    return d.toLocaleDateString('en-IN', defaultOpts);
  } catch {
    return 'N/A';
  }
}

/**
 * SAFE date formatting with time — never throws.
 */
export function safeFormatDateTime(value: any): string {
  return safeFormatDate(value, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/**
 * SAFE ISO string generation — never throws.
 * Returns ISO string or '' fallback.
 */
export function safeToISO(value: any): string {
  const d = safeParseDate(value);
  if (!d) return '';
  try { return d.toISOString(); } catch { return ''; }
}

/**
 * SAFE display date — never throws.
 * Returns formatted date or "N/A".
 */
export function safeDisplayDate(value: any): string {
  return safeFormatDate(value);
}

/**
 * SAFE display date-time — never throws.
 */
export function safeDisplayDateTime(value: any): string {
  return safeFormatDateTime(value);
}
