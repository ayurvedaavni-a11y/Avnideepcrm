import { lookupPincode, detectStateFromPrefix } from './pincodeData';

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

export function normalizeStateName(input: any): string {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return 'Unknown';
  const map: Record<string, string> = {
    'up': 'Uttar Pradesh',
    'u.p.': 'Uttar Pradesh',
    'uttar pradesh': 'Uttar Pradesh',
    'uk': 'Uttarakhand',
    'u.k.': 'Uttarakhand',
    'uttarakhand': 'Uttarakhand',
    'uttaranchal': 'Uttarakhand',
    'orissa': 'Odisha',
    'odisha': 'Odisha',
    'odisa': 'Odisha',
    'delhi': 'Delhi',
    'maharashtra': 'Maharashtra',
    'gujarat': 'Gujarat',
    'rajasthan': 'Rajasthan',
    'bihar': 'Bihar',
    'karnataka': 'Karnataka',
    'west bengal': 'West Bengal',
    'wb': 'West Bengal',
    'telangana': 'Telangana',
    'tamil nadu': 'Tamil Nadu',
    'madhya pradesh': 'Madhya Pradesh',
    'haryana': 'Haryana',
    'punjab': 'Punjab',
    'kerala': 'Kerala',
    'jharkhand': 'Jharkhand',
    'chhattisgarh': 'Chhattisgarh',
    'goa': 'Goa'
  };
  return map[raw] || toTitleCase(raw);
}

export interface ResolvedLocation {
  city: string;
  district: string;
  state: string;
  pincode: string;
}

/**
 * Resolve full customer location with strict priority:
 * 1. explicit state/city/pincode fields
 * 2. pincode lookup DB
 * 3. address text parsing fallback
 * 4. Unknown (never hardcode UP)
 */
export function resolveCustomerLocation(input: {
  city?: string | null;
  district?: string | null;
  state?: string | null;
  pincode?: string | null;
  address?: string | null;
}): ResolvedLocation {
  let city = String(input.city || '').trim();
  let district = String(input.district || '').trim();
  let state = String(input.state || '').trim();
  let pincode = String(input.pincode || '').trim();

  // 1. Explicit state field first
  if (state) state = normalizeStateName(state);

  // 2. Pincode lookup
  if (/^\d{6}$/.test(pincode)) {
    const rec = lookupPincode(pincode);
    if (rec) {
      if (!city) city = rec.city;
      if (!district) district = rec.district;
      if (!state || state === 'Unknown') state = normalizeStateName(rec.state);
    } else {
      const prefixState = detectStateFromPrefix(pincode);
      if (prefixState && (!state || state === 'Unknown')) state = normalizeStateName(prefixState);
    }
  }

  // 3. Address parsing fallback
  const lower = String(input.address || '').toLowerCase();
  if (!state || state === 'Unknown') {
    const states = [
      'uttar pradesh', 'uttarakhand', 'delhi', 'maharashtra', 'gujarat', 'rajasthan', 'bihar',
      'karnataka', 'west bengal', 'odisha', 'telangana', 'tamil nadu', 'madhya pradesh',
      'haryana', 'punjab', 'kerala', 'jharkhand', 'chhattisgarh', 'goa'
    ];
    for (const s of states) {
      if (lower.includes(s)) { state = normalizeStateName(s); break; }
    }
  }
  if (!city) {
    const knownCities = ['haridwar','varanasi','ghaziabad','udaipur','delhi','mumbai','pune','jaipur','lucknow','kanpur','noida','greater noida'];
    for (const c of knownCities) {
      if (lower.includes(c)) { city = toTitleCase(c); break; }
    }
  }
  if (!district && city) district = city;

  return {
    city: city || 'Unknown',
    district: district || 'Unknown',
    state: state || 'Unknown',
    pincode: pincode || 'Unknown',
  };
}

export function resolveCustomerState(input: {
  state?: string | null;
  pincode?: string | null;
  address?: string | null;
}): string {
  return resolveCustomerLocation({ state: input.state, pincode: input.pincode, address: input.address }).state;
}
