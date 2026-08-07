// =====================================================================
// Worker auth helpers — WebCrypto only (no dependencies).
//  - PIN hashing: PBKDF2-HMAC-SHA256, stored as pbkdf2$iter$salt$hash
//  - Session tokens: HS256 JWTs signed with AUTH_SECRET
// =====================================================================

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- base64url ----------
function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- PBKDF2 PIN hashing ----------
async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const km = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    km,
    256
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string, iterations: number): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const derived = await derive(pin, salt, iterations);
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(derived)}`;
}

export async function verifyPin(pin: string, stored: string, iterations: number): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iters = Number(parts[1]) || iterations;
  const salt = fromB64url(parts[2]);
  const expected = fromB64url(parts[3]);
  const derived = await derive(pin, salt, iters);
  if (derived.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
  return diff === 0;
}

// ---------- HS256 JWT ----------
export async function signJwt(payload: Record<string, unknown>, secret: string, expiresInSec: number): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const h = b64url(enc.encode(JSON.stringify(header)));
  const p = b64url(enc.encode(JSON.stringify(body)));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyJwt(token: string, secret: string): Promise<Record<string, any> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, fromB64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(fromB64url(parts[1])));
    if (!payload || typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
