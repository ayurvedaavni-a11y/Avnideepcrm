import { useState, useEffect, useRef } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2'
import MapPin from 'lucide-react/dist/esm/icons/map-pin'
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle'
import { resolvePincode } from '../db/pincodeEngine';

interface Props {
  pincode: string;
  city: string;
  state: string;
  onChange: (updates: { pincode?: string; city?: string; state?: string; district?: string }) => void;
  layout?: 'grid' | 'inline';
  required?: boolean;
  /** Optional id prefix so multiple instances (e.g. desktop + mobile modal layouts) keep unique DOM ids. */
  idPrefix?: string;
}

/**
 * Smart Pincode Input — auto-detects state/city/district when a valid 6-digit pincode is entered.
 * Designed as a drop-in replacement for the existing Pincode/City/State inputs without changing form layout.
 */
export function PincodeInput({ pincode, city, state, onChange, required = false, idPrefix = '' }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [detectionInfo, setDetectionInfo] = useState<string>('');
  const lastLookup = useRef<string>('');

  useEffect(() => {
    const trimmed = (pincode || '').trim();

    // Skip if same as last lookup or invalid length
    if (trimmed === lastLookup.current) return;
    if (trimmed.length !== 6) {
      setStatus('idle');
      setDetectionInfo('');
      return;
    }
    if (!/^\d{6}$/.test(trimmed)) {
      setStatus('error');
      setDetectionInfo('Pincode must be 6 digits');
      return;
    }

    lastLookup.current = trimmed;
    setStatus('loading');
    setDetectionInfo('');

    let cancelled = false;
    (async () => {
      try {
        const result = await resolvePincode(trimmed);
        if (cancelled) return;
        if (result) {
          // Only autofill empty fields to preserve manual edits
          const updates: any = {};
          if (!city.trim() && result.city) updates.city = result.city;
          if (!state.trim() && result.state) updates.state = result.state;
          if (result.district) updates.district = result.district;
          if (Object.keys(updates).length > 0) onChange(updates);

          setStatus('success');
          setDetectionInfo(
            result.source === 'curated' ? '✓ Verified location' :
            result.source === 'api' ? '✓ Fetched from India Post' :
            result.source === 'cache' ? '✓ Cached location' :
            '✓ State auto-detected'
          );
        } else {
          setStatus('error');
          setDetectionInfo('Pincode not found — please enter manually');
        }
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setDetectionInfo('Lookup failed');
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pincode]);

  return (
    <div>
      <label htmlFor={`${idPrefix}pincode-input`} className="block text-sm font-medium text-slate-700 mb-1">
        Pincode {required && '*'}
      </label>
      <div className="relative">
        <input
          id={`${idPrefix}pincode-input`}
          name={`${idPrefix}pincode-input`}
          type="text"
          maxLength={6}
          required={required}
          value={pincode}
          onChange={(e) => onChange({ pincode: e.target.value.replace(/\D/g, '') })}
          placeholder="e.g. 400001"
          className="w-full p-2 pr-9 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
          {status === 'loading' && <Loader2 size={16} className="text-blue-500 animate-spin" />}
          {status === 'success' && <CheckCircle size={16} className="text-emerald-500" />}
          {status === 'error' && <AlertCircle size={16} className="text-amber-500" />}
          {status === 'idle' && <MapPin size={16} className="text-slate-400" />}
        </div>
      </div>
      {detectionInfo && (
        <p className={`text-xs mt-1 font-medium ${
          status === 'success' ? 'text-emerald-600' :
          status === 'error' ? 'text-amber-600' : 'text-slate-500'
        }`}>
          {detectionInfo}
        </p>
      )}
    </div>
  );
}
