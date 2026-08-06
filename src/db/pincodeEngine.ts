// AVNIDEEP CRM PRO — Pincode Lookup Engine
// Offline-first with optional online enrichment via India Post public API.

import { db } from './db';
import { lookupPincode, detectStateFromPrefix, PincodeRecord } from './pincodeData';

interface CachedPincode {
  pincode: string;
  city: string;
  district: string;
  state: string;
  source: 'curated' | 'cache' | 'api' | 'prefix';
}

// In-memory cache for the session
const memoryCache = new Map<string, CachedPincode>();

/**
 * Lookup pincode details with 4-tier strategy:
 * 1. In-memory cache (instant)
 * 2. Curated CITY_DATABASE (offline, instant)
 * 3. SQLite/IndexedDB cache from previous API hits (offline)
 * 4. India Post API (online only — non-blocking)
 *
 * Falls back to state-prefix detection if nothing matches.
 */
export async function resolvePincode(pincode: string): Promise<CachedPincode | null> {
  if (!pincode || pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
    return null;
  }

  // 1. Memory cache
  if (memoryCache.has(pincode)) {
    return memoryCache.get(pincode)!;
  }

  // 2. Curated database (highest quality, offline)
  const curated = lookupPincode(pincode);
  if (curated) {
    const rec: CachedPincode = { pincode, ...curated, source: 'curated' };
    memoryCache.set(pincode, rec);
    return rec;
  }

  // 3. Settings table cache (persisted across sessions)
  try {
    const cached = await db.invoiceSettings.where('key').equals(`pincode:${pincode}`).first();
    if (cached) {
      const parsed: PincodeRecord = JSON.parse(cached.value);
      const rec: CachedPincode = { pincode, ...parsed, source: 'cache' };
      memoryCache.set(pincode, rec);
      return rec;
    }
  } catch (e) {}

  // 4. Online API (non-blocking, only if online)
  if (navigator.onLine) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data[0]?.Status === 'Success' && data[0]?.PostOffice?.length > 0) {
          const po = data[0].PostOffice[0];
          const rec: CachedPincode = {
            pincode,
            city: po.Name || po.Block || '',
            district: po.District || '',
            state: po.State || '',
            source: 'api',
          };
          memoryCache.set(pincode, rec);

          // Persist to SQLite for future offline use
          try {
            await db.invoiceSettings.add({
              key: `pincode:${pincode}`,
              value: JSON.stringify({ city: rec.city, district: rec.district, state: rec.state }),
              updatedAt: new Date().toISOString(),
            });
          } catch (e) {}

          return rec;
        }
      }
    } catch (err) {
      // Silent fail — fall through to prefix detection
    }
  }

  // 5. State prefix fallback (works for ALL valid Indian pincodes)
  const state = detectStateFromPrefix(pincode);
  if (state) {
    const rec: CachedPincode = { pincode, city: '', district: '', state, source: 'prefix' };
    memoryCache.set(pincode, rec);
    return rec;
  }

  return null;
}

/**
 * Synchronous lookup — only checks curated DB + memory cache.
 * Useful for bulk imports where async per-row lookup would be too slow.
 */
export function resolvePincodeSync(pincode: string): CachedPincode | null {
  if (!pincode || pincode.length !== 6 || !/^\d{6}$/.test(pincode)) return null;

  if (memoryCache.has(pincode)) return memoryCache.get(pincode)!;

  const curated = lookupPincode(pincode);
  if (curated) {
    const rec: CachedPincode = { pincode, ...curated, source: 'curated' };
    memoryCache.set(pincode, rec);
    return rec;
  }

  const state = detectStateFromPrefix(pincode);
  if (state) {
    return { pincode, city: '', district: '', state, source: 'prefix' };
  }
  return null;
}
